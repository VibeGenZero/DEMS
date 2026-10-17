/**
 * Motion of beta 2 (spec 2026-10-17-gsap-animations): the card flight,
 * springing dialogs and toasts, gliding filters and markers, growing bars
 * and flipping countdown digits. Seed data: dev/seedData.js (mock mode).
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, navigate, waitForDialog } = require('./helpers');

/** Transform of an element as the browser computed it ("none" or a matrix). */
const transformOf = (locator) => locator.evaluate(element => getComputedStyle(element).transform);
const isIdentity = (transform) => transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';

test('a dialog springs open and its buttons work at once', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the same dialog on the phone');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await navigate(page, 'admin');
    const row = page.locator('#admin-events-table .data-table tbody tr').first();
    await row.locator('[data-bs-toggle="dropdown"]').click();
    await row.locator('.dropdown-item.is-danger').click();
    const dialog = await waitForDialog(page, '#confirmModal');
    // The spring ends without a transform left on the box
    await expect.poll(async () => isIdentity(await transformOf(dialog.locator('.modal-dialog')))).toBe(true);
    await dialog.locator('[data-bs-dismiss="modal"]').click();
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
});

// ── Card flight ────────────────────────────────────────────────────────────

const OPEN_TITLE = 'Community-Spieleabend';
const overviewCard = (page) => page.locator('#events-grid .event-card', { hasText: OPEN_TITLE });
const flightLayer = (page) => page.locator('#card-flight');

/** Open the card by a click and wait until its page stands alone. */
async function flyOpen(page) {
    await overviewCard(page).click();
    await expect(page).toHaveURL(/#event\/dev-event-open$/);
    await expect(page.locator('#event-detail-section')).toBeVisible();
    await expect(flightLayer(page)).toBeHidden();
}

const near = (a, b) => Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2 && Math.abs(a.width - b.width) <= 2 && Math.abs(a.height - b.height) <= 2;

test('a card flies open into its event page', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop first; the phone runs the same code');
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    await expect(overviewCard(page)).toBeVisible();
    await overviewCard(page).click();
    await expect(flightLayer(page)).toBeVisible();
    await expect(page).toHaveURL(/#event\/dev-event-open$/);
    await expect(page.locator('#event-detail-section')).toBeVisible();
    await expect(flightLayer(page)).toBeHidden();
    expect(errors).toEqual([]);
});

for (const way of ['Esc', 'the back button', '"Zurück zur Übersicht"']) {
    test(`${way} flies the card home`, async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'desktop first; the phone runs the same code');
        const errors = watchErrors(page);
        await loginAs(page, 'member');
        await expect(overviewCard(page)).toBeVisible();
        // The cards appear one after the other; measure once this one rests
        await expect.poll(async () => isIdentity(await transformOf(overviewCard(page)))).toBe(true);
        const before = await overviewCard(page).boundingBox();
        await flyOpen(page);

        if (way === 'Esc') await page.keyboard.press('Escape');
        else if (way === 'the back button') await page.goBack();
        else await page.locator('[data-click="closeEventPage"]').click();

        // The URL changes at once, the flight starts with the hashchange after it
        await expect(flightLayer(page)).toBeVisible();
        await expect(page).toHaveURL(/#events$/);
        await expect(flightLayer(page)).toBeHidden();
        await expect(overviewCard(page)).not.toHaveClass(/is-flying/);
        await expect.poll(async () => near(await overviewCard(page).boundingBox(), before)).toBe(true);
        expect(errors).toEqual([]);
    });
}

test('a ctrl click opens the event in a new tab', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'no modifier keys on the phone');
    await loginAs(page, 'member');
    await expect(overviewCard(page)).toBeVisible();
    const [tab] = await Promise.all([context.waitForEvent('page'), overviewCard(page).click({ modifiers: ['Control'] })]);
    await tab.waitForLoadState();
    expect(tab.url()).toMatch(/#event\/dev-event-open$/);
    await expect(page).toHaveURL(/#events$/);
    await expect(flightLayer(page)).toBeHidden();
});

