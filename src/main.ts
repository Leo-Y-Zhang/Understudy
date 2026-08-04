import './styles.css';
import { App, QuestionPack, RunFlags } from './ui/app';
import { consentScreen, hasConsented } from './ui/screens/consent';
import { homeScreen } from './ui/screens/home';
import { questionScreen } from './ui/screens/question';
import { sessionScreen } from './ui/screens/session';
import { processingScreen } from './ui/screens/processing';
import { replayScreen } from './ui/screens/replay';
import { dashboardScreen } from './ui/screens/dashboard';
import generalAdmissionsPack from './packs/general-admissions.json';

// Session flow: consent -> home -> question -> session -> processing ->
// replay (annotated timeline + scorecard, auto-saved to IndexedDB). Home's
// "Progress" action reaches dashboard (trend + history + export/wipe)
// independently of that flow; dashboard opens a saved session back into
// replay, readonly. `?mock=1` swaps every capture/transcription dependency
// for deterministic in-memory stand-ins so the whole flow can be exercised
// without a camera, a microphone, or the Whisper model; `&fast=1`
// additionally speeds up the mock face tracker's virtual clock. Consent is
// always the first screen on a mock run (and never persists), and the first
// screen on any run that hasn't accepted it yet before.

function parseFlags(): RunFlags {
  const params = new URLSearchParams(location.search);
  return {
    mock: params.get('mock') === '1',
    fast: params.get('fast') === '1',
  };
}

function main(): void {
  // #app is a <main> landmark (the single one for the whole app -- screens
  // swap as its children, they don't each add their own landmark). <main>
  // has no dedicated DOM interface, so this is typed as HTMLElement, not
  // HTMLDivElement.
  const root = document.querySelector<HTMLElement>('#app');
  if (!root) return;

  const flags = parseFlags();
  const pack = generalAdmissionsPack as QuestionPack;

  const app = new App(root);
  app.register('consent', consentScreen);
  app.register('home', homeScreen);
  app.register('question', questionScreen);
  app.register('session', sessionScreen);
  app.register('processing', processingScreen);
  app.register('replay', replayScreen);
  app.register('dashboard', dashboardScreen);

  const canSkipConsent = !flags.mock && hasConsented();
  if (canSkipConsent) {
    app.show('home', { pack, flags });
  } else {
    app.show('consent', { pack, flags });
  }
}

main();
