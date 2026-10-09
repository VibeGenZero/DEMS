/**
 * Shared steps of the browser smoke tests.
 */
const { expect } = require('@playwright/test');
const { version } = require('../updates.json');

/**
 * Collect uncaught errors and console errors of a page. Failed resource loads
 * (e.g. Discord avatars without network) are ignored.
 *
 * @param {import('@playwright/test').Page} page -> Page to watch.
 * @returns {string[]} -> Live list of error messages.
 */
function watchErrors(page) {
    const errors = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => {
        if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) errors.push(`console: ${msg.text()}`);
    });
    return errors;
}

/**
 * Log in as a dev mock persona and wait for the event overview.
 *
 * @param {import('@playwright/test').Page} page -> Page.
 * @param {string} personaId -> admin | raider | member | newbie.
 * @returns {Promise<void>}
 */
async function loginAs(page, personaId) {
    await page.addInitScript((currentVersion) => {
        // Skip the boot animation and the "Neuigkeiten" dialog; both would cover the page
        localStorage.setItem('dems_boot_ts', String(Date.now()));
        localStorage.setItem('dems_last_seen_version', currentVersion);
    }, version);
    await page.goto(`/auth/dev-login/${personaId}`);
    await expect(page.locator('#user-name')).not.toHaveText('');
    await expect(page.locator('#events-section')).toBeVisible();
    if (personaId === 'newbie') await closeWelcomeDialog(page);
}

/**
 * The first login shows a welcome dialog (shown once per user, so it may
 * already be gone when another viewport logged in first).
 *
 * @param {import('@playwright/test').Page} page -> Page.
 * @returns {Promise<void>}
 */
async function closeWelcomeDialog(page) {
    const dialog = page.locator('#firstLoginModal');
    const shown = await dialog.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);
    if (!shown) return;
    await dialog.locator('button.btn-accent').click();
    await expect(dialog).toBeHidden();
}

/**
 * Open the navigation (folded on the phone viewport) if needed.
 *
 * @param {import('@playwright/test').Page} page -> Page.
 * @returns {Promise<void>}
 */
async function openMenu(page) {
    const toggler = page.locator('.navbar-toggler');
    if (await toggler.isVisible() && !(await page.locator('#navContent').isVisible())) {
        await toggler.click();
        await expect(page.locator('#navContent')).toBeVisible();
    }
}

/**
 * Go to a section through the navigation, like a user does.
 *
 * @param {import('@playwright/test').Page} page -> Page.
 * @param {string} route -> Hash route, e.g. "profile".
 * @returns {Promise<void>}
 */
async function navigate(page, route) {
    await openMenu(page);
    await page.locator(`#navContent a.nav-link[href="#${route}"]`).click();
    await expect(page.locator(`#${route}-section`)).toBeVisible();
}

module.exports = { watchErrors, loginAs, openMenu, navigate };
