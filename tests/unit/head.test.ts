import { describe, it, expect } from 'vitest';
import { headSteadiness } from '../../src/core/head';
import { DEFAULT_CONFIG } from '../../src/core/config';
import { FaceSample } from '../../src/core/types';
import { mkFrames } from './helpers';

describe('headSteadiness', () => {
  // Test 1: Perfectly still frames (all pose 0) for 10s
  // Expected: fidgetIndex ≈ 0 (within 1e-9), no events
  it('returns fidgetIndex ≈ 0 and no events for perfectly still head over 10s', () => {
    const frames = mkFrames([[10, true]]);

    const result = headSteadiness(frames, DEFAULT_CONFIG);

    expect(result.fidgetIndex).toBeLessThan(1e-9);
    expect(result.events.length).toBe(0);
  });

  // Test 2: Constant slow drift (yaw = 0.02*t) over 10s
  // Expected: fidgetIndex ≈ 0.02 (2dp), no events
  it('returns small fidgetIndex for constant slow drift without events', () => {
    const frames = mkFrames([[10, true]]);

    // Modify frames to have yaw = 0.02*t (yaw increases linearly)
    const modifiedFrames = frames.map(f => ({
      ...f,
      yaw: 0.02 * f.t,
    }));

    const result = headSteadiness(modifiedFrames, DEFAULT_CONFIG);

    // Constant drift at 0.02 rad/s should give fidgetIndex close to 0.02
    expect(result.fidgetIndex).toBeCloseTo(0.02, 2);
    expect(result.events.length).toBe(0);
  });

  // Test 3 (authoritative spec): Still 4s + shake 2s (yaw alternates 0.05/0 each
  // frame -> per-frame delta 0.05 rad -> speed 1.5 rad/s) + still 4s.
  // Expected: exactly one event, TRIMMED to the actual shaking samples (t0~4, t1~6),
  // not ballooned by an extra window-width on each side.
  it('detects a shake event trimmed to the shaking region, not ballooned by the window width', () => {
    const frames = mkFrames([[4, true], [2, true], [4, true]]);

    const startShakeFrame = 120; // 4s * 30fps = 120
    const shakeEndFrame = 180;   // 6s * 30fps = 180

    const modifiedFrames = frames.map((f, i) => {
      if (i >= startShakeFrame && i < shakeEndFrame) {
        // Alternate yaw 0.05/0 every frame: per-frame delta 0.05 rad -> speed 1.5 rad/s
        const yaw = (i - startShakeFrame) % 2 === 0 ? 0.05 : 0;
        return { ...f, yaw };
      }
      return f;
    });

    const result = headSteadiness(modifiedFrames, DEFAULT_CONFIG);

    // fidgetIndex should be well above 0.05 due to the shake
    expect(result.fidgetIndex).toBeGreaterThan(0.05);

    // Should have exactly one event
    expect(result.events.length).toBe(1);

    const event = result.events[0]!;
    expect(event.type).toBe('fidget');
    expect(event.severity).toBe(2);

    // Event boundaries must be trimmed to the actual shaking samples, two-sided:
    // t0 close to 4s (not ~2s from window-width ballooning), t1 close to 6s (not ~8s).
    expect(event.t0).toBeGreaterThanOrEqual(3.5);
    expect(event.t0).toBeLessThanOrEqual(4.5);
    expect(event.t1).toBeGreaterThanOrEqual(5.5);
    expect(event.t1).toBeLessThanOrEqual(7.0);

    // Check detail format
    expect(event.detail).toMatch(/^restless \d+\.\d+s$/);
  });

  // Regression: an unrelated present=false occlusion earlier in the session must not
  // shift the detected boundaries of a later shake event. Previously the code mapped
  // window/frame indices directly onto the compacted (present-filtered) speeds array,
  // so an earlier occlusion desynced all later index-based lookups.
  it('does not shift a later shake event when an earlier unrelated occlusion is present', () => {
    const buildSession = (): FaceSample[] => {
      const frames = mkFrames([[6, true], [2, true], [4, true]]);
      const shakeStartFrame = 180; // 6s * 30fps
      const shakeEndFrame = 240;   // 8s * 30fps
      return frames.map((f, i) => {
        if (i >= shakeStartFrame && i < shakeEndFrame) {
          const yaw = (i - shakeStartFrame) % 2 === 0 ? 0.05 : 0;
          return { ...f, yaw };
        }
        return f;
      });
    };

    const sessionA = buildSession();

    // Session B: identical, but frames t=[1,2) are marked not present (a 1s occlusion
    // with garbage yaw that must be ignored entirely, well before the shake at t=6..8).
    const occlusionStart = Math.round(1 * 30);
    const occlusionEnd = Math.round(2 * 30);
    const sessionB = buildSession().map((f, i) => {
      if (i >= occlusionStart && i < occlusionEnd) {
        return { ...f, present: false, yaw: 10.0 };
      }
      return f;
    });

    const resultA = headSteadiness(sessionA, DEFAULT_CONFIG);
    const resultB = headSteadiness(sessionB, DEFAULT_CONFIG);

    expect(resultA.events.length).toBe(1);
    expect(resultB.events.length).toBe(1);

    const eventA = resultA.events[0]!;
    const eventB = resultB.events[0]!;

    expect(Math.abs(eventA.t0 - eventB.t0)).toBeLessThan(0.2);
    expect(Math.abs(eventA.t1 - eventB.t1)).toBeLessThan(0.2);
  });

  // Adjacency merge: two shakes only 0.1s apart must be reported as a single event,
  // not two separate ones.
  it('merges two shakes 0.1s apart into a single event', () => {
    const frames = mkFrames([[4, true], [2, true], [0.1, true], [2, true], [4, true]]);

    const shake1Start = 120; // 4s * 30fps
    const shake1End = 180;   // 6s * 30fps
    const shake2Start = 183; // 6.1s * 30fps
    const shake2End = 243;   // 8.1s * 30fps

    const modifiedFrames = frames.map((f, i) => {
      if (i >= shake1Start && i < shake1End) {
        const yaw = (i - shake1Start) % 2 === 0 ? 0.05 : 0;
        return { ...f, yaw };
      }
      if (i >= shake2Start && i < shake2End) {
        const yaw = (i - shake2Start) % 2 === 0 ? 0.05 : 0;
        return { ...f, yaw };
      }
      return f;
    });

    const result = headSteadiness(modifiedFrames, DEFAULT_CONFIG);

    expect(result.events.length).toBe(1);
  });

  // Adjacency merge (round 2 fix): two shakes separated by a 4.0s CALM gap must be
  // reported as TWO separate events, not fused into one that spans the calm gap.
  // Bug: the merge decision ran on raw (window-padded) regions before trimming, so a
  // gap under ~ (headWindowS * 2 - something) still looked "adjacent" pre-trim and the
  // two episodes fused into one "restless 8.0s" event despite 6 of those seconds being
  // calm. The fix reorders trim-then-merge so the merge condition sees the true
  // (trimmed) gap between shakes.
  it('keeps two shakes separated by a 4.0s calm gap as two distinct events', () => {
    const frames = mkFrames([[4, true], [2, true], [4, true], [2, true], [4, true]]);

    const shake1Start = 120; // 4s * 30fps
    const shake1End = 180;   // 6s * 30fps
    const shake2Start = 300; // 10s * 30fps
    const shake2End = 360;   // 12s * 30fps

    const modifiedFrames = frames.map((f, i) => {
      if (i >= shake1Start && i < shake1End) {
        const yaw = (i - shake1Start) % 2 === 0 ? 0.05 : 0;
        return { ...f, yaw };
      }
      if (i >= shake2Start && i < shake2End) {
        const yaw = (i - shake2Start) % 2 === 0 ? 0.05 : 0;
        return { ...f, yaw };
      }
      return f;
    });

    const result = headSteadiness(modifiedFrames, DEFAULT_CONFIG);

    expect(result.events.length).toBe(2);

    const first = result.events[0]!;
    const second = result.events[1]!;

    // The two events must not merge across the calm gap, and the calm gap itself
    // (t=6..10) must not be swallowed into either event's span.
    expect(first.t1).toBeLessThan(second.t0);
    expect(first.t1).toBeLessThanOrEqual(6.5);
    expect(second.t0).toBeGreaterThanOrEqual(9.5);
  });

  // Test 4a: Empty input
  it('returns zeros for empty input', () => {
    const frames: FaceSample[] = [];

    const result = headSteadiness(frames, DEFAULT_CONFIG);

    expect(result.fidgetIndex).toBe(0);
    expect(result.events.length).toBe(0);
  });

  // Test 4b: Single frame input
  it('returns zeros for single-frame input', () => {
    const frames = mkFrames([[0.1, true]]);

    const result = headSteadiness(frames, DEFAULT_CONFIG);

    expect(result.fidgetIndex).toBe(0);
    expect(result.events.length).toBe(0);
  });

  // Additional: Verify event type, severity, and detail on a fidget event
  it('formats fidget event with correct type, severity 2, and detail string', () => {
    const frames = mkFrames([[2, true], [3, true], [2, true]]);

    // Create a high-speed shake
    const startShakeFrame = 60; // 2s * 30fps = 60
    const endShakeFrame = 90;   // 3s * 30fps = 90

    const modifiedFrames = frames.map((f, i) => {
      if (i >= startShakeFrame && i < endShakeFrame) {
        const yaw = (i - startShakeFrame) % 2 === 0 ? 0.3 : -0.3;
        return { ...f, yaw };
      }
      return f;
    });

    const result = headSteadiness(modifiedFrames, DEFAULT_CONFIG);

    expect(result.events.length).toBeGreaterThan(0);
    const event = result.events[0]!;
    expect(event.type).toBe('fidget');
    expect(event.severity).toBe(2);
    expect(typeof event.detail).toBe('string');
    expect(event.detail).toContain('restless');
  });

  // Test: Frames with present=false should be skipped
  it('skips frames where present=false when calculating speeds', () => {
    const frames = mkFrames([[5, true]]);

    // Mark frames 60-90 as not present
    const modifiedFrames = frames.map((f, i) => {
      if (i >= 60 && i < 90) {
        return { ...f, present: false };
      }
      return f;
    });

    // Set high yaw values in the not-present section (should be ignored)
    modifiedFrames.forEach((f, i) => {
      if (i >= 60 && i < 90) {
        f.yaw = 10.0; // Very high value that would skew results if counted
      }
    });

    const result = headSteadiness(modifiedFrames, DEFAULT_CONFIG);

    // Since the high-yaw frames are marked as not present, they should be ignored
    // The overall fidgetIndex should be very low (close to 0)
    expect(result.fidgetIndex).toBeLessThan(0.01);
    expect(result.events.length).toBe(0);
  });
});
