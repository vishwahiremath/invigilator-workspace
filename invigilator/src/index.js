/**
 * invigilator — AI Proctoring and Browser Monitoring SDK
 */

import { Invigilator } from "./invigilator-client.js";
import { BrowserMonitor } from "./browser-monitor.js";
import { FacialDetector } from "./facial-detector.js";

export { Invigilator, BrowserMonitor, FacialDetector };

/**
 * Utility: Checks if the companion proctoring extension is installed
 */
export function chromeExtensionExists() {
  if (typeof document === "undefined" || !document.body) return false;
  return (
    document.body.getAttribute("data-my-extension") === "installed" ||
    document.body.getAttribute("data-invigilator-extension") === "installed" ||
    window.__INVIGILATOR_EXTENSION_ACTIVE__ === true
  );
}

/**
 * Utility: Enumerates media input devices (cameras & microphones)
 */
export async function getDevices() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) {
    return { videoDevices: [], audioDevices: [] };
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter((d) => d.kind === "videoinput");
    const audioDevices = devices.filter((d) => d.kind === "audioinput");
    return { videoDevices, audioDevices };
  } catch (err) {
    console.warn("[Invigilator] Error enumerating devices:", err);
    return { videoDevices: [], audioDevices: [] };
  }
}

/**
 * Legacy InvigilatorEngine maintained for backward compatibility
 */
export class InvigilatorEngine {
  constructor(videoElement, canvasElement, onTelemetryUpdate, customConfig = {}) {
    this.video = videoElement;
    this.canvas = canvasElement;
    this.onTelemetryUpdate = onTelemetryUpdate;
    this.client = new Invigilator({
      ...customConfig,
      onTelemetryUpdate,
    });
  }

  async initialize() {
    await this.client.init();
    await this.client.facialDetector.initialize();
  }

  start() {
    this.client.startFaceTracking(this.video, this.canvas);
  }

  stop() {
    this.client.stopFacialTracking();
  }
}

export default Invigilator;