test('with reduced motion the event page opens without a flight', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop first; the phone runs the same code');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await loginAs(page, 'member');
    await expect(overviewCard(page)).toBeVisible();
    await page.evaluate(() => {
        const layer = document.getElementById('card-flight');
        window.flightSeen = false;
        new MutationObserver(() => {
            if (!layer.classList.contains('is-hidden') && layer.style.display !== 'none') window.flightSeen = true;
        }).observe(layer, { attributes: true });
    });
    await overviewCard(page).click();
    await expect(page).toHaveURL(/#event\/dev-event-open$/);
    await expect(page.locator('#event-detail-section')).toBeVisible();
    expect(await page.evaluate(() => window.flightSeen)).toBe(false);
});

test('Esc while typing a comment does not close the page', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'no Esc key on the phone');
    await loginAs(page, 'member');
    await expect(overviewCard(page)).toBeVisible();
    await flyOpen(page);
    await page.locator('#comment-input').click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/#event\/dev-event-open$/);
    await expect(flightLayer(page)).toBeHidden();
});

test('a slow overview still lands or fades the card', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop first; the phone runs the same code');
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    await expect(overviewCard(page)).toBeVisible();
    await flyOpen(page);
    // Only the way back is slow
    await page.route('**/api/events?upcoming=1*', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 2500));
        await route.continue();
    });
    await page.keyboard.press('Escape');
    await expect(flightLayer(page)).toBeVisible();
    await expect(flightLayer(page)).toBeHidden({ timeout: 3000 });
    await expect(page).toHaveURL(/#events$/);
    await expect(overviewCard(page)).not.toHaveClass(/is-flying/);
    expect(errors).toEqual([]);
});

test('a double click flies only once', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'no double click on the phone');
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    await expect(overviewCard(page)).toBeVisible();
    await page.evaluate(() => {
        window.mostSheets = 0;
        const count = () => {
            window.mostSheets = Math.max(window.mostSheets, document.querySelectorAll('.card-flight-sheet').length);
            requestAnimationFrame(count);
        };
        count();
    });
    await overviewCard(page).dblclick();
    await expect(page).toHaveURL(/#event\/dev-event-open$/);
    await expect(page.locator('#event-detail-section')).toBeVisible();
    await expect(flightLayer(page)).toBeHidden();
    expect(await page.evaluate(() => window.mostSheets)).toBe(1);
    expect(errors).toEqual([]);
});

test('a resized window lands the card at its new place', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop first; the phone runs the same code');
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    await expect(overviewCard(page)).toBeVisible();
    await flyOpen(page);
    await page.setViewportSize({ width: 1100, height: 800 });
    // Note every style the flight writes on the sheet: the last box is where the card landed
    await page.evaluate(() => {
        window.lastSheet = null;
        new MutationObserver((records) => {
            for (const record of records) {
                if (!record.target.classList || !record.target.classList.contains('card-flight-sheet')) continue;
                const box = record.target.getBoundingClientRect();
                if (box.width > 0) window.lastSheet = { x: box.x, y: box.y, width: box.width, height: box.height };
            }
        }).observe(document.getElementById('card-flight'), { attributes: true, attributeFilter: ['style'], subtree: true });
    });
    await page.keyboard.press('Escape');
    await expect(flightLayer(page)).toBeVisible();
    await expect(flightLayer(page)).toBeHidden();
    const landed = await page.evaluate(() => window.lastSheet);
    const card = await overviewCard(page).boundingBox();
    expect(Math.abs(landed.x - card.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(landed.y - card.y)).toBeLessThanOrEqual(4);
    expect(Math.abs(landed.width - card.width)).toBeLessThanOrEqual(4);
    expect(errors).toEqual([]);
});

// ── Filtering ──────────────────────────────────────────────────────────────

// Real cards only: the skeletons while loading carry no event id
const gridCards = (page) => page.locator('#events-grid .event-card[data-event-id]');

/** Every card rests: no transform left, fully opaque, and no CSS animation (the section fade) runs. */
async function cardsAtRest(page) {
    return page.evaluate(() => document.getAnimations().every(animation => animation.playState !== 'running') && [...document.querySelectorAll('#events-grid .event-card')].every((card) => {
        if (!card.dataset.eventId) return false;
        const style = getComputedStyle(card);
        return (style.transform === 'none' || style.transform === 'matrix(1, 0, 0, 1, 0, 0)') && style.opacity === '1';
    }));
}

