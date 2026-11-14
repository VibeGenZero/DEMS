/**
 * Privacy policy and consent (#138): an admin publishes a policy on the
 * System page, a new member then sees only the consent dialog, accepts and
 * reaches the events; the policy is public under "Datenschutz". Own server and
 * database per test: a stored policy would gate every other browser test.
 */
const path = require('path');
const { test, expect } = require('@playwright/test');
const { watchErrors } = require('./helpers');
const { createTempDir, startServer } = require('../test/helpers');
const { version } = require('../updates.json');

let server;
// The mock data names its banners under localhost (BASE_URL of dev mock mode) -> same origin
const base = () => server.baseUrl.replace('127.0.0.1', 'localhost');

test.beforeEach(async ({ page }) => {
    server = await startServer('dev/start.js', { DEV_SQLITE_PATH: path.join(createTempDir('e2e-privacy'), 'dev.sqlite') });
    await page.addInitScript((currentVersion) => {
        localStorage.setItem('dems_boot_ts', String(Date.now()));
        localStorage.setItem('dems_last_seen_version', currentVersion);
    }, version);
});

test.afterEach(async () => {
    await server.stop();
});

test('a published policy is public and every member accepts it before using DEMS', async ({ page, browser }) => {
    const errors = watchErrors(page);

    // Admin publishes the policy on the System page and accepts it right away
    await page.goto(`${base()}/auth/dev-login/admin`);
    await expect(page.locator('#events-section')).toBeVisible();
    await page.goto(`${base()}/#system/privacy`);
    await expect(page.locator('#system-section')).toBeVisible();
    await page.fill('#system-privacy-text', '# Datenschutz\n\nWir speichern nur, was Events brauchen.');
    await expect(page.locator('#system-privacy-preview h1')).toHaveText('Datenschutz');
    await page.click('[data-click="saveSystemPrivacy"]');
    await expect(page.locator('#app-toast')).toContainText('Fassung 1');
    // The admin is gated by the own policy as well: the next API answer opens the dialog
    await page.goto(`${base()}/#events`);
    await expect(page.locator('#privacyConsentModal')).toBeVisible();
    await page.click('#privacy-accept-btn');
    await expect(page.locator('#privacyConsentModal')).toBeHidden();
    expect(errors).toEqual([]);

    // A logged-out visitor finds the policy on the login page
    const visitor = await browser.newPage();
    await visitor.addInitScript(() => localStorage.setItem('dems_boot_ts', String(Date.now())));
    await visitor.goto(base());
    await expect(visitor.locator('#login-privacy-link')).toBeVisible();
    await visitor.click('#login-privacy-link');
    await expect(visitor.locator('#privacy-content h1')).toHaveText('Datenschutz');

    // A new member sees only the consent dialog, accepts and reaches the events
    const member = await browser.newPage();
    const memberErrors = watchErrors(member);
    await member.addInitScript((currentVersion) => {
        localStorage.setItem('dems_boot_ts', String(Date.now()));
        localStorage.setItem('dems_last_seen_version', currentVersion);
    }, version);
    await member.goto(`${base()}/auth/dev-login/member`);
    await expect(member.locator('#privacyConsentModal')).toBeVisible();
    await expect(member.locator('#privacy-consent-text h1')).toHaveText('Datenschutz');
    await expect(member.locator('#events-section')).toBeHidden();
    await member.click('#privacy-accept-btn');
    await expect(member.locator('#privacyConsentModal')).toBeHidden();
    await expect(member.locator('#events-section')).toBeVisible();
    expect(memberErrors).toEqual([]);
});

test('declining the policy logs out', async ({ page }) => {
    // Publish the policy as admin through the API, then log in as a member who declines
    await page.goto(`${base()}/auth/dev-login/admin`);
    await expect(page.locator('#events-section')).toBeVisible();
    await page.evaluate(async () => {
        const { token } = await (await fetch('/api/csrf-token')).json();
        await fetch('/api/admin/privacy', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token }, body: JSON.stringify({ markdown: '# Datenschutz' }) });
    });
    await page.context().clearCookies();

    await page.goto(`${base()}/auth/dev-login/raider`);
    await expect(page.locator('#privacyConsentModal')).toBeVisible();
    await page.click('[data-click="declinePrivacy"]');
    await expect(page.locator('#login-section')).toBeVisible();
});
