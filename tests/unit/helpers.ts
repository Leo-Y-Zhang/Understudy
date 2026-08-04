import { FaceSample } from '../../src/core/types';

/**
 * Create FaceSample frames for testing.
 * @param spec Array of [durationSeconds, isOnCamera] pairs
 * @param fps Sample rate frames are generated at (default 30, matching the
 *   nominal rate most of the suite assumes). Real capture runs at whatever
 *   rate the camera and per-frame face-tracking inference sustain --
 *   commonly well under 30fps -- so callers proving rate-independence (e.g.
 *   blink.test.ts's 15fps regression) pass an explicit lower value here.
 * @returns FaceSample array at the given fps
 *
 * on=true: present=true, all blend keys 0, head angles (yaw, pitch, roll) 0, gaze offsets (X, Y) 0
 * on=false: same but gazeX 0.9 (averted)
 */
export function mkFrames(spec: Array<[number, boolean]>, fps = 30): FaceSample[] {
  const frames: FaceSample[] = [];
  let frameIndex = 0;

  for (const [durS, isOn] of spec) {
    const numFrames = Math.round(durS * fps);
    for (let i = 0; i < numFrames; i++) {
      const t = frameIndex / fps;
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
 * @param fps Sample rate the source `frames` were built at (default 30) --
 *   must match whatever `fps` was passed to `mkFrames`, since this converts
 *   a time in seconds to a frame index the same way.
 * @returns New frame array with blinks injected
 */
export function withBlinks(frames: FaceSample[], atSeconds: number[], fps = 30): FaceSample[] {
  const result = frames.map(f => ({
    ...f,
    blend: { ...f.blend }
  }));

  for (const tBlinkS of atSeconds) {
    const frameIndex = Math.round(tBlinkS * fps);
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
