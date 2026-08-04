import './styles.css';
import { App, QuestionPack, RunFlags } from './ui/app';
import { consentScreen, hasConsented } from './ui/screens/consent';
import { homeScreen } from './ui/screens/home';
import { questionScreen } from './ui/screens/question';
import { sessionScreen } from './ui/screens/session';
import { processingScreen, resultsScreen } from './ui/screens/processing';
import generalAdmissionsPack from './packs/general-admissions.json';

// Session flow: consent -> home -> question -> session -> processing ->
// (temporary) results. `?mock=1` swaps every capture/transcription
// dependency for deterministic in-memory stand-ins so the whole flow can be
// exercised without a camera, a microphone, or the Whisper model; `&fast=1`
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
  const root = document.querySelector<HTMLDivElement>('#app');
  if (!root) return;

  const flags = parseFlags();
  const pack = generalAdmissionsPack as QuestionPack;

  const app = new App(root);
  app.register('consent', consentScreen);
  app.register('home', homeScreen);
  app.register('question', questionScreen);
  app.register('session', sessionScreen);
  app.register('processing', processingScreen);
  app.register('results', resultsScreen);

  const canSkipConsent = !flags.mock && hasConsented();
  if (canSkipConsent) {
    app.show('home', { pack, flags });
  } else {
    app.show('consent', { pack, flags });
  }
}

main();
