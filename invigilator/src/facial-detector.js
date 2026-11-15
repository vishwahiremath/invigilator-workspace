/**
 * facial-detector.js — Coordinates webcam capture, worker inference, canvas overlays, and event latches
 */

const DEFAULT_CONFIG = {
  numFacesLimit: 1,
  fastLoop: 250,
  slowLoop: 2500,
  awayTimeout: 5000,
  eyeMovementDuration: 5000,
  mirrored: true,
  canvasMirrored: undefined,
  brightnessThreshold: 20,
  noFaceThreshold: 6, // ~1.5s debounce at 250ms fastLoop to prevent initial frame/blink false alarms
};

export class FacialDetector {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.videoElement = null;
    this.canvasElement = null;
    this.mediaStream = null;
    this.worker = null;
    this.timerId = null;
    this.isCapturing = false;

    // Debounce counter for no-face detection hysteresis
    this._consecutiveNoFaceFrames = 0;
    this.noFaceThreshold = this.config.noFaceThreshold ?? 6;

    // Scratch canvas for luminance and snapshot generation
    this._scratchCanvas = null;

    // State latches to trigger start/stop events only on state transitions
    this._state = {
      isCameraBlocked: false,
      isNoFace: false,
      isMultiFace: false,
      isFaceAway: false,
      isEyeballsDisplaced: false,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                         */
  /* ------------------------------------------------------------------ */

  async initialize() {
    return new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(
          new URL("./invigilator-worker.js", import.meta.url),
          { type: "module" },
        );
      } catch (err) {
        return reject(
          new Error(`Failed to spawn invigilator worker: ${err.message}`),
        );
      }

      const onMessage = (e) => {
        const { type } = e.data;
        if (type === "READY") {
          this.worker.removeEventListener("message", onMessage);
          this.worker.addEventListener(
            "message",
            this._handleWorkerMessage.bind(this),
          );
          resolve();
        } else if (type === "INIT_ERROR") {
          this.worker.removeEventListener("message", onMessage);
          reject(new Error(e.data.error));
        }
      };

      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", (err) =>
        reject(new Error(`Worker error: ${err.message}`)),
      );

