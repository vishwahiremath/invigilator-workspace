/**
 * demo-app/main.js
 *
 * Wires up the Invigilator AI proctoring engine to the dashboard UI.
 * Reads runtime configuration from DOM inputs, requests webcam access,
 * and drives the telemetry display.
 */

import { InvigilatorEngine } from "@vishwahiremath/invigilator";

/* ---------- DOM refs ---------- */
const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const videoEl = document.getElementById("webcam");
const canvasEl = document.getElementById("frame-canvas");
const logContainer = document.getElementById("log-container");
const videoWrapper = document.getElementById("video-wrapper");

/* Badges */
const badgeFace = document.getElementById("badge-face");
const badgeHead = document.getElementById("badge-head");
const badgeEyes = document.getElementById("badge-eyes");
const badgeVertical = document.getElementById("badge-vertical");
const badgeMultiface = document.getElementById("badge-multiface");
const badgeCount = document.getElementById("badge-count");
const badgeAway = document.getElementById("badge-away");
const badgeCheating = document.getElementById("badge-cheating");

/* Config inputs */
const inputFacesLimit = document.getElementById("input-faces-limit");
const inputFastLoop = document.getElementById("input-fast-loop");
const inputSlowLoop = document.getElementById("input-slow-loop");
const inputAwayTimeout = document.getElementById("input-away-timeout");

/* ---------- State ---------- */
let engine = null;
let webcamStream = null;

/* ---------- Helpers ---------- */

function timestamp() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function appendLog(message, level = "info") {
  const colors = {
    info: "text-gray-500",
    good: "text-green-600",
    warn: "text-yellow-600",
    alert: "text-red-600",
  };

  const entry = document.createElement("div");
  entry.className = colors[level] || colors.info;
  entry.textContent = `[${timestamp()}] ${message}`;
  logContainer.appendChild(entry);

  /* Auto-scroll to bottom */
  logContainer.scrollTop = logContainer.scrollHeight;

  /* Cap at 200 entries */
  while (logContainer.children.length > 200) {
    logContainer.removeChild(logContainer.firstChild);
  }
}

/**
 * Apply a Tailwind colour set to a badge element.
 */
function setBadge(el, text, variant) {
  const styles = {
    idle: "bg-gray-100 text-gray-400",
    good: "bg-green-50 text-green-700",
    warn: "bg-yellow-50 text-yellow-700",
    alert: "bg-red-50 text-red-700 badge-pulse",
    info: "bg-blue-50 text-blue-700",
    neutral: "bg-purple-50 text-purple-700",
  };

  el.className = `status-badge inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[variant] || styles.idle}`;
  el.textContent = text;
}

/* ---------- Telemetry callback ---------- */

/** @type {string|null} Track last head pose to only log changes. */
let lastHeadPose = null;
let lastVerticalPose = null;
let lastEyeState = null;
let lastFacePresent = null;
let lastMultiFace = null;
let lastCheating = null;

function onTelemetry(data) {
  const {
    facePresent,
    eyesClosed,
    headPose,
    verticalHeadPose,
    facesCount,
    multipleFacesAlert,
    cheating,
    cheatingReason,
    awayDuration,
  } = data;

  /* ---- Face Present ---- */
  if (facePresent) {
    setBadge(badgeFace, "✓ Detected", "good");
  } else {
    setBadge(badgeFace, "✗ No Face", "alert");
  }
  if (facePresent !== lastFacePresent) {
    appendLog(
      facePresent ? "Face detected" : "Face lost — no face in frame",
      facePresent ? "good" : "alert",
    );
    lastFacePresent = facePresent;
  }

  /* ---- Head Pose ---- */
  if (facePresent) {
    const poseVariant = headPose === "CENTER" ? "good" : "warn";
    const poseLabel =
      headPose === "CENTER"
        ? "↑ Center"
        : headPose === "TURNED_LEFT"
          ? "← Turned Left"
          : "→ Turned Right";
    setBadge(badgeHead, poseLabel, poseVariant);

    if (headPose !== lastHeadPose) {
      appendLog(
        `Head pose → ${headPose}`,
        headPose === "CENTER" ? "good" : "warn",
      );
      lastHeadPose = headPose;
    }
  } else {
    setBadge(badgeHead, "— N/A —", "idle");
  }

  /* ---- Vertical Pose ---- */
  if (facePresent) {
    const vVariant = verticalHeadPose === "CENTER" ? "good" : "warn";
    const vLabel =
      verticalHeadPose === "CENTER"
        ? "— Center"
        : verticalHeadPose === "LOOKING_UP"
          ? "↑ Looking Up"
          : "↓ Looking Down";
    setBadge(badgeVertical, vLabel, vVariant);

    if (verticalHeadPose !== lastVerticalPose) {
      appendLog(
        `Vertical pose → ${verticalHeadPose}`,
        verticalHeadPose === "CENTER" ? "good" : "warn",
      );
      lastVerticalPose = verticalHeadPose;
    }
  } else {
    setBadge(badgeVertical, "— N/A —", "idle");
  }

  /* ---- Eyes ---- */
  if (facePresent) {
    if (eyesClosed) {
      setBadge(badgeEyes, "✗ Closed", "warn");
    } else {
      setBadge(badgeEyes, "✓ Open", "good");
    }
    const eyeState = eyesClosed ? "closed" : "open";
    if (eyeState !== lastEyeState) {
      appendLog(
        eyesClosed ? "Eyes closed detected" : "Eyes open",
        eyesClosed ? "warn" : "good",
      );
      lastEyeState = eyeState;
    }
  } else {
    setBadge(badgeEyes, "— N/A —", "idle");
  }

  /* ---- Multi-Face ---- */
  if (facesCount > 0) {
    if (multipleFacesAlert) {
      setBadge(badgeMultiface, "⚠ ALERT", "alert");
      videoWrapper.classList.add("alert");
    } else {
      setBadge(badgeMultiface, "✓ OK", "good");
      videoWrapper.classList.remove("alert");
    }
    setBadge(badgeCount, String(facesCount), facesCount > 1 ? "warn" : "info");

    if (multipleFacesAlert !== lastMultiFace) {
      if (multipleFacesAlert) {
        appendLog(`⚠ MULTIPLE FACES DETECTED (${facesCount})`, "alert");
      } else if (lastMultiFace !== null) {
        appendLog("Multi-face alert cleared", "good");
      }
      lastMultiFace = multipleFacesAlert;
    }
  }

  /* ---- Away Duration ---- */
  const awaySec = (awayDuration / 1000).toFixed(1);
  if (awayDuration > 0) {
    const awayVariant = awayDuration >= 3000 ? "warn" : "info";
    setBadge(badgeAway, `${awaySec}s`, awayVariant);
  } else {
    setBadge(badgeAway, "0s", "good");
  }

  /* ---- Cheating Flag ---- */
  if (cheating) {
    setBadge(badgeCheating, `⚠ CHEATING`, "alert");
    videoWrapper.classList.add("alert");
  } else {
    setBadge(badgeCheating, "✓ Clean", "good");
    if (!multipleFacesAlert) videoWrapper.classList.remove("alert");
  }
  if (cheating !== lastCheating) {
    if (cheating) {
      appendLog(`🚨 CHEATING DETECTED — ${cheatingReason}`, "alert");
    } else if (lastCheating !== null) {
      appendLog("Cheating flag cleared", "good");
    }
    lastCheating = cheating;
  }
}

