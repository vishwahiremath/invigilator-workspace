/**
 * demo-app/main.js
 *
 * Demonstrates the Invigilator SDK:
 * - Real-time face tracking with start/stop event callbacks
 * - Overlay canvas with green bounding boxes & visual mirroring
 * - Browser monitoring: clipboard blocking, fullscreen, mouse-out, tab visibility
 * - Native Multi-Screen detection (W3C Window Management API, ZERO extension needed)
 * - Browser extension bridge with built-in mock simulator & real extension support
 */

import { Invigilator, chromeExtensionExists } from "invigilator";

/* ---------- DOM References ---------- */
const startSdkBtn = document.getElementById("start-sdk-btn");
const stopSdkBtn = document.getElementById("stop-sdk-btn");
const videoEl = document.getElementById("webcam");
const canvasEl = document.getElementById("canvas-overlay");
const videoPlaceholder = document.getElementById("video-placeholder");
const videoWrapper = document.getElementById("video-wrapper");
const logContainer = document.getElementById("log-container");
const clearLogBtn = document.getElementById("clear-log-btn");

/* Badges */
const badgeStream = document.getElementById("badge-stream");
const badgeCameraBlocked = document.getElementById("badge-camera-blocked");
const badgeNoFace = document.getElementById("badge-no-face");
const badgeMultiFace = document.getElementById("badge-multi-face");
const badgeFaceAway = document.getElementById("badge-face-away");
const badgeEyeballs = document.getElementById("badge-eyeballs");
const badgeSnapshots = document.getElementById("badge-snapshots");
const badgeFullscreen = document.getElementById("badge-fullscreen");
const badgeClipboard = document.getElementById("badge-clipboard");
const badgeMouseout = document.getElementById("badge-mouseout");
const badgeVisibility = document.getElementById("badge-visibility");
const badgeExtensionStatus = document.getElementById("badge-extension-status");
const badgeNativeMultiscreen = document.getElementById("badge-native-multiscreen");

/* Browser Monitoring Buttons */
const btnEnterFullscreen = document.getElementById("btn-enter-fullscreen");
const btnExitFullscreen = document.getElementById("btn-exit-fullscreen");
const btnDisableClipboard = document.getElementById("btn-disable-clipboard");
const btnEnableClipboard = document.getElementById("btn-enable-clipboard");
const btnStartMouseout = document.getElementById("btn-start-mouseout");
const btnStopMouseout = document.getElementById("btn-stop-mouseout");
const btnStartVisibility = document.getElementById("btn-start-visibility");
const btnStopVisibility = document.getElementById("btn-stop-visibility");
const btnCheckNativeScreen = document.getElementById("btn-check-native-screen");
const btnMonitorNativeScreen = document.getElementById("btn-monitor-native-screen");

/* Extension Bridge Buttons & Toggle */
const mockExtensionToggle = document.getElementById("mock-extension-toggle");
const btnCloseTabs = document.getElementById("btn-close-tabs");
const btnLockdown = document.getElementById("btn-lockdown");
const btnMultiscreen = document.getElementById("btn-multiscreen");
const btnSnapshot = document.getElementById("btn-snapshot");
const btnDisableDevices = document.getElementById("btn-disable-devices");
const btnStopApps = document.getElementById("btn-stop-apps");

/* ---------- State ---------- */
let proctor = null;
let snapshotCount = 0;
let mouseOutCount = 0;
let visibilityChangeCount = 0;
let isAutoMonitoringScreens = false;

/* ---------- Logging & Badge Helpers ---------- */

