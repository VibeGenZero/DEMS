/**
 * Official plugin „Event einreichen“ (plugins/event-submissions/):
 * member sees the navbar tab, submits an idea and sees it under „Deine Vorschläge“;
 * admin sees it in „Alle Vorschläge“.
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, openMenu, closeMenu } = require('./helpers');

async function openPluginTab(page) {
    await openMenu(page);
    const link = page.locator('#nav-p-event-submissions-link');
    await expect(link).toBeAttached();
    const dropdownToggle = page.locator('#nav-plugins-toggle');
    if (await dropdownToggle.isVisible()) {
        await dropdownToggle.click();
    }
    await expect(link).toBeVisible();
    await expect(link).toContainText('Event einreichen');
    await link.click();
    await expect(page.locator('#plugin-section')).toBeVisible();
    await closeMenu(page);
}

test('a member submits an event idea and an admin sees it in all submissions', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    const title = `Brettspiel-Nacht (${testInfo.project.name})`;

    await loginAs(page, 'member');
    await openPluginTab(page);

    await expect(page.locator('#plugin-title')).toHaveText('Event einreichen');
    await expect(page.locator('#plugin-root')).toContainText('Deine Vorschläge');
    await expect(page.locator('#plugin-root')).toContainText('Retro-Konsolenabend');

    await page.locator('#es-title').fill(title);
    await page.locator('#es-description').fill('Gemeinsam **Siedler** und Koop-Spiele.');
    await page.locator('#es-category').selectOption('Gamenight');
    await page.locator('#es-submit-btn').click();

    await expect(page.locator('#plugin-root')).toContainText(title);

    await loginAs(page, 'admin');
    await openPluginTab(page);
    await expect(page.locator('#plugin-root')).toContainText('Alle Vorschläge');
    await expect(page.locator('#plugin-root')).toContainText(title);
    expect(errors).toEqual([]);
});
