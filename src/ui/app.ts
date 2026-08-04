// Minimal screen manager: no router library, just a name -> factory map.
// `show(name, props)` builds the requested screen's <section>, swaps it in
// as the sole child of the mount root, and moves focus to that screen's
// <h1> (giving every screen transition an unambiguous, announced landing
// point for keyboard and screen-reader users).
//
// Screens register themselves as `Screen<P>` functions -- `(app, props) =>
// HTMLElement` -- so a screen can navigate onward by calling
// `app.show(...)` itself (e.g. consent's Accept button shows 'home'). Props
// are intentionally untyped at the map level (`Screen<unknown>`); each
// screen module exports its own precise prop type for its own factory's
// signature, and main.ts (the only place that both registers and calls
// `show` across screen boundaries) is where those types actually meet.

export type Screen<P = void> = (app: App, props: P) => HTMLElement;

export class App {
  private readonly screens = new Map<string, Screen<unknown>>();
  private current: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement) {}

  register<P>(name: string, screen: Screen<P>): void {
    this.screens.set(name, screen as Screen<unknown>);
  }

  show<P>(name: string, props: P): void {
    const screen = this.screens.get(name);
    if (!screen) {
      throw new Error(`App.show: no screen registered as "${name}"`);
    }

    const section = screen(this, props);
    this.root.replaceChildren(section);
    this.current = section;
    focusHeading(section);
  }

  /** The currently-mounted screen's root element, if any -- mainly for tests/probes. */
  getCurrentSection(): HTMLElement | null {
    return this.current;
  }
}

function focusHeading(section: HTMLElement): void {
  const heading = section.querySelector<HTMLElement>('h1');
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus();
}

/**
 * Builds the `<section role="region" aria-labelledby="...">` shell every
 * screen uses, with its `<h1>` already inside and wired up to the
 * `aria-labelledby`. `headingClass` lets a screen visually hide its heading
 * (e.g. Session leads with the REC indicator instead) while keeping it
 * present and focusable -- pass 'sr-only' for that case.
 */
export function screenSection(
  screenId: string,
  headingText: string,
  headingClass?: string
): { section: HTMLElement; h1: HTMLHeadingElement; body: HTMLDivElement } {
  const section = document.createElement('section');
  section.className = 'screen';
  section.dataset.screen = screenId;
  section.setAttribute('role', 'region');
  section.setAttribute('aria-labelledby', `${screenId}-heading`);

  const h1 = document.createElement('h1');
  h1.id = `${screenId}-heading`;
  h1.textContent = headingText;
  if (headingClass) h1.className = headingClass;
  section.appendChild(h1);

  const body = document.createElement('div');
  body.className = 'screen-body';
  section.appendChild(body);

  return { section, h1, body };
}

// --- Shared domain types threaded between screens ---------------------

export interface QuestionSpec {
  id: string;
  text: string;
  thinkingS: number;
  suggestedAnswerS: number;
}

export interface QuestionPack {
  id: string;
  title: string;
  questions: QuestionSpec[];
}

/** Query-string toggles that follow the session through every screen. */
export interface RunFlags {
  mock: boolean;
  fast: boolean;
}
