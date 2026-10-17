/**
 * Login page of D-12: logged out the navbar shows only the logo and
 * "Info", the card the Discord server with its icon or initials, three
 * points and the one login button. No events without a login (decision 3).
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, openMenu } = require('./helpers');
const { version } = require('../updates.json');

test('logged out, the page offers one login and no way into the events', async ({ page }) => {
    const errors = watchErrors(page);
    await page.addInitScript((currentVersion) => {
        localStorage.setItem('dems_boot_ts', String(Date.now()));
        localStorage.setItem('dems_last_seen_version', currentVersion);
    }, version);
    await page.goto('/');
    await expect(page.locator('#login-section')).toBeVisible();

    // The mock server has no icon -> its initials
    await expect(page.locator('#login-server-icon .avatar-initials')).toHaveText('DD');
    await expect(page.locator('#login-server-name')).toHaveText('DEMS Dev Server');
    await expect(page.locator('#login-server-ref')).toHaveText('DEMS Dev Server');
    await expect(page.locator('#nav-brand-name')).toHaveText('DEMS Dev Server');
    await expect(page.locator('.login-points li')).toHaveCount(3);
    await expect(page.locator('a[href="/auth/discord"]:visible')).toHaveCount(1);

    await openMenu(page);
    await expect(page.locator('#logout-btn')).toBeHidden();
    await expect(page.locator('#nav-events')).toBeHidden();
    // The test server runs with DEBUG_MODE; the styleguide link waits for the login too
    await expect(page.locator('#nav-debug')).toBeHidden();
    await expect(page.locator('#navContent a[href="#info"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // A direct link leads to the login card, never to events
    await page.goto('/#events');
    await expect(page.locator('#login-section')).toBeVisible();
    await expect(page.locator('#events-section')).toBeHidden();
    expect(errors).toEqual([]);
});

test('after the login the events link is there and the login card is gone', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    await openMenu(page);
    await expect(page.locator('#nav-events')).toBeVisible();
    await expect(page.locator('#login-section')).toBeHidden();
    expect(errors).toEqual([]);
});
