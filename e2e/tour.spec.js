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

        // Grid/calendar switch, month arrows and category filter run as data-click actions
        await page.locator('#view-calendar-btn').click();
        await expect(page.locator('#events-calendar')).toBeVisible();
        await page.locator('#events-calendar [data-click="shiftCalendarMonth"][data-delta="1"]').click();
        await page.locator('#view-grid-btn').click();
        await expect(page.locator('#events-grid')).toBeVisible();
        await page.locator('#category-filter-bar .category-pill', { hasText: 'Gaming' }).click();
        await expect(page.locator('#events-grid .event-card', { hasText: 'Community-Spieleabend' })).toBeVisible();
        await expect(page.locator('#events-grid')).not.toContainText('Raid: Schattenfestung');
        await page.locator('#category-filter-bar .category-pill', { hasText: 'Alle' }).click();

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
            // Audit log opens and closes through actions
            await page.locator('[data-click="loadAuditLog"]').click();
            await expect(page.locator('#audit-log-container')).toBeVisible();
            await page.locator('#audit-log-container [data-click="hide"]').click();
            await expect(page.locator('#audit-log-container')).toBeHidden();
            // Event wizard: open, next, step dot, back, close
            await page.locator('[data-click="showCreateEventModal"]').first().click();
            await expect(page.locator('#eventModal')).toBeVisible();
            await page.locator('#event-title').fill('E2E-Rundgang');
            await page.locator('#wizard-btn-next').click();
            await expect(page.locator('#wizard-step-counter')).toHaveText('Schritt 2 von 5');
            await page.locator('#eventModal [data-click="wizardGoTo"][data-step="4"]').click();
            await expect(page.locator('#wizard-step-counter')).toHaveText('Schritt 4 von 5');
            await page.locator('#wizard-btn-back').click();
            await expect(page.locator('#wizard-step-counter')).toHaveText('Schritt 3 von 5');
            await page.locator('#eventModal [data-bs-dismiss="modal"]').first().click();
            await expect(page.locator('#eventModal')).toBeHidden();
            await navigate(page, 'bot-control');
            await page.locator('[data-click="loadBotSettings"]').click();
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

    // Slot choice and wish roles run as data-click actions
    const firstSlot = page.locator('#slot-picker-cards [data-click="selectPrimarySlot"]').first();
    await firstSlot.click();
    await expect(firstSlot).toHaveClass(/selected/);
    const firstWish = page.locator('#slot-alt-chips [data-click="toggleAltSlot"]').first();
    await firstWish.click();
    await expect(firstWish).toHaveClass(/selected/);

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

test('the raider votes in the open poll', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'raider');
    await navigate(page, 'polls');
    await page.locator('#polls-open .poll-card').first().click();
    await expect(page.locator('#poll-detail-section')).toBeVisible();
    const yes = page.locator('#poll-detail [data-click="setPollVote"][data-state="yes"]').first();
    await yes.click();
    await expect(page.locator('#poll-detail [data-click="setPollVote"][data-state="yes"]').first()).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
});

test('the news dialog closes through its action', async ({ page }) => {
    const errors = watchErrors(page);
    // Skip only the boot animation, so the news dialog shows
    await page.addInitScript(() => localStorage.setItem('dems_boot_ts', String(Date.now())));
    await page.goto('/auth/dev-login/member');
    const dialog = page.locator('#updatesModal');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-click="closeUpdatesModal"]').click();
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
});
