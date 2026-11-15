/**
 * content.js — Injected into authorized web pages to bridge window.postMessage with the extension background worker
 */

// 1. Mark extension as installed on the DOM
function markInstalled() {
  if (document.body) {
    document.body.setAttribute("data-my-extension", "installed");
    document.body.setAttribute("data-invigilator-extension", "installed");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", markInstalled);
} else {
  markInstalled();
}

window.__INVIGILATOR_EXTENSION_ACTIVE__ = true;

// 2. Listen to commands dispatched from the webpage via window.postMessage
window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || typeof event.data !== "object") return;
  const { type, data } = event.data;

  const supportedCommands = [
    "ENABLE_EXTENSION",
    "DISABLE_EXTENSION",
    "CLOSE_TABS",
    "ENABLE_LOCKDOWN",
    "CHECK_MULTI_SCREEN",
    "TAKE_SNAPSHOT",
    "DISABLE_EXTERNAL_DEVICES",
    "STOP_BACKGROUND_APPS",
    "DISABLE_RIGHT_CLICK_CLIPBOARD",
  ];

  if (supportedCommands.includes(type)) {
    chrome.runtime.sendMessage({ type, data }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("[Invigilator Extension]", chrome.runtime.lastError.message);
        return;
      }
      if (response && response.type) {
        window.postMessage(response, "*");
      }
    });
  }
});

// 3. Listen for push messages from the background service worker
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type) {
    window.postMessage(message, "*");
  }
});
