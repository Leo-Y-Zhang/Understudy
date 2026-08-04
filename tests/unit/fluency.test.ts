import { describe, it, expect } from 'vitest';
import { fluency } from '../../src/core/fluency';
import { DEFAULT_CONFIG as cfg } from '../../src/core/config';
import { TimedWord, VadSegment } from '../../src/core/types';

/**
 * Build TimedWords with contiguous timing: word i occupies
 * [startT + i*spacingS, startT + i*spacingS + durS). Defaults to fully
 * contiguous words (durS = spacingS, i.e. word i's t1 == word i+1's t0).
 */
function mkWords(texts: string[], startT = 0, spacingS = 0.4, durS = spacingS): TimedWord[] {
  return texts.map((text, i) => ({
    text,
    t0: startT + i * spacingS,
    t1: startT + i * spacingS + durS,
  }));
}

/**
 * Build contiguous TimedWords from blocks of [count, spacingS], each word
 * spanning exactly one spacingS-wide slot, immediately following the last.
 */
function mkWordBlocks(blocks: Array<[count: number, spacingS: number]>, startT = 0): TimedWord[] {
  const words: TimedWord[] = [];
  let t = startT;
  let idx = 0;
  for (const [count, spacingS] of blocks) {
    for (let i = 0; i < count; i++) {
      words.push({ text: `w${idx}`, t0: t, t1: t + spacingS });
      t += spacingS;
      idx++;
    }
  }
  return words;
}

describe('fluency', () => {
  it('computes wpm ~150 for 150 words spread evenly over exactly 60s of speech', () => {
    const words = mkWords(
      Array.from({ length: 150 }, (_, i) => `w${i}`),
      0,
      0.4
    );
    const segments: VadSegment[] = [{ t0: 0, t1: 60, speech: true }];

    const result = fluency(words, segments, cfg);

    expect(result.wordCount).toBe(150);
    expect(result.wpm).toBeCloseTo(150, 0);
  });

  it('detects fillers in a mixed transcript, in order, with correct spans and details', () => {
    // "So um I think you know the answer is basically that I mean it works like magic"
    const texts = [
      'So', 'um', 'I', 'think', 'you', 'know', 'the', 'answer', 'is',
      'basically', 'that', 'I', 'mean', 'it', 'works', 'like', 'magic',
    ];
    const words = mkWords(texts, 0, 0.4);

    const result = fluency(words, [], cfg);

    expect(result.fillerEvents).toHaveLength(5);
    expect(result.fillerEvents.map((e) => e.detail)).toEqual([
      "'um'",
      "'you know'",
      "'basically'",
      "'i mean'",
      "'like'",
    ]);
    for (const e of result.fillerEvents) {
      expect(e.type).toBe('filler');
      expect(e.severity).toBe(1);
    }

    // Single-word events span exactly that word.
    expect(result.fillerEvents[0]).toMatchObject({ t0: words[1]!.t0, t1: words[1]!.t1 });
    expect(result.fillerEvents[2]).toMatchObject({ t0: words[9]!.t0, t1: words[9]!.t1 });
    expect(result.fillerEvents[4]).toMatchObject({ t0: words[15]!.t0, t1: words[15]!.t1 });

    // Phrase events span both consumed words ('you know' = words[4..5], 'i mean' = words[11..12]).
    expect(result.fillerEvents[1]).toMatchObject({ t0: words[4]!.t0, t1: words[5]!.t1 });
    expect(result.fillerEvents[3]).toMatchObject({ t0: words[11]!.t0, t1: words[12]!.t1 });

    // 'so', the standalone 'i's, 'think' etc are not in the lexicon and are not flagged
    // -- already pinned by the exact 5-event list and detail strings above.
  });

  it('flags "like" in "I like maths" (documented heuristic: all instances count)', () => {
    const words = mkWords(['I', 'like', 'maths'], 0, 0.4);

    const result = fluency(words, [], cfg);

    expect(result.fillerEvents).toHaveLength(1);
    expect(result.fillerEvents[0]!.detail).toBe("'like'");
    expect(result.fillerEvents[0]).toMatchObject({ t0: words[1]!.t0, t1: words[1]!.t1 });
  });

  it('normalizes punctuation before matching ("Um," + "you" + "know.")', () => {
    const words = mkWords(['Um,', 'you', 'know.'], 0, 0.4);

    const result = fluency(words, [], cfg);

    expect(result.fillerEvents).toHaveLength(2);
    expect(result.fillerEvents.map((e) => e.detail)).toEqual(["'um'", "'you know'"]);
    expect(result.fillerEvents[0]).toMatchObject({ t0: words[0]!.t0, t1: words[0]!.t1 });
    expect(result.fillerEvents[1]).toMatchObject({ t0: words[1]!.t0, t1: words[2]!.t1 });
  });

  it('paceCv is close to 0 for a constant, evenly-spaced pace over 30s', () => {
    // 60 contiguous words at 0.5s spacing (120 wpm) spanning [0, 30).
    const words = mkWordBlocks([[60, 0.5]]);

    const result = fluency(words, [], cfg);

    expect(result.paceCv).toBeCloseTo(0, 2);
  });

  it('paceCv is well above 0.2 for a sharply varying pace (200wpm then 60wpm)', () => {
    // 15s at 200wpm spacing (0.3s/word, 50 words) then 15s at 60wpm spacing (1s/word, 15 words).
    const words = mkWordBlocks([
      [50, 0.3],
      [15, 1],
    ]);

    const result = fluency(words, [], cfg);

    expect(result.paceCv).toBeGreaterThan(0.2);
  });

  it('empty input produces zeros and empty arrays, with no NaN', () => {
    const segments: VadSegment[] = [{ t0: 0, t1: 10, speech: true }];

    const result = fluency([], segments, cfg);

    expect(result.wordCount).toBe(0);
    expect(result.wpm).toBe(0);
    expect(result.paceCv).toBe(0);
    expect(result.fillerEvents).toEqual([]);
    expect(Number.isFinite(result.wpm)).toBe(true);
    expect(Number.isFinite(result.paceCv)).toBe(true);
  });

  it('falls back to word span for speaking time when segments have no speech', () => {
    // 60 contiguous words at 0.5s spacing spanning exactly [0, 30).
    const words = mkWordBlocks([[60, 0.5]]);

    const resultNoSegments = fluency(words, [], cfg);
    expect(resultNoSegments.wpm).toBeCloseTo(120, 0);

    const resultAllSilence: VadSegment[] = [{ t0: 0, t1: 30, speech: false }];
    const result2 = fluency(words, resultAllSilence, cfg);
    expect(result2.wpm).toBeCloseTo(120, 0);
  });
});
