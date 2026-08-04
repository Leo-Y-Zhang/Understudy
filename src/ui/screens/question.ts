// Question screen: shows the drawn question, runs a skippable thinking
// countdown, then hands off to Session. The countdown is a visual aid, not
// a gate for anyone using a screen reader or keyboard alone -- "I'm ready"
// is always available and does the same thing early.

import { App, QuestionPack, QuestionSpec, RunFlags, screenSection } from '../app';
import { formatCountdown } from '../format';

const DEFAULT_THINKING_S = 30;
const TICK_MS = 200;
const RING_RADIUS = 54;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface QuestionProps {
  pack: QuestionPack;
  question: QuestionSpec;
  flags: RunFlags;
}

export function questionScreen(app: App, props: QuestionProps): HTMLElement {
  const { pack, question, flags } = props;
  const { section, body } = screenSection('question', question.text);
  section.classList.add('screen-question');

  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Your question';
  section.insertBefore(eyebrow, body);

  const answerHint = document.createElement('p');
  answerHint.className = 'answer-hint';
  answerHint.textContent = `Take your time thinking, then aim for about ${minutesLabel(question.suggestedAnswerS)} when you answer.`;
  body.appendChild(answerHint);

  const countdownWrap = document.createElement('div');
  countdownWrap.className = 'countdown';
  countdownWrap.setAttribute('aria-hidden', 'true');

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'countdown-ring');

  const track = document.createElementNS(svgNs, 'circle');
  track.setAttribute('cx', '60');
  track.setAttribute('cy', '60');
  track.setAttribute('r', String(RING_RADIUS));
  track.setAttribute('class', 'countdown-track');

  const progress = document.createElementNS(svgNs, 'circle');
  progress.setAttribute('cx', '60');
  progress.setAttribute('cy', '60');
  progress.setAttribute('r', String(RING_RADIUS));
  progress.setAttribute('class', 'countdown-progress');
  progress.setAttribute('stroke-dasharray', String(RING_CIRCUMFERENCE));
  progress.setAttribute('stroke-dashoffset', '0');

  svg.append(track, progress);
  countdownWrap.appendChild(svg);

  const numeral = document.createElement('span');
  numeral.className = 'countdown-numeral';
  countdownWrap.appendChild(numeral);
  body.appendChild(countdownWrap);

  const srStatus = document.createElement('p');
  srStatus.className = 'sr-only';
  srStatus.textContent = `Thinking time: ${question.thinkingS || DEFAULT_THINKING_S} seconds. Press "I'm ready" any time to start sooner.`;
  body.appendChild(srStatus);

  const readyBtn = document.createElement('button');
  readyBtn.type = 'button';
  readyBtn.className = 'btn btn-primary btn-large';
  readyBtn.textContent = 'I’m ready';
  body.appendChild(readyBtn);

  const thinkingS = question.thinkingS > 0 ? question.thinkingS : DEFAULT_THINKING_S;
  const startedAt = performance.now();
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let advanced = false;

  const goToSession = (): void => {
    if (advanced) return;
    advanced = true;
    if (intervalHandle !== null) clearInterval(intervalHandle);
    app.show('session', { pack, question, flags });
  };

  const tick = (): void => {
    const elapsedS = (performance.now() - startedAt) / 1000;
    const remainingS = thinkingS - elapsedS;
    numeral.textContent = formatCountdown(remainingS);
    const fraction = Math.max(0, Math.min(1, remainingS / thinkingS));
    progress.setAttribute('stroke-dashoffset', String(RING_CIRCUMFERENCE * (1 - fraction)));
    if (remainingS <= 0) goToSession();
  };

  tick();
  intervalHandle = setInterval(tick, TICK_MS);

  readyBtn.addEventListener('click', goToSession);

  return section;
}

function minutesLabel(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}
