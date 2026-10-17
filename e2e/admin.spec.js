/**
 * Admin dashboard (D-07): the event table with tabs, search, sorting, series
 * rows, one main action and a menu per row. Seed data: dev/seedData.js (dev
 * mock mode). Desktop and phone share one database, so tests that change
 * something create their own event.
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, navigate, waitForDialog } = require('./helpers');

const rows = (page) => page.locator('#admin-events-table .data-table tbody tr');
const row = (page, title) => rows(page).filter({ hasText: title });
const tab = (page, label) => page.locator('#admin-events-tabs .nav-link', { hasText: label });
const toast = (page) => page.locator('#app-toast');

async function openAdmin(page) {
    await loginAs(page, 'admin');
    await navigate(page, 'admin');
    await expect(rows(page).first()).toBeVisible();
}

/** Send an admin request from the page, with the CSRF token of its session. */
async function adminRequest(page, method, path, body) {
    return page.evaluate(async ([requestMethod, requestPath, requestBody]) => {
        const { token } = await (await fetch('/api/csrf-token')).json();
        const res = await fetch(requestPath, {
            method: requestMethod,
            headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': token },
            body: requestBody ? JSON.stringify(requestBody) : undefined
        });
        return res.json();
    }, [method, path, body]);
}

/** Create an event of this test; the title is unique per project and run. */
async function createEvent(page, testInfo, fields = {}) {
    const title = `E2E ${testInfo.project.name} ${testInfo.title.slice(0, 20)} ${Date.now()}`;
    const created = await adminRequest(page, 'POST', '/api/admin/events', {
        title, status: 'draft', accessMode: 'open', approvalMode: 'instant', startDate: new Date(Date.now() + 7 * 86_400_000).toISOString(), ...fields
    });
    return { id: created.id, title };
}

test('the tabs sort the events by status', async ({ page }) => {
    const errors = watchErrors(page);
    await openAdmin(page);
    await expect(tab(page, 'Aktiv')).toHaveClass(/\bactive\b/);
    await expect(rows(page).first()).toContainText('Live: Speedrun-Marathon');
    await expect(rows(page).first()).toContainText('Läuft gerade');
    await expect(row(page, 'Turnier: Arena-Cup').locator('.btn-primary')).toHaveText(/Anmeldungen · 2 offen/);
    // Ended three hours ago: over, archived only a day after its end (W-01)
    const past = row(page, 'Feierabend-Runde');
    await expect(past).toContainText('Vorbei');
    await expect(past.locator('.data-table-buttons > .btn')).toHaveText(/Archivieren/);
    await expect(page.locator('#admin-events-table')).not.toContainText('Sommerfest');

    await tab(page, 'Entwürfe').click();
    await expect(row(page, 'Entwurf: Halloween-Special').locator('.data-table-buttons > .btn')).toHaveText(/Veröffentlichen/);
    await tab(page, 'Archiv').click();
    await expect(row(page, 'Sommerfest')).toBeVisible();
    // The scheduler archived the week-old retro evening at start
    await expect(row(page, 'Retro-Spieleabend')).toBeVisible();
    expect(errors).toEqual([]);
});

test('search and sorting work on the loaded list', async ({ page }, testInfo) => {
    let listRequests = 0;
    page.on('request', request => { if (request.url().endsWith('/api/admin/all-events')) listRequests += 1; });
    await openAdmin(page);

    await page.locator('#admin-events-search').fill('raid');
    await expect(row(page, 'Raid: Schattenfestung')).toBeVisible();
    await expect(page.locator('#admin-events-table')).not.toContainText('Community-Spieleabend');
    await page.locator('#admin-events-search').fill('sommerfest');
    await expect(page.locator('#admin-events-table')).toContainText('Keine Treffer');
    await expect(page.locator('#admin-events-table')).toContainText('Archiv 1');
    await page.locator('[data-click="resetAdminSearch"]').click();
    await expect(page.locator('#admin-events-search')).toHaveValue('');
    await expect(row(page, 'Community-Spieleabend')).toBeVisible();

    // The heads are only reachable on the desktop; the phone keeps the default order
    if (testInfo.project.name === 'desktop') {
        const head = page.locator('#admin-events-table th', { hasText: 'Event' });
        await head.locator('.data-table-sort').click();
        await expect(head).toHaveAttribute('aria-sort', 'ascending');
        await expect(rows(page).first()).toContainText('Community-Spieleabend');
        await head.locator('.data-table-sort').click();
        await expect(head).toHaveAttribute('aria-sort', 'descending');
    }
    expect(listRequests).toBe(1);
});

test('a series opens its dates', async ({ page }) => {
    await openAdmin(page);
    const series = row(page, 'Wöchentliches Training');
    await expect(series).toContainText(/Serie · \d Termine/);
    await expect(page.locator('#admin-events-table tr.is-sub')).toHaveCount(0);
    await series.locator('[data-click="toggleAdminSeries"]').click();
    await expect(page.locator('#admin-events-table tr.is-sub').first()).toContainText('Termin 1 von');
    await page.locator('[data-click="toggleAdminSeries"]').click();
    await expect(page.locator('#admin-events-table tr.is-sub')).toHaveCount(0);
});

