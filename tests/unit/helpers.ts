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
