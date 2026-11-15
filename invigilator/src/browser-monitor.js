/**
 * browser-monitor.js — In-browser lockdown, native multi-screen detection, and extension bridge
 */

export class BrowserMonitor {
  constructor(config = {}) {
    this.config = config;
    this._copyPasteHandler = this._handleCopyAndPaste.bind(this);
    this._contextMenuHandler = this._handleContextMenu.bind(this);
    this._extensionMessageHandler = this._handleExtensionMessage.bind(this);
    this._isExtensionListening = false;
    this._screenMonitorInterval = null;
    this._screenChangeHandler = null;

    this.setupExtensionListener();
  }

  /* ------------------------------------------------------------------ */
  /* Clipboard & Context Menu Restrictions                               */
  /* ------------------------------------------------------------------ */

  _handleCopyAndPaste(event) {
    event.preventDefault();
    if (event.clipboardData && event.type === "copy") {
      event.clipboardData.setData("text/plain", "");
    }
  }

  _handleContextMenu(event) {
    event.preventDefault();
  }

  async disableCopyAndPaste() {
    if (typeof document === "undefined") return;
    document.addEventListener("copy", this._copyPasteHandler, true);
    document.addEventListener("cut", this._copyPasteHandler, true);
    document.addEventListener("paste", this._copyPasteHandler, true);
  }

  async enableCopyAndPaste() {
    if (typeof document === "undefined") return;
    document.removeEventListener("copy", this._copyPasteHandler, true);
    document.removeEventListener("cut", this._copyPasteHandler, true);
    document.removeEventListener("paste", this._copyPasteHandler, true);
  }

  disableRightClick() {
    if (typeof document === "undefined") return;
    document.addEventListener("contextmenu", this._contextMenuHandler, true);
  }

  enableRightClick() {
    if (typeof document === "undefined") return;
    document.removeEventListener("contextmenu", this._contextMenuHandler, true);
  }

  /* ------------------------------------------------------------------ */
  /* Fullscreen Enforcement                                             */
  /* ------------------------------------------------------------------ */

  async openFullscreen(element) {
    if (typeof document === "undefined") return;
    const target = element || document.documentElement;

    if (target.requestFullscreen) {
      await target.requestFullscreen();
    } else if (target.webkitRequestFullscreen) {
      await target.webkitRequestFullscreen();
    } else if (target.mozRequestFullScreen) {
      await target.mozRequestFullScreen();
    } else if (target.msRequestFullscreen) {
      await target.msRequestFullscreen();
    }
  }

