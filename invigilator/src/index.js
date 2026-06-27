/**
 * InvigilatorEngine — Main Thread Bridge (Optimized)
 */

const DEFAULT_CONFIG = {
  numFacesLimit: 1,
  fastLoop: 300, // 300ms is ~3.3 FPS, highly efficient for invigilation
  slowLoop: 3000,
  awayTimeout: 5000,
};

export class InvigilatorEngine {
  /**
   * @param {HTMLVideoElement}  videoElement        - The live webcam <video>.
   * @param {HTMLCanvasElement} canvasElement        - A scratch <canvas> (reserved for future use).
   * @param {Function}          onTelemetryUpdate   - Callback receiving telemetry objects.
   * @param {Object}            [customConfig={}]   - Overrides for DEFAULT_CONFIG.
   */
  constructor(videoElement, canvasElement, onTelemetryUpdate, customConfig = {}) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.onTelemetryUpdate = onTelemetryUpdate;
    this.config = { ...DEFAULT_CONFIG, ...customConfig };

    this.worker = null;
    this.timerId = null;
    this.isCapturing = false;
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
        },
      });
    });
  }

  start() {
    if (this.isCapturing) return;
    this.isCapturing = true;

    // Recursive loop prevents overlapping frames if the browser lags
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
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Internals                                                         */
  /* ------------------------------------------------------------------ */

  async _captureAndSend() {
    if (!this.worker || this.video.readyState < 2) return;

    try {
      // 1. Directly grab a hardware-accelerated bitmap from the video (No Canvas Needed!)
      const imageBitmap = await createImageBitmap(this.video);

      // 2. Transfer ownership to the worker. The main thread immediately loses
      // access to the bitmap, resulting in zero memory copying.
      this.worker.postMessage(
        {
          command: "PROCESS_FRAME",
          imageData: imageBitmap,
          timestamp: Date.now(),
        },
        [imageBitmap],
      );
    } catch (err) {
      console.warn("[InvigilatorEngine] Capture error:", err);
    }
  }

  _handleWorkerMessage(e) {
    if (
      e.data.type === "TELEMETRY" &&
      typeof this.onTelemetryUpdate === "function"
    ) {
      this.onTelemetryUpdate(e.data);
    }
  }
}
