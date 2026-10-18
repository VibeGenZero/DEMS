#!/usr/bin/env node
/**
 * Computed-style snapshot of the SPA in dev mock mode, to compare the look
 * before and after a CSS refactoring without screenshots.
 *
 *   node scripts/style-snapshot.js --out data/d02/before.json
 *   node scripts/style-snapshot.js --compare data/d02/before.json data/d02/after.json
 *
 * --out starts its own mock server (own port, fresh database), logs in as the
 * admin persona and visits the core pages so every section is rendered. Then
 * it records the computed styles of every element in the document (hidden
 * dialogs included, #debug-section excluded) on a desktop and a phone
 * viewport. Needs Playwright's Chromium (npx playwright install chromium).
 * Not part of npm test.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const PORT = 3124;
const BASE_URL = `http://localhost:${PORT}`;
const SERVER_START_TIMEOUT_MS = 60000;
const MAX_SAMPLES = 5;
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const ROUTES = ['events', 'event/dev-event-role', 'polls', 'profile', 'admin', 'bot-control', 'info'];
const PROPERTIES = [
    'color', 'background-color', 'background-image', 'border-top-color', 'border-top-width', 'border-top-left-radius',
    'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-bottom',
    'box-shadow', 'z-index', 'min-height'
];

/**
 * Differences between two snapshots.
 *
 * @param {Object} before -> { [viewport]: { [key]: { label, styles } } }.
 * @param {Object} after -> Same shape.
 * @returns {{ changes: Array<Object>, removed: Array<Object>, added: Array<Object> }} -> changes are grouped by viewport, property and value pair, most frequent first.
 */
function compareSnapshots(before, after) {
    const groups = new Map();
    const removed = [];
    const added = [];
    for (const viewport of Object.keys(before)) {
        const beforeElements = before[viewport];
        const afterElements = after[viewport] || {};
        for (const [key, element] of Object.entries(beforeElements)) {
            const other = afterElements[key];
            if (!other) {
                removed.push({ viewport, label: element.label });
                continue;
            }
            for (const [property, value] of Object.entries(element.styles)) {
                const newValue = other.styles[property];
                if (newValue === value) continue;
                const id = [viewport, property, value, newValue].join('\u0000');
                const group = groups.get(id) || { viewport, property, before: value, after: newValue, count: 0, samples: [] };
                group.count += 1;
                if (group.samples.length < MAX_SAMPLES && !group.samples.includes(other.label)) group.samples.push(other.label);
                groups.set(id, group);
            }
        }
        for (const [key, element] of Object.entries(afterElements)) {
            if (!(key in beforeElements)) added.push({ viewport, label: element.label });
        }
    }
    const changes = [...groups.values()].sort((a, b) => b.count - a.count || a.property.localeCompare(b.property));
    return { changes, removed, added };
}

/**
 * Human-readable report of compareSnapshots().
 *
 * @param {{ changes: Array<Object>, removed: Array<Object>, added: Array<Object> }} result -> Comparison result.
 * @returns {string} -> One line per change group, then removed and added elements.
 */
function formatReport({ changes, removed, added }) {
    const lines = [`${changes.length} change group(s), ${removed.length} removed, ${added.length} added`];
    for (const change of changes) {
        lines.push(`${change.viewport.padEnd(8)} ${change.property}: ${change.before} -> ${change.after}  ${change.count}×  ${change.samples.join(', ')}`);
    }
    for (const element of removed) lines.push(`removed: ${element.viewport} ${element.label}`);
    for (const element of added) lines.push(`added: ${element.viewport} ${element.label}`);
    return lines.join('\n');
}

/**
 * Runs in the page: computed styles of every element, keyed by its
 * structural path (nearest id, then tag:index), so class changes keep the key.
 */
