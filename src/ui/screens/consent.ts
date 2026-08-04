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
  wordmark.setAttribute('aria-hidden', 'true');
  const wordmarkU = document.createElement('span');
  wordmarkU.className = 'wordmark-mark';
  wordmarkU.textContent = 'U';
  wordmark.append(wordmarkU, document.createTextNode('nderstudy'));
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
      'Nothing you record here — your video, your audio, or any analysis of them — ever leaves this ' +
      'device. There’s no backend, no account, and no upload path for any of it. Understudy runs ' +
      'entirely inside this browser tab.';
    return p;
  }, 'consent-block--feature'));

  body.appendChild(buildSection('See for yourself', () => {
    const p = document.createElement('p');
    p.textContent =
      'Don’t take that on trust. Open your browser’s developer tools, switch to the Network tab, and ' +
      'rehearse a full session. One third-party library, Google’s MediaPipe, tries to send anonymous ' +
      'performance statistics as a session ends — this page’s Content-Security-Policy blocks that ' +
      'request outright, and you’ll see the blocked attempt sitting right there in the Network tab. ' +
      'That’s the exception that proves the rule: nothing you record, and nothing about your session, ' +
      'is ever actually sent anywhere. Every other request you’ll see is this page’s own files.';
    return p;
  }));

  body.appendChild(buildSection('Your data, your control', () => {
    const p = document.createElement('p');
    p.textContent =
      'Two small settings are kept in this browser between visits regardless: your consent choice, and ' +
      'which questions you’ve already been asked. On top of that, your scores and flagged moments are ' +
      'saved to this browser automatically as soon as a session finishes, so you can track your progress ' +
      'over time. Your video is different — it’s kept only if you tick “Keep video with this session” on ' +
      'the replay screen afterwards; skip that and it’s discarded. “Wipe everything” on the dashboard ' +
      'deletes all of it — scores, flagged moments, and any saved video — for good.';
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

function buildSection(title: string, buildBody: () => HTMLElement, variantClass?: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = variantClass ? `consent-block ${variantClass}` : 'consent-block';
  const h2 = document.createElement('h2');
  h2.textContent = title;
  wrap.append(h2, buildBody());
  return wrap;
}
