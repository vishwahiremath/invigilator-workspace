# Invigilator Proctoring SDK

A client-side browser proctoring SDK for real-time face tracking, gaze monitoring, native multi-screen detection, and browser lockdown.

[![npm version](https://img.shields.io/npm/v/invigilator.svg)](https://www.npmjs.com/package/invigilator)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Framework Examples](#framework-examples)
  - [Next.js (App & Pages Router)](#nextjs-app--pages-router)
  - [React](#react)
  - [Vue 3](#vue-3)
  - [Angular](#angular)
- [Visual Feedback & Mirroring](#visual-feedback--mirroring)
  - [Canvas Mirroring Note](#canvas-mirroring-note)
- [Next.js & Webpack 5 Compatibility](#nextjs--webpack-5-compatibility)
  - [Self-Hosting MediaPipe Assets (Offline / Firewalls)](#self-hosting-mediapipe-assets-offline--firewalls)
  - [Violation Smoothing & Debounce](#violation-smoothing--debounce)
- [API Reference](#api-reference)
  - [Initialization](#initialization)
  - [Face Tracking](#face-tracking)
  - [Multi-Screen Detection (Native)](#multi-screen-detection-native)
  - [Browser Monitoring (Direct DOM)](#browser-monitoring-direct-dom)
  - [Browser Extension Bridge (Optional Tier 2)](#browser-extension-bridge-optional-tier-2)
  - [Utilities](#utilities)
- [Configuration](#configuration)
- [TypeScript Types](#typescript-types)
- [Browser Support](#browser-support)
- [License](#license)

---

## Features

- 🎯 **Face Tracking & Head Pose** — Detects missing faces, multiple faces, camera obstruction/dark room, head turned away, and eye gaze displacement using Google MediaPipe in a Web Worker.
- 📸 **Automatic Snapshot Generation** — Instantly captures and delivers compressed JPEG snapshot `Blob`s on any detected violation via `onFaceError`.
- 🖥️ **Native Multi-Screen Detection** — Detects secondary monitors, projectors, or extended displays natively via the W3C Window Management API (`window.screen.isExtended`) with **zero extensions or permission prompts required**.
- 🔒 **Browser Lockdown** — Fullscreen enforcement, clipboard blocking (`copy`, `cut`, `paste`), right-click disabling, mouse-out detection, and tab visibility/blur monitoring.
- 🧩 **Extension Bridge (Optional)** — Ready-to-use bridge for deep OS-level restrictions like closing other browser tabs, OS lockdown, and full desktop screenshots (requires companion extension).
- 🚀 **100% Client-Side & Keyless** — No API key or remote server required. Works out-of-the-box upon `npm install`.

---

## Installation

```bash
npm install invigilator
```

### Peer Dependencies

The core ML models (MediaPipe Tasks Vision and BlazeFace) are loaded dynamically inside a background Web Worker via high-speed CDN. No additional peer dependencies are required.

---

## Quick Start

```typescript
import { Invigilator } from "invigilator";

// 1. Create a proctoring client with callbacks
const proctor = new Invigilator({
  mirrored: true, // Aligns detection boxes and eye tracking with mirrored webcam

  // Start & stop event callbacks
  onCameraBlocked: () => console.warn("Camera blocked or dark room!"),
  onCameraBlockedStop: () => console.log("Camera unblocked."),
  onNoFaceDetected: () => console.warn("No face detected!"),
  onNoFaceDetectedStop: () => console.log("Face detected again."),
  onMultipleFaceDetected: () => console.warn("Multiple faces detected!"),
  onMultipleFaceDetectedStop: () => console.log("Returned to single face."),
  onFaceAwayFromScreen: () => console.warn("Face turned away from screen!"),
  onFaceAwayFromScreenStop: () => console.log("Face returned to center."),
  onEyeballsDisplaced: () => console.warn("Eyes looking away for > 5 seconds!"),
  onEyeballsDisplacedStop: () => console.log("Eyes back to center."),

  // Native multi-screen callback
  onMultiScreenDetected: (data) => {
    console.warn("Multiple monitors detected:", data);
  },

  // Catch-all violation snapshot callback (delivers JPEG Blob)
  onFaceError: (message, frameBlob, timestamp) => {
    console.warn(`Violation: ${message}`, frameBlob);
    // e.g. upload frameBlob to your evidence server
  },
});

// 2. Initialize the SDK
await proctor.init();

// 3. Start face tracking (pass <video> element and optional overlay <canvas>)
const video = document.getElementById("webcam") as HTMLVideoElement;
const canvas = document.getElementById("canvas-overlay") as HTMLCanvasElement;
await proctor.startFaceTracking(video, canvas);

// 4. Enable browser lockdown
await proctor.disableCopyAndPaste();
proctor.disableRightClick();
proctor.startMouseOutDetection(() => console.warn("Mouse left the browser window!"));
proctor.startVisibilityChangeDetection(() => {
  if (document.hidden) console.warn("Candidate switched tabs!");
});

// 5. Clean up when finished
proctor.stopFacialTracking();
await proctor.enableCopyAndPaste();
```

---

## Framework Examples

### Next.js (App & Pages Router)

Because Invigilator relies on browser APIs (`navigator.mediaDevices`, `Worker`, and `HTMLCanvasElement`), use the `'use client';` directive in the Next.js App Router (or dynamic SSR-disabled imports in Pages Router):

```tsx
'use client';

import React, { useEffect, useRef, useState } from "react";
import { Invigilator } from "invigilator";

export default function ExamProctorView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [warning, setWarning] = useState<string>("");

  const [proctor] = useState(
    () =>
      new Invigilator({
        mirrored: true,
        // Optional: override asset URLs for air-gapped/self-hosted environments
        // tasksVisionUrl: "/mediapipe/tasks-vision.js",
        // wasmPath: "/mediapipe/wasm",

        // Hysteresis threshold: wait 6 consecutive frames (~1.5s) before triggering
        noFaceThreshold: 6,

        onNoFaceDetected: () => setWarning("Warning: Face not visible in camera!"),
        onNoFaceDetectedStop: () => setWarning(""),
        onMultipleFaceDetected: () => setWarning("Warning: Multiple people detected in frame!"),
        onMultipleFaceDetectedStop: () => setWarning(""),
        onFaceAwayFromScreen: () => setWarning("Please look straight at your screen!"),
        onFaceAwayFromScreenStop: () => setWarning(""),
        onCameraBlocked: () => setWarning("Camera blocked or inadequate lighting!"),
        onCameraBlockedStop: () => setWarning(""),
        onFaceError: (msg, frameBlob) => {
          console.warn(`[Violation Event] ${msg}`, frameBlob);
        },
      })
  );

  useEffect(() => {
    let mounted = true;

    async function setupProctoring() {
      await proctor.init();
      if (!mounted || !videoRef.current) return;

      await proctor.startFaceTracking(videoRef.current, canvasRef.current || undefined);
      await proctor.disableCopyAndPaste();
      proctor.disableRightClick();
    }

    setupProctoring();

    return () => {
      mounted = false;
      proctor.stopFacialTracking();
      proctor.enableCopyAndPaste();
      proctor.enableRightClick();
    };
  }, [proctor]);

  return (
    <div className="flex flex-col items-center">
      {warning && (
        <div className="bg-red-600 text-white px-4 py-2 rounded mb-2 font-semibold">
          {warning}
        </div>
      )}
      <div style={{ position: "relative", width: 480, height: 360 }}>
        {/* Mirrored webcam video */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            height: "100%",
            transform: "scaleX(-1)", // CSS flip for natural mirror preview
            objectFit: "cover",
          }}
        />
        {/* Canvas overlay: Do NOT add scaleX(-1) here; 2D context mirrors automatically */}
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      </div>
    </div>
  );
}
```

### React

```tsx
import React, { useEffect, useRef, useState } from "react";
import { Invigilator } from "invigilator";

export default function ProctoredExam() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [proctor] = useState(
    () =>
      new Invigilator({
        mirrored: true,
        onCameraBlocked: () => console.warn("Camera blocked!"),
        onNoFaceDetected: () => console.warn("No face detected!"),
        onNoFaceDetectedStop: () => console.log("Face detected again."),
        onMultipleFaceDetected: () => console.warn("Multiple faces!"),
        onFaceAwayFromScreen: () => console.warn("Looking away!"),
        onEyeballsDisplaced: () => console.warn("Gaze away for > 5 seconds!"),
        onMultiScreenDetected: (data) => console.warn("Multiple displays!", data),
        onFaceError: (msg, blob) => {
          // Upload JPEG violation snapshot to server
          console.log(`Snapshot captured [${blob.size} bytes]: ${msg}`);
        },
      })
  );

  useEffect(() => {
    let mounted = true;

    async function start() {
      await proctor.init();
      if (!mounted || !videoRef.current) return;

      // Start face tracking and lockdown
      await proctor.startFaceTracking(videoRef.current, canvasRef.current || undefined);
      await proctor.disableCopyAndPaste();
      proctor.startMouseOutDetection(() => console.warn("Mouse left window"));
      proctor.startVisibilityChangeDetection(() => {
        if (document.hidden) console.warn("Tab switched");
      });

      // Check for secondary monitors without extension
      const screenCheck = await proctor.checkMultiScreenDetection();
      if (screenCheck.isExtended) {
        alert("Please disconnect your secondary monitor.");
      }
    }

    start();

    return () => {
      mounted = false;
      proctor.stopFacialTracking();
      proctor.enableCopyAndPaste();
    };
  }, [proctor]);

  return (
    <div style={{ position: "relative", width: 640, height: 480 }}>
      {/* Mirrored webcam video */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: "100%", height: "100%", transform: "scaleX(-1)", objectFit: "cover" }}
      />
      {/* Green bounding box overlay canvas */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
```

---

### Vue 3

```vue
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import { Invigilator } from "invigilator";

const videoRef = ref<HTMLVideoElement>();
const canvasRef = ref<HTMLCanvasElement>();

const proctor = new Invigilator({
  mirrored: true,
  onNoFaceDetected: () => console.warn("No face detected!"),
  onNoFaceDetectedStop: () => console.log("Face detected again."),
  onMultipleFaceDetected: () => console.warn("Multiple faces!"),
  onFaceError: (msg, blob) => console.log(`Violation snapshot: ${msg}`, blob),
});

onMounted(async () => {
  await proctor.init();
  if (videoRef.value) {
    await proctor.startFaceTracking(videoRef.value, canvasRef.value);
    await proctor.disableCopyAndPaste();
  }
});

onBeforeUnmount(() => {
  proctor.stopFacialTracking();
  proctor.enableCopyAndPaste();
});
</script>

<template>
  <div style="position: relative; width: 640px; height: 480px;">
    <video
      ref="videoRef"
      autoplay
      playsinline
      muted
      style="width: 100%; height: 100%; transform: scaleX(-1); object-fit: cover;"
    />
    <canvas
      ref="canvasRef"
      style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;"
    />
  </div>
</template>
```

---

### Angular

```typescript
import { Component, ViewChild, ElementRef, OnInit, OnDestroy } from "@angular/core";
import { Invigilator } from "invigilator";

@Component({
  selector: "app-proctored-exam",
  template: `
    <div style="position: relative; width: 640px; height: 480px;">
      <video
        #webcam
        autoplay
        playsinline
        muted
        style="width: 100%; height: 100%; transform: scaleX(-1); object-fit: cover;"
      ></video>
      <canvas
        #overlay
        style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;"
      ></canvas>
    </div>
  `,
})
export class ProctoredExamComponent implements OnInit, OnDestroy {
  @ViewChild("webcam", { static: true }) videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild("overlay", { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private proctor = new Invigilator({
    mirrored: true,
    onNoFaceDetected: () => console.warn("No face detected"),
    onNoFaceDetectedStop: () => console.log("Face detected again"),
    onMultipleFaceDetected: () => console.warn("Multiple faces!"),
    onFaceError: (msg, blob) => console.log("Violation snapshot:", msg, blob),
  });

  async ngOnInit() {
    await this.proctor.init();
    await this.proctor.startFaceTracking(
      this.videoRef.nativeElement,
      this.canvasRef.nativeElement
    );
    await this.proctor.disableCopyAndPaste();
  }

  ngOnDestroy() {
    this.proctor.stopFacialTracking();
    this.proctor.enableCopyAndPaste();
  }
}
```

---

## Visual Feedback & Mirroring

### Face Boxes
By default, the SDK processes face detection in the background. If you want to show **green detection bounding boxes** to the candidate, provide a `<canvas>` element as the second parameter to `startFaceTracking(video, canvas)`.

Ensure the canvas is positioned directly over the video element with `pointer-events: none`.

### Mirroring (Flip)
Most webcam applications mirror the video (horizontally flip it) to provide a more natural user experience:
```css
video {
  transform: scaleX(-1);
}
```

When `mirrored: true` is set (the default):
1. **Detection Boxes** are automatically flipped horizontally on the canvas to match your mirrored video.
2. **Eye Gaze & Head Pose** logic is automatically aligned so that looking "Left" from the examinee's perspective is correctly identified.

### Canvas Mirroring Note

> [!NOTE]
> When `mirrored: true` (default), the overlay canvas is automatically mirrored in 2D context (`ctx.scale(-1, 1)`). Do **NOT** add CSS `transform: scaleX(-1)` to the `<canvas>` element — only apply it to the `<video>` element.
>
> If your application or CSS framework applies `transform: scaleX(-1)` to both `<video>` and `<canvas>`, pass `canvasMirrored: false` to the `Invigilator` configuration to avoid double-mirroring.

---

## Next.js & Webpack 5 Compatibility

In Next.js and other Webpack 5 environments, Webpack's AST parser evaluates `import(...)` statements at build time. `invigilator` loads dynamic worker modules via a safe native import wrapper (`new Function`), preventing build errors like `UnhandledSchemeError: Reading from "https:" is not handled by plugins`.

### Self-Hosting MediaPipe Assets (Offline / Firewalls)

In enterprise, institutional, or university test environments, firewalls often restrict access to public CDN domains (`cdn.jsdelivr.net` or `storage.googleapis.com`). You can host the MediaPipe WASM binaries and model files locally in your application's `/public` folder or a private CDN:

```typescript
const proctor = new Invigilator({
  // Custom asset URLs for enterprise/air-gapped environments
  tasksVisionUrl: "/mediapipe/tasks-vision.js",
  wasmPath: "/mediapipe/wasm",
  faceLandmarkerModelPath: "/mediapipe/models/face_landmarker.task",
  faceDetectorModelPath: "/mediapipe/models/blaze_face_short_range.tflite",
});
```

### Violation Smoothing & Debounce

To prevent false alarms during initial model warm-up, candidate blinks (150–300ms), or momentary glances at scratch paper:
- **Consecutive Frame Debounce (`noFaceThreshold: 6`)**: A "No face detected" event will only be latched once absent for consecutive frames exceeding this threshold (~1.5s at the default 250ms polling loop).
- **Instant Recovery State Machine**: The moment the candidate re-centers or a face is detected again, the counter resets and `onNoFaceDetectedStop` / `onFaceErrorStop` are dispatched immediately to clear warning UI.
- Configurable via `noFaceThreshold` in the constructor.

---

## API Reference

### Initialization

#### `new Invigilator(config?: ProctoringConfig)`
Creates a new proctoring instance.

#### `init(): Promise<void>`
Initializes the SDK and prepares the background worker. Must be called before starting face tracking.

```typescript
await proctor.init();
```

#### `isInitialized(): boolean`
Returns `true` if `init()` has completed.

#### `getProctoringFeatures(): SchoolFeatureConfig`
Returns the enabled feature flags.

---

### Face Tracking

#### `startFaceTracking(videoElement: HTMLVideoElement, canvasElement?: HTMLCanvasElement): Promise<void>`
Requests webcam permissions (if stream not already attached), plays the video, and begins background face detection. Optionally renders green bounding boxes on `canvasElement`.

```typescript
const video = document.getElementById("webcam") as HTMLVideoElement;
const canvas = document.getElementById("canvas-overlay") as HTMLCanvasElement;
await proctor.startFaceTracking(video, canvas);
```

**Detects:**
| Event | Start Callback | Stop Callback | Description |
|---|---|---|---|
| Camera blocked / dark room | `onCameraBlocked` | `onCameraBlockedStop` | Average frame luminance < 20 |
| No face in frame | `onNoFaceDetected` | `onNoFaceDetectedStop` | No face visible |
| Multiple faces | `onMultipleFaceDetected` | `onMultipleFaceDetectedStop` | More than 1 face detected |
| Face turned away | `onFaceAwayFromScreen` | `onFaceAwayFromScreenStop` | Head turned left/right or up/down |
| Eyes displaced for > 5s | `onEyeballsDisplaced` | `onEyeballsDisplacedStop` | Gaze directed away for >= 5 seconds |

#### `stopFacialTracking(): void`
Stops face detection, releases webcam media tracks, and terminates the background worker.

---

### Multi-Screen Detection (Native)

#### `checkMultiScreenDetection(): Promise<{ isExtended: boolean, screenCount: number, method: string }>`
Detects if the user has multiple monitors or an extended desktop connected.
- **Zero extensions or permission prompts required** in modern Chromium browsers (Chrome & Edge 100+ via `window.screen.isExtended`).
- Automatically falls back to Window Management API and extension bridge if present.

```typescript
const result = await proctor.checkMultiScreenDetection();
if (result.isExtended) {
  console.warn("Multiple monitors active! Screen count:", result.screenCount);
}
```

#### `startMultiScreenMonitoring(callback?: (data: any) => void): void`
Attaches real-time listeners for display connect/disconnect events (e.g. if an examinee plugs in an external monitor or HDMI cable mid-assessment).

```typescript
proctor.startMultiScreenMonitoring((data) => {
  alert("External monitor connected! Please disconnect it immediately.");
});
```

#### `stopMultiScreenMonitoring(): void`
Stops real-time screen change monitoring.

---

### Browser Monitoring (Direct DOM)

#### `disableCopyAndPaste(): Promise<void>`
Blocks `copy`, `cut`, and `paste` events across the document using `preventDefault()`.

#### `enableCopyAndPaste(): Promise<void>`
Restores normal clipboard operations.

#### `disableRightClick(): void` / `enableRightClick(): void`
Disables or enables the right-click context menu.

#### `openFullscreen(element?: HTMLElement): Promise<void>`
Requests cross-browser fullscreen mode. Defaults to `document.documentElement`.

```typescript
await proctor.openFullscreen();
```

#### `closeFullscreen(): Promise<void>`
Exits fullscreen mode across all browsers.

#### `startMouseOutDetection(callback: (event: MouseEvent) => void): void`
Fires whenever the user's cursor exits the browser window (`mouseleave` on root element).

#### `stopMouseOutDetection(callback: (event: MouseEvent) => void): void`
Removes the mouse-leave listener. Pass the same function reference.

#### `startVisibilityChangeDetection(callback: (event: Event) => void): void`
Fires whenever the page visibility changes (e.g., candidate minimizes browser or switches tabs).

```typescript
proctor.startVisibilityChangeDetection(() => {
  if (document.hidden) console.warn("Candidate left the exam tab!");
});
```

#### `stopVisibilityChangeDetection(callback: (event: Event) => void): void`
Removes the visibility change listener.

---

### Browser Extension Bridge (Optional Tier 2)

For deep OS-level lockdown and tab control via companion extension:

| Method | Dispatched Message | Description |
|---|---|---|
| `isExtensionInstalled()` | — | Returns `true` if companion extension is detected |
| `enableProctoringExtension()` | `ENABLE_EXTENSION` | Activates extension |
| `disableProctoringExtension()` | `DISABLE_EXTENSION` | Deactivates extension |
| `closeOtherTabs()` | `CLOSE_TABS` | Closes all other tabs in the browser window |
| `enableLockdownMode()` | `ENABLE_LOCKDOWN` | Requests OS-level window lockdown |
| `takeDeviceSnapshot()` | `TAKE_SNAPSHOT` | Captures full OS screen snapshot |
| `disableExternalDevices()` | `DISABLE_EXTERNAL_DEVICES` | Requests blocking external peripherals |
| `stopBackgroundApps()` | `STOP_BACKGROUND_APPS` | Requests suspending background apps |
| `disableRightClickAndClipboard()` | `DISABLE_RIGHT_CLICK_CLIPBOARD` | Disables clipboard via extension |

---

### Utilities

#### `getDevices(): Promise<{ videoDevices: MediaDeviceInfo[], audioDevices: MediaDeviceInfo[] }>`
Enumerates available camera and microphone devices for building device-selection dropdowns.

```typescript
import { getDevices } from "invigilator";

const { videoDevices, audioDevices } = await getDevices();
```

#### `chromeExtensionExists(): boolean`
Returns whether the companion proctoring extension is installed.

---

## Configuration

Passed to the constructor via `ProctoringConfig`:

```typescript
interface ProctoringConfig {
  mirrored?: boolean;                     // Default: true. Flips bounding boxes and eye gaze logic.
  canvasMirrored?: boolean;               // Default: value of mirrored. Controls 2D canvas mirroring.
  mockExtension?: boolean;                // Default: false. Simulates extension bridge in dev environments.

  // Sensitivity, debouncing & performance tuning
  noFaceThreshold?: number;               // Default: 6 frames (~1.5s). Debounce before triggering onNoFaceDetected.
  fastLoop?: number;                      // Default: 250 (ms). Interval for face & gaze inference loop.
  slowLoop?: number;                      // Default: 2500 (ms). Interval for multi-face count detection.
  awayTimeout?: number;                   // Default: 5000 (ms). Threshold for away/cheating flag.
  eyeMovementDuration?: number;           // Default: 5000 (ms). Threshold for gaze displacement flag.
  brightnessThreshold?: number;           // Default: 20. Minimum average luminance before flagging camera blocked.
  videoConstraints?: MediaStreamConstraints | MediaTrackConstraints; // Camera resolution constraints.

  // Custom asset URLs (for offline, Next.js / Webpack, or air-gapped institutional firewalls)
  tasksVisionUrl?: string;                // Default: jsDelivr CDN. URL to @mediapipe/tasks-vision ESM bundle.
  wasmPath?: string;                      // Default: jsDelivr CDN. URL or local path to tasks-vision WASM files.
  faceLandmarkerModelPath?: string;       // Default: Google storage CDN URL to face_landmarker.task.
  faceDetectorModelPath?: string;         // Default: Google storage CDN URL to blaze_face_short_range.tflite.

  // Face detection callbacks
  onCameraBlocked?: () => void;
  onCameraBlockedStop?: () => void;
  onNoFaceDetected?: () => void;
  onNoFaceDetectedStop?: () => void;
  onMultipleFaceDetected?: () => void;
  onMultipleFaceDetectedStop?: () => void;
  onFaceAwayFromScreen?: () => void;
  onFaceAwayFromScreenStop?: () => void;
  onEyeballsDisplaced?: () => void;
  onEyeballsDisplacedStop?: () => void;

  // Generic catch-all violation snapshot callback
  onFaceError?: (message: FacialDetectorErrorMessage | string, frame: Blob, time: number) => void;
  onFaceErrorStop?: (message: FacialDetectorErrorMessageStop | string, frame: Blob, time: number) => void;

  // Multi-screen & extension callbacks
  onMultiScreenDetected?: (data: any) => void;
  onSnapshotTaken?: (data: any) => void;
}
```

---

## TypeScript Types

All types and interfaces are exported from the root package:

```typescript
import type {
  ProctoringConfig,
  SchoolFeatureConfig,
  MonitoringEvent,
  MonitoringData,
  FaceTrackingReturn,
  ErrorCallback,
  FacialDetectorErrorMessage,
  FacialDetectorErrorMessageStop,
} from "invigilator";
```

---

## Browser Support

| Feature | Chrome | Edge | Firefox | Safari | Brave / Opera |
|---|:---:|:---:|:---:|:---:|:---:|
| **Face Tracking (Worker + MediaPipe)** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Native Multi-Screen (`isExtended`)** | ✅ | ✅ | ⚠️ (extension) | ⚠️ (extension) | ✅ |
| **Fullscreen API** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Clipboard & Context Menu Lock** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Tab Visibility & Mouse-Out** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Companion Extension** | ✅ | ✅ | ❌ | ❌ | ✅ |

---

## Backward Compatibility

The legacy `InvigilatorEngine` class remains fully supported:

```javascript
import { InvigilatorEngine } from "invigilator";

const engine = new InvigilatorEngine(videoEl, canvasEl, onTelemetryUpdate);
await engine.initialize();
engine.start();
```

---

## License

[MIT](./LICENSE) © Vishwahiremath