      this.worker.postMessage({
        command: "INIT",
        config: {
          numFacesLimit: this.config.numFacesLimit,
          slowLoop: this.config.slowLoop,
          awayTimeout: this.config.awayTimeout,
          eyeMovementDuration: this.config.eyeMovementDuration,
          tasksVisionUrl: this.config.tasksVisionUrl,
          wasmPath: this.config.wasmPath,
          faceLandmarkerModelPath: this.config.faceLandmarkerModelPath,
          faceDetectorModelPath: this.config.faceDetectorModelPath,
        },
      });
    });
  }

  async start(videoElement, canvasElement) {
    if (this.isCapturing) return;

    this.videoElement = videoElement;
    this.canvasElement = canvasElement || null;

    // 1. Ensure video stream is attached and playing
    if (!this.videoElement.srcObject) {
      try {
        const videoConstraints =
          this.config.videoConstraints || { width: 480, height: 360 };
        this.mediaStream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
        this.videoElement.srcObject = this.mediaStream;
      } catch (err) {
        throw new Error(`Failed to access camera: ${err.message}`);
      }
    } else {
      this.mediaStream = this.videoElement.srcObject;
    }

    try {
      await this.videoElement.play();
    } catch (_) {
      // autoplay might already be handling this
    }

    // 2. Initialize worker if not already ready
    if (!this.worker) {
      await this.initialize();
    }

    this.isCapturing = true;

    // 3. Start recursive loop
    const loop = async () => {
      if (!this.isCapturing) return;
      await this._captureAndSend();
      this.timerId = setTimeout(loop, this.config.fastLoop);
    };

    loop();
  }

  stop() {
    this.isCapturing = false;

    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    // Stop webcam media tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
      this.videoElement = null;
    }

    // Clear overlay canvas
    if (this.canvasElement) {
      const ctx = this.canvasElement.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
      }
      this.canvasElement = null;
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    // Reset state latches and debounce counters
    this._consecutiveNoFaceFrames = 0;
    this._state = {
      isCameraBlocked: false,
      isNoFace: false,
      isMultiFace: false,
      isFaceAway: false,
      isEyeballsDisplaced: false,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Frame Capture & Brightness Check                                    */
  /* ------------------------------------------------------------------ */

  async _captureAndSend() {
    if (!this.worker || !this.videoElement || this.videoElement.readyState < 2) return;

    try {
      // Check camera obstruction / darkness
      const isBlocked = this._checkCameraBlocked();
      const now = Date.now();

      if (isBlocked && !this._state.isCameraBlocked) {
        this._state.isCameraBlocked = true;
        const frame = await this._captureSnapshotBlob();
        this.config.onCameraBlocked?.();
        this.config.onFaceError?.("Camera blocked or covered or dark room", frame, now);
      } else if (!isBlocked && this._state.isCameraBlocked) {
        this._state.isCameraBlocked = false;
        const frame = await this._captureSnapshotBlob();
        this.config.onCameraBlockedStop?.();
        this.config.onFaceErrorStop?.("Camera unblocked or uncovered", frame, now);
      }

      // Grab hardware-accelerated bitmap and send to worker
      const imageBitmap = await createImageBitmap(this.videoElement);
      this.worker.postMessage(
        {
          command: "PROCESS_FRAME",
          imageData: imageBitmap,
          timestamp: now,
        },
        [imageBitmap],
      );
    } catch (err) {
      console.warn("[FacialDetector] Capture error:", err);
    }
  }

  _checkCameraBlocked() {
    if (!this.videoElement) return false;
    const w = 64; // downsampled for ultra-fast luminance check
    const h = 48;

    if (!this._scratchCanvas) {
      this._scratchCanvas = document.createElement("canvas");
      this._scratchCanvas.width = w;
      this._scratchCanvas.height = h;
    }

    const ctx = this._scratchCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;

    ctx.drawImage(this.videoElement, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    let sum = 0;
    const totalPixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }

    const avgLuminance = sum / totalPixels;
    return avgLuminance < (this.config.brightnessThreshold || 20);
  }

  async _captureSnapshotBlob() {
    if (!this.videoElement || typeof document === "undefined") {
      return new Blob([], { type: "image/jpeg" });
    }

    const w = this.videoElement.videoWidth || 640;
    const h = this.videoElement.videoHeight || 480;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");

    if (ctx) {
      if (this.config.mirrored !== false) {
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(this.videoElement, 0, 0, w, h);
      if (this.config.mirrored !== false) {
        ctx.restore();
      }
    }

    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob || new Blob([], { type: "image/jpeg" })),
        "image/jpeg",
        0.85,
      );
    });
  }

  /* ------------------------------------------------------------------ */
  /* Telemetry & State Transition Dispatch                              */
  /* ------------------------------------------------------------------ */

  async _handleWorkerMessage(e) {
    if (e.data.type !== "TELEMETRY") return;

    const data = e.data;
    const {
      facePresent,
      faceAwayFromScreen,
      eyeballsDisplaced,
      multipleFacesAlert,
      boundingBoxes = [],
      timestamp = Date.now(),
    } = data;

    // 1. Draw detection boxes on canvas overlay if canvas is provided
    if (this.canvasElement && this.videoElement) {
      this._drawBoundingBoxes(boundingBoxes);
    }

    // 2. Handle State Transitions and Emit Start/Stop Callbacks

    // [Event: No Face Detected]
    const noFaceDetected = !facePresent && !this._state.isCameraBlocked;
    if (noFaceDetected) {
      this._consecutiveNoFaceFrames++;
      if (this._consecutiveNoFaceFrames >= this.noFaceThreshold && !this._state.isNoFace) {
        this._state.isNoFace = true;
        const frame = await this._captureSnapshotBlob();
        this.config.onNoFaceDetected?.();
        this.config.onFaceError?.("No face detected", frame, timestamp);
      }
    } else {
      this._consecutiveNoFaceFrames = 0;
      if (this._state.isNoFace) {
        this._state.isNoFace = false;
        const frame = await this._captureSnapshotBlob();
        this.config.onNoFaceDetectedStop?.();
        this.config.onFaceErrorStop?.("Face detected again", frame, timestamp);
      }
    }

    // [Event: Multiple Faces Detected]
    if (multipleFacesAlert && !this._state.isMultiFace) {
      this._state.isMultiFace = true;
      const frame = await this._captureSnapshotBlob();
      this.config.onMultipleFaceDetected?.();
      this.config.onFaceError?.("Multiple faces detected", frame, timestamp);
    } else if (!multipleFacesAlert && this._state.isMultiFace) {
      this._state.isMultiFace = false;
      const frame = await this._captureSnapshotBlob();
      this.config.onMultipleFaceDetectedStop?.();
      this.config.onFaceErrorStop?.("Single face detected again", frame, timestamp);
    }

    // [Event: Face Away From Screen]
    if (faceAwayFromScreen && !this._state.isFaceAway) {
      this._state.isFaceAway = true;
      const frame = await this._captureSnapshotBlob();
      this.config.onFaceAwayFromScreen?.();
      this.config.onFaceError?.("Face is away from the screen", frame, timestamp);
    } else if (!faceAwayFromScreen && this._state.isFaceAway) {
      this._state.isFaceAway = false;
      const frame = await this._captureSnapshotBlob();
      this.config.onFaceAwayFromScreenStop?.();
      this.config.onFaceErrorStop?.("Face is back on screen", frame, timestamp);
    }

    // [Event: Eyeballs Displaced > 5s]
    if (eyeballsDisplaced && !this._state.isEyeballsDisplaced) {
      this._state.isEyeballsDisplaced = true;
      const frame = await this._captureSnapshotBlob();
      this.config.onEyeballsDisplaced?.();
      this.config.onFaceError?.("Eyeballs moved for more than 5 seconds", frame, timestamp);
    } else if (!eyeballsDisplaced && this._state.isEyeballsDisplaced) {
      this._state.isEyeballsDisplaced = false;
      const frame = await this._captureSnapshotBlob();
      this.config.onEyeballsDisplacedStop?.();
      this.config.onFaceErrorStop?.("Eyeballs are back to center", frame, timestamp);
    }

    // 3. Emit legacy/raw telemetry callback if subscribed
    if (typeof this.config.onTelemetryUpdate === "function") {
      this.config.onTelemetryUpdate(data);
    }
  }

  _drawBoundingBoxes(boxes) {
    if (!this.canvasElement || !this.videoElement) return;

    const width = this.videoElement.videoWidth || this.canvasElement.width || 640;
    const height = this.videoElement.videoHeight || this.canvasElement.height || 480;

    if (this.canvasElement.width !== width) this.canvasElement.width = width;
    if (this.canvasElement.height !== height) this.canvasElement.height = height;

    const ctx = this.canvasElement.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const shouldMirrorCanvas =
      this.config.canvasMirrored !== undefined
        ? this.config.canvasMirrored
        : this.config.mirrored !== false;

    if (shouldMirrorCanvas) {
      ctx.save();
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }

    ctx.strokeStyle = "#10b981"; // green proctoring border
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";

    for (const box of boxes) {
      const bx = box.x * width;
      const by = box.y * height;
      const bw = box.width * width;
      const bh = box.height * height;
      ctx.strokeRect(bx, by, bw, bh);
    }

    if (shouldMirrorCanvas) {
      ctx.restore();
    }
  }
}