  async closeFullscreen() {
    if (typeof document === "undefined") return;

    if (
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.mozFullScreenElement ||
      document.msFullscreenElement
    ) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        await document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        await document.msExitFullscreen();
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Window Focus / Mouse Out / Visibility Detection                    */
  /* ------------------------------------------------------------------ */

  startMouseOutDetection(callback) {
    if (typeof document === "undefined" || typeof callback !== "function") return;
    document.documentElement.addEventListener("mouseleave", callback);
  }

  stopMouseOutDetection(callback) {
    if (typeof document === "undefined" || typeof callback !== "function") return;
    document.documentElement.removeEventListener("mouseleave", callback);
  }

  startVisibilityChangeDetection(callback) {
    if (typeof document === "undefined" || typeof callback !== "function") return;
    document.addEventListener("visibilitychange", callback);
  }

  stopVisibilityChangeDetection(callback) {
    if (typeof document === "undefined" || typeof callback !== "function") return;
    document.removeEventListener("visibilitychange", callback);
  }

  /* ------------------------------------------------------------------ */
  /* Multi-Screen Detection (Native Web API + Extension Hybrid)         */
  /* ------------------------------------------------------------------ */

  /**
   * Detects whether the user has multiple monitors connected.
   * Uses the native W3C Window Management API (window.screen.isExtended) first (NO extension needed).
   * Falls back to the extension bridge if available.
   *
   * @returns {Promise<{ isExtended: boolean, screenCount: number, method: string }>}
   */
  async checkMultiScreenDetection() {
    if (typeof window !== "undefined" && typeof window.screen !== "undefined") {
      // 1. Native Check: window.screen.isExtended (Synchronous, zero-permission, Chrome 100+ & Edge 100+)
      if ("isExtended" in window.screen) {
        const isExtended = Boolean(window.screen.isExtended);
        if (isExtended) {
          const result = {
            screenCount: 2,
            isExtended: true,
            method: "native-isExtended",
          };
          this.config.onMultiScreenDetected?.(result);
          return result;
        }
      }

      // 2. Native Check: Display offset heuristic (window positioned on secondary monitor)
      if (
        (window.screen.availLeft && window.screen.availLeft !== 0) ||
        (window.screen.availTop && window.screen.availTop !== 0)
      ) {
        const result = {
          screenCount: 2,
          isExtended: true,
          method: "native-coordinate-offset",
        };
        this.config.onMultiScreenDetected?.(result);
        return result;
      }

      // 3. Native Check: window.getScreenDetails() if available
      if ("getScreenDetails" in window) {
        try {
          const details = await window.getScreenDetails();
          if (details && details.screens && details.screens.length > 1) {
            const result = {
              screenCount: details.screens.length,
              displays: details.screens.map((s, i) => ({
                id: i,
                isPrimary: s.isPrimary,
                width: s.width,
                height: s.height,
              })),
              isExtended: true,
              method: "native-getScreenDetails",
            };
            this.config.onMultiScreenDetected?.(result);
            return result;
          }
        } catch (_) {
          // Permission not granted or user dismissed
        }
      }
    }

    // 4. Extension Bridge Fallback (if companion extension is present)
    if (this.isExtensionInstalled()) {
      window.postMessage({ type: "CHECK_MULTI_SCREEN" }, "*");
      return { isExtended: false, screenCount: 1, method: "extension-query" };
    }

    // 5. Single screen confirmed
    const singleScreenResult = {
      screenCount: 1,
      isExtended: false,
      method: "native-single-screen",
    };
    return singleScreenResult;
  }

  /**
   * Starts continuously monitoring for external monitor plug/unplug events in real time.
   *
   * @param {Function} [callback] - Invoked when a secondary screen is detected
   */
  startMultiScreenMonitoring(callback) {
    if (typeof window === "undefined" || typeof window.screen === "undefined") return;

    const check = async () => {
      const res = await this.checkMultiScreenDetection();
      if (res.isExtended) {
        callback?.(res);
      }
    };

    if ("addEventListener" in window.screen) {
      this._screenChangeHandler = check;
      window.screen.addEventListener("change", this._screenChangeHandler);
    }

    this._screenMonitorInterval = setInterval(check, 3000);
  }

  stopMultiScreenMonitoring() {
    if (this._screenMonitorInterval) {
      clearInterval(this._screenMonitorInterval);
      this._screenMonitorInterval = null;
    }
    if (
      this._screenChangeHandler &&
      typeof window !== "undefined" &&
      window.screen &&
      "removeEventListener" in window.screen
    ) {
      window.screen.removeEventListener("change", this._screenChangeHandler);
      this._screenChangeHandler = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Browser Extension Bridge                                           */
  /* ------------------------------------------------------------------ */

  isExtensionInstalled() {
    if (typeof document === "undefined") return false;

    if (this.config.mockExtension === true || window.__INVIGILATOR_MOCK_EXTENSION__ === true) {
      return true;
    }

    if (!document.body) return false;

    return (
      document.body.getAttribute("data-my-extension") === "installed" ||
      document.body.getAttribute("data-invigilator-extension") === "installed" ||
      window.__INVIGILATOR_EXTENSION_ACTIVE__ === true
    );
  }

  _checkExtension() {
    if (!this.isExtensionInstalled()) {
      throw new Error(
        "Proctoring extension not detected. Please install the required browser extension to continue."
      );
    }
  }

  setupExtensionListener() {
    if (typeof window === "undefined" || this._isExtensionListening) return;
    window.addEventListener("message", this._extensionMessageHandler);
    this._isExtensionListening = true;
  }

  _handleExtensionMessage(event) {
    if (!event.data || typeof event.data !== "object") return;
    const { type, data } = event.data;

    switch (type) {
      case "MULTI_SCREEN_DETECTED":
        this.config.onMultiScreenDetected?.(data);
        break;
      case "SNAPSHOT_TAKEN":
        this.config.onSnapshotTaken?.(data);
        break;
    }
  }

  enableProctoringExtension() {
    this._checkExtension();
    window.postMessage({ type: "ENABLE_EXTENSION" }, "*");
  }

  disableProctoringExtension() {
    window.postMessage({ type: "DISABLE_EXTENSION" }, "*");
  }

  enableLockdownMode() {
    this._checkExtension();
    window.postMessage({ type: "ENABLE_LOCKDOWN" }, "*");
  }

  takeDeviceSnapshot() {
    this._checkExtension();
    window.postMessage({ type: "TAKE_SNAPSHOT" }, "*");
  }

  disableExternalDevices() {
    this._checkExtension();
    window.postMessage({ type: "DISABLE_EXTERNAL_DEVICES" }, "*");
  }

  stopBackgroundApps() {
    this._checkExtension();
    window.postMessage({ type: "STOP_BACKGROUND_APPS" }, "*");
  }

  closeOtherTabs() {
    this._checkExtension();
    window.postMessage({ type: "CLOSE_TABS" }, "*");
  }

  disableRightClickAndClipboard() {
    this._checkExtension();
    window.postMessage({ type: "DISABLE_RIGHT_CLICK_CLIPBOARD" }, "*");
  }

  cleanup() {
    this.enableCopyAndPaste();
    this.enableRightClick();
    this.stopMultiScreenMonitoring();
    if (typeof window !== "undefined" && this._isExtensionListening) {
      window.removeEventListener("message", this._extensionMessageHandler);
      this._isExtensionListening = false;
    }
  }
}
