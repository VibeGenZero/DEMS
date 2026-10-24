/**
 * Event wizard of D-10: every step is checked before "Weiter", and a
 * switch shows the overview card and the Discord announcement of the
 * unsaved input. Seed data: dev/seedData.js (dev mock mode).
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, navigate, waitForDialog } = require('./helpers');

async function openWizard(page) {
    await navigate(page, 'admin');
    await page.locator('[data-click="showCreateEventModal"]').first().click();
    await waitForDialog(page, '#eventModal');
}

test('an admin builds a raid step by step, checks the preview and saves from it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the wizard is the same on the phone');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await openWizard(page);

    // Step 1 wants a title
    await page.locator('#wizard-btn-next').click();
    await expect(page.locator('#event-title-feedback')).toHaveText('Bitte einen Titel eingeben.');
    await expect(page.locator('#wstep-1')).toHaveClass(/has-error/);
    await page.locator('#event-title').fill('E2E-Raidnacht');
    await expect(page.locator('#event-title')).not.toHaveClass(/is-invalid/);
    await page.locator('#wizard-btn-next').click();

    // Step 2: an active event needs a start date
    await expect(page.locator('#wizard-page-2')).toBeVisible();
    await expect(page.locator('#event-start-required')).toBeVisible();
    await page.locator('#wizard-btn-next').click();
    await expect(page.locator('#event-start-date-feedback')).toHaveText('Aktive Events brauchen ein Startdatum.');
    await page.locator('#event-start-date').evaluate(input => input._flatpickr.setDate(new Date(Date.now() + 7 * 86_400_000), true));
    await page.locator('#wizard-btn-next').click();

    // Step 3: the raid preset gives three slots
    await expect(page.locator('#wizard-page-3')).toBeVisible();
    await page.locator('#event-use-slots').check();
    await page.locator('[data-click="applySlotPreset"]').click();

    // The preview shows the unsaved input
    await page.locator('#wizard-mode-preview').click();
    await expect(page.locator('#wizard-page-3')).toBeHidden();
    await expect(page.locator('#wizard-preview-card .event-card-title')).toHaveText('E2E-Raidnacht');
    await expect(page.locator('#wizard-preview-card .capacity-text')).toHaveText('0 von 15 belegt');
    await expect(page.locator('#wizard-preview-discord .discord-embed-title')).toHaveText('🎉 E2E-Raidnacht');
    await expect(page.locator('#wizard-preview-discord .discord-button')).toHaveText([/Tank/, /Heiler/, /Schaden/, /Zum Event/]);

    // Save straight from the preview of the last step
    await page.locator('#eventModal [data-click="wizardGoTo"][data-step="5"]').click();
    await expect(page.locator('#wizard-page-5')).toBeVisible();
    await page.locator('#wizard-mode-preview').click();
    await expect(page.locator('#wizard-preview')).toBeVisible();
    await page.locator('#wizard-btn-save').click();
    await expect(page.locator('#eventModal')).toBeHidden();
    await expect(page.locator('#toast-message')).toHaveText('Event erstellt!');
    expect(errors).toEqual([]);
});

test('"Speichern" shows the first step with problems and marks every such step', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the wizard is the same on the phone');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await openWizard(page);
    await page.locator('#event-title').fill('E2E-Lückentext');
    await page.locator('#eventModal [data-click="wizardGoTo"][data-step="4"]').click();
    await page.locator('#wizard-page-4 [data-click="addFormField"]').click();
    await page.locator('#eventModal [data-click="wizardGoTo"][data-step="5"]').click();
    await page.locator('#wizard-btn-save').click();

    await expect(page.locator('#wizard-page-2')).toBeVisible();
    await expect(page.locator('#event-start-date-feedback')).toHaveText('Aktive Events brauchen ein Startdatum.');
    await expect(page.locator('#wstep-2')).toHaveClass(/has-error/);
    await expect(page.locator('#wstep-4')).toHaveClass(/has-error/);
    await expect(page.locator('#wstep-1')).not.toHaveClass(/has-error/);
    await page.locator('#eventModal [data-click="wizardGoTo"][data-step="4"]').click();
    await expect(page.locator('#form-fields-feedback')).toHaveText('Jedes Feld braucht ein Label.');
    await expect(page.locator('#form-fields-builder .ff-label')).toHaveClass(/is-invalid/);
    await page.locator('#eventModal [data-bs-dismiss="modal"]').first().click();
    await expect(page.locator('#eventModal')).toBeHidden();
    expect(errors).toEqual([]);
});

test('a new location offers "Teilnehmer benachrichtigen" and the save tells how many were notified', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await navigate(page, 'admin');
    await page.locator('#admin-events-table tbody tr', { hasText: 'Community-Spieleabend' }).locator('.data-table-title').click();
    await waitForDialog(page, '#eventModal');

    // Unchanged: no switch next to "Speichern"
    await page.locator('#eventModal [data-click="wizardGoTo"][data-step="5"]').click();
    await expect(page.locator('#wizard-btn-save')).toBeVisible();
    await expect(page.locator('#wizard-notify')).toBeHidden();

    // The start stays: other specs sort the admin table by it; one place per project, so both runs change it
    await page.locator('#eventModal [data-click="wizardGoTo"][data-step="1"]').click();
    await page.locator('#event-location-text').fill(`Garten ${testInfo.project.name}`);
    await page.locator('#eventModal [data-click="wizardGoTo"][data-step="5"]').click();
    await expect(page.locator('#wizard-notify')).toBeVisible();
    await expect(page.locator('#event-notify-participants')).toBeChecked();
    await expect(page.locator('#wizard-notify')).toContainText('Teilnehmer benachrichtigen');

    // The footer wraps instead of pushing the page sideways
    const footer = page.locator('#eventModal .modal-footer');
    expect(await footer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

    await page.locator('#wizard-btn-save').click();
    await expect(page.locator('#eventModal')).toBeHidden();
    await expect(page.locator('#toast-message')).toHaveText(/^Event aktualisiert – \d+ Teilnehmer benachrichtigt\.$/);
    expect(errors).toEqual([]);
});

// 1x1 PNG, so the browser can draw the preview
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('an admin uploads a banner in the wizard and the event page shows it (W-12)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the wizard is the same on the phone');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await openWizard(page);

    await page.locator('#event-title').fill('E2E-Bannerabend');
    await page.locator('#event-banner-file').setInputFiles({ name: 'banner.png', mimeType: 'image/png', buffer: TINY_PNG });
    await expect(page.locator('#toast-message')).toHaveText('Banner hochgeladen.');
    await expect(page.locator('#event-banner-url')).toHaveValue(/^\/uploads\/banners\/[0-9a-f-]{36}\.png$/);
    await expect(page.locator('#banner-preview')).toBeVisible();
    await expect(page.locator('#event-banner-clear')).toBeVisible();
    const bannerUrl = await page.locator('#event-banner-url').inputValue();

    // A draft needs no start date
    await page.locator('#eventModal [data-click="wizardGoTo"][data-step="2"]').click();
    await page.locator('#event-status').selectOption('draft');
    const saved = page.waitForResponse(res => res.url().endsWith('/api/admin/events') && res.request().method() === 'POST');
    await page.locator('#eventModal [data-click="wizardGoTo"][data-step="5"]').click();
    await page.locator('#wizard-btn-save').click();
    const { id } = await (await saved).json();
    await expect(page.locator('#eventModal')).toBeHidden();

    await page.goto(`/#event/${id}`);
    await expect(page.locator('.event-detail-banner-img')).toHaveAttribute('src', bannerUrl);
    await expect(page.locator('.event-detail-banner-img')).toBeVisible();
    expect(errors).toEqual([]);
});

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

const dayOf = (date) => date.toISOString().slice(0, 10);
const clockIn = (iso) => new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

test('an admin changes a series for all following dates and extends it (W-11)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the wizard is the same on the phone');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');

    // Own draft series of three weekly dates, so the shared seed stays untouched
    const title = `E2E-Serie ${Date.now()}`;
    const first = new Date(Date.now() + 3 * 86_400_000);
    first.setUTCHours(18, 0, 0, 0);
    const created = await adminRequest(page, 'POST', '/api/admin/events', {
        title, status: 'draft', accessMode: 'open', approvalMode: 'instant', startDate: first.toISOString(),
        recurring: true, recurringInterval: 'weekly', recurringUntil: dayOf(new Date(first.getTime() + 14 * 86_400_000))
    });
    expect(created.count).toBe(3);
    const seriesId = created.events[0].seriesId;

    try {
        await navigate(page, 'admin');
        await page.locator('#admin-events-tabs .nav-link', { hasText: 'Entwürfe' }).click();
        await page.locator('#admin-events-table tbody tr', { hasText: title }).first().locator('.data-table-title').click();
        await waitForDialog(page, '#eventModal');

        // Step 2: the repeat fields of a series are locked, the start moves one hour later
        await page.locator('#eventModal [data-click="wizardGoTo"][data-step="2"]').click();
        await expect(page.locator('#event-recurring')).toBeDisabled();
        await expect(page.locator('#event-recurring-interval')).toBeDisabled();
        await expect(page.locator('#event-recurring-until-hint')).toBeVisible();
        const later = new Date(first.getTime() + 3600_000);
        await page.locator('#event-start-date').evaluate((input, iso) => input._flatpickr.setDate(new Date(iso), true), later.toISOString());
        await page.locator('#eventModal [data-click="wizardGoTo"][data-step="1"]').click();
        await page.locator('#event-location-text').fill('Burghof');

        await page.locator('#eventModal [data-click="wizardGoTo"][data-step="5"]').click();
        await expect(page.locator('#wizard-series-scope')).toBeVisible();
        await expect(page.locator('#event-scope-this')).toBeChecked();
        await expect(page.locator('#wizard-series-scope')).toContainText('Dieser und alle folgenden Termine (2)');
        await page.locator('#event-scope-following').check();
        const footer = page.locator('#eventModal .modal-footer');
        expect(await footer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await page.locator('#wizard-btn-save').click();
        await expect(page.locator('#eventModal')).toBeHidden();
        await expect(page.locator('#toast-message')).toHaveText('Event und 2 folgende Termine aktualisiert!');

        const dates = await page.evaluate(async (id) => (await fetch(`/api/events/series/${id}`)).json(), seriesId);
        expect(dates.map(date => date.location?.text)).toEqual(['Burghof', 'Burghof', 'Burghof']);
        expect(new Set(dates.map(date => clockIn(date.startDate))).size).toBe(1);
        expect(clockIn(dates[2].startDate)).toBe(clockIn(later.toISOString()));

        // A later "Wiederholen bis" adds one more week
        await page.locator('#admin-events-table tbody tr', { hasText: title }).first().locator('.data-table-title').click();
        await waitForDialog(page, '#eventModal');
        await page.locator('#eventModal [data-click="wizardGoTo"][data-step="2"]').click();
        await page.locator('#event-recurring-until').fill(dayOf(new Date(first.getTime() + 21 * 86_400_000)));
        await page.locator('#eventModal [data-click="wizardGoTo"][data-step="5"]').click();
        await page.locator('#wizard-btn-save').click();
        await expect(page.locator('#eventModal')).toBeHidden();
        await expect(page.locator('#toast-message')).toHaveText('Event aktualisiert! 1 neuer Termin angelegt.');
        const extended = await page.evaluate(async (id) => (await fetch(`/api/events/series/${id}`)).json(), seriesId);
        expect(extended).toHaveLength(4);
        expect(extended[3].location?.text).toBe('Burghof');
        expect(errors).toEqual([]);
    } finally {
        await adminRequest(page, 'DELETE', `/api/admin/events/series/${seriesId}`);
    }
});
