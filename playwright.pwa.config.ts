import { defineConfig } from '@playwright/test'

const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
)

export default defineConfig({
  testDir: './tests/browser',
  testMatch: 'pwa-transition.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 12_000 },
  reporter: [['line']],
  use: {
    baseURL: 'http://127.0.0.1:4175',
    browserName: 'chromium',
    reducedMotion: 'reduce',
    screenshot: 'off',
    trace: 'off',
    video: 'off',
    serviceWorkers: 'allow',
  },
  webServer: {
    command: 'node scripts/pwa-transition-server.mjs',
    url: 'http://127.0.0.1:4175/__pwa-state',
    reuseExistingServer: false,
    timeout: 180_000,
    env: inheritedEnvironment,
  },
})
