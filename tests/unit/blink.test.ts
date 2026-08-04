import { describe, it, expect } from 'vitest';
import { detectBlinks } from '../../src/core/blink';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { FaceSample } from '../../src/core/types';
import { mkFrames, withBlinks } from './helpers';

describe('detectBlinks', () => {
  // Test 1: 3 blinks spread over 60s
  it('detects 3 well-spaced blinks and reports stats correctly', () => {
    const frames = mkFrames([[60, true]]);
    const framesWithBlinks = withBlinks(frames, [5, 25, 50]);

    const result = detectBlinks(framesWithBlinks, DEFAULT_CONFIG);

    expect(result.blinkTimes.length).toBe(3);
    expect(Math.round(result.blinksPerMin)).toBe(3);
    expect(result.events.length).toBe(0);
  });

  // Test 2a: 4 blinks within 1.8s → one burst event with severity 2
  it('detects a burst of 4 blinks within 1.8s window and reports severity 2', () => {
    const frames = mkFrames([[60, true]]);
    const framesWithBlinks = withBlinks(frames, [10.0, 10.6, 11.2, 11.7]);

    const result = detectBlinks(framesWithBlinks, DEFAULT_CONFIG);

    expect(result.blinkTimes.length).toBe(4);
    expect(result.events.length).toBe(1);
    const event = result.events[0]!;
    expect(event.type).toBe('blink-burst');
    expect(event.severity).toBe(2);
    expect(event.t0).toBeCloseTo(10.0, 1);
    expect(event.t1).toBeCloseTo(11.7, 1);
  });

  // Test 2b: 5 blinks within burst window → severity 3
  it('detects a burst of 5 blinks and reports severity 3', () => {
    const frames = mkFrames([[60, true]]);
    const framesWithBlinks = withBlinks(frames, [10.0, 10.6, 11.2, 11.7, 11.9]);

    const result = detectBlinks(framesWithBlinks, DEFAULT_CONFIG);

    expect(result.blinkTimes.length).toBe(5);
    expect(result.events.length).toBe(1);
    const event = result.events[0]!;
    expect(event.type).toBe('blink-burst');
    expect(event.severity).toBe(3);
  });

  // Test 3: Signal rises only to 0.45 (below blinkOn threshold)
  it('does not detect blinks when signal stays below blinkOn threshold', () => {
    const frames = mkFrames([[10, true]]);
    // Manually set blend values to 0.45 (below blinkOn=0.5)
    frames.forEach(f => {
      f.blend.eyeBlinkLeft = 0.45;
      f.blend.eyeBlinkRight = 0.45;
    });

    const result = detectBlinks(frames, DEFAULT_CONFIG);

    expect(result.blinkTimes.length).toBe(0);
    expect(result.blinksPerMin).toBe(0);
    expect(result.events.length).toBe(0);
  });

  // Test 4: Two threshold crossings 50ms apart, but state doesn't fully reset
  it('detects only one blink when second crossing is within debounce gap and state does not reset', () => {
    const frames = mkFrames([[15, true]]);

    // Frames 300-301: signal high (>= blinkOn)
    // Frame 302: signal between blinkOff and blinkOn (state stays closed)
    // Frames 303-304: signal high again (>= blinkOn, but still in closed state)
    const frameIndex300 = 300;
    const frameIndex302 = 302;

    frames[frameIndex300]!.blend.eyeBlinkLeft = 0.9;
    frames[frameIndex300]!.blend.eyeBlinkRight = 0.9;
    frames[frameIndex300 + 1]!.blend.eyeBlinkLeft = 0.9;
    frames[frameIndex300 + 1]!.blend.eyeBlinkRight = 0.9;
    frames[frameIndex302]!.blend.eyeBlinkLeft = 0.4; // between blinkOff (0.35) and blinkOn (0.5)
    frames[frameIndex302]!.blend.eyeBlinkRight = 0.4;
    frames[frameIndex302 + 1]!.blend.eyeBlinkLeft = 0.9;
    frames[frameIndex302 + 1]!.blend.eyeBlinkRight = 0.9;
    frames[frameIndex302 + 2]!.blend.eyeBlinkLeft = 0.9;
    frames[frameIndex302 + 2]!.blend.eyeBlinkRight = 0.9;

    const result = detectBlinks(frames, DEFAULT_CONFIG);

    expect(result.blinkTimes.length).toBe(1);
  });

  // Test 5: Empty input
  it('returns zeros for empty input', () => {
    const frames: FaceSample[] = [];

    const result = detectBlinks(frames, DEFAULT_CONFIG);

    expect(result.blinkTimes).toEqual([]);
    expect(result.blinksPerMin).toBe(0);
    expect(result.events).toEqual([]);
  });

  // Test 6: Two independent 3-blink clusters ~100s apart must NOT be fabricated
  // into one giant event. Regression for burst-merge using array-index adjacency
  // instead of a time check (bursts.push({startIdx,endIdx}) merged whenever
  // next.startIdx <= current.endIdx + 1, with no regard to the actual time gap
  // between the clusters).
  it('reports two separate burst events for two clusters ~100s apart, not one fabricated event', () => {
    const frames = mkFrames([[102, true]]);
    const framesWithBlinks = withBlinks(frames, [0.0, 0.4, 0.8, 100.0, 100.4, 100.8]);

    const result = detectBlinks(framesWithBlinks, DEFAULT_CONFIG);

    expect(result.blinkTimes.length).toBe(6);
    expect(result.events.length).toBe(2);

    const [first, second] = result.events;
    expect(first!.severity).toBe(2);
    expect(second!.severity).toBe(2);
    expect(first!.t1).toBeLessThan(2);
    expect(second!.t0).toBeGreaterThan(99);
  });

  // Test 7: True debounce suppression. A candidate onset that is blocked by the
  // min-gap check must be gone for good -- it must NOT resurface later as a
  // "new" onset once the clock catches up on the SAME held-high signal.
  // The dip below blinkOff correctly reopens the detector (hysteresis), but the
  // blocked re-crossing at F+3 must still close the detector so the continued
  // high signal cannot trigger a second registration once blinkMinGapS elapses.
  it('permanently suppresses a debounced re-crossing instead of firing it later', () => {
    const cfg = { ...DEFAULT_CONFIG, blinkMinGapS: 0.15 };
    const frames = mkFrames([[15, true]]);

    // Onset at frame 300 (t=10.0s), held high for 2 frames.
    frames[300]!.blend.eyeBlinkLeft = 0.9;
    frames[300]!.blend.eyeBlinkRight = 0.9;
    frames[301]!.blend.eyeBlinkLeft = 0.9;
    frames[301]!.blend.eyeBlinkRight = 0.9;
    // Dip below blinkOff (0.35) at frame 302 -- correctly reopens the detector.
    frames[302]!.blend.eyeBlinkLeft = 0.2;
    frames[302]!.blend.eyeBlinkRight = 0.2;
    // Re-cross at frame 303 (t=10.1s, 0.1s gap < blinkMinGapS 0.15s) and stay
    // high through frame 310 -- long enough that, under the buggy "state stays
    // open on a blocked candidate" behavior, the gap would catch up (>=0.15s
    // at frame 305, t=10.1667s) and fire a spurious second onset on this same
    // held-high run with no new rising edge.
    for (let i = 303; i <= 310; i++) {
      frames[i]!.blend.eyeBlinkLeft = 0.9;
      frames[i]!.blend.eyeBlinkRight = 0.9;
    }

    const result = detectBlinks(frames, cfg);

    expect(result.blinkTimes.length).toBe(1);
  });

  // Test 7b: companion case -- a genuine new rising edge (signal drops back to
  // baseline after the dip, then rises again once the gap is already
  // satisfied) must register normally. Confirms the suppression fix does not
  // over-suppress legitimate distinct onsets.
  it('registers a genuine re-onset once the debounce gap is satisfied', () => {
    const cfg = { ...DEFAULT_CONFIG, blinkMinGapS: 0.15 };
    const frames = mkFrames([[15, true]]);

    frames[300]!.blend.eyeBlinkLeft = 0.9;
    frames[300]!.blend.eyeBlinkRight = 0.9;
    frames[301]!.blend.eyeBlinkLeft = 0.9;
    frames[301]!.blend.eyeBlinkRight = 0.9;
    frames[302]!.blend.eyeBlinkLeft = 0.2;
    frames[302]!.blend.eyeBlinkRight = 0.2;
    // frames 303-305 stay at baseline (0) -- below blinkOff, detector stays open.
    // Re-cross at frame 306 (t=10.2s, 0.2s gap >= blinkMinGapS 0.15s).
    frames[306]!.blend.eyeBlinkLeft = 0.9;
    frames[306]!.blend.eyeBlinkRight = 0.9;
    frames[307]!.blend.eyeBlinkLeft = 0.9;
    frames[307]!.blend.eyeBlinkRight = 0.9;

    const result = detectBlinks(frames, cfg);

    expect(result.blinkTimes.length).toBe(2);
  });

  // Test 8: D4 regression -- durationS must come from real frame timestamps,
  // not an assumed 30fps. Real capture runs at whatever rate the camera and
  // per-frame face-tracking inference sustain (commonly 15fps or lower on a
  // laptop webcam) -- `frames.length / 30` silently inflates the reported
  // rate by (30 / actual fps). Same 60s session, same 17 well-spaced blinks
  // (no bursts: >3s apart, well over burstWindowS=2.0), built at 15fps
  // instead of 30fps -- must still read ~17/min, not ~34/min.
  it('reports the correct blinks/min at 15fps, not inflated by an assumed 30fps', () => {
    const blinkTimesS = Array.from({ length: 17 }, (_, i) => 1 + i * 3.5); // 1..57.0, 17 blinks
    const frames = mkFrames([[60, true]], 15);
    const framesWithBlinks = withBlinks(frames, blinkTimesS, 15);

    const result = detectBlinks(framesWithBlinks, DEFAULT_CONFIG);

    expect(result.blinkTimes.length).toBe(17);
    expect(result.events.length).toBe(0); // no bursts at 3.5s spacing
    expect(Math.round(result.blinksPerMin)).toBe(17);
  });
});
