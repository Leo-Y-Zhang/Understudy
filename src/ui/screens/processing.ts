// Processing screen: transcribes the recording (determinate progress from
// whisperClient's onProgress, or the canned mock words with no network/model
// at all), then runs analyzeSession (fast enough to need no spinner), then
// hands off to a TEMPORARY results view. T15 replaces that results view
// with the real replay screen; this one only proves the pipeline works.

import { App, QuestionPack, QuestionSpec, RunFlags, screenSection } from '../app';
import { formatElapsed, formatPercent, formatScore } from '../format';
import { transcribe } from '../../speech/whisperClient';
import { analyzeSession } from '../../core/analyze';
import { mockWords } from '../../mock/mockData';
import type { ProcessingHandoff } from './session';
import type { SessionAnalysis, SubScores } from '../../core/types';

const MOCK_STEP_PAUSE_MS = 250;

const SUB_SCORE_LABELS: Array<[key: keyof SubScores, label: string]> = [
  ['eyeContact', 'Eye contact'],
  ['blinkSteadiness', 'Blink steadiness'],
  ['expressionControl', 'Expression control'],
  ['headSteadiness', 'Head steadiness'],
  ['pace', 'Pace'],
  ['fluency', 'Fluency'],
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function processingScreen(app: App, props: ProcessingHandoff): HTMLElement {
  const { pack, question, flags, startedAt, result } = props;
  const { section, body } = screenSection('processing', 'Reviewing your take');

  const stepLabel = document.createElement('p');
  stepLabel.className = 'processing-step';
  stepLabel.setAttribute('role', 'status');
  stepLabel.setAttribute('aria-live', 'polite');
  body.appendChild(stepLabel);

  const progressWrap = document.createElement('div');
  progressWrap.className = 'progress-wrap';
  const progressBar = document.createElement('progress');
  progressBar.max = 1;
  progressBar.value = 0;
  const progressPct = document.createElement('span');
  progressPct.className = 'progress-pct';
  progressWrap.append(progressBar, progressPct);
  body.appendChild(progressWrap);

  const errorPanel = document.createElement('div');
  errorPanel.className = 'error-panel';
  errorPanel.hidden = true;
  errorPanel.setAttribute('role', 'alert');
  const errorText = document.createElement('p');
  errorPanel.appendChild(errorText);
  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'btn btn-primary';
  retryBtn.textContent = 'Try again';
  errorPanel.appendChild(retryBtn);
  body.appendChild(errorPanel);

  const setProgress = (p: number): void => {
    progressBar.value = p;
    progressPct.textContent = formatPercent(p);
  };

  const run = async (): Promise<void> => {
    errorPanel.hidden = true;
    stepLabel.hidden = false;
    progressWrap.hidden = false;
    setProgress(0);
    stepLabel.textContent = 'Transcribing your answer…';

    try {
      const words = flags.mock
        ? await (async () => {
            await sleep(MOCK_STEP_PAUSE_MS);
            setProgress(1);
            return mockWords;
          })()
        : await transcribe(requireAudio(result.audio16k), setProgress);

      progressWrap.hidden = true;
      stepLabel.textContent = 'Analysing delivery…';
      if (flags.mock) await sleep(MOCK_STEP_PAUSE_MS);

      const analysis = analyzeSession({
        frames: result.frames,
        words,
        rms: result.rms,
        durationS: result.durationS,
      });

      app.show('results', {
        question,
        packId: pack.id,
        pack,
        startedAt,
        durationS: result.durationS,
        analysis,
        replayBlob: result.blob,
        flags,
      });
    } catch (err) {
      console.error('[processing] failed', err);
      stepLabel.hidden = true;
      progressWrap.hidden = true;
      errorText.textContent = describeProcessingError(err);
      errorPanel.hidden = false;
    }
  };

  retryBtn.addEventListener('click', () => {
    void run();
  });

  void run();

  return section;
}

function requireAudio(audio16k: Float32Array | null): Float32Array {
  if (!audio16k) {
    throw new Error('No audio was captured to transcribe.');
  }
  return audio16k;
}

function describeProcessingError(err: unknown): string {
  void err;
  return 'We couldn’t finish reviewing that take. Nothing was lost — try again, or rehearse once more if this keeps happening.';
}

// --- Temporary results stub (T15 replaces this with the full replay screen) ---

export interface ResultsProps {
  question: QuestionSpec;
  packId: string;
  pack: QuestionPack;
  startedAt: number;
  durationS: number;
  analysis: SessionAnalysis;
  replayBlob: Blob | null;
  flags: RunFlags;
}

export function resultsScreen(app: App, props: ResultsProps): HTMLElement {
  const { pack, analysis, durationS, flags } = props;
  const { section, body } = screenSection('results', 'How that went');

  const badge = document.createElement('p');
  badge.className = 'badge';
  badge.textContent = 'Scorecard only — full replay coming soon';
  body.appendChild(badge);

  const composureWrap = document.createElement('div');
  composureWrap.className = 'composure';
  const composureNumber = document.createElement('span');
  composureNumber.className = 'composure-number';
  composureNumber.textContent = formatScore(analysis.composure);
  const composureLabel = document.createElement('span');
  composureLabel.className = 'composure-label';
  composureLabel.textContent = 'Composure';
  composureWrap.append(composureNumber, composureLabel);
  body.appendChild(composureWrap);

  const subList = document.createElement('dl');
  subList.className = 'sub-scores';
  for (const [key, label] of SUB_SCORE_LABELS) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = formatScore(analysis.sub[key]);
    subList.append(dt, dd);
  }
  body.appendChild(subList);

  const summary = document.createElement('p');
  summary.className = 'results-summary';
  const eventWord = analysis.events.length === 1 ? 'moment' : 'moments';
  summary.textContent = `${analysis.events.length} ${eventWord} flagged across ${formatElapsed(durationS)} of answer.`;
  body.appendChild(summary);

  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'btn btn-primary btn-large';
  again.textContent = 'Rehearse again';
  again.addEventListener('click', () => app.show('home', { pack, flags }));
  body.appendChild(again);

  return section;
}
