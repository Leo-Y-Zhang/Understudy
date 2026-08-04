// Replay screen: the killer feature. Your recorded answer, every delivery
// event plotted on a scrubbable timeline, and the scorecard -- all on one
// screen, reachable straight from Processing (T14's throwaway results stub
// is gone; this is its real replacement).
//
// Three parallel readings of the same event data, by design:
//  (a) a <canvas> timeline -- fast, visual, aria-hidden (decorative only);
//  (b) an accessible <ol> of seek buttons -- the list IS the accessible
//      timeline, not a fallback bolted on afterwards;
//  (c) the scorecard's stats row -- the same session summarised as numbers.
// A screen reader or keyboard-only user gets the full picture from (b) and
// (c) alone; the canvas never carries information those two don't already
// say in text.

import { App, QuestionPack, QuestionSpec, RunFlags, screenSection } from '../app';
import { clamp, formatElapsed, formatPercent, formatScore } from '../format';
import { layoutTimeline, TIMELINE_LANE_ORDER } from '../timeline';
import { drawQuestion } from './home';
import { openDb, UnderstudyDb, SessionRecord } from '../../data/db';
import type { DeliveryEvent, EventType, SessionAnalysis, SubScores } from '../../core/types';

export interface ReplayProps {
  question: QuestionSpec;
  packId: string;
  pack: QuestionPack;
  startedAt: number;
  durationS: number;
  analysis: SessionAnalysis;
  replayBlob: Blob | null;
  flags: RunFlags;
  /**
   * True when this replay was opened from the dashboard with an
   * already-saved record: the video (if any) came from `getReplay()`, not a
   * fresh recording, so there is nothing to auto-save and no "keep video"
   * toggle. Undefined/false (Processing's own handoff never sets this) means
   * a fresh session, which auto-saves itself on mount -- see buildSavePanel.
   */
  readonly?: boolean;
  /**
   * True when this record's `hasReplay` was true but no matching video
   * could be loaded (the `replays` row is missing, or reading it failed) --
   * i.e. a video WAS captured for this session and is gone, as opposed to
   * `replayBlob` being null because this mode/session never captured one at
   * all. Only dashboard.ts's openReplayFromRecord can tell these apart (it
   * has `rec.hasReplay` to compare against); changes the placeholder/hint
   * copy below to say so honestly instead of the generic "no video
   * captured in this mode".
   */
  replayMissing?: boolean;
}

/** Exported so the dashboard's "latest vs. best" rows use the exact same
 *  six keys, order and wording as the scorecard above -- one source of
 *  truth for what a sub-score is called. */
export const SUB_SCORE_LABELS: Array<[key: keyof SubScores, label: string]> = [
  ['eyeContact', 'Eye contact'],
  ['blinkSteadiness', 'Blink steadiness'],
  ['expressionControl', 'Expression control'],
  ['headSteadiness', 'Head steadiness'],
  ['pace', 'Pace'],
  ['fluency', 'Fluency'],
];

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  'gaze-break': 'Gaze break',
  'blink-burst': 'Blink burst',
  expression: 'Expression',
  fidget: 'Fidget',
  pause: 'Pause',
  filler: 'Filler',
};

const SEEK_BACK_S = 0.5;
// r2 art-direction fix: the tracks were reading as six giant empty progress
// bars, dwarfing the marks they're meant to carry. Lanes are shorter, their
// background is a low-contrast rail rather than a filled pill (lower alpha,
// tighter corner radius), and marks are inset less so they fill more of
// that shorter lane -- the events are the stars, not the tracks.
const LANE_HEIGHT_PX = 18;
const LANE_GAP_PX = 5;
const MARK_INSET_Y_PX = 2;
const MARK_RADIUS_PX = 5;
const LANE_BG_RADIUS_PX = 3;
const LANE_BG_ALPHA = 0.42;
// Small muted lane labels drawn inside the canvas's left edge, a drawing-
// only addition (layoutTimeline() in timeline.ts is untouched -- this just
// lays the same proportional marks out over a narrower track and offsets
// them past the label gutter when drawing).
const LANE_LABEL_GUTTER_PX = 44;
const LANE_SHORT_LABELS: Record<EventType, string> = {
  'gaze-break': 'GAZE',
  'blink-burst': 'BLINK',
  expression: 'EXPR',
  fidget: 'FIDGET',
  pause: 'PAUSE',
  filler: 'FILLER',
};
const CANVAS_HEIGHT_PX =
  TIMELINE_LANE_ORDER.length * LANE_HEIGHT_PX + (TIMELINE_LANE_ORDER.length - 1) * LANE_GAP_PX;

