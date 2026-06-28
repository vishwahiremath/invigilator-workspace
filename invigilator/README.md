# invigilator

`invigilator` is a lightweight, high-performance, client-side AI proctoring SDK designed to monitor examinee behavior and detect potential cheating in online exams. 

By leveraging **Google MediaPipe** and **Web Workers**, the entire proctoring pipeline runs directly in the user's browser. It offloads heavy machine learning inference to a background thread, ensuring a smooth, lag-free experience for the main application.

---

## Features

- **Background Inference via Web Workers**: Keeps your UI responsive by running MediaPipe's `FaceLandmarker` and `FaceDetector` in a separate thread.
- **Zero-Copy Frame Transfers**: Uses the `createImageBitmap` API to capture hardware-accelerated video frames from the webcam and transfer their ownership to the Web Worker, avoiding slow canvas-drawing operations and memory copying.
- **Dual-Loop Architecture**:
  - **Fast Loop (Real-time tracking)**: Runs at high frequency (e.g., every 300ms) to track face presence, eye closure (blink/gaze-away), and head pose (turned left/right, looking up/down).
  - **Slow Loop (Auditing)**: Runs periodically (e.g., every 3000ms) using a face detector to count faces in the frame and flag multiple people.
- **Backlog & Leak Protection**: Instantly drops new frames if the worker is busy processing a previous frame, and explicitly closes `ImageBitmap` instances to prevent GPU memory leaks.
- **Smart Model Initialization**: Attempts to load models using hardware-accelerated **GPU** delegates first, with an automatic fallback to **CPU** if GPU delegates are unavailable.
- **Vite & ESM Friendly**: Includes a built-in `importScripts` polyfill to support module-worker environments where native `importScripts()` is disabled.

---

## How It Works

```
+-----------------------------------------------------------------+
|                           MAIN THREAD                           |
|                                                                 |
|  [Webcam Stream] ---> createImageBitmap() ---> [ImageBitmap]    |
|                                                      |          |
|                                            (Transfer ownership) |
+------------------------------------------------------|----------+
                                                       v
+-----------------------------------------------------------------+
|                        BACKGROUND WORKER                        |
|                                                                 |
|  [Fast Loop]  --> MediaPipe FaceLandmarker --> Pose & Eyes      |
|  [Slow Loop]  --> MediaPipe FaceDetector   --> Face Counting    |
|                                                      |          |
|                                           (Post Telemetry)      |
+------------------------------------------------------|----------+
                                                       v
+-----------------------------------------------------------------+
|                           MAIN THREAD                           |
|                                                                 |
|  onTelemetryUpdateCallback(telemetryData)                       |
+-----------------------------------------------------------------+
```

### 1. Telemetry & Mathematical Heuristics
The background worker processes facial landmarks to compute indicators of examinee attention:
- **Eye Closure Detection**: Measures the vertical distance between the upper and lower eyelids. If the distance falls below a threshold, the eyes are flagged as closed.
- **Horizontal Head Pose**: Calculates the ratio of distances from the nose to the left and right cheeks. Ratios outside `[0.38, 0.62]` indicate the head is turned left or right.
- **Vertical Head Pose**: Calculates the ratio of distances from the nose to the forehead and chin. Ratios outside `[0.35, 0.62]` indicate the head is looking up or down.
- **Away Detection & Cheating Flag**: If the user is "away" (face not visible, eyes closed, or looking down) for longer than the configured `awayTimeout` (e.g., 5 seconds), the engine flags a potential cheating event.
- **Multiple Faces Alert**: Runs a face detector (BlazeFace short range) to count the faces in the frame. If the count exceeds the `numFacesLimit` (default `1`), a cheating event is flagged immediately.

---

## Tech Stack & Dependencies

The package is built with:
- **JavaScript (ES Modules)**
- **Web Workers API**
- **HTML5 Video & ImageBitmap API**
- **Google MediaPipe Tasks Vision** (`@mediapipe/tasks-vision` loaded dynamically via CDN in the worker)

---

## Installation

Since the package is designed as an ES Module, you can import it directly into your frontend project. Ensure your build tool (such as Vite or Webpack) is configured to handle Web Workers and ES modules.

```bash
npm install /path/to/invigilator-package
```

---

## API Reference

### `InvigilatorEngine`

The main class used to control the proctoring session.

#### Constructor

