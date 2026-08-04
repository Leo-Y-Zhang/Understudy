// The whole mock rehearsal journey, screen by screen: consent blocks
// everything until accepted, then home -> question -> session -> processing
// -> replay -> home (with a summary) -> dashboard (with a trend) -> wipe
// (typed-DELETE gate) -> empty state, with the home summary gone too.
//
// `?mock=1&fast=1` swaps every capture/transcription dependency for
// deterministic in-memory stand-ins (src/mock/*) so this never touches a
// camera, a microphone, or the Whisper model -- see privacy.spec.ts for the
// real-mode consent-before-camera check this mode deliberately skips.

import { test, expect } from '@playwright/test';

test.describe('mock rehearsal journey', () => {
  test('consent -> home -> question -> session -> processing -> replay -> dashboard -> wipe', async ({ page }) => {
    // Consent blocks first: nothing else is reachable before Accept.
    await page.goto('?mock=1&fast=1');
    await expect(page.locator('[data-screen="consent"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Before you rehearse' })).toBeVisible();
    await expect(page.locator('[data-screen="home"]')).toHaveCount(0);

    // Accept -> Home.
    await page.getByRole('button', { name: 'Accept and continue' }).click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();

    // Rehearse -> Question (the drawn question text is random, so this only
    // asserts a question screen is showing, not which question).
    await page.getByRole('button', { name: 'Rehearse' }).click();
    await expect(page.locator('[data-screen="question"]')).toBeVisible();

    // "I'm ready" skips the thinking countdown -> Session starts recording.
    await page.getByRole('button', { name: /ready/i }).click();
    await expect(page.locator('[data-screen="session"]')).toBeVisible();
    await expect(page.locator('.rec-indicator')).toBeVisible();

    // Let the fast mock clock run past its scripted gaze-break (t=10-12s)
    // AND its blink-burst (t=30.0-31.0s, four blinks -- see
    // src/mock/mockTracker.ts's BLINK_PULSES). `&fast=1` runs MockTracker's
    // setInterval at 1ms, but browsers clamp nested timers to >=4ms, so this
    // buys ~6-8x real time in practice, not the ~33x a naive "1ms tick"
    // reading suggests (measured: 2.06s real -> 0:17 virtual, 5.07s real ->
    // 0:30 virtual). 8s real time comfortably clears virtual t=31s even at
    // the slowest observed rate (~5.9x), which a 2s wait never did -- so the
    // burst branch of core/blink.ts, and its timeline lane, previously had
    // no E2E coverage at all despite this comment's old claim otherwise.
    await page.waitForTimeout(8000);

    // Stop -> Processing -> Replay.
    await page.getByRole('button', { name: 'Stop' }).click();
    await expect(page.locator('[data-screen="processing"]')).toBeVisible();
    await expect(page.locator('[data-screen="replay"]')).toBeVisible({ timeout: 15_000 });

    // The accessible event list carries at least one flagged moment.
    const eventItems = page.locator('.event-list-wrap .event-list li');
    await expect(eventItems.first()).toBeVisible();
    expect(await eventItems.count()).toBeGreaterThanOrEqual(1);

    // The scripted blink-burst specifically fired and was recognised --
    // previously unreachable in under 2s of real time (see the comment
    // above), so this event type had zero E2E coverage before now. Scoped
    // to the accessible event list, not a bare page-wide text match: the
    // decorative (aria-hidden) timeline legend also has a "Blink burst"
    // label, which would otherwise make this locator ambiguous.
    await expect(page.locator('.event-list-wrap .event-list').getByText('Blink burst', { exact: false })).toBeVisible();

    // The scorecard shows a composure number, and the session auto-saved.
    await expect(page.locator('.composure-number')).toHaveText(/\d+(\.\d)?/);
    await expect(page.getByText('Saved to this browser')).toBeVisible();

    // Done -> Home, which now carries a one-line summary of the saved session.
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    await expect(page.locator('.history-summary')).toContainText('1 rehearsal saved on this device');

    // Progress -> Dashboard: the session is listed, and a trend renders.
    await page.getByRole('button', { name: 'Progress' }).click();
    await expect(page.locator('[data-screen="dashboard"]')).toBeVisible();
    await expect(page.locator('.history-list li')).toHaveCount(1);
    await expect(page.locator('.trend')).toBeVisible();

    // Wipe everything: gated behind typing DELETE exactly.
    await page.getByRole('button', { name: 'Wipe everything' }).click();
    const deleteBtn = page.getByRole('button', { name: 'Delete everything' });
    await expect(deleteBtn).toBeDisabled();
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await expect(deleteBtn).toBeEnabled();
    await deleteBtn.click();
    await expect(page.locator('.dashboard-empty')).toBeVisible();

    // Back to Home: the earlier summary is gone -- the wipe actually reset
    // local state, not just the dashboard's own view of it.
    await page.getByRole('button', { name: 'Back to home' }).click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();
    await expect(page.locator('.history-summary')).toHaveCount(0);
  });
});