export function replayScreen(app: App, props: ReplayProps): HTMLElement {
  const { pack, analysis, durationS, replayBlob, flags, readonly, replayMissing } = props;
  const { section, body } = screenSection('replay', 'Your replay');
  section.classList.add('screen-replay');

  const video = buildVideoPanel(app, body, replayBlob, replayMissing);
  buildTimeline(body, analysis.events, durationS, video);
  buildEventList(body, analysis.events, video, replayMissing);
  buildScorecard(body, props);
  if (!readonly) buildSavePanel(body, props);
  buildActions(app, body, pack, flags, readonly);

  return section;
}

// --- Video panel ------------------------------------------------------

function buildVideoPanel(
  app: App,
  body: HTMLElement,
  replayBlob: Blob | null,
  replayMissing?: boolean
): HTMLVideoElement | null {
  const wrap = document.createElement('div');
  wrap.className = 'replay-video-wrap';

  if (!replayBlob) {
    const placeholder = document.createElement('div');
    placeholder.className = 'replay-video-placeholder';
    const icon = buildCameraOffIcon();
    const text = document.createElement('p');
    text.textContent = replayMissing
      ? 'Your video is no longer available'
      : 'No video captured in this mode';
    placeholder.append(icon, text);
    wrap.appendChild(placeholder);
    body.appendChild(wrap);
    return null;
  }

  const objectUrl = URL.createObjectURL(replayBlob);
  const video = document.createElement('video');
  video.className = 'replay-video';
  video.src = objectUrl;
  video.controls = true;
  video.muted = false;
  video.playsInline = true;
  wrap.appendChild(video);
  body.appendChild(wrap);

  app.onExit(() => URL.revokeObjectURL(objectUrl));

  return video;
}

// r2 art-direction fix: the old placeholder icon was a blurred radial-
// gradient dot that read as a screen defect ("a small green smudge"), not a
// deliberate mark. A plain stroked camera-off glyph reads cleanly at small
// size and needs no animation to justify its presence.
function buildCameraOffIcon(): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'camera-off-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const body = document.createElementNS(NS, 'rect');
  body.setAttribute('x', '3');
  body.setAttribute('y', '6');
  body.setAttribute('width', '13');
  body.setAttribute('height', '12');
  body.setAttribute('rx', '2');

  const flap = document.createElementNS(NS, 'path');
  flap.setAttribute('d', 'M16 10 L21 7 L21 17 L16 14 Z');

  const slash = document.createElementNS(NS, 'line');
  slash.setAttribute('x1', '2');
  slash.setAttribute('y1', '2');
  slash.setAttribute('x2', '22');
  slash.setAttribute('y2', '22');

  svg.append(body, flap, slash);
  return svg;
}

// --- Timeline (canvas + legend) ----------------------------------------

function buildTimeline(
  body: HTMLElement,
  events: DeliveryEvent[],
  durationS: number,
  video: HTMLVideoElement | null
): void {
  const wrap = document.createElement('div');
  wrap.className = 'timeline';

  const heading = document.createElement('h2');
  heading.className = 'section-heading';
  heading.textContent = 'Annotated timeline';
  wrap.appendChild(heading);

  // Decorative reinforcement of identity: every type is already named in
  // the accessible event list below, so the legend itself is aria-hidden.
  const legend = document.createElement('ul');
  legend.className = 'timeline-legend';
  legend.setAttribute('aria-hidden', 'true');
  for (const type of TIMELINE_LANE_ORDER) {
    const item = document.createElement('li');
    item.className = 'timeline-legend-item';
    const swatch = document.createElement('span');
    swatch.className = `timeline-swatch timeline-swatch-${type}`;
    const label = document.createElement('span');
    label.textContent = EVENT_TYPE_LABELS[type];
    item.append(swatch, label);
    legend.appendChild(item);
  }
  wrap.appendChild(legend);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'timeline-canvas-wrap';
  const canvas = document.createElement('canvas');
  canvas.className = 'timeline-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  if (!video) canvas.classList.add('timeline-canvas-inert');
  canvasWrap.appendChild(canvas);
  wrap.appendChild(canvasWrap);

  body.appendChild(wrap);

  const render = (): void => {
    const widthCss = Math.max(1, Math.round(canvasWrap.getBoundingClientRect().width));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(widthCss * dpr);
    canvas.height = Math.round(CANVAS_HEIGHT_PX * dpr);
    canvas.style.width = `${widthCss}px`;
    canvas.style.height = `${CANVAS_HEIGHT_PX}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, widthCss, CANVAS_HEIGHT_PX);

    const styles = getComputedStyle(canvas);
    const laneBg = styles.getPropertyValue('--color-line').trim() || '#2b3226';
    const labelColor = styles.getPropertyValue('--color-text-muted').trim() || '#9aa08c';
    const trackWidthCss = Math.max(1, widthCss - LANE_LABEL_GUTTER_PX);

    ctx.font = '9px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = labelColor;
    for (let lane = 0; lane < TIMELINE_LANE_ORDER.length; lane++) {
      const y = lane * (LANE_HEIGHT_PX + LANE_GAP_PX);
      fillRoundedRect(ctx, LANE_LABEL_GUTTER_PX, y, trackWidthCss, LANE_HEIGHT_PX, LANE_BG_RADIUS_PX, laneBg, LANE_BG_ALPHA);
      ctx.fillStyle = labelColor;
      ctx.fillText(LANE_SHORT_LABELS[TIMELINE_LANE_ORDER[lane]!], 0, y + LANE_HEIGHT_PX / 2);
    }

    const marks = layoutTimeline(events, durationS, trackWidthCss);
    for (const mark of marks) {
      const y = mark.lane * (LANE_HEIGHT_PX + LANE_GAP_PX) + MARK_INSET_Y_PX;
      const h = LANE_HEIGHT_PX - MARK_INSET_Y_PX * 2;
      const color = styles.getPropertyValue(`--lane-${mark.event.type}`).trim() || '#8fb093';
      fillRoundedRect(
        ctx,
        mark.x + LANE_LABEL_GUTTER_PX,
        y,
        mark.w,
        h,
        MARK_RADIUS_PX,
        color,
        severityOpacity(mark.event.severity)
      );
    }

    if (video && durationS > 0) {
      const fraction = clamp(video.currentTime / durationS, 0, 1);
      const playheadColor = styles.getPropertyValue('--color-brass').trim() || '#d9b54a';
      const playheadX = LANE_LABEL_GUTTER_PX + fraction * trackWidthCss;
      ctx.strokeStyle = playheadColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, CANVAS_HEIGHT_PX);
      ctx.stroke();
    }
  };

  // ResizeObserver fires once immediately on observe() with the element's
  // current size, so this both draws the initial frame (deferred until the
  // canvas actually has layout, which it doesn't yet at this point in
  // replayScreen()) and redraws on any later resize -- no manual rAF loop.
  const resizeObserver = new ResizeObserver(render);
  resizeObserver.observe(canvasWrap);

  if (video) {
    // `timeupdate` fires a few times a second during playback -- a full
    // redraw per tick is cheap for a handful of lanes/marks, so this is the
    // whole playhead sync; no continuous rAF polling loop needed.
    video.addEventListener('timeupdate', render);

    canvas.addEventListener('click', (ev) => {
      const rect = canvas.getBoundingClientRect();
      const trackWidth = Math.max(1, rect.width - LANE_LABEL_GUTTER_PX);
      const fraction = clamp((ev.clientX - rect.left - LANE_LABEL_GUTTER_PX) / trackWidth, 0, 1);
      video.currentTime = fraction * durationS;
    });
  }
}

function severityOpacity(severity: DeliveryEvent['severity']): number {
  switch (severity) {
    case 1:
      return 0.55;
    case 2:
      return 0.78;
    default:
      return 1;
  }
}

function fillRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
  alpha: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, radius);
  } else {
    ctx.rect(x, y, w, h);
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.globalAlpha = 1;
}

// --- Accessible event list ----------------------------------------------

function buildEventList(
  body: HTMLElement,
  events: DeliveryEvent[],
  video: HTMLVideoElement | null,
  replayMissing?: boolean
): void {
  const wrap = document.createElement('div');
  wrap.className = 'event-list-wrap';

  const heading = document.createElement('h2');
  heading.className = 'section-heading';
  heading.textContent = 'Moments flagged';
  wrap.appendChild(heading);

  if (events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'event-list-empty';
    empty.textContent = 'Nothing flagged this time — a clean take.';
    wrap.appendChild(empty);
    body.appendChild(wrap);
    return;
  }

  if (!video) {
    const hint = document.createElement('p');
    hint.className = 'event-list-hint';
    hint.textContent = replayMissing
      ? 'Your video is no longer available, so these can’t be seeked to — the timestamps and details below are still accurate.'
      : 'No video was captured in this mode, so these can’t be seeked to — the timestamps and details below are still accurate.';
    wrap.appendChild(hint);
  }

  const list = document.createElement('ol');
  list.className = 'event-list';

  for (const event of events) {
    const item = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'event-item';

    const swatch = document.createElement('span');
    swatch.className = `timeline-swatch timeline-swatch-${event.type}`;
    swatch.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.textContent = `[${formatElapsed(event.t0)}] ${EVENT_TYPE_LABELS[event.type]} — ${event.detail}`;

    btn.append(swatch, text);

    if (video) {
      const seekVideo = video;
      btn.addEventListener('click', () => {
        seekVideo.currentTime = Math.max(0, event.t0 - SEEK_BACK_S);
        seekVideo.play().catch((err) => console.warn('[replay] video.play failed', err));
      });
    } else {
      btn.setAttribute('aria-disabled', 'true');
      btn.title = replayMissing ? 'Your video is no longer available' : 'No video captured in this mode';
    }

    item.appendChild(btn);
    list.appendChild(item);
  }

  wrap.appendChild(list);
  body.appendChild(wrap);
}

// --- Scorecard ------------------------------------------------------------

function buildScorecard(body: HTMLElement, props: ReplayProps): void {
  const { analysis } = props;
  const wrap = document.createElement('div');
  wrap.className = 'scorecard';

  const heading = document.createElement('h2');
  heading.className = 'section-heading';
  heading.textContent = 'Scorecard';
  wrap.appendChild(heading);

  const composureWrap = document.createElement('div');
  composureWrap.className = 'composure';
  const composureNumber = document.createElement('span');
  composureNumber.className = 'composure-number';
  composureNumber.textContent = formatComposure(analysis.composure);
  const composureLabel = document.createElement('span');
  composureLabel.className = 'composure-label';
  composureLabel.textContent = 'Composure';
  composureWrap.append(composureNumber, composureLabel);
  wrap.appendChild(composureWrap);

  const bars = document.createElement('div');
  bars.className = 'sub-score-bars';
  for (const [key, label] of SUB_SCORE_LABELS) {
    const value = analysis.sub[key];
    const row = document.createElement('div');
    row.className = 'sub-score-row';

    const rowLabel = document.createElement('span');
    rowLabel.className = 'sub-score-label';
    rowLabel.textContent = label;

    const track = document.createElement('div');
    track.className = 'sub-score-track';
    const fill = document.createElement('div');
    fill.className = 'sub-score-fill';
    fill.style.width = `${clamp(value, 0, 100)}%`;
    track.appendChild(fill);

    const rowValue = document.createElement('span');
    rowValue.className = 'sub-score-value';
    rowValue.textContent = formatScore(value);

    row.append(rowLabel, track, rowValue);
    bars.appendChild(row);
  }
  wrap.appendChild(bars);

  const stats = document.createElement('dl');
  stats.className = 'stats-row';
  const statEntries: Array<[string, string]> = [
    ['Duration', formatElapsed(analysis.stats.durationS)],
    ['Eye contact', formatPercent(analysis.stats.eyeContactPct / 100)],
    ['Pace', `${Math.round(analysis.stats.wpm)} wpm`],
    ['Fillers', String(analysis.stats.fillerCount)],
    ['Pauses', String(analysis.stats.pauseCount)],
    ['Blinks', `${Math.round(analysis.stats.blinksPerMin)}/min`],
  ];
  for (const [label, value] of statEntries) {
    // Each pair gets its own wrapper div (a `dl` may contain `div`s that
    // each group a dt+dd, per the HTML5 dl content model) so the grid below
    // lays out whole label+value pairs as single cells -- without it, dt
    // and dd flow as separate grid items and a 3-column grid splits a pair
    // across rows/columns instead of stacking it.
    const stat = document.createElement('div');
    stat.className = 'stat';
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    stat.append(dt, dd);
    stats.appendChild(stat);
  }
  wrap.appendChild(stats);

  const honestNote = document.createElement('p');
  honestNote.className = 'honest-note';
  honestNote.textContent =
    'Scores are heuristics for comparing your own practice sessions — not a judgement of you.';
  wrap.appendChild(honestNote);

  if (analysis.events.some((e) => e.type === 'filler')) {
    const timingNote = document.createElement('p');
    timingNote.className = 'honest-note honest-note-secondary';
    timingNote.textContent = 'Word timings are approximate.';
    wrap.appendChild(timingNote);
  }

  body.appendChild(wrap);
}

function formatComposure(score: number): string {
  const safe = Number.isFinite(score) ? clamp(score, 0, 100) : 0;
  return safe.toFixed(1);
}

// --- Save panel: auto-save on mount + opt-in "keep video" toggle ----------
//
// Only built for a fresh session straight off Processing (readonly replays
// opened from the dashboard skip this entirely -- their record already
// exists, and there is nothing here left to save). Best-effort throughout:
// a storage failure (private browsing, quota, an unsupported browser) shows
// a quiet failure line instead of the confirmation, never throws, and never
// blocks the rest of the replay screen from working.

function buildSavePanel(body: HTMLElement, props: ReplayProps): void {
  const { question, packId, startedAt, durationS, analysis, replayBlob } = props;

  const wrap = document.createElement('div');
  wrap.className = 'save-panel';

  const status = document.createElement('p');
  status.className = 'save-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Saving to this browser…';
  wrap.appendChild(status);

  const rec: SessionRecord = {
    id: crypto.randomUUID(),
    startedAt,
    packId,
    questionId: question.id,
    questionText: question.text,
    durationS,
    stats: analysis.stats,
    sub: analysis.sub,
    composure: analysis.composure,
    events: analysis.events,
    hasReplay: false,
  };

  void (async () => {
    try {
      const db = await openDb();
      await db.saveSession(rec);
      status.textContent = 'Saved to this browser';
      if (replayBlob) buildKeepVideoToggle(wrap, db, rec, replayBlob);
    } catch (err) {
      console.warn('[replay] auto-save failed', err);
      status.textContent = 'Could not save to this browser (storage may be unavailable).';
    }
  })();

  body.appendChild(wrap);
}

function buildKeepVideoToggle(wrap: HTMLElement, db: UnderstudyDb, rec: SessionRecord, blob: Blob): void {
  const label = document.createElement('label');
  label.className = 'save-toggle';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = false;
  const labelText = document.createElement('span');
  labelText.textContent = 'Keep video with this session';
  label.append(checkbox, labelText);
  wrap.appendChild(label);

  const note = document.createElement('p');
  note.className = 'save-toggle-note';
  note.setAttribute('role', 'status');
  note.setAttribute('aria-live', 'polite');
  wrap.appendChild(note);

  checkbox.addEventListener('change', () => {
    const wantKeep = checkbox.checked;
    void (async () => {
      checkbox.disabled = true;
      try {
        // Single readwrite transaction over both stores -- see db.ts's
        // setSessionReplay doc comment. A failure partway through used to be
        // able to leave an orphaned blob or a dangling hasReplay from the
        // old saveReplay/deleteReplay + separate saveSession pair; this is
        // atomic, so `rec` below only updates once the write has actually
        // committed.
        await db.setSessionReplay(rec, wantKeep ? blob : null);
        rec.hasReplay = wantKeep;
        note.textContent = wantKeep
          ? 'Video saved with this session, on this device only.'
          : 'Video removed — the scorecard is still saved.';
      } catch (err) {
        console.warn('[replay] save toggle failed', err);
        checkbox.checked = !wantKeep;
        note.textContent = 'Could not update — try again.';
      } finally {
        checkbox.disabled = false;
      }
    })();
  });
}

// --- Actions ---------------------------------------------------------------

function buildActions(app: App, body: HTMLElement, pack: QuestionPack, flags: RunFlags, readonly?: boolean): void {
  const actions = document.createElement('div');
  actions.className = 'actions';

  const again = document.createElement('button');
  again.type = 'button';
  again.className = 'btn btn-primary btn-large';
  again.textContent = 'Practise again';
  again.addEventListener('click', () => {
    const question = drawQuestion(pack);
    app.show('question', { pack, question, flags });
  });

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'btn btn-ghost';
  done.textContent = 'Done';
  done.addEventListener('click', () => {
    // A replay reached from the dashboard should hand back to the
    // dashboard, not Home -- Home has no notion of "where you came from".
    if (readonly) {
      app.show('dashboard', { pack, flags });
    } else {
      app.show('home', { pack, flags });
    }
  });

  actions.append(again, done);
  body.appendChild(actions);
}
