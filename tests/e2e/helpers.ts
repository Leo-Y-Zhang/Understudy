// Shared step helpers for the E2E suite. journey.spec.ts writes the full
// mock rehearsal flow out screen-by-screen (it IS the narrative spec for
// that journey); privacy.spec.ts and a11y.spec.ts only need to *reach* a
// completed mock session -- a replay screen, or a dashboard with one saved
// session -- so they drive the same flow through this one shared path
// instead of a second, drifting copy of it.

import { Page, expect } from '@playwright/test';

/**
 * Runs the full mock-mode rehearsal journey from a cold load through to a
 * mounted replay screen for a freshly completed, freshly saved session.
 * `waitMs` is real time spent on the session screen while the fast mock
 * clock (`&fast=1`) races through its virtual timeline generating a gaze
 * break and a blink burst -- 2s of real time comfortably covers the mock's
 * last scripted event at virtual t=31s (see src/mock/mockTracker.ts).
 */
export async function runMockJourneyToReplay(page: Page, opts: { waitMs?: number } = {}): Promise<void> {
  const waitMs = opts.waitMs ?? 2000;

  await page.goto('/?mock=1&fast=1');
  await expect(page.locator('[data-screen="consent"]')).toBeVisible();

  await page.getByRole('button', { name: 'Accept and continue' }).click();
  await expect(page.locator('[data-screen="home"]')).toBeVisible();

  await page.getByRole('button', { name: 'Rehearse' }).click();
  await expect(page.locator('[data-screen="question"]')).toBeVisible();

  await page.getByRole('button', { name: /ready/i }).click();
  await expect(page.locator('[data-screen="session"]')).toBeVisible();
  await expect(page.locator('.rec-indicator')).toBeVisible();

  await page.waitForTimeout(waitMs);

  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.locator('[data-screen="processing"]')).toBeVisible();
  await expect(page.locator('[data-screen="replay"]')).toBeVisible({ timeout: 15_000 });

  // The save panel auto-saves on mount; wait for it so callers that
  // immediately navigate to the dashboard reliably see the session already
  // persisted (its IndexedDB write is asynchronous and not otherwise gated
  // by any of the assertions above).
  await expect(page.getByText('Saved to this browser')).toBeVisible();
}
