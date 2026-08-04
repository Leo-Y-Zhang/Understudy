// Automated accessibility floor: @axe-core/playwright scans of the four
// screens with the most content/interaction (consent, home, a completed
// replay, and a dashboard with history) must carry zero serious or critical
// violations. Moderate/minor findings are logged for visibility but don't
// fail the run -- axe's automated ruleset over-flags on decorative,
// aria-hidden, and canvas-based UI (this app's timeline canvas and trend
// SVG are both intentionally aria-hidden, with a full accessible parallel
// alongside them -- see replay.ts and dashboard.ts) more often than it
// finds a real barrier at that severity.

import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { runMockJourneyToReplay } from './helpers';

async function assertNoSeriousViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();

  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const minor = results.violations.filter((v) => v.impact === 'moderate' || v.impact === 'minor');

  if (minor.length > 0) {
    const summary = minor.map((v) => `${v.id} (${v.impact}, ${v.nodes.length} node(s))`).join('; ');
    console.log(`[a11y:${label}] moderate/minor violations, not blocking: ${summary}`);
  }

  expect(serious, `[a11y:${label}] serious/critical violations:\n${JSON.stringify(serious, null, 2)}`).toEqual([]);
}

test.describe('accessibility', () => {
  test('consent screen has no serious or critical violations', async ({ page }) => {
    await page.goto('?mock=1&fast=1');
    await expect(page.locator('[data-screen="consent"]')).toBeVisible();
    await assertNoSeriousViolations(page, 'consent');
  });

  test('home screen has no serious or critical violations', async ({ page }) => {
    await page.goto('?mock=1&fast=1');
    await page.getByRole('button', { name: 'Accept and continue' }).click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    await assertNoSeriousViolations(page, 'home');
  });

  test('replay screen (completed mock session) has no serious or critical violations', async ({ page }) => {
    await runMockJourneyToReplay(page);
    await assertNoSeriousViolations(page, 'replay');
  });

  test('dashboard screen (with a saved session) has no serious or critical violations', async ({ page }) => {
    await runMockJourneyToReplay(page);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    await page.getByRole('button', { name: 'Progress' }).click();
    await expect(page.locator('[data-screen="dashboard"]')).toBeVisible();
    await expect(page.locator('.history-list li')).toHaveCount(1);
    await assertNoSeriousViolations(page, 'dashboard');
  });
});
