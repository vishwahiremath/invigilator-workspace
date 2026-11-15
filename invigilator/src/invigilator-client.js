/**
 * invigilator-client.js — Main Invigilator SDK client
 */

import { BrowserMonitor } from "./browser-monitor.js";
import { FacialDetector } from "./facial-detector.js";

const DEFAULT_SCHOOL_FEATURES = {
  orgId: "local-org",
  orgName: "Invigilator Standalone",
  publicKey: "invigilator-local-key",
  digitalProctoring: true,
  deviceSnapshot: true,
  assessmentFrameBoundary: true,
  fullScreenMode: true,
  closeOpenTabs: true,
  disableClipboardPrinting: true,
  disableCopyAndPaste: true,
  onlyOneScreen: true,
  eyesAndFaceTracking: true,
  soundTracking: false,
  lockdownApp: true,
  disableExternalDevices: true,
  stopAllBackgroundApps: true,
  realTimeViewingEnabled: false,
  screenSharingEnabled: false,
  saveRealTimeViewing: false,
  canSchoolDoLiveProctoring: false,
  canSchoolDoScreenSharing: false,
  canSchoolSaveLiveProctoring: false,
};

export class Invigilator {
  /**
   * @param {Object} [config={}] - Proctoring configuration and callbacks
   */
  constructor(config = {}) {
    this.config = {
      mirrored: true,
      ...config,
    };

    this.schoolFeatures = {
      ...DEFAULT_SCHOOL_FEATURES,
      ...this.config.features,
    };

    this._isInitialized = false;

    // Sub-modules
    this.browserMonitor = new BrowserMonitor(this.config);
    this.facialDetector = new FacialDetector(this.config);
  }

  /* ------------------------------------------------------------------ */
  /* Initialization & Feature Discovery                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Initializes the SDK. Keyless by default — enables all features immediately.
   * @returns {Promise<void>}
   */
  async init() {
    this._isInitialized = true;
    return Promise.resolve();
  }

  /**
   * Returns true if init() has completed.
   * @returns {boolean}
   */
  isInitialized() {
    return this._isInitialized;
  }

  /**
   * Returns the organization's feature configuration.
   * @returns {Object}
   */
  getProctoringFeatures() {
    return this.schoolFeatures;
  }

  _checkIsInitialized() {
    if (!this._isInitialized) {
      this._isInitialized = true;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Facial Tracking                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Starts real-time facial detection on the video element.
   * Automatically requests camera access if not already streaming.
   *
   * @param {HTMLVideoElement}  videoElement  - The video element to display camera feed.
   * @param {HTMLCanvasElement} [canvasElement] - Optional overlay canvas for green face boxes.
   * @returns {Promise<void>}
   */
  async startFaceTracking(videoElement, canvasElement) {
    this._checkIsInitialized();

    if (!videoElement) {
      throw new Error("Invigilator: A valid HTMLVideoElement is required for startFaceTracking.");
    }

    await this.facialDetector.start(videoElement, canvasElement);
  }

  /**
   * Stops facial tracking, releases webcam resources and terminates the worker.
   */
  stopFacialTracking() {
    this.facialDetector.stop();
  }

  /* ------------------------------------------------------------------ */
  /* Browser Monitoring (Direct DOM API)                                */
  /* ------------------------------------------------------------------ */

  async disableCopyAndPaste() {
    return this.browserMonitor.disableCopyAndPaste();
  }

  async enableCopyAndPaste() {
    return this.browserMonitor.enableCopyAndPaste();
  }

  disableRightClick() {
    this.browserMonitor.disableRightClick();
  }

  enableRightClick() {
    this.browserMonitor.enableRightClick();
  }

  async openFullscreen(element) {
    return this.browserMonitor.openFullscreen(element);
  }

  async closeFullscreen() {
    return this.browserMonitor.closeFullscreen();
  }

  startMouseOutDetection(callback) {
    this.browserMonitor.startMouseOutDetection(callback);
  }

  stopMouseOutDetection(callback) {
    this.browserMonitor.stopMouseOutDetection(callback);
  }

  startVisibilityChangeDetection(callback) {
    this.browserMonitor.startVisibilityChangeDetection(callback);
  }

  stopVisibilityChangeDetection(callback) {
    this.browserMonitor.stopVisibilityChangeDetection(callback);
  }

  /**
   * Checks for multiple connected monitors natively using W3C Window Management API
   * (window.screen.isExtended) with zero permissions required, and falls back to extension bridge.
   *
   * @returns {Promise<{ isExtended: boolean, screenCount: number, method: string }>}
   */
  async checkMultiScreenDetection() {
    return this.browserMonitor.checkMultiScreenDetection();
  }

  /**
   * Starts monitoring for display connects/disconnects in real time.
   */
  startMultiScreenMonitoring(callback) {
    this.browserMonitor.startMultiScreenMonitoring(callback);
  }

  stopMultiScreenMonitoring() {
    this.browserMonitor.stopMultiScreenMonitoring();
  }

  /* ------------------------------------------------------------------ */
  /* Browser Extension Bridge                                           */
  /* ------------------------------------------------------------------ */

  isExtensionInstalled() {
    return this.browserMonitor.isExtensionInstalled();
  }

  enableProctoringExtension() {
    this.browserMonitor.enableProctoringExtension();
  }

  disableProctoringExtension() {
    this.browserMonitor.disableProctoringExtension();
  }

  enableLockdownMode() {
    this.browserMonitor.enableLockdownMode();
  }

  takeDeviceSnapshot() {
    this.browserMonitor.takeDeviceSnapshot();
  }

  disableExternalDevices() {
    this.browserMonitor.disableExternalDevices();
  }

  stopBackgroundApps() {
    this.browserMonitor.stopBackgroundApps();
  }

  closeOtherTabs() {
    this.browserMonitor.closeOtherTabs();
  }

  disableRightClickAndClipboard() {
    this.browserMonitor.disableRightClickAndClipboard();
  }

  /* ------------------------------------------------------------------ */
  /* Cleanup                                                           */
  /* ------------------------------------------------------------------ */

  destroy() {
    this.stopFacialTracking();
    this.browserMonitor.cleanup();
  }
}
