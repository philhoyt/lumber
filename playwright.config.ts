import { defineConfig, devices } from '@playwright/test';

/** End-to-end tests drive the real app in Chromium against the Vite dev server. */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // CI can pass --retries=2 --reporter=github on the command line.
  reporter: 'list',
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
