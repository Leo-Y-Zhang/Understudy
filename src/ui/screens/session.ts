// Session screen: starts capture the moment it mounts (consent is already
// granted, and reaching this screen was itself a direct result of a user
// click or an already-visible countdown finishing), shows a live camera
// preview with a REC indicator and elapsed timer, collects FaceSamples, and
// on Stop tears everything down and hands the raw material to Processing.

import { App, QuestionPack, QuestionSpec, RunFlags, screenSection } from '../app';
import { formatElapsed } from '../format';
import { Camera } from '../../capture/camera';
import { FaceTracker } from '../../capture/faceTracker';
import { AudioMeter } from '../../capture/audio';
import { Recorder } from '../../capture/recorder';
import { MockTracker } from '../../mock/mockTracker';
import { mockRms } from '../../mock/mockData';
import type { FaceSample, RmsSeries } from '../../core/types';

const ELAPSED_TICK_MS = 250;

export interface SessionProps {
  pack: QuestionPack;
  question: QuestionSpec;
  flags: RunFlags;
}

export interface SessionResult {
  frames: FaceSample[];
  rms: RmsSeries;
  blob: Blob | null;
  audio16k: Float32Array | null;
  durationS: number;
}

export interface ProcessingHandoff {
  pack: QuestionPack;
  question: QuestionSpec;
  flags: RunFlags;
  startedAt: number;
  result: SessionResult;
}

