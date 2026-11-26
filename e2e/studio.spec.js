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

        const pluginDir = path.join(parent, 'e2e-demo');
        const frame = page.frameLocator('.pv-frame');
        const overlay = page.locator('.pv-overlay');
        // The real app, not the proxy's 503 page: the SPA navbar, shown once the boot animation is done
        const appShell = frame.locator('#main-navbar #nav-brand-name');
        const appReady = async () => {
            await expect(overlay).toBeHidden({ timeout: 60_000 });
            await expect(appShell).toBeVisible({ timeout: 60_000 });
            await expect(frame.locator('body')).not.toContainText('startet neu');
        };
        await appReady();

        // Record the restart overlay so a fast restart cannot be missed by polling
        await page.evaluate(() => {
            window.__sawRestart = false;
            const node = document.querySelector('.pv-overlay');
            new MutationObserver(() => { if (/startet neu/.test(node.textContent)) window.__sawRestart = true; })
                .observe(node, { childList: true, characterData: true, subtree: true });
        });
        const restarted = async () => {
            await expect.poll(() => page.evaluate(() => window.__sawRestart), { timeout: 30_000 }).toBe(true);
            await page.evaluate(() => { window.__sawRestart = false; });
            await appReady();
        };

        // The scaffold uses no permission: grant events:read on disk (the folder watcher restarts the child)
        const manifestFile = path.join(pluginDir, 'plugin.json');
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        manifest.permissions = [...new Set([...(manifest.permissions || []), 'events:read'])];
        fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
        await restarted();

        // Edit in the editor: register an event.created hook, so the hook really runs in the child
        const serverFile = path.join(pluginDir, 'server.js');
        await page.locator('#file-list [data-action="file"][data-path="server.js"]').click();
        const editor = page.locator('#editor-host .monaco-editor').first();
        await expect(editor).toBeVisible({ timeout: 30_000 });
        await editor.click();
        const changed = await page.evaluate(() => {
            const model = window.monaco.editor.getModels().find((m) => m.uri.path.endsWith('/server.js'));
            const next = model.getValue().replace(/register\(ctx\) \{/, "register(ctx) {\n        ctx.hooks.on('event.created', async () => {});");
            if (next === model.getValue()) return false;
            model.setValue(next + "\n// e2e edit");
            return true;
        });
        expect(changed).toBe(true);
        await page.keyboard.press('Control+S');
        await expect.poll(() => fs.readFileSync(serverFile, 'utf8'), { timeout: 15_000 }).toContain("ctx.hooks.on('event.created'");

        // The save restarts the child: the studio shows it, then the real app is back
        await restarted();

        // The save toast must be gone before the trigger toast is judged
        await expect(page.locator('.studio-toast', { hasText: 'Gespeichert' })).toHaveCount(0, { timeout: 10_000 });
        await page.locator('[data-hook="create"]').click();
        await expect(page.locator('.studio-toast.is-success', { hasText: 'Test-Event „Studio-Test“ als Entwurf erstellt.' })).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.studio-toast.is-danger')).toHaveCount(0);
        await expect(page.locator('.pv-debug .dbg-entry.is-hook', { hasText: 'event.created' })).toContainText('ok', { timeout: 15_000 });

        await page.locator('[data-tool="build"]').click();
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Übernehmen und bauen' }).click();
        expect((await download).suggestedFilename()).toBe('e2e-demo-0.1.0.dems');
    });
});
