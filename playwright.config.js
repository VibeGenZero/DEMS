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
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
        { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 } }
    ],
    webServer: {
        // Own port and a fresh database per run -> never touches data/dems.dev.sqlite
        command: 'node dev/start.js',
        url: `http://localhost:${PORT}/healthz`,
        env: { PORT: String(PORT), DEV_SQLITE_PATH: path.join(os.tmpdir(), `dems-e2e-${Date.now()}.sqlite`) },
        reuseExistingServer: false,
        timeout: 60_000
    }
});
