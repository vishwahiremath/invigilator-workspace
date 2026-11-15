/**
 * invigilator-worker.js — Optimized Web Worker for Invigilator SDK
 */

/* ---------- importScripts polyfill for module-worker environments ----------
 * Vite dev mode always serves workers as ES modules, which disables the native
 * importScripts(). MediaPipe's compiled WASM loader calls importScripts()
 * internally, so we shim it here with synchronous XHR + eval.
 */
{
  const _native = self.importScripts?.bind(self);
  self.importScripts = (...urls) => {
    try {
      if (_native) _native(...urls);
    } catch (_err) {
      for (const url of urls) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.send();
        if (xhr.status >= 200 && xhr.status < 300) {
          (0, eval)(xhr.responseText);
        } else {
          throw new Error(`importScripts polyfill: failed to load ${url} (HTTP ${xhr.status})`);
        }
      }
    }
  };
}

let FaceLandmarker = null;
let FaceDetector = null;
let FilesetResolver = null;
let faceLandmarker = null;
let faceDetector = null;
let lastSlowLoopTime = 0;
let awayStartTime = 0;
let eyeballsDisplacedStartTime = 0;
let workerConfig = {
  numFacesLimit: 1,
  slowLoop: 2500,
  awayTimeout: 5000,
  eyeMovementDuration: 5000,
  tasksVisionUrl: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm",
  wasmPath: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
  faceLandmarkerModelPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  faceDetectorModelPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
};

let isProcessing = false;
let cachedBoxes = [];

/* ---------- Helpers ---------- */
function computeEyesClosed(landmarks) {
  const upper = landmarks[159];
  const lower = landmarks[145];
  return Math.abs(upper.y - lower.y) < 0.018;
}

function computeHeadPose(landmarks) {
  const nose = landmarks[1];
  const leftCheek = landmarks[234];
  const rightCheek = landmarks[454];

  const dLeft = Math.hypot(
    nose.x - leftCheek.x,
    nose.y - leftCheek.y,
    nose.z - leftCheek.z,
  );
  const dRight = Math.hypot(
    nose.x - rightCheek.x,
    nose.y - rightCheek.y,
    nose.z - rightCheek.z,
  );
  const ratio = dLeft / (dLeft + dRight);

  if (ratio < 0.38) return "TURNED_RIGHT";
  if (ratio > 0.62) return "TURNED_LEFT";
  return "CENTER";
}

function computeVerticalHeadPose(landmarks) {
  const nose = landmarks[1];
  const forehead = landmarks[10];
  const chin = landmarks[152];

  const dUp = Math.hypot(
    nose.x - forehead.x,
    nose.y - forehead.y,
    nose.z - forehead.z,
  );
  const dDown = Math.hypot(nose.x - chin.x, nose.y - chin.y, nose.z - chin.z);
  const ratio = dUp / (dUp + dDown);

  if (ratio < 0.35) return "LOOKING_UP";
  if (ratio > 0.62) return "LOOKING_DOWN";
  return "CENTER";
}

function computeEyeGaze(landmarks) {
  // If iris landmarks (468 for left eye iris, 473 for right eye iris) exist
  if (landmarks.length > 473) {
    const irisLeft = landmarks[468];
    const irisRight = landmarks[473];
    const leftInner = landmarks[133];
    const leftOuter = landmarks[33];
    const rightInner = landmarks[362];
    const rightOuter = landmarks[263];

    const leftDist = Math.abs(leftInner.x - leftOuter.x) || 0.001;
    const rightDist = Math.abs(rightOuter.x - rightInner.x) || 0.001;

    const leftRatio = (irisLeft.x - Math.min(leftInner.x, leftOuter.x)) / leftDist;
    const rightRatio = (irisRight.x - Math.min(rightInner.x, rightOuter.x)) / rightDist;
    const avgRatio = (leftRatio + rightRatio) / 2;

    if (avgRatio < 0.35) return "LOOKING_RIGHT";
    if (avgRatio > 0.65) return "LOOKING_LEFT";
  }
  return "CENTER";
}

function computeBoundingBoxFromLandmarks(landmarks) {
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  // Add slight padding around face mesh
  const padX = (maxX - minX) * 0.1;
  const padY = (maxY - minY) * 0.15;

  return {
    x: Math.max(0, minX - padX),
    y: Math.max(0, minY - padY),
    width: Math.min(1, maxX + padX) - Math.max(0, minX - padX),
    height: Math.min(1, maxY + padY) - Math.max(0, minY - padY),
  };
}

