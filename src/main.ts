import './styles.css';
import { Camera } from './capture/camera';
import { FaceTracker } from './capture/faceTracker';
import { AudioMeter } from './capture/audio';
import { Recorder } from './capture/recorder';
import { MockTracker } from './mock/mockTracker';
import type { FaceSample } from './core/types';

// Temporary dev HUD proving the capture layer (camera, MediaPipe face
// tracking, audio RMS, recorder) works end to end. This becomes T14's setup
// screen; the design here is intentionally utilitarian.

const IS_MOCK = new URLSearchParams(location.search).get('mock') === '1';
const RAD_TO_DEG = 180 / Math.PI;
const RATE_WINDOW_MS = 1000;
const RMS_POLL_MS = 100;

interface Els {
  startBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  recordBtn: HTMLButtonElement;
  video: HTMLVideoElement;
  status: HTMLParagraphElement;
  present: HTMLElement;
  yaw: HTMLElement;
  pitch: HTMLElement;
  roll: HTMLElement;
  gazeX: HTMLElement;
  gazeY: HTMLElement;
  blink: HTMLElement;
  rate: HTMLElement;
  rms: HTMLProgressElement;
}

interface Session {
  camera: Camera | null;
  tracker: { stop(): void } | null;
  audioMeter: AudioMeter | null;
  recorder: Recorder | null;
  recording: boolean;
  rmsPollHandle: ReturnType<typeof setInterval> | null;
  sampleTimes: number[];
}

function main(): void {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) return;

  app.innerHTML = renderHud();
  const els = queryEls(app);

  const session: Session = {
    camera: null,
    tracker: null,
    audioMeter: null,
    recorder: null,
    recording: false,
    rmsPollHandle: null,
    sampleTimes: [],
  };

  els.startBtn.addEventListener('click', () => {
    void startSession(els, session);
  });
  els.stopBtn.addEventListener('click', () => {
    void stopSession(els, session);
  });
  els.recordBtn.addEventListener('click', () => {
    void toggleRecording(els, session);
  });
}

function renderHud(): string {
  return `
    <div class="hud">
      <h1>Understudy -- capture dev HUD${IS_MOCK ? ' (mock tracker)' : ''}</h1>
      <p class="hud-note">calibration pending: verify yaw sign turns right-positive (see src/capture/facemath.ts header)</p>
      <div class="hud-controls">
        <button type="button" id="start-btn">Start camera</button>
        <button type="button" id="stop-btn" disabled>Stop</button>
        <button type="button" id="record-btn" disabled>Start recording</button>
      </div>
      <div class="hud-body">
        <video id="preview" class="video-mirror" muted playsinline></video>
        <dl class="hud-meters">
          <dt>present</dt><dd id="m-present">--</dd>
          <dt>yaw (deg)</dt><dd id="m-yaw">--</dd>
          <dt>pitch (deg)</dt><dd id="m-pitch">--</dd>
          <dt>roll (deg)</dt><dd id="m-roll">--</dd>
          <dt>gazeX</dt><dd id="m-gazex">--</dd>
          <dt>gazeY</dt><dd id="m-gazey">--</dd>
          <dt>blink (max eyeBlink)</dt><dd id="m-blink">--</dd>
          <dt>sample rate (Hz)</dt><dd id="m-rate">--</dd>
          <dt>audio RMS</dt><dd><progress id="m-rms" max="1" value="0"></progress></dd>
        </dl>
      </div>
      <p class="hud-status" id="status">idle</p>
    </div>
  `;
}

function queryEls(app: HTMLDivElement): Els {
  const q = <T extends HTMLElement>(sel: string): T => {
    const el = app.querySelector<T>(sel);
    if (!el) throw new Error(`hud: missing element ${sel}`);
    return el;
  };
  return {
    startBtn: q('#start-btn'),
    stopBtn: q('#stop-btn'),
    recordBtn: q('#record-btn'),
    video: q('#preview'),
    status: q('#status'),
    present: q('#m-present'),
    yaw: q('#m-yaw'),
    pitch: q('#m-pitch'),
    roll: q('#m-roll'),
    gazeX: q('#m-gazex'),
    gazeY: q('#m-gazey'),
    blink: q('#m-blink'),
    rate: q('#m-rate'),
    rms: q('#m-rms'),
  };
}

