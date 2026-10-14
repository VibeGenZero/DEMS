/**
 * Avatars (D-09): every person and the bot is an avatar() from
 * core/components.js. Mock mode takes its pictures from Discord's CDN like
 * the real app, so blocking that CDN shows what a member sees when an image
 * does not load: initials, never a broken image or its alt text.
 */
const path = require('path');
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs, navigate } = require('./helpers');

const DISCORD_CDN = 'https://cdn.discordapp.com/**';

/**
 * Expect initials tiles below `scope` and no avatar image left there.
 *
 * @param {import('@playwright/test').Page} page -> Page.
 * @param {string} scope -> Selector of the area, e.g. "#comments-section".
 * @returns {Promise<void>}
 */
async function expectInitialsOnly(page, scope) {
    await expect(page.locator(`${scope} .avatar-initials`).first()).toBeVisible();
    await expect(page.locator(`${scope} img`)).toHaveCount(0);
}

test('without Discord images every person and the bot show initials', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the markup is the same on the phone');
    const errors = watchErrors(page);
    await page.route(DISCORD_CDN, route => route.abort());
    await loginAs(page, 'admin');
    // "Mori (Admin)": the bracket is no initial
    await expect(page.locator('#user-avatar .avatar-initials')).toHaveText('MA');
    await expect(page.locator('#user-avatar img')).toHaveCount(0);

    await page.goto('/#event/dev-event-open');
    await expectInitialsOnly(page, '#detail-participants-avatars');
    await expectInitialsOnly(page, '#comments-section');

    await page.goto('/#event/dev-event-role');
    await expectInitialsOnly(page, '#detail-roster');
    // A free seat is a circle of the same size as the avatars above it
    const size = (selector) => page.locator(selector).first().evaluate(el => [el.offsetWidth, el.offsetHeight]);
    expect(await size('#detail-roster .roster-seat-dot')).toEqual(await size('#detail-roster .avatar'));

    await page.goto('/#poll/dev-poll-raid');
    await expectInitialsOnly(page, '#poll-detail .poll-voters');

    await navigate(page, 'profile');
    await expectInitialsOnly(page, '#profile-card');

    await navigate(page, 'bot-control');
    await expect(page.locator('#bot-status-panel .avatar.avatar-lg.avatar-initials')).toHaveText('DB');
    await expect(page.locator('#bot-status-panel img')).toHaveCount(0);
    await expect(page.getByText('Bot Avatar')).toHaveCount(0);
    expect(errors).toEqual([]);
});

test('with Discord images the avatars are pictures', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the markup is the same on the phone');
    await page.route(DISCORD_CDN, route => route.fulfill({ path: path.join(__dirname, '..', 'public', 'logo.svg') }));
    await loginAs(page, 'admin');
    const own = page.locator('#user-avatar img.avatar');
    await expect.poll(() => own.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);

    await navigate(page, 'bot-control');
    const bot = page.locator('#bot-status-panel img.avatar.avatar-lg');
    await expect.poll(() => bot.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
});
