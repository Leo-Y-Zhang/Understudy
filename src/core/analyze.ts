import { SessionInput, SessionAnalysis, SessionStats, DeliveryEvent } from './types';
import { UnderstudyConfig, resolveConfig } from './config';
import { detectGaze } from './gaze';
import { detectBlinks } from './blink';
import { detectExpressionEvents } from './expression';
import { headSteadiness } from './head';
import { segmentSpeech, detectPauses } from './vad';
import { fluency } from './fluency';
import { scoreSession } from './scoring';

export function analyzeSession(
  input: SessionInput,
  cfg?: Partial<UnderstudyConfig>
): SessionAnalysis {
  const resolved = resolveConfig(cfg);

  const gazeResult = detectGaze(input.frames, resolved);
  const blinkResult = detectBlinks(input.frames, resolved);
  const expressionEvents = detectExpressionEvents(input.frames, resolved);
  const headResult = headSteadiness(input.frames, resolved);
  const vadSegments = segmentSpeech(input.rms, resolved);
  const pauseEvents = detectPauses(vadSegments, resolved);
  const fluencyResult = fluency(input.words, vadSegments, resolved);

  const events: DeliveryEvent[] = [
    ...gazeResult.events,
    ...blinkResult.events,
    ...expressionEvents,
    ...headResult.events,
    ...pauseEvents,
    ...fluencyResult.fillerEvents,
  ];
  events.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);

  const { sub, composure } = scoreSession(
    {
      eyeContactPct: gazeResult.eyeContactPct,
      blinksPerMin: blinkResult.blinksPerMin,
      burstCount: blinkResult.events.length,
      expressionEvents,
      fidgetIndex: headResult.fidgetIndex,
      wpm: fluencyResult.wpm,
      paceCv: fluencyResult.paceCv,
      fillerEvents: fluencyResult.fillerEvents,
      pauseEvents,
      durationS: input.durationS,
    },
    resolved
  );

  const stats: SessionStats = {
    durationS: input.durationS,
    eyeContactPct: gazeResult.eyeContactPct,
    blinksPerMin: blinkResult.blinksPerMin,
    wpm: fluencyResult.wpm,
    paceCv: fluencyResult.paceCv,
    fillerCount: fluencyResult.fillerEvents.length,
    pauseCount: pauseEvents.length,
    fidgetIndex: headResult.fidgetIndex,
    wordCount: fluencyResult.wordCount,
  };

  return { events, sub, composure, stats };
}
