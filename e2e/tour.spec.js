/**
 * Smoke tour: every persona walks through the core pages on desktop and phone.
 * Seed data: dev/seedData.js (dev mock mode).
 */
const { test, expect } = require('@playwright/test');
const { PERSONAS } = require('../dev/mockGuild');
const { watchErrors, loginAs, openMenu, navigate } = require('./helpers');

for (const persona of PERSONAS) {
    test(`tour as ${persona.id}`, async ({ page }) => {
        const errors = watchErrors(page);
        await loginAs(page, persona.id);

        // Event overview -> event page
        await expect(page.locator('#events-grid .event-card').first()).toBeVisible();
        await page.locator('#events-grid .event-card', { hasText: 'Community-Spieleabend' }).click();
        await expect(page.locator('#event-detail-section')).toBeVisible();
        await expect(page.locator('#detail-title')).toHaveText('Community-Spieleabend');

        await navigate(page, 'polls');
        await expect(page.locator('#polls-open .poll-card').first()).toBeVisible();

        await navigate(page, 'profile');
        await expect(page.locator('#profile-header')).toContainText(persona.displayName);

        await navigate(page, 'info');

        const isAdmin = persona.id === 'admin';
        if (isAdmin) {
            await navigate(page, 'admin');
            await expect(page.locator('#admin-events-grid .admin-event-card').first()).toBeVisible();
            await navigate(page, 'bot-control');
        } else {
            await openMenu(page);
            await expect(page.locator('#nav-admin')).toBeHidden();
            // A member who types the address lands on the overview
            await page.goto('/#admin');
            await expect(page.locator('#events-section')).toBeVisible();
            await expect(page.locator('#admin-section')).toBeHidden();
        }

        expect(errors).toEqual([]);
    });
}

test('the raid shows the role picker to the raider and stays locked for others', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'raider');
    await page.goto('/#event/dev-event-role');
    await expect(page.locator('#slot-picker-area')).toBeVisible();
    await expect(page.locator('#detail-no-access')).toBeHidden();

    await page.context().clearCookies();
    await loginAs(page, 'member');
    await page.goto('/#event/dev-event-role');
    await expect(page.locator('#detail-no-access')).toBeVisible();
    expect(errors).toEqual([]);
});

test('logging out leads back to the login page', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    await openMenu(page);
    await page.locator('#logout-btn').click();
    await expect(page.locator('#login-section')).toBeVisible();
    expect(errors).toEqual([]);
});
