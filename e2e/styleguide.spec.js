/**
 * Styleguide (#debug): tokens and the components render on desktop and
 * phone. The test server runs with DEBUG_MODE=true (playwright.config.js).
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, waitForDialog } = require('./helpers');

const BLOCKS = ['button', 'card', 'chip', 'tabs', 'dialog', 'toast', 'empty-state', 'skeleton', 'avatar', 'date-tile', 'capacity'];

async function openStyleguide(page) {
    await loginAs(page, 'admin');
    await page.goto('/#debug');
    await expect(page.locator('#debug-section')).toBeVisible();
}

test('the styleguide shows the tokens and all components', async ({ page }) => {
    const errors = watchErrors(page);
    await openStyleguide(page);
    await expect(page.locator('#sg-tokens .sg-token').first()).toBeVisible();
    expect(await page.locator('#sg-tokens .sg-token').count()).toBeGreaterThan(80);
    await expect(page.locator('#sg-tokens .sg-token[data-token="--text-muted"] .sg-token-contrast')).toHaveText('5,62 : 1 auf Karte');
    await expect(page.locator('#sg-tokens .sg-token[data-token="--on-accent"] .sg-token-contrast')).toHaveText('5,70 : 1 auf --accent-fill');
    await expect(page.locator('#sg-tokens .sg-token[data-token="--accent-fill"] .sg-token-contrast')).toHaveText('');
    // Buttons are 32, 40 and 48 px tall and are no flex boxes: a flex box drops the
    // space between an icon and its label
    const sizes = page.locator('#sg-button .sg-row').nth(1).locator('.btn');
    const boxes = await sizes.evaluateAll(buttons => buttons.map(button => ({ height: button.getBoundingClientRect().height, flex: getComputedStyle(button).display.includes('flex') })));
    expect(boxes).toEqual([{ height: 32, flex: false }, { height: 40, flex: false }, { height: 48, flex: false }]);
    for (const block of BLOCKS) await expect(page.locator(`#sg-${block}`)).toBeVisible();
    // Chips are 28 or 22 px tall with centred text, also when a utility class such as
    // d-inline-block overrides their display (admin dashboard, bot centre)
    await expect(page.locator('#sg-chip .event-category-tag.d-inline-block')).toHaveCount(1);
    const chips = await page.locator('#sg-chip').evaluate(block => [...block.querySelectorAll('.chip, .badge-pill, .category-pill, .event-status-badge, .event-category-tag')].map(chip => {
        const range = document.createRange();
        range.selectNodeContents(chip);
        const text = range.getBoundingClientRect();
        const box = chip.getBoundingClientRect();
        return { chip: chip.className, height: box.height, offCentre: Math.abs((text.top - box.top) - (box.bottom - text.bottom)) };
    }));
    expect(chips.filter(entry => entry.offCentre > 1.5 || ![22, 28].includes(Math.round(entry.height)))).toEqual([]);
    // The counter inside the active tab sits on three stacked tints and needs the primary text colour
    await expect(page.locator('#sg-tabs .nav-link.active .chip').first()).toHaveCSS('color', 'rgb(228, 228, 231)');
    // One large initials tile by design, two more from the images that fail to load
    await expect(page.locator('#sg-avatar span.avatar.avatar-lg.avatar-initials')).toHaveCount(3);
    await expect(page.locator('#sg-avatar img.avatar-lg')).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('long content stays inside the page and many tabs scroll sideways', async ({ page }, testInfo) => {
    await openStyleguide(page);
    const tooWide = await page.evaluate(() => [...document.querySelectorAll('#debug-section *')]
        .filter(element => !element.closest('.nav-pills') && element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .map(element => `${element.tagName.toLowerCase()}.${element.className}`)
        .slice(0, 5));
    expect(tooWide).toEqual([]);
    const manyTabs = page.locator('#sg-tabs .nav-pills').nth(1);
    const edges = await manyTabs.evaluate(element => ({ right: element.getBoundingClientRect().right, page: document.documentElement.clientWidth, scrolls: element.scrollWidth > element.clientWidth }));
    expect(edges.right).toBeLessThanOrEqual(edges.page + 1);
    if (testInfo.project.name === 'mobile') expect(edges.scrolls).toBe(true);
});

test('toast types differ, tabs switch and the dialog opens', async ({ page }) => {
    const errors = watchErrors(page);
    await openStyleguide(page);
    const toast = page.locator('#app-toast');
    const edge = () => toast.evaluate(element => getComputedStyle(element).borderLeftColor);

    await page.locator('#sg-toast [data-click="sgShowToast"][data-type="success"]').click();
    await expect(toast).toHaveClass(/\btoast-success\b/);
    await expect(toast).toBeVisible();
    const successEdge = await edge();
    await page.locator('#sg-toast [data-click="sgShowToast"][data-type="danger"]').click();
    await expect(toast).toHaveClass(/\btoast-danger\b/);
    expect(await edge()).not.toBe(successEdge);

    await page.locator('#sg-tabs [data-bs-target="#sg-tab-archive"]').click();
    await expect(page.locator('#sg-tab-archive')).toBeVisible();

    await page.locator('#sg-dialog [data-click="sgShowDialog"]').click();
    await waitForDialog(page, '#confirmModal');
    await page.locator('#confirmModal [data-bs-dismiss="modal"]').click();
    await expect(page.locator('#confirmModal')).toBeHidden();
    expect(errors).toEqual([]);
});
