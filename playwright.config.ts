// E2E config: one chromium project with fake camera/mic devices (so the
// real, non-mock capture path can run headless without an actual webcam),
// against a locally built-and-served copy of the app. `webServer` always
// builds fresh (`npm run build`) before serving -- a stale `dist/` from an
// earlier manual build would silently test the wrong code -- and never
// reuses an already-running server, so a leftover process on 4173 fails
// loudly instead of masking what's actually under test.

import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    port: 4173,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
