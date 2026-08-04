// Pure geometry layer between MediaPipe FaceLandmarker's raw output and the
// core FaceSample type. No DOM, no I/O, no MediaPipe imports -- the input is
// typed structurally (FaceLandmarkerResultLike) so core/capture never
// depends on @mediapipe/tasks-vision types directly.
//
// ---------------------------------------------------------------------------
// Rotation matrix convention (eulerFromMatrix)
// ---------------------------------------------------------------------------
// Input: a column-major 4x4 matrix as a flat 16-element array (MediaPipe's
// facialTransformationMatrixes[i].data). Column-major means element r_ij
// (row i, col j) lives at data[j*4 + i].
//
// Euler order: YXZ, i.e. the rotation is decomposed as
//   R = Ry(yaw) * Rx(pitch) * Rz(roll)
// (roll applied first to a vector, then pitch, then yaw -- yaw is the
// outermost/world-frame rotation). This gives, for the rotation part of R:
//
//   r00 = cy*cz + sy*sx*sz      r01 = -cy*sz + sy*sx*cz      r02 = sy*cx
//   r10 = cx*sz                 r11 = cx*cz                  r12 = -sx
//   r20 = -sy*cz + cy*sx*sz     r21 = sy*sz + cy*sx*cz        r22 = cy*cx
//
// where cy/sy = cos/sin(yaw), cx/sx = cos/sin(pitch), cz/sz = cos/sin(roll).
// Decomposition (valid away from the pitch = +-90deg gimbal lock):
//   pitch = asin(-r12)
//   yaw   = atan2(r02, r22)
//   roll  = atan2(r10, r11)
//
// Sign meaning (TENTATIVE -- not yet verified against a live camera; this is
// a placeholder mapping to be checked and, if needed, flipped during T12's
// manual sign calibration against the real webcam. If it flips, fix the
// formulas above and update the corresponding tests to match, per the task
// brief):
//   - positive yaw   = head turned toward the camera's right
//   - positive pitch = head tilted down (nose toward chest)
//   - positive roll  = head tilted (ear toward shoulder) clockwise as seen
//                       by the camera
//
// The round-trip test in tests/unit/facemath.test.ts is the arbiter of
// correctness for this convention: a test helper builds a matrix from known
// yaw/pitch/roll using the exact formulas above, and eulerFromMatrix must
// invert it to within 1e-6 over a +-60deg grid of combined angles. Several
// single-axis matrices are also hand-derived independently (matching the
// textbook Rx/Ry/Rz forms) to guard against a self-consistent-but-wrong
// convention slipping past the round-trip check alone.
// ---------------------------------------------------------------------------
//
// ---------------------------------------------------------------------------
// Gaze convention (gazeFromLandmarks)
// ---------------------------------------------------------------------------
// Per eye: gazeX = (iris.x - mid(corners).x) / halfWidth
//          gazeY = (iris.y - mid(lids).y) / halfHeight
// where halfWidth/halfHeight are half the corner-to-corner / lid-to-lid
// distance. Final gazeX/gazeY = mean of both eyes, clamped to [-1, 1].
// Division by a degenerate (near-zero) half-width or half-height returns 0
// for that eye's contribution rather than Infinity/NaN.
// ---------------------------------------------------------------------------

import type { Blend, FaceSample } from '../core/types';

// MediaPipe FaceMesh + iris landmark indices (478-point model).
const LEFT_IRIS = 468;
const RIGHT_IRIS = 473;
const LEFT_OUTER = 33;
const LEFT_INNER = 133;
const RIGHT_INNER = 362;
const RIGHT_OUTER = 263;
const LEFT_UPPER_LID = 159;
const LEFT_LOWER_LID = 145;
const RIGHT_UPPER_LID = 386;
const RIGHT_LOWER_LID = 374;

const GIMBAL_EPS = 1e-6;
const DEGENERATE_EPS = 1e-9;

// ---------------------------------------------------------------------------
// eulerFromMatrix
// ---------------------------------------------------------------------------

export function eulerFromMatrix(
  data: ArrayLike<number>
): { yaw: number; pitch: number; roll: number } {
  const el = (i: number): number => data[i] ?? 0;

  const r00 = el(0);
  const r10 = el(1);
  const r01 = el(4);
  const r11 = el(5);
  const r12 = el(9);
  const r02 = el(8);
  const r22 = el(10);

  const sinPitch = Math.max(-1, Math.min(1, -r12));
  const pitch = Math.asin(sinPitch);
  const cosPitch = Math.sqrt(1 - sinPitch * sinPitch);

  let yaw: number;
  let roll: number;

  if (cosPitch > GIMBAL_EPS) {
    yaw = Math.atan2(r02, r22);
    roll = Math.atan2(r10, r11);
  } else {
    // Gimbal lock at pitch ~= +-90deg: only yaw +- roll is recoverable.
    // Convention: pin roll to 0 and fold the remaining rotation into yaw.
    roll = 0;
    yaw = sinPitch > 0 ? Math.atan2(r01, r00) : Math.atan2(-r01, r00);
  }

  return { yaw, pitch, roll };
}

