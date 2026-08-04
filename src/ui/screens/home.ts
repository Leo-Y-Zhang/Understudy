// Home screen: brand landing point, pack pick (one pack in v1), and the
// "Rehearse" call to action that draws a question and moves on.

import { App, QuestionPack, QuestionSpec, RunFlags, screenSection } from '../app';
import { openDb } from '../../data/db';

// Exported so the dashboard's wipe flow clears exactly this key (rather than
// a second, hand-copied literal) when it resets local state to a fresh
// install. `understudy.consent.v1` (consent.ts) has no analogous export --
// consent.ts isn't part of this task's file list -- so the dashboard keeps
// that one literal, called out there with the same cross-reference.
export const DRAWN_KEY = 'understudy.drawn.v1';

export interface HomeProps {
  pack: QuestionPack;
  flags: RunFlags;
}

function readDrawnIds(packId: string): string[] {
  try {
    const raw = localStorage.getItem(DRAWN_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    return Array.isArray(parsed[packId]) ? parsed[packId] : [];
  } catch {
    return [];
  }
}

function writeDrawnIds(packId: string, ids: string[]): void {
  try {
    const raw = localStorage.getItem(DRAWN_KEY);
    const parsed: Record<string, string[]> = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    parsed[packId] = ids;
    localStorage.setItem(DRAWN_KEY, JSON.stringify(parsed));
  } catch {
    // Best-effort: a lost write just means a question might repeat sooner
    // than intended, never a crash.
  }
}

/**
 * Picks a question at random, never repeating one until every question in
 * the pack has been drawn at least once (then the pool resets).
 */
export function drawQuestion(pack: QuestionPack): QuestionSpec {
  const drawn = readDrawnIds(pack.id);
  const undrawn = pack.questions.filter((q) => !drawn.includes(q.id));
  const pool = undrawn.length > 0 ? undrawn : pack.questions;
  const startingFresh = undrawn.length === 0;

  const picked = pool[Math.floor(Math.random() * pool.length)]!;
  writeDrawnIds(pack.id, [...(startingFresh ? [] : drawn), picked.id]);
  return picked;
}

export function homeScreen(app: App, props: HomeProps): HTMLElement {
  const { pack, flags } = props;
  const { section, h1, body } = screenSection('home', 'Understudy');
  h1.className = 'wordmark';

  const strapline = document.createElement('p');
  strapline.className = 'strapline';
  strapline.textContent = 'Rehearse before you’re on.';
  body.appendChild(strapline);

  const packCard = document.createElement('div');
  packCard.className = 'pack-card';
  const packTitle = document.createElement('h2');
  packTitle.textContent = pack.title;
  const packMeta = document.createElement('p');
  packMeta.className = 'pack-meta';
  packMeta.textContent = `${pack.questions.length} questions — about 30s to think, 2 minutes to answer`;
  packCard.append(packTitle, packMeta);
  body.appendChild(packCard);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const rehearseBtn = document.createElement('button');
  rehearseBtn.type = 'button';
  rehearseBtn.className = 'btn btn-primary btn-large';
  rehearseBtn.textContent = 'Rehearse';
  rehearseBtn.addEventListener('click', () => {
    const question = drawQuestion(pack);
    app.show('question', { pack, question, flags });
  });

  const progressBtn = document.createElement('button');
  progressBtn.type = 'button';
  progressBtn.className = 'btn btn-ghost';
  progressBtn.textContent = 'Progress';
  progressBtn.addEventListener('click', () => app.show('dashboard', { pack, flags }));

  actions.append(rehearseBtn, progressBtn);
  body.appendChild(actions);

  const history = document.createElement('div');
  history.className = 'history-placeholder';
  const historyText = document.createElement('p');
  historyText.textContent = 'Your rehearsals will appear here once you’ve done one.';
  history.appendChild(historyText);
  body.appendChild(history);

  // Fill in the placeholder above with a one-line summary once any saved
  // sessions load -- async, so this runs after homeScreen already returned
  // its section; a failure here (storage unavailable) just leaves the
  // original placeholder text in place rather than breaking the screen.
  void (async () => {
    try {
      const db = await openDb();
      const sessions = await db.listSessions();
      if (sessions.length === 0) return;
      const latest = sessions[0]!; // listSessions() is newest-first
      history.classList.add('history-summary');
      historyText.textContent =
        `${sessions.length} rehearsal${sessions.length === 1 ? '' : 's'} saved on this device — ` +
        `latest composure ${formatComposureShort(latest.composure)}.`;
    } catch (err) {
      console.warn('[home] could not load session summary', err);
    }
  })();

  const smallPrint = document.createElement('button');
  smallPrint.type = 'button';
  smallPrint.className = 'link-button small-print';
  smallPrint.textContent = 'What this measures, and its honest limits';
  smallPrint.addEventListener('click', () => {
    app.show('consent', { pack, flags });
  });
  body.appendChild(smallPrint);

  return section;
}

/** One-decimal composure, matching replay.ts's own local `formatComposure`
 *  -- kept as a small duplicate rather than a shared export since `format.ts`
 *  isn't part of this task's file list and the two call sites' rounding
 *  needs happen to already coincide. */
function formatComposureShort(score: number): string {
  const safe = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  return safe.toFixed(1);
}
