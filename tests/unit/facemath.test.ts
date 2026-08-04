import { describe, it, expect } from 'vitest';
import {
  eulerFromMatrix,
  gazeFromLandmarks,
  toFaceSample,
  type FaceLandmarkerResultLike,
} from '../../src/capture/facemath';

// ---------------------------------------------------------------------------
// Test helper: builds a column-major 4x4 rotation matrix from known
// yaw/pitch/roll using EXACTLY the convention documented in the header of
// src/capture/facemath.ts: R = Ry(yaw) * Rx(pitch) * Rz(roll) (YXZ order),
// stored column-major so data[col*4+row] === R[row][col].
//
// This is the independent "known geometry" used to assert eulerFromMatrix
// inverts the convention correctly -- the round-trip is the arbiter of sign
// conventions, per the task brief.
// ---------------------------------------------------------------------------
function buildMatrix(yawRad: number, pitchRad: number, rollRad: number): number[] {
  const cy = Math.cos(yawRad);
  const sy = Math.sin(yawRad);
  const cx = Math.cos(pitchRad);
  const sx = Math.sin(pitchRad);
  const cz = Math.cos(rollRad);
  const sz = Math.sin(rollRad);

  const r00 = cy * cz + sy * sx * sz;
  const r01 = -cy * sz + sy * sx * cz;
  const r02 = sy * cx;
  const r10 = cx * sz;
  const r11 = cx * cz;
  const r12 = -sx;
  const r20 = -sy * cz + cy * sx * sz;
  const r21 = sy * sz + cy * sx * cz;
  const r22 = cy * cx;

  // column-major: [col0 (4 rows), col1, col2, col3]
  return [
    r00, r10, r20, 0,
    r01, r11, r21, 0,
    r02, r12, r22, 0,
    0, 0, 0, 1,
  ];
}

const toRad = (deg: number): number => (deg * Math.PI) / 180;

describe('eulerFromMatrix', () => {
  it('identity matrix (literal, not built via helper) -> all zeros', () => {
    const identity = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const out = eulerFromMatrix(identity);
    expect(out.yaw).toBeCloseTo(0, 12);
    expect(out.pitch).toBeCloseTo(0, 12);
    expect(out.roll).toBeCloseTo(0, 12);
  });

  it('pure yaw=90deg, hand-derived literal matrix (independent of buildMatrix helper)', () => {
    // Ry(90deg) = [[0,0,1],[0,1,0],[-1,0,0]] (standard rotation-about-Y matrix),
    // stored column-major.
    const data = [
      0, 0, -1, 0,
      0, 1, 0, 0,
      1, 0, 0, 0,
      0, 0, 0, 1,
    ];
    const out = eulerFromMatrix(data);
    expect(out.yaw).toBeCloseTo(Math.PI / 2, 9);
    expect(out.pitch).toBeCloseTo(0, 9);
    expect(out.roll).toBeCloseTo(0, 9);
  });

  it('pure pitch=30deg, hand-derived literal matrix (standard Rx)', () => {
    const cx = Math.cos(toRad(30));
    const sx = Math.sin(toRad(30));
    // Rx(30deg) = [[1,0,0],[0,cx,-sx],[0,sx,cx]], column-major.
    const data = [
      1, 0, 0, 0,
      0, cx, sx, 0,
      0, -sx, cx, 0,
      0, 0, 0, 1,
    ];
    const out = eulerFromMatrix(data);
    expect(out.yaw).toBeCloseTo(0, 9);
    expect(out.pitch).toBeCloseTo(toRad(30), 9);
    expect(out.roll).toBeCloseTo(0, 9);
  });

  it('pure roll=45deg, hand-derived literal matrix (standard Rz)', () => {
    const cz = Math.cos(toRad(45));
    const sz = Math.sin(toRad(45));
    // Rz(45deg) = [[cz,-sz,0],[sz,cz,0],[0,0,1]], column-major.
    const data = [
      cz, sz, 0, 0,
      -sz, cz, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const out = eulerFromMatrix(data);
    expect(out.yaw).toBeCloseTo(0, 9);
    expect(out.pitch).toBeCloseTo(0, 9);
    expect(out.roll).toBeCloseTo(toRad(45), 9);
  });

  it('round-trips combined yaw/pitch/roll to within 1e-6 across a +/-60deg grid', () => {
    const DEG = [-60, -40, -20, -5, 0, 5, 20, 40, 60];
    let combos = 0;
    for (const yawDeg of DEG) {
      for (const pitchDeg of DEG) {
        for (const rollDeg of DEG) {
          const yaw = toRad(yawDeg);
          const pitch = toRad(pitchDeg);
          const roll = toRad(rollDeg);
          const m = buildMatrix(yaw, pitch, roll);
          const out = eulerFromMatrix(m);
          expect(Math.abs(out.yaw - yaw)).toBeLessThan(1e-6);
          expect(Math.abs(out.pitch - pitch)).toBeLessThan(1e-6);
          expect(Math.abs(out.roll - roll)).toBeLessThan(1e-6);
          combos++;
        }
      }
    }
    // sanity: make sure the grid actually ran combined (not single-axis) cases
    expect(combos).toBe(DEG.length ** 3);
  });
});

// ---------------------------------------------------------------------------
// gazeFromLandmarks
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number };

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

