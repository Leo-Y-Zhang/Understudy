// The privacy guarantee, enforced as code rather than just claimed in the
// consent screen's copy (see src/ui/screens/consent.ts's "See for yourself"
// section):
//   (a) a full mock rehearsal, start to finish, never makes a single
//       request off this page's own origin -- no uploads, no analytics, no
//       third-party anything;
//   (b) in real (non-mock) mode, the camera/microphone are never touched
//       before the user has clicked Accept on the consent screen.
//
// Both assertions read `baseURL` from the running Playwright project rather
// than hardcoding `http://localhost:4173` -- the same spec file is what
// task 17a's release proof re-runs against the live GitHub Pages URL (via a
// throwaway config that only overrides `use.baseURL` and drops
// `webServer`), so "same-origin" has to mean whatever origin this run is
// actually pointed at.

import { test, expect } from '@playwright/test';
import { runMockJourneyToReplay } from './helpers';

declare global {
  interface Window {
    __gumCalls: number[];
  }
}

test.describe('privacy', () => {
  test('the full mock journey never makes a request off this origin', async ({ page, baseURL }) => {
    if (!baseURL) throw new Error('playwright config must set use.baseURL for this check');

    const offOrigin: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith(baseURL)) offOrigin.push(url);
    });

    await runMockJourneyToReplay(page);

    // Also walk through the dashboard, which reads the just-saved session
    // back out of IndexedDB (openDb().listSessions()) -- still no network
    // I/O, and the one place besides replay's auto-save that touches
    // storage in this journey.
    await page.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Progress' }).click();
    await expect(page.locator('[data-screen="dashboard"]')).toBeVisible();
    await expect(page.locator('.history-list li')).toHaveCount(1);

    expect(offOrigin).toEqual([]);
  });

  test('the camera is never requested before consent is accepted', async ({ page, context, baseURL }) => {
    if (!baseURL) throw new Error('playwright config must set use.baseURL for this check');

    // Belt-and-braces alongside the project's --use-fake-ui-for-media-stream
    // launch flag: grant camera/mic up front so a real (non-mock) session
    // can actually start once we reach it, without a real permission
    // prompt getting in the way of the assertions below.
    await context.grantPermissions(['camera', 'microphone'], { origin: baseURL });

    // Wrap getUserMedia *before* any page script runs, so every call --
    // however early -- gets a timestamp.
    await page.addInitScript(() => {
      window.__gumCalls = [];
      const mediaDevices = navigator.mediaDevices;
      const original = mediaDevices.getUserMedia.bind(mediaDevices);
      mediaDevices.getUserMedia = (constraints?: MediaStreamConstraints) => {
        window.__gumCalls.push(Date.now());
        return original(constraints);
      };
    });

    // Real mode: no ?mock=1. A fresh context has no stored consent, so
    // consent is the first screen regardless.
    await page.goto('./');
    await expect(page.locator('[data-screen="consent"]')).toBeVisible();
    expect(await page.evaluate(() => window.__gumCalls.length)).toBe(0);

    const acceptedAt = Date.now();
    await page.getByRole('button', { name: 'Accept and continue' }).click();
    await expect(page.locator('[data-screen="home"]')).toBeVisible();

    await page.getByRole('button', { name: 'Rehearse' }).click();
    await expect(page.locator('[data-screen="question"]')).toBeVisible();
    await page.getByRole('button', { name: /ready/i }).click();
    await expect(page.locator('[data-screen="session"]')).toBeVisible();

    // Session mounts and immediately starts real capture (Camera.start() ->
    // getUserMedia); the fake-device flags let this succeed headless.
    await expect(page.locator('.rec-indicator')).toBeVisible({ timeout: 20_000 });

    const gumCalls = await page.evaluate(() => window.__gumCalls);
    expect(gumCalls.length).toBeGreaterThan(0);
    for (const calledAt of gumCalls) {
      expect(calledAt).toBeGreaterThanOrEqual(acceptedAt);
    }
  });

  // Pins the consent screen's copy against the two claims a HIGH-severity
  // review round found drifting from reality (src/ui/screens/consent.ts's
  // "Your data, your control" section): replay auto-saves scores/flagged
  // moments to IndexedDB the moment a session finishes, so "exists only in
  // memory... disappears on reload" was false. This test has no opinion on
  // the exact wording -- only that the copy keeps saying the true thing
  // ("saved to this browser") and never regresses to the false one ("only
  // in memory"), and that the substantive on-device guarantee ("The
  // guarantee" section) isn't quietly softened while fixing the other claim.
  test('consent copy accurately describes what is saved, and never claims analysis is memory-only', async ({
    page,
  }) => {
    await page.goto('./');
    const consent = page.locator('[data-screen="consent"]');
    await expect(consent).toBeVisible();

    const text = (await consent.textContent()) ?? '';
    expect(text).toMatch(/saved to this browser/i);
    expect(text).not.toMatch(/only in memory/i);
    expect(text).toMatch(/ever leaves this device/i);
  });
});
