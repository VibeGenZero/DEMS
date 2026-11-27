/**
 * Plugin studio smoke test (scripts/studio): starts the studio in-process with a temp parent folder,
 * its own DEMS child (temp database and uploads, temp mount folder instead of data/dev-plugins),
 * creates a plugin, edits and saves a file, fires a hook and builds the package.
 * Desktop project only: the studio is a desktop tool.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const http = require('http');
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

        // server.js is open and clean: a change on disk reaches the editor (studio-internal files event)
        const serverFile = path.join(pluginDir, 'server.js');
        const editorText = (file) => page.evaluate((name) => {
            const model = window.monaco.editor.getModels().find((m) => m.uri.path === `/${name}`);
            return model ? model.getValue() : '';
        }, file);
        await expect.poll(() => editorText('server.js'), { timeout: 30_000 }).toContain('register(ctx)');
        fs.writeFileSync(serverFile, `${fs.readFileSync(serverFile, 'utf8')}\n// von der Platte\n`);
        await expect.poll(() => editorText('server.js'), { timeout: 15_000 }).toContain('// von der Platte');
        await expect(page.locator('#editor-tabs .tab-conflict')).toHaveCount(0);
        await restarted();

        // Edit in the editor: register an event.created hook, so the hook really runs in the child
        await page.locator('#file-list [data-action="file"][data-path="server.js"]').click();
        const editor = page.locator('#editor-host .monaco-editor').first();
        await expect(editor).toBeVisible({ timeout: 30_000 });
        // The SDK type file the editor loads for ctx/ui hints has no problems for the language service
        const typeProblems = await page.evaluate(async () => {
            const ts = window.monaco.languages.typescript || window.monaco.typescript;
            const uri = 'file:///dems-plugin.d.ts';
            const worker = await (await ts.getJavaScriptWorker())(window.monaco.Uri.parse(uri));
            const found = [...(await worker.getSyntacticDiagnostics(uri)), ...(await worker.getSemanticDiagnostics(uri))];
            return found.map((d) => (typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText));
        });
        expect(typeProblems).toEqual([]);
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
        await expect(page.locator('.pv-debug .dbg-entry.is-hook', { hasText: 'event.created' })).toContainText(/Hook event\.created \u00b7 ok\b/, { timeout: 15_000 });

        await page.locator('[data-tool="build"]').click();
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Übernehmen und bauen' }).click();
        expect((await download).suggestedFilename()).toBe('e2e-demo-0.1.0.dems');
    });
});

test.describe('plugin studio AI assistant', () => {
    test.setTimeout(120_000);
    const AI_SERVER = "module.exports = {\n    async register(ctx) {\n        ctx.log.info('von der KI');\n    }\n};\n";
    let studio;
    let temp;
    let provider;

    test.beforeAll(async ({}, testInfo) => {
        if (testInfo.project.name !== 'desktop') return;
        temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dems-studio-ai-e2e-'));
        // Fake provider: one OpenAI-style SSE answer with a single file block, whatever is asked
        provider = http.createServer((req, res) => {
            req.resume();
            req.on('end', () => {
                const answer = `Ich habe den Server angepasst.\n<<<DATEI server.js\n${AI_SERVER}>>>DATEI\n`;
                res.writeHead(200, { 'Content-Type': 'text/event-stream' });
                const chunks = answer.match(/[\s\S]{1,40}/g);
                for (const content of chunks) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
                res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
                res.end();
            });
        });
        await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
        const configDir = path.join(temp, 'config');
        fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'ai.json'), JSON.stringify({
            provider: 'ollama',
            baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
            model: 'm',
            maxTokens: 8192,
            contextTokens: 32768
        }));
        studio = await startStudio({
            port: 0,
            out: { write() {} },
            openBrowser: () => {},
            configDir,
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
        if (studio) await studio.stop();
        if (provider) await new Promise((resolve) => provider.close(resolve));
        if (temp) fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    });

    test('chat, view diff, apply and undo', async ({ page }, testInfo) => {
        test.skip(testInfo.project.name !== 'desktop', 'desktop only');
        const violations = [];
        page.on('console', (msg) => { if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text()); });
        const parent = path.join(temp, 'plugins');
        fs.mkdirSync(parent);
        await page.goto(studio.url);
        await page.locator('form[data-form="new"] input[name="id"]').fill('ai-demo');
        await page.locator('form[data-form="new"] input[name="parentDir"]').fill(parent);
        await page.getByRole('button', { name: 'Plugin anlegen' }).click();

        const serverFile = path.join(parent, 'ai-demo', 'server.js');
        const original = () => fs.readFileSync(serverFile, 'utf8');
        const editorText = (file) => page.evaluate((name) => {
            const model = window.monaco && window.monaco.editor.getModels().find((m) => m.uri.path === `/${name}`);
            return model ? model.getValue() : '';
        }, file);
        await expect.poll(() => editorText('server.js'), { timeout: 30_000 }).toContain('register(ctx)');
        const before = original();
        expect(before).not.toContain('von der KI');

        const ai = page.locator('#studio-ai');
        await ai.locator('.ai-input').fill('Schreibe eine Log-Zeile.');
        await ai.getByRole('button', { name: 'Senden' }).click();
        await expect(ai.locator('.ai-proposal-title')).toContainText('1 Datei geändert', { timeout: 30_000 });

        await ai.getByRole('button', { name: 'Ansehen' }).click();
        const diff = page.locator('.ai-diff');
        await expect(diff).toBeVisible();
        await expect(diff.locator('.monaco-diff-editor')).toBeVisible({ timeout: 30_000 });
        await diff.getByRole('button', { name: 'Schließen' }).click();
        await expect(diff).toHaveCount(0);

        await ai.getByRole('button', { name: 'Übernehmen' }).click();
        await expect.poll(original, { timeout: 15_000 }).toBe(AI_SERVER);
        await expect.poll(() => editorText('server.js'), { timeout: 15_000 }).toContain('von der KI');

        await ai.getByRole('button', { name: 'Rückgängig' }).click();
        await expect.poll(original, { timeout: 15_000 }).toBe(before);
        await expect.poll(() => editorText('server.js'), { timeout: 15_000 }).not.toContain('von der KI');
        expect(violations).toEqual([]);
    });
});
