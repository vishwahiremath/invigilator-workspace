export interface MonitoringEvent {
  type: "audio" | "video" | "browser";
  message: string;
  time: string | number;
  media?: Blob;
}

export interface MonitoringData {
  timeWhenTheyLeft: string;
  timeWhenTheyCameBack: string;
  reasonForLeaving: string;
  monitoringType: string;
}

export interface Thresholds {
  noseTip?: number;
  mouthCenter?: number;
  eyes?: number;
  eyeMovementDelta?: number;
  eyeMovementDuration?: number;
}

export interface DetectionSettings {
  solutionPath?: string;
  thresholds?: Thresholds;
  sessionToken?: string;
}

export interface SchoolFeatureConfig {
  orgId?: string;
  orgName?: string;
  publicKey?: string;
  digitalProctoring?: boolean;
  deviceSnapshot?: boolean;
  assessmentFrameBoundary?: boolean;
  fullScreenMode?: boolean;
  closeOpenTabs?: boolean;
  disableClipboardPrinting?: boolean;
  disableCopyAndPaste?: boolean;
  onlyOneScreen?: boolean;
  eyesAndFaceTracking?: boolean;
  soundTracking?: boolean;
  lockdownApp?: boolean;
  disableExternalDevices?: boolean;
  stopAllBackgroundApps?: boolean;
  realTimeViewingEnabled?: boolean;
  screenSharingEnabled?: boolean;
  saveRealTimeViewing?: boolean;
  canSchoolDoLiveProctoring?: boolean;
  canSchoolDoScreenSharing?: boolean;
  canSchoolSaveLiveProctoring?: boolean;
  detectionSettings?: DetectionSettings;
}

export interface ProctoringConfig {
  apiKey?: string;
  mirrored?: boolean; // Default is true
  canvasMirrored?: boolean; // Optional: controls 2D canvas mirroring. Defaults to value of `mirrored`. Set to false if CSS scaleX(-1) is applied to canvas.
  mockExtension?: boolean;
  detectionSettings?: DetectionSettings;
  features?: Partial<SchoolFeatureConfig>;

  // Performance & threshold tuning
  noFaceThreshold?: number; // Consecutive frames before triggering onNoFaceDetected (default: 6, ~1.5s)
  fastLoop?: number; // Face detection polling interval in ms (default: 250)
  slowLoop?: number; // Multi-face detection interval in ms (default: 2500)
  awayTimeout?: number; // Away / cheating timeout in ms (default: 5000)
  eyeMovementDuration?: number; // Eye displacement duration threshold in ms (default: 5000)
  brightnessThreshold?: number; // Minimum average frame luminance (default: 20)
  videoConstraints?: MediaTrackConstraints | MediaStreamConstraints;

  // Custom asset & model URLs (for self-hosting, offline, or Next.js / Webpack custom asset routing)
  tasksVisionUrl?: string; // Custom URL or path to @mediapipe/tasks-vision ESM bundle
  wasmPath?: string; // Custom URL or path to @mediapipe/tasks-vision WASM files
  faceLandmarkerModelPath?: string; // Custom URL to face_landmarker.task
  faceDetectorModelPath?: string; // Custom URL to blaze_face_short_range.tflite

  // Face detection start callbacks
  onCameraBlocked?: () => void;
  onMultipleFaceDetected?: () => void;
  onNoFaceDetected?: () => void;
  onFaceAwayFromScreen?: () => void;
  onEyeballsDisplaced?: () => void;

  // Face detection stop callbacks
  onCameraBlockedStop?: () => void;
  onMultipleFaceDetectedStop?: () => void;
  onNoFaceDetectedStop?: () => void;
  onFaceAwayFromScreenStop?: () => void;
  onEyeballsDisplacedStop?: () => void;

  // Generic catch-all callbacks with frame snapshot blob
  onFaceError?: (message: FacialDetectorErrorMessage | string, frame: Blob, time: number) => void;
  onFaceErrorStop?: (message: FacialDetectorErrorMessageStop | string, frame: Blob, time: number) => void;

  // Multi-screen & browser extension bridge callbacks
  onMultiScreenDetected?: (data: any) => void;
  onSnapshotTaken?: (data: any) => void;

  // Optional legacy telemetry callback
  onTelemetryUpdate?: (data: any) => void;
}

export interface FaceTrackingReturn {
  checkIfCameraBlocked?: () => Promise<void>;
  stopDetection?: () => void;
}

export type ErrorCallback = (message: string, frame: Blob, startTime: number) => void;

export type FacialDetectorErrorMessage =
  | "Camera blocked or covered or dark room"
  | "Multiple faces detected"
  | "No face detected"
  | "Face is away from the screen"
  | "Eyeballs moved for more than 5 seconds";

export type FacialDetectorErrorMessageStop =
  | "Camera unblocked or uncovered"
  | "Single face detected again"
  | "Face detected again"
  | "Face is back on screen"
  | "Eyeballs are back to center";

export declare class Invigilator {
  constructor(config?: ProctoringConfig);

  init(): Promise<void>;
  isInitialized(): boolean;
  getProctoringFeatures(): SchoolFeatureConfig;

  // Face Tracking
  startFaceTracking(videoElement: HTMLVideoElement, canvasElement?: HTMLCanvasElement): Promise<void>;
  stopFacialTracking(): void;

  // Browser Monitoring (DOM / Direct)
  disableCopyAndPaste(): Promise<void>;
  enableCopyAndPaste(): Promise<void>;
  openFullscreen(element?: HTMLElement): Promise<void>;
  closeFullscreen(): Promise<void>;
  startMouseOutDetection(callback: (event: MouseEvent) => void): void;
  stopMouseOutDetection(callback: (event: MouseEvent) => void): void;
  startVisibilityChangeDetection(callback: (event: Event) => void): void;
  stopVisibilityChangeDetection(callback: (event: Event) => void): void;
  disableRightClick(): void;
  enableRightClick(): void;

  // Multi-Screen Detection (Native + Extension Hybrid)
  checkMultiScreenDetection(): Promise<{
    isExtended: boolean;
    screenCount: number;
    method: string;
    displays?: any[];
  }>;
  startMultiScreenMonitoring(callback?: (data: any) => void): void;
  stopMultiScreenMonitoring(): void;

  // Browser Extension Bridge
  isExtensionInstalled(): boolean;
  enableProctoringExtension(): void;
  disableProctoringExtension(): void;
  enableLockdownMode(): void;
  takeDeviceSnapshot(): void;
  disableExternalDevices(): void;
  stopBackgroundApps(): void;
  closeOtherTabs(): void;
  disableRightClickAndClipboard(): void;
}

export declare class InvigilatorEngine {
  constructor(
    videoElement: HTMLVideoElement,
    canvasElement: HTMLCanvasElement,
    onTelemetryUpdate: (data: any) => void,
    customConfig?: any
  );
  initialize(): Promise<void>;
  start(): void;
  stop(): void;
}

export declare function chromeExtensionExists(): boolean;
export declare function getDevices(): Promise<{
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
}>;
