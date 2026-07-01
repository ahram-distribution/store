import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 180000,
  expect: { timeout: 20000 },
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'on',
    video: 'on',
    trace: 'on',
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },
  webServer: {
    command: 'node ./node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173',
    port: 5173,
    cwd: '.',
    timeout: 60000,
    reuseExistingServer: true,
  },
  retries: 1,
})
