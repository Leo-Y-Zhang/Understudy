// Consent screen: first thing anyone sees, and always reachable again from
// Home's small print. Nothing that touches a camera or microphone runs
// until Accept is clicked here, from this screen, as a direct user action.

import { App, QuestionPack, RunFlags, screenSection } from '../app';

const CONSENT_KEY = 'understudy.consent.v1';

const MEASURES: string[] = [
  'Where you’re looking, and how often your gaze drifts off camera',
  'How often, and how, you blink',
  'Shifts in your expression while you’re speaking',
  'How still you hold your head – fidgeting and repeated movement',
  'How fast you’re speaking, and how steady that pace stays',
  'Filler words (‘um’, ‘like’) and long pauses',
];

export interface ConsentProps {
  pack: QuestionPack;
  flags: RunFlags;
}

/** True if Accept has been clicked in a previous, non-mock visit. */
export function hasConsented(): boolean {
  try {
    return localStorage.getItem(CONSENT_KEY) !== null;
  } catch {
    return false;
  }
}

function grantConsent(mock: boolean): void {
  if (mock) return; // mock runs never touch storage, per the mock-mode contract
  try {
    localStorage.setItem(CONSENT_KEY, new Date().toISOString());
  } catch {
    // Storage can be unavailable (private browsing, quota, etc.) -- consent
    // for *this* session is still granted in memory by the caller moving on
    // to Home; only "skip consent next visit" is lost.
  }
}

export function consentScreen(app: App, props: ConsentProps): HTMLElement {
  const { pack, flags } = props;
  const { section, body } = screenSection('consent', 'Before you rehearse');

  const wordmark = document.createElement('p');
  wordmark.className = 'wordmark wordmark-small';
  wordmark.textContent = 'Understudy';
  wordmark.setAttribute('aria-hidden', 'true');
  section.insertBefore(wordmark, body);

  const intro = document.createElement('p');
  intro.className = 'lead';
  intro.textContent =
    'Understudy watches and listens while you rehearse, so it can show you how you came across. ' +
    'Before that happens even once, here is exactly what it does.';
  body.appendChild(intro);

  body.appendChild(buildSection('What this measures', () => {
    const list = document.createElement('ul');
    list.className = 'measures-list';
    for (const item of MEASURES) {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    }
    return list;
  }));

  body.appendChild(buildSection('The guarantee', () => {
    const p = document.createElement('p');
    p.textContent =
      'Nothing you record here ever leaves this device. No uploads, no analytics, no accounts — ' +
      'Understudy runs entirely inside this browser tab.';
    return p;
  }));

  body.appendChild(buildSection('See for yourself', () => {
    const p = document.createElement('p');
    p.textContent =
      'Don’t take that on trust. Open your browser’s developer tools, switch to the Network tab, ' +
      'and rehearse a full session — you will see nothing but this page’s own files. No request ever ' +
      'goes anywhere else.';
    return p;
  }));

  body.appendChild(buildSection('Your data, your control', () => {
    const p = document.createElement('p');
    p.textContent =
      'Right now, nothing is saved between visits except your consent choice and which questions you’ve ' +
      'already been asked — two small settings kept in this browser. Your recording and its analysis exist ' +
      'only in memory while you use the app, and disappear the moment you close or reload the tab.';
    return p;
  }));

  const limits = document.createElement('p');
  limits.className = 'honest-limits';
  limits.id = 'honest-limits';
  limits.textContent =
    'Worth knowing: none of this reads emotions or detects lies. Every score is a comparison against your ' +
    'own delivery, not a clinical or psychological assessment.';
  body.appendChild(limits);

  const note = document.createElement('p');
  note.className = 'consent-note';
  note.setAttribute('role', 'status');
  note.setAttribute('aria-live', 'polite');
  body.appendChild(note);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const declineBtn = document.createElement('button');
  declineBtn.type = 'button';
  declineBtn.className = 'btn btn-ghost';
  declineBtn.textContent = 'Not yet';
  declineBtn.addEventListener('click', () => {
    note.textContent =
      'No problem — stay as long as you like. Nothing has been recorded or saved, and you can accept ' +
      'whenever you’re ready.';
  });

  const acceptBtn = document.createElement('button');
  acceptBtn.type = 'button';
  acceptBtn.className = 'btn btn-primary';
  acceptBtn.textContent = 'Accept and continue';
  acceptBtn.addEventListener('click', () => {
    grantConsent(flags.mock);
    app.show('home', { pack, flags });
  });

  actions.append(declineBtn, acceptBtn);
  body.appendChild(actions);

  return section;
}

function buildSection(title: string, buildBody: () => HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'consent-block';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  wrap.append(h2, buildBody());
  return wrap;
}
