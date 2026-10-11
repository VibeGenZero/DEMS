/**
 * Event overview (D-04): compact rows on the phone, three columns on the
 * desktop, only upcoming events, banners with fallback, the own status per
 * persona. Seed data: dev/seedData.js (dev mock mode).
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs } = require('./helpers');

const cards = (page) => page.locator('#events-grid .event-card');
const card = (page, title) => cards(page).filter({ hasText: title });

test('the phone shows at least four events at once and nothing sticks out', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone layout');
    const errors = watchErrors(page);
    await loginAs(page, 'raider');
    await expect(cards(page).first()).toBeVisible();

    const height = page.viewportSize().height;
    const tops = await cards(page).evaluateAll(list => list.map(element => element.getBoundingClientRect().top));
    expect(tops.filter(top => top < height).length).toBeGreaterThanOrEqual(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // The category bar stays one line and scrolls sideways
    const bar = await page.locator('#category-filter-bar').evaluate(element => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, height: element.offsetHeight }));
    expect(bar.scrollWidth).toBeGreaterThan(bar.clientWidth);
    expect(bar.height).toBeLessThan(48);
    expect(errors).toEqual([]);
});

test('the desktop shows three columns with the banner on top', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'desktop layout');
    await loginAs(page, 'raider');
    await expect(cards(page).first()).toBeVisible();
    const columns = await page.locator('#events-grid').evaluate(grid => getComputedStyle(grid).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(3);
    const first = cards(page).first();
    const media = await first.locator('.event-card-media').boundingBox();
    const tile = await first.locator('.date-tile').boundingBox();
    expect(media.y + media.height).toBeLessThanOrEqual(tile.y);
});

test('only upcoming events show, the running one first', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'raider');
    await expect(cards(page).first()).toContainText('Live: Speedrun-Marathon');
    await expect(cards(page).first()).toContainText('Läuft gerade');
    await expect(page.locator('#events-grid')).not.toContainText('Retro-Spieleabend');
    expect(errors).toEqual([]);
});

const MARKERS = [
    ['raider', 'Community-Spieleabend', 'Angemeldet'],
    ['member', 'Koop-Abend (5 Plätze)', 'Warteliste'],
    ['member', 'Turnier: Arena-Cup', 'Ausstehend'],
    ['newbie', 'Workshop: Streaming-Setup', 'Als Gast']
];
for (const [persona, title, marker] of MARKERS) {
    test(`${persona} sees "${marker}" on ${title}`, async ({ page }) => {
        await loginAs(page, persona);
        await expect(card(page, title)).toContainText(marker);
    });
}

test('card and event page tell the places with the same sentence', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'raider');
    // The full event: five places taken, three members wait
    const full = card(page, 'Koop-Abend (5 Plätze)');
    await expect(full.locator('.capacity-text')).toHaveText('Ausgebucht · 3 warten');
    await expect(full.locator('.capacity')).toHaveAttribute('title', '5 von 5 Plätzen belegt · 3 auf der Warteliste');

    await full.click();
    await expect(page.locator('#sidebar-capacity-content .capacity-label')).toHaveText('5 von 5 Plätzen belegt');
    await expect(page.locator('#sidebar-capacity-content .capacity-sublabel')).toHaveText('Ausgebucht · 3 auf der Warteliste');

    // Guests count and the sentence says so: one confirmed guest, one open invitation
    await page.goto('/#event/dev-event-open');
    await expect(page.locator('#sidebar-capacity-content .capacity-label')).toHaveText('6 von 20 Plätzen belegt (inkl. 2 Gäste)');
    await expect(page.locator('#sidebar-capacity-content .capacity-sublabel')).toHaveText('14 Plätze frei');
    await expect(page.locator('#detail-participants-title')).toHaveText('TEILNEHMER');
    expect(errors).toEqual([]);
});

test('banners load, a broken one gives way to the event colour', async ({ page }) => {
    await loginAs(page, 'raider');
    const banner = card(page, 'Community-Spieleabend').locator('img.event-card-banner');
    await banner.scrollIntoViewIfNeeded();
    await expect.poll(() => banner.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);

    const broken = card(page, 'Workshop: Streaming-Setup');
    await broken.scrollIntoViewIfNeeded();
    await expect(broken.locator('img.event-card-banner')).toHaveCSS('display', 'none');
    const background = await broken.locator('.event-card-media').evaluate(media => getComputedStyle(media).backgroundImage);
    expect(background).toContain('gradient');
});
