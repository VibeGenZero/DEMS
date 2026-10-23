/**
 * Profile page (D-08): "Kommende Events" first, the history below; profile
 * card, badges and settings in a side column. Seed data: dev/seedData.js
 * (dev mock mode).
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, navigate } = require('./helpers');

const upcoming = (page) => page.locator('#profile-upcoming .profile-event');
const row = (page, title) => upcoming(page).filter({ hasText: title });
const history = (page) => page.locator('#profile-history .profile-history-row');

test('the desktop shows the events beside the side column, the first one without scrolling', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop layout');
    const errors = watchErrors(page);
    await loginAs(page, 'raider');
    await navigate(page, 'profile');
    await expect(upcoming(page).first()).toBeVisible();

    const first = await upcoming(page).first().boundingBox();
    const card = await page.locator('#profile-card').boundingBox();
    expect(first.x + first.width).toBeLessThanOrEqual(card.x);
    expect(first.y + first.height).toBeLessThan(page.viewportSize().height);
    // Badges and settings follow the card in the same column
    const badges = await page.locator('#profile-badges').boundingBox();
    const settings = await page.locator('#account-settings-card').boundingBox();
    expect(badges.y).toBeGreaterThanOrEqual(card.y + card.height);
    expect(settings.y).toBeGreaterThanOrEqual(badges.y + badges.height);
    expect(settings.x).toBe(card.x);
    expect(errors).toEqual([]);
});

test('the phone stacks card, events, badges and settings and nothing sticks out', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone layout');
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    await navigate(page, 'profile');
    await expect(upcoming(page).first()).toBeVisible();

    const top = async (selector) => (await page.locator(selector).boundingBox()).y;
    const order = [await top('#profile-card'), await top('#profile-upcoming'), await top('#profile-badges'), await top('#account-settings-card')];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
});

test('the member sees every status by start, the history below and can go to the check-in', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    await navigate(page, 'profile');

    // Other specs share the database and register the member for their own "E2E …" events for a moment
    await expect(upcoming(page).filter({ hasNotText: /E2E / })).toHaveCount(4);
    await expect(upcoming(page).nth(0)).toContainText('Live: Speedrun-Marathon');
    await expect(upcoming(page).nth(0)).toContainText('Läuft gerade');
    // Elif, Greta and Tom wait for the full event; Tom registered last (W-05)
    await expect(row(page, 'Koop-Abend (5 Plätze)')).toContainText('Warteliste · Platz 3 von 3');
    await expect(row(page, 'Turnier: Arena-Cup')).toContainText('Ausstehend');
    await expect(row(page, 'Workshop: Streaming-Setup')).toContainText('Abgelehnt');
    await expect(row(page, 'Workshop: Streaming-Setup')).toHaveClass(/is-muted/);

    await expect(history(page)).toHaveCount(3);
    await expect(history(page).nth(0)).toContainText('Retro-Spieleabend');
    await expect(history(page).nth(0)).toContainText('Eingecheckt');
    await expect(history(page).filter({ hasText: 'LAN-Abend' })).toContainText('Abgesagt');
    // The archived event stays listed, but a member cannot open it
    await expect(page.locator('#profile-history div.profile-history-row', { hasText: 'Sommerfest' })).toBeVisible();
    await expect(page.locator('#profile-history-more')).toBeHidden();

    // "Einchecken" leads to the event page, where the code is entered
    await expect(row(page, 'Live: Speedrun-Marathon')).toContainText('Einchecken');
    await row(page, 'Live: Speedrun-Marathon').click();
    await expect(page.locator('#detail-title')).toHaveText('Live: Speedrun-Marathon');
    await expect(page.locator('#checkin-code-input')).toBeVisible();
    expect(errors).toEqual([]);
});

test('the raider tells both dates of the series apart and is checked in', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'raider');
    await navigate(page, 'profile');

    const training = row(page, 'Wöchentliches Training');
    await expect(training).toHaveCount(2);
    const days = await training.locator('.date-tile').allTextContents();
    expect(new Set(days).size).toBe(2);

    await expect(row(page, 'Live: Speedrun-Marathon')).toContainText('Eingecheckt');
    await expect(row(page, 'Live: Speedrun-Marathon')).not.toContainText('Einchecken');
    await expect(page.locator('#profile-card')).toContainText('Anmeldungen');
    // Reached badges carry their colour, set by a script and not by a style attribute
    const icon = page.locator('#profile-badges .badge-row:not(.is-locked) .badge-row-icon').first();
    await expect(icon).toHaveAttribute('data-style-color', /^#[0-9a-f]{6}$/);
    expect(await icon.evaluate(element => element.style.color)).not.toBe('');
    expect(errors).toEqual([]);
});

test('the admin sees the slot, a new member an invitation to the overview', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await navigate(page, 'profile');
    await expect(row(page, 'Raid: Schattenfestung')).toContainText('Schaden');

    await page.context().clearCookies();
    await loginAs(page, 'newbie');
    await navigate(page, 'profile');
    await expect(page.locator('#profile-upcoming')).toContainText('Noch nichts geplant');
    await expect(page.locator('#profile-history-block')).toBeHidden();
    await page.locator('#profile-upcoming a.btn', { hasText: 'Events ansehen' }).click();
    await expect(page.locator('#events-section')).toBeVisible();
    expect(errors).toEqual([]);
});

test('the member reads the own place on the waitlist on the event page (W-05)', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    await page.evaluate(() => { window.location.hash = '#event/dev-event-full'; });
    await expect(page.locator('#detail-reg-status')).toHaveText('Platz 3 von 3 auf der Warteliste');
    expect(errors).toEqual([]);
});

test('the member switches waitlist DMs off and the choice stays after a reload (W-16)', async ({ page }, testInfo) => {
    // Both projects share the database; one run keeps the member's switch free of races
    test.skip(testInfo.project.name !== 'desktop', 'same settings on the phone');
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    await navigate(page, 'profile');
    const settings = page.locator('#account-settings-card');
    await expect(settings).toContainText('Discord-Nachrichten');
    for (const kind of ['reminders', 'changes', 'waitlist']) {
        await expect(page.locator(`#notify-${kind}-toggle`)).toBeChecked();
    }

    await page.locator('#notify-waitlist-toggle').uncheck();
    await expect(page.locator('#toast-message')).toHaveText('Warteliste per DM aus.');
    await page.reload();
    await navigate(page, 'profile');
    await expect(page.locator('#notify-waitlist-toggle')).not.toBeChecked();
    await expect(page.locator('#notify-reminders-toggle')).toBeChecked();

    // Back to the default for the other specs
    await page.locator('#notify-waitlist-toggle').check();
    await expect(page.locator('#toast-message')).toHaveText('Warteliste per DM an.');
    expect(errors).toEqual([]);
});
