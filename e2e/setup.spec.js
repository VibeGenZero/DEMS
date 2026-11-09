/**
 * Setup wizard of a fresh installation (#138): PIN, the Discord guide, the
 * Discord step against a fake Discord, server values, reset password,
 * privacy policy, done. Every test starts its own server in setup mode.
 */
const path = require('path');
const { test, expect } = require('@playwright/test');
const { watchErrors } = require('./helpers');
const { createTempDir, startServer } = require('../test/helpers');

const PIN = '24681357';
let server;

test.beforeEach(async () => {
    server = await startServer('test/fixtures/fakeSetupServer.js', {
        SQLITE_PATH: path.join(createTempDir('e2e-setup'), 'dems.sqlite'),
        SETUP_PIN: PIN
    });
});

test.afterEach(async () => {
    await server.stop();
});

test('a fresh installation is set up in the browser, guided step by step', async ({ page }) => {
    const errors = watchErrors(page);
    await page.addInitScript(() => localStorage.setItem('dems_boot_ts', String(Date.now())));
    await page.goto(server.baseUrl);

    // PIN
    await expect(page.locator('#setup-step-pin')).toBeVisible();
    await expect(page.locator('#login-section')).toBeHidden();
    await page.fill('#setup-pin', '00000000');
    await page.click('#setup-pin-submit');
    await expect(page.locator('#setup-error')).toContainText('Falsche Setup-PIN.');
    await page.fill('#setup-pin', PIN);
    await page.click('#setup-pin-submit');

    // Discord step with the guide
    await expect(page.locator('#setup-step-discord')).toBeVisible();
    const guide = page.locator('#setup-guide');
    await expect(guide.locator('.setup-guide-step')).toHaveCount(5);
    await expect(guide.locator('#guide-step-1')).toHaveAttribute('open', '');
    await guide.locator('#guide-step-1 [data-click="markGuideStepDone"]').click();
    await expect(guide.locator('#guide-step-1 .bi-check-circle-fill')).toBeVisible();
    await expect(guide.locator('#guide-step-2')).toHaveAttribute('open', '');
    await expect(guide.locator('#guide-step-2 code')).toHaveText(`${server.baseUrl}/auth/discord/callback`);

    // The invite link appears once a client id is typed
    await page.click('[data-click="openGuideStep"][data-guide-step="5"]');
    await expect(guide.locator('#guide-step-5')).toHaveAttribute('open', '');
    await page.fill('#setup-client-id', '123456789012345678');
    await guide.locator('#guide-step-4 summary').click();
    await expect(guide.locator('.setup-guide-invite')).toHaveAttribute('href', /client_id=123456789012345678/);

    await page.fill('#setup-client-secret', 'client-secret');
    await page.fill('#setup-bot-token', 'bot-token');
    await page.fill('#setup-guild-id', '234567890123456789');
    await page.click('#setup-discord-submit');

    // Server
    await expect(page.locator('#setup-step-server')).toBeVisible();
    await expect(page.locator('#setup-server-intro')).toContainText('Fake-Gilde');
    await expect(page.locator('#setup-base-url')).toHaveValue(server.baseUrl);
    await page.selectOption('#setup-admin-role', '310000000000000001');
    await page.selectOption('#setup-announce-channel', '320000000000000001');
    await page.click('[data-click="submitSetupServer"]');

    // Security
    await expect(page.locator('#setup-step-security')).toBeVisible();
    await page.fill('#setup-reset-password', 'ein-langes-passwort');
    await page.fill('#setup-reset-password-repeat', 'ein-langes-passwort');
    await page.click('[data-click="submitSetupSecurity"]');

    // Privacy policy with preview
    await expect(page.locator('#setup-step-privacy')).toBeVisible();
    await page.fill('#setup-privacy-text', '# Datenschutz\n\nWir speichern nur, was Events brauchen.');
    await expect(page.locator('#setup-privacy-preview h1')).toHaveText('Datenschutz');
    await page.click('#setup-complete-submit');

    // Done
    await expect(page.locator('#setup-step-done')).toBeVisible();
    await expect(page.locator('#setup-step-done a[href="/auth/discord"]')).toBeVisible();
    await expect(page.locator('#setup-done-restart')).toBeHidden();
    expect(errors).toEqual([]);

    // After a reload DEMS is set up: the login page instead of the wizard
    await page.reload();
    await expect(page.locator('#login-section')).toBeVisible();
    await expect(page.locator('#setup-section')).toBeHidden();
});
