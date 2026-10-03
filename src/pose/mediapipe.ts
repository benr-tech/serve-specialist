import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Detection, KeypointName, Pose, PoseBackend, WorldPose } from './types';

export type MediaPipeVariant = 'lite' | 'full' | 'heavy';

const MODEL_VERSION = '1';
const googleUrl = (v: MediaPipeVariant) =>
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${v}/float16/${MODEL_VERSION}/pose_landmarker_${v}.task`;
/** The app's own model is served with the site (public/models), so it keeps working if Google moves the file. */
const SELF_HOSTED: Partial<Record<MediaPipeVariant, string>> = { heavy: 'models/pose_landmarker_heavy.task' };
const modelUrls = (v: MediaPipeVariant) =>
  SELF_HOSTED[v] ? [`${import.meta.env.BASE_URL}${SELF_HOSTED[v]}`, googleUrl(v)] : [googleUrl(v)];

/** MediaPipe BlazePose landmark index for each of our keypoints. */
const INDEX: Record<KeypointName, number> = {
  nose: 0,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30,
  leftToe: 31, rightToe: 32, // "foot index" in MediaPipe's naming
  leftPinky: 17, rightPinky: 18,
  leftIndex: 19, rightIndex: 20,
};

export class MediaPipeBackend implements PoseBackend {
  readonly name: string;
  readonly version = `tasks-vision@1.0.1/model-v${MODEL_VERSION}`;
  private landmarker: PoseLandmarker | null = null;

  constructor(private variant: MediaPipeVariant = 'heavy') {
    this.name = `mediapipe-pose-${variant}`;
  }

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe-wasm`);
    const create = (modelAssetPath: string, delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
      });
    // Own copy first, Google's as a fallback; GPU if the device allows, else CPU.
    let lastError: unknown;
    for (const url of modelUrls(this.variant)) {
      for (const delegate of ['GPU', 'CPU'] as const) {
        try {
          this.landmarker = await create(url, delegate);
          return;
        } catch (e) {
          lastError = e;
        }
      }
    }
    throw lastError;
  }

  detect(source: TexImageSource, w: number, h: number, timeMs: number): Detection | null {
    if (!this.landmarker) throw new Error('MediaPipeBackend.init() not called');
    const result = this.landmarker.detectForVideo(source, timeMs);
    const lm = result.landmarks[0];
    if (!lm) return null;
    const wl = result.worldLandmarks[0];
    const pose = {} as Pose;
    const world = wl ? ({} as WorldPose) : null;
    for (const [name, i] of Object.entries(INDEX) as [KeypointName, number][]) {
      const p = lm[i]!;
      pose[name] = { x: p.x * w, y: p.y * h, visibility: p.visibility ?? 0 };
      const q = wl?.[i];
      if (world && q) world[name] = { x: q.x, y: q.y, z: q.z, visibility: p.visibility ?? 0 };
    }
    return { pose, world };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
