import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/maintenance',
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0, // A real failure must not silently become green on retry.
  outputDir: 'test-results/maintenance/artifacts',
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/maintenance/playwright.json' }],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'https://jaakla.github.io/openmapstack-samples/tallinn-transit/',
    timezoneId: 'Europe/Tallinn',
    locale: 'et-EE',
    serviceWorkers: 'allow',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'services', testMatch: 'services.spec.js' },
    { name: 'desktop', testMatch: 'rider.spec.js', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', testMatch: 'rider.spec.js', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
