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
});
