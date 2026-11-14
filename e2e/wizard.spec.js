/**
 * Event wizard of D-10 on its own page (#event-editor/…): every step is
 * checked before "Weiter"; the overview card and the Discord announcement of
 * the unsaved input sit beside the form on a wide screen and behind the tab
 * "Vorschau" on a small one; unsaved input survives a reload.
 * Seed data: dev/seedData.js (dev mock mode).
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, navigate, waitForDialog, closeEditor } = require('./helpers');

async function openWizard(page) {
    await navigate(page, 'admin');
    await page.locator('[data-click="showCreateEvent"]').first().click();
    await expect(page.locator('#event-editor-section')).toBeVisible();
    await expect(page).toHaveURL(/#event-editor\/new$/);
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

    // While the form scrolls, the top bar stays right below the navbar and the preview column below the top bar
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
    const stuck = await page.evaluate(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect();
        return { navBottom: box('#main-navbar').bottom, barTop: box('.editor-topbar').top, barBottom: box('.editor-topbar').bottom, previewTop: box('.editor-preview-column').top };
    });
    expect(Math.abs(stuck.barTop - stuck.navBottom)).toBeLessThanOrEqual(2);
    expect(stuck.previewTop).toBeGreaterThanOrEqual(stuck.barBottom - 1);
    expect(stuck.previewTop).toBeLessThan(400);
    await page.evaluate(() => window.scrollTo(0, 0));
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

    await expect(page.locator('#event-editor-section .editor-toolbar .fullscreen, #event-editor-section .editor-toolbar .side-by-side')).toHaveCount(0);
    // The preview beside the form follows the unsaved input; there is nothing to switch
    await expect(page.locator('#wizard-mode')).toBeHidden();
    await expect(page.locator('#wizard-page-3')).toBeVisible();
    const formBox = await page.locator('.editor-form').boundingBox();
    const previewBox = await page.locator('.editor-preview-column').boundingBox();
    expect(previewBox.x).toBeGreaterThan(formBox.x + formBox.width - 1);
    await expect(page.locator('#wizard-preview-card .event-card-title')).toHaveText('E2E-Raidnacht');
    await expect(page.locator('#wizard-preview-card .capacity-text')).toHaveText('0 von 15 belegt');
    await expect(page.locator('#wizard-preview-discord .discord-container h2')).toHaveText('🎉 E2E-Raidnacht');
    // Each slot button sits beside its line-up block (B-05); „Frage stellen“ comes from the mock AI of dev mock mode
    await expect(page.locator('#wizard-preview-discord .discord-section')).toHaveCount(3);
    await expect(page.locator('#wizard-preview-discord .discord-button')).toHaveText([/Tank/, /Heiler/, /Schaden/, /Frage stellen/, /Zum Event/]);

    // A reload keeps the unsaved input, the step and tells so; slots are part of it
    await expect(page.locator('#event-editor-saved')).toHaveText(/^Entwurf gesichert \d\d:\d\d$/);
    await page.reload();
    await expect(page.locator('#event-editor-section')).toBeVisible();
    await expect(page.locator('#event-editor-restored')).toBeVisible();
    await expect(page.locator('#event-title')).toHaveValue('E2E-Raidnacht');
    await expect(page.locator('#wizard-page-3')).toBeVisible();
    await expect(page.locator('#event-use-slots')).toBeChecked();
    await expect(page.locator('#wizard-preview-card .capacity-text')).toHaveText('0 von 15 belegt');

    // Save from the last step: back on the dashboard, the event is listed
    await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="5"]').click();
    await expect(page.locator('#wizard-page-5')).toBeVisible();
    await expect(page.locator('#wizard-preview')).toBeVisible();
    await page.locator('#wizard-btn-save').click();
    await expect(page.locator('#toast-message')).toHaveText('Event erstellt!');
    await expect(page.locator('#event-editor-section')).toBeHidden();
    await expect(page).toHaveURL(/#admin$/);
    await expect(page.locator('#admin-events-table tbody tr', { hasText: 'E2E-Raidnacht' })).toHaveCount(1);

    // Nothing is kept after saving: a new editor starts empty
    await openWizard(page);
    await expect(page.locator('#event-title')).toHaveValue('');
    await expect(page.locator('#event-editor-restored')).toBeHidden();
    await closeEditor(page);
    expect(errors).toEqual([]);
});

test('editing opens the editor of the event; leaving unchanged does not ask', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await navigate(page, 'admin');
    await page.locator('#admin-events-table [data-click="editEvent"]').first().click();
    await expect(page.locator('#event-editor-section')).toBeVisible();
    await expect(page).toHaveURL(/#event-editor\/[^/]+$/);
    await expect(page.locator('#event-editor-title')).toHaveText(/^Event bearbeiten: .+/);
    await expect(page.locator('#event-title')).not.toHaveValue('');
    // The fixed bar of the page: the browser's Back button leads out without a question
    await page.goBack();
    await expect(page.locator('#admin-section')).toBeVisible();
    await expect(page.locator('#confirmModal')).toBeHidden();
    expect(errors).toEqual([]);
});

test('on a phone the editor has one column, the preview behind its tab, and does not scroll sideways', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'the wide layout is covered above');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await page.evaluate(() => { window.location.hash = '#event-editor/new'; });
    await expect(page.locator('#event-editor-section')).toBeVisible();
    await page.locator('#event-title').fill('E2E-Handy');
    await expect(page.locator('#wizard-preview')).toBeHidden();
    await page.locator('#wizard-mode-preview').click();
    await expect(page.locator('#wizard-page-1')).toBeHidden();
    await expect(page.locator('#wizard-preview-card .event-card-title')).toHaveText('E2E-Handy');
    await page.locator('#wizard-mode-edit').click();
    await expect(page.locator('#wizard-page-1')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await closeEditor(page);
    expect(errors).toEqual([]);
});

test('"Speichern" shows the first step with problems and marks every such step', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the wizard is the same on the phone');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await openWizard(page);
    await page.locator('#event-title').fill('E2E-Lückentext');
    await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="4"]').click();
    await page.locator('#wizard-page-4 [data-click="addFormField"]').click();
    await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="5"]').click();
    await page.locator('#wizard-btn-save').click();

    await expect(page.locator('#wizard-page-2')).toBeVisible();
    await expect(page.locator('#event-start-date-feedback')).toHaveText('Aktive Events brauchen ein Startdatum.');
    await expect(page.locator('#wstep-2')).toHaveClass(/has-error/);
    await expect(page.locator('#wstep-4')).toHaveClass(/has-error/);
    await expect(page.locator('#wstep-1')).not.toHaveClass(/has-error/);
    await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="4"]').click();
    await expect(page.locator('#form-fields-feedback')).toHaveText('Jedes Feld braucht ein Label.');
    await expect(page.locator('#form-fields-builder .ff-label')).toHaveClass(/is-invalid/);
    await closeEditor(page);
    expect(errors).toEqual([]);
});

test('a new location offers "Teilnehmer benachrichtigen" and the save tells how many were notified', async ({ page }, testInfo) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await navigate(page, 'admin');
    await page.locator('#admin-events-table tbody tr', { hasText: 'Community-Spieleabend' }).locator('.data-table-title').click();
    await expect(page.locator('#event-editor-section')).toBeVisible();

    // Unchanged: no switch next to "Speichern"
    await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="5"]').click();
    await expect(page.locator('#wizard-btn-save')).toBeVisible();
    await expect(page.locator('#wizard-notify')).toBeHidden();

    // The start stays: other specs sort the admin table by it; one place per project, so both runs change it
    await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="1"]').click();
    await page.locator('#event-location-text').fill(`Garten ${testInfo.project.name}`);
    await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="5"]').click();
    await expect(page.locator('#wizard-notify')).toBeVisible();
    await expect(page.locator('#event-notify-participants')).toBeChecked();
    await expect(page.locator('#wizard-notify')).toContainText('Teilnehmer benachrichtigen');

    // The footer wraps instead of pushing the page sideways
    const footer = page.locator('#event-editor-section .editor-footer');
    expect(await footer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);

    await page.locator('#wizard-btn-save').click();
    await expect(page.locator('#event-editor-section')).toBeHidden();
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
    await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="2"]').click();
    await page.locator('#event-status').selectOption('draft');
    const saved = page.waitForResponse(res => res.url().endsWith('/api/admin/events') && res.request().method() === 'POST');
    await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="5"]').click();
    await page.locator('#wizard-btn-save').click();
    const { id } = await (await saved).json();
    await expect(page.locator('#event-editor-section')).toBeHidden();

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
        await expect(page.locator('#event-editor-section')).toBeVisible();

        // Step 2: the repeat fields of a series are locked, the start moves one hour later
        await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="2"]').click();
        await expect(page.locator('#event-recurring')).toBeDisabled();
        await expect(page.locator('#event-recurring-interval')).toBeDisabled();
        await expect(page.locator('#event-recurring-until-hint')).toBeVisible();
        const later = new Date(first.getTime() + 3600_000);
        await page.locator('#event-start-date').evaluate((input, iso) => input._flatpickr.setDate(new Date(iso), true), later.toISOString());
        await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="1"]').click();
        await page.locator('#event-location-text').fill('Burghof');

        await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="5"]').click();
        await expect(page.locator('#wizard-series-scope')).toBeVisible();
        await expect(page.locator('#event-scope-this')).toBeChecked();
        await expect(page.locator('#wizard-series-scope')).toContainText('Dieser und alle folgenden Termine (2)');
        await page.locator('#event-scope-following').check();
        const footer = page.locator('#event-editor-section .editor-footer');
        expect(await footer.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await page.locator('#wizard-btn-save').click();
        await expect(page.locator('#event-editor-section')).toBeHidden();
        await expect(page.locator('#toast-message')).toHaveText('Event und 2 folgende Termine aktualisiert!');

        const dates = await page.evaluate(async (id) => (await fetch(`/api/events/series/${id}`)).json(), seriesId);
        expect(dates.map(date => date.location?.text)).toEqual(['Burghof', 'Burghof', 'Burghof']);
        expect(new Set(dates.map(date => clockIn(date.startDate))).size).toBe(1);
        expect(clockIn(dates[2].startDate)).toBe(clockIn(later.toISOString()));

        // A later "Wiederholen bis" adds one more week
        await page.locator('#admin-events-table tbody tr', { hasText: title }).first().locator('.data-table-title').click();
        await expect(page.locator('#event-editor-section')).toBeVisible();
        await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="2"]').click();
        await page.locator('#event-recurring-until').fill(dayOf(new Date(first.getTime() + 21 * 86_400_000)));
        await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="5"]').click();
        await page.locator('#wizard-btn-save').click();
        await expect(page.locator('#event-editor-section')).toBeHidden();
        await expect(page.locator('#toast-message')).toHaveText('Event aktualisiert! 1 neuer Termin angelegt.');
        const extended = await page.evaluate(async (id) => (await fetch(`/api/events/series/${id}`)).json(), seriesId);
        expect(extended).toHaveLength(4);
        expect(extended[3].location?.text).toBe('Burghof');
        expect(errors).toEqual([]);
    } finally {
        await adminRequest(page, 'DELETE', `/api/admin/events/series/${seriesId}`);
    }
});

test('an admin saves the wizard as a template and starts the next event from it (W-10)', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the wizard is the same on the phone');
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await openWizard(page);
    // The seed has the template "Raid-Abend", so the chooser is there
    await expect(page.locator('#wizard-template-area')).toBeVisible();

    let eventId = null;
    try {
        // Build the setup once: title, raid slots, one form field
        await page.locator('#event-title').fill('E2E-Vorlagenabend');
        await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="3"]').click();
        await page.locator('#event-use-slots').check();
        await page.locator('[data-click="applySlotPreset"]').click();
        await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="4"]').click();
        await page.locator('#wizard-page-4 [data-click="addFormField"]').click();
        await page.locator('#form-fields-builder .ff-label').fill('Lieblingsklasse');

        // Save it as a template; the event itself is not saved
        await page.locator('#wizard-btn-template').click();
        await expect(page.locator('#wizard-template-save')).toBeVisible();
        await page.locator('#event-template-name').fill('E2E-Vorlage');
        await page.locator('#wizard-template-save [data-click="saveTemplate"]').click();
        await expect(page.locator('#toast-message')).toHaveText('Vorlage „E2E-Vorlage“ gespeichert.');
        await expect(page.locator('#wizard-template-save')).toBeHidden();
        await closeEditor(page);

        // A fresh wizard starts from the template
        await openWizard(page);
        await expect(page.locator('#event-title')).toHaveValue('');
        const chosen = await page.locator('#event-template-select option', { hasText: 'E2E-Vorlage' }).getAttribute('value');
        await page.locator('#event-template-select').selectOption(chosen);
        await expect(page.locator('#toast-message')).toHaveText('Vorlage „E2E-Vorlage“ übernommen.');
        await expect(page.locator('#event-title')).toHaveValue('E2E-Vorlagenabend');
        await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="4"]').click();
        await expect(page.locator('#form-fields-builder .ff-label')).toHaveValue('Lieblingsklasse');

        // Date and status are up to the admin; a draft keeps the overview clean
        await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="2"]').click();
        await expect(page.locator('#event-start-date')).toHaveValue('');
        await page.locator('#event-start-date').evaluate(input => input._flatpickr.setDate(new Date(Date.now() + 9 * 86_400_000), true));
        await page.locator('#event-status').selectOption('draft');
        const saved = page.waitForResponse(res => res.url().endsWith('/api/admin/events') && res.request().method() === 'POST');
        await page.locator('#event-editor-section [data-click="wizardGoTo"][data-step="5"]').click();
        await page.locator('#wizard-btn-save').click();
        const created = await (await saved).json();
        eventId = created.id;
        await expect(page.locator('#event-editor-section')).toBeHidden();
        expect(created.title).toBe('E2E-Vorlagenabend');
        expect(created.slots.map(slot => slot.name)).toEqual(['Tank', 'Heiler', 'Schaden']);
        expect(created.formFields.map(field => field.label)).toEqual(['Lieblingsklasse']);

        // Delete the template from the wizard after the inline question
        await openWizard(page);
        await page.locator('#event-template-select').selectOption(chosen);
        await page.locator('#event-template-delete').click();
        await expect(page.locator('#wizard-template-delete-text')).toHaveText('Vorlage „E2E-Vorlage“ löschen?');
        await page.locator('#wizard-template-delete-confirm [data-click="deleteTemplate"]').click();
        await expect(page.locator('#toast-message')).toHaveText('Vorlage „E2E-Vorlage“ gelöscht.');
        await expect(page.locator('#event-template-select option', { hasText: 'E2E-Vorlage' })).toHaveCount(0);
        await closeEditor(page);
        expect(errors).toEqual([]);
    } finally {
        // Leave nothing behind for the other specs
        const templates = await adminRequest(page, 'GET', '/api/admin/event-templates');
        for (const template of (Array.isArray(templates) ? templates : []).filter(item => item.name === 'E2E-Vorlage')) {
            await adminRequest(page, 'DELETE', `/api/admin/event-templates/${template.id}`);
        }
        if (eventId) await adminRequest(page, 'DELETE', `/api/admin/events/${eventId}`);
    }
});

test('the AI assistant fills the title, marks it, and „Rückgängig" takes it back', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'admin');
    await openWizard(page);
    await page.click('#event-editor-assist-toggle');
    await expect(page.locator('#event-editor-assist')).toBeVisible();
    await expect(page.locator('#editor-assist-input')).toBeFocused();
    await page.fill('#editor-assist-input', 'Raid am Samstag');
    await page.click('#editor-assist-send');
    await expect(page.locator('#editor-assist-messages')).toContainText('Entwurf ist im Formular.');
    await expect(page.locator('#event-title')).toHaveValue('Raid am Samstag');
    await expect(page.locator('#event-title')).toHaveClass(/is-ai-filled/);
    await expect(page.locator('#ai-mark-title')).toHaveText('von KI');
    await page.click('#editor-assist-undo');
    await expect(page.locator('#event-title')).toHaveValue('');
    await expect(page.locator('#event-title')).not.toHaveClass(/is-ai-filled/);
    await expect(page.locator('#ai-mark-title')).toHaveCount(0);
    await expect(page.locator('#editor-assist-undo')).toHaveCount(0);
    expect(errors).toEqual([]);
});
