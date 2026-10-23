/**
 * News popup, page "Was ist neu" and the version effects (D-13,
 * core/updates.js, pages/news.js, core/update-effects.js): the popup comes
 * only after login, once per version, with the top features; the page lists
 * every release and is public; a new version is celebrated once per browser,
 * never with reduced motion, and the styleguide plays each effect. The test
 * server runs with DEBUG_MODE=true.
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, waitForDialog } = require('./helpers');
const { version, releases } = require('../updates.json');

const pieces = (page) => page.locator('#update-effects .update-effect-piece');
// Same rule as updateEffectKind(): patch -> bugs, minor -> power-up, major -> confetti
const [, minor, patch] = version.split('.').map(part => parseInt(part, 10));
const PIECE_CLASS = patch > 0 ? 'is-bug' : minor > 0 ? 'is-powerup' : 'is-confetti';

/** Skip only the boot animation, so the news popup is not pre-dismissed like in loginAs(). */
async function skipBoot(page) {
    await page.addInitScript(() => localStorage.setItem('dems_boot_ts', String(Date.now())));
}

/**
 * Log in as a persona with the news popup still unseen.
 *
 * @param {import('@playwright/test').Page} page -> Page.
 * @param {string} [persona] -> Persona id.
 * @returns {Promise<import('@playwright/test').Locator>} -> The open popup.
 */
async function openWithNews(page, persona = 'member') {
    await skipBoot(page);
    await page.goto(`/auth/dev-login/${persona}`);
    return waitForDialog(page, '#updatesModal');
}

test('the login page shows no news popup', async ({ page }) => {
    await skipBoot(page);
    await page.goto('/');
    await expect(page.locator('#login-section')).toBeVisible();
    // Give a late popup the chance to appear
    await page.waitForTimeout(1500);
    await expect(page.locator('#updatesModal')).toBeHidden();
});

test('after login the top features show once, with the effect, and closing counts as seen', async ({ page }) => {
    const errors = watchErrors(page);
    const dialog = await openWithNews(page);
    await expect(dialog.locator('#updates-version-badge')).toHaveText(version);
    const shown = await dialog.locator('.news-entry').count();
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThanOrEqual(3);
    for (const entry of releases[0].news.filter(item => item.highlight)) {
        await expect(dialog).toContainText(entry.title);
    }
    await expect(dialog.locator('#dont-show-again')).toHaveCount(0);
    await expect(pieces(page).first()).toBeAttached();
    await expect(pieces(page).first()).toHaveClass(new RegExp(PIECE_CLASS));

    // The effect layer lies over the dialog but takes no clicks
    await dialog.locator('.modal-footer .btn-accent').click();
    await expect(dialog).toBeHidden();
    await expect(pieces(page)).toHaveCount(0, { timeout: 10_000 });

    // Next page load: neither the popup nor the effect come back
    await page.reload();
    await expect(page.locator('#events-section')).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.locator('#updatesModal')).toBeHidden();
    await expect(pieces(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('"Alle Neuigkeiten" opens the page with every release; reading clears the Info dot', async ({ page }, testInfo) => {
    const dialog = await openWithNews(page);
    // The phone folds the navbar, so the dot is only on screen on the desktop
    if (testInfo.project.name === 'desktop') await expect(page.locator('#nav-info-badge')).toBeVisible();
    else await expect(page.locator('#nav-info-badge')).not.toHaveClass(/is-hidden/);
    await dialog.locator('[data-click="openAllNews"]').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#news-section')).toBeVisible();
    await expect(page.locator('#news-list .news-release')).toHaveCount(releases.length);
    await expect(page.locator('#news-list .news-release').first()).toHaveAttribute('open', '');
    await expect(page.locator('#news-list .news-release').nth(1)).not.toHaveAttribute('open', '');
    await expect(page.locator('#nav-info-badge')).toBeHidden();
    await page.reload();
    await expect(page.locator('#nav-info-badge')).toBeHidden();
});

test('an older release opens on click', async ({ page }) => {
    await skipBoot(page);
    await page.goto('/#news');
    const older = page.locator('#news-list .news-release').nth(1);
    await older.locator('summary').click();
    await expect(older).toHaveAttribute('open', '');
    await expect(older.locator('.news-entry').first()).toBeVisible();
});

test('the page works without login and the version badge of the info page leads to it', async ({ page }) => {
    await skipBoot(page);
    await page.goto('/#info');
    await expect(page.locator('#info-section')).toBeVisible();
    await page.locator('#info-version').click();
    await expect(page.locator('#news-section')).toBeVisible();
    await expect(page.locator('#login-section')).toBeHidden();
    await expect(page.locator('#news-list .news-release').first()).toContainText(version);
});

test('a first login shows the welcome dialog, never together with the news popup', async ({ page }) => {
    await skipBoot(page);
    await page.goto('/auth/dev-login/newbie');
    await expect(page.locator('#user-name')).not.toHaveText('');
    await page.waitForTimeout(1500);
    // The welcome dialog appears only on the very first login of the persona (shared database)
    if (await page.locator('#firstLoginModal').isVisible()) {
        await expect(page.locator('#updatesModal')).toBeHidden();
    }
});

test('with reduced motion the popup opens without an effect', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openWithNews(page);
    await expect(pieces(page)).toHaveCount(0);
    await expect(page.locator('#update-effects')).toBeHidden();
});

test('the styleguide plays every effect', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await page.goto('/#debug');
    await expect(page.locator('#debug-section')).toBeVisible();

    for (const [kind, pieceClass, count] of [['confetti', 'is-confetti', 60], ['powerup', 'is-powerup', 28], ['bugs', 'is-bug', 14]]) {
        await page.locator(`[data-click="playUpdateEffect"][data-kind="${kind}"]`).click();
        await expect(page.locator(`#update-effects .update-effect-piece.${pieceClass}`)).toHaveCount(count);
        // Place and timing come from the script, not from a style attribute
        const first = pieces(page).first();
        expect(await first.evaluate(element => element.style.left)).toMatch(/^[\d.]+%$/);
        expect(await first.evaluate(element => getComputedStyle(element).animationName)).toMatch(/^update-(confetti|powerup|bug)$/);
        expect(await first.getAttribute('style')).not.toBeNull();
    }
    expect(errors).toEqual([]);
});
