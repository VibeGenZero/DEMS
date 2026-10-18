/**
 * Event page of D-05: facts first, one register button, on phones a bar at
 * the bottom. Seed data: dev/seedData.js (dev mock mode); the member is not
 * registered for "Community-Spieleabend", the raider has no role yet in the raid.
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs } = require('./helpers');

/** Open an event page the way a link from Discord does. */
async function openEvent(page, persona, id) {
    await loginAs(page, persona);
    await page.evaluate((eventId) => { window.location.hash = `#event/${eventId}`; }, id);
    await expect(page.locator('#detail-title')).not.toHaveText('');
}

const box = (page, selector) => page.locator(selector).boundingBox();

test('the phone shows the facts before the description, in the first screen', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone layout');
    const errors = watchErrors(page);
    await openEvent(page, 'member', 'dev-event-open');
    await expect(page.locator('#sidebar-date-row')).toBeVisible();
    const facts = await box(page, '#sidebar-capacity-panel');
    const date = await box(page, '#sidebar-date-row');
    const description = await box(page, '#detail-description');
    expect(date.y).toBeLessThan(description.y);
    // The places stand fully above the button bar
    const bar = await box(page, '#sidebar-action-area');
    expect(facts.y + facts.height).toBeLessThanOrEqual(bar.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width);
    expect(errors).toEqual([]);
});

test('the phone keeps the button at the bottom without covering the page end', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone layout');
    await openEvent(page, 'member', 'dev-event-open');
    const button = page.locator('#register-btn');
    await expect(button).toBeVisible();
    const height = page.viewportSize().height;
    const bar = await box(page, '#sidebar-action-area');
    expect(Math.abs(bar.y + bar.height - height)).toBeLessThanOrEqual(1);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    expect((await box(page, '#register-btn')).y + (await box(page, '#register-btn')).height).toBeLessThanOrEqual(height);
    // At the end of the page the comment button stands fully above the bar
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const send = page.locator('#comments-section button[type="submit"], #comments-section .comment-form button').first();
    await expect(send).toBeVisible();
    const sendBox = await send.boundingBox();
    const barBox = await box(page, '#sidebar-action-area');
    expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(barBox.y);
});

test('the desktop shows one register button and no gap under the banner', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop layout');
    const errors = watchErrors(page);
    await openEvent(page, 'member', 'dev-event-open');
    await expect(page.locator('#register-btn')).toBeVisible();
    await expect(page.locator('#event-detail-section button:visible', { hasText: /Teilnehmen|Jetzt anmelden|Warteliste setzen/ })).toHaveCount(1);
    const banner = await box(page, '#detail-banner-area');
    const back = await box(page, '#event-detail-section [data-click="closeEventPage"]');
    expect(back.y - (banner.y + banner.height)).toBeLessThanOrEqual(40);
    // The button stays in the sidebar, not in a bar
    const side = await box(page, '#detail-side');
    const button = await box(page, '#register-btn');
    expect(button.x).toBeGreaterThanOrEqual(side.x);
    expect(errors).toEqual([]);
});

test('a raider without a role gets sent to the role picker', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the same on the desktop');
    await openEvent(page, 'raider', 'dev-event-role');
    await page.locator('#register-btn').click();
    await expect(page.locator('#toast-message')).toHaveText('Bitte wähle eine Rolle aus.');
    await expect(page.locator('#slot-picker-area')).toBeInViewport();
    // The toast stands above the bar: the user wants to press the button again right away
    const toast = await box(page, '.toast-container');
    const bar = await box(page, '#sidebar-action-area');
    expect(toast.y + toast.height).toBeLessThanOrEqual(bar.y);
});

test('an empty required field stops the registration at that field', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the browser check is the same on the desktop');
    const registrations = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/register')) registrations.push(request.url()); });
    await openEvent(page, 'newbie', 'dev-event-form');
    await page.locator('#register-btn').click();
    // The browser's own check of the required fields runs first: it focuses the first empty one
    const field = page.locator('#form-field-0');
    await expect(field).toBeFocused();
    await expect(field).toBeInViewport();
    const fieldBox = await field.boundingBox();
    const bar = await box(page, '#sidebar-action-area');
    expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(bar.y);
    expect(registrations).toEqual([]);
});
