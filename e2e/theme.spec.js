/**
 * Colour schemes (D-15): the system scheme by default, the choice in the
 * profile, stored in the browser. The other specs run in the dark scheme
 * (playwright.config.js); these set the system scheme themselves.
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, navigate } = require('./helpers');

const html = (page) => page.locator('html');
const choice = (page, name) => page.locator('#account-settings-card .theme-choice-option').filter({ hasText: name });

test.describe('with a light system', () => {
    test.use({ colorScheme: 'light' });

    test('a light system shows the light scheme from the first stylesheet on', async ({ page }) => {
        // Note the scheme at the moment the first stylesheet enters the page, i.e. before the first paint
        await page.addInitScript(() => {
            new MutationObserver((records, observer) => {
                const link = records.flatMap(record => [...record.addedNodes]).find(node => node.nodeName === 'LINK');
                if (!link) return;
                window.schemeAtFirstStylesheet = document.documentElement.getAttribute('data-bs-theme');
                observer.disconnect();
            }).observe(document, { childList: true, subtree: true });
        });
        await page.goto('/');
        await expect(html(page)).toHaveAttribute('data-bs-theme', 'light');
        expect(await page.evaluate(() => window.schemeAtFirstStylesheet)).toBe('light');
        const colors = await page.evaluate(() => ({
            page: getComputedStyle(document.body).backgroundColor,
            token: getComputedStyle(document.documentElement).getPropertyValue('--bg-primary').trim()
        }));
        expect(colors.token).toBe('#f2f3f5');
        expect(colors.page).toBe('rgb(242, 243, 245)');
    });

    test('the profile choice switches at once and survives a reload', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'the same on the phone');
        const errors = watchErrors(page);
        await loginAs(page, 'member');
        await expect(html(page)).toHaveAttribute('data-bs-theme', 'light');
        await navigate(page, 'profile');
        await expect(page.locator('#theme-choice-system')).toBeChecked();

        await choice(page, 'Dunkel').click();
        await expect(html(page)).toHaveAttribute('data-bs-theme', 'dark');
        await expect(page.locator('#theme-choice-dark')).toBeChecked();

        await page.reload();
        await expect(html(page)).toHaveAttribute('data-bs-theme', 'dark');
        await navigate(page, 'profile');
        await expect(page.locator('#theme-choice-dark')).toBeChecked();
        expect(errors).toEqual([]);
    });

    test('system follows the operating system live', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'the same on the phone');
        await loginAs(page, 'member');
        await navigate(page, 'profile');
        await choice(page, 'Hell').click();
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect(html(page)).toHaveAttribute('data-bs-theme', 'light');

        await choice(page, 'System').click();
        await expect(html(page)).toHaveAttribute('data-bs-theme', 'dark');
        await page.emulateMedia({ colorScheme: 'light' });
        await expect(html(page)).toHaveAttribute('data-bs-theme', 'light');
    });

    test('the light scheme loads every main page without console errors', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'the tour covers the phone');
        const errors = watchErrors(page);
        await loginAs(page, 'admin');
        await expect(html(page)).toHaveAttribute('data-bs-theme', 'light');
        await page.goto('/#event/dev-event-open');
        await expect(page.locator('#event-detail-section')).toBeVisible();
        for (const route of ['profile', 'polls', 'admin', 'info']) await navigate(page, route);
        expect(errors).toEqual([]);
    });
});
