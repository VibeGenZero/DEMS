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

/** Note every style the flight writes on the sheet; the last box is where it landed. */
function watchLanding(page) {
    return page.evaluate(() => {
        window.lastSheet = null;
        new MutationObserver((records) => {
            for (const record of records) {
                if (!record.target.classList || !record.target.classList.contains('card-flight-sheet')) continue;
                const box = record.target.getBoundingClientRect();
                if (box.width > 0) window.lastSheet = { x: box.x, y: box.y, width: box.width, height: box.height };
            }
        }).observe(document.getElementById('card-flight'), { attributes: true, attributeFilter: ['style'], subtree: true });
    });
}

/** The sheet landed on the card as it stands now (the overview may have changed meanwhile). */
async function landedOnCard(page) {
    const landed = await page.evaluate(() => window.lastSheet);
    const card = await overviewCard(page).boundingBox();
    return Boolean(landed && card) && Math.abs(landed.x - card.x) <= 4 && Math.abs(landed.y - card.y) <= 4 && Math.abs(landed.width - card.width) <= 4;
}

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
        await flyOpen(page);
        await watchLanding(page);

        if (way === 'Esc') await page.keyboard.press('Escape');
        else if (way === 'the back button') await page.goBack();
        else await page.locator('[data-click="closeEventPage"]').click();

        // The URL changes at once, the flight starts with the hashchange after it
        await expect(flightLayer(page)).toBeVisible();
        await expect(page).toHaveURL(/#events$/);
        await expect(flightLayer(page)).toBeHidden();
        await expect(overviewCard(page)).not.toHaveClass(/is-flying/);
        expect(await landedOnCard(page)).toBe(true);
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
    await watchLanding(page);
    await page.keyboard.press('Escape');
    await expect(flightLayer(page)).toBeVisible();
    await expect(flightLayer(page)).toBeHidden();
    expect(await landedOnCard(page)).toBe(true);
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
    // Compare with the answer the page rendered: other specs create and delete events in the same database meanwhile
    const statsAnswer = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/stats');
    await navigate(page, 'admin');
    await expect(page.locator('#admin-stats .stat-value').first()).toBeVisible();
    const stats = await (await statsAnswer).json();
    await expect.poll(() => page.locator('#admin-stats .stat-value').allTextContents()).toEqual([stats.events.total, stats.events.active, stats.registrations.total, stats.registrations.pending, stats.registrations.accepted, stats.registrations.waitlisted, stats.registrations.tentative].map(String));
    expect(errors).toEqual([]);
});

// ── Gliding markers ────────────────────────────────────────────────────────

/** Whether the centre of `marker` stands under the centre of `link` (±2 px). */
async function markerUnder(page, markerSelector, link) {
    const marker = await page.locator(markerSelector).boundingBox();
    const box = await link.boundingBox();
    if (!marker || !box) return false;
    return Math.abs((marker.x + marker.width / 2) - (box.x + box.width / 2)) <= 2;
}

test('the navbar marker glides under the active link', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the folded menu on the phone keeps its underline');
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    const events = page.locator('#main-navbar .nav-link[data-section="events-section"]');
    await expect.poll(() => markerUnder(page, '#nav-marker', events)).toBe(true);
    await navigate(page, 'profile');
    const profile = page.locator('#main-navbar .nav-link[data-section="profile-section"]');
    await expect.poll(() => markerUnder(page, '#nav-marker', profile)).toBe(true);
    // The old underline of the active link is gone on the desktop
    const underline = await profile.evaluate(link => getComputedStyle(link, '::after').display);
    expect(underline).toBe('none');
    expect(errors).toEqual([]);
});

test('the marker follows a resized window', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the folded menu on the phone keeps its underline');
    await loginAs(page, 'member');
    await navigate(page, 'profile');
    const profile = page.locator('#main-navbar .nav-link[data-section="profile-section"]');
    await expect.poll(() => markerUnder(page, '#nav-marker', profile)).toBe(true);
    await page.setViewportSize({ width: 1100, height: 800 });
    await expect.poll(() => markerUnder(page, '#nav-marker', profile)).toBe(true);
});

