/**
 * Effects of the news dialog (core/update-effects.js): a new version is
 * celebrated once per browser, never with reduced motion, and the styleguide
 * plays each effect. The test server runs with DEBUG_MODE=true.
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, waitForDialog } = require('./helpers');
const { version } = require('../updates.json');

const pieces = (page) => page.locator('#update-effects .update-effect-piece');
// Same rule as updateEffectKind(): patch -> bugs, minor -> power-up, major -> confetti
const [, minor, patch] = version.split('.').map(part => parseInt(part, 10));
const PIECE_CLASS = patch > 0 ? 'is-bug' : minor > 0 ? 'is-powerup' : 'is-confetti';

/**
 * Open the app with the news dialog: only the boot animation is skipped.
 *
 * @param {import('@playwright/test').Page} page -> Page.
 * @returns {Promise<import('@playwright/test').Locator>} -> The open dialog.
 */
async function openWithNews(page) {
    await page.addInitScript(() => localStorage.setItem('dems_boot_ts', String(Date.now())));
    await page.goto('/auth/dev-login/member');
    return waitForDialog(page, '#updatesModal');
}

test('a new version is celebrated once, and the dialog stays usable', async ({ page }) => {
    const errors = watchErrors(page);
    const dialog = await openWithNews(page);
    await expect(pieces(page).first()).toBeAttached();
    await expect(pieces(page).first()).toHaveClass(new RegExp(PIECE_CLASS));

    // The layer lies over the dialog but takes no clicks
    await dialog.locator('[data-click="closeUpdatesModal"]').click();
    await expect(dialog).toBeHidden();
    // The pieces clear themselves
    await expect(pieces(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('#update-effects')).toBeHidden();

    // Next page load: the dialog returns (nobody ticked "Nicht erneut anzeigen"), the effect does not
    await page.reload();
    await waitForDialog(page, '#updatesModal');
    await expect(pieces(page)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('with reduced motion the dialog opens without an effect', async ({ page }) => {
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