function collectStyles(properties) {
    const keyOf = (element) => {
        const parts = [];
        for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
            if (node.id) {
                parts.unshift(`#${node.id}`);
                break;
            }
            parts.unshift(`${node.tagName.toLowerCase()}:${[...node.parentElement.children].indexOf(node) + 1}`);
        }
        return parts.join('>');
    };
    const labelOf = (element) => {
        const classes = typeof element.className === 'string' && element.className.trim() ? `.${element.className.trim().split(/\s+/).join('.')}` : '';
        return `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${classes}`;
    };
    // A running CSS animation (e.g. a pulsing shadow) would give every run other values;
    // cancelled, each element shows its resting style
    for (const animation of document.getAnimations()) animation.cancel();
    const result = {};
    for (const element of document.body.querySelectorAll('*')) {
        if (['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName) || element.closest('#debug-section')) continue;
        const computed = getComputedStyle(element);
        const styles = {};
        for (const property of properties) styles[property] = computed.getPropertyValue(property);
        result[keyOf(element)] = { label: labelOf(element), styles };
    }
    return result;
}

async function waitForServer() {
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const ok = await fetch(`${BASE_URL}/healthz`).then(res => res.ok, () => false);
        if (ok) return;
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`mock server did not answer on ${BASE_URL}/healthz`);
}

async function takeSnapshot() {
    const { chromium } = require('@playwright/test');
    const { version } = require('../updates.json');
    const dbPath = path.join(os.tmpdir(), `dems-snapshot-${Date.now()}.sqlite`);
    const server = spawn(process.execPath, ['dev/start.js'], {
        cwd: REPO_ROOT,
        env: { ...process.env, PORT: String(PORT), DEV_SQLITE_PATH: dbPath },
        stdio: 'ignore'
    });
    const browser = await chromium.launch();
    try {
        await waitForServer();
        const snapshot = {};
        for (const [name, viewport] of Object.entries(VIEWPORTS)) {
            // Dark scheme: the snapshot compares against the dark look of origin/main
            const context = await browser.newContext({ viewport, colorScheme: 'dark' });
            // Skip the boot animation and the "Neuigkeiten" dialog, like e2e/helpers.js
            await context.addInitScript((currentVersion) => {
                localStorage.setItem('dems_boot_ts', String(Date.now()));
                localStorage.setItem('dems_last_seen_version', currentVersion);
            }, version);
            const page = await context.newPage();
            await page.goto(`${BASE_URL}/auth/dev-login/admin`);
            await page.locator('#events-section').waitFor({ state: 'visible' });
            for (const route of ROUTES) {
                await page.evaluate((hash) => { location.hash = hash; }, route);
                await page.waitForLoadState('networkidle');
                await page.waitForTimeout(700);
            }
            // Entrance animations have ended
            await page.waitForTimeout(1500);
            snapshot[name] = await page.evaluate(collectStyles, PROPERTIES);
            await context.close();
        }
        return snapshot;
    } finally {
        await browser.close();
        // Wait for the exit, so a following run can bind the port
        if (server.exitCode === null) {
            await new Promise((resolve) => {
                server.once('exit', resolve);
                server.kill();
            });
        }
        fs.rmSync(dbPath, { force: true });
    }
}

async function main([flag, first, second]) {
    if (flag === '--compare' && first && second) {
        const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
        console.log(formatReport(compareSnapshots(read(first), read(second))));
        return;
    }
    if (flag === '--out' && first) {
        const snapshot = await takeSnapshot();
        fs.mkdirSync(path.dirname(path.resolve(first)), { recursive: true });
        fs.writeFileSync(first, JSON.stringify(snapshot));
        const counts = Object.entries(snapshot).map(([name, elements]) => `${name}: ${Object.keys(elements).length} elements`);
        console.log(`Wrote ${first} (${counts.join(', ')})`);
        return;
    }
    console.error('Usage: node scripts/style-snapshot.js --out <file> | --compare <before> <after>');
    process.exitCode = 1;
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

module.exports = { compareSnapshots, formatReport };