async function startSession(els: Els, session: Session): Promise<void> {
  els.startBtn.disabled = true;
  els.status.textContent = IS_MOCK ? 'starting mock tracker...' : 'requesting camera...';
  session.sampleTimes = [];

  try {
    if (IS_MOCK) {
      const tracker = new MockTracker();
      await tracker.start((s) => onSample(els, session, s));
      session.tracker = tracker;
    } else {
      const camera = new Camera();
      const stream = await camera.start();
      session.camera = camera;

      els.video.srcObject = stream;
      await els.video.play();

      const audioMeter = new AudioMeter();
      await audioMeter.start(stream);
      session.audioMeter = audioMeter;
      session.rmsPollHandle = setInterval(() => {
        els.rms.value = audioMeter.getLatestRms();
      }, RMS_POLL_MS);

      const tracker = new FaceTracker();
      await tracker.start(els.video, (s) => onSample(els, session, s));
      session.tracker = tracker;

      session.recorder = new Recorder();
      els.recordBtn.disabled = false;
    }

    els.stopBtn.disabled = false;
    els.status.textContent = 'running';
  } catch (err) {
    console.error('[hud] failed to start session', err);
    const message = err instanceof Error ? err.message : String(err);
    await stopSession(els, session);
    els.status.textContent = `error: ${message}`;
  }
}

async function stopSession(els: Els, session: Session): Promise<void> {
  els.stopBtn.disabled = true;
  els.startBtn.disabled = false;
  els.recordBtn.disabled = true;
  els.recordBtn.textContent = 'Start recording';

  if (session.recording && session.recorder) {
    try {
      const { blob, audio16k } = await session.recorder.stop();
      console.log(`[hud] recording stopped: ${blob.size} bytes, ${audio16k.length} samples @16kHz`);
    } catch (err) {
      console.warn('[hud] recorder stop failed', err);
    }
  }
  session.recording = false;
  session.recorder = null;

  session.tracker?.stop();
  session.tracker = null;

  if (session.audioMeter) {
    const series = session.audioMeter.stopAndGetSeries();
    console.log(`[hud] audio series: ${series.values.length} hops @ hopS=${series.hopS}`);
  }
  session.audioMeter = null;

  if (session.rmsPollHandle !== null) {
    clearInterval(session.rmsPollHandle);
    session.rmsPollHandle = null;
  }
  els.rms.value = 0;

  session.camera?.stop();
  session.camera = null;
  els.video.srcObject = null;

  els.status.textContent = 'idle';
}

async function toggleRecording(els: Els, session: Session): Promise<void> {
  const recorder = session.recorder;
  const stream = els.video.srcObject;
  if (!recorder || !(stream instanceof MediaStream)) return;

  if (session.recording) {
    const { blob, audio16k } = await recorder.stop();
    session.recording = false;
    els.recordBtn.textContent = 'Start recording';
    const msg = `last recording: ${(blob.size / 1024).toFixed(1)} KB webm, ${audio16k.length} samples @16kHz`;
    els.status.textContent = msg;
    console.log(`[hud] ${msg}`);
  } else {
    recorder.start(stream);
    session.recording = true;
    els.recordBtn.textContent = 'Stop recording';
    els.status.textContent = 'recording...';
  }
}

function onSample(els: Els, session: Session, s: FaceSample): void {
  els.present.textContent = s.present ? 'yes' : 'no';
  els.yaw.textContent = (s.yaw * RAD_TO_DEG).toFixed(1);
  els.pitch.textContent = (s.pitch * RAD_TO_DEG).toFixed(1);
  els.roll.textContent = (s.roll * RAD_TO_DEG).toFixed(1);
  els.gazeX.textContent = s.gazeX.toFixed(2);
  els.gazeY.textContent = s.gazeY.toFixed(2);
  els.blink.textContent = Math.max(s.blend.eyeBlinkLeft, s.blend.eyeBlinkRight).toFixed(2);

  const now = performance.now();
  session.sampleTimes.push(now);
  const cutoff = now - RATE_WINDOW_MS;
  while (session.sampleTimes.length > 0 && (session.sampleTimes[0] ?? 0) < cutoff) {
    session.sampleTimes.shift();
  }
  els.rate.textContent = String(session.sampleTimes.length);
}

main();