test('filtering glides the remaining cards into place', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop first; the phone runs the same code');
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    await expect.poll(() => cardsAtRest(page)).toBe(true);
    const total = await gridCards(page).count();

    await page.locator('#category-filter-bar [data-category="Raid"]').click();
    await expect(gridCards(page)).toHaveCount(1);
    await expect.poll(() => cardsAtRest(page)).toBe(true);
    // The raid card glided into the first cell of the grid (the scrollbar may be gone now)
    const firstPlace = await page.locator('#events-grid').evaluate((grid) => {
        const box = grid.getBoundingClientRect();
        const style = getComputedStyle(grid);
        return { x: box.left + parseFloat(style.paddingLeft), y: box.top + parseFloat(style.paddingTop) };
    });
    await expect.poll(async () => {
        const raid = await gridCards(page).first().boundingBox();
        return Math.abs(raid.x - firstPlace.x) <= 1 && Math.abs(raid.y - firstPlace.y) <= 1;
    }).toBe(true);

    await page.locator('#category-filter-bar [data-category=""]').click();
    await expect(gridCards(page)).toHaveCount(total);
    await expect.poll(() => cardsAtRest(page)).toBe(true);
    expect(errors).toEqual([]);
});

test('fast typing leaves every card at its grid place', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop first; the phone runs the same code');
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    await expect.poll(() => cardsAtRest(page)).toBe(true);
    const total = await gridCards(page).count();
    const places = await gridCards(page).evaluateAll(cards => cards.map(card => card.getBoundingClientRect().top));

    const search = page.locator('#events-search');
    await search.pressSequentially('raid', { delay: 0 });
    await search.fill('');
    await expect(gridCards(page)).toHaveCount(total);
    await page.waitForTimeout(1000);
    expect(await cardsAtRest(page)).toBe(true);
    expect(await gridCards(page).evaluateAll(cards => cards.map(card => card.getBoundingClientRect().top))).toEqual(places);
    expect(errors).toEqual([]);
});

// ── Bars and numbers ───────────────────────────────────────────────────────

test('bars and numbers end at their values', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop first; the phone runs the same code');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await expect.poll(() => cardsAtRest(page)).toBe(true);
    // Overview: each meter ends at the places its card names ("5 von 20 belegt")
    const readMeters = () => page.evaluate(() => [...document.querySelectorAll('#events-grid .event-card')].map((card) => {
        const meter = card.querySelector('.capacity-meter');
        const match = (card.querySelector('.capacity-text')?.textContent || '').match(/^(\d+) von/);
        return meter && match ? [meter.value, Number(match[1])] : null;
    }).filter(Boolean));
    expect((await readMeters()).length).toBeGreaterThan(0);
    await expect.poll(async () => (await readMeters()).every(([value, taken]) => value === taken)).toBe(true);

    // Poll: the bars reach the widths of their votes
    await page.evaluate(() => { window.location.hash = '#poll/dev-poll-raid'; });
    await expect(page.locator('.poll-bar-yes').first()).toBeVisible();
    const readBars = () => page.locator('.poll-bar-yes, .poll-bar-maybe').evaluateAll(list => list.map(bar => [bar.style.width, `${Math.min(100, Math.max(0, Number(bar.dataset.styleWidth) || 0))}%`]));
    expect((await readBars()).length).toBeGreaterThan(0);
    await expect.poll(async () => (await readBars()).every(([width, expected]) => width === expected)).toBe(true);

    // Admin: the numbers count up to the statistics
    await navigate(page, 'admin');
    await expect(page.locator('#admin-stats .stat-value').first()).toBeVisible();
    const stats = await page.evaluate(async () => (await fetch('/api/admin/stats')).json());
    await expect.poll(() => page.locator('#admin-stats .stat-value').allTextContents()).toEqual([stats.events.total, stats.events.active, stats.registrations.total, stats.registrations.pending, stats.registrations.accepted, stats.registrations.waitlisted].map(String));
    expect(errors).toEqual([]);
});