/* ---------- Start ---------- */

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  startBtn.textContent = "Initializing…";

  /* 1. Parse runtime config from DOM inputs */
  const numFacesLimit = parseInt(inputFacesLimit.value, 10) || 1;
  const fastLoop = parseInt(inputFastLoop.value, 10) || 300;
  const slowLoop = parseInt(inputSlowLoop.value, 10) || 3000;
  const awayTimeout = (parseInt(inputAwayTimeout.value, 10) || 5) * 1000; // seconds → ms

  /* Clear log */
  logContainer.innerHTML = "";
  appendLog(
    `Config → faces: ${numFacesLimit}, fast: ${fastLoop}ms, slow: ${slowLoop}ms, away: ${awayTimeout / 1000}s`,
    "info",
  );

  /* 2. Request webcam */
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: true });
    videoEl.srcObject = webcamStream;
    await videoEl.play();
    appendLog("Webcam stream acquired", "good");
  } catch (err) {
    appendLog(`Webcam error: ${err.message}`, "alert");
    startBtn.disabled = false;
    startBtn.textContent = "Start Invigilator";
    return;
  }

  /* 3. Instantiate engine */
  engine = new InvigilatorEngine(videoEl, canvasEl, onTelemetry, {
    numFacesLimit,
    fastLoop,
    slowLoop,
    awayTimeout,
  });

  /* 4. Initialize (waits for worker READY) */
  try {
    appendLog("Loading MediaPipe models in Web Worker…", "info");
    await engine.initialize();
    appendLog("Worker ready — models loaded ✓", "good");
  } catch (err) {
    appendLog(`Engine init error: ${err.message}`, "alert");
    startBtn.disabled = false;
    startBtn.textContent = "Start Invigilator";
    return;
  }

  /* 5. Start frame capture */
  engine.start();
  appendLog("Invigilator started — proctoring active", "good");

  /* UI state */
  startBtn.classList.add("hidden");
  stopBtn.disabled = false;

  /* Lock config inputs */
  inputFacesLimit.disabled = true;
  inputFastLoop.disabled = true;
  inputSlowLoop.disabled = true;
  inputAwayTimeout.disabled = true;
});

/* ---------- Stop ---------- */

stopBtn.addEventListener("click", () => {
  if (engine) {
    engine.stop();
    engine = null;
  }

  /* Kill webcam tracks */
  if (webcamStream) {
    webcamStream.getTracks().forEach((track) => track.stop());
    webcamStream = null;
    videoEl.srcObject = null;
  }

  appendLog("Exam stopped — engine terminated", "warn");

  /* Reset badges */
  [
    badgeFace,
    badgeHead,
    badgeVertical,
    badgeEyes,
    badgeMultiface,
    badgeCheating,
  ].forEach((b) => setBadge(b, "— Idle —", "idle"));
  setBadge(badgeCount, "—", "idle");
  setBadge(badgeAway, "0s", "idle");

  /* Reset tracking state */
  lastHeadPose = null;
  lastVerticalPose = null;
  lastEyeState = null;
  lastFacePresent = null;
  lastMultiFace = null;
  lastCheating = null;

  /* Remove alert glow */
  videoWrapper.classList.remove("alert");

  /* UI state */
  startBtn.classList.remove("hidden");
  startBtn.disabled = false;
  startBtn.textContent = "▶ Start Invigilator";
  stopBtn.disabled = true;

  /* Unlock config inputs */
  inputFacesLimit.disabled = false;
  inputFastLoop.disabled = false;
  inputSlowLoop.disabled = false;
  inputAwayTimeout.disabled = false;
});