function baseLandmarks(): Pt[] {
  // 474 slots (indices 0..473) so all required indices are always defined.
  return Array.from({ length: 474 }, () => ({ x: 0, y: 0 }));
}

describe('gazeFromLandmarks', () => {
  it('iris exactly at eye centre (both eyes) -> gazeX ~ 0, gazeY ~ 0', () => {
    const lm = baseLandmarks();
    // left eye: corners at x=0.5/0.6 -> mid 0.55, lids at y=0.45/0.55 -> mid 0.5
    lm[LEFT_OUTER] = { x: 0.6, y: 0.5 };
    lm[LEFT_INNER] = { x: 0.5, y: 0.5 };
    lm[LEFT_UPPER_LID] = { x: 0.55, y: 0.45 };
    lm[LEFT_LOWER_LID] = { x: 0.55, y: 0.55 };
    lm[LEFT_IRIS] = { x: 0.55, y: 0.5 };
    // right eye, mirrored
    lm[RIGHT_INNER] = { x: 0.45, y: 0.5 };
    lm[RIGHT_OUTER] = { x: 0.35, y: 0.5 };
    lm[RIGHT_UPPER_LID] = { x: 0.4, y: 0.45 };
    lm[RIGHT_LOWER_LID] = { x: 0.4, y: 0.55 };
    lm[RIGHT_IRIS] = { x: 0.4, y: 0.5 };

    const out = gazeFromLandmarks(lm);
    expect(out.gazeX).toBeCloseTo(0, 9);
    expect(out.gazeY).toBeCloseTo(0, 9);
  });

  it('left iris at inner corner (133 higher x than outer 33) -> gazeX = +1 by the formula', () => {
    const lm = baseLandmarks();
    lm[LEFT_OUTER] = { x: 0.4, y: 0.5 }; // outer, lower x
    lm[LEFT_INNER] = { x: 0.6, y: 0.5 }; // inner, higher x -> mid 0.5, half 0.1
    lm[LEFT_UPPER_LID] = { x: 0.5, y: 0.45 };
    lm[LEFT_LOWER_LID] = { x: 0.5, y: 0.55 };
    lm[LEFT_IRIS] = { x: 0.6, y: 0.5 }; // iris at inner corner exactly

    // right eye centred (contributes 0 so left eye's value is isolated after averaging)
    lm[RIGHT_INNER] = { x: 0.45, y: 0.5 };
    lm[RIGHT_OUTER] = { x: 0.35, y: 0.5 };
    lm[RIGHT_UPPER_LID] = { x: 0.4, y: 0.45 };
    lm[RIGHT_LOWER_LID] = { x: 0.4, y: 0.55 };
    lm[RIGHT_IRIS] = { x: 0.4, y: 0.5 };

    const out = gazeFromLandmarks(lm);
    // mean of left(+1) and right(0) == 0.5
    expect(out.gazeX).toBeCloseTo(0.5, 9);
    expect(out.gazeY).toBeCloseTo(0, 9);
  });

  it('degenerate left-eye corners (coincident) guard against divide-by-zero: forced 0, not Infinity/NaN', () => {
    const lm = baseLandmarks();
    // left corners coincide -> halfWidth == 0
    lm[LEFT_OUTER] = { x: 0.5, y: 0.5 };
    lm[LEFT_INNER] = { x: 0.5, y: 0.5 };
    lm[LEFT_UPPER_LID] = { x: 0.5, y: 0.45 };
    lm[LEFT_LOWER_LID] = { x: 0.5, y: 0.55 };
    lm[LEFT_IRIS] = { x: 0.6, y: 0.5 }; // offset from the degenerate corners

    // right eye: iris at outer corner -> contributes exactly +1
    lm[RIGHT_INNER] = { x: 0.4, y: 0.5 };
    lm[RIGHT_OUTER] = { x: 0.6, y: 0.5 };
    lm[RIGHT_UPPER_LID] = { x: 0.6, y: 0.45 };
    lm[RIGHT_LOWER_LID] = { x: 0.6, y: 0.55 };
    lm[RIGHT_IRIS] = { x: 0.6, y: 0.5 };

    const out = gazeFromLandmarks(lm);
    expect(Number.isFinite(out.gazeX)).toBe(true);
    expect(Number.isFinite(out.gazeY)).toBe(true);
    // if the guard did NOT fire, left would be Infinity and the mean would
    // clamp to 1, not 0.5 -- this distinguishes "guarded to 0" from "broken".
    expect(out.gazeX).toBeCloseTo(0.5, 9);
  });

  it('clamps to [-1,1] when offset exceeds the eye geometry', () => {
    const lm = baseLandmarks();
    lm[LEFT_OUTER] = { x: 0.4, y: 0.5 };
    lm[LEFT_INNER] = { x: 0.6, y: 0.5 };
    lm[LEFT_UPPER_LID] = { x: 0.5, y: 0.45 };
    lm[LEFT_LOWER_LID] = { x: 0.5, y: 0.55 };
    lm[LEFT_IRIS] = { x: 10, y: 0.5 }; // way outside eye geometry

    lm[RIGHT_INNER] = { x: 0.45, y: 0.5 };
    lm[RIGHT_OUTER] = { x: 0.35, y: 0.5 };
    lm[RIGHT_UPPER_LID] = { x: 0.4, y: 0.45 };
    lm[RIGHT_LOWER_LID] = { x: 0.4, y: 0.55 };
    lm[RIGHT_IRIS] = { x: 0.4, y: 0.5 };

    const out = gazeFromLandmarks(lm);
    expect(out.gazeX).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// toFaceSample
// ---------------------------------------------------------------------------

function centredGazeLandmarks(): Pt[] {
  const lm = baseLandmarks();
  lm[LEFT_OUTER] = { x: 0.6, y: 0.5 };
  lm[LEFT_INNER] = { x: 0.5, y: 0.5 };
  lm[LEFT_UPPER_LID] = { x: 0.55, y: 0.45 };
  lm[LEFT_LOWER_LID] = { x: 0.55, y: 0.55 };
  lm[LEFT_IRIS] = { x: 0.55, y: 0.5 };
  lm[RIGHT_INNER] = { x: 0.45, y: 0.5 };
  lm[RIGHT_OUTER] = { x: 0.35, y: 0.5 };
  lm[RIGHT_UPPER_LID] = { x: 0.4, y: 0.45 };
  lm[RIGHT_LOWER_LID] = { x: 0.4, y: 0.55 };
  lm[RIGHT_IRIS] = { x: 0.4, y: 0.5 };
  return lm;
}

describe('toFaceSample', () => {
  it('no face detected (empty faceLandmarks) -> present:false, zeros elsewhere', () => {
    const result: FaceLandmarkerResultLike = {
      faceLandmarks: [],
      faceBlendshapes: [],
      facialTransformationMatrixes: [],
    };
    const sample = toFaceSample(1.5, result);
    expect(sample).toEqual({
      t: 1.5,
      present: false,
      blend: {
        eyeBlinkLeft: 0, eyeBlinkRight: 0,
        browDownLeft: 0, browDownRight: 0,
        mouthPressLeft: 0, mouthPressRight: 0,
        mouthSmileLeft: 0, mouthSmileRight: 0,
      },
      yaw: 0, pitch: 0, roll: 0, gazeX: 0, gazeY: 0,
    });
  });

  it('face present: assembles blend (missing keys -> 0), euler angles, and gaze', () => {
    const yaw = toRad(20);
    const pitch = toRad(10);
    const roll = toRad(-15);
    const matrixData = buildMatrix(yaw, pitch, roll);

    const result: FaceLandmarkerResultLike = {
      faceLandmarks: [centredGazeLandmarks()],
      faceBlendshapes: [
        {
          categories: [
            { categoryName: 'eyeBlinkLeft', score: 0.2 },
            { categoryName: 'eyeBlinkRight', score: 0.3 },
            { categoryName: 'browDownLeft', score: 0.4 },
            { categoryName: 'browDownRight', score: 0.5 },
            { categoryName: 'mouthPressLeft', score: 0.6 },
            { categoryName: 'mouthPressRight', score: 0.7 },
            // mouthSmileLeft / mouthSmileRight intentionally omitted
            { categoryName: 'jawOpen', score: 0.9 }, // unrelated category, must be ignored
          ],
        },
      ],
      facialTransformationMatrixes: [{ data: matrixData }],
    };

    const sample = toFaceSample(2.25, result);

    expect(sample.t).toBe(2.25);
    expect(sample.present).toBe(true);
    expect(sample.blend).toEqual({
      eyeBlinkLeft: 0.2, eyeBlinkRight: 0.3,
      browDownLeft: 0.4, browDownRight: 0.5,
      mouthPressLeft: 0.6, mouthPressRight: 0.7,
      mouthSmileLeft: 0, mouthSmileRight: 0,
    });
    expect(sample.yaw).toBeCloseTo(yaw, 6);
    expect(sample.pitch).toBeCloseTo(pitch, 6);
    expect(sample.roll).toBeCloseTo(roll, 6);
    expect(sample.gazeX).toBeCloseTo(0, 9);
    expect(sample.gazeY).toBeCloseTo(0, 9);
  });
});