// ---------------------------------------------------------------------------
// gazeFromLandmarks
// ---------------------------------------------------------------------------

interface Point2 {
  x: number;
  y: number;
}

export function gazeFromLandmarks(
  lm: ArrayLike<Point2>
): { gazeX: number; gazeY: number } {
  const leftX = axisOffset(
    landmarkAt(lm, LEFT_IRIS).x,
    landmarkAt(lm, LEFT_OUTER).x,
    landmarkAt(lm, LEFT_INNER).x
  );
  const leftY = axisOffset(
    landmarkAt(lm, LEFT_IRIS).y,
    landmarkAt(lm, LEFT_UPPER_LID).y,
    landmarkAt(lm, LEFT_LOWER_LID).y
  );
  const rightX = axisOffset(
    landmarkAt(lm, RIGHT_IRIS).x,
    landmarkAt(lm, RIGHT_INNER).x,
    landmarkAt(lm, RIGHT_OUTER).x
  );
  const rightY = axisOffset(
    landmarkAt(lm, RIGHT_IRIS).y,
    landmarkAt(lm, RIGHT_UPPER_LID).y,
    landmarkAt(lm, RIGHT_LOWER_LID).y
  );

  return {
    gazeX: clamp((leftX + rightX) / 2, -1, 1),
    gazeY: clamp((leftY + rightY) / 2, -1, 1),
  };
}

function axisOffset(coord: number, cornerA: number, cornerB: number): number {
  const mid = (cornerA + cornerB) / 2;
  const half = Math.abs(cornerA - cornerB) / 2;
  if (half < DEGENERATE_EPS) return 0;
  return (coord - mid) / half;
}

function landmarkAt(lm: ArrayLike<Point2>, i: number): Point2 {
  const p = lm[i];
  if (p === undefined) {
    throw new Error(
      `facemath: expected landmark index ${i} (need FaceMesh+iris output, 478 points)`
    );
  }
  return p;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// toFaceSample
// ---------------------------------------------------------------------------

// Structural type matching MediaPipe's FaceLandmarkerResult shape, defined
// locally so this module (and anything consuming it) never imports
// @mediapipe/tasks-vision.
export interface FaceLandmarkerResultLike {
  faceLandmarks: Array<Array<{ x: number; y: number; z?: number }>>;
  faceBlendshapes: Array<{
    categories: Array<{ categoryName: string; score: number }>;
  }>;
  facialTransformationMatrixes: Array<{ data: ArrayLike<number> }>;
}

const ZERO_BLEND: Blend = {
  eyeBlinkLeft: 0, eyeBlinkRight: 0,
  browDownLeft: 0, browDownRight: 0,
  mouthPressLeft: 0, mouthPressRight: 0,
  mouthSmileLeft: 0, mouthSmileRight: 0,
};

function blendFromCategories(
  categories: ReadonlyArray<{ categoryName: string; score: number }>
): Blend {
  const byName = new Map(categories.map((c) => [c.categoryName, c.score]));
  return {
    eyeBlinkLeft: byName.get('eyeBlinkLeft') ?? 0,
    eyeBlinkRight: byName.get('eyeBlinkRight') ?? 0,
    browDownLeft: byName.get('browDownLeft') ?? 0,
    browDownRight: byName.get('browDownRight') ?? 0,
    mouthPressLeft: byName.get('mouthPressLeft') ?? 0,
    mouthPressRight: byName.get('mouthPressRight') ?? 0,
    mouthSmileLeft: byName.get('mouthSmileLeft') ?? 0,
    mouthSmileRight: byName.get('mouthSmileRight') ?? 0,
  };
}

export function toFaceSample(
  t: number,
  result: FaceLandmarkerResultLike
): FaceSample {
  const landmarks = result.faceLandmarks[0];
  if (!landmarks || landmarks.length === 0) {
    return {
      t,
      present: false,
      blend: ZERO_BLEND,
      yaw: 0, pitch: 0, roll: 0,
      gazeX: 0, gazeY: 0,
    };
  }

  const categories = result.faceBlendshapes[0]?.categories ?? [];
  const blend = blendFromCategories(categories);

  const matrixData = result.facialTransformationMatrixes[0]?.data;
  const { yaw, pitch, roll } = matrixData
    ? eulerFromMatrix(matrixData)
    : { yaw: 0, pitch: 0, roll: 0 };

  const { gazeX, gazeY } = gazeFromLandmarks(landmarks);

  return { t, present: true, blend, yaw, pitch, roll, gazeX, gazeY };
}
