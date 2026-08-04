// Processing screen: transcribes the recording (determinate progress from
// whisperClient's onProgress, or the canned mock words with no network/model
// at all), then runs analyzeSession (fast enough to need no spinner), then
// hands off to the replay screen (annotated timeline + scorecard).

import { App, screenSection } from '../app';
import { formatPercent } from '../format';
import { transcribe } from '../../speech/whisperClient';
import { analyzeSession } from '../../core/analyze';
import { mockWords } from '../../mock/mockData';
import type { ProcessingHandoff } from './session';

const MOCK_STEP_PAUSE_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// D10 fix, same reasoning as session.ts's preventUnload: a real recording
// has already been captured by the time this screen mounts, and it isn't
// saved anywhere durable until replay.ts's auto-save runs -- a reload here
// (including while sitting on the error panel; "Try again" only exists
// because the audio is still in memory) silently loses it. Mock mode is
// exempt, same reasoning as session.ts.
function preventUnload(ev: BeforeUnloadEvent): void {
  ev.preventDefault();
  ev.returnValue = '';
}

export function processingScreen(app: App, props: ProcessingHandoff): HTMLElement {
  const { pack, question, flags, startedAt, result } = props;
  const { section, body } = screenSection('processing', 'Reviewing your take');

  if (!flags.mock) {
    window.addEventListener('beforeunload', preventUnload);
    app.onExit(() => window.removeEventListener('beforeunload', preventUnload));
  }

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
  const errorActions = document.createElement('div');
  errorActions.className = 'actions';
  const retryBtn = document.createElement('button');
  retryBtn.type = 'button';
  retryBtn.className = 'btn btn-primary';
  retryBtn.textContent = 'Try again';
  // Matches session.ts's error panel: on a persistent failure (e.g. no
  // audio was captured, or the model can never load), "Try again" fails
  // identically forever -- "Back to home" is the only real way out.
  const homeBtn = document.createElement('button');
  homeBtn.type = 'button';
  homeBtn.className = 'btn btn-ghost';
  homeBtn.textContent = 'Back to home';
  homeBtn.addEventListener('click', () => app.show('home', { pack, flags }));
  errorActions.append(retryBtn, homeBtn);
  errorPanel.appendChild(errorActions);
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

      app.show('replay', {
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
