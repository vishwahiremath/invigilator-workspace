# Invigilator Workspace

This workspace contains the source code for the **Invigilator** client-side AI proctoring engine and a demonstration application.

## Directory Structure

- **[`invigilator/`](file:///d:/invigilator-workspace/invigilator)**: The core client-side AI proctoring SDK.
  - Built using Web Workers and Google MediaPipe.
  - Implements a dual-loop framework (fast-loop for eye/pose landmarks, slow-loop for face counting).
  - Refer to the [Invigilator Package README](file:///d:/invigilator-workspace/invigilator/README.md) for detailed configuration, API reference, and integration guides.
- **[`demo-app/`](file:///d:/invigilator-workspace/demo-app)**: A fully functional web-based dashboard demonstrating how to integrate and configure the `invigilator` SDK.

## Getting Started

To run the demo application locally:

1. Navigate to the `demo-app` directory:
   ```bash
   cd demo-app
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Open the local server URL in your browser to test the proctoring dashboard.