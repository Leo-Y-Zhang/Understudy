// Dashboard screen: T16's "score trends across sessions" (spec §6 step 6).
// Everything here reads from `src/data/db.ts` -- local IndexedDB only, never
// a network call -- and the whole screen degenerates gracefully with zero
// saved sessions (the empty state) rather than needing a separate "first
// run" screen.
//
// Layout, top to bottom: composure trend (a decorative inline-SVG line +
// dots, time-ordered oldest -> newest, mirrored by a visually-hidden
// accessible <table> -- the same "decorative chart + full text parallel"
// split replay.ts's timeline already established) -> six compact
// latest-vs-best sub-score rows -> the session history list (click a row to
// reopen that session's replay, readonly) -> Export JSON -> Wipe everything
// (typed "DELETE" confirm gate).
//
// `dashboardScreen` itself returns synchronously (screens are plain
// `(app, props) => HTMLElement` factories -- see app.ts -- there is no
// async-factory lifecycle), so it mounts a "Loading…" status line first and
// fills in the real content once `listSessions()` resolves, the same
// pattern home.ts's own summary line uses.

import { App, QuestionPack, RunFlags, screenSection } from '../app';
import { clamp, formatScore } from '../format';
import { openDb, SessionRecord } from '../../data/db';
import { SUB_SCORE_LABELS } from './replay';
import { DRAWN_KEY } from './home';

export interface DashboardProps {
  pack: QuestionPack;
  flags: RunFlags;
}

// CONSENT_KEY stays a literal: it lives in consent.ts, which is not part of
// this task's file list, so there is nothing importable here -- DRAWN_KEY
// (home.ts, in scope) is imported above instead of hand-copied.
const CONSENT_KEY = 'understudy.consent.v1'; // see consent.ts's CONSENT_KEY

const HISTORY_QUESTION_MAX_CHARS = 70;

// Half of .dash-sub-best-mark's own CSS width (3px) -- the tick is
// positioned via `left: X%` + `transform: translateX(-50%)`, so at the 0%
// and 100% extremes that centering shift pushes half the mark past the
// track's edge, where `.sub-score-track`'s `overflow: hidden` clips it.
// Clamping `left` between this inset and `calc(100% - inset)` keeps the
// mark's own edge flush with the track instead of clipped mid-tick.
const BEST_MARK_HALF_WIDTH_PX = 1.5;

const TREND_VIEW_W = 560;
const TREND_VIEW_H = 140;
const TREND_PAD_X = 16;
const TREND_PAD_TOP = 22; // headroom for the endpoint's direct value label
const TREND_PAD_BOTTOM = 10;

const SVG_NS = 'http://www.w3.org/2000/svg';

export function dashboardScreen(app: App, props: DashboardProps): HTMLElement {
  const { pack, flags } = props;
  const { section, body } = screenSection('dashboard', 'Your progress');
  section.classList.add('screen-dashboard');

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'btn btn-ghost dashboard-back';
  backBtn.textContent = 'Back to home';
  backBtn.addEventListener('click', () => app.show('home', { pack, flags }));
  body.appendChild(backBtn);

  const status = document.createElement('p');
  status.className = 'dashboard-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Loading your sessions…';
  body.appendChild(status);

  void (async () => {
    let sessions: SessionRecord[];
    try {
      const db = await openDb();
      sessions = await db.listSessions();
    } catch (err) {
      console.warn('[dashboard] could not load saved sessions', err);
      status.textContent = 'Could not load your saved sessions.';
      return;
    }

    status.remove();

    if (sessions.length === 0) {
      buildEmptyState(body);
      return;
    }

    buildTrend(body, sessions);
    buildSubScoreSummary(body, sessions);
    buildHistoryList(app, body, pack, flags, sessions);
    buildExportButton(body);
    buildWipeSection(app, body, props);
  })();

  return section;
}

// --- Empty state ------------------------------------------------------------

function buildEmptyState(body: HTMLElement): void {
  const empty = document.createElement('div');
  empty.className = 'dashboard-empty';
  const title = document.createElement('p');
  title.className = 'dashboard-empty-title';
  title.textContent = 'No sessions yet';
  const sub = document.createElement('p');
  sub.className = 'dashboard-empty-sub';
  sub.textContent = 'Rehearse a question and it will show up here, with a trend line across every attempt.';
  empty.append(title, sub);
  body.appendChild(empty);
}

// --- Composure trend --------------------------------------------------------

function buildTrend(body: HTMLElement, sessions: SessionRecord[]): void {
  const wrap = document.createElement('div');
  wrap.className = 'trend';

  const heading = document.createElement('h2');
  heading.className = 'section-heading';
  heading.textContent = 'Composure trend';
  wrap.appendChild(heading);

  // listSessions() is newest-first; a trend reads left (oldest) -> right
  // (newest), so this is the one place that order gets reversed.
  const chrono = sessions.slice().reverse();

  const svgWrap = document.createElement('div');
  svgWrap.className = 'trend-chart-wrap';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${TREND_VIEW_W} ${TREND_VIEW_H}`);
  svg.setAttribute('class', 'trend-chart');
  svg.setAttribute('aria-hidden', 'true'); // decorative -- the table below is the full reading
  svg.setAttribute('focusable', 'false');

  const plotW = TREND_VIEW_W - TREND_PAD_X * 2;
  const plotH = TREND_VIEW_H - TREND_PAD_TOP - TREND_PAD_BOTTOM;
  const xAt = (i: number): number =>
    chrono.length <= 1 ? TREND_VIEW_W / 2 : TREND_PAD_X + (i / (chrono.length - 1)) * plotW;
  const yAt = (composure: number): number => TREND_PAD_TOP + plotH - (clamp(composure, 0, 100) / 100) * plotH;

  if (chrono.length >= 2) {
    const d = chrono.map((rec, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(rec.composure)}`).join(' ');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'trend-line');
    svg.appendChild(path);
  }

  chrono.forEach((rec, i) => {
    const cx = xAt(i);
    const cy = yAt(rec.composure);

    const dot = document.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('cx', String(cx));
    dot.setAttribute('cy', String(cy));
    dot.setAttribute('r', '4');
    dot.setAttribute('class', 'trend-dot');
    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `${new Date(rec.startedAt).toLocaleDateString()}: ${formatComposure1dp(rec.composure)}`;
    dot.appendChild(title);
    svg.appendChild(dot);

    // Label selectively (dataviz skill: "never a number on every point") --
    // only the most recent point gets a direct value label; every value is
    // still available in the accessible table below.
    if (i === chrono.length - 1) {
      const label = document.createElementNS(SVG_NS, 'text');
      label.setAttribute('x', String(cx));
      label.setAttribute('y', String(Math.max(12, cy - 10)));
      label.setAttribute('class', 'trend-label');
      label.setAttribute('text-anchor', cx > TREND_VIEW_W - 40 ? 'end' : 'middle');
      label.textContent = formatComposure1dp(rec.composure);
      svg.appendChild(label);
    }
  });

  svgWrap.appendChild(svg);
  wrap.appendChild(svgWrap);
  wrap.appendChild(buildTrendTable(chrono));

  body.appendChild(wrap);
}

function buildTrendTable(chrono: SessionRecord[]): HTMLElement {
  const tableWrap = document.createElement('div');
  tableWrap.className = 'sr-only';

  const table = document.createElement('table');
  const caption = document.createElement('caption');
  caption.textContent = 'Composure by session, oldest to newest';
  table.appendChild(caption);

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Date', 'Composure']) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const rec of chrono) {
    const row = document.createElement('tr');
    const dateCell = document.createElement('td');
    dateCell.textContent = new Date(rec.startedAt).toLocaleString();
    const composureCell = document.createElement('td');
    composureCell.textContent = formatComposure1dp(rec.composure);
    row.append(dateCell, composureCell);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);

  tableWrap.appendChild(table);
  return tableWrap;
}

// --- Latest vs. best sub-scores ---------------------------------------------

function buildSubScoreSummary(body: HTMLElement, sessions: SessionRecord[]): void {
  const wrap = document.createElement('div');
  wrap.className = 'dash-sub-summary';

  const heading = document.createElement('h2');
  heading.className = 'section-heading';
  heading.textContent = 'Latest vs. your best';
  wrap.appendChild(heading);

  const latest = sessions[0]!; // listSessions() is newest-first
  const rows = document.createElement('div');
  rows.className = 'sub-score-bars';

  for (const [key, label] of SUB_SCORE_LABELS) {
    const latestValue = latest.sub[key];
    const bestValue = Math.max(...sessions.map((s) => s.sub[key]));

    const row = document.createElement('div');
    row.className = 'sub-score-row';

    const rowLabel = document.createElement('span');
    rowLabel.className = 'sub-score-label';
    rowLabel.textContent = label;

    const track = document.createElement('div');
    track.className = 'sub-score-track dash-sub-track';
    const fill = document.createElement('div');
    fill.className = 'sub-score-fill';
    fill.style.width = `${clamp(latestValue, 0, 100)}%`;
    track.appendChild(fill);
    const bestMark = document.createElement('div');
    bestMark.className = 'dash-sub-best-mark';
    const bestPct = clamp(bestValue, 0, 100);
    bestMark.style.left = `clamp(${BEST_MARK_HALF_WIDTH_PX}px, ${bestPct}%, calc(100% - ${BEST_MARK_HALF_WIDTH_PX}px))`;
    bestMark.title = `Best: ${formatScore(bestValue)}`;
    track.appendChild(bestMark);

    const rowValue = document.createElement('span');
    rowValue.className = 'sub-score-value';
    rowValue.textContent = `${formatScore(latestValue)} (best ${formatScore(bestValue)})`;

    row.append(rowLabel, track, rowValue);
    rows.appendChild(row);
  }

  wrap.appendChild(rows);
  body.appendChild(wrap);
}

// --- Session history ---------------------------------------------------------