test('the admin tab glider follows the tab', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop first; the phone runs the same code');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await navigate(page, 'admin');
    const tabs = page.locator('#admin-events-tabs');
    await expect(tabs.locator('.nav-glider')).toBeVisible();
    await expect.poll(() => markerUnder(page, '#admin-events-tabs .nav-glider', tabs.locator('.nav-link.active'))).toBe(true);
    await tabs.locator('.nav-link', { hasText: 'Entwürfe' }).click();
    await expect(tabs.locator('.nav-link.active')).toContainText('Entwürfe');
    await expect.poll(() => markerUnder(page, '#admin-events-tabs .nav-glider', tabs.locator('.nav-link.active'))).toBe(true);
    // The glider fills the tab, the tab itself shows no surface of its own
    const glider = await tabs.locator('.nav-glider').boundingBox();
    const active = await tabs.locator('.nav-link.active').boundingBox();
    expect(Math.abs(glider.width - active.width)).toBeLessThanOrEqual(2);
    expect(await tabs.locator('.nav-link.active').evaluate(link => getComputedStyle(link).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    expect(errors).toEqual([]);
});

// ── Countdown ──────────────────────────────────────────────────────────────

test('the countdown flips only the digits that change', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop first; the phone runs the same code');
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    await page.evaluate(() => { window.location.hash = '#event/dev-event-open'; });
    const cells = page.locator('#detail-countdown-area .countdown-digit');
    await expect(cells.first()).toBeVisible();
    // Note whether a digit ever flips (the new one comes in as .countdown-digit-next)
    await page.evaluate(() => {
        window.flipped = 0;
        new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) if (node.classList && node.classList.contains('countdown-digit-next')) window.flipped += 1;
            }
        }).observe(document.getElementById('detail-countdown-area'), { childList: true, subtree: true });
    });
    const count = await cells.count();
    const before = await cells.allTextContents();
    await page.waitForTimeout(1600);
    const after = await cells.allTextContents();
    expect(after.length).toBe(count);
    const changed = after.filter((digit, i) => digit !== before[i]).length;
    expect(changed).toBeGreaterThan(0);
    // Each flip touched one cell; seconds tick, so not every digit changed
    expect(changed).toBeLessThan(count);
    expect(await page.evaluate(() => window.flipped)).toBeGreaterThan(0);
    // Once landed every cell holds one digit again. One read for both: the next
    // second may start a new flip between two separate queries.
    await expect.poll(() => page.evaluate(() => {
        const area = document.getElementById('detail-countdown-area');
        return area.querySelector('.countdown-digit-next') ? -1 : area.querySelectorAll('.countdown-digit > span').length;
    })).toBe(count);
    expect(errors).toEqual([]);
});

// ── Success moment ─────────────────────────────────────────────────────────

test('registering celebrates in place', async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop first; the phone runs the same code');
    const errors = watchErrors(page);
    // An admin creates an open event of this test: desktop and phone share the database
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await loginAs(adminPage, 'admin');
    const title = `E2E Erfolg ${Date.now()}`;
    const created = await adminPage.evaluate(async (eventTitle) => {
        const { token } = await (await fetch('/api/csrf-token')).json();
        const res = await fetch('/api/admin/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token },
            body: JSON.stringify({ title: eventTitle, status: 'active', accessMode: 'open', approvalMode: 'instant', maxParticipants: 10, startDate: new Date(Date.now() + 7 * 86_400_000).toISOString() })
        });
        return res.json();
    }, title);
    try {
        await loginAs(page, 'member');
        await page.evaluate((id) => { window.location.hash = `#event/${id}`; }, created.id);
        await expect(page.locator('#detail-title')).toHaveText(title);
        await page.locator('#register-btn').click();
        await expect(page.locator('#detail-registered')).toBeVisible();
        await expect(page.locator('#sidebar-status-btn')).toContainText('Angemeldet');
        await expect.poll(() => page.locator('#sidebar-capacity-content .capacity-meter').evaluate(meter => meter.value)).toBe(1);
        // The spring leaves nothing behind
        await expect.poll(async () => isIdentity(await transformOf(page.locator('#detail-registered')))).toBe(true);

        page.once('dialog', dialog => dialog.accept());
        await page.locator('#unregister-btn').click();
        await expect(page.locator('#register-btn')).toBeVisible();
        await expect(page.locator('#detail-registered')).toBeHidden();
        expect(errors).toEqual([]);
    } finally {
        await adminPage.evaluate(async (id) => {
            const { token } = await (await fetch('/api/csrf-token')).json();
            await fetch(`/api/admin/events/${id}`, { method: 'DELETE', headers: { 'X-CSRF-TOKEN': token } });
        }, created.id);
        await adminContext.close();
    }
});

