import { defineConfig, devices } from '@playwright/test';

// Node's process, declared here rather than pulling Node's types into the app's config.
declare const process: { env: Record<string, string | undefined> } | undefined;
const ci = typeof process !== 'undefined' && !!process.env.CI;

/** End-to-end tests drive the real app in Chromium against the Vite dev server. */
export default defineConfig({
  testDir: 'e2e',
  // Each test boots the whole app with WebGL; under parallel workers that takes a while.
  timeout: 60_000,
  fullyParallel: true,
  // A cold CI runner can be slow to bring WebGL up; locally a flake should show itself.
  retries: ci ? 2 : 0,
  reporter: ci ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    viewport: { width: 1400, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
