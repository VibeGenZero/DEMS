/**
 * Browser smoke tests (npm run test:e2e): a tour through the app in dev mock
 * mode, every persona on a desktop and a phone viewport. Not part of npm test,
 * which stays fast and needs no browser download.
 */
const os = require('os');
const path = require('path');
const { defineConfig, devices } = require('@playwright/test');

const PORT = 3123;

module.exports = defineConfig({
    testDir: 'e2e',
    timeout: 30_000,
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    reporter: [['list']],
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'retain-on-failure'
    },
    // Dark scheme pinned: the app follows the system scheme (D-15) and Playwright
    // emulates light by default. e2e/theme.spec.js sets the scheme itself.
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' } },
        { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, colorScheme: 'dark' } }
    ],
    webServer: {
        // Own port and a fresh database per run -> never touches data/dems.dev.sqlite
        command: 'node dev/start.js',
        url: `http://localhost:${PORT}/healthz`,
        // DEBUG_MODE shows the styleguide (#debug), which e2e/styleguide.spec.js walks through
        env: { PORT: String(PORT), DEV_SQLITE_PATH: path.join(os.tmpdir(), `dems-e2e-${Date.now()}.sqlite`), DEBUG_MODE: 'true' },
        reuseExistingServer: false,
        timeout: 60_000
    }
});