function timestamp() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function appendLog(message, level = "info") {
  const colors = {
    info: "text-slate-500",
    good: "text-emerald-600 font-medium",
    warn: "text-amber-600 font-medium",
    alert: "text-red-600 font-bold",
  };

  const entry = document.createElement("div");
  entry.className = colors[level] || colors.info;
  entry.textContent = `[${timestamp()}] ${message}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;

  while (logContainer.children.length > 200) {
    logContainer.removeChild(logContainer.firstChild);
  }
}

function setBadge(el, text, variant) {
  if (!el) return;
  const styles = {
    idle: "bg-slate-100 text-slate-400",
    good: "bg-emerald-50 text-emerald-700 font-semibold",
    warn: "bg-amber-50 text-amber-700 font-semibold",
    alert: "bg-red-50 text-red-700 font-bold badge-pulse",
    active: "bg-blue-50 text-blue-700 font-semibold",
  };

  el.className = `inline-block px-2.5 py-0.5 rounded text-xs transition-colors ${
    styles[variant] || styles.idle
  }`;
  el.textContent = text;
}

clearLogBtn.addEventListener("click", () => {
  logContainer.innerHTML = "";
});

/* ---------- Extension Detection & Simulator Setup ---------- */

function updateExtensionStatus() {
  const hasRealExtension = Boolean(
    window.__INVIGILATOR_EXTENSION_ACTIVE__ ||
    document.body.getAttribute("data-invigilator-extension") === "installed"
  );

  if (hasRealExtension) {
    setBadge(badgeExtensionStatus, "🟢 Real Chrome Extension Detected", "good");
  } else if (mockExtensionToggle.checked) {
    setBadge(badgeExtensionStatus, "🟡 Mock Extension Simulator Active", "active");
  } else {
    setBadge(badgeExtensionStatus, "⚪ Not Detected", "idle");
  }
}

// Enable mock simulator by default so developer testing works out-of-the-box
mockExtensionToggle.checked = true;
document.body.setAttribute("data-my-extension", "installed");
window.__INVIGILATOR_MOCK_EXTENSION__ = true;
updateExtensionStatus();

mockExtensionToggle.addEventListener("change", (e) => {
  if (e.target.checked) {
    document.body.setAttribute("data-my-extension", "installed");
    window.__INVIGILATOR_MOCK_EXTENSION__ = true;
    appendLog("Mock extension simulator activated ✓", "good");
  } else {
    document.body.removeAttribute("data-my-extension");
    window.__INVIGILATOR_MOCK_EXTENSION__ = false;
    appendLog("Mock extension simulator deactivated", "info");
  }
  updateExtensionStatus();
});

setInterval(updateExtensionStatus, 1500);

/* ---------- SDK Instantiation & Event Handlers ---------- */

function createProctorInstance() {
  return new Invigilator({
    mirrored: true,
    mockExtension: mockExtensionToggle.checked,

    /* 1. Camera Blocked / Dark Room */
    onCameraBlocked: () => {
      setBadge(badgeCameraBlocked, "⚠ Blocked / Dark", "alert");
      videoWrapper.classList.add("alert");
      appendLog("🚨 Alert: Camera is covered or room is too dark!", "alert");
    },
    onCameraBlockedStop: () => {
      setBadge(badgeCameraBlocked, "✓ Normal", "good");
      videoWrapper.classList.remove("alert");
      appendLog("✓ Camera clear / room bright again.", "good");
    },

    /* 2. No Face Detected */
    onNoFaceDetected: () => {
      setBadge(badgeNoFace, "✗ No Face", "alert");
      videoWrapper.classList.add("alert");
      appendLog("🚨 Alert: No face detected in camera feed!", "alert");
    },
    onNoFaceDetectedStop: () => {
      setBadge(badgeNoFace, "✓ Detected", "good");
      videoWrapper.classList.remove("alert");
      appendLog("✓ Face detected again.", "good");
    },

    /* 3. Multiple Faces Detected */
    onMultipleFaceDetected: () => {
      setBadge(badgeMultiFace, "⚠ Multiple Faces", "alert");
      videoWrapper.classList.add("alert");
      appendLog("🚨 Alert: Multiple faces detected!", "alert");
    },
    onMultipleFaceDetectedStop: () => {
      setBadge(badgeMultiFace, "✓ Single Face", "good");
      videoWrapper.classList.remove("alert");
      appendLog("✓ Returned to single face.", "good");
    },

    /* 4. Face Away From Screen */
    onFaceAwayFromScreen: () => {
      setBadge(badgeFaceAway, "⚠ Looking Away", "warn");
      appendLog("⚠ Warning: Face turned away from screen.", "warn");
    },
    onFaceAwayFromScreenStop: () => {
      setBadge(badgeFaceAway, "✓ Centered", "good");
      appendLog("✓ Face returned to center.", "good");
    },

    /* 5. Eyeballs Displaced (>5s) */
    onEyeballsDisplaced: () => {
      setBadge(badgeEyeballs, "⚠ Gaze Away (>5s)", "warn");
      appendLog("⚠ Warning: Eyeballs looking away for 5+ seconds!", "warn");
    },
    onEyeballsDisplacedStop: () => {
      setBadge(badgeEyeballs, "✓ Centered", "good");
      appendLog("✓ Eyeballs back to center.", "good");
    },

    /* 6. Generic Error Snapshot Handler (delivers JPEG blob) */
    onFaceError: (message, frameBlob, time) => {
      snapshotCount++;
      setBadge(badgeSnapshots, `${snapshotCount} blobs`, "warn");
      appendLog(
        `📸 Snapshot captured [${frameBlob.size} bytes] — ${message}`,
        "alert",
      );
    },
    onFaceErrorStop: (message, frameBlob, time) => {
      appendLog(`✓ Cleared: ${message}`, "good");
    },

    /* 7. Multi-Screen & Extension Callbacks */
    onMultiScreenDetected: (data) => {
      setBadge(badgeNativeMultiscreen, "⚠ Multi-Screen Detected!", "alert");
      appendLog(
        `🖥️ Multi-screen detected (${data.method || "extension"}): ${data.screenCount || 2} displays active!`,
        "alert",
      );
    },
    onSnapshotTaken: (data) => {
      appendLog(`📷 OS device snapshot received successfully!`, "good");
    },
  });
}

/* ---------- Start / Stop Proctoring Lifecycle ---------- */

startSdkBtn.addEventListener("click", async () => {
  startSdkBtn.disabled = true;
  startSdkBtn.textContent = "Initializing…";

  try {
    proctor = createProctorInstance();

    appendLog("Initializing Invigilator SDK…", "info");
    await proctor.init();

    appendLog("Starting face tracking & loading vision models…", "info");
    await proctor.startFaceTracking(videoEl, canvasEl);

    // UI Updates
    videoPlaceholder.classList.add("hidden");
    setBadge(badgeStream, "Active (Streaming)", "good");
    appendLog("Proctoring session active ✓", "good");

    startSdkBtn.classList.add("hidden");
    stopSdkBtn.disabled = false;
  } catch (err) {
    appendLog(`Initialization error: ${err.message}`, "alert");
    startSdkBtn.disabled = false;
    startSdkBtn.textContent = "▶ Start Proctoring";
  }
});

stopSdkBtn.addEventListener("click", () => {
  if (proctor) {
    proctor.stopFacialTracking();
  }

  // Reset Badges
  setBadge(badgeStream, "Camera Inactive", "idle");
  [
    badgeCameraBlocked,
    badgeNoFace,
    badgeMultiFace,
    badgeFaceAway,
    badgeEyeballs,
  ].forEach((b) => setBadge(b, "idle", "idle"));

  videoWrapper.classList.remove("alert");
  videoPlaceholder.classList.remove("hidden");

  startSdkBtn.classList.remove("hidden");
  startSdkBtn.disabled = false;
  startSdkBtn.textContent = "▶ Start Proctoring";
  stopSdkBtn.disabled = true;

  appendLog("Proctoring session stopped.", "info");
});

/* ---------- Browser Monitoring Controls ---------- */

// Fullscreen
btnEnterFullscreen.addEventListener("click", async () => {
  if (!proctor) proctor = createProctorInstance();
  try {
    await proctor.openFullscreen();
    appendLog("Fullscreen requested", "good");
  } catch (err) {
    appendLog(`Fullscreen error: ${err.message}`, "alert");
  }
});

btnExitFullscreen.addEventListener("click", async () => {
  if (!proctor) proctor = createProctorInstance();
  try {
    await proctor.closeFullscreen();
    appendLog("Exited fullscreen", "info");
  } catch (err) {
    appendLog(`Exit fullscreen error: ${err.message}`, "alert");
  }
});

document.addEventListener("fullscreenchange", () => {
  const isFs = Boolean(document.fullscreenElement);
  setBadge(badgeFullscreen, isFs ? "Fullscreen Active" : "Windowed", isFs ? "active" : "idle");
  appendLog(`Fullscreen change: ${isFs ? "Entered" : "Exited"}`, isFs ? "good" : "info");
});

// Copy / Paste Lockdown
btnDisableClipboard.addEventListener("click", async () => {
  if (!proctor) proctor = createProctorInstance();
  await proctor.disableCopyAndPaste();
  proctor.disableRightClick();
  setBadge(badgeClipboard, "Locked (Blocked)", "alert");
  appendLog("🔒 Clipboard copy/cut/paste and right-click disabled", "warn");
});

btnEnableClipboard.addEventListener("click", async () => {
  if (!proctor) proctor = createProctorInstance();
  await proctor.enableCopyAndPaste();
  proctor.enableRightClick();
  setBadge(badgeClipboard, "Allowed", "good");
  appendLog("✓ Clipboard copy/cut/paste and right-click enabled", "good");
});

// Mouse Out Detection
const handleMouseOut = () => {
  mouseOutCount++;
  setBadge(badgeMouseout, `${mouseOutCount} events`, "warn");
  appendLog("🚨 Suspicious: Mouse cursor left the browser window!", "warn");
};

btnStartMouseout.addEventListener("click", () => {
  if (!proctor) proctor = createProctorInstance();
  proctor.startMouseOutDetection(handleMouseOut);
  appendLog("Mouse-out detection started", "info");
});

btnStopMouseout.addEventListener("click", () => {
  if (proctor) {
    proctor.stopMouseOutDetection(handleMouseOut);
    appendLog("Mouse-out detection stopped", "info");
  }
});

// Visibility / Tab Change Detection
const handleVisibility = () => {
  if (document.hidden) {
    visibilityChangeCount++;
    setBadge(badgeVisibility, `${visibilityChangeCount} switches`, "alert");
    appendLog("🚨 Violation: Exam tab was hidden or user switched tabs!", "alert");
  } else {
    appendLog("Tab returned to focus", "good");
  }
};

btnStartVisibility.addEventListener("click", () => {
  if (!proctor) proctor = createProctorInstance();
  proctor.startVisibilityChangeDetection(handleVisibility);
  appendLog("Visibility change / tab switch detection started", "info");
});

btnStopVisibility.addEventListener("click", () => {
  if (proctor) {
    proctor.stopVisibilityChangeDetection(handleVisibility);
    appendLog("Visibility detection stopped", "info");
  }
});

/* ---------- Native Multi-Screen Detection (NO EXTENSION) ---------- */

btnCheckNativeScreen.addEventListener("click", async () => {
  if (!proctor) proctor = createProctorInstance();
  appendLog("Checking displays using native W3C Window Management API…", "info");
  const res = await proctor.checkMultiScreenDetection();

  if (res.isExtended) {
    setBadge(badgeNativeMultiscreen, `⚠ Multi-Screen (${res.screenCount} screens)`, "alert");
    appendLog(`🚨 Violation: Multiple displays detected via ${res.method}! Screen count: ${res.screenCount}`, "alert");
  } else {
    setBadge(badgeNativeMultiscreen, "✓ Single Screen (OK)", "good");
    appendLog(`✓ Single monitor confirmed via ${res.method}.`, "good");
  }
});

btnMonitorNativeScreen.addEventListener("click", () => {
  if (!proctor) proctor = createProctorInstance();

  if (!isAutoMonitoringScreens) {
    isAutoMonitoringScreens = true;
    btnMonitorNativeScreen.textContent = "Stop Auto-Monitoring";
    btnMonitorNativeScreen.classList.add("bg-amber-100", "text-amber-800");

    proctor.startMultiScreenMonitoring((res) => {
      setBadge(badgeNativeMultiscreen, "⚠ Multi-Screen Plugged In!", "alert");
      appendLog(`🚨 Screen connect event detected! Displays extended via ${res.method}`, "alert");
    });
    appendLog("Auto-monitoring screen connect/disconnect events active ✓", "good");
  } else {
    isAutoMonitoringScreens = false;
    btnMonitorNativeScreen.textContent = "Auto-Monitor Plug/Unplug";
    btnMonitorNativeScreen.classList.remove("bg-amber-100", "text-amber-800");
    proctor.stopMultiScreenMonitoring();
    appendLog("Screen auto-monitoring stopped.", "info");
  }
});

/* ---------- Extension Bridge Testing & Mock Simulator ---------- */

// Mock extension message responder for local testing
window.addEventListener("message", (event) => {
  if (!event.data || typeof event.data !== "object") return;
  const { type } = event.data;

  // Only simulate if real extension is not active and mock mode is on
  if (!window.__INVIGILATOR_EXTENSION_ACTIVE__ && mockExtensionToggle.checked) {
    if (type === "CHECK_MULTI_SCREEN") {
      setTimeout(() => {
        window.postMessage(
          {
            type: "MULTI_SCREEN_DETECTED",
            data: { screenCount: 2, displays: ["Built-in Display", "External HDMI Monitor"] },
          },
          "*",
        );
      }, 150);
    } else if (type === "TAKE_SNAPSHOT") {
      setTimeout(() => {
        window.postMessage(
          {
            type: "SNAPSHOT_TAKEN",
            data: { timestamp: Date.now(), status: "captured" },
          },
          "*",
        );
      }, 150);
    } else if (
      [
        "CLOSE_TABS",
        "ENABLE_LOCKDOWN",
        "DISABLE_EXTERNAL_DEVICES",
        "STOP_BACKGROUND_APPS",
        "DISABLE_RIGHT_CLICK_CLIPBOARD",
      ].includes(type)
    ) {
      appendLog(`[Mock Extension] Handled command: ${type}`, "good");
    }
  }
});

function wrapExtensionAction(name, action) {
  if (!proctor) proctor = createProctorInstance();
  try {
    action();
    appendLog(`Extension bridge dispatched: ${name}`, "info");
  } catch (err) {
    appendLog(`Extension error: ${err.message}`, "alert");
  }
}

btnCloseTabs.addEventListener("click", () =>
  wrapExtensionAction("closeOtherTabs()", () => proctor.closeOtherTabs()),
);
btnLockdown.addEventListener("click", () =>
  wrapExtensionAction("enableLockdownMode()", () => proctor.enableLockdownMode()),
);
btnMultiscreen.addEventListener("click", () =>
  wrapExtensionAction("checkMultiScreenDetection()", () =>
    proctor.checkMultiScreenDetection(),
  ),
);
btnSnapshot.addEventListener("click", () =>
  wrapExtensionAction("takeDeviceSnapshot()", () => proctor.takeDeviceSnapshot()),
);
btnDisableDevices.addEventListener("click", () =>
  wrapExtensionAction("disableExternalDevices()", () =>
    proctor.disableExternalDevices(),
  ),
);
btnStopApps.addEventListener("click", () =>
  wrapExtensionAction("stopBackgroundApps()", () => proctor.stopBackgroundApps()),
);
