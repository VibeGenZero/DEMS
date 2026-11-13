/**
 * Admin dashboard (D-07): the event table with tabs, search, sorting, series
 * rows, one main action and a menu per row. Seed data: dev/seedData.js (dev
 * mock mode). Desktop and phone share one database, so tests that change
 * something create their own event.
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, navigate, waitForDialog, closeEditor } = require('./helpers');

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

test('admins tick a registration off in the registrations dialog and take it back (W-07)', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    const { id, title } = await createEvent(page, testInfo, { status: 'active' });
    // The admin registers for the own event; instant approval -> accepted
    await adminRequest(page, 'POST', `/api/events/${id}/register`, { formAnswers: {} });
    await navigate(page, 'admin');
    await row(page, title).locator('.data-table-buttons > .btn').click();
    const dialog = await waitForDialog(page, '#registrationsModal');

    const toggle = dialog.locator('[data-click="toggleRegCheckin"]');
    await expect(toggle).toHaveText(/Abhaken/);
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toast(page)).toContainText('Eingecheckt.');
    await expect(toggle).toHaveText(/Eingecheckt/);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await toggle.click();
    await expect(toast(page)).toContainText('Check-in zurückgenommen.');
    await expect(toggle).toHaveText(/Abhaken/);
    expect(errors).toEqual([]);
});

test('admins add a server member in the registrations dialog (W-06)', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    const { title } = await createEvent(page, testInfo, { status: 'active', approvalMode: 'manual' });
    await navigate(page, 'admin');
    await row(page, title).locator('.data-table-buttons > .btn').click();
    const dialog = await waitForDialog(page, '#registrationsModal');

    await dialog.locator('#reg-add-search').fill('dennis');
    const hit = dialog.locator('#reg-add-results [data-click="addRegistrationMember"]', { hasText: 'Dennis' });
    await hit.click();
    await expect(toast(page)).toContainText('Dennis eingetragen.');
    const added = dialog.locator('#registrations-tbody tr', { hasText: 'Dennis' });
    await expect(added).toContainText('Admin');
    await expect(added).toContainText('Angenommen');

    // A second search marks the member as already on the list
    await dialog.locator('#reg-add-search').fill('dennis');
    await expect(dialog.locator('#reg-add-results')).toContainText('schon angemeldet');
    await expect(hit).toHaveCount(0);
    expect(errors).toEqual([]);
});

// ── Member overview (W-15) ────────────────────────────────────

const memberRows = (page) => page.locator('#members-table .data-table tbody tr');

test('admins find a member, open the page and see the history', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await navigate(page, 'members');
    await expect(page.locator('#members-count')).toHaveText(/^\d+ Mitglieder$/);
    await expect(memberRows(page).first()).toBeVisible();

    await page.locator('#members-search').fill('kir');
    await expect(memberRows(page)).toHaveCount(1);
    await expect(memberRows(page).first()).toContainText('@kira');

    await page.locator('#members-search').fill('niemand-heisst-so');
    await expect(page.locator('#members-table')).toContainText('Keine Mitglieder gefunden');
    await page.locator('#members-table [data-click="resetMemberSearch"]').click();
    await expect(memberRows(page).nth(1)).toBeVisible();

    await page.locator('#members-search').fill('kira');
    await memberRows(page).first().locator('a.data-table-title').click();
    await expect(page.locator('#member-detail-section')).toBeVisible();
    await expect(page.locator('#member-detail')).toContainText('Teilnahmeverlauf');
    await expect(page.locator('#member-detail')).toContainText('Discord');
    await expect(page.locator('#member-detail .members-history-row').first()).toBeVisible();

    await page.locator('#member-detail-section a[href="#members"]').click();
    await expect(page.locator('#members-section')).toBeVisible();
    // The search survives the visit
    await expect(page.locator('#members-search')).toHaveValue('kira');
    expect(errors).toEqual([]);
});

test('the member list sorts by a column and flips on a second click', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the column heads are only read by screen readers on phones');
    await loginAs(page, 'admin');
    await navigate(page, 'members');
    const head = page.locator('#members-table th', { hasText: 'Teilnahmen' });
    await head.locator('button').click();
    await expect(head).toHaveAttribute('aria-sort', 'descending');
    const numbers = await page.locator('#members-table td[data-label="Teilnahmen"]').allTextContents();
    expect(numbers.map(Number)).toEqual([...numbers.map(Number)].sort((a, b) => b - a));
    await head.locator('button').click();
    await expect(head).toHaveAttribute('aria-sort', 'ascending');
});

test('members see no member overview and are sent away from it', async ({ page }) => {
    await loginAs(page, 'member');
    await expect(page.locator('#nav-members')).toBeHidden();
    await page.goto('/#members');
    await expect(page.locator('#events-section')).toBeVisible();
    await expect(page.locator('#members-section')).toBeHidden();
});

// ── Evaluations (W-14) ────────────────────────────────────────

async function openInsights(page) {
    await loginAs(page, 'admin');
    await navigate(page, 'admin');
    await page.locator('#admin-section a[href="#insights"]').click();
    await expect(page.locator('#insights-section')).toBeVisible();
    await expect(page.locator('#insights-totals .stat-card')).toHaveCount(4);
}

test('admins open the evaluations and switch the time range', async ({ page }) => {
    const errors = watchErrors(page);
    await openInsights(page);
    await expect(page.locator('#insights-ranges .nav-link.active')).toHaveText('90 Tage');
    await expect(page.locator('#insights-totals')).toContainText('Teilnahmequote');
    await expect(page.locator('#insights-totals')).toContainText('Auslastung');

    await page.locator('#insights-ranges [data-range="all"]').click();
    await expect(page.locator('#insights-ranges .nav-link.active')).toHaveText('Alles');
    await expect(page.locator('#insights-table')).toContainText('Sommerfest');
    await expect(page.locator('#insights-categories .insights-category').first()).toBeVisible();
    await expect(page.locator('#insights-categories progress.capacity-meter').first()).toBeVisible();
    expect(errors).toEqual([]);
});

test('the evaluated events sort by quote', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'the column heads are only read by screen readers on phones');
    await openInsights(page);
    await page.locator('#insights-ranges [data-range="all"]').click();
    await expect(page.locator('#insights-table tbody tr').first()).toBeVisible();
    const head = page.locator('#insights-table th', { hasText: 'Quote' });
    await head.locator('button').click();
    await expect(head).toHaveAttribute('aria-sort', 'descending');
    const quotes = (await page.locator('#insights-table td[data-label="Quote"]').allTextContents())
        .filter(text => text !== '–').map(text => parseInt(text, 10));
    expect(quotes).toEqual([...quotes].sort((a, b) => b - a));
});

test('members are sent away from the evaluations', async ({ page }) => {
    await loginAs(page, 'member');
    await page.goto('/#insights');
    await expect(page.locator('#events-section')).toBeVisible();
    await expect(page.locator('#insights-section')).toBeHidden();
});

// ── Message to all participants (W-09) ────────────────────────

test('admins write to the participants of an event from the menu', async ({ page }) => {
    const errors = watchErrors(page);
    await openAdmin(page);
    const spieleabend = row(page, 'Community-Spieleabend');
    await spieleabend.locator('[data-bs-toggle="dropdown"]').click();
    await spieleabend.locator('.dropdown-menu.show [data-click="showParticipantMessage"]').click();
    const dialog = await waitForDialog(page, '#participantMessageModal');
    await expect(dialog.locator('#participant-message-title')).toHaveText('Community-Spieleabend');
    await expect(dialog.locator('#participant-message-count')).toHaveText(/^an \d+ Person(en)?$/);
    const accepted = await dialog.locator('#participant-message-count').textContent();
    await expect(dialog.locator('#participant-message-send')).toBeDisabled();

    await dialog.locator('label[for="participant-group-all"]').click();
    await expect(dialog.locator('#participant-message-count')).toHaveText(/^an \d+ Person(en)?$/);
    await dialog.locator('label[for="participant-group-accepted"]').click();
    await expect(dialog.locator('#participant-message-count')).toHaveText(accepted);

    await dialog.locator('#participant-message-text').fill('Treffpunkt ist heute Tor 2.\nBitte pünktlich sein.');
    await expect(dialog.locator('#participant-message-preview')).toContainText('Treffpunkt ist heute Tor 2.');
    await expect(dialog.locator('#participant-message-preview')).toContainText('Nachricht zum Event „Community-Spieleabend“');
    await dialog.locator('#participant-message-send').click();
    await expect(dialog.locator('#participant-message-question')).toHaveText(`Nachricht ${accepted} senden?`);
    // The question replaces the first buttons (Bootstrap utilities with !important must not keep them)
    await expect(dialog.locator('#participant-message-actions')).toBeHidden();
    await dialog.locator('#participant-message-yes').click();
    await expect(dialog).toBeHidden();
    await expect(toast(page)).toContainText(/Nachricht an \d+ von \d+ Personen zugestellt\./);
    expect(errors).toEqual([]);
});

test('the registrations dialog hands over to the message dialog', async ({ page }) => {
    await openAdmin(page);
    await row(page, 'Community-Spieleabend').locator('[data-click="showRegistrations"]').first().click();
    await waitForDialog(page, '#registrationsModal');
    await page.locator('#reg-message-btn').click();
    await expect(page.locator('#registrationsModal')).toBeHidden();
    const dialog = await waitForDialog(page, '#participantMessageModal');
    await expect(dialog.locator('#participant-message-title')).toHaveText('Community-Spieleabend');
});

test('admins accept and reject several registrations at once (W-08)', async ({ page, browser }, testInfo) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    const { id, title } = await createEvent(page, testInfo, { status: 'active', approvalMode: 'manual' });
    // Two members ask to join -> two open requests (newbie stays untouched: e2e/profile.spec.js expects an empty plan)
    for (const persona of ['raider', 'member']) {
        const context = await browser.newContext();
        const memberPage = await context.newPage();
        await loginAs(memberPage, persona);
        const answer = await adminRequest(memberPage, 'POST', `/api/events/${id}/register`, { formAnswers: {} });
        expect(answer.status, persona).toBe('pending');
        await context.close();
    }

    await navigate(page, 'admin');
    await row(page, title).locator('.data-table-buttons > .btn').click();
    const dialog = await waitForDialog(page, '#registrationsModal');
    const bar = dialog.locator('#reg-bulk-bar');
    await expect(bar).toBeHidden();

    const rowOf = (name) => dialog.locator('#registrations-tbody tr', { hasText: name });
    await rowOf('Lena').locator('[data-change="toggleRegSelection"]').check();
    await rowOf('Tom').locator('[data-change="toggleRegSelection"]').check();
    await expect(bar).toBeVisible();
    await expect(dialog.locator('#reg-bulk-count')).toHaveText('2 ausgewählt');
    await dialog.locator('#reg-bulk-accept').click();
    await expect(toast(page)).toContainText('2 angenommen.');
    await expect(rowOf('Lena')).toContainText('Angenommen');
    await expect(rowOf('Tom')).toContainText('Angenommen');
    await expect(bar).toBeHidden();

    await rowOf('Tom').locator('[data-change="toggleRegSelection"]').check();
    await dialog.locator('#reg-bulk-reject').click();
    const confirm = await waitForDialog(page, '#confirmModal');
    await expect(confirm.locator('#confirm-modal-text')).toHaveText('1 Anmeldung ablehnen?');
    await confirm.locator('#confirm-modal-ok').click();
    await expect(toast(page)).toContainText('1 abgelehnt.');
    await expect(rowOf('Tom')).toContainText('Abgelehnt');
    await expect(rowOf('Tom').locator('[data-change="toggleRegSelection"]')).toHaveCount(0);
    expect(errors).toEqual([]);

    // Leave no registrations of the personas behind for other specs
    await adminRequest(page, 'DELETE', `/api/admin/events/${id}`);
});

test('admins choose the announcement channel and lock channel creation in the bot center (B-02)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'same form on the phone; shared settings must not race');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    const before = await adminRequest(page, 'GET', '/api/admin/bot/settings');
    try {
        await navigate(page, 'bot-control');
        const select = page.locator('#bot-announce-channel');
        await expect(select.locator('option', { hasText: '#events' })).toHaveCount(1);
        await expect(select.locator('option').first()).toHaveText('Standard aus .env');
        await expect(select.locator('option', { hasText: 'Lobby' })).toHaveCount(0);
        await select.selectOption({ label: '#events' });
        await page.locator('#bot-auto-channel-creation').uncheck();
        await page.locator('#bot-settings-form button[type="submit"]').click();
        await expect(page.locator('#toast-message')).toHaveText('Bot-Einstellungen gespeichert!');

        // The choice survives a reload
        await page.reload();
        await navigate(page, 'bot-control');
        await expect(page.locator('#bot-announce-channel option:checked')).toHaveText('#events');
        await expect(page.locator('#bot-auto-channel-creation')).not.toBeChecked();

        // The wizard shows the locked channel option
        await navigate(page, 'admin');
        await page.locator('[data-click="showCreateEvent"]').first().click();
        await expect(page.locator('#event-editor-section')).toBeVisible();
        await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="5"]').click();
        await expect(page.locator('#event-auto-create-channels')).toBeDisabled();
        await expect(page.locator('#event-channels-locked')).toHaveText('In der Bot-Zentrale ausgeschaltet.');
        await closeEditor(page);
        expect(errors).toEqual([]);
    } finally {
        await adminRequest(page, 'PUT', '/api/admin/bot/settings', before);
    }
});

// #138: the System page shows the mock values as set by .env and opens the Discord guide
test('the System page shows the configuration and the Discord guide', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await navigate(page, 'admin');
    await page.click('#admin-section a[href="#system"]');
    await expect(page.locator('#system-section')).toBeVisible();
    // One category at a time: the overview first, with version and status
    await expect(page.locator('#system-panel-overview')).toBeVisible();
    await expect(page.locator('#system-panel-discord')).toBeHidden();
    await expect(page.locator('#system-status-list .system-status-row')).toHaveCount(3);
    await expect(page.locator('#system-nav .settings-nav-item')).toHaveCount(6);

    await page.click('#system-nav a[href="#system/discord"]');
    await expect(page).toHaveURL(/#system\/discord$/);
    await expect(page.locator('#system-panel-discord')).toBeVisible();
    await expect(page.locator('#system-panel-overview')).toBeHidden();
    await expect(page.locator('#system-nav a[aria-current="page"]')).toHaveText(/Discord/);
    await expect(page.locator('#system-DISCORD_GUILD_ID')).toHaveAttribute('readonly', '');
    await expect(page.locator('#system-discord-fields .chip-info').first()).toHaveText('aus .env');
    await expect(page.locator('#system-DISCORD_BOT_TOKEN')).toHaveValue('');

    await page.click('[data-click="showDiscordGuideDialog"]');
    await waitForDialog(page, '#discordGuideModal');
    await expect(page.locator('#system-guide .setup-guide-step')).toHaveCount(5);
    await expect(page.locator('#system-guide #guide-step-2 code')).toContainText('/auth/discord/callback');
    await page.keyboard.press('Escape');
    await expect(page.locator('#discordGuideModal')).toBeHidden();

    // The category is part of the address and survives a reload
    await page.reload();
    await expect(page.locator('#system-panel-discord')).toBeVisible();

    // Unsaved input marks its category, stays across a category switch and is asked about on leaving
    await page.click('#system-nav a[href="#system/server"]');
    await page.fill('#system-SERVER_NAME', 'Nicht gespeichert');
    await expect(page.locator('#system-nav-dot-server')).toBeVisible();
    await page.click('#system-nav a[href="#system/overview"]');
    await page.click('#system-nav a[href="#system/server"]');
    await expect(page.locator('#system-SERVER_NAME')).toHaveValue('Nicht gespeichert');
    await page.click('#system-section a[href="#admin"]');
    await waitForDialog(page, '#confirmModal');
    await expect(page.locator('#confirm-modal-text')).toHaveText('Ungespeicherte Änderungen verwerfen?');
    await page.click('#confirmModal [data-bs-dismiss="modal"]');
    await expect(page.locator('#confirmModal')).toBeHidden();
    await expect(page).toHaveURL(/#system\/server$/);
    await expect(page.locator('#system-SERVER_NAME')).toHaveValue('Nicht gespeichert');
    await page.click('#system-section a[href="#admin"]');
    await waitForDialog(page, '#confirmModal');
    await page.click('#confirm-modal-ok');
    await expect(page.locator('#admin-section')).toBeVisible();
    expect(errors).toEqual([]);
});

// The leave guard must not rewrite the browser history: Back walks the visited pages
test('the Back button walks through the System categories and out of the page', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await navigate(page, 'admin');
    const before = await page.evaluate(() => history.length);
    await page.click('#admin-section a[href="#system"]');
    await expect(page.locator('#system-panel-overview')).toBeVisible();
    await page.click('#system-nav a[href="#system/discord"]');
    await expect(page.locator('#system-panel-discord')).toBeVisible();
    await page.click('#system-nav a[href="#system/server"]');
    await expect(page.locator('#system-panel-server')).toBeVisible();
    // Three clicks, three entries
    expect(await page.evaluate(() => history.length)).toBe(before + 3);

    await page.goBack();
    await expect(page).toHaveURL(/#system\/discord$/);
    await expect(page.locator('#system-panel-discord')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#system$/);
    await expect(page.locator('#system-panel-overview')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#admin$/);
    await expect(page.locator('#admin-section')).toBeVisible();
    await page.goForward();
    await expect(page.locator('#system-panel-overview')).toBeVisible();

    // With unsaved input Back asks; "Abbrechen" keeps page, address and the marked navbar link
    await page.click('#system-nav a[href="#system/server"]');
    await page.fill('#system-SERVER_NAME', 'Nicht gespeichert');
    // Back to another category is free ...
    await page.goBack();
    await expect(page).toHaveURL(/#system$/);
    await expect(page.locator('#system-panel-overview')).toBeVisible();
    await expect(page.locator('#system-nav-dot-server')).toBeVisible();
    // ... Back out of the page asks
    await page.goBack();
    await waitForDialog(page, '#confirmModal');
    await page.click('#confirmModal [data-bs-dismiss="modal"]');
    await expect(page.locator('#confirmModal')).toBeHidden();
    await expect(page).toHaveURL(/#system$/);
    await expect(page.locator('#system-section')).toBeVisible();
    await expect(page.locator('#main-navbar .nav-link.active')).toHaveAttribute('data-section', 'admin-section');
    await page.click('#system-nav a[href="#system/server"]');
    await expect(page.locator('#system-SERVER_NAME')).toHaveValue('Nicht gespeichert');

    // "Verwerfen" leaves through a link without adding an entry for the question
    const asked = await page.evaluate(() => history.length);
    await page.click('#system-section a[href="#admin"]');
    await waitForDialog(page, '#confirmModal');
    await page.click('#confirm-modal-ok');
    await expect(page.locator('#admin-section')).toBeVisible();
    expect(await page.evaluate(() => history.length)).toBeLessThanOrEqual(asked + 1);
    await page.goBack();
    await expect(page).toHaveURL(/#system\/server$/);
    // The discarded value is gone
    await expect(page.locator('#system-SERVER_NAME')).not.toHaveValue('Nicht gespeichert');
    expect(errors).toEqual([]);
});

test('on a phone the System categories are a scrolling row and the page does not scroll sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'admin');
    await page.evaluate(() => { window.location.hash = '#system/discord'; });
    await expect(page.locator('#system-panel-discord')).toBeVisible();
    await expect(page.locator('#system-nav .settings-nav-sub').first()).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});