test('a navbar click during the flight wins and leaves no flight behind', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the folded menu on the phone needs two clicks');
    const errors = watchErrors(page);
    await loginAs(page, 'member');
    await expect(overviewCard(page)).toBeVisible();
    await overviewCard(page).click();
    await expect(flightLayer(page)).toBeVisible();
    await page.waitForTimeout(250);
    await page.locator('#main-navbar .nav-link[data-section="polls-section"]').click();
    await expect(page).toHaveURL(/#polls$/);
    await expect(page.locator('#polls-section')).toBeVisible();
    await expect(flightLayer(page)).toBeHidden();
    await page.waitForTimeout(1200);
    await expect(page).toHaveURL(/#polls$/);
    await expect(page.locator('#event-detail-section')).toBeHidden();

    // Back to the overview: no flight comes back from the dead
    await page.evaluate(() => {
        const layer = document.getElementById('card-flight');
        window.flightSeen = false;
        new MutationObserver(() => {
            if (!layer.classList.contains('is-hidden') && layer.style.display !== 'none') window.flightSeen = true;
        }).observe(layer, { attributes: true });
    });
    await page.locator('#main-navbar .nav-link[data-section="events-section"]').click();
    await expect(overviewCard(page)).toBeVisible();
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.flightSeen)).toBe(false);
    await expect(overviewCard(page)).not.toHaveClass(/is-flying/);
    expect(errors).toEqual([]);
});

test('leaving the page while the flight fades out ends the flight', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the folded menu on the phone needs two clicks');
    await loginAs(page, 'member');
    await expect(overviewCard(page)).toBeVisible();
    // A slow event answer keeps the flight between "URL changed" and "layer faded"
    await page.route('**/api/events/dev-event-open', async (route) => {
        await new Promise(resolve => setTimeout(resolve, 1500));
        await route.continue();
    });
    await overviewCard(page).click();
    // The URL turns to the event when the sheet covers the window; the page loads, then the layer fades
    await expect(page).toHaveURL(/#event\/dev-event-open$/);
    await page.locator('#main-navbar .nav-link[data-section="polls-section"]').click();
    await expect(page).toHaveURL(/#polls$/);
    await expect(flightLayer(page)).toBeHidden();
    await page.evaluate(() => {
        const layer = document.getElementById('card-flight');
        window.flightSeen = false;
        new MutationObserver(() => {
            if (!layer.classList.contains('is-hidden') && layer.style.display !== 'none') window.flightSeen = true;
        }).observe(layer, { attributes: true });
    });
    await page.locator('#main-navbar .nav-link[data-section="events-section"]').click();
    await expect(overviewCard(page)).toBeVisible();
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => window.flightSeen)).toBe(false);
});

test('the wizard opens with the glider under its active tab', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop first; the phone runs the same code');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await navigate(page, 'admin');
    await page.locator('[data-click="showCreateEventModal"]').click();
    await waitForDialog(page, '#eventModal');
    const tabs = page.locator('#wizard-mode');
    const active = tabs.locator('.nav-link.active');
    await expect(active).toContainText('Bearbeiten');
    // Either the glider stands under the tab, or the tab keeps its own surface: never neither
    await expect.poll(async () => {
        const glider = await tabs.locator('.nav-glider').boundingBox().catch(() => null);
        const box = await active.boundingBox();
        const ownSurface = await active.evaluate(link => getComputedStyle(link).backgroundColor !== 'rgba(0, 0, 0, 0)');
        const gliderUnder = Boolean(glider) && glider.width > 0 && Math.abs(glider.x - box.x) <= 2 && Math.abs(glider.width - box.width) <= 2;
        return gliderUnder || ownSurface;
    }).toBe(true);
    expect(errors).toEqual([]);
});