export function sessionScreen(app: App, props: SessionProps): HTMLElement {
  const { pack, question, flags } = props;
  const { section, body } = screenSection('session', 'Recording your answer', 'sr-only');
  section.classList.add('screen-session');

  const status = document.createElement('p');
  status.className = 'session-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = flags.mock ? 'Starting rehearsal…' : 'Setting up your camera…';
  body.appendChild(status);

  const indicator = document.createElement('div');
  indicator.className = 'rec-indicator';
  const dot = document.createElement('span');
  dot.className = 'rec-dot';
  dot.setAttribute('aria-hidden', 'true');
  const recLabel = document.createElement('span');
  recLabel.className = 'rec-label';
  recLabel.textContent = 'Recording';
  const elapsed = document.createElement('span');
  elapsed.className = 'rec-elapsed';
  elapsed.textContent = formatElapsed(0);
  indicator.append(dot, recLabel, elapsed);
  indicator.hidden = true;
  body.appendChild(indicator);

  const previewWrap = document.createElement('div');
  previewWrap.className = 'preview-wrap';
  body.appendChild(previewWrap);

  let video: HTMLVideoElement | null = null;
  if (flags.mock) {
    const mockPreview = document.createElement('div');
    mockPreview.className = 'mock-preview';
    const pulse = document.createElement('div');
    pulse.className = 'mock-preview-pulse';
    pulse.setAttribute('aria-hidden', 'true');
    const label = document.createElement('p');
    label.textContent = 'Rehearsal mode — no camera in use';
    mockPreview.append(pulse, label);
    previewWrap.appendChild(mockPreview);
  } else {
    video = document.createElement('video');
    video.className = 'preview-video';
    video.muted = true;
    video.playsInline = true;
    previewWrap.appendChild(video);
  }

  const stopBtn = document.createElement('button');
  stopBtn.type = 'button';
  stopBtn.className = 'btn btn-stop';
  stopBtn.textContent = 'Stop';
  stopBtn.disabled = true;
  body.appendChild(stopBtn);

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
  const homeBtn = document.createElement('button');
  homeBtn.type = 'button';
  homeBtn.className = 'btn btn-ghost';
  homeBtn.textContent = 'Back to home';
  homeBtn.addEventListener('click', () => app.show('home', { pack, flags }));
  errorActions.append(retryBtn, homeBtn);
  errorPanel.appendChild(errorActions);
  body.appendChild(errorPanel);

  const frames: FaceSample[] = [];
  let camera: Camera | null = null;
  let tracker: FaceTracker | MockTracker | null = null;
  let audioMeter: AudioMeter | null = null;
  let recorder: Recorder | null = null;
  let elapsedHandle: ReturnType<typeof setInterval> | null = null;
  let startedAt = 0;
  let stopping = false;

  const onSample = (s: FaceSample): void => {
    frames.push(s);
  };

  const showError = (message: string): void => {
    status.hidden = true;
    indicator.hidden = true;
    previewWrap.hidden = true;
    stopBtn.hidden = true;
    errorText.textContent = message;
    errorPanel.hidden = false;
  };

  const start = async (): Promise<void> => {
    frames.length = 0;
    errorPanel.hidden = true;
    status.hidden = false;
    indicator.hidden = true;
    previewWrap.hidden = false;
    stopBtn.hidden = false;
    stopBtn.disabled = true;
    status.textContent = flags.mock ? 'Starting rehearsal…' : 'Setting up your camera…';

    try {
      if (flags.mock) {
        const mockTracker = new MockTracker();
        await mockTracker.start(onSample, { fast: flags.fast });
        tracker = mockTracker;
      } else {
        const cam = new Camera();
        const stream = await cam.start();
        camera = cam;

        if (video) {
          video.srcObject = stream;
          await video.play();
        }

        const meter = new AudioMeter();
        await meter.start(stream);
        audioMeter = meter;

        const faceTracker = new FaceTracker();
        if (video) await faceTracker.start(video, onSample);
        tracker = faceTracker;

        const rec = new Recorder();
        rec.start(stream);
        recorder = rec;
      }

      startedAt = Date.now();
      status.textContent = '';
      status.hidden = true;
      indicator.hidden = false;
      stopBtn.disabled = false;

      elapsedHandle = setInterval(() => {
        elapsed.textContent = formatElapsed((Date.now() - startedAt) / 1000);
      }, ELAPSED_TICK_MS);
    } catch (err) {
      console.error('[session] failed to start capture', err);
      teardownCapture();
      showError(describeCaptureError(err));
    }
  };

  function teardownCapture(): void {
    if (elapsedHandle !== null) {
      clearInterval(elapsedHandle);
      elapsedHandle = null;
    }
    tracker?.stop();
    tracker = null;
    audioMeter = null;
    recorder = null;
    camera?.stop();
    camera = null;
    if (video) video.srcObject = null;
  }

  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    stopBtn.disabled = true;
    if (elapsedHandle !== null) {
      clearInterval(elapsedHandle);
      elapsedHandle = null;
    }

    let result: SessionResult;

    if (flags.mock) {
      tracker?.stop();
      const lastT = frames.length > 0 ? frames[frames.length - 1]!.t : 0;
      result = { frames: frames.slice(), rms: mockRms, blob: null, audio16k: null, durationS: lastT };
    } else {
      const durationS = (Date.now() - startedAt) / 1000;
      tracker?.stop();
      const rms = audioMeter ? audioMeter.stopAndGetSeries() : { hopS: 0.05, values: new Float32Array(0) };
      let blob: Blob | null = null;
      let audio16k: Float32Array | null = null;
      if (recorder) {
        try {
          const out = await recorder.stop();
          blob = out.blob;
          audio16k = out.audio16k;
        } catch (err) {
          console.warn('[session] recorder stop failed', err);
        }
      }
      camera?.stop();
      if (video) video.srcObject = null;
      result = { frames: frames.slice(), rms, blob, audio16k, durationS };
    }

    const handoff: ProcessingHandoff = { pack, question, flags, startedAt, result };
    app.show('processing', handoff);
  };

  stopBtn.addEventListener('click', () => {
    void stop();
  });

  retryBtn.addEventListener('click', () => {
    void start();
  });

  void start();

  return section;
}

function describeCaptureError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'We couldn’t reach your camera or microphone. Check your browser’s permission for this page, then try again.';
    case 'NotFoundError':
      return 'No camera or microphone was found on this device.';
    case 'NotReadableError':
      return 'Your camera or microphone seems to be in use by another app. Close it and try again.';
    default:
      return 'Something stopped your camera or microphone from starting. Try again.';
  }
}
