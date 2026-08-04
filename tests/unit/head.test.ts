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

  // Test 3: Still 4s + violent shake 2s (rapid alternating yaw) + still 4s
  // Expected: one event covering the shake region, fidgetIndex well above 0.05
  it('detects a violent shake event in the middle of stable motion', () => {
    const frames = mkFrames([[4, true], [2, true], [4, true]]);

    // Modify frames: at the 4s mark, start rapidly alternating yaw ±0.3 rad every frame
    // This creates very high angular speeds (~18 rad/s during the shake)
    const startShakeFrame = 120; // 4s * 30fps = 120
    const shakeEndFrame = 180;   // 6s * 30fps = 180

    const modifiedFrames = frames.map((f, i) => {
      if (i >= startShakeFrame && i < shakeEndFrame) {
        // Alternate yaw every frame during shake period
        const yaw = (i - startShakeFrame) % 2 === 0 ? 0.3 : -0.3;
        return { ...f, yaw };
      }
      return f;
    });

    const result = headSteadiness(modifiedFrames, DEFAULT_CONFIG);

    // fidgetIndex should be well above 0.05 due to the violent shake
    expect(result.fidgetIndex).toBeGreaterThan(0.05);

    // Should have exactly one event
    expect(result.events.length).toBe(1);

    const event = result.events[0]!;
    expect(event.type).toBe('fidget');
    expect(event.severity).toBe(2);

    // Event should encompass the shake region
    // With sliding windows, the event may start slightly before and end slightly after
    expect(event.t0).toBeLessThanOrEqual(4.0);
    expect(event.t1).toBeGreaterThanOrEqual(6.0);

    // Check detail format
    expect(event.detail).toMatch(/^restless \d+\.\d+s$/);
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
