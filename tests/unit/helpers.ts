import { FaceSample } from '../../src/core/types';

/**
 * Create FaceSample frames for testing.
 * @param spec Array of [durationSeconds, isOnCamera] pairs
 * @returns FaceSample array at 30 fps
 *
 * on=true: present=true, all blend keys 0, head angles (yaw, pitch, roll) 0, gaze offsets (X, Y) 0
 * on=false: same but gazeX 0.9 (averted)
 */
export function mkFrames(spec: Array<[number, boolean]>): FaceSample[] {
  const frames: FaceSample[] = [];
  let frameIndex = 0;

  for (const [durS, isOn] of spec) {
    const numFrames = Math.round(durS * 30);
    for (let i = 0; i < numFrames; i++) {
      const t = frameIndex / 30;
      frames.push({
        t,
        present: true,
        blend: {
          eyeBlinkLeft: 0,
          eyeBlinkRight: 0,
          browDownLeft: 0,
          browDownRight: 0,
          mouthPressLeft: 0,
          mouthPressRight: 0,
          mouthSmileLeft: 0,
          mouthSmileRight: 0,
        },
        yaw: 0,
        pitch: 0,
        roll: 0,
        gazeX: isOn ? 0 : 0.9,
        gazeY: 0,
      });
      frameIndex++;
    }
  }

  return frames;
}

/**
 * Add blinks to a frame array at specified times.
 * Sets eyeBlinkLeft and eyeBlinkRight to 0.9 for 3 consecutive frames at each time.
 * Non-mutating: returns a new array with affected frames cloned.
 * @param frames Source frames
 * @param atSeconds Array of blink times in seconds
 * @returns New frame array with blinks injected
 */
export function withBlinks(frames: FaceSample[], atSeconds: number[]): FaceSample[] {
  const result = frames.map(f => ({
    ...f,
    blend: { ...f.blend }
  }));

  for (const tBlinkS of atSeconds) {
    const frameIndex = Math.round(tBlinkS * 30);
    // Set 3 consecutive frames starting at frameIndex
    for (let i = 0; i < 3; i++) {
      const idx = frameIndex + i;
      if (idx >= 0 && idx < result.length) {
        const frame = result[idx]!;
        frame.blend.eyeBlinkLeft = 0.9;
        frame.blend.eyeBlinkRight = 0.9;
      }
    }
  }

  return result;
}
