/**
 * invigilator-worker.js — Optimized Web Worker
 */

/* ---------- importScripts polyfill for module-worker environments ----------
 * Vite dev mode always serves workers as ES modules, which disables the native
 * importScripts().  MediaPipe's compiled WASM loader calls importScripts()
 * internally, so we shim it here with synchronous XHR + eval (both are fully
 * supported inside Web Workers).
 */
{
  const _native = self.importScripts?.bind(self);
  self.importScripts = (...urls) => {
    try {
      if (_native) _native(...urls);
    } catch (_err) {
      /* Fallback: fetch each script synchronously and eval in global scope. */
      for (const url of urls) {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);          // synchronous
        xhr.send();
        if (xhr.status >= 200 && xhr.status < 300) {
          (0, eval)(xhr.responseText);         // global eval
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
let workerConfig = { numFacesLimit: 1, slowLoop: 3000, awayTimeout: 5000 };

// NEW: Prevent worker message queue backlog
let isProcessing = false;

/* ---------- Helpers (Unchanged math, highly efficient) ---------- */
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

/* ---------- Message handler ---------- */
self.onmessage = async (e) => {
  const { command } = e.data;

  /* ===== INIT ===== */
  if (command === "INIT") {
    try {
      workerConfig = { ...workerConfig, ...e.data.config };

      const mp =
        await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/+esm");
      FaceLandmarker = mp.FaceLandmarker;
      FaceDetector = mp.FaceDetector;
      FilesetResolver = mp.FilesetResolver;

      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
      );

      // 1. Helper function to initialize models with fallback logic
      const initializeModel = async (
        ModelClass,
        modelPath,
        extraOptions = {},
      ) => {
        try {
          // Attempt GPU First
          return await ModelClass.createFromOptions(vision, {
            baseOptions: { modelAssetPath: modelPath, delegate: "GPU" },
            ...extraOptions,
          });
        } catch (gpuError) {
          console.warn(
            `[invigilator-worker] GPU initialization failed for ${ModelClass.name}. Falling back to CPU.`,
            gpuError,
          );

          // Fallback to CPU
          return await ModelClass.createFromOptions(vision, {
            baseOptions: { modelAssetPath: modelPath, delegate: "CPU" },
            ...extraOptions,
          });
        }
      };

      // 2. Initialize Landmarker
      faceLandmarker = await initializeModel(
        FaceLandmarker,
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        {
          runningMode: "IMAGE",
          numFaces: 1,
          outputFaceBlendshapes: false,
          outputFacialTransformationMatrixes: false,
        },
      );

      // 3. Initialize Detector
      faceDetector = await initializeModel(
        FaceDetector,
        "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
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
    // OPTIMIZATION: If worker is still running inference on the previous frame, drop this one instantly
    if (isProcessing) {
      // If passing ImageBitmap, we must close it to prevent GPU memory leaks
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
    let facesCount = 0;
    let multipleFacesAlert = false;

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
          }
        }
      }

      /* ---- Slow loop: FaceDetector ---- */
      if (
        faceDetector &&
        imageData &&
        timestamp - lastSlowLoopTime > workerConfig.slowLoop
      ) {
        const detectorResult = faceDetector.detect(imageData);

        if (detectorResult?.detections) {
          facesCount = detectorResult.detections.length;
          multipleFacesAlert = facesCount > workerConfig.numFacesLimit;
        }
        lastSlowLoopTime = timestamp;
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

      /* ---- Post unified telemetry ---- */
      self.postMessage({
        type: "TELEMETRY",
        facePresent,
        eyesClosed,
        headPose,
        verticalHeadPose,
        facesCount,
        multipleFacesAlert,
        cheating,
        cheatingReason,
        awayDuration,
        timestamp,
      });
    } catch (err) {
      console.warn("[invigilator-worker] Processing error:", err);
    } finally {
      // OPTIMIZATION: Clean up resource memory explicitly if using ImageBitmap
      if (imageData && typeof imageData.close === "function") {
        imageData.close();
      }
      isProcessing = false; // Release lock for next frame
    }
  }
};
