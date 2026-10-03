/** Our own keypoint set. Analysis code never sees library-specific landmark objects. */
export const KEYPOINT_NAMES = [
  'nose',
  'leftShoulder', 'rightShoulder',
  'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist',
  'leftHip', 'rightHip',
  'leftKnee', 'rightKnee',
  'leftAnkle', 'rightAnkle',
  'leftHeel', 'rightHeel',
  'leftToe', 'rightToe',
  // Hand points (used for forearm pronation).
  'leftIndex', 'rightIndex',
  'leftPinky', 'rightPinky',
] as const;

export type KeypointName = (typeof KEYPOINT_NAMES)[number];

/** Position in source-video pixels (origin top-left, y points down). Left/right are the player's own. */
export interface Keypoint {
  x: number;
  y: number;
  /** 0–1, how confident the model is that this point is visible. */
  visibility: number;
}

export type Pose = Record<KeypointName, Keypoint>;

/**
 * The model's 3D estimate of the same keypoints, in metres, centered between the hips.
 * Axes follow the camera: x right, y DOWN, z away from the camera. Joint angles measured here
 * depend much less on where the phone was than angles measured on the flat image.
 */
export interface Keypoint3 extends Keypoint {
  z: number;
}
export type WorldPose = Record<KeypointName, Keypoint3>;

export interface Detection {
  pose: Pose;
  world: WorldPose | null;
}

export interface PoseFrame {
  /** Position in PoseTrack.frames. */
  index: number;
  /** Real presentation time of this frame in the video, ms. */
  timeMs: number;
  /** null when no person was detected. */
  pose: Pose | null;
  /** 3D estimate; null if no person or the backend doesn't provide one. */
  world: WorldPose | null;
  /** How much the picture changed since the previous frame (see video/sceneChange.ts). */
  scene?: { full: number; background: number | null; drift: number | null } | null;
}

export interface PoseTrack {
  frames: PoseFrame[];
  videoWidth: number;
  videoHeight: number;
  model: { name: string; version: string };
  /** How frames were obtained: 'webcodecs' = every frame, exact timestamps; 'seek' = fallback, may skip frames. */
  sampling: 'webcodecs' | 'seek' | 'synthetic';
}

export interface PoseBackend {
  readonly name: string;
  readonly version: string;
  init(): Promise<void>;
  /** `source` is width×height pixels, upright. timeMs must strictly increase between calls. */
  detect(source: TexImageSource, width: number, height: number, timeMs: number): Detection | null;
  close(): void;
}

export type Side = 'left' | 'right';
