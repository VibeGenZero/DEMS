/**
 * Plugin studio smoke test (scripts/studio): starts the studio in-process with a temp parent folder,
 * its own DEMS child (temp database and uploads, temp mount folder instead of data/dev-plugins),
 * creates a plugin, edits and saves a file, fires a hook and builds the package.
 * Desktop project only: the studio is a desktop tool.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startStudio } = require('../scripts/studio');

test.describe('plugin studio', () => {
    test.setTimeout(120_000);
    let studio;
    let temp;
    let before;
    const realMount = path.join(__dirname, '..', 'data', 'dev-plugins');
    const listing = () => (fs.existsSync(realMount)
        ? fs.readdirSync(realMount).map((n) => `${n}:${fs.statSync(path.join(realMount, n)).mtimeMs}`).sort().join('|')
        : null);

    test.beforeAll(async ({}, testInfo) => {
        if (testInfo.project.name !== 'desktop') return;
        before = listing();
        temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dems-studio-e2e-'));
        studio = await startStudio({
            port: 0,
            out: { write() {} },
            openBrowser: () => {},
            configDir: path.join(temp, 'config'),
            devPluginsDir: path.join(temp, 'mount'),
            env: {
                ...process.env,
                NODE_ENV: 'test',
                DEV_SQLITE_PATH: path.join(temp, 'studio.sqlite'),
                DEV_UPLOAD_DIR: path.join(temp, 'uploads')
            }
        });
    });

    test.afterAll(async () => {
        if (!studio) return;
        await studio.stop();
        fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        // The child ran from the temp mount: the developer's own data/dev-plugins is unchanged
        expect(listing()).toBe(before);
    });

    test('create, edit, save, hook and build', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'desktop only');
        const parent = path.join(temp, 'plugins');
        fs.mkdirSync(parent);
        await page.goto(studio.url);

        await page.locator('form[data-form="new"] input[name="id"]').fill('e2e-demo');
        await page.locator('form[data-form="new"] input[name="parentDir"]').fill(parent);
        await page.getByRole('button', { name: 'Plugin anlegen' }).click();

        await page.locator('#file-list [data-action="file"][data-path="server.js"]').click();
        const editor = page.locator('#editor-host .monaco-editor').first();
        await expect(editor).toBeVisible({ timeout: 30_000 });
        await editor.click();
        await page.keyboard.press('Control+End');
        await page.keyboard.type('\n// e2e edit');
        await page.keyboard.press('Control+S');
        await expect.poll(() => fs.readFileSync(path.join(parent, 'e2e-demo', 'server.js'), 'utf8'), { timeout: 15_000 }).toContain('// e2e edit');

        // The child restarts after the save; the preview then shows DEMS
        const frame = page.frameLocator('.pv-frame');
        await expect(frame.locator('body')).toContainText(/DEMS/, { timeout: 60_000 });

        await page.locator('[data-hook="create"]').click();
        await expect(page.locator('.studio-toast.is-success')).toBeVisible({ timeout: 15_000 });

        await page.getByRole('button', { name: /Bauen/ }).click();
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Übernehmen und bauen' }).click();
        expect((await download).suggestedFilename()).toBe('e2e-demo-0.1.0.dems');
    });
});