test('the menu opens above the rows and stays inside the window', async ({ page }) => {
    await openAdmin(page);
    const first = rows(page).first();
    await first.locator('[data-bs-toggle="dropdown"]').click();
    const menu = first.locator('.dropdown-menu.show');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.dropdown-item').last()).toHaveText(/Löschen …/);
    const box = await menu.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
    // Every entry can be hit: no following row lies on top of the menu
    for (const item of await menu.locator('.dropdown-item').all()) {
        await item.scrollIntoViewIfNeeded();
        const onTop = await item.evaluate(element => {
            const itemBox = element.getBoundingClientRect();
            const hit = document.elementFromPoint(itemBox.left + itemBox.width / 2, itemBox.top + itemBox.height / 2);
            return element === hit || element.contains(hit);
        });
        expect(onTop).toBe(true);
    }
});

test('a draft is published, then deleted through the menu and the dialog', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    const { title } = await createEvent(page, testInfo);
    await navigate(page, 'admin');
    await tab(page, 'Entwürfe').click();
    await row(page, title).locator('.data-table-buttons > .btn').click();
    await expect(toast(page)).toContainText('Event ist jetzt aktiv.');
    await expect(row(page, title)).toHaveCount(0);

    await tab(page, 'Aktiv').click();
    const published = row(page, title);
    await expect(published.locator('.data-table-buttons > .btn')).toHaveText(/Anmeldungen/);

    // Dismissing the dialog keeps the event
    await published.locator('[data-bs-toggle="dropdown"]').click();
    await published.locator('.dropdown-item.is-danger').click();
    const dialog = await waitForDialog(page, '#confirmModal');
    await expect(dialog).toContainText(title);
    await dialog.locator('[data-bs-dismiss="modal"]').click();
    await expect(dialog).toBeHidden();
    await expect(published).toBeVisible();

    await published.locator('[data-bs-toggle="dropdown"]').click();
    await published.locator('.dropdown-item.is-danger').click();
    await waitForDialog(page, '#confirmModal');
    await page.locator('#confirm-modal-ok').click();
    await expect(toast(page)).toContainText('Event gelöscht.');
    await expect(row(page, title)).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('a cancelled event shows in the archive', async ({ page }, testInfo) => {
    await loginAs(page, 'admin');
    const { id, title } = await createEvent(page, testInfo);
    await adminRequest(page, 'PUT', `/api/admin/events/${id}/status`, { status: 'cancelled' });
    await navigate(page, 'admin');
    await tab(page, 'Archiv').click();
    await expect(row(page, title)).toContainText('Abgesagt');
    await adminRequest(page, 'DELETE', `/api/admin/events/${id}`);
});

test('a click on the confirm button during the fade-in does not delete after "Abbrechen"', async ({ page }, testInfo) => {
    await loginAs(page, 'admin');
    const { id, title } = await createEvent(page, testInfo);
    await navigate(page, 'admin');
    await tab(page, 'Entwürfe').click();
    await expect(row(page, title)).toBeVisible();
    const deletes = [];
    page.on('request', request => { if (request.method() === 'DELETE') deletes.push(request.url()); });
    // Both clicks in one task: the second lands while Bootstrap fades the dialog in and ignores hide()
    await row(page, title).locator('.dropdown-item.is-danger').evaluate(item => {
        item.click();
        document.getElementById('confirm-modal-ok').click();
    });
    const dialog = await waitForDialog(page, '#confirmModal');
    await dialog.locator('[data-bs-dismiss="modal"]').click();
    await expect(dialog).toBeHidden();
    // A wrong yes would send the request as soon as the dialog has closed
    await page.waitForTimeout(500);
    expect(deletes).toEqual([]);
    await expect(row(page, title)).toBeVisible();
    await adminRequest(page, 'DELETE', `/api/admin/events/${id}`);
});

test('the desktop shows compact rows with one main action', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop layout');
    await openAdmin(page);
    const heights = await rows(page).evaluateAll(list => list.map(element => element.getBoundingClientRect().height));
    // Two lines of text plus the bar; a card of the old dashboard was about 500 px tall
    expect(Math.max(...heights)).toBeLessThanOrEqual(110);
    for (const tableRow of await rows(page).all()) {
        await expect(tableRow.locator('.data-table-buttons > .btn')).toHaveCount(1);
        await expect(tableRow.locator('[data-bs-toggle="dropdown"]')).toHaveCount(1);
    }
});

test('the phone stacks the rows and nothing sticks out', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone layout');
    await openAdmin(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const first = rows(page).first();
    const title = await first.locator('.data-table-title').boundingBox();
    const actions = await first.locator('.data-table-buttons').boundingBox();
    expect(actions.y).toBeGreaterThan(title.y + title.height);
});

test('the bot control center lists no ended event', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the list is the same on the phone');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await navigate(page, 'bot-control');
    const running = page.locator('#bot-running-events');
    await expect(running.locator('.running-event-card', { hasText: 'Live: Speedrun-Marathon' }).locator('.live-indicator')).toBeVisible();
    await expect(running).not.toContainText('Retro-Spieleabend');
    await expect(running).not.toContainText('Feierabend-Runde');
    expect(errors).toEqual([]);
});
