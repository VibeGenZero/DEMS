/**
 * Content security policy for styles (D-16): style-src 'self' and
 * style-src-attr 'none'. Markup carries no style attribute, so start states
 * come from the class .is-hidden and runtime values are set by scripts. The
 * browser reports every inline style it refuses; none may be reported.
 * Seed data: dev/seedData.js (dev mock mode).
 */
const { test, expect } = require('@playwright/test');
const { loginAs, navigate, waitForDialog } = require('./helpers');

/** Record every violation of the policy the page reports, from its first script on. */
async function watchPolicy(page) {
    await page.addInitScript(() => {
        window.policyViolations = [];
        document.addEventListener('securitypolicyviolation', (event) => {
            window.policyViolations.push(`${event.violatedDirective}: ${event.blockedURI} ${String(event.sample || '').slice(0, 80)}`);
        });
    });
}

const violationsOf = (page) => page.evaluate(() => window.policyViolations);

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

test('the policy forbids inline styles', async ({ page }) => {
    const response = await page.goto('/');
    const policy = response.headers()['content-security-policy'];
    expect(policy).toContain("style-src 'self';");
    expect(policy).toContain("style-src-attr 'none'");
});

test('what starts hidden is hidden before any script runs', async ({ browser }) => {
    // Without scripts only the stylesheets decide; a rule that outranks .is-hidden would show here
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/');
    const visible = await page.locator('.is-hidden').evaluateAll(elements => elements
        .filter(element => getComputedStyle(element).display !== 'none')
        .map(element => `${element.tagName.toLowerCase()}#${element.id}.${element.className}`));
    expect(visible).toEqual([]);
    expect(await page.locator('.is-hidden').count()).toBeGreaterThan(50);
    await context.close();
});

test('an admin walks through every page without one refused style', async ({ page }) => {
    await watchPolicy(page);
    await loginAs(page, 'admin');

    await page.locator('#events-grid .event-card', { hasText: 'Community-Spieleabend' }).click();
    await expect(page.locator('#detail-title')).toHaveText('Community-Spieleabend');

    for (const route of ['polls', 'profile', 'info', 'admin', 'bot-control']) await navigate(page, route);

    // Admin: audit log, event wizard with editor, date picker and role chips, announce dialog
    await navigate(page, 'admin');
    await page.locator('[data-click="loadAuditLog"]').click();
    await expect(page.locator('#audit-log-entries .chip').first()).toBeVisible();
    await page.locator('[data-click="showCreateEventModal"]').first().click();
    await waitForDialog(page, '#eventModal');
    await expect(page.locator('#eventModal .EasyMDEContainer')).toBeVisible();
    // The first step wants a title before it lets the admin go on
    await page.locator('#event-title').fill('E2E-Stile');
    await page.locator('#wizard-btn-next').click();
    await expect(page.locator('#wizard-page-2')).toBeVisible();
    await expect(page.locator('#wizard-page-1')).toBeHidden();
    await page.locator('#wizard-page-2 input:visible').first().click();
    await expect(page.locator('.flatpickr-calendar.open')).toBeVisible();
    // A click beside the calendar closes it (Escape would close the whole dialog)
    await page.locator('#wizard-step-counter').click();
    await expect(page.locator('.flatpickr-calendar.open')).toHaveCount(0);
    await page.locator('#wizard-btn-next').click();
    await expect(page.locator('#wizard-page-3')).toBeVisible();
    await page.locator('#eventModal [data-click="wizardGoTo"][data-step="5"]').click();
    await expect(page.locator('#wizard-page-5')).toBeVisible();
    await page.locator('#eventModal [data-bs-dismiss="modal"]').first().click();
    await expect(page.locator('#eventModal')).toBeHidden();

    const row = page.locator('#admin-events-table tbody tr', { hasText: 'Community-Spieleabend' });
    await row.locator('[data-bs-toggle="dropdown"]').click();
    await row.locator('.dropdown-item', { hasText: 'Ankündigen' }).click();
    await waitForDialog(page, '#announceModal');
    // A role shows its Discord colour, set by a script
    const roleLabel = page.locator('#announce-role-checkboxes .announce-role-label').first();
    await expect(roleLabel).toBeVisible();
    expect(await roleLabel.evaluate(element => element.style.color)).not.toBe('');
    await page.locator('#announceModal [data-bs-dismiss="modal"]').first().click();

    expect(await violationsOf(page)).toEqual([]);
});

test('a member opens event, polls and profile without one refused style', async ({ page }) => {
    await watchPolicy(page);
    await loginAs(page, 'raider');
    // Event page with the line-up of the raid
    await page.locator('#events-grid .event-card', { hasText: 'Raid: Schattenfestung' }).click();
    await expect(page.locator('#detail-title')).toHaveText('Raid: Schattenfestung');
    await expect(page.locator('#detail-roster .roster-slot').first()).toBeVisible();
    // The bar of a slot gets its width from a script, not from a style attribute
    const slotBar = page.locator('#detail-roster .capacity-progress-bar').first();
    await expect(slotBar).toHaveAttribute('data-style-width', /^\d+$/);
    expect(await slotBar.evaluate(element => element.style.width)).toMatch(/^\d+%$/);
    await navigate(page, 'polls');
    await page.locator('#polls-open .poll-card').first().click();
    await expect(page.locator('#poll-detail-section')).toBeVisible();
    await expect(page.locator('#poll-detail-section .poll-bar').first()).toBeVisible();
    await navigate(page, 'profile');
    await expect(page.locator('#profile-badges .badge-row').first()).toBeVisible();
    await navigate(page, 'info');
    expect(await violationsOf(page)).toEqual([]);
});

test('a style attribute in a description does not reach the page', async ({ page }, testInfo) => {
    await watchPolicy(page);
    await loginAs(page, 'admin');
    const created = await adminRequest(page, 'POST', '/api/admin/events', {
        title: `E2E Stil ${testInfo.project.name} ${Date.now()}`,
        status: 'active',
        accessMode: 'open',
        approvalMode: 'instant',
        description: 'Hallo <span style="color:red;position:fixed">rot</span> und **fett** <style>body{display:none}</style>'
    });
    await page.goto(`/#event/${created.id}`);
    const description = page.locator('#detail-description');
    await expect(description).toContainText('rot');
    await expect(description.locator('strong')).toHaveText('fett');
    await expect(description.locator('[style]')).toHaveCount(0);
    await expect(description.locator('style')).toHaveCount(0);
    expect(await violationsOf(page)).toEqual([]);
    await adminRequest(page, 'DELETE', `/api/admin/events/${created.id}`);
});
