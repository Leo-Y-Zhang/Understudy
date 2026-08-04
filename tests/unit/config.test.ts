import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG, resolveConfig } from '../../src/core/config';

describe('UnderstudyConfig', () => {
  it('weights sum to 1.0 within 1e-9 tolerance', () => {
    const sum =
      DEFAULT_CONFIG.wEyeContact +
      DEFAULT_CONFIG.wFluency +
      DEFAULT_CONFIG.wPace +
      DEFAULT_CONFIG.wExpression +
      DEFAULT_CONFIG.wBlink +
      DEFAULT_CONFIG.wHead;
    expect(Math.abs(sum - 1.0)).toBeLessThan(1e-9);
  });

  it('resolveConfig merges partial config correctly', () => {
    const resolved = resolveConfig({ exprK: 5 });
    expect(resolved.exprK).toBe(5);
  });

  it('resolveConfig does not mutate DEFAULT_CONFIG', () => {
    const originalExprK = DEFAULT_CONFIG.exprK;
    resolveConfig({ exprK: 999 });
    expect(DEFAULT_CONFIG.exprK).toBe(originalExprK);
  });

  it('resolveConfig with empty object returns DEFAULT_CONFIG values', () => {
    const resolved = resolveConfig({});
    expect(resolved.gazeXOn).toBe(DEFAULT_CONFIG.gazeXOn);
    expect(resolved.blinkOn).toBe(DEFAULT_CONFIG.blinkOn);
    expect(resolved.exprK).toBe(DEFAULT_CONFIG.exprK);
  });

  it('resolveConfig with no argument returns DEFAULT_CONFIG values', () => {
    const resolved = resolveConfig();
    expect(resolved.gazeXOn).toBe(DEFAULT_CONFIG.gazeXOn);
    expect(resolved.blinkOn).toBe(DEFAULT_CONFIG.blinkOn);
  });

  it('DEFAULT_CONFIG sentinel literals match expected values', () => {
    expect(DEFAULT_CONFIG.blinkOn).toBe(0.5);
    expect(DEFAULT_CONFIG.pauseMinS).toBe(1.5);
    expect(DEFAULT_CONFIG.exprK).toBe(4);
    expect(DEFAULT_CONFIG.fidgetGood).toBe(0.05);
    expect(DEFAULT_CONFIG.paceIdealLo).toBe(110);
    expect(DEFAULT_CONFIG.wEyeContact).toBe(0.22);
  });
});
