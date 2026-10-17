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