/* ---------- Message handler ---------- */
self.onmessage = async (e) => {
  const { command } = e.data;

  /* ===== INIT ===== */
  if (command === "INIT") {
    try {
      workerConfig = { ...workerConfig, ...e.data.config };

      // Use dynamic import wrapped in new Function to prevent Webpack 5 AST parser
      // from treating the remote HTTPS module URL as a local scheme build dependency (UnhandledSchemeError).
      const nativeImport = new Function("u", "return import(u)");
      const tasksVisionUrl =
        workerConfig.tasksVisionUrl ||
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm";
      const wasmPath =
        workerConfig.wasmPath ||
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm";

      const mp = await nativeImport(tasksVisionUrl);
      FaceLandmarker = mp.FaceLandmarker;
      FaceDetector = mp.FaceDetector;
      FilesetResolver = mp.FilesetResolver;

      const vision = await FilesetResolver.forVisionTasks(wasmPath);

      const initializeModel = async (ModelClass, modelPath, extraOptions = {}) => {
        try {
          return await ModelClass.createFromOptions(vision, {
            baseOptions: { modelAssetPath: modelPath, delegate: "GPU" },
            ...extraOptions,
          });
        } catch (gpuError) {
          console.warn(
            `[invigilator-worker] GPU initialization failed for ${ModelClass.name}. Falling back to CPU.`,
            gpuError,
          );
          return await ModelClass.createFromOptions(vision, {
            baseOptions: { modelAssetPath: modelPath, delegate: "CPU" },
            ...extraOptions,
          });
        }
      };

      const faceLandmarkerModel =
        workerConfig.faceLandmarkerModelPath ||
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
      const faceDetectorModel =
        workerConfig.faceDetectorModelPath ||
        "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

      faceLandmarker = await initializeModel(
        FaceLandmarker,
        faceLandmarkerModel,
        {
          runningMode: "IMAGE",
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        },
      );

      faceDetector = await initializeModel(
        FaceDetector,
        faceDetectorModel,
        { runningMode: "IMAGE" },
      );

      self.postMessage({ type: "READY" });
    } catch (err) {
      self.postMessage({ type: "INIT_ERROR", error: String(err) });
    }
    return;
  }

  /* ===== PROCESS_FRAME ===== */
  if (command === "PROCESS_FRAME") {
    if (isProcessing) {
      if (e.data.imageData && typeof e.data.imageData.close === "function") {
        e.data.imageData.close();
      }
      return;
    }

    isProcessing = true;
    const { imageData, timestamp } = e.data;

    let facePresent = false;
    let eyesClosed = false;
    let headPose = "CENTER";
    let verticalHeadPose = "CENTER";
    let eyeGazeDirection = "CENTER";
    let facesCount = 0;
    let multipleFacesAlert = false;
    let boxes = [];

    try {
      /* ---- Fast loop: FaceLandmarker ---- */
      if (faceLandmarker && imageData) {
        const landmarkerResult = faceLandmarker.detect(imageData);

        if (landmarkerResult?.faceLandmarks?.length > 0) {
          facePresent = true;
          const landmarks = landmarkerResult.faceLandmarks[0];

          if (landmarks.length > 454) {
            eyesClosed = computeEyesClosed(landmarks);
            headPose = computeHeadPose(landmarks);
            verticalHeadPose = computeVerticalHeadPose(landmarks);
            eyeGazeDirection = computeEyeGaze(landmarks);
            const box = computeBoundingBoxFromLandmarks(landmarks);
            boxes = [box];
          }
        }
      }

      /* ---- Slow loop: FaceDetector (multi-face count) ---- */
      if (
        faceDetector &&
        imageData &&
        timestamp - lastSlowLoopTime > workerConfig.slowLoop
      ) {
        const detectorResult = faceDetector.detect(imageData);

        if (detectorResult?.detections) {
          facesCount = detectorResult.detections.length;
          multipleFacesAlert = facesCount > workerConfig.numFacesLimit;

          if (facesCount > 1) {
            const w = imageData.width || 640;
            const h = imageData.height || 480;
            cachedBoxes = detectorResult.detections.map((d) => ({
              x: d.boundingBox.originX / w,
              y: d.boundingBox.originY / h,
              width: d.boundingBox.width / w,
              height: d.boundingBox.height / h,
            }));
          } else {
            cachedBoxes = [];
          }
        }
        lastSlowLoopTime = timestamp;
      }

      if (facesCount > 1 && cachedBoxes.length > 0) {
        boxes = cachedBoxes;
      }

      /* ---- Face away from screen logic ---- */
      const faceAwayFromScreen =
        facePresent &&
        (headPose !== "CENTER" || verticalHeadPose !== "CENTER");

      /* ---- Eyeball displaced logic (> 5s threshold) ---- */
      const isEyeballDisplacedNow =
        facePresent &&
        (eyeGazeDirection !== "CENTER" || headPose !== "CENTER");

      let eyeballsDisplaced = false;
      if (isEyeballDisplacedNow) {
        if (eyeballsDisplacedStartTime === 0) {
          eyeballsDisplacedStartTime = timestamp;
        } else if (
          timestamp - eyeballsDisplacedStartTime >=
          (workerConfig.eyeMovementDuration || 5000)
        ) {
          eyeballsDisplaced = true;
        }
      } else {
        eyeballsDisplacedStartTime = 0;
      }

      /* ---- Away / Cheating logic ---- */
      const isAway =
        !facePresent || eyesClosed || verticalHeadPose === "LOOKING_DOWN";
      let cheating = false;
      let cheatingReason = "";

      if (isAway) {
        if (awayStartTime === 0) {
          awayStartTime = timestamp;
        } else if (timestamp - awayStartTime >= workerConfig.awayTimeout) {
          cheating = true;
          cheatingReason = !facePresent
            ? "Face not visible"
            : eyesClosed
              ? "Eyes closed"
              : "Looking down";
        }
      } else {
        awayStartTime = 0;
      }

      if (multipleFacesAlert) {
        cheating = true;
        cheatingReason = cheatingReason
          ? cheatingReason + " + Multiple faces"
          : "Multiple faces detected";
      }

      const awayDuration =
        isAway && awayStartTime > 0 ? timestamp - awayStartTime : 0;

      /* ---- Post telemetry ---- */
      self.postMessage({
        type: "TELEMETRY",
        facePresent,
        eyesClosed,
        headPose,
        verticalHeadPose,
        eyeGazeDirection,
        faceAwayFromScreen,
        eyeballsDisplaced,
        facesCount: facesCount || (facePresent ? 1 : 0),
        multipleFacesAlert,
        cheating,
        cheatingReason,
        awayDuration,
        boundingBoxes: boxes,
        timestamp,
      });
    } catch (err) {
      console.warn("[invigilator-worker] Processing error:", err);
    } finally {
      if (imageData && typeof imageData.close === "function") {
        imageData.close();
      }
      isProcessing = false;
    }
  }
};
