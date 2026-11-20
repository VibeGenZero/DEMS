/**
 * Official plugin „Design anpassen“ (plugins/custom-design/):
 * - published dark accent applies on the login screen and not in light mode
 * - ?design=standard disables the custom theme
 * - draft preview applies only in the admin's tab
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, openMenu, closeMenu, navigate, waitForDialog } = require('./helpers');

test.describe.configure({ mode: 'serial' });

test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'global theme state is shared across viewports');
});

async function openDesignPage(page) {
    await openMenu(page);
    const link = page.locator('#nav-p-custom-design-link');
    await expect(link).toBeAttached();
    const dropdownToggle = page.locator('#nav-plugins-toggle');
    if (await dropdownToggle.isVisible()) {
        await dropdownToggle.click();
    }
    await expect(link).toBeVisible();
    await link.click();
    await expect(page.locator('#plugin-section')).toBeVisible();
    await expect(page.locator('#plugin-title')).toHaveText('Design anpassen');
    await expect(page.locator('#cd-panel-tokens')).toBeVisible();
    await closeMenu(page);
}

async function resetDesignToDefault(page) {
    if (!(await page.locator('#cd-reset-btn').isVisible())) {
        await openDesignPage(page);
    }
    await page.locator('#cd-reset-btn').click();
    const dialog = await waitForDialog(page, '#confirmModal');
    await dialog.locator('#confirm-modal-ok').click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#cd-hex-dark-accent')).toHaveValue('');
}

async function readRootVar(page, name) {
    return page.evaluate(
        (prop) => getComputedStyle(document.documentElement).getPropertyValue(prop).trim(),
        name
    );
}

test('a published dark accent shows on the login screen and not in light mode', async ({ page, browser }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await openDesignPage(page);

    try {
        await page.locator('#cd-hex-dark-accent').fill('#123456');
        await page.locator('#cd-publish-btn').click();
        await expect(page.locator('.toast-container')).toContainText('Design veröffentlicht.');

        const anonContext = await browser.newContext();
        try {
            const anonPage = await anonContext.newPage();
            await anonPage.goto('/');
            await expect.poll(() => readRootVar(anonPage, '--accent')).toBe('#123456');

            await anonPage.evaluate(() => localStorage.setItem('dems_theme', 'light'));
            await anonPage.reload();
            await expect.poll(() => readRootVar(anonPage, '--accent')).toBe('#7c3aed');
        } finally {
            await anonContext.close();
        }
    } finally {
        await resetDesignToDefault(page);
    }
    expect(errors).toEqual([]);
});

test('design=standard shows the default', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await openDesignPage(page);

    try {
        await page.locator('#cd-hex-dark-accent').fill('#123456');
        await page.locator('#cd-publish-btn').click();
        await expect(page.locator('.toast-container')).toContainText('Design veröffentlicht.');

        await page.goto('/?design=standard');
        await expect.poll(() => readRootVar(page, '--accent')).toBe('#8b5cf6');

        await page.goto('/#admin?design=standard');
        await expect.poll(() => readRootVar(page, '--accent')).toBe('#8b5cf6');
    } finally {
        await page.goto('/#p/custom-design');
        await expect(page.locator('#cd-reset-btn')).toBeVisible();
        await resetDesignToDefault(page);
    }
    expect(errors).toEqual([]);
});

test('the preview shows the draft only in the admin tab', async ({ page, browser }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await openDesignPage(page);

    try {
        await page.locator('#cd-corners-round').check();
        await page.locator('#cd-preview-btn').click();
        await expect(page.locator('#design-preview-bar')).toBeVisible();

        await navigate(page, 'events');
        await expect(page.locator('#design-preview-bar')).toBeVisible();
        await expect.poll(() => readRootVar(page, '--radius')).toBe('18px');

        const otherContext = await browser.newContext();
        try {
            const otherPage = await otherContext.newPage();
            await otherPage.goto('/');
            await expect.poll(() => readRootVar(otherPage, '--radius')).toBe('12px');
        } finally {
            await otherContext.close();
        }

        await page.locator('#design-preview-bar [data-click="endDesignPreview"]').click();
        await expect(page.locator('#design-preview-bar')).toBeHidden();
        await expect.poll(() => readRootVar(page, '--radius')).toBe('12px');
    } finally {
        await openDesignPage(page);
        await resetDesignToDefault(page);
    }
    expect(errors).toEqual([]);
});