function truncateQuestion(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function buildHistoryList(
  app: App,
  body: HTMLElement,
  pack: QuestionPack,
  flags: RunFlags,
  sessions: SessionRecord[]
): void {
  const wrap = document.createElement('div');
  wrap.className = 'history-list-wrap';

  const heading = document.createElement('h2');
  heading.className = 'section-heading';
  heading.textContent = 'Session history';
  wrap.appendChild(heading);

  const list = document.createElement('ol');
  list.className = 'history-list';

  for (const rec of sessions) {
    // already newest-first
    const item = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'history-item';

    const when = document.createElement('span');
    when.className = 'history-item-when';
    when.textContent = new Date(rec.startedAt).toLocaleString();

    const question = document.createElement('span');
    question.className = 'history-item-question';
    question.textContent = truncateQuestion(rec.questionText, HISTORY_QUESTION_MAX_CHARS);

    const composure = document.createElement('span');
    composure.className = 'history-item-composure';
    composure.textContent = formatComposure1dp(rec.composure);

    btn.append(when, question, composure);
    btn.addEventListener('click', () => {
      void openReplayFromRecord(app, pack, flags, rec);
    });

    item.appendChild(btn);
    list.appendChild(item);
  }

  wrap.appendChild(list);
  body.appendChild(wrap);
}

async function openReplayFromRecord(app: App, pack: QuestionPack, flags: RunFlags, rec: SessionRecord): Promise<void> {
  let blob: Blob | null = null;
  if (rec.hasReplay) {
    try {
      const db = await openDb();
      blob = await db.getReplay(rec.id);
    } catch (err) {
      console.warn('[dashboard] could not load saved replay video', err);
    }
  }

  app.show('replay', {
    question: { id: rec.questionId, text: rec.questionText, thinkingS: 0, suggestedAnswerS: 0 },
    packId: rec.packId,
    pack,
    startedAt: rec.startedAt,
    durationS: rec.durationS,
    analysis: { events: rec.events, sub: rec.sub, composure: rec.composure, stats: rec.stats },
    replayBlob: blob,
    flags,
    readonly: true,
  });
}

// --- Export JSON --------------------------------------------------------------

function buildExportButton(body: HTMLElement): void {
  const tools = document.createElement('div');
  tools.className = 'dashboard-tools';

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'btn btn-ghost';
  exportBtn.textContent = 'Export JSON';
  exportBtn.addEventListener('click', () => {
    void (async () => {
      try {
        const db = await openDb();
        const json = await db.exportJson();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'understudy-sessions.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
      } catch (err) {
        console.warn('[dashboard] export failed', err);
      }
    })();
  });

  tools.appendChild(exportBtn);
  body.appendChild(tools);
}

// --- Wipe everything ------------------------------------------------------------

function buildWipeSection(app: App, body: HTMLElement, props: DashboardProps): void {
  const wrap = document.createElement('div');
  wrap.className = 'wipe-section';

  const wipeBtn = document.createElement('button');
  wipeBtn.type = 'button';
  wipeBtn.className = 'btn btn-ghost';
  wipeBtn.textContent = 'Wipe everything';
  wrap.appendChild(wipeBtn);

  const confirmPanel = document.createElement('div');
  confirmPanel.className = 'wipe-confirm';
  confirmPanel.hidden = true;

  const confirmText = document.createElement('p');
  confirmText.textContent =
    'This deletes every saved session and video from this browser, permanently. Type DELETE to confirm.';
  confirmPanel.appendChild(confirmText);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'wipe-input';
  input.setAttribute('aria-label', 'Type DELETE to confirm');
  input.autocomplete = 'off';
  input.spellcheck = false;
  confirmPanel.appendChild(input);

  const confirmActions = document.createElement('div');
  confirmActions.className = 'actions';

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'btn btn-stop';
  confirmBtn.textContent = 'Delete everything';
  confirmBtn.disabled = true;

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-ghost';
  cancelBtn.textContent = 'Cancel';

  confirmActions.append(confirmBtn, cancelBtn);
  confirmPanel.appendChild(confirmActions);
  wrap.appendChild(confirmPanel);

  wipeBtn.addEventListener('click', () => {
    wipeBtn.hidden = true;
    confirmPanel.hidden = false;
    input.value = '';
    confirmBtn.disabled = true;
    input.focus();
  });

  input.addEventListener('input', () => {
    confirmBtn.disabled = input.value !== 'DELETE'; // case-sensitive, exact match
  });

  cancelBtn.addEventListener('click', () => {
    confirmPanel.hidden = true;
    wipeBtn.hidden = false;
  });

  confirmBtn.addEventListener('click', () => {
    if (input.value !== 'DELETE') return; // belt-and-braces; the button is disabled until this holds
    void (async () => {
      confirmBtn.disabled = true;
      try {
        const db = await openDb();
        await db.wipeAll();
        try {
          localStorage.removeItem(CONSENT_KEY);
          localStorage.removeItem(DRAWN_KEY);
        } catch {
          // Best-effort, same convention as consent.ts/home.ts -- a lost
          // localStorage write never blocks the (already-completed) wipe.
        }
        // Re-show this same screen: openDb().listSessions() now resolves
        // empty, which is exactly the empty state the caller expects here.
        app.show('dashboard', props);
      } catch (err) {
        console.warn('[dashboard] wipe failed', err);
        confirmBtn.disabled = false;
      }
    })();
  });

  body.appendChild(wrap);
}

// --- Shared formatting --------------------------------------------------------

/** One-decimal composure, matching replay.ts's own local `formatComposure`
 *  (and home.ts's `formatComposureShort`) -- see home.ts for why this isn't
 *  a shared export instead. */
function formatComposure1dp(score: number): string {
  const safe = Number.isFinite(score) ? clamp(score, 0, 100) : 0;
  return safe.toFixed(1);
}
