/**
 * Every tunable number in the analysis lives here. Bump `version` whenever a value changes,
 * so every exported result records exactly which settings produced it.
 * Speeds are in torso-lengths per second (camera-distance independent).
 * "TUNE": provisional, to be tuned on dev/train clips only — never on the test split.
 */
export const PARAMS = {
  version: 'p0.10',
  /** Footage quality tips (analysis/footage.ts). */
  footage: {
    /** Player (nose → lower ankle) should be at least this share of the frame height. */
    minPlayerHeightFraction: 0.35,
    minShortSidePx: 720,
    minFps: 50,
    /** Window around contact for judging hitting-arm visibility. */
    armWindowMs: 250,
    minArmVisibleShare: 0.6,
  },
  segments: {
    /** A hard cut: whole-picture change (0–255, 48×27 grayscale) at least this big… */
    cutMinChange: 20,
    /** …and this many times the surrounding frames' median (TUNE on dev clips). */
    cutRatio: 4,
    /** Clips shorter than this are merged into the previous one. */
    minClipMs: 800,
    /** Median half-second background drift above this = camera pans/zooms (TUNE: dev clips showed 3–5 still, 7–20 moving). */
    cameraMovingDrift: 8,
    /** The racket arm must be this many times faster than the other arm to be detected automatically. */
    hittingArmSpeedRatio: 1.5,
  },
  calibration: {
    /** Above this fit error (needs ≥ 5 points) the court marking is rejected for foot-fault calls (TUNE). */
    maxResidualCm: 10,
  },
  /** Centered moving-average window applied to keypoint positions (ms → odd frame count via smoothingFrames). */
  smoothingWindowMs: 80,
  phases: {
    /** Visibility cutoff for arm keypoints in phase detection. */
    armMinVisibility: 0.3,
    /** How far before ball release to look for the start of the motion. */
    startLookbackMs: 2000,
    /** Either arm moving at least this fast relative to the hips counts as "in motion" (torso lengths/s, TUNE). */
    startMinArmSpeed: 2.0,
    /** A pause longer than this ends the walk back to the start (the ready position). */
    startGapMs: 70,
    /**
     * Contact = the hitting wrist's highest point + this. On real footage the hand peaks just before
     * the racket meets the ball (dev-v0: 2 serves at 60 fps, wrist peak 33–50 ms early). TUNE on more serves.
     */
    contactAfterWristPeakMs: 40,
    /** Trophy = deepest knee bend after release, if it's at least this much deeper than at release (TUNE). */
    trophyMinExtraBendDeg: 8,
    /** ...searched up to this long before the hips' fastest rise (take-off; smoothing blurs it by ~half a window). */
    trophyBeforePushOffMs: 50,
    /** Racket drop only counts while the hitting elbow is no more than this far below the shoulder (torso lengths, TUNE). */
    elbowUpTolerance: 0.15,
    /** When the racket arm can't be seen behind the back: drop ≈ this long before contact (dev labels: 80–130 ms). */
    racketDropBeforeContactMs: 115,
    /** Landing: look for the hips' fastest fall within this long after contact. */
    landingSearchMs: 600,
    /** ...which must be at least this fast, or there was no jump (torso lengths/s, TUNE). */
    landingMinHipDropSpeed: 1.0,
    /** First touch comes this long before the hips' fastest fall (dev labels: 5 serves, 40–100 ms; TUNE). */
    landingHipLagMs: 50,
    /** Per-foot landing (which foot lands first): foot speed below this counts as stationary (TUNE). */
    landingStillSpeed: 0.8,
    /** ...for at least this long. */
    landingStillMs: 50,
    /** Foot must first exceed this speed after contact to count as airborne/moving (TUNE). */
    landingMovingSpeed: 2.0,
  },
  footFault: {
    minVisibility: 0.5,
    /** Toe speed below this counts as grounded (TUNE). */
    groundedSpeed: 0.8,
    /** ...and must also be below it for this long before AND after the frame, so the first
     *  frames of a lift (slow but already off the ground) don't count. */
    groundedPadMs: 40,
    /** A fault needs this many ms of consecutive grounded frames past the line. */
    faultMinMs: 50,
    /** Fewer grounded, visible ms than this in the window → "can't tell". */
    minGroundedMs: 200,
    /** Assumed calibration click error (px). */
    clickErrorPx: 3,
    /** Extra allowance for keypoint error (cm). */
    keypointAllowanceCm: 2,
    /** A planted foot further inside the court than this before contact isn't a plausible serve stance:
     *  the court marking (or the tracked person) is almost certainly wrong, so no call is made. */
    implausibleOverCm: 50,
    /** Toe keypoint → shoe tip correction (m, +y). 0 until fitted on labeled serves. */
    shoeTipOffsetM: 0,
  },
  /**
   * Serve-motion checklist. Thresholds are PROVISIONAL coaching rules of thumb,
   * not yet compared with coach ratings.
   * Angles in degrees, from 3D world landmarks.
   */
  motion: {
    /** Joints below this visibility aren't used at all. */
    minVisibility: 0.3,
    /** Measurements using any joint below this visibility are marked "rough". */
    confidentVisibility: 0.5,
    // Legs & power
    /** Deepest knee flexion (180 − hip-knee-ankle angle) before contact (TUNE). */
    kneeFlexionDeg: { good: 40, ok: 25 },
    /** Peak knee extension speed between the deepest bend and contact (TUNE). */
    legDriveDegPerS: { good: 450, ok: 250 },
    /** How far inside the baseline the first foot lands (TUNE). */
    courtDriveCm: { good: 30, ok: 10 },
    // Rotation (yaw relies on the model's depth estimate, its least certain axis)
    /** Shoulder-line turn from trophy to contact; more = stayed side-on longer (TUNE). */
    sideOnTurnDeg: { good: 70, ok: 45 },
    /** Front shoulder above the back shoulder at trophy (TUNE). */
    shoulderTiltDeg: { good: 15, ok: 5 },
    /** Shoulder line turned beyond the hip line at trophy (TUNE). */
    separationDeg: { good: 15, ok: 5 },
    // Arm & contact
    /** Hitting upper arm vs trunk (hip-shoulder-elbow) at trophy; 90 = level with the shoulder line (TUNE). */
    trophyArmAbductionDeg: { good: 75, ok: 55 },
    /** Tossing elbow angle at trophy; 180 = straight (TUNE). */
    tossArmAngleDeg: { good: 155, ok: 135 },
    /** Elbow angle at the racket drop; LOWER = deeper drop (TUNE). */
    racketDropElbowDeg: { good: 110, ok: 135 },
    /** Hitting elbow angle at contact; 180 = straight (TUNE). */
    contactElbowAngleDeg: { good: 160, ok: 145 },
    /** (lower ankle → wrist at contact) ÷ (lower ankle → nose at toss start), each in that frame's torso lengths (TUNE). */
    contactHeightRatio: { good: 1.3, ok: 1.18 },
    pronation: {
      /** Net forearm rotation over the window (TUNE). */
      rotationDeg: { good: 60, ok: 30 },
      beforeMs: 60,
      afterMs: 150,
      /** Below this frame rate the rotation is too fast to follow. */
      minFps: 50,
      /** Share of window frames where the hand must be visible. */
      minVisibleShare: 0.7,
    },
    /** Relative importance in the score. */
    weights: {
      knee_bend: 2, leg_drive: 2, landing_foot: 1, court_drive: 1,
      side_on: 1.5, shoulder_tilt: 1, separation: 1,
      trophy_elbow: 1.5, toss_arm: 1, racket_drop: 1.5, contact_extension: 2, contact_height: 1.5, pronation: 1.5,
      foot_fault: 1,
    },
    /** A score is given once this share of the total weight could be measured… */
    minCoverage: 0.25,
    /** …but below this share it's marked "rough". */
    confidentCoverage: 0.6,
  },
} as const;

export type Params = typeof PARAMS;
export type PhaseParams = Params['phases'];
export type FootFaultParams = Params['footFault'];
export type MotionParams = Params['motion'];
export type SegmentParams = Params['segments'];
export type FootageParams = Params['footage'];
