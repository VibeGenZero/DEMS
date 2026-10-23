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
