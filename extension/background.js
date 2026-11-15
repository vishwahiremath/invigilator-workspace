/**
 * background.js — Manifest V3 service worker for the Invigilator extension
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { type, data } = request;

  switch (type) {
    case "ENABLE_EXTENSION":
      sendResponse({ type: "EXTENSION_ENABLED", status: "ok" });
      break;

    case "DISABLE_EXTENSION":
      sendResponse({ type: "EXTENSION_DISABLED", status: "ok" });
      break;

    case "CLOSE_TABS":
      if (sender.tab && sender.tab.windowId) {
        chrome.tabs.query({ windowId: sender.tab.windowId }, (tabs) => {
          const tabIdsToClose = tabs
            .filter((t) => t.id !== sender.tab.id && t.id)
            .map((t) => t.id);

          if (tabIdsToClose.length > 0) {
            chrome.tabs.remove(tabIdsToClose, () => {
              sendResponse({
                type: "TABS_CLOSED",
                count: tabIdsToClose.length,
              });
            });
          } else {
            sendResponse({ type: "TABS_CLOSED", count: 0 });
          }
        });
        return true; // async sendResponse
      }
      break;

    case "CHECK_MULTI_SCREEN":
      if (chrome.system && chrome.system.display) {
        chrome.system.display.getInfo((displays) => {
          sendResponse({
            type: "MULTI_SCREEN_DETECTED",
            data: {
              screenCount: displays.length,
              displays: displays.map((d) => ({
                id: d.id,
                name: d.name,
                isPrimary: d.isPrimary,
                bounds: d.bounds,
              })),
            },
          });
        });
        return true; // async
      } else {
        sendResponse({
          type: "MULTI_SCREEN_DETECTED",
          data: { screenCount: 1 },
        });
      }
      break;

    case "TAKE_SNAPSHOT":
      chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 80 }, (dataUrl) => {
        sendResponse({
          type: "SNAPSHOT_TAKEN",
          data: {
            imageUri: dataUrl,
            timestamp: Date.now(),
          },
        });
      });
      return true; // async

    case "ENABLE_LOCKDOWN":
      if (sender.tab && sender.tab.windowId) {
        chrome.windows.update(sender.tab.windowId, { state: "fullscreen" }, () => {
          sendResponse({ type: "LOCKDOWN_ENABLED", status: "ok" });
        });
        return true;
      }
      break;

    case "DISABLE_RIGHT_CLICK_CLIPBOARD":
      sendResponse({ type: "RIGHT_CLICK_CLIPBOARD_DISABLED", status: "ok" });
      break;

    case "DISABLE_EXTERNAL_DEVICES":
      sendResponse({ type: "EXTERNAL_DEVICES_DISABLED", status: "ok" });
      break;

    case "STOP_BACKGROUND_APPS":
      sendResponse({ type: "BACKGROUND_APPS_STOPPED", status: "ok" });
      break;

    default:
      sendResponse({ type: "UNKNOWN_COMMAND", received: type });
  }
});