```javascript
const engine = new InvigilatorEngine(videoElement, canvasElement, onTelemetryUpdate, config);
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `videoElement` | `HTMLVideoElement` | The active `<video>` element streaming the webcam. |
| `canvasElement` | `HTMLCanvasElement` | A scratch canvas element (reserved for future use). |
| `onTelemetryUpdate` | `Function` | Callback function that receives telemetry data. |
| `config` | `Object` | Optional configuration overrides (see below). |

#### Configuration Options (`config`)

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `numFacesLimit` | `number` | `1` | Maximum number of allowed faces before triggering an alert. |
| `fastLoop` | `number` | `300` | Interval (in ms) to capture frames and run face landmark checks. |
| `slowLoop` | `number` | `3000` | Interval (in ms) to run the face detector to count faces. |
| `awayTimeout` | `number` | `5000` | Time (in ms) the user can be "away" before flagging `cheating = true`. |

#### Methods

- `async initialize()`: Spawns the Web Worker, downloads the MediaPipe models (FaceLandmarker and FaceDetector) within the worker, and prepares the engine. Resolves when the worker is ready.
- `start()`: Starts the frame capture and inference loop.
- `stop()`: Stops the capture loop, terminates the Web Worker, and cleans up resources.

---

## Telemetry Data Structure

The `onTelemetryUpdate` callback receives an object with the following properties:

```typescript
{
  type: "TELEMETRY",
  timestamp: number,          // Epoch timestamp of the processed frame
  facePresent: boolean,       // True if a face is detected in the frame
  eyesClosed: boolean,        // True if the user's eyes are detected as closed
  headPose: "CENTER" | "TURNED_LEFT" | "TURNED_RIGHT",
  verticalHeadPose: "CENTER" | "LOOKING_UP" | "LOOKING_DOWN",
  facesCount: number,         // Total faces detected (updated every slowLoop)
  multipleFacesAlert: boolean,// True if facesCount > numFacesLimit
  awayDuration: number,       // Cumulative milliseconds the user has been "away"
  cheating: boolean,          // True if awayDuration >= awayTimeout OR multipleFacesAlert is true
  cheatingReason: string      // Reason for the cheating flag (e.g., "Face not visible", "Multiple faces")
}
```

---

## Example Usage

Here is a complete example showing how to set up the webcam stream, initialize the `InvigilatorEngine`, and handle the proctoring telemetry.

### HTML

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invigilator Demo</title>
  <style>
    #webcam { width: 480px; height: 360px; background: #000; transform: scaleX(-1); }
    .alert { border: 4px solid red; }
  </style>
</head>
<body>
  <h1>AI Proctoring Session</h1>
  <video id="webcam" autoplay playsinline muted></video>
  <div id="status">Status: Idle</div>
  
  <button id="start-btn">Start Proctoring</button>
  <button id="stop-btn" disabled>Stop</button>

  <script type="module" src="app.js"></script>
</body>
</html>
```

### JavaScript (`app.js`)

```javascript
import { InvigilatorEngine } from 'invigilator';

const videoEl = document.getElementById('webcam');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusEl = document.getElementById('status');

let engine = null;
let stream = null;

// Telemetry handler
function handleTelemetry(telemetry) {
  if (telemetry.cheating) {
    statusEl.textContent = `ALERT: Cheating detected! Reason: ${telemetry.cheatingReason}`;
    videoEl.classList.add('alert');
  } else {
    statusEl.textContent = `Proctoring active. Head: ${telemetry.headPose}, Eyes: ${telemetry.eyesClosed ? 'Closed' : 'Open'}`;
    videoEl.classList.remove('alert');
  }
  
  console.log('Telemetry Update:', telemetry);
}

// Start proctoring
startBtn.addEventListener('click', async () => {
  try {
    startBtn.disabled = true;
    statusEl.textContent = 'Requesting camera...';
    
    // 1. Get webcam stream
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    videoEl.srcObject = stream;
    await videoEl.play();

    // 2. Instantiate the engine
    engine = new InvigilatorEngine(videoEl, null, handleTelemetry, {
      numFacesLimit: 1,
      fastLoop: 300,      // Check landmarks every 300ms
      slowLoop: 3000,     // Count faces every 3 seconds
      awayTimeout: 5000   // Flag cheating if away for 5 seconds
    });

    statusEl.textContent = 'Loading AI models in background...';
    
    // 3. Initialize engine (loads models in worker)
    await engine.initialize();
    
    // 4. Start proctoring loop
    engine.start();
    
    statusEl.textContent = 'Proctoring started.';
    stopBtn.disabled = false;
  } catch (error) {
    console.error('Initialization failed:', error);
    statusEl.textContent = `Error: ${error.message}`;
    startBtn.disabled = false;
  }
});

// Stop proctoring
stopBtn.addEventListener('click', () => {
  if (engine) {
    engine.stop();
    engine = null;
  }
  
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    videoEl.srcObject = null;
  }
  
  statusEl.textContent = 'Proctoring stopped.';
  startBtn.disabled = false;
  stopBtn.disabled = true;
  videoEl.classList.remove('alert');
});
```

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
