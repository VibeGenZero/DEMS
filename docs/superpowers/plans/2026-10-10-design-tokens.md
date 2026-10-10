# Design-Tokens und Komponenten-Bibliothek (D-02) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein vollständiger Satz Design-Tokens (`tokens.css`) und neun Komponenten (`components.css`) entstehen, der Styleguide `#debug` zeigt beides, und das bestehende `style.css` wird auf die Tokens umgestellt und von 55 doppelten Selektoren befreit.

**Architecture:**
1. `tokens.css` ist die einzige Datei mit Farbwerten, Schriftgrößen und Ebenen als Zahl. `components.css` setzt daraus Bootstraps eigene `--bs-*`-Variablen (Button, Dialog, Toast, Tabs) und definiert eigene Klassen (Karte, Chip, Leerzustand, Skeleton, Avatar). `style.css` behält nur Seiten-Spezifisches.
2. Alte Klassennamen bleiben als Zweitnamen in derselben Selektorliste gültig, das Seiten-Markup bleibt unberührt.
3. Der Bestand wird mit einmaligen Skripten (in `data/d02/`, nicht im Repo) umgestellt: Duplikate zusammenführen, Farben und Schriftgrößen ersetzen. Wächter-Tests in `npm test` halten den Zustand fest.
4. Ein Vorher-Nachher-Vergleich der berechneten Stile (`scripts/style-snapshot.js`) zeigt nach jedem Umbauschritt, was sich sichtbar geändert hat.

**Tech Stack:** Node.js ≥ 22, Vanilla-JS-SPA (native ES-Module), Bootstrap 5.3.2 aus `public/vendor/`, `node:test` + `node:vm` (`--experimental-vm-modules`), Playwright 1.63.0 (`npm run test:e2e` und das Vergleichs-Skript).

**Spec:** `docs/superpowers/specs/2026-10-10-design-tokens-design.md`

**Branch:** `51-d-02-design-tokens-und-komponenten-bibliothek` (Ticket #51), von `main` nach dem Merge von D-01.

## Global Constraints

- Kein Build-Schritt, kein Bundler, keine neue npm-Abhängigkeit, kein TypeScript.
- Außerhalb von `public/css/tokens.css` steht in `components.css` und `style.css` kein Farbwert (`#…`, `rgb()`, `rgba()`, `hsl()`, `white`, `black`), keine Schriftgröße in px/rem und kein `z-index` ab 10 als Zahl. `transparent`, `currentColor` und `inherit` sind erlaubt.
- Die 24 bestehenden Variablennamen bleiben. Einzige Umbenennung: `--font-display` → `--font-logo`; sie kommt nur in `.loading-logo` und `.brand-text` vor.
- Weiße Schrift steht nie auf `--accent`, sondern auf `--accent-fill`. Violetter Text nimmt `--accent-text`. Auf `--bg-tint-2` und `--bg-tint-3` steht nur `--text-primary` oder `--text-secondary`.
- `!important` in `components.css` nur in den Farb-Helfern (`.text-*`, `.bg-*`, `.text-bg-*`), weil Bootstraps eigene Helfer es tragen.
- Seiten-Markup bleibt. Ausnahmen: die Klasse `glass-modal` (14 Verwendungen) entfällt, `#app-toast` bekommt ein Symbol-Element, `#debug-section` wird neu aufgebaut.
- Abstände in Seitenregeln von `style.css` bleiben unverändert.
- Neuer Code enthält kein `style="…"`-Attribut; dynamische Werte setzt JS per `element.style.setProperty`.
- Aktionsnamen stehen wörtlich im Markup (`data-click="name"`), nie als `${…}`; jeder eingesetzte Wert geht durch `escapeHtml(...)`.
- Module führen beim Laden nur `import`/`export`, Deklarationen und `registerActions(...)` aus; höchstens ~500 Zeilen (der Test erlaubt 550).
- Alles, was Nutzer sehen, auf Deutsch; Code, Kommentare, Commits und Wiki auf Englisch.
- Jeder Commit ist grün: `npm test` und `npm run test:e2e` (einmal pro Rechner `npx playwright install chromium`).
- Commit-Texte: englischer Imperativ als Betreff, das Warum im Text; kein `#<Zahl>` außer echten Ticket-Verweisen. Commits enden mit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
- Wiki: Jeder Task korrigiert im selben Commit die Wiki-Aussagen, die er falsch macht (Schritt „Wiki nachziehen“), danach `npm run wiki`. Task 13 schreibt den Endstand der Knoten.
- Einmal-Skripte und Vergleichs-Dateien liegen in `data/d02/` (per `.gitignore` ausgeschlossen) und werden nie committet.

## Review Focus

1. **Anzeigenamen aus Discord in `avatar()` und `initialsOf()`:** HTML, Anführungszeichen, Emoji, nur Leerzeichen, `undefined`. Erwartung: alles escaped, Initialen aus bis zu zwei Wörtern, sonst `?`. Tests in Task 8.
2. **`showToast` mit unbekanntem Typ oder altem `index.html`:** Typ `'error'`, `undefined` oder `'constructor'`, sowie ein zwischengespeichertes `index.html` ohne `#toast-icon`. Erwartung: Der Toast erscheint trotzdem, als Info. Tests in Task 6.
3. **Lange Inhalte auf 390 px:** ein Chip mit sehr langem Kategorienamen, acht Tabs nebeneinander. Erwartung: Nichts ragt aus der Seite, die Tabs lassen sich seitlich wischen. Test in Task 12 (Browser-Test), CSS in Task 5 und 7.
4. **Ein Token, das die Kontrastrechnung nicht lesen kann** (Tippfehler, `var(--…)` als Farbwert). Erwartung: Der Token-Test schlägt mit dem Namen des Tokens fehl; der Styleguide zeigt keinen Kontrast statt abzustürzen. Tests in Task 3 und Task 12.
5. **Bild-Fallback bei kaputtem Avatar:** Ein `.avatar`-Bild behält als Initialen-Kachel seine Größenklasse; ein Bild ohne `.avatar` bekommt weiter den alten Platzhalter. Tests in Task 8.

## Dateien

| Datei | Aufgabe | Task |
|---|---|---|
| `scripts/style-snapshot.js` (neu) | berechnete Stile aufnehmen und vergleichen | 1 |
| `test/styleSnapshot.test.js` (neu) | Vergleichslogik | 1 |
| `public/js/core/contrast.js` (neu) | `parseColor`, `composite`, `contrastRatio` | 2 |
| `test/contrast.test.js` (neu) | Kontrastrechnung | 2 |
| `test/cssSource.js`, `test/cssSource.test.js` (neu) | CSS-Leser für die Wächter-Tests | 3 |
| `public/css/tokens.css` (neu) | alle Tokens | 3 |
| `test/designTokens.test.js` (neu) | Pflicht-Tokens, Kontrastregeln | 3 |
| `test/cssRules.test.js` (neu) | Wächter: Ladereihenfolge, Logo-Schrift, Duplikate, Komponenten-Selektoren, rohe Werte, Obergrenzen | 3–13 |
| `public/css/components.css` (neu) | Bootstrap-Brücke und neun Komponenten | 5–8 |
| `public/css/style.css` | Seiten-Spezifisches, aufgeräumt | 3–12 |
| `public/index.html` | Stylesheet-Links, Toast-Markup, `glass-modal` entfernt, `#debug-section` | 3, 5, 6, 12 |
| `public/js/core/ui.js` | `showToast`, `renderSkeletonEvents` | 6, 7 |
| `public/js/core/components.js` (neu) | `initialsOf`, `avatar`, `emptyState` | 8 |
| `public/js/core/actions.js` | Bild-Fallback `initials` für `.avatar` | 8 |
| `test/components.test.js` (neu) | Toast, Skeleton, Helfer, Fallback | 6–8 |
| `public/js/pages/debug.js` | Styleguide: Tokens und Bestand | 12 |
| `public/js/pages/debug-components.js` (neu) | Styleguide: neun Komponenten | 12 |
| `test/styleguide.test.js`, `e2e/styleguide.spec.js` (neu) | Styleguide | 12 |
| `playwright.config.js` | `DEBUG_MODE=true` für den Test-Server | 12 |
| Wiki, `CLAUDE.md`, `server.js` (Kommentar), Prio-Plan | Doku | 13 |

---

### Task 0: Ausgangslage prüfen, Plan committen

**Files:**
- Create: `data/d02/` (Arbeitsordner, nicht im Repo)
- Commit: `docs/superpowers/plans/2026-10-10-design-tokens.md`, `docs/superpowers/specs/2026-10-10-design-tokens-design.md`

- [ ] **Step 1: Branch und Arbeitsordner**

```bash
git switch 51-d-02-design-tokens-und-komponenten-bibliothek
mkdir -p data/d02
git check-ignore data/d02 && echo "ignored"
```
Expected: `data/d02` und `ignored`.

- [ ] **Step 2: Ausgangslage ist grün**

```bash
npm test 2>&1 | tail -8
npx playwright install chromium
npm run test:e2e 2>&1 | tail -6
```
Expected: `# fail 0` und bei Playwright `passed` ohne `failed`.

- [ ] **Step 3: Plan und Spec committen**

`package-lock.json` hat eine fremde, offene Änderung und wird in keinem Commit dieses Plans mitgenommen.

```bash
git add docs/superpowers/plans/2026-10-10-design-tokens.md docs/superpowers/specs/2026-10-10-design-tokens-design.md
git commit -m "Add the implementation plan for design tokens and components

The plan turns the D-02 spec into 13 tasks. The spec gains the token
--bg-scrim, leaves #debug out of the style comparison and takes ready
button markup for the empty state, because action names must be
literal in the markup.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Vorher-Nachher-Vergleich `scripts/style-snapshot.js`

**Files:**
- Create: `scripts/style-snapshot.js`
- Test: `test/styleSnapshot.test.js`

**Interfaces:**
- Produces:
  - `compareSnapshots(before, after): { changes, removed, added }`. Ein Snapshot ist `{ [viewport]: { [key]: { label: string, styles: { [property]: string } } } }`. `changes` ist eine Liste `{ viewport, property, before, after, count, samples }`, absteigend nach `count`, dann nach `property`; `samples` enthält bis zu 5 verschiedene Labels. `removed` und `added` sind Listen `{ viewport, label }`.
  - `formatReport(result): string`
  - CLI: `node scripts/style-snapshot.js --out <datei>` und `node scripts/style-snapshot.js --compare <vorher> <nachher>`

- [ ] **Step 1: Failing test schreiben**

`test/styleSnapshot.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareSnapshots, formatReport } = require('../scripts/style-snapshot');

const el = (label, styles) => ({ label, styles });

test('unchanged snapshots have no differences', () => {
    const snapshot = { desktop: { 'body>div:1': el('div.card', { color: 'rgb(1, 2, 3)' }) } };
    assert.deepEqual(compareSnapshots(snapshot, snapshot), { changes: [], removed: [], added: [] });
});

test('changed values are grouped by property and value pair, most frequent first', () => {
    const before = { desktop: {
        a: el('p.text-muted', { color: 'rgb(113, 113, 122)', 'font-size': '14px' }),
        b: el('small.text-muted', { color: 'rgb(113, 113, 122)', 'font-size': '12.8px' })
    } };
    const after = { desktop: {
        a: el('p.text-muted', { color: 'rgb(143, 143, 154)', 'font-size': '14px' }),
        b: el('small.text-muted', { color: 'rgb(143, 143, 154)', 'font-size': '14px' })
    } };
    assert.deepEqual(compareSnapshots(before, after).changes, [
        { viewport: 'desktop', property: 'color', before: 'rgb(113, 113, 122)', after: 'rgb(143, 143, 154)', count: 2, samples: ['p.text-muted', 'small.text-muted'] },
        { viewport: 'desktop', property: 'font-size', before: '12.8px', after: '14px', count: 1, samples: ['small.text-muted'] }
    ]);
});

test('a group keeps at most five different sample labels', () => {
    const many = (color) => ({ desktop: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`k${i}`, el(`span.s${i % 7}`, { color })])) });
    const [change] = compareSnapshots(many('a'), many('b')).changes;
    assert.equal(change.count, 8);
    assert.deepEqual(change.samples, ['span.s0', 'span.s1', 'span.s2', 'span.s3', 'span.s4']);
});

test('elements that appear or disappear are listed', () => {
    const result = compareSnapshots({ desktop: { a: el('div.old', {}) } }, { desktop: { b: el('div.new', {}) } });
    assert.deepEqual(result.removed, [{ viewport: 'desktop', label: 'div.old' }]);
    assert.deepEqual(result.added, [{ viewport: 'desktop', label: 'div.new' }]);
});

test('the report names every change in one line and counts the rest', () => {
    const report = formatReport({
        changes: [{ viewport: 'mobile', property: 'color', before: 'a', after: 'b', count: 3, samples: ['p.x', 'p.y'] }],
        removed: [{ viewport: 'mobile', label: 'div.old' }],
        added: []
    });
    assert.match(report, /mobile\s+color: a -> b\s+3×\s+p\.x, p\.y/);
    assert.match(report, /1 change group\(s\), 1 removed, 0 added/);
    assert.match(report, /removed: mobile div\.old/);
});
```

- [ ] **Step 2: Test läuft rot**

Run: `node --test test/styleSnapshot.test.js`
Expected: FAIL mit `Cannot find module '../scripts/style-snapshot'`.

- [ ] **Step 3: Skript schreiben**

`scripts/style-snapshot.js`:
```js
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
            const context = await browser.newContext({ viewport });
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
```

- [ ] **Step 4: Test läuft grün**

Run: `node --test test/styleSnapshot.test.js`
Expected: PASS, 5 Tests.

- [ ] **Step 5: Ausgangs-Snapshot aufnehmen und Stabilität prüfen**

```bash
node scripts/style-snapshot.js --out data/d02/before.json
node scripts/style-snapshot.js --out data/d02/before-2.json
node scripts/style-snapshot.js --compare data/d02/before.json data/d02/before-2.json
```
Expected: Beide Läufe melden für `desktop` und `mobile` je mehrere tausend Elemente. Der Vergleich meldet `0 change group(s), 0 removed, 0 added`.

Falls der Vergleich Abweichungen zeigt, sind es laufende Animationen oder zeitabhängige Elemente. Dann die betroffene Eigenschaft aus `PROPERTIES` nehmen oder die Wartezeit von 1500 ms erhöhen, bis zwei Läufe gleich sind. Erst danach weiter.

- [ ] **Step 6: Commit**

```bash
npm test 2>&1 | tail -8
git add scripts/style-snapshot.js test/styleSnapshot.test.js
git commit -m "Add a computed-style snapshot to compare the look before and after

The stylesheet gets rewritten onto design tokens. Screenshots flake on
animations and differ between machines; comparing computed styles per
element lists every visible change exactly.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Kontrastrechnung `core/contrast.js`

**Files:**
- Create: `public/js/core/contrast.js`
- Test: `test/contrast.test.js`

**Interfaces:**
- Produces (ES-Modul, ohne DOM):
  - `parseColor(value: string): { r, g, b, a } | null` versteht `#rgb`, `#rrggbb`, `rgb(r, g, b)`, `rgba(r, g, b, a)` und `transparent`; alles andere ergibt `null`.
  - `composite(top, bottom): { r, g, b, a: 1 }` legt `top` mit seiner Deckkraft über das deckende `bottom`.
  - `contrastRatio(a, b): number` für zwei deckende Farben, 1 bis 21.

- [ ] **Step 1: Failing test schreiben**

`test/contrast.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');

const CONTRAST_FILE = path.join(REPO_ROOT, 'public', 'js', 'core', 'contrast.js');
const load = async () => (await loadFrontendModules(CONTRAST_FILE, vm.createContext({}))).get('contrast.js');
const round2 = (value) => Math.round(value * 100) / 100;

test('hex, rgb, rgba and transparent are parsed', async () => {
    const { parseColor } = await load();
    // Objects from the vm context have another prototype, so spread before comparing
    assert.deepEqual({ ...parseColor('#fff') }, { r: 255, g: 255, b: 255, a: 1 });
    assert.deepEqual({ ...parseColor('#8F8f9a') }, { r: 143, g: 143, b: 154, a: 1 });
    assert.deepEqual({ ...parseColor('rgb(10, 10, 15)') }, { r: 10, g: 10, b: 15, a: 1 });
    assert.deepEqual({ ...parseColor(' rgba(139, 92, 246, 0.15) ') }, { r: 139, g: 92, b: 246, a: 0.15 });
    assert.deepEqual({ ...parseColor('transparent') }, { r: 0, g: 0, b: 0, a: 0 });
});

test('values that are no plain colour give null', async () => {
    const { parseColor } = await load();
    for (const value of ['var(--accent)', '#12345', 'rgb(1, 2)', 'violet', '', undefined, null]) {
        assert.equal(parseColor(value), null, String(value));
    }
});

test('a translucent colour is laid over an opaque one', async () => {
    const { parseColor, composite } = await load();
    const mixed = composite(parseColor('rgba(255, 255, 255, 0.06)'), parseColor('#16161f'));
    assert.deepEqual({ r: Math.round(mixed.r), g: Math.round(mixed.g), b: Math.round(mixed.b), a: mixed.a }, { r: 36, g: 36, b: 44, a: 1 });
});

test('contrast follows WCAG and does not depend on the order', async () => {
    const { parseColor, contrastRatio } = await load();
    const ratio = (a, b) => round2(contrastRatio(parseColor(a), parseColor(b)));
    assert.equal(ratio('#ffffff', '#000000'), 21);
    assert.equal(ratio('#000000', '#ffffff'), 21);
    assert.equal(ratio('#e4e4e7', '#16161f'), 14.16);
    assert.equal(ratio('#71717a', '#16161f'), 3.72);
    assert.equal(ratio('#ffffff', '#7c3aed'), 5.7);
});
```

- [ ] **Step 2: Test läuft rot**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/contrast.test.js`
Expected: FAIL mit `ENOENT … public/js/core/contrast.js`.

- [ ] **Step 3: Modul schreiben**

`public/js/core/contrast.js`:
```js
/**
 * Colour maths for the WCAG contrast check. Used by the styleguide (#debug)
 * and by test/designTokens.test.js; no DOM access.
 */

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

/**
 * Parse a CSS colour: #rgb, #rrggbb, rgb(r, g, b), rgba(r, g, b, a), transparent.
 *
 * @param {string} value -> CSS colour value.
 * @returns {{ r: number, g: number, b: number, a: number }|null} -> Channels 0-255 and alpha 0-1; null if the value is no plain colour.
 */
export function parseColor(value) {
    const text = String(value ?? '').trim();
    if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const hex = HEX.exec(text);
    if (hex) {
        const digits = hex[1].length === 3 ? [...hex[1]].map(digit => digit + digit).join('') : hex[1];
        return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16), a: 1 };
    }
    const rgb = RGB.exec(text);
    if (!rgb) return null;
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
}

/**
 * Lay a translucent colour over an opaque one.
 *
 * @param {{ r: number, g: number, b: number, a: number }} top -> Colour on top.
 * @param {{ r: number, g: number, b: number }} bottom -> Opaque colour below.
 * @returns {{ r: number, g: number, b: number, a: number }} -> Opaque result.
 */
export function composite(top, bottom) {
    const mix = (upper, lower) => upper * top.a + lower * (1 - top.a);
    return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

function luminance({ r, g, b }) {
    const [red, green, blue] = [r, g, b].map(channel => {
        const share = channel / 255;
        return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * WCAG 2 contrast ratio of two opaque colours.
 *
 * @param {{ r: number, g: number, b: number }} a -> First colour.
 * @param {{ r: number, g: number, b: number }} b -> Second colour.
 * @returns {number} -> 1 (same) to 21 (black on white).
 */
export function contrastRatio(a, b) {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (lighter + 0.05) / (darker + 0.05);
}
```

- [ ] **Step 4: Test läuft grün**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/contrast.test.js`
Expected: PASS, 4 Tests.

- [ ] **Step 5: Commit**

```bash
npm test 2>&1 | tail -8
git add public/js/core/contrast.js test/contrast.test.js
git commit -m "Add the WCAG contrast maths as a frontend module

The token test and the styleguide both need the contrast of a text
colour on a surface, including translucent tints. One small module
without DOM access serves both.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: CSS-Leser, `tokens.css` und Token-Tests

**Files:**
- Create: `test/cssSource.js`, `test/cssSource.test.js`
- Create: `public/css/tokens.css`
- Create: `test/designTokens.test.js`, `test/cssRules.test.js`
- Modify: `public/css/style.css` (Kopf und `:root`-Block, Zeilen 1–30; vier `--font-display`-Stellen)
- Modify: `public/index.html` (Stylesheet-Link, Zeile 37)
- Modify: `docs/wiki/modules/frontend-markup.md`

**Interfaces:**
- Consumes: `parseColor`, `composite`, `contrastRatio` aus `public/js/core/contrast.js` (Task 2)
- Produces:
  - `readCss(name: string): string` liest `public/css/<name>`.
  - `stripComments(css: string): string` ersetzt Kommentare durch Leerzeichen, Zeilen bleiben erhalten.
  - `parseRules(css: string): Array<{ selector, context, declarations: Array<{ property, value, line }>, line }>`. `selector` ist die Selektorliste mit einfachen Leerzeichen und `, ` als Trenner; `context` sind die offenen At-Regeln (`''` auf oberster Ebene, sonst zum Beispiel `@media (max-width: 768px)` oder `@keyframes live-pulse`).
  - `readTokens(css: string): Map<string, string>` liefert die Custom Properties aller `:root`-Regeln.
  - Alle Token-Namen aus der Liste `REQUIRED` in `test/designTokens.test.js`.

- [ ] **Step 1: Failing test für den CSS-Leser**

`test/cssSource.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripComments, parseRules, readTokens } = require('./cssSource');

test('comments are blanked and keep their lines', () => {
    assert.equal(stripComments('a /* x { */ b\n/* two\nlines */c'), 'a           b\n      \n        c');
});

test('rules carry selector list, context, declarations and lines', () => {
    const rules = parseRules([
        'a{color:red}',
        '/* .ghost { color: blue; } */',
        '@media (max-width: 1px) {',
        '  .b ,',
        '  .c { margin: 0; padding : 1px  2px }',
        '}',
        '.d {}'
    ].join('\n'));
    assert.deepEqual(rules, [
        { selector: 'a', context: '', declarations: [{ property: 'color', value: 'red', line: 1 }], line: 1 },
        { selector: '.b, .c', context: '@media (max-width: 1px)', declarations: [{ property: 'margin', value: '0', line: 5 }, { property: 'padding', value: '1px 2px', line: 5 }], line: 4 },
        { selector: '.d', context: '', declarations: [], line: 7 }
    ]);
});

test('keyframe steps belong to their animation', () => {
    const rules = parseRules('@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }\n.x { animation: pulse 1s; }');
    assert.deepEqual(rules.map(rule => [rule.context, rule.selector]), [['@keyframes pulse', '0%, 100%'], ['@keyframes pulse', '50%'], ['', '.x']]);
});

test('tokens are the custom properties of :root', () => {
    const tokens = readTokens(':root { --a: #fff; --b: 0 0 0 3px var(--a); color: red; }\n.x { --c: 1; }');
    assert.deepEqual([...tokens], [['--a', '#fff'], ['--b', '0 0 0 3px var(--a)']]);
});
```

- [ ] **Step 2: Test läuft rot**

Run: `node --test test/cssSource.test.js`
Expected: FAIL mit `Cannot find module './cssSource'`.

- [ ] **Step 3: CSS-Leser schreiben**

`test/cssSource.js`:
```js
/**
 * Small CSS reader for the stylesheet guard tests (designTokens.test.js,
 * cssRules.test.js). No parser dependency: the project stylesheets only use
 * plain rules, @media and @keyframes.
 */
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./helpers');

const CSS_DIR = path.join(REPO_ROOT, 'public', 'css');
// At-rules that contain rules; everything else with a block is a rule itself
const NESTING_AT_RULE = /^@(media|supports|keyframes|-webkit-keyframes)\b/;

/**
 * Read a project stylesheet.
 *
 * @param {string} name -> File name below public/css, e.g. "tokens.css".
 * @returns {string} -> File content.
 */
function readCss(name) {
    return fs.readFileSync(path.join(CSS_DIR, name), 'utf8');
}

/**
 * Blank out comments. Newlines stay, so every character keeps its line.
 *
 * @param {string} css -> Stylesheet source.
 * @returns {string} -> Source of the same length without comment text.
 */
function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' '));
}

/**
 * Rules of a stylesheet in source order.
 *
 * @param {string} css -> Stylesheet source.
 * @returns {Array<{ selector: string, context: string, declarations: Array<{ property: string, value: string, line: number }>, line: number }>} -> selector is the normalised selector list, context the open at-rules ('' at the top level).
 */
function parseRules(css) {
    const text = stripComments(css);
    const rules = [];
    const contexts = [];
    let rule = null;
    let buffer = '';
    let bufferLine = 1;
    let line = 1;
    const addDeclaration = () => {
        const colon = buffer.indexOf(':');
        if (rule && colon > 0) {
            rule.declarations.push({ property: buffer.slice(0, colon).trim(), value: buffer.slice(colon + 1).trim().replace(/\s+/g, ' '), line: bufferLine });
        }
        buffer = '';
    };
    for (const char of text) {
        if (char === '\n') line++;
        if (char === '{') {
            const prelude = buffer.trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ');
            if (NESTING_AT_RULE.test(prelude)) {
                contexts.push(prelude);
            } else {
                rule = { selector: prelude, context: contexts.join(' '), declarations: [], line: bufferLine };
                rules.push(rule);
            }
            buffer = '';
        } else if (char === '}') {
            if (rule) {
                addDeclaration();
                rule = null;
            } else {
                contexts.pop();
                buffer = '';
            }
        } else if (char === ';' && rule) {
            addDeclaration();
        } else {
            if (buffer.trim() === '' && char.trim() !== '') bufferLine = line;
            buffer += char;
        }
    }
    return rules;
}

/**
 * Custom properties of every :root rule.
 *
 * @param {string} css -> Stylesheet source.
 * @returns {Map<string, string>} -> Token name -> value as written.
 */
function readTokens(css) {
    const tokens = new Map();
    for (const rule of parseRules(css)) {
        if (rule.selector !== ':root') continue;
        for (const { property, value } of rule.declarations) {
            if (property.startsWith('--')) tokens.set(property, value);
        }
    }
    return tokens;
}

module.exports = { readCss, stripComments, parseRules, readTokens };
```

Run: `node --test test/cssSource.test.js`
Expected: PASS, 4 Tests.

- [ ] **Step 4: Failing tests für Tokens und Ladereihenfolge**

`test/designTokens.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');
const { readCss, readTokens } = require('./cssSource');

const TOKENS = readTokens(readCss('tokens.css'));
const CONTRAST_FILE = path.join(REPO_ROOT, 'public', 'js', 'core', 'contrast.js');

const REQUIRED = [
    '--bg-primary', '--bg-secondary', '--bg-card', '--bg-glass', '--bg-glass-hover', '--bg-tint-1', '--bg-tint-2', '--bg-tint-3', '--bg-inset', '--bg-scrim',
    '--text-primary', '--text-secondary', '--text-muted',
    '--border-subtle', '--border-strong', '--border-accent',
    '--accent', '--accent-light', '--accent-dark', '--accent-text', '--accent-fill', '--accent-fill-hover', '--on-accent', '--accent-tint-1', '--accent-tint-2', '--accent-glow',
    '--success', '--success-bg', '--success-border', '--success-fill', '--on-success',
    '--warning', '--warning-bg', '--warning-border', '--warning-fill', '--on-warning',
    '--danger', '--danger-bg', '--danger-border', '--danger-fill', '--danger-fill-hover', '--on-danger',
    '--info', '--info-bg', '--info-border', '--info-fill', '--on-info',
    '--discord', '--discord-hover', '--on-discord',
    '--font-body', '--font-logo',
    '--font-size-xs', '--font-size-sm', '--font-size-md', '--font-size-lg', '--font-size-xl', '--font-size-2xl', '--font-size-3xl', '--font-size-4xl', '--font-size-display', '--font-size-logo',
    '--space-4', '--space-8', '--space-12', '--space-16', '--space-24', '--space-32', '--space-48', '--space-64',
    '--radius-sm', '--radius', '--radius-lg', '--radius-pill',
    '--z-dropdown', '--z-sticky', '--z-nav', '--z-banner', '--z-dialog', '--z-toast', '--z-overlay',
    '--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-glow', '--shadow-ring',
    '--duration-fast', '--duration-base', '--duration-slow', '--ease-standard', '--transition'
];

// Tokens whose value must be one plain colour
const COLOR_TOKEN = /^--(bg-|text-|border-|accent|on-|success|warning|danger|info|discord)/;
// --bg-glass and --bg-glass-hover are translucent and lie on the page background
const BASE_SURFACES = ['--bg-primary', '--bg-secondary', '--bg-card', '--bg-glass', '--bg-glass-hover'];
const TEXT_COLORS = ['--text-primary', '--text-secondary', '--text-muted', '--accent-text', '--success', '--warning', '--danger', '--info'];
const STRONG_TEXT = ['--text-primary', '--text-secondary'];
const OWN_TINT = { '--success': '--success-bg', '--warning': '--warning-bg', '--danger': '--danger-bg', '--info': '--info-bg', '--accent-text': '--accent-tint-2' };
const FILLS = {
    '--on-accent': ['--accent-fill', '--accent-fill-hover'],
    '--on-success': ['--success-fill'],
    '--on-warning': ['--warning-fill'],
    '--on-info': ['--info-fill'],
    '--on-danger': ['--danger-fill', '--danger-fill-hover'],
    '--on-discord': ['--discord', '--discord-hover']
};
const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

/**
 * Contrast helpers bound to the tokens: color(name), surface(base), on(tint, base), ratio(text, background).
 */
async function loadPalette() {
    const { parseColor, composite, contrastRatio } = (await loadFrontendModules(CONTRAST_FILE, vm.createContext({}))).get('contrast.js');
    const color = (name) => {
        const parsed = parseColor(TOKENS.get(name));
        assert.ok(parsed, `${name} is not a plain colour: ${TOKENS.get(name)}`);
        return parsed;
    };
    const surface = (base) => composite(color(base), color('--bg-primary'));
    const on = (tint, base) => composite(color(tint), surface(base));
    const ratio = (text, background) => contrastRatio(color(text), background);
    return { parseColor, color, surface, on, ratio };
}

const tooLow = (label, value, minimum) => (value < minimum ? [`${label}: ${value.toFixed(2)} < ${minimum}`] : []);

test('every required token is defined', () => {
    assert.deepEqual(REQUIRED.filter(name => !TOKENS.has(name)), []);
});

test('every colour token is one plain colour the contrast check can read', async () => {
    const { parseColor } = await loadPalette();
    const unreadable = [...TOKENS].filter(([name, value]) => COLOR_TOKEN.test(name) && !parseColor(value)).map(([name, value]) => `${name}: ${value}`);
    assert.deepEqual(unreadable, []);
});

test('every text colour reaches AA contrast on every surface and on the light tint', async () => {
    const { surface, on, ratio } = await loadPalette();
    const failures = [];
    for (const base of BASE_SURFACES) {
        for (const text of TEXT_COLORS) {
            failures.push(...tooLow(`${text} on ${base}`, ratio(text, surface(base)), AA_TEXT));
            failures.push(...tooLow(`${text} on --bg-tint-1 over ${base}`, ratio(text, on('--bg-tint-1', base)), AA_TEXT));
        }
    }
    assert.deepEqual(failures, []);
});

test('primary and secondary text reach AA contrast on the stronger tints', async () => {
    const { on, ratio } = await loadPalette();
    const failures = [];
    for (const base of BASE_SURFACES) {
        for (const text of STRONG_TEXT) {
            for (const tint of ['--bg-tint-2', '--bg-tint-3']) {
                failures.push(...tooLow(`${text} on ${tint} over ${base}`, ratio(text, on(tint, base)), AA_TEXT));
            }
        }
    }
    assert.deepEqual(failures, []);
});

test('status and accent text reach AA contrast on their own tint', async () => {
    const { on, ratio } = await loadPalette();
    const failures = [];
    for (const base of BASE_SURFACES) {
        for (const [text, tint] of Object.entries(OWN_TINT)) {
            failures.push(...tooLow(`${text} on ${tint} over ${base}`, ratio(text, on(tint, base)), AA_TEXT));
        }
    }
    assert.deepEqual(failures, []);
});

test('text on solid fills reaches AA contrast', async () => {
    const { color, ratio } = await loadPalette();
    const failures = [];
    for (const [text, fills] of Object.entries(FILLS)) {
        for (const fill of fills) failures.push(...tooLow(`${text} on ${fill}`, ratio(text, color(fill)), AA_TEXT));
    }
    assert.deepEqual(failures, []);
});

test('the brand violet reaches 3:1 as a non-text colour', async () => {
    const { surface, ratio } = await loadPalette();
    assert.deepEqual(BASE_SURFACES.flatMap(base => tooLow(`--accent on ${base}`, ratio('--accent', surface(base)), AA_NON_TEXT)), []);
});

test('spacing names are pixel sizes and layers rise in order', () => {
    for (const [name, value] of TOKENS) {
        const space = /^--space-(\d+)$/.exec(name);
        if (space) assert.equal(value, `${Number(space[1]) / 16}rem`, name);
    }
    const layers = ['--z-dropdown', '--z-sticky', '--z-nav', '--z-banner', '--z-dialog', '--z-toast', '--z-overlay'].map(name => TOKENS.get(name));
    for (const value of layers) assert.match(String(value), /^\d+$/);
    assert.deepEqual(layers.map(Number), [...layers.map(Number)].sort((a, b) => a - b));
});
```

`test/cssRules.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { frontendSources, REPO_ROOT } = require('./helpers');
const { readCss, parseRules } = require('./cssSource');

const CSS_DIR = path.join(REPO_ROOT, 'public', 'css');
const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
// Stylesheets that build on the tokens and must not contain raw values
const STYLED = ['components.css', 'style.css'].filter(name => fs.existsSync(path.join(CSS_DIR, name)));
// Stylesheets in the order index.html must load them
const LOAD_ORDER = ['/vendor/bootstrap/bootstrap.min.css', '/css/tokens.css?v=3', '/css/style.css?v=3'];

const rulesOf = (name) => parseRules(readCss(name)).map(rule => ({ ...rule, file: name }));
const allRules = () => STYLED.flatMap(rulesOf);

test('index.html loads Bootstrap, the tokens and the DEMS styles in this order', () => {
    const hrefs = [...INDEX_HTML.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"/g)].map(match => match[1]);
    const positions = LOAD_ORDER.map(href => hrefs.indexOf(href));
    assert.ok(positions.every(position => position !== -1), `missing stylesheet link, found: ${hrefs.join(', ')}`);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test('only tokens.css defines :root variables', () => {
    assert.deepEqual(allRules().filter(rule => rule.selector === ':root').map(rule => `${rule.file}:${rule.line}`), []);
});

test('the logo font is only used by the logo', () => {
    const users = allRules().filter(rule => rule.declarations.some(declaration => declaration.value.includes('--font-logo'))).map(rule => rule.selector);
    assert.equal(users.length, 2, users.join(' | '));
    for (const selector of users) assert.match(selector, /\.(loading-logo|brand-text)$/);
    const sources = [INDEX_HTML, ...STYLED.map(readCss), ...frontendSources().map(entry => entry.source)];
    for (const source of sources) assert.doesNotMatch(source, /--font-display/);
});
```

- [ ] **Step 5: Tests laufen rot**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/designTokens.test.js test/cssRules.test.js`
Expected: FAIL. `designTokens` mit `ENOENT … tokens.css`, `cssRules` mit `missing stylesheet link`.

- [ ] **Step 6: `public/css/tokens.css` anlegen**

```css
/* ═══════════════════════════════════════════ */
/* DEMS — Design tokens (dark scheme)          */
/* The only stylesheet that may contain colour */
/* values, font sizes and layer numbers.       */
/* Rules: docs/wiki/modules/frontend-markup.md */
/* ═══════════════════════════════════════════ */

:root {
  /* Surfaces */
  --bg-primary: #0a0a0f;
  --bg-secondary: #12121a;
  --bg-card: #16161f;
  --bg-glass: rgba(22, 22, 31, 0.85);
  --bg-glass-hover: rgba(30, 30, 45, 0.9);
  --bg-tint-1: rgba(255, 255, 255, 0.04);
  --bg-tint-2: rgba(255, 255, 255, 0.08);
  --bg-tint-3: rgba(255, 255, 255, 0.12);
  --bg-inset: rgba(0, 0, 0, 0.25);
  --bg-scrim: rgba(10, 10, 15, 0.9);

  /* Text */
  --text-primary: #e4e4e7;
  --text-secondary: #a1a1aa;
  --text-muted: #8f8f9a;

  /* Borders */
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-strong: rgba(255, 255, 255, 0.14);
  --border-accent: rgba(139, 92, 246, 0.3);

  /* Accent: --accent is the brand colour for borders, icons and glows.
     Violet text uses --accent-text, white text sits on --accent-fill. */
  --accent: #8b5cf6;
  --accent-light: #a78bfa;
  --accent-dark: #6d28d9;
  --accent-text: #a78bfa;
  --accent-fill: #7c3aed;
  --accent-fill-hover: #6d28d9;
  --on-accent: #ffffff;
  --accent-tint-1: rgba(139, 92, 246, 0.08);
  --accent-tint-2: rgba(139, 92, 246, 0.15);
  --accent-glow: rgba(139, 92, 246, 0.4);

  /* Status: text colour, tint, border, solid fill, text on the fill */
  --success: #22c55e;
  --success-bg: rgba(34, 197, 94, 0.15);
  --success-border: rgba(34, 197, 94, 0.3);
  --success-fill: #22c55e;
  --on-success: #0a0a0f;
  --warning: #eab308;
  --warning-bg: rgba(234, 179, 8, 0.15);
  --warning-border: rgba(234, 179, 8, 0.3);
  --warning-fill: #eab308;
  --on-warning: #0a0a0f;
  --danger: #f87171;
  --danger-bg: rgba(239, 68, 68, 0.15);
  --danger-border: rgba(239, 68, 68, 0.3);
  --danger-fill: #dc2626;
  --danger-fill-hover: #b91c1c;
  --on-danger: #ffffff;
  --info: #06b6d4;
  --info-bg: rgba(6, 182, 212, 0.15);
  --info-border: rgba(6, 182, 212, 0.3);
  --info-fill: #06b6d4;
  --on-info: #0a0a0f;

  /* Discord brand */
  --discord: #5865f2;
  --discord-hover: #4752c4;
  --on-discord: #ffffff;

  /* Typography */
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-logo: 'UnifrakturCook', cursive;
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  --font-size-md: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.25rem;
  --font-size-2xl: 1.5rem;
  --font-size-3xl: 2rem;
  --font-size-4xl: 2.5rem;
  --font-size-display: clamp(2.5rem, 7vw, 4.5rem);
  --font-size-logo: clamp(3rem, 8vw, 6rem);

  /* Spacing: the name is the size in pixels */
  --space-4: 0.25rem;
  --space-8: 0.5rem;
  --space-12: 0.75rem;
  --space-16: 1rem;
  --space-24: 1.5rem;
  --space-32: 2rem;
  --space-48: 3rem;
  --space-64: 4rem;

  /* Radius */
  --radius-sm: 8px;
  --radius: 12px;
  --radius-lg: 16px;
  --radius-pill: 999px;

  /* Layers, aligned with Bootstrap's z-index scale */
  --z-dropdown: 1000;
  --z-sticky: 1020;
  --z-nav: 1030;
  --z-banner: 1040;
  --z-dialog: 1055;
  --z-toast: 1090;
  --z-overlay: 2000;

  /* Shadows */
  --shadow-sm: 0 4px 15px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 20px 60px rgba(0, 0, 0, 0.5);
  --shadow-glow: 0 0 30px rgba(139, 92, 246, 0.15);
  --shadow-ring: 0 0 0 3px var(--accent-glow);

  /* Motion */
  --duration-fast: 150ms;
  --duration-base: 300ms;
  --duration-slow: 600ms;
  --ease-standard: cubic-bezier(0.4, 0, 0.2, 1);
  --transition: all var(--duration-base) var(--ease-standard);
}
```

- [ ] **Step 7: `:root` aus `style.css` nehmen, Logo-Schrift umbenennen**

In `public/css/style.css` die Zeilen 1–30 (Kopf-Banner und der ganze `:root { … }`-Block) ersetzen durch:
```css
/* ═══════════════════════════════════════════ */
/* DEMS — Page styles                          */
/* Tokens: tokens.css                          */
/* Components: components.css                  */
/* ═══════════════════════════════════════════ */
```

Dann die vier Stellen mit `var(--font-display)` ändern (`grep -n 'font-display' public/css/style.css` zeigt sie):

| Regel | Neu |
|---|---|
| `.loading-logo` | `font-family: var(--font-logo);` |
| `.brand-text` | `font-family: var(--font-logo) !important;` |
| `.info-title` (zweimal, der Block ist noch doppelt) | `font-family: var(--font-body);` |

- [ ] **Step 8: Stylesheets in `index.html` verlinken**

In `public/index.html` ersetzen:
```html
  <!-- Custom CSS -->
  <link rel="stylesheet" href="/css/style.css?v=2">
```
durch:
```html
  <!-- DEMS styles: tokens -> page styles (the order matters) -->
  <link rel="stylesheet" href="/css/tokens.css?v=3">
  <link rel="stylesheet" href="/css/style.css?v=3">
```

- [ ] **Step 9: Tests laufen grün**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/designTokens.test.js test/cssRules.test.js test/cssSource.test.js`
Expected: PASS, 15 Tests.

- [ ] **Step 10: Sichtprüfung per Vergleich**

```bash
node scripts/style-snapshot.js --out data/d02/t3.json
node scripts/style-snapshot.js --compare data/d02/before.json data/d02/t3.json
```
Expected: `0 removed, 0 added`. Die Gruppen betreffen nur `color`, `border-top-color`, `background-color` und `font-family`:
- `rgb(113, 113, 122) -> rgb(143, 143, 154)` (Hilfetext)
- `rgb(239, 68, 68) -> rgb(248, 113, 113)` (Gefahr als Text, Rahmen oder Balken)
- `font-family` von `UnifrakturCook, cursive` auf die Inter-Liste, nur bei `h1.info-title`

Jede andere Gruppe ist ein Fehler aus Step 7 und wird behoben, bevor es weitergeht.

- [ ] **Step 11: Wiki nachziehen**

In `docs/wiki/modules/frontend-markup.md`:
- Frontmatter `sources:` um `public/css/tokens.css` ergänzen.
- In der Zeile `| \`<head>\` | …` das Ende `then \`/css/style.css?v=2\`` ersetzen durch `` then `/css/tokens.css?v=3` and `/css/style.css?v=3` ``.
- In der Zeile `| \`fonts/\` | …` `` `--font-display` `` ersetzen durch `` `--font-logo` ``.
- Die Überschrift ``## Theme variables (`:root`)`` ersetzen durch ``## Theme variables (`public/css/tokens.css`)`` und im Absatz darunter `` `--font-display` (UnifrakturCook) `` durch `` `--font-logo` (UnifrakturCook, logo only) ``.
- In der TL;DR-Zeile `driven by CSS variables in \`:root\`` ersetzen durch `` driven by the design tokens in `tokens.css` ``.

Run: `npm run wiki`

- [ ] **Step 12: Commit**

```bash
npm test 2>&1 | tail -8
npm run test:e2e 2>&1 | tail -6
git add public/css/tokens.css public/css/style.css public/index.html test/cssSource.js test/cssSource.test.js test/designTokens.test.js test/cssRules.test.js docs/wiki
git commit -m "Move the theme variables into tokens.css and add the missing tokens

Only colours, fonts and radius were variables. The new file adds
spacing, font sizes, layers, shadows, motion and five tokens per
status, and a test keeps every text colour at AA contrast on every
surface. Muted and danger text get lighter to reach 4.5:1, and the
display font is renamed to --font-logo because only the logo may use it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 55 doppelte Selektoren zusammenführen

**Files:**
- Create: `data/d02/dedupe.js` (Einmal-Skript, nicht im Repo)
- Modify: `public/css/style.css`
- Modify: `test/cssRules.test.js`
- Modify: `docs/wiki/reference/known-issues.md`, `docs/wiki/modules/frontend-markup.md`

**Interfaces:**
- Consumes: `stripComments`, `parseRules` aus `test/cssSource.js` (Task 3)
- Produces: `style.css` ohne doppelte Selektorlisten. Die zusammengeführte Regel steht an der Stelle der späteren Definition.

Ausgangslage (gemessen): 511 Regeln, 55 Selektorlisten stehen auf oberster Ebene zweimal (Profil-Block, Info-Block, `.badge-pill`), keine dreimal, keine doppelte innerhalb von `@media`.

- [ ] **Step 1: Failing test schreiben**

An `test/cssRules.test.js` anhängen:
```js
test('no selector list is defined twice in the same context', () => {
    const seen = new Map();
    const duplicates = [];
    for (const rule of allRules()) {
        // Steps like "0%, 100%" repeat in every animation by design
        if (rule.context.includes('@keyframes')) continue;
        const key = `${rule.context} | ${rule.selector}`;
        const place = `${rule.file}:${rule.line}`;
        if (seen.has(key)) duplicates.push(`${rule.selector} (${seen.get(key)} and ${place})`);
        else seen.set(key, place);
    }
    assert.deepEqual(duplicates, []);
});
```

Run: `node --test test/cssRules.test.js`
Expected: FAIL, die Liste nennt 55 Einträge, der erste ist `.badge-pill`.

- [ ] **Step 2: Einmal-Skript schreiben**

`data/d02/dedupe.js`:
```js
// One-off codemod for D-02 (not committed): merges selector lists that are
// defined twice at the top level of public/css/style.css. The merged rule
// stays where the later definition was; per property the later value wins,
// properties that only the earlier rule had are kept in front.
const fs = require('fs');
const path = require('path');
const { stripComments } = require('../../test/cssSource');

const FILE = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const source = fs.readFileSync(FILE, 'utf8');
const masked = stripComments(source);

// Top-level blocks (rules and at-rules) with their position in the file
const blocks = [];
let depth = 0;
let start = -1;
let open = -1;
for (let i = 0; i < masked.length; i++) {
    const char = masked[i];
    if (depth === 0 && start === -1 && !/\s/.test(char)) start = i;
    if (char === '{') {
        if (depth === 0) open = i;
        depth++;
    } else if (char === '}') {
        depth--;
        if (depth === 0) {
            blocks.push({ start, open, end: i, prelude: masked.slice(start, open).trim().replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ') });
            start = -1;
        }
    }
}

const declarationsOf = (block) => masked.slice(block.open + 1, block.end).split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const colon = part.indexOf(':');
    const value = part.slice(colon + 1).trim().replace(/\s+/g, ' ');
    return { property: part.slice(0, colon).trim(), value, important: /!important$/.test(value) };
});

// selector list -> block that holds its declarations so far
const latest = new Map();
let merged = 0;
for (const block of blocks) {
    if (block.prelude.startsWith('@')) continue;
    block.declarations = declarationsOf(block);
    const earlier = latest.get(block.prelude);
    if (earlier) {
        const laterByProperty = new Map(block.declarations.map(declaration => [declaration.property, declaration]));
        const kept = [];
        for (const declaration of earlier.declarations) {
            const later = laterByProperty.get(declaration.property);
            if (!later) {
                kept.push(declaration);
            } else if (declaration.important && !later.important) {
                // An earlier !important beats a later plain declaration
                kept.push(declaration);
                block.declarations = block.declarations.filter(candidate => candidate !== later);
            }
        }
        block.declarations = [...kept, ...block.declarations];
        block.rewritten = true;
        earlier.removed = true;
        merged++;
        console.log(`merged ${block.prelude}: kept ${kept.map(declaration => declaration.property).join(', ') || 'nothing'} from the earlier rule`);
    }
    latest.set(block.prelude, block);
}

let output = '';
let cursor = 0;
for (const block of blocks) {
    output += source.slice(cursor, block.start);
    if (block.rewritten && !block.removed) {
        const selector = source.slice(block.start, block.open).trimEnd();
        output += `${selector} {\n${block.declarations.map(declaration => `  ${declaration.property}: ${declaration.value};`).join('\n')}\n}`;
    } else if (!block.removed) {
        output += source.slice(block.start, block.end + 1);
    }
    cursor = block.end + 1;
}
output += source.slice(cursor);
fs.writeFileSync(FILE, output.replace(/\n{3,}/g, '\n\n'));
console.log(`${merged} duplicate rule(s) merged`);
```

- [ ] **Step 3: Skript ausführen**

Run: `node data/d02/dedupe.js | tail -3`
Expected: letzte Zeile `55 duplicate rule(s) merged`.

- [ ] **Step 4: Übrig gebliebene Regeln der alten Blöcke umziehen, leere Banner löschen**

Von den früheren Blöcken bleiben Regeln stehen, die es nur dort gab. Sie ziehen ans Ende des späteren Blocks mit demselben Namen, damit es jeden Abschnitt nur einmal gibt:

| Früherer Banner | Übrige Regeln (ganz ausschneiden) | Ziel |
|---|---|---|
| erster `PROFILE SECTION` | `.profile-badge-card.unlocked:hover`, `.profile-badge-card.unlocked .profile-badge-icon`, `@keyframes badgePulse` | ans Ende des zweiten `PROFILE SECTION`-Abschnitts, direkt vor den nächsten Banner |
| `INFO PARTICLES` | `.info-divider`, `.info-card:hover`, `.info-feature span`, `.info-data-divider` | ans Ende des Abschnitts `INFO SECTION`, direkt vor `/* Info Responsive */` |

Danach die drei Zeilen des ersten `PROFILE SECTION`-Banners, die verwaisten Kommentare `/* Profile Stats Grid */` und `/* Profile Badges Grid */` direkt darunter sowie den Banner `INFO PARTICLES` löschen. `/* Badge Pill status colors */` bleibt.

Leere Banner findet dieser Aufruf (ein Banner, auf den ohne Regel der nächste folgt):
```bash
node -e '
const lines = require("fs").readFileSync("public/css/style.css", "utf8").split("\n");
const isBar = (line) => /^\/\* ═+ \*\/$/.test((line || "").trim());
for (let i = 0; i < lines.length; i++) {
    if (!isBar(lines[i]) || !isBar(lines[i + 2])) continue;
    let next = i + 3;
    while (next < lines.length && lines[next].trim() === "") next++;
    if (isBar(lines[next]) && isBar(lines[next + 2])) console.log(`${i + 2}: ${lines[i + 1].trim()}`);
}'
```
Expected nach dem Aufräumen: höchstens `SCROLLBAR` (der Abschnitt war schon vorher leer). Auch diesen Banner löschen, dann gibt der Aufruf nichts mehr aus.

Run: `grep -c 'PROFILE SECTION' public/css/style.css`
Expected: `1`

- [ ] **Step 5: Test läuft grün**

Run: `node --test test/cssRules.test.js`
Expected: PASS, 4 Tests.

- [ ] **Step 6: Der Vergleich zeigt keine Abweichung**

```bash
node scripts/style-snapshot.js --out data/d02/t4.json
node scripts/style-snapshot.js --compare data/d02/t3.json data/d02/t4.json
```
Expected: `0 change group(s), 0 removed, 0 added`.

Zeigt der Vergleich doch eine Gruppe, hat eine Regel zwischen den beiden alten Positionen bisher eine Eigenschaft des früheren Blocks überschrieben. Dann in der genannten Regel (Label in der Ausgabe) die Eigenschaft suchen und sie aus der zusammengeführten Regel streichen, sodass wieder der bisherige Wert gilt. Vergleich wiederholen, bis er leer ist.

- [ ] **Step 7: Wiki nachziehen**

- `docs/wiki/reference/known-issues.md`: die Tabellenzeile `| 18 | "PROFILE SECTION" defined twice in \`style.css\` | … |` löschen.
- `docs/wiki/modules/frontend-markup.md`: unter `## Gotchas` die Zeile `- "PROFILE SECTION" exists twice in \`style.css\`; later rules win.` löschen. In der Liste unter `## style.css blocks` die Einträge `→ INFO PARTICLES` und `→ PROFILE SECTION (second block)` streichen.

Run: `npm run wiki`

- [ ] **Step 8: Commit**

```bash
npm test 2>&1 | tail -8
npm run test:e2e 2>&1 | tail -6
git add public/css/style.css test/cssRules.test.js docs/wiki
git commit -m "Merge the 55 selectors that style.css defined twice

The profile, info and badge blocks existed twice and the later copy
won per property, so a change in the first copy often had no effect.
Each selector now has one rule with the values that applied before; a
test fails when a selector list returns a second time.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `components.css` mit Bootstrap-Brücke, Button, Dialog und Tabs

**Files:**
- Create: `public/css/components.css`
- Modify: `public/css/style.css` (Block BUTTONS und Regel `.glass-modal` entfallen; `.nav-link`-Regeln auf `#main-navbar` begrenzen)
- Modify: `public/index.html` (Stylesheet-Link; Klasse `glass-modal` an 13 Stellen)
- Modify: `public/js` (Klasse `glass-modal` an 1 Stelle)
- Modify: `test/cssRules.test.js`
- Modify: `docs/wiki/modules/frontend-markup.md`

**Interfaces:**
- Consumes: Tokens aus Task 3
- Produces (Klassen):
  - Button: `.btn` mit `.btn-primary` (Zweitname `.btn-accent`), `.btn-secondary` (Zweitnamen `.btn-outline-light`, `.btn-outline-secondary`), `.btn-ghost`, `.btn-danger`, `.btn-discord`, `.btn-warning`, `.btn-outline-primary|success|warning|danger`; Größen `.btn-sm`, `.btn-lg`; `.btn-icon`
  - Dialog: `.modal` (Bootstrap-Markup unverändert)
  - Tabs: `.nav.nav-pills` mit `.nav-link` (Bootstrap-Markup, `data-bs-toggle="pill"`)
  - Farb-Helfer: `.text-primary|success|warning|danger|info`, `.bg-…` und `.text-bg-…` für `primary|success|warning|danger|info`
  - In `test/cssRules.test.js`: `selectorsOf(name): Set<string>` und die Liste `MOVED`, die spätere Tasks erweitern

- [ ] **Step 1: Failing tests schreiben**

In `test/cssRules.test.js` die Konstante `LOAD_ORDER` ersetzen:
```js
const LOAD_ORDER = ['/vendor/bootstrap/bootstrap.min.css', '/css/tokens.css?v=3', '/css/components.css?v=3', '/css/style.css?v=3'];
```

Unter `const allRules = …` einfügen:
```js
const selectorsOf = (name) => new Set(rulesOf(name).flatMap(rule => rule.selector.split(', ')));
// Selectors that components.css must define
const COMPONENT_SELECTORS = [
    '[data-bs-theme="dark"]', 'a',
    '.text-primary', '.text-success', '.text-warning', '.text-danger', '.text-info',
    '.bg-primary', '.text-bg-primary', '.bg-success', '.text-bg-success', '.bg-warning', '.text-bg-warning', '.bg-danger', '.text-bg-danger', '.bg-info', '.text-bg-info',
    '.btn', '.btn-primary', '.btn-accent', '.btn-secondary', '.btn-outline-light', '.btn-outline-secondary', '.btn-ghost', '.btn-danger', '.btn-discord', '.btn-warning',
    '.btn-outline-primary', '.btn-outline-success', '.btn-outline-warning', '.btn-outline-danger', '.btn-sm', '.btn-lg', '.btn-icon',
    '.modal', '.nav-pills', '.nav-pills .nav-link'
];
// Selectors that moved into components.css or were dropped; style.css must not style them again
const MOVED = ['.btn-accent', '.btn-accent:hover', '.btn-discord', '.btn-discord:hover', '.btn-outline-light', '.btn-outline-light:hover', '.glass-modal', '.nav-link', '.nav-link.active'];
```

Am Dateiende anhängen:
```js
test('components.css defines every component selector', () => {
    const defined = selectorsOf('components.css');
    assert.deepEqual(COMPONENT_SELECTORS.filter(selector => !defined.has(selector)), []);
});

test('style.css does not style moved component selectors again', () => {
    const page = selectorsOf('style.css');
    assert.deepEqual(MOVED.filter(selector => page.has(selector)), []);
});

test('!important in components.css is limited to the colour helpers', () => {
    const offenders = rulesOf('components.css')
        .filter(rule => rule.declarations.some(declaration => /!important$/.test(declaration.value)))
        .filter(rule => !rule.selector.split(', ').every(selector => /^\.(text|bg|text-bg)-[a-z]+$/.test(selector)))
        .map(rule => rule.selector);
    assert.deepEqual(offenders, []);
});

test('the dead class glass-modal is gone', () => {
    for (const source of [INDEX_HTML, ...frontendSources().map(entry => entry.source)]) assert.doesNotMatch(source, /glass-modal/);
});
```

Run: `node --test test/cssRules.test.js`
Expected: FAIL (`ENOENT … components.css` bzw. `missing stylesheet link`).

- [ ] **Step 2: `public/css/components.css` anlegen**

```css
/* ═══════════════════════════════════════════ */
/* DEMS — Components                           */
/* Bootstrap bridge and the nine components.   */
/* Every value comes from tokens.css.          */
/* Shown in the styleguide (#debug).           */
/* ═══════════════════════════════════════════ */

/* ═══════════════════════════════════════════ */
/* BOOTSTRAP BRIDGE                            */
/* ═══════════════════════════════════════════ */
[data-bs-theme="dark"] {
  --bs-body-bg: var(--bg-primary);
  --bs-body-color: var(--text-primary);
  --bs-body-font-family: var(--font-body);
  --bs-secondary-color: var(--text-secondary);
  --bs-tertiary-color: var(--text-muted);
  --bs-border-color: var(--border-strong);
  --bs-border-radius: var(--radius-sm);
  --bs-border-radius-sm: var(--radius-sm);
  --bs-border-radius-lg: var(--radius-lg);
  --bs-border-radius-pill: var(--radius-pill);
}

a {
  color: var(--accent-text);
}

/* Bootstrap's colour helpers carry !important, so these need it too */
.text-primary {
  color: var(--accent-text) !important;
}

.text-success {
  color: var(--success) !important;
}

.text-warning {
  color: var(--warning) !important;
}

.text-danger {
  color: var(--danger) !important;
}

.text-info {
  color: var(--info) !important;
}

.bg-primary,
.text-bg-primary {
  background-color: var(--accent-fill) !important;
  color: var(--on-accent) !important;
}

.bg-success,
.text-bg-success {
  background-color: var(--success-fill) !important;
  color: var(--on-success) !important;
}

.bg-warning,
.text-bg-warning {
  background-color: var(--warning-fill) !important;
  color: var(--on-warning) !important;
}

.bg-danger,
.text-bg-danger {
  background-color: var(--danger-fill) !important;
  color: var(--on-danger) !important;
}

.bg-info,
.text-bg-info {
  background-color: var(--info-fill) !important;
  color: var(--on-info) !important;
}

.alert-success {
  --bs-alert-color: var(--success);
  --bs-alert-bg: var(--success-bg);
  --bs-alert-border-color: var(--success-border);
  --bs-alert-link-color: var(--success);
}

.alert-warning {
  --bs-alert-color: var(--warning);
  --bs-alert-bg: var(--warning-bg);
  --bs-alert-border-color: var(--warning-border);
  --bs-alert-link-color: var(--warning);
}

.alert-danger {
  --bs-alert-color: var(--danger);
  --bs-alert-bg: var(--danger-bg);
  --bs-alert-border-color: var(--danger-border);
  --bs-alert-link-color: var(--danger);
}

.alert-info {
  --bs-alert-color: var(--info);
  --bs-alert-bg: var(--info-bg);
  --bs-alert-border-color: var(--info-border);
  --bs-alert-link-color: var(--info);
}

/* ═══════════════════════════════════════════ */
/* BUTTON                                      */
/* .btn + one variant; sizes .btn-sm, .btn-lg  */
/* ═══════════════════════════════════════════ */
.btn {
  --bs-btn-padding-x: var(--space-16);
  --bs-btn-padding-y: var(--space-4);
  --bs-btn-font-size: var(--font-size-md);
  --bs-btn-font-weight: 600;
  --bs-btn-border-radius: var(--radius);
  --bs-btn-disabled-opacity: 0.5;
  --bs-btn-focus-box-shadow: var(--shadow-ring);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.5rem;
  transition: background-color var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard);
}

.btn-sm {
  --bs-btn-padding-x: var(--space-12);
  --bs-btn-font-size: var(--font-size-sm);
  --bs-btn-border-radius: var(--radius-sm);
  min-height: 2rem;
}

.btn-lg {
  --bs-btn-padding-x: var(--space-24);
  --bs-btn-font-size: var(--font-size-lg);
  --bs-btn-border-radius: var(--radius);
  min-height: 3rem;
}

/* Square button for a single icon */
.btn-icon {
  --bs-btn-padding-x: 0;
  width: 2.5rem;
}

.btn-icon.btn-sm {
  width: 2rem;
}

.btn-icon.btn-lg {
  width: 3rem;
}

/* Primary: the one main action of a view. .btn-accent is the old name. */
.btn-primary,
.btn-accent {
  --bs-btn-color: var(--on-accent);
  --bs-btn-bg: var(--accent-fill);
  --bs-btn-border-color: var(--accent-fill);
  --bs-btn-hover-color: var(--on-accent);
  --bs-btn-hover-bg: var(--accent-fill-hover);
  --bs-btn-hover-border-color: var(--accent-fill-hover);
  --bs-btn-active-color: var(--on-accent);
  --bs-btn-active-bg: var(--accent-fill-hover);
  --bs-btn-active-border-color: var(--accent-fill-hover);
  --bs-btn-disabled-color: var(--on-accent);
  --bs-btn-disabled-bg: var(--accent-fill);
  --bs-btn-disabled-border-color: var(--accent-fill);
}

/* Secondary: every other action. The outline names are the old ones. */
.btn-secondary,
.btn-outline-light,
.btn-outline-secondary {
  --bs-btn-color: var(--text-primary);
  --bs-btn-bg: var(--bg-tint-1);
  --bs-btn-border-color: var(--border-strong);
  --bs-btn-hover-color: var(--text-primary);
  --bs-btn-hover-bg: var(--bg-tint-2);
  --bs-btn-hover-border-color: var(--border-accent);
  --bs-btn-active-color: var(--text-primary);
  --bs-btn-active-bg: var(--bg-tint-3);
  --bs-btn-active-border-color: var(--border-accent);
  --bs-btn-disabled-color: var(--text-secondary);
  --bs-btn-disabled-bg: var(--bg-tint-1);
  --bs-btn-disabled-border-color: var(--border-subtle);
}

/* Ghost: quiet actions and icon buttons such as a "more" menu */
.btn-ghost {
  --bs-btn-color: var(--text-secondary);
  --bs-btn-bg: transparent;
  --bs-btn-border-color: transparent;
  --bs-btn-hover-color: var(--text-primary);
  --bs-btn-hover-bg: var(--bg-tint-2);
  --bs-btn-hover-border-color: transparent;
  --bs-btn-active-color: var(--text-primary);
  --bs-btn-active-bg: var(--bg-tint-3);
  --bs-btn-active-border-color: transparent;
  --bs-btn-disabled-color: var(--text-muted);
  --bs-btn-disabled-bg: transparent;
  --bs-btn-disabled-border-color: transparent;
}

.btn-danger {
  --bs-btn-color: var(--on-danger);
  --bs-btn-bg: var(--danger-fill);
  --bs-btn-border-color: var(--danger-fill);
  --bs-btn-hover-color: var(--on-danger);
  --bs-btn-hover-bg: var(--danger-fill-hover);
  --bs-btn-hover-border-color: var(--danger-fill-hover);
  --bs-btn-active-color: var(--on-danger);
  --bs-btn-active-bg: var(--danger-fill-hover);
  --bs-btn-active-border-color: var(--danger-fill-hover);
  --bs-btn-disabled-color: var(--on-danger);
  --bs-btn-disabled-bg: var(--danger-fill);
  --bs-btn-disabled-border-color: var(--danger-fill);
}

.btn-discord {
  --bs-btn-color: var(--on-discord);
  --bs-btn-bg: var(--discord);
  --bs-btn-border-color: var(--discord);
  --bs-btn-hover-color: var(--on-discord);
  --bs-btn-hover-bg: var(--discord-hover);
  --bs-btn-hover-border-color: var(--discord-hover);
  --bs-btn-active-color: var(--on-discord);
  --bs-btn-active-bg: var(--discord-hover);
  --bs-btn-active-border-color: var(--discord-hover);
  --bs-btn-disabled-color: var(--on-discord);
  --bs-btn-disabled-bg: var(--discord);
  --bs-btn-disabled-border-color: var(--discord);
}

.btn-warning {
  --bs-btn-color: var(--on-warning);
  --bs-btn-bg: var(--warning-fill);
  --bs-btn-border-color: var(--warning-fill);
  --bs-btn-hover-color: var(--on-warning);
  --bs-btn-hover-bg: var(--warning-fill);
  --bs-btn-hover-border-color: var(--warning-fill);
  --bs-btn-active-color: var(--on-warning);
  --bs-btn-active-bg: var(--warning-fill);
  --bs-btn-active-border-color: var(--warning-fill);
  --bs-btn-disabled-color: var(--on-warning);
  --bs-btn-disabled-bg: var(--warning-fill);
  --bs-btn-disabled-border-color: var(--warning-fill);
}

.btn-warning:hover {
  filter: brightness(1.08);
}

/* Outline variants in a status colour; each sets its three tones below */
.btn-outline-primary,
.btn-outline-success,
.btn-outline-warning,
.btn-outline-danger {
  --bs-btn-color: var(--btn-tone);
  --bs-btn-bg: transparent;
  --bs-btn-border-color: var(--btn-tone-border);
  --bs-btn-hover-color: var(--btn-tone);
  --bs-btn-hover-bg: var(--btn-tone-bg);
  --bs-btn-hover-border-color: var(--btn-tone);
  --bs-btn-active-color: var(--btn-tone);
  --bs-btn-active-bg: var(--btn-tone-bg);
  --bs-btn-active-border-color: var(--btn-tone);
  --bs-btn-disabled-color: var(--btn-tone);
  --bs-btn-disabled-bg: transparent;
  --bs-btn-disabled-border-color: var(--btn-tone-border);
}

.btn-outline-primary {
  --btn-tone: var(--accent-text);
  --btn-tone-bg: var(--accent-tint-2);
  --btn-tone-border: var(--border-accent);
}

.btn-outline-success {
  --btn-tone: var(--success);
  --btn-tone-bg: var(--success-bg);
  --btn-tone-border: var(--success-border);
}

.btn-outline-warning {
  --btn-tone: var(--warning);
  --btn-tone-bg: var(--warning-bg);
  --btn-tone-border: var(--warning-border);
}

.btn-outline-danger {
  --btn-tone: var(--danger);
  --btn-tone-bg: var(--danger-bg);
  --btn-tone-border: var(--danger-border);
}

/* ═══════════════════════════════════════════ */
/* DIALOG                                      */
/* Bootstrap .modal markup, unchanged          */
/* ═══════════════════════════════════════════ */
.modal {
  --bs-modal-bg: var(--bg-secondary);
  --bs-modal-color: var(--text-primary);
  --bs-modal-border-color: var(--border-strong);
  --bs-modal-border-radius: var(--radius-lg);
  --bs-modal-inner-border-radius: calc(var(--radius-lg) - 1px);
  --bs-modal-header-border-color: var(--border-subtle);
  --bs-modal-footer-border-color: var(--border-subtle);
  --bs-modal-box-shadow: var(--shadow-lg);
  --bs-modal-zindex: var(--z-dialog);
}

/* ═══════════════════════════════════════════ */
/* TABS                                        */
/* .nav.nav-pills as segments; scrolls         */
/* sideways when the entries do not fit        */
/* ═══════════════════════════════════════════ */
.nav-pills {
  --bs-nav-link-color: var(--text-secondary);
  --bs-nav-link-hover-color: var(--text-primary);
  --bs-nav-link-padding-x: var(--space-16);
  --bs-nav-link-padding-y: var(--space-8);
  --bs-nav-link-font-size: var(--font-size-sm);
  --bs-nav-link-font-weight: 500;
  --bs-nav-pills-border-radius: var(--radius-sm);
  --bs-nav-pills-link-active-color: var(--text-primary);
  --bs-nav-pills-link-active-bg: var(--accent-tint-2);
  display: inline-flex;
  flex-wrap: nowrap;
  gap: var(--space-4);
  max-width: 100%;
  overflow-x: auto;
  padding: var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--bg-tint-1);
}

.nav-pills .nav-link {
  display: inline-flex;
  align-items: center;
  gap: var(--space-8);
  white-space: nowrap;
}
```

- [ ] **Step 3: Stylesheet verlinken**

In `public/index.html` zwischen `tokens.css` und `style.css` einfügen und den Kommentar anpassen:
```html
  <!-- DEMS styles: tokens -> components -> page styles (the order matters) -->
  <link rel="stylesheet" href="/css/tokens.css?v=3">
  <link rel="stylesheet" href="/css/components.css?v=3">
  <link rel="stylesheet" href="/css/style.css?v=3">
```

- [ ] **Step 4: Alte Button- und Dialog-Regeln aus `style.css` nehmen**

In `public/css/style.css`:
- Den ganzen Block `BUTTONS` löschen (Banner, `.btn-discord`, `.btn-discord:hover`, `.btn-accent`, `.btn-accent:hover`, `.btn-outline-light`, `.btn-outline-light:hover`).
- Im Block `GLASS CARDS` die Regel `.glass-modal { … }` löschen.

Jede Verwendung von `btn-accent` und `btn-discord` trägt auch `btn` (geprüft). Kontrolle:
```bash
grep -rnoE 'class="[^"]*btn-(accent|discord)[^"]*"' public/index.html public/js | grep -v -E 'class="([^"]* )?btn( |")'
```
Expected: keine Ausgabe.

- [ ] **Step 5: Klasse `glass-modal` aus dem Markup nehmen**

```bash
grep -rn 'glass-modal' public/index.html public/js | wc -l
```
Expected: `14`. An jeder Stelle ` glass-modal` aus dem `class`-Attribut streichen (`class="modal-content glass-modal"` wird `class="modal-content"`).

Run: `grep -rn 'glass-modal' public | wc -l`
Expected: `0`

- [ ] **Step 6: Navbar-Links auf die Navbar begrenzen**

Die Regeln für `.nav-link` in `style.css` gelten bisher für jedes `.nav-link` und würden die Tabs überschreiben. Erst prüfen, dass alle Verwendungen in der Navbar liegen:
```bash
grep -n 'nav-link' public/index.html
grep -n -E 'id="main-navbar"|</nav>' public/index.html
grep -rn 'nav-link' public/js
```
Expected: Alle Treffer in `index.html` liegen zwischen `<nav … id="main-navbar">` und dem ersten `</nav>`; der Treffer in `public/js` wählt Navbar-Links aus (`#navContent` oder `.navbar`).

Dann im Block `NAVBAR` ersetzen:
```css
.nav-link {
  color: var(--text-secondary) !important;
  font-weight: 500;
  transition: var(--transition);
  position: relative;
  padding: 0.5rem 1rem !important;
}

.nav-link:hover,
.nav-link.active {
  color: var(--accent-light) !important;
}

.nav-link.active::after {
```
durch:
```css
#main-navbar .nav-link {
  color: var(--text-secondary);
  font-weight: 500;
  transition: var(--transition);
  position: relative;
  padding: 0.5rem 1rem;
}

#main-navbar .nav-link:hover,
#main-navbar .nav-link.active {
  color: var(--accent-light);
}

#main-navbar .nav-link.active::after {
```
Die Id hebt die Regeln über Bootstraps `.navbar-nav .nav-link`, deshalb entfällt `!important`.

- [ ] **Step 7: Tests laufen grün**

Run: `node --test test/cssRules.test.js`
Expected: PASS, 8 Tests.

- [ ] **Step 8: Sichtprüfung per Vergleich**

```bash
node scripts/style-snapshot.js --out data/d02/t5.json
node scripts/style-snapshot.js --compare data/d02/t4.json data/d02/t5.json > data/d02/t5.txt; head -60 data/d02/t5.txt
```
Expected: `0 removed, 0 added`. Die Gruppen betreffen nur diese Elemente (Spalte „samples“):
- `button…`/`a.btn…`: Farben, Rahmen, Radius, Innenabstand, `min-height`, Schriftgröße und -gewicht
- `div.modal-content`, `div.modal-header`, `div.modal-footer`: Hintergrund, Rahmen, Radius, Schatten
- `a` ohne Klasse: `color` auf `rgb(167, 139, 250)`
- Elemente mit `text-muted`, `text-primary|success|warning|danger|info`, `bg-…`, `badge`, `alert`: Farben
- Rahmenfarben und Radien von Bootstrap-Elementen (`hr`, `dropdown-menu`, `table`, `form-check-input`)

Navbar-Links (`a.nav-link`) dürfen in keiner Gruppe auftauchen. Taucht ein anderes Element auf, die Ursache in Step 2, 4 oder 6 suchen und beheben.

- [ ] **Step 9: Wiki nachziehen**

In `docs/wiki/modules/frontend-markup.md`:
- Frontmatter `sources:` um `public/css/components.css` ergänzen.
- In der Zeile `| \`<head>\` | …` `` `/css/tokens.css?v=3` and `/css/style.css?v=3` `` ersetzen durch `` `/css/tokens.css?v=3`, `/css/components.css?v=3` and `/css/style.css?v=3` (in this order) ``.
- Unter `## style.css blocks` den Eintrag `→ BUTTONS` streichen und direkt vor der Überschrift `## Theme variables` einfügen:
  ```markdown
  ## components.css blocks

  BOOTSTRAP BRIDGE (Bootstrap's `--bs-*` variables and colour helpers from the tokens) → BUTTON → DIALOG → TABS.

  ```
- In der Zeile `| \`#eventModal\` … \`#confirmModal\` …` steht nichts zu `glass-modal`; keine Änderung nötig.

Run: `npm run wiki`

- [ ] **Step 10: Commit**

```bash
npm test 2>&1 | tail -8
npm run test:e2e 2>&1 | tail -6
git add public/css/components.css public/css/style.css public/index.html public/js test/cssRules.test.js docs/wiki
git commit -m "Add components.css with the Bootstrap bridge, buttons, dialog and tabs

Bootstrap styles its components through its own CSS variables. Setting
them from the tokens replaces the !important overrides and gives every
button one height and radius, a flat violet primary with AA contrast,
and all 14 dialogs the same surface. The navbar link rules are scoped
to the navbar so they no longer hit the new segmented tabs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Toast mit Typ

**Files:**
- Modify: `public/css/components.css` (Block TOAST anhängen)
- Modify: `public/css/style.css` (Block TOAST entfällt)
- Modify: `public/index.html` (`#app-toast`)
- Modify: `public/js/core/ui.js` (`showToast`)
- Modify: `test/cssRules.test.js`
- Create: `test/components.test.js`
- Modify: `docs/wiki/modules/frontend-markup.md`

**Interfaces:**
- Consumes: `showToast(message, type)` bleibt in der Signatur gleich; Aufrufer verwenden nur `'success'`, `'danger'`, `'warning'`, `'info'`.
- Produces:
  - `TOAST_ICONS: { success, danger, warning, info }` (Typ → Bootstrap-Icon-Klasse), exportiert aus `core/ui.js`
  - `showToast(message: string, type = 'info')` setzt `#app-toast` auf `toast toast-<type>` und `#toast-icon` auf `toast-icon bi <symbol> ms-3`; unbekannte Typen werden `info`.
  - Klassen `.toast-success`, `.toast-danger`, `.toast-warning`, `.toast-info`, `.toast-icon`
  - In `test/components.test.js`: `loadUi(elements): Promise<{ ui, shown }>` lädt `core/ui.js` mit einem `document`, das nur die übergebenen Elemente kennt.

- [ ] **Step 1: Failing tests schreiben**

`test/components.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');

const CORE_DIR = path.join(REPO_ROOT, 'public', 'js', 'core');
const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');

/**
 * Load core/ui.js with a document that only knows `elements` (id -> element double).
 *
 * @param {Object<string, Object>} elements -> Elements reachable through getElementById.
 * @returns {Promise<{ ui: Object, shown: Object[] }>} -> Module exports and the toast elements Bootstrap was asked to show.
 */
async function loadUi(elements = {}) {
    const shown = [];
    const context = vm.createContext({
        document: { getElementById: (id) => elements[id] || null },
        gsap: { fromTo() {}, to() {} },
        bootstrap: {
            Toast: class {
                constructor(element) { this.element = element; }
                show() { shown.push(this.element); }
            }
        }
    });
    const ui = (await loadFrontendModules(path.join(CORE_DIR, 'ui.js'), context)).get('ui.js');
    return { ui, shown };
}

const toastElements = () => ({ 'app-toast': { className: '' }, 'toast-icon': { className: '' }, 'toast-message': { textContent: '' } });

test('a toast carries its type as class and icon', async () => {
    const icons = { success: 'bi-check-circle-fill', danger: 'bi-x-circle-fill', warning: 'bi-exclamation-triangle-fill', info: 'bi-info-circle-fill' };
    for (const [type, icon] of Object.entries(icons)) {
        const elements = toastElements();
        const { ui, shown } = await loadUi(elements);
        ui.showToast('Gespeichert', type);
        assert.equal(elements['app-toast'].className, `toast toast-${type}`);
        assert.equal(elements['toast-icon'].className, `toast-icon bi ${icon} ms-3`);
        assert.equal(elements['toast-message'].textContent, 'Gespeichert');
        assert.equal(shown.length, 1);
    }
});

test('an unknown type shows an info toast', async () => {
    for (const type of ['error', undefined, '', 'constructor', 'toString']) {
        const elements = toastElements();
        const { ui, shown } = await loadUi(elements);
        ui.showToast('Hinweis', type);
        assert.equal(elements['app-toast'].className, 'toast toast-info', String(type));
        assert.equal(elements['toast-icon'].className, 'toast-icon bi bi-info-circle-fill ms-3', String(type));
        assert.equal(shown.length, 1);
    }
});

test('a cached page without the icon element still shows the toast', async () => {
    const elements = toastElements();
    delete elements['toast-icon'];
    const { ui, shown } = await loadUi(elements);
    ui.showToast('Hinweis', 'warning');
    assert.equal(elements['app-toast'].className, 'toast toast-warning');
    assert.equal(shown.length, 1);
});

test('index.html carries the toast icon element', () => {
    assert.match(INDEX_HTML, /<i id="toast-icon" class="toast-icon bi bi-info-circle-fill ms-3"><\/i>/);
    assert.match(INDEX_HTML, /<div id="app-toast" class="toast toast-info" role="alert">/);
});
```

In `test/cssRules.test.js` die Listen erweitern: an `COMPONENT_SELECTORS` anhängen `'.toast', '.toast-success', '.toast-danger', '.toast-warning', '.toast-info', '.toast-icon'`; an `MOVED` anhängen `'.toast'`.

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/components.test.js test/cssRules.test.js`
Expected: FAIL. In `components.test.js` steht `toast align-items-center border-0` statt `toast toast-success`; in `cssRules.test.js` fehlen die Toast-Selektoren.

- [ ] **Step 2: Block TOAST an `components.css` anhängen**

```css

/* ═══════════════════════════════════════════ */
/* TOAST                                       */
/* showToast(message, type) in core/ui.js      */
/* ═══════════════════════════════════════════ */
.toast {
  --bs-toast-bg: var(--bg-secondary);
  --bs-toast-color: var(--text-primary);
  --bs-toast-border-color: var(--border-strong);
  --bs-toast-border-radius: var(--radius);
  --bs-toast-box-shadow: var(--shadow-md);
  --bs-toast-font-size: var(--font-size-sm);
  --toast-tone: var(--info);
  border-left: 3px solid var(--toast-tone);
}

.toast-container {
  --bs-toast-zindex: var(--z-toast);
}

.toast-success {
  --toast-tone: var(--success);
}

.toast-danger {
  --toast-tone: var(--danger);
}

.toast-warning {
  --toast-tone: var(--warning);
}

.toast-info {
  --toast-tone: var(--info);
}

.toast-icon {
  flex: none;
  color: var(--toast-tone);
  font-size: var(--font-size-lg);
}
```

In `public/css/style.css` den ganzen Block `TOAST` löschen (Banner und die Regel `.toast { … }` mit ihren drei `!important`).

- [ ] **Step 3: Markup von `#app-toast` ändern**

In `public/index.html` ersetzen:
```html
    <div id="app-toast" class="toast align-items-center border-0" role="alert">
      <div class="d-flex">
        <div class="toast-body" id="toast-message"></div>
```
durch:
```html
    <div id="app-toast" class="toast toast-info" role="alert">
      <div class="d-flex align-items-center">
        <i id="toast-icon" class="toast-icon bi bi-info-circle-fill ms-3"></i>
        <div class="toast-body" id="toast-message"></div>
```

- [ ] **Step 4: `showToast` ändern**

In `public/js/core/ui.js` direkt über `export function showToast` einfügen:
```js
// Toast type -> Bootstrap icon; any other type is shown as "info"
export const TOAST_ICONS = {
    success: 'bi-check-circle-fill',
    danger: 'bi-x-circle-fill',
    warning: 'bi-exclamation-triangle-fill',
    info: 'bi-info-circle-fill'
};
```

Die Funktion ersetzen durch:
```js
export function showToast(message, type = 'info') {
    const toastEl = document.getElementById('app-toast');
    const iconEl = document.getElementById('toast-icon');
    const kind = Object.hasOwn(TOAST_ICONS, type) ? type : 'info';

    // Resets the classes Bootstrap added while the last toast was shown
    toastEl.className = `toast toast-${kind}`;
    // A page cached before D-02 has no icon element
    if (iconEl) iconEl.className = `toast-icon bi ${TOAST_ICONS[kind]} ms-3`;
    document.getElementById('toast-message').textContent = message;

    const toast = new bootstrap.Toast(toastEl, { delay: 4000 });
    toast.show();

    gsap.fromTo(toastEl,
        { x: 50, opacity: 0, scale: 0.9 },
        { x: 0, opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.5)" }
    );
}
```

- [ ] **Step 5: Tests laufen grün**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/components.test.js test/cssRules.test.js`
Expected: PASS, 12 Tests.

- [ ] **Step 6: Wiki nachziehen**

In `docs/wiki/modules/frontend-markup.md` unter `## style.css blocks` den Eintrag `→ TOAST` streichen und unter `## components.css blocks` `→ TABS.` ersetzen durch `→ TABS → TOAST.`

In `docs/wiki/modules/frontend-app.md` in der Zeile `| \`core/ui.js\` | …` hinter `` `showToast(message, type)` `` einfügen: `` (type `success`, `danger`, `warning` or `info` sets the class `toast-<type>` and the icon; anything else is `info`) ``.

Run: `npm run wiki`

- [ ] **Step 7: Commit**

```bash
npm test 2>&1 | tail -8
npm run test:e2e 2>&1 | tail -6
git add public/css/components.css public/css/style.css public/index.html public/js/core/ui.js test/components.test.js test/cssRules.test.js docs/wiki
git commit -m "Give toasts a coloured edge and an icon per type

All four toast types looked the same: an !important background hid the
colour class that showToast set. The type now sets a class that colours
the left edge and picks an icon. Unknown types and a cached page
without the icon element still show the toast.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Karte, Chip und Skeleton

**Files:**
- Modify: `public/css/components.css` (Blöcke CARD, CHIP, SKELETON anhängen)
- Modify: `public/css/style.css` (Regeln entfallen, siehe Step 3)
- Modify: `public/js/core/ui.js` (`renderSkeletonEvents`)
- Modify: `test/cssRules.test.js`, `test/components.test.js`
- Modify: `docs/wiki/modules/frontend-markup.md`

**Interfaces:**
- Consumes: `loadUi` aus `test/components.test.js` (Task 6)
- Produces (Klassen):
  - Karte: `.glass-card`; Hover-Reaktion nur bei `.glass-card[data-click]`, `a.glass-card`, `.glass-card.is-clickable`
  - Chip: `.chip`, `.chip-sm`, `.chip-success|warning|danger|info|accent`; klickbar als `button.chip`, gewählt mit `.active`. Zweitnamen: `.badge-pill` (+ `.status-pending|accepted|rejected|waitlisted`), `.category-pill`, `.event-status-badge` (+ `.event-status-active|archived`), `.event-category-tag`
  - Skeleton: `.skeleton`, `.skeleton-text` (+ `.is-short`), `.skeleton-title`, `.skeleton-img`, `.skeleton-chip`, `.skeleton-avatar`, `.skeleton-card-body`

- [ ] **Step 1: Failing tests schreiben**

In `test/cssRules.test.js` an `COMPONENT_SELECTORS` anhängen:
```js
    '.glass-card', '.glass-card[data-click]:hover', 'a.glass-card:hover', '.glass-card.is-clickable:hover',
    '.chip', '.badge-pill', '.category-pill', '.event-status-badge', '.event-category-tag', '.chip-sm',
    '.chip-success', '.chip-warning', '.chip-danger', '.chip-info', '.chip-accent',
    '.badge-pill.status-accepted', '.badge-pill.status-pending', '.badge-pill.status-rejected', '.badge-pill.status-waitlisted',
    'button.chip.active', '.category-pill.active',
    '.skeleton', '.skeleton-text', '.skeleton-title', '.skeleton-img', '.skeleton-chip', '.skeleton-avatar', '.skeleton-card-body'
```
und an `MOVED`:
```js
    '.glass-card', '.glass-card:hover', '.stat-card:hover', '.info-card:hover',
    '.badge-pill', '.badge-pill.status-accepted', '.category-pill', '.category-pill:hover', '.category-pill.active',
    '.event-status-draft', '.event-status-active', '.event-status-archived',
    '.skeleton', '.skeleton-text', '.skeleton-title', '.skeleton-img'
```

An `test/components.test.js` anhängen:
```js
test('skeleton cards use component classes, no style attributes', async () => {
    const { ui } = await loadUi();
    const container = { innerHTML: '' };
    ui.renderSkeletonEvents(container, 2);
    assert.equal(container.innerHTML.match(/skeleton-img/g).length, 2);
    assert.equal(container.innerHTML.match(/skeleton-chip/g).length, 4);
    assert.match(container.innerHTML, /class="skeleton skeleton-text is-short"/);
    assert.doesNotMatch(container.innerHTML, /style=/);
});
```

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/components.test.js test/cssRules.test.js`
Expected: FAIL (fehlende Selektoren; `skeleton-chip` kommt nicht vor).

- [ ] **Step 2: Blöcke CARD, CHIP und SKELETON an `components.css` anhängen**

```css

/* ═══════════════════════════════════════════ */
/* CARD                                        */
/* .glass-card; reacts to hover only when it   */
/* can be clicked                              */
/* ═══════════════════════════════════════════ */
.glass-card {
  background: var(--bg-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  transition: var(--transition);
}

.glass-card[data-click],
a.glass-card,
.glass-card.is-clickable {
  cursor: pointer;
}

.glass-card[data-click]:hover,
a.glass-card:hover,
.glass-card.is-clickable:hover {
  background: var(--bg-glass-hover);
  border-color: var(--border-accent);
  box-shadow: var(--shadow-glow);
  transform: translateY(-2px);
}

/* ═══════════════════════════════════════════ */
/* CHIP                                        */
/* .chip + .chip-<status>; old names:          */
/* .badge-pill, .category-pill,                */
/* .event-status-badge, .event-category-tag    */
/* ═══════════════════════════════════════════ */
.chip,
.badge-pill,
.category-pill,
.event-status-badge,
.event-category-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--space-4);
  min-width: 0;
  max-width: 100%;
  min-height: 1.75rem;
  overflow: hidden;
  padding: 0 var(--space-12);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-pill);
  background: var(--bg-tint-2);
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  font-weight: 500;
  line-height: 1.25;
  text-decoration: none;
  white-space: nowrap;
}

.chip-sm,
.event-status-badge,
.event-category-tag {
  min-height: 1.375rem;
  padding: 0 var(--space-8);
  font-size: var(--font-size-xs);
  font-weight: 600;
}

.chip-success,
.badge-pill.status-accepted,
.event-status-active {
  border-color: var(--success-border);
  background: var(--success-bg);
  color: var(--success);
}

.chip-warning,
.badge-pill.status-pending,
.event-status-archived {
  border-color: var(--warning-border);
  background: var(--warning-bg);
  color: var(--warning);
}

.chip-danger,
.badge-pill.status-rejected {
  border-color: var(--danger-border);
  background: var(--danger-bg);
  color: var(--danger);
}

.chip-info,
.badge-pill.status-waitlisted,
.event-category-tag {
  border-color: var(--info-border);
  background: var(--info-bg);
  color: var(--info);
}

.chip-accent {
  border-color: var(--border-accent);
  background: var(--accent-tint-2);
  color: var(--accent-text);
}

/* Chips that filter: a <button class="chip"> or the old .category-pill */
button.chip,
.category-pill {
  cursor: pointer;
  font-family: inherit;
  transition: var(--transition);
}

button.chip:hover,
.category-pill:hover {
  border-color: var(--border-accent);
  color: var(--text-primary);
}

button.chip.active,
.category-pill.active {
  border-color: var(--accent-fill);
  background: var(--accent-fill);
  color: var(--on-accent);
}

/* ═══════════════════════════════════════════ */
/* SKELETON                                    */
/* Placeholder while content loads             */
/* ═══════════════════════════════════════════ */
.skeleton {
  background: linear-gradient(90deg, var(--bg-tint-1) 25%, var(--bg-tint-2) 50%, var(--bg-tint-1) 75%);
  background-size: 200% 100%;
  animation: skeleton-loading 1.5s infinite;
  border-radius: var(--radius);
}

@keyframes skeleton-loading {
  0% {
    background-position: 200% 0;
  }

  100% {
    background-position: -200% 0;
  }
}

.skeleton-text {
  height: 1em;
  margin-bottom: var(--space-8);
  width: 100%;
}

.skeleton-text.is-short {
  width: 80%;
}

.skeleton-title {
  height: 1.5em;
  width: 70%;
  margin-bottom: var(--space-16);
}

.skeleton-img {
  width: 100%;
  height: 160px;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.skeleton-chip {
  width: 60px;
  height: 24px;
  border-radius: var(--radius-pill);
}

.skeleton-avatar {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
}

/* Text part of a skeleton card: title and lines on top, chips at the bottom */
.skeleton-card-body {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 200px;
}
```

- [ ] **Step 3: Alte Regeln aus `style.css` nehmen**

In `public/css/style.css` löschen:

| Block | Was entfällt |
|---|---|
| `GLASS CARDS` | der ganze Block mit Banner (`.glass-card`, `.glass-card:hover`) |
| `CATEGORY PILLS` | `.category-pill`, `.category-pill:hover`, `.category-pill.active`, `.event-category-tag`; `.category-filter-bar` bleibt |
| `BADGES` | `.event-status-badge`, `.event-status-draft`, `.event-status-active`, `.event-status-archived` |
| Abschnitt `/* Badge Pill status colors */` | `.badge-pill` und die vier `.badge-pill.status-…`-Regeln samt Kommentar |
| `SKELETON LOADING` | `.skeleton`, `@keyframes skeleton-loading`, `.skeleton-text`, `.skeleton-title`, `.skeleton-img`; der Banner entfällt, falls danach keine Regel mehr darunter steht |
| `STATS CARDS` | die Regel `.stat-card:hover { … }` |
| `INFO SECTION` | die Regel `.info-card:hover { … }` und in `.info-card` die Zeile `transition: transform 0.3s ease, box-shadow 0.3s ease;` |

Im Block `BADGES` (jetzt ohne Regeln) stattdessen einfügen:
```css
/* The look comes from the chip component; these two stay upper case */
.event-status-badge,
.event-category-tag {
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
```

- [ ] **Step 4: `renderSkeletonEvents` ohne `style`-Attribute**

In `public/js/core/ui.js` die Funktion ersetzen durch:
```js
export function renderSkeletonEvents(container, count, isAdmin = false) {
    container.innerHTML = Array(count).fill(0).map(() => `
        <div class="col-md-6">
            <div class="glass-card skeleton-card p-0">
                <div class="skeleton skeleton-img"></div>
                <div class="skeleton-card-body p-4">
                    <div>
                        <div class="skeleton skeleton-title mb-3"></div>
                        <div class="skeleton skeleton-text"></div>
                        <div class="skeleton skeleton-text is-short"></div>
                    </div>
                    <div class="d-flex gap-2 mt-3">
                        <div class="skeleton skeleton-chip"></div>
                        <div class="skeleton skeleton-chip"></div>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}
```

- [ ] **Step 5: Tests laufen grün**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/components.test.js test/cssRules.test.js`
Expected: PASS, 13 Tests.

- [ ] **Step 6: Sichtprüfung per Vergleich**

```bash
node scripts/style-snapshot.js --out data/d02/t7.json
node scripts/style-snapshot.js --compare data/d02/t5.json data/d02/t7.json > data/d02/t7.txt; head -40 data/d02/t7.txt
```
Expected: Die Gruppen betreffen nur Chips (`span.badge-pill…`, `….category-pill…`, `span.event-status-badge…`, `span.event-category-tag`) und das Toast-Element (`div#app-toast`, dazu `added: … i#toast-icon…` und verschobene Geschwister als `removed`/`added`). Karten (`div.glass-card…`) dürfen in keiner Gruppe auftauchen, weil sich ihr Ruhezustand nicht ändert.

- [ ] **Step 7: Wiki nachziehen**

In `docs/wiki/modules/frontend-markup.md` unter `## style.css blocks` die Einträge `→ GLASS CARDS` und `→ SKELETON LOADING` streichen und unter `## components.css blocks` `→ TABS → TOAST.` ersetzen durch `→ TABS → TOAST → CARD → CHIP → SKELETON.`

Run: `npm run wiki`

- [ ] **Step 8: Commit**

```bash
npm test 2>&1 | tail -8
npm run test:e2e 2>&1 | tail -6
git add public/css/components.css public/css/style.css public/js/core/ui.js test/components.test.js test/cssRules.test.js docs/wiki
git commit -m "Move card, chip and skeleton into the component library

Four pill classes drew the same thing with slightly different sizes.
They share one chip definition now and keep their old names as
aliases, so no page markup changes. Cards only react to hover when
they can be clicked, which stops static cards from looking like links.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Leerzustand, Avatar und die Helfer

**Files:**
- Modify: `public/css/components.css` (Blöcke EMPTY STATE, AVATAR anhängen)
- Create: `public/js/core/components.js`
- Modify: `public/js/core/actions.js` (Fallback `initials`)
- Modify: `test/cssRules.test.js`, `test/components.test.js`, `test/frontendActions.test.js`
- Modify: `docs/wiki/modules/frontend-markup.md`, `docs/wiki/modules/frontend-app.md`

**Interfaces:**
- Consumes: `escapeHtml` aus `core/ui.js`
- Produces (`core/components.js`):
  - `initialsOf(name: string): string` liefert die großen Anfangsbuchstaben der ersten zwei Wörter, bei einem Wort einen Buchstaben, sonst `?`.
  - `avatar({ url, name, size }): string`. Mit `url`: `<img class="avatar[ avatar-<size>]" src alt title data-fallback="initials" data-initials>`; ohne: `<span class="avatar[ avatar-<size>] avatar-initials" title>`. `size` ist `'sm'`, `'lg'`, `'xl'` oder fehlt.
  - `emptyState({ icon = 'inbox', title, text = '', action = '' }): string`. `action` ist fertiges Button-Markup des Aufrufers und wird unverändert eingesetzt, weil Aktionsnamen wörtlich im Markup stehen müssen.
- Produces (Klassen): `.empty-state`, `.empty-state-icon`, `.empty-state-title`, `.empty-state-text`; `.avatar`, `.avatar-sm`, `.avatar-lg`, `.avatar-xl`, `.avatar-initials`, `.avatar-stack`, `.avatar-more`

- [ ] **Step 1: Failing tests schreiben**

In `test/cssRules.test.js` an `COMPONENT_SELECTORS` anhängen:
```js
    '.empty-state', '.empty-state-icon', '.empty-state-title', '.empty-state-text',
    '.avatar', '.avatar-sm', '.avatar-lg', '.avatar-xl', '.avatar-initials', '.avatar-stack', '.avatar-more'
```

An `test/components.test.js` anhängen:
```js
const loadComponents = async () => (await loadFrontendModules(path.join(CORE_DIR, 'components.js'), vm.createContext({}))).get('components.js');

test('initials come from the first two words', async () => {
    const { initialsOf } = await loadComponents();
    assert.equal(initialsOf('Lyonel Berzen'), 'LB');
    assert.equal(initialsOf('moritz'), 'M');
    assert.equal(initialsOf('  anna   maria  schmidt '), 'AM');
    assert.equal(initialsOf('élan vital'), 'ÉV');
    assert.equal(initialsOf('🦊 Fuchs'), '🦊F');
    for (const empty of ['', '   ', undefined, null]) assert.equal(initialsOf(empty), '?');
});

test('an avatar is an image with an initials fallback, or an initials tile', async () => {
    const { avatar } = await loadComponents();
    assert.equal(
        avatar({ url: 'https://cdn.example/a.png', name: 'Lyonel Berzen', size: 'lg' }),
        '<img class="avatar avatar-lg" src="https://cdn.example/a.png" alt="Lyonel Berzen" title="Lyonel Berzen" data-fallback="initials" data-initials="LB">'
    );
    assert.equal(avatar({ name: 'Lyonel Berzen' }), '<span class="avatar avatar-initials" title="Lyonel Berzen">LB</span>');
    assert.equal(avatar({ url: '   ', name: 'Mo', size: 'sm' }), '<span class="avatar avatar-sm avatar-initials" title="Mo">M</span>');
    // An unknown size is ignored, missing arguments give the placeholder tile
    assert.equal(avatar({ name: 'A', size: 'huge' }), '<span class="avatar avatar-initials" title="A">A</span>');
    assert.equal(avatar(), '<span class="avatar avatar-initials" title="">?</span>');
});

test('a display name cannot break out of the avatar markup', async () => {
    const { avatar } = await loadComponents();
    for (const name of ['"><script>alert(1)</script>', 'x" onerror="alert(1)', "y' onload='alert(1)", '<img src=x>']) {
        for (const html of [avatar({ name }), avatar({ url: 'https://cdn.example/a.png', name })]) {
            assert.doesNotMatch(html, /<script|<img src=x|" onerror="|' onload='/, name);
            // Exactly one element: the only "<" opens it (the tile also closes with "</span>")
            assert.equal(html.match(/</g).length, html.startsWith('<span') ? 2 : 1, html);
        }
    }
    assert.match(avatar({ url: 'https://cdn.example/a.png?x="><b>', name: 'A' }), /src="https:\/\/cdn\.example\/a\.png\?x=&quot;&gt;&lt;b&gt;"/);
});

test('an empty state shows icon, title, optional text and optional action', async () => {
    const { emptyState } = await loadComponents();
    const button = '<button type="button" class="btn btn-secondary btn-sm" data-click="hide" data-target="x">Aktualisieren</button>';
    assert.equal(
        emptyState({ icon: 'calendar-x', title: 'Noch keine Events', text: 'Sobald ein Event geplant ist, erscheint es hier.', action: button }),
        '<div class="empty-state"><div class="empty-state-icon"><i class="bi bi-calendar-x"></i></div><h3 class="empty-state-title">Noch keine Events</h3><p class="empty-state-text">Sobald ein Event geplant ist, erscheint es hier.</p>' + button + '</div>'
    );
    assert.equal(emptyState({ title: 'Leer' }), '<div class="empty-state"><div class="empty-state-icon"><i class="bi bi-inbox"></i></div><h3 class="empty-state-title">Leer</h3></div>');
});

test('an empty state escapes its texts and ignores an odd icon name', async () => {
    const { emptyState } = await loadComponents();
    const html = emptyState({ icon: 'x"><script>', title: '<b>Titel</b>', text: 'A & B <i>' });
    assert.match(html, /<i class="bi bi-inbox"><\/i>/);
    assert.match(html, /&lt;b&gt;Titel&lt;\/b&gt;/);
    assert.match(html, /A &amp; B &lt;i&gt;/);
    assert.doesNotMatch(html, /<script|<b>/);
    assert.equal(emptyState({ title: undefined }), '<div class="empty-state"><div class="empty-state-icon"><i class="bi bi-inbox"></i></div><h3 class="empty-state-title"></h3></div>');
});
```

In `test/frontendActions.test.js` nach dem Test `broken images fall back: hide, invisible, initials` einfügen:
```js
test('a broken avatar image becomes an initials tile of the same size', async () => {
    const { actions, document, listeners } = await loadActions();
    actions.initActions(document);
    const onError = listeners.find(l => l.type === 'error');
    for (const classes of ['avatar', 'avatar avatar-lg', 'me-2 avatar avatar-sm']) {
        const image = fakeElement('img', { 'data-fallback': 'initials', 'data-initials': 'LB', title: 'Lyonel Berzen' });
        image.className = classes;
        onError.listener({ type: 'error', target: image });
        assert.deepEqual({ ...image.replacement }, { tagName: 'SPAN', className: `${classes} avatar-initials`, title: 'Lyonel Berzen', textContent: 'LB' });
    }
    // A class that only contains the word is no avatar
    const legacy = fakeElement('img', { 'data-fallback': 'initials', 'data-initials': 'X', title: 'X' });
    legacy.className = 'participant-avatar';
    onError.listener({ type: 'error', target: legacy });
    assert.equal(legacy.replacement.className, 'participant-avatar-placeholder');
});
```

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/components.test.js test/frontendActions.test.js test/cssRules.test.js`
Expected: FAIL (`ENOENT … components.js`; Platzhalter-Klasse `participant-avatar-placeholder` statt `avatar avatar-initials`; fehlende Selektoren).

- [ ] **Step 2: Blöcke EMPTY STATE und AVATAR an `components.css` anhängen**

```css

/* ═══════════════════════════════════════════ */
/* EMPTY STATE                                 */
/* emptyState({ … }) in core/components.js     */
/* ═══════════════════════════════════════════ */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-8);
  padding: var(--space-32) var(--space-16);
  text-align: center;
}

.empty-state-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 3.5rem;
  height: 3.5rem;
  margin-bottom: var(--space-4);
  border-radius: 50%;
  background: var(--accent-tint-2);
  color: var(--accent-text);
  font-size: var(--font-size-2xl);
}

.empty-state-title {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.empty-state-text {
  max-width: 34ch;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.empty-state .btn {
  margin-top: var(--space-8);
}

/* ═══════════════════════════════════════════ */
/* AVATAR                                      */
/* avatar({ url, name, size }) in              */
/* core/components.js; sizes 24, 36, 64, 96 px */
/* ═══════════════════════════════════════════ */
.avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  object-fit: cover;
  font-size: var(--font-size-sm);
  font-weight: 600;
  line-height: 1;
}

.avatar-sm {
  width: 1.5rem;
  height: 1.5rem;
  font-size: var(--font-size-xs);
}

.avatar-lg {
  width: 4rem;
  height: 4rem;
  font-size: var(--font-size-2xl);
}

.avatar-xl {
  width: 6rem;
  height: 6rem;
  font-size: var(--font-size-3xl);
}

/* Shown instead of the image when there is none or it fails to load */
.avatar-initials {
  background: var(--accent-fill);
  color: var(--on-accent);
  user-select: none;
}

.avatar-stack {
  display: flex;
  align-items: center;
}

.avatar-stack .avatar {
  margin-left: calc(-1 * var(--space-8));
  border: 2px solid var(--bg-card);
}

.avatar-stack .avatar:first-child {
  margin-left: 0;
}

/* "+3" at the end of a stack */
.avatar-more {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: var(--font-size-xs);
}
```

- [ ] **Step 3: `public/js/core/components.js` schreiben**

```js
/**
 * Markup helpers for the library components that need more than a class
 * name: avatar (image with initials fallback) and empty state. Styles:
 * public/css/components.css; examples: styleguide (#debug).
 */
import { escapeHtml } from './ui.js';

const AVATAR_SIZES = ['sm', 'lg', 'xl'];
const ICON_NAME = /^[a-z0-9-]+$/;

/**
 * Initials of a display name.
 *
 * @param {string} name -> Display name, e.g. from Discord.
 * @returns {string} -> First letters of the first two words in upper case, "?" for an empty name.
 */
export function initialsOf(name) {
    const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '?';
    // Spread keeps an emoji or an accented letter in one piece
    return words.slice(0, 2).map(word => [...word][0].toUpperCase()).join('');
}

/**
 * Avatar markup: the image, or a tile with initials when there is no image.
 * A broken image turns into the same tile (data-fallback="initials").
 *
 * @param {Object} [options] -> Avatar data.
 * @param {string} [options.url] -> Image address.
 * @param {string} [options.name] -> Display name; used for initials, alt and title.
 * @param {string} [options.size] -> "sm" (24 px), "lg" (64 px), "xl" (96 px); default 36 px.
 * @returns {string} -> HTML of one element.
 */
export function avatar({ url, name, size } = {}) {
    const classes = `avatar${AVATAR_SIZES.includes(size) ? ` avatar-${size}` : ''}`;
    const label = escapeHtml(String(name ?? ''));
    const initials = escapeHtml(initialsOf(name));
    if (typeof url === 'string' && url.trim()) {
        return `<img class="${classes}" src="${escapeHtml(url)}" alt="${label}" title="${label}" data-fallback="initials" data-initials="${initials}">`;
    }
    return `<span class="${classes} avatar-initials" title="${label}">${initials}</span>`;
}

/**
 * Empty state: what a list shows instead of nothing.
 *
 * @param {Object} [options] -> Content.
 * @param {string} [options.icon] -> Bootstrap icon name without "bi-", e.g. "calendar-x".
 * @param {string} [options.title] -> Headline (plain text).
 * @param {string} [options.text] -> One explaining sentence (plain text).
 * @param {string} [options.action] -> Ready button HTML built by the caller. Inserted as it is, because action names must be literal in the markup; the caller escapes its values.
 * @returns {string} -> HTML of the block.
 */
export function emptyState({ icon = 'inbox', title, text = '', action = '' } = {}) {
    const iconName = ICON_NAME.test(icon) ? icon : 'inbox';
    const textHtml = text ? `<p class="empty-state-text">${escapeHtml(String(text))}</p>` : '';
    return `<div class="empty-state"><div class="empty-state-icon"><i class="bi bi-${iconName}"></i></div><h3 class="empty-state-title">${escapeHtml(String(title ?? ''))}</h3>${textHtml}${action}</div>`;
}
```

- [ ] **Step 4: Bild-Fallback `initials` für `.avatar`**

In `public/js/core/actions.js` im Objekt `FALLBACKS` den Eintrag `initials` ersetzen durch:
```js
    initials: (img) => {
        // Library avatars keep their size classes; older images get the participant tile
        const isAvatar = /(^|\s)avatar(\s|$)/.test(img.className || '');
        const placeholder = document.createElement(isAvatar ? 'span' : 'div');
        placeholder.className = isAvatar ? `${img.className} avatar-initials` : 'participant-avatar-placeholder';
        placeholder.title = img.title;
        placeholder.textContent = img.dataset.initials || '?';
        img.replaceWith(placeholder);
    }
```

Im Kopfkommentar derselben Datei den Satz `Broken images use data-fallback="hide|invisible|initials".` lassen, wie er ist.

- [ ] **Step 5: Tests laufen grün**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/components.test.js test/frontendActions.test.js test/cssRules.test.js`
Expected: PASS, kein `fail`.

- [ ] **Step 6: Wiki nachziehen**

`docs/wiki/modules/frontend-markup.md`: unter `## components.css blocks` `→ CARD → CHIP → SKELETON.` ersetzen durch `→ CARD → CHIP → SKELETON → EMPTY STATE → AVATAR.` In der Tabelle unter `## Actions` in der Zeile `data-fallback=…` hinter `(\`data-initials\`, \`title\`)` einfügen: `` — an `img.avatar` keeps its size classes and becomes `.avatar.avatar-initials` ``.

`docs/wiki/modules/frontend-app.md`: nach der Zeile `| \`core/actions.js\` | …` einfügen:
```markdown
| `core/components.js` | markup helpers of the component library | `initialsOf(name)`, `avatar({ url, name, size })` (image with `data-fallback="initials"`, or an initials tile), `emptyState({ icon, title, text, action })` (`action` is ready button HTML with a literal `data-click`) |
| `core/contrast.js` | WCAG contrast maths (styleguide and token test) | `parseColor`, `composite`, `contrastRatio` |
```

Run: `npm run wiki`

- [ ] **Step 7: Commit**

```bash
npm test 2>&1 | tail -8
npm run test:e2e 2>&1 | tail -6
git add public/css/components.css public/js/core/components.js public/js/core/actions.js test/components.test.js test/frontendActions.test.js test/cssRules.test.js docs/wiki
git commit -m "Add the empty state and avatar components with markup helpers

Ten avatar classes and a dozen loose 'nothing here' sentences each had
their own markup. One avatar helper renders the image with an initials
fallback that keeps its size, one helper renders an empty state. Pages
adopt them when they are rebuilt (D-04 to D-09).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Farbwerte in `style.css` durch Tokens ersetzen

**Files:**
- Create: `data/d02/colors.js` (Einmal-Skript, nicht im Repo)
- Modify: `public/css/style.css`
- Modify: `test/cssRules.test.js`

**Interfaces:**
- Consumes: Tokens aus Task 3; `components.css` enthält seit Task 5–8 keine Farbwerte.
- Produces: `style.css` ohne Farbwerte. Der Wächter-Test gilt ab jetzt für beide Dateien.

Zuordnung (Spec, Teil 5): Violett bis 10 % → `--accent-tint-1`, 12–25 % → `--accent-tint-2`, 30 % → `--border-accent`, 40 % → `--accent-glow`; Weiß bis 5 % → `--bg-tint-1`, 6–8 % → `--bg-tint-2`, ab 10 % → `--bg-tint-3`; Statusfarben bis 20 % → `-bg`, darüber → `-border`. Steht der Wert in einer `border…`- oder `outline…`-Eigenschaft, wird er immer ein Rahmen-Token (`--border-subtle`, `--border-strong`, `--border-accent`, `--<status>-border`).

- [ ] **Step 1: Failing test schreiben**

In `test/cssRules.test.js` unter `MOVED` einfügen:
```js
// A colour written out: hex, rgb(), hsl() or a colour name (white-space is no colour)
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(white|black)(?![-\w])/;
const withoutImportant = (value) => value.replace(/\s*!important$/, '');
const describe = (rule, declaration) => `${rule.file}:${declaration.line} ${rule.selector} { ${declaration.property}: ${declaration.value} }`;
```

Am Dateiende anhängen:
```js
test('colour values only live in tokens.css', () => {
    const raw = allRules().flatMap(rule => rule.declarations.filter(declaration => RAW_COLOR.test(declaration.value)).map(declaration => describe(rule, declaration)));
    assert.deepEqual(raw, []);
});
```

Run: `node --test test/cssRules.test.js`
Expected: FAIL, die Liste nennt über 100 Einträge, alle aus `style.css`.

- [ ] **Step 2: Einmal-Skript schreiben**

`data/d02/colors.js`:
```js
// One-off codemod for D-02 (not committed): replaces every colour literal in
// the declarations of public/css/style.css with the nearest token (spec,
// part 5) and switches violet text from --accent to --accent-text.
// Prints what it could not map.
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
// A comment (kept as it is) or a colour literal; "white" only as a value, not in white-space
const COMMENT_OR_COLOR = /\/\*[\s\S]*?\*\/|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)|#[0-9a-fA-F]{3,8}\b|(?<![-\w])white(?![-\w])/g;
const NESTING_AT_RULE = /^@(media|supports|keyframes|-webkit-keyframes)\b/;

// Whole declarations that become one shadow token
const WHOLE = new Map([
    ['box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3)', 'box-shadow: var(--shadow-sm)'],
    ['box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4)', 'box-shadow: var(--shadow-md)']
]);

const FIXED = {
    '#fff': 'var(--on-accent)',
    'white': 'var(--on-accent)',
    '#8b5cf6': 'var(--accent)',
    '#6d28d9': 'var(--accent-dark)',
    '#22c55e': 'var(--success)',
    '#eab308': 'var(--warning)',
    'rgb(234,179,8)': 'var(--warning)',
    '#06b6d4': 'var(--info)',
    '#ef4444': 'var(--danger)',
    '#f44336': 'var(--danger)',
    'rgba(167,139,250,0.3)': 'var(--border-accent)'
};

const isBorder = (property) => /^(border|outline)/.test(property);
const status = (name) => (alpha, property) => (isBorder(property) || alpha > 0.2 ? `var(--${name}-border)` : `var(--${name}-bg)`);

// "r,g,b" -> (alpha, property) -> token
const TINTS = {
    '139,92,246': (alpha, property) => {
        if (isBorder(property)) return 'var(--border-accent)';
        return alpha <= 0.1 ? 'var(--accent-tint-1)' : alpha <= 0.25 ? 'var(--accent-tint-2)' : alpha <= 0.3 ? 'var(--border-accent)' : 'var(--accent-glow)';
    },
    '255,255,255': (alpha, property) => {
        if (isBorder(property)) return alpha <= 0.08 ? 'var(--border-subtle)' : 'var(--border-strong)';
        return alpha <= 0.05 ? 'var(--bg-tint-1)' : alpha <= 0.08 ? 'var(--bg-tint-2)' : 'var(--bg-tint-3)';
    },
    '0,0,0': () => 'var(--bg-inset)',
    '10,10,15': () => 'var(--bg-scrim)',
    '34,197,94': status('success'),
    '6,182,212': status('info'),
    '234,179,8': (alpha, property) => (alpha > 0.5 ? 'var(--warning)' : status('warning')(alpha, property)),
    '239,68,68': (alpha, property) => (alpha === 0 ? 'transparent' : status('danger')(alpha, property)),
    '244,67,54': (alpha) => (alpha > 0.5 ? 'var(--danger)' : 'var(--danger-border)')
};

function tokenFor(literal, property) {
    const key = literal.replace(/\s+/g, '').toLowerCase();
    if (key in FIXED) return FIXED[key];
    const rgba = /^rgba\((\d+,\d+,\d+),([\d.]+)\)$/.exec(key);
    if (rgba && TINTS[rgba[1]]) return TINTS[rgba[1]](Number(rgba[2]), property);
    return null;
}

const source = fs.readFileSync(FILE, 'utf8');
const unmapped = [];
let replaced = 0;
let output = '';

// One declaration (text between "{" or ";" and the next ";" or "}"), may span lines
function convert(declaration) {
    const plain = declaration.replace(/\/\*[\s\S]*?\*\//g, '').trim().replace(/\s+/g, ' ');
    if (WHOLE.has(plain)) {
        replaced++;
        return declaration.replace(declaration.trim(), WHOLE.get(plain));
    }
    const property = plain.split(':')[0].trim();
    const converted = declaration.replace(COMMENT_OR_COLOR, (match) => {
        if (match.startsWith('/*')) return match;
        const token = tokenFor(match, property);
        if (!token) {
            unmapped.push(`${output.split('\n').length}: ${match}  (${plain.slice(0, 70)})`);
            return match;
        }
        replaced++;
        return token;
    });
    // Violet as text colour: --accent has 4.24:1 on cards, --accent-text 6.60:1
    return property === 'color' ? converted.replace('var(--accent)', 'var(--accent-text)') : converted;
}

// 'at' for blocks that contain rules, 'rule' for blocks that contain declarations
const stack = [];
let chunk = '';
const flush = (terminator) => {
    const isDeclaration = stack[stack.length - 1] === 'rule' && terminator !== '{';
    output += (isDeclaration ? convert(chunk) : chunk) + terminator;
    chunk = '';
};
for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '/' && source[i + 1] === '*') {
        const end = source.indexOf('*/', i) + 2;
        chunk += source.slice(i, end);
        i = end - 1;
    } else if (char === '{') {
        const prelude = chunk.replace(/\/\*[\s\S]*?\*\//g, '').trim();
        flush('{');
        stack.push(NESTING_AT_RULE.test(prelude) ? 'at' : 'rule');
    } else if (char === '}') {
        flush('}');
        stack.pop();
    } else if (char === ';') {
        flush(';');
    } else {
        chunk += char;
    }
}
fs.writeFileSync(FILE, output + chunk);
console.log(`${replaced} colour value(s) replaced`);
console.log(unmapped.length ? `Not mapped, fix by hand:\n${unmapped.join('\n')}` : 'Every colour value was mapped');
```

- [ ] **Step 3: Skript ausführen**

Run: `node data/d02/colors.js`
Expected: `… colour value(s) replaced` mit einer Zahl über 100 und genau vier nicht zugeordnete Werte, alle in den beiden Wartungs-Bannern: `#e65100`, `#ff9800`, `#1565c0`, `#42a5f5`.

Nennt die Ausgabe weitere Werte, steht dort eine Farbe, die es beim Schreiben des Plans nicht gab. Dann das nächstliegende Token nach der Zuordnung oben von Hand einsetzen.

Kontrolle, dass nur Werte ersetzt wurden:
```bash
git diff --stat public/css/style.css
grep -c 'white-space' public/css/style.css
git diff public/css/style.css | grep '^[-+]' | grep -v '^[-+][-+]' | grep -c -v -E 'var\(--|rgba?\(|#[0-9a-fA-F]{3}|white|transparent'
```
Expected: gleich viele eingefügte wie gelöschte Zeilen; `white-space` kommt so oft vor wie vorher (`git show HEAD:public/css/style.css | grep -c 'white-space'`); die letzte Zahl ist `0`.

- [ ] **Step 4: Stellen von Hand korrigieren, an denen der Zusammenhang zählt**

Das Skript kennt nur den Wert, nicht den Zweck. Diese Regeln in `public/css/style.css` anpassen:

| Regel | Deklarationen danach | Grund |
|---|---|---|
| `.maintenance-banner` | `background: var(--warning-fill);` und `color: var(--on-warning);` | weiße Schrift auf Orange hatte 2,16:1 |
| `.planned-maintenance-banner` | `background: var(--info-fill);` und `color: var(--on-info);` | weiße Schrift auf Hellblau hatte 2,65:1 |
| `::selection` | `background: var(--accent-fill);` | weiße Schrift auf `--accent` |
| `.series-badge` | `background: var(--accent-fill);` | weiße Schrift auf hellem Verlaufsende |
| `.comment-admin-badge` | `background: var(--accent-fill);` | weiße Schrift auf `--accent` |
| `.wizard-step-item.active .wizard-step-bubble` | `background: var(--accent-fill);` und `border-color: var(--accent-fill);` | weiße Schrift auf `--accent` |
| `.info-dev-avatar` | `background: linear-gradient(135deg, var(--accent-fill), var(--accent-dark));` | Verlauf mit Schrift beginnt bei `--accent-fill` |
| `.participant-avatar-placeholder` | `background: linear-gradient(135deg, var(--accent-dark), var(--accent-fill));` | wie oben |
| `.info-github-btn:hover` | `color: var(--text-primary);` | die Fläche ist eine Tönung, keine Akzentfläche |

Gegenprobe: Jede Regel mit `var(--on-accent)` hat als Hintergrund `--accent-fill`, `--accent-dark` oder einen Verlauf aus beiden.
```bash
node -e '
const { readCss, parseRules } = require("./test/cssSource");
for (const rule of parseRules(readCss("style.css"))) {
    if (!rule.declarations.some(d => d.value.includes("--on-accent"))) continue;
    const background = rule.declarations.filter(d => d.property.startsWith("background")).map(d => d.value).join(" | ");
    console.log(`${rule.selector}  ->  ${background || "(no background in this rule)"}`);
}'
```
Expected: In keiner Zeile steht `var(--accent)` ohne `-fill` oder `-dark`. Bei „no background in this rule“ die Regel mit demselben Selektor-Anfang ansehen und denselben Maßstab anlegen.

- [ ] **Step 5: Test läuft grün**

Run: `node --test test/cssRules.test.js`
Expected: PASS, 9 Tests.

- [ ] **Step 6: Sichtprüfung per Vergleich**

```bash
node scripts/style-snapshot.js --out data/d02/t9.json
node scripts/style-snapshot.js --compare data/d02/t7.json data/d02/t9.json > data/d02/t9.txt; head -80 data/d02/t9.txt
```
Expected: `0 removed, 0 added`. Jede Gruppe betrifft `color`, `background-color`, `background-image`, `border-top-color` oder `box-shadow`. Die Werte liegen nah beieinander (andere Deckkraft derselben Farbe), mit diesen gewollten Ausnahmen: die beiden Banner (Gelb und Cyan mit dunkler Schrift), violette Texte (`rgb(139, 92, 246) -> rgb(167, 139, 250)`), violette Flächen mit weißer Schrift (`-> rgb(124, 58, 237)`). Eine Gruppe mit einer anderen Eigenschaft ist ein Fehler.

- [ ] **Step 7: Commit**

```bash
npm test 2>&1 | tail -8
npm run test:e2e 2>&1 | tail -6
git add public/css/style.css test/cssRules.test.js
git commit -m "Replace every colour value in style.css with a token

182 colours were written out, with 11 opacity steps of the same violet.
They now come from tokens.css, so the light scheme (D-15) only swaps
values in one file. White text moves from the brand violet to the
darker fill, and the maintenance banners get status colours with dark
text; both failed AA contrast before.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Schriftgrößen in `style.css` durch Tokens ersetzen

**Files:**
- Create: `data/d02/font-sizes.js` (Einmal-Skript, nicht im Repo)
- Modify: `public/css/style.css`
- Modify: `test/cssRules.test.js`

**Interfaces:**
- Consumes: `--font-size-*` aus Task 3; `describe` aus `test/cssRules.test.js` (Task 9)
- Produces: `style.css` ohne Schriftgrößen in px oder rem.

Bereiche (Spec, Teil 5): unter 0.8rem → `xs`; 0.8–0.9 → `sm`; 0.95–1 → `md`; 1.1–1.2 → `lg`; 1.3–1.35 → `xl`; 1.4–1.6 → `2xl`; 1.8–2 → `3xl`; 2.5 → `4xl`; größer → `display`. Angaben in `em` bleiben.

- [ ] **Step 1: Failing test schreiben**

An `test/cssRules.test.js` anhängen:
```js
test('font sizes in px or rem only live in tokens.css', () => {
    const raw = allRules().flatMap(rule => rule.declarations
        .filter(declaration => declaration.property === 'font-size' && /\d(px|rem)\b/.test(declaration.value))
        .map(declaration => describe(rule, declaration)));
    assert.deepEqual(raw, []);
});
```

Run: `node --test test/cssRules.test.js`
Expected: FAIL, über 100 Einträge aus `style.css`.

- [ ] **Step 2: Einmal-Skript schreiben und ausführen**

`data/d02/font-sizes.js`:
```js
// One-off codemod for D-02 (not committed): replaces every font size in rem
// or px in public/css/style.css with the token of its range (spec, part 5).
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'public', 'css', 'style.css');
const step = (rem) => (rem < 0.8 ? 'xs' : rem <= 0.9 ? 'sm' : rem <= 1 ? 'md' : rem <= 1.2 ? 'lg' : rem <= 1.35 ? 'xl' : rem <= 1.6 ? '2xl' : rem <= 2 ? '3xl' : rem <= 2.5 ? '4xl' : 'display');

const counts = {};
const css = fs.readFileSync(FILE, 'utf8').replace(/font-size:\s*([\d.]+)(rem|px)(?![\w.])/g, (match, number, unit) => {
    const name = step(unit === 'px' ? Number(number) / 16 : Number(number));
    counts[name] = (counts[name] || 0) + 1;
    return `font-size: var(--font-size-${name})`;
});
fs.writeFileSync(FILE, css);
console.log(Object.entries(counts).map(([name, count]) => `${name}: ${count}`).join(', '));
```

Run: `node data/d02/font-sizes.js`
Expected: eine Zeile mit Zählern je Stufe; `xs` und `sm` sind die größten.

- [ ] **Step 3: Die beiden fließenden Größen von Hand ersetzen**

Run: `grep -n 'font-size:' public/css/style.css | grep -v 'var(--font-size'`
Expected: drei Zeilen, zwei mit `clamp(…)` und `font-size: 0.88em;` (bleibt).

| Regel | Alt | Neu |
|---|---|---|
| `.loading-logo` | `font-size: clamp(3rem, 8vw, 6rem);` | `font-size: var(--font-size-logo);` |
| `.info-title` | `font-size: clamp(2.5rem, 7vw, 4.5rem);` | `font-size: var(--font-size-display);` |

- [ ] **Step 4: Test läuft grün**

Run: `node --test test/cssRules.test.js`
Expected: PASS, 10 Tests.

- [ ] **Step 5: Sichtprüfung per Vergleich**

```bash
node scripts/style-snapshot.js --out data/d02/t10.json
node scripts/style-snapshot.js --compare data/d02/t9.json data/d02/t10.json > data/d02/t10.txt; head -60 data/d02/t10.txt
```
Expected: `0 removed, 0 added`. Die Gruppen betreffen `font-size` und als Folge `line-height` sowie Abstände und Radien, die in `em` angegeben sind. Bei `font-size` ist der neue Wert einer aus 12, 14, 16, 18, 20, 24, 32, 40 px oder die fließende Größe; kein Wert weicht um mehr als 3 px vom alten ab, außer `i.panic-lockdown-icon` (80 px auf die Display-Größe) und Text, der unter 12 px lag.

- [ ] **Step 6: Commit**

```bash
npm test 2>&1 | tail -8
npm run test:e2e 2>&1 | tail -6
git add public/css/style.css test/cssRules.test.js
git commit -m "Replace the 28 font sizes in style.css with nine steps

Sizes like 0.72, 0.75 and 0.78rem sat next to each other, and some text
was 8.8 px tall. Every size now comes from the type scale; the smallest
step is 12 px.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Ebenen, Radien, Übergänge und überflüssige `!important`

**Files:**
- Modify: `public/css/style.css`
- Modify: `test/cssRules.test.js`

**Interfaces:**
- Consumes: `--z-*`, `--radius-*`, `--duration-*`, `--shadow-ring`, `--bg-scrim` aus Task 3; `withoutImportant`, `describe` aus `test/cssRules.test.js` (Task 9)
- Produces: `style.css` ohne `z-index` ab 10 als Zahl und ohne Radien in px.

Alle Regeln per Selektor suchen (`grep -n '^<selektor> {' public/css/style.css`); Zeilennummern haben sich seit Task 4 verschoben.

- [ ] **Step 1: Failing test schreiben**

An `test/cssRules.test.js` anhängen:
```js
test('layers above local stacking use the z tokens', () => {
    const raw = allRules().flatMap(rule => rule.declarations
        .filter(declaration => declaration.property === 'z-index' && /^-?\d+$/.test(withoutImportant(declaration.value)) && Math.abs(Number(withoutImportant(declaration.value))) >= 10)
        .map(declaration => describe(rule, declaration)));
    assert.deepEqual(raw, []);
});

test('radii come from the radius tokens', () => {
    const raw = allRules().flatMap(rule => rule.declarations
        .filter(declaration => declaration.property.startsWith('border') && declaration.property.endsWith('radius') && /\dpx\b/.test(declaration.value))
        .map(declaration => describe(rule, declaration)));
    assert.deepEqual(raw, []);
});
```

Run: `node --test test/cssRules.test.js`
Expected: FAIL, 5 Einträge bei den Ebenen und über 20 bei den Radien (kleine Radien und `999px`).

- [ ] **Step 2: Ebenen**

| Regel | Alt | Neu |
|---|---|---|
| `#loading-screen` | `z-index: 10000;` | `z-index: calc(var(--z-overlay) + 1);` |
| `.panic-lockdown-overlay` | `z-index: 9999;` | `z-index: var(--z-overlay);` |
| `.maintenance-banner` | `z-index: 1040;` | `z-index: var(--z-banner);` |
| `.planned-maintenance-banner` | `z-index: 1039;` | `z-index: calc(var(--z-banner) - 1);` |
| `.location-dropdown` | `z-index: 1050;` | `z-index: var(--z-dropdown);` |

- [ ] **Step 3: Radien**

Balken und Pillen bekommen `var(--radius-pill)`:

| Regel | Alt |
|---|---|
| `.loading-bar-container`, `.loading-bar`, `.capacity-progress`, `.capacity-progress-bar` | `border-radius: 3px;` |
| `#main-navbar .nav-link.active::after`, `.capacity-bar-container`, `.capacity-bar`, `.wizard-step-connector`, `.event-card-mini-progress`, `.event-card-mini-progress-bar` | `border-radius: 2px;` |
| `.profile-badge-progress`, `.profile-badge-progress-bar` | `border-radius: 4px;` |
| `.info-version-badge` | `border-radius: 99px;` |

Kleine Flächen bekommen `var(--radius-sm)`:

| Regel | Alt |
|---|---|
| `.markdown-body code`, `.bot-ping-badge` | `border-radius: 4px;` |
| `.countdown-item`, `.calendar-day` | `border-radius: 8px;` |
| `.calendar-day-event`, `.variable-ref-item code`, `.variable-ref-example code` | `border-radius: 3px;` |
| `.comment-actions button`, `.variable-ref-example` | `border-radius: 6px;` |
| `.comment-admin-badge` | `border-radius: 10px;` |

Dazu `.series-badge`: `border-radius: 20px;` wird `border-radius: var(--radius-lg);`.

Alle verbliebenen `border-radius: 999px;` werden in einem Zug zum Pillen-Token:
```bash
node -e '
const fs = require("fs");
const file = "public/css/style.css";
const css = fs.readFileSync(file, "utf8");
const parts = css.split("border-radius: 999px;");
fs.writeFileSync(file, parts.join("border-radius: var(--radius-pill);"));
console.log(`${parts.length - 1} replaced`);'
grep -n -E 'border[a-z-]*radius:[^;]*[0-9]px' public/css/style.css
```
Expected: eine Zahl größer 0, danach keine Ausgabe von `grep`. Zeigt `grep` noch eine Zeile, den Wert nach den Regeln oben ersetzen (Balken und Pillen `--radius-pill`, sonst `--radius-sm`).

- [ ] **Step 4: Übergänge**

| Regel | Alt | Neu |
|---|---|---|
| `.series-date-item`, `.series-dates-toggle` | `transition: background 0.2s;` | `transition: background var(--duration-fast);` |
| `.location-suggestion-item` | `transition: background 0.15s;` | `transition: background var(--duration-fast);` |
| `.participant-avatar` | `transition: transform 0.15s;` | `transition: transform var(--duration-fast);` |
| `#debug-chevron` | `transition: transform 0.25s ease;` | `transition: transform var(--duration-base) ease;` |
| `.capacity-progress-bar` | `transition: width 0.4s ease;` | `transition: width var(--duration-base) ease;` |
| `.capacity-bar` | `transition: width 0.5s ease;` | `transition: width var(--duration-slow) ease;` |
| `.profile-badge-progress-bar` | `transition: width 0.6s ease;` | `transition: width var(--duration-slow) ease;` |
| `.info-data-btn::before` | `transition: left 0.6s ease;` | `transition: left var(--duration-slow) ease;` |

Run: `grep -n -E 'transition:[^;]*[0-9.]+m?s' public/css/style.css`
Expected: keine Ausgabe.

- [ ] **Step 5: Formularfelder ohne `!important`**

Im Block `FORMS` die beiden Regeln für `.form-control`/`.form-select` ersetzen durch:
```css
/* Surface and text in every state; Bootstrap sets its own for :focus and :disabled */
.form-control,
.form-select,
.form-control:focus,
.form-select:focus,
.form-control:disabled,
.form-select:disabled {
  background: var(--bg-tint-1);
  color: var(--text-primary);
}

.form-control,
.form-select {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  padding: 0.7rem 1rem;
  transition: var(--transition);
}

.form-control:focus,
.form-select:focus {
  border-color: var(--accent);
  box-shadow: var(--shadow-ring);
}
```
`.form-label` bleibt, wie es ist.

- [ ] **Step 6: Weitere `!important`, die die Ladereihenfolge ersetzt**

| Regel | Alt | Neu |
|---|---|---|
| `#main-navbar` | `background: var(--bg-scrim) !important;` | `background: var(--bg-scrim);` |
| `.table-dark` | `--bs-table-bg: transparent !important;` | `--bs-table-bg: transparent;` |
| `.table-dark` | `--bs-table-border-color: var(--border-subtle) !important;` | `--bs-table-border-color: var(--border-subtle);` |

`.brand-text` behält seine drei `!important`: Die Klasse steht auch an der Überschrift der Login-Karte und muss dort deren `style`-Attribut schlagen.

- [ ] **Step 7: Tests laufen grün**

Run: `node --test test/cssRules.test.js`
Expected: PASS, 12 Tests.

- [ ] **Step 8: Sichtprüfung per Vergleich**

```bash
node scripts/style-snapshot.js --out data/d02/t11.json
node scripts/style-snapshot.js --compare data/d02/t10.json data/d02/t11.json
```
Expected: `0 removed, 0 added`. Die Gruppen betreffen nur `z-index` (die fünf Regeln aus Step 2) und `border-top-left-radius` (die Regeln aus Step 3). Formularfelder (`input.form-control`, `select.form-select`, `textarea.form-control`), die Navbar und Tabellen dürfen in keiner Gruppe auftauchen; tun sie es, fehlt in Step 5 oder 6 eine Deklaration.

- [ ] **Step 9: Commit**

```bash
npm test 2>&1 | tail -8
npm run test:e2e 2>&1 | tail -6
git add public/css/style.css test/cssRules.test.js
git commit -m "Use tokens for layers, radii and durations in style.css

Nine z-index numbers from -1 to 10000 become named layers that follow
Bootstrap's scale, small radii collapse to two tokens. Form fields, the
navbar and tables no longer need !important because they load after
Bootstrap.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Styleguide `#debug`

**Files:**
- Modify: `public/index.html` (`#debug-section`)
- Modify: `public/js/pages/debug.js` (ganz neu)
- Create: `public/js/pages/debug-components.js`
- Modify: `public/js/main.js` (Import)
- Modify: `public/css/style.css` (Block `DEBUG / STYLING GUIDE`)
- Modify: `playwright.config.js`
- Create: `test/styleguide.test.js`, `e2e/styleguide.spec.js`
- Modify: `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`

**Interfaces:**
- Consumes: `avatar`, `emptyState` (Task 8); `parseColor`, `contrastRatio` (Task 2); `showToast`, `TOAST_ICONS` (Task 6), `showConfirmDialog`, `escapeHtml` aus `core/ui.js`; `registerActions`
- Produces:
  - `showDebugSection()` (wie bisher vom Router aufgerufen), `sgRunAnimation(index)`
  - `contrastLabel(value: string, surface: string): string`, zum Beispiel `'5,62 : 1'`; `''`, wenn einer der Werte keine deckende, lesbare Farbe ist
  - `renderDebugComponents(container: Element): void` schreibt neun `<section class="sg-block" id="sg-…">` in dieser Reihenfolge: `button`, `card`, `chip`, `tabs`, `dialog`, `toast`, `empty-state`, `skeleton`, `avatar`
  - Aktionen `sgShowDialog`, `sgShowToast` (liest `data-type`); die Aktion `showTestToast` entfällt

- [ ] **Step 1: Failing tests schreiben**

`test/styleguide.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, frontendSources, REPO_ROOT } = require('./helpers');

const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
const BLOCKS = ['button', 'card', 'chip', 'tabs', 'dialog', 'toast', 'empty-state', 'skeleton', 'avatar'];

test('the styleguide renders one block per component, in the order of the library', async () => {
    const { app } = await loadFrontendApp({});
    const container = { innerHTML: '' };
    app.renderDebugComponents(container);
    const ids = [...container.innerHTML.matchAll(/<section class="sg-block" id="sg-([a-z-]+)">/g)].map(match => match[1]);
    assert.deepEqual(ids, BLOCKS);
});

test('index.html holds the three parts of the styleguide', () => {
    for (const id of ['sg-tokens', 'sg-components', 'sg-legacy']) assert.match(INDEX_HTML, new RegExp(`id="${id}"`));
    for (const id of ['sg-colors', 'sg-badges']) assert.doesNotMatch(INDEX_HTML, new RegExp(`id="${id}"`));
});

test('the styleguide code sets no style attributes', () => {
    const sources = frontendSources().filter(entry => entry.file.startsWith('pages/debug'));
    assert.equal(sources.length, 2);
    for (const { file, source } of sources) assert.doesNotMatch(source, /style="/, file);
});

test('a contrast is only shown for opaque colours the check can read', async () => {
    const { app } = await loadFrontendApp({});
    assert.equal(app.contrastLabel('#8f8f9a', '#16161f'), '5,62 : 1');
    assert.equal(app.contrastLabel('#ffffff', '#7c3aed'), '5,70 : 1');
    for (const value of ['rgba(255, 255, 255, 0.04)', 'var(--accent-glow)', '0 0 0 3px var(--accent-glow)', '#12', '']) {
        assert.equal(app.contrastLabel(value, '#16161f'), '', value);
    }
    assert.equal(app.contrastLabel('#ffffff', 'rgba(22, 22, 31, 0.85)'), '');
});
```

`e2e/styleguide.spec.js`:
```js
/**
 * Styleguide (#debug): tokens and the nine components render on desktop and
 * phone. The test server runs with DEBUG_MODE=true (playwright.config.js).
 */
const { test, expect } = require('@playwright/test');
const { watchErrors, loginAs } = require('./helpers');

const BLOCKS = ['button', 'card', 'chip', 'tabs', 'dialog', 'toast', 'empty-state', 'skeleton', 'avatar'];

async function openStyleguide(page) {
    await loginAs(page, 'admin');
    await page.goto('/#debug');
    await expect(page.locator('#debug-section')).toBeVisible();
}

test('the styleguide shows the tokens and all nine components', async ({ page }) => {
    const errors = watchErrors(page);
    await openStyleguide(page);
    await expect(page.locator('#sg-tokens .sg-token').first()).toBeVisible();
    expect(await page.locator('#sg-tokens .sg-token').count()).toBeGreaterThan(80);
    await expect(page.locator('#sg-tokens .sg-token[data-token="--text-muted"] .sg-token-contrast')).toHaveText('5,62 : 1');
    for (const block of BLOCKS) await expect(page.locator(`#sg-${block}`)).toBeVisible();
    // One large initials tile by design, two more from the images that fail to load
    await expect(page.locator('#sg-avatar span.avatar.avatar-lg.avatar-initials')).toHaveCount(3);
    await expect(page.locator('#sg-avatar img.avatar-lg')).toHaveCount(1);
    expect(errors).toEqual([]);
});

test('long content stays inside the page and many tabs scroll sideways', async ({ page }, testInfo) => {
    await openStyleguide(page);
    const tooWide = await page.evaluate(() => [...document.querySelectorAll('#debug-section *')]
        .filter(element => !element.closest('.nav-pills') && element.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
        .map(element => `${element.tagName.toLowerCase()}.${element.className}`)
        .slice(0, 5));
    expect(tooWide).toEqual([]);
    const manyTabs = page.locator('#sg-tabs .nav-pills').nth(1);
    const edges = await manyTabs.evaluate(element => ({ right: element.getBoundingClientRect().right, page: document.documentElement.clientWidth, scrolls: element.scrollWidth > element.clientWidth }));
    expect(edges.right).toBeLessThanOrEqual(edges.page + 1);
    if (testInfo.project.name === 'mobile') expect(edges.scrolls).toBe(true);
});

test('toast types differ, tabs switch and the dialog opens', async ({ page }) => {
    const errors = watchErrors(page);
    await openStyleguide(page);
    const toast = page.locator('#app-toast');
    const edge = () => toast.evaluate(element => getComputedStyle(element).borderLeftColor);

    await page.locator('#sg-toast [data-click="sgShowToast"][data-type="success"]').click();
    await expect(toast).toHaveClass(/\btoast-success\b/);
    await expect(toast).toBeVisible();
    const successEdge = await edge();
    await page.locator('#sg-toast [data-click="sgShowToast"][data-type="danger"]').click();
    await expect(toast).toHaveClass(/\btoast-danger\b/);
    expect(await edge()).not.toBe(successEdge);

    await page.locator('#sg-tabs [data-bs-target="#sg-tab-archive"]').click();
    await expect(page.locator('#sg-tab-archive')).toBeVisible();

    await page.locator('#sg-dialog [data-click="sgShowDialog"]').click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await page.locator('#confirmModal [data-bs-dismiss="modal"]').click();
    await expect(page.locator('#confirmModal')).toBeHidden();
    expect(errors).toEqual([]);
});
```

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/styleguide.test.js`
Expected: FAIL (`app.renderDebugComponents is not a function`, `id="sg-tokens"` fehlt).

- [ ] **Step 2: Test-Server mit `DEBUG_MODE=true`**

In `playwright.config.js` die Zeile `env: { … }` im Block `webServer` ersetzen durch:
```js
        // DEBUG_MODE shows the styleguide (#debug), which e2e/styleguide.spec.js walks through
        env: { PORT: String(PORT), DEV_SQLITE_PATH: path.join(os.tmpdir(), `dems-e2e-${Date.now()}.sqlite`), DEBUG_MODE: 'true' },
```

Run: `npm run test:e2e 2>&1 | tail -8`
Expected: Die bestehende Tour ist weiter grün; nur die drei neuen Tests aus `styleguide.spec.js` schlagen fehl (je Projekt `desktop` und `mobile`).

Schlägt die Tour wegen `DEBUG_MODE` fehl, liegt es am zusätzlichen Menüpunkt „Debug“ oder an den Debug-Ausgaben. Dann die Stelle in der Tour beheben (sie darf nicht davon abhängen, wie viele Menüpunkte sichtbar sind); `DEBUG_MODE` bleibt gesetzt.

- [ ] **Step 3: `#debug-section` in `index.html` umbauen**

Vier Ersetzungen in `public/index.html`.

(a) Kopf und erster Block. Ersetzen:
```html
          <h2><i class="bi bi-palette me-2"></i>Styling Guide</h2>
          <p class="text-secondary mb-0">Komponentenübersicht — nur im Debug-Modus sichtbar.</p>
        </div>

        <!-- 1. Farben -->
        <h5 class="sg-section-title">Farben</h5>
        <div id="sg-colors" class="sg-color-grid"></div>

        <!-- 2. Typographie -->
```
durch:
```html
          <h2><i class="bi bi-palette me-2"></i>Styleguide</h2>
          <p class="text-secondary mb-0">Tokens und Komponenten — nur im Debug-Modus sichtbar.</p>
        </div>

        <!-- Rendered by pages/debug.js from tokens.css -->
        <h3 class="sg-part-title">Tokens</h3>
        <div id="sg-tokens"></div>

        <!-- Rendered by pages/debug-components.js -->
        <h3 class="sg-part-title">Komponenten</h3>
        <div id="sg-components"></div>

        <h3 class="sg-part-title">Bestand</h3>
        <div id="sg-legacy">

        <!-- Typographie -->
```

(b) Buttons, Badges und Cards. Ersetzen:
```html
        <!-- 3. Buttons -->
        <h5 class="sg-section-title">Buttons</h5>
        <div class="glass-card p-4 mb-4">
          <div id="sg-buttons" class="d-flex flex-wrap gap-2"></div>
        </div>

        <!-- 4. Badges & Pills -->
        <h5 class="sg-section-title">Badges &amp; Status-Pills</h5>
        <div class="glass-card p-4 mb-4">
          <div id="sg-badges" class="d-flex flex-wrap gap-2 align-items-center"></div>
        </div>

        <!-- 5. Cards -->
        <h5 class="sg-section-title">Cards</h5>
        <div id="sg-cards" class="mb-4"></div>
```
durch:
```html
        <!-- Weitere Button-Varianten -->
        <h5 class="sg-section-title">Weitere Button-Varianten</h5>
        <div class="glass-card p-4 mb-4">
          <div id="sg-buttons" class="d-flex flex-wrap gap-2"></div>
        </div>

        <!-- Seitenkarten -->
        <h5 class="sg-section-title">Seitenkarten</h5>
        <div id="sg-cards" class="mb-4"></div>
```

(c) Der Toast-Button zieht zu den Komponenten. Ersetzen:
```html
          <div id="sg-alerts" class="mb-3"></div>
          <button class="btn btn-outline-secondary btn-sm" data-click="showTestToast">
            <i class="bi bi-bell me-1"></i>Toast testen
          </button>
        </div>
```
durch:
```html
          <div id="sg-alerts"></div>
        </div>
```

(d) `#sg-legacy` schließen. Ersetzen:
```html
          <div id="sg-icons" class="sg-icon-grid"></div>
        </div>

      </div>
    </section>
```
durch:
```html
          <div id="sg-icons" class="sg-icon-grid"></div>
        </div>

        </div>
      </div>
    </section>
```

- [ ] **Step 4: `public/js/pages/debug-components.js` schreiben**

```js
/**
 * Styleguide part "Komponenten" (#debug): one block per component of
 * public/css/components.css, with every variant and its class names.
 * All texts are fixed examples, no user data.
 */
import { registerActions } from '../core/actions.js';
import { avatar, emptyState } from '../core/components.js';
import { showConfirmDialog, showToast, TOAST_ICONS } from '../core/ui.js';

// Long German words show what happens when a label does not fit
const LONG_LABEL = 'Mittwochs-Raid der Schattenfestung für Fortgeschrittene';
const TOAST_TEXTS = {
    success: 'Du bist angemeldet.',
    danger: 'Anmeldung fehlgeschlagen.',
    warning: 'Das Event ist fast voll.',
    info: 'Neue Version verfügbar.'
};

const block = (id, title, classes, body) => `
    <section class="sg-block" id="sg-${id}">
        <h5 class="sg-section-title">${title} <code class="sg-classes">${classes}</code></h5>
        <div class="glass-card p-4 mb-4">${body}</div>
    </section>`;
const row = (label, content) => `<div class="sg-row"><div class="sg-label">${label}</div><div class="sg-samples">${content}</div></div>`;

function buttonBlock() {
    const variants = ['btn-primary', 'btn-secondary', 'btn-ghost', 'btn-danger', 'btn-discord'];
    return block('button', 'Button', '.btn + .btn-primary | -secondary | -ghost | -danger | -discord', [
        row('Varianten', variants.map(variant => `<button type="button" class="btn ${variant}">${variant}</button>`).join('')),
        row('Größen', `
            <button type="button" class="btn btn-primary btn-sm">btn-sm · 32</button>
            <button type="button" class="btn btn-primary">Standard · 40</button>
            <button type="button" class="btn btn-primary btn-lg">btn-lg · 48</button>`),
        row('Mit Symbol', `
            <button type="button" class="btn btn-primary"><i class="bi bi-plus-lg me-2"></i>Event anlegen</button>
            <button type="button" class="btn btn-ghost btn-icon" title="Mehr"><i class="bi bi-three-dots"></i></button>`),
        row('Deaktiviert', variants.map(variant => `<button type="button" class="btn ${variant}" disabled>${variant}</button>`).join('')),
        row('Langer Text', `<button type="button" class="btn btn-secondary">${LONG_LABEL}</button>`)
    ].join(''));
}

function cardBlock() {
    return block('card', 'Karte', '.glass-card, klickbar mit .is-clickable, a oder data-click', `
        <div class="row g-3">
            <div class="col-md-6">
                <div class="glass-card is-clickable p-4">
                    <div class="fw-semibold mb-1">Raid: Nachtfestung</div>
                    <small class="text-muted">Klickbar: reagiert aufs Überfahren</small>
                </div>
            </div>
            <div class="col-md-6">
                <div class="glass-card p-4">
                    <div class="fw-semibold mb-1">Statistik</div>
                    <small class="text-muted">Statisch: bleibt ruhig</small>
                </div>
            </div>
        </div>`);
}

function chipBlock() {
    const statuses = [['', 'Entwurf'], ['chip-warning', 'Ausstehend'], ['chip-success', 'Angenommen'], ['chip-danger', 'Abgelehnt'], ['chip-info', 'Warteliste'], ['chip-accent', 'Raid']];
    const filters = ['Alle', 'Raid', 'Dungeon', 'Social'];
    return block('chip', 'Chip', '.chip + .chip-success | -warning | -danger | -info | -accent, .chip-sm', [
        row('Status', statuses.map(([variant, label]) => `<span class="chip ${variant}">${label}</span>`).join('')),
        row('Klein', statuses.map(([variant, label]) => `<span class="chip chip-sm ${variant}">${label}</span>`).join('')),
        row('Filter', filters.map((label, index) => `<button type="button" class="chip${index === 0 ? ' active' : ''}">${label}</button>`).join('')),
        row('Alte Namen', `
            <span class="badge-pill status-accepted">badge-pill</span>
            <span class="category-pill">category-pill</span>
            <span class="event-status-badge event-status-active">event-status-badge</span>
            <span class="event-category-tag">event-category-tag</span>`),
        row('Langer Text', `<span class="chip chip-info">${LONG_LABEL} ${LONG_LABEL}</span>`)
    ].join(''));
}

function tabsBlock() {
    const tabs = [['drafts', 'Entwürfe', 2], ['active', 'Aktiv', 5], ['archive', 'Archiv', 12]];
    const many = ['Übersicht', 'Anmeldungen', 'Warteliste', 'Aufstellung', 'Kommentare', 'Ankündigungen', 'Protokoll', 'Einstellungen'];
    return block('tabs', 'Tabs', '.nav.nav-pills mit .nav-link, Zähler als .chip.chip-sm', [
        row('Segmente', `
            <ul class="nav nav-pills" role="tablist">${tabs.map(([id, label, count]) => `
                <li class="nav-item" role="presentation">
                    <button type="button" class="nav-link${id === 'active' ? ' active' : ''}" data-bs-toggle="pill" data-bs-target="#sg-tab-${id}" role="tab">${label} <span class="chip chip-sm">${count}</span></button>
                </li>`).join('')}
            </ul>`),
        `<div class="tab-content mb-3">${tabs.map(([id, label]) => `
            <div class="tab-pane fade${id === 'active' ? ' show active' : ''}" id="sg-tab-${id}" role="tabpanel"><small class="text-muted">Inhalt von „${label}“</small></div>`).join('')}
        </div>`,
        row('Viele Einträge', `
            <ul class="nav nav-pills">${many.map((label, index) => `
                <li class="nav-item"><button type="button" class="nav-link${index === 0 ? ' active' : ''}">${label}</button></li>`).join('')}
            </ul>`)
    ].join(''));
}

function dialogBlock() {
    return block('dialog', 'Dialog', '.modal mit .modal-content, -header, -body, -footer', `
        <div class="modal sg-modal-static mb-3" tabindex="-1">
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Event löschen?</h5>
                        <button type="button" class="btn-close" aria-label="Schließen"></button>
                    </div>
                    <div class="modal-body">„Raid: Nachtfestung“ und alle 14 Anmeldungen werden endgültig entfernt.</div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary">Abbrechen</button>
                        <button type="button" class="btn btn-danger">Löschen</button>
                    </div>
                </div>
            </div>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-click="sgShowDialog">Echten Dialog öffnen</button>`);
}

function toastBlock() {
    const types = Object.keys(TOAST_TEXTS);
    return block('toast', 'Toast', "showToast(text, 'success' | 'danger' | 'warning' | 'info')", [
        row('Typen', types.map(type => `
            <div class="toast show toast-${type}" role="status">
                <div class="d-flex align-items-center">
                    <i class="toast-icon bi ${TOAST_ICONS[type]} ms-3"></i>
                    <div class="toast-body">${TOAST_TEXTS[type]}</div>
                </div>
            </div>`).join('')),
        row('Auslösen', `
            <button type="button" class="btn btn-secondary btn-sm" data-click="sgShowToast" data-type="success">success</button>
            <button type="button" class="btn btn-secondary btn-sm" data-click="sgShowToast" data-type="danger">danger</button>
            <button type="button" class="btn btn-secondary btn-sm" data-click="sgShowToast" data-type="warning">warning</button>
            <button type="button" class="btn btn-secondary btn-sm" data-click="sgShowToast" data-type="info">info</button>`)
    ].join(''));
}

function emptyStateBlock() {
    const refresh = '<button type="button" class="btn btn-secondary btn-sm" data-click="sgShowToast" data-type="info">Aktualisieren</button>';
    return block('empty-state', 'Leerzustand', 'emptyState({ icon, title, text, action })', `
        <div class="row g-3">
            <div class="col-md-6">${emptyState({ icon: 'calendar-x', title: 'Noch keine Events', text: 'Sobald ein Event geplant ist, erscheint es hier.', action: refresh })}</div>
            <div class="col-md-6">${emptyState({ title: 'Keine Treffer' })}</div>
        </div>`);
}

function skeletonBlock() {
    return block('skeleton', 'Skeleton', '.skeleton + -text | -title | -img | -chip | -avatar', [
        row('Bausteine', `
            <div class="skeleton skeleton-avatar"></div>
            <div class="skeleton skeleton-chip"></div>
            <div class="skeleton skeleton-chip"></div>`),
        `<div class="glass-card p-0">
            <div class="skeleton skeleton-img"></div>
            <div class="skeleton-card-body p-4">
                <div>
                    <div class="skeleton skeleton-title mb-3"></div>
                    <div class="skeleton skeleton-text"></div>
                    <div class="skeleton skeleton-text is-short"></div>
                </div>
                <div class="d-flex gap-2 mt-3">
                    <div class="skeleton skeleton-chip"></div>
                    <div class="skeleton skeleton-chip"></div>
                </div>
            </div>
        </div>`
    ].join(''));
}

function avatarBlock() {
    const sizes = ['sm', undefined, 'lg', 'xl'];
    const name = 'Lyonel Berzen';
    return block('avatar', 'Avatar', 'avatar({ url, name, size }) → .avatar + .avatar-sm | -lg | -xl', [
        row('Bild', sizes.map(size => avatar({ url: '/logo.svg', name, size })).join('')),
        row('Initialen', sizes.map(size => avatar({ name, size })).join('')),
        // The address answers with the app page, so the image fails and the fallback shows
        row('Bild fehlt', avatar({ url: '/img/kein-bild.png', name, size: 'lg' }) + avatar({ url: '/img/kein-bild.png', name: 'Mo', size: 'lg' })),
        row('Stapel', `<div class="avatar-stack">${avatar({ url: '/logo.svg', name })}${avatar({ name: 'Mara Klein' })}${avatar({ name: 'Tom Sommer' })}<span class="avatar avatar-more">+3</span></div>`)
    ].join(''));
}

/**
 * Render the nine component blocks.
 *
 * @param {Element} container -> #sg-components.
 * @returns {void}
 */
export function renderDebugComponents(container) {
    container.innerHTML = [
        buttonBlock(), cardBlock(), chipBlock(), tabsBlock(), dialogBlock(),
        toastBlock(), emptyStateBlock(), skeletonBlock(), avatarBlock()
    ].join('');
}

registerActions({
    sgShowDialog: () => showConfirmDialog('„Raid: Nachtfestung“ und alle 14 Anmeldungen werden endgültig entfernt.', 'Löschen'),
    sgShowToast: (el) => showToast(TOAST_TEXTS[el.dataset.type] || 'Hinweis', el.dataset.type)
});
```

- [ ] **Step 5: `public/js/pages/debug.js` neu schreiben**

Die ganze Datei ersetzen durch:
```js
/**
 * Styleguide (#debug, only with DEBUG_MODE=true): the tokens read from
 * tokens.css, the nine components (debug-components.js) and the page styles
 * that are not part of the library yet ("Bestand").
 */
import { registerActions } from '../core/actions.js';
import { contrastRatio, parseColor } from '../core/contrast.js';
import { escapeHtml } from '../core/ui.js';
import { renderDebugComponents } from './debug-components.js';

// Token groups in display order: name pattern and how a sample is drawn
const TOKEN_GROUPS = [
    { title: 'Flächen', kind: 'color', match: /^--bg-/ },
    { title: 'Text', kind: 'color', match: /^--text-/ },
    { title: 'Rahmen', kind: 'color', match: /^--border-/ },
    { title: 'Akzent', kind: 'color', match: /^--(accent|on-accent)/ },
    { title: 'Status und Discord', kind: 'color', match: /^--(on-)?(success|warning|danger|info|discord)/ },
    { title: 'Schrift', kind: 'text', match: /^--font-(body|logo)$/ },
    { title: 'Schriftgrößen', kind: 'font-size', match: /^--font-size-/ },
    { title: 'Abstände', kind: 'space', match: /^--space-/ },
    { title: 'Radien', kind: 'radius', match: /^--radius/ },
    { title: 'Schatten', kind: 'shadow', match: /^--shadow-/ },
    { title: 'Ebenen', kind: 'text', match: /^--z-/ },
    { title: 'Bewegung', kind: 'text', match: /^--(duration-|ease-|transition)/ }
];
// CSS property that shows a token on its sample element
const SAMPLE_PROPERTY = { color: 'background', 'font-size': 'font-size', space: 'width', radius: 'border-radius', shadow: 'box-shadow' };
// Contrast is shown against the card surface, where most text sits
const CONTRAST_SURFACE = '--bg-card';

const LEGACY_BUTTONS = ['btn-outline-primary', 'btn-outline-success', 'btn-outline-warning', 'btn-outline-danger', 'btn-warning', 'btn-link'];
const ANIMATIONS = [
    { label: 'Fade In', run: () => gsap.fromTo('.sg-anim-demo-item', { opacity: 0 }, { opacity: 1, duration: 0.6, stagger: 0.1 }) },
    { label: 'Slide Up', run: () => gsap.fromTo('.sg-anim-demo-item', { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.1, ease: 'power3.out' }) },
    { label: 'Stagger', run: () => gsap.from('.sg-anim-demo-item', { scale: 0.8, opacity: 0, duration: 0.4, stagger: 0.15, ease: 'back.out(1.7)' }) },
    { label: 'Bounce', run: () => gsap.from('.sg-anim-demo-item', { y: -30, duration: 0.5, stagger: 0.1, ease: 'bounce.out' }) },
    { label: 'Shake', run: () => gsap.to('.sg-anim-demo-item', { x: 10, duration: 0.07, repeat: 5, yoyo: true, ease: 'power1.inOut', stagger: 0.05 }) },
    { label: 'Pulse', run: () => gsap.to('.sg-anim-demo-item', { scale: 1.05, duration: 0.3, repeat: 3, yoyo: true, ease: 'power1.inOut', stagger: 0.1 }) }
];
const ICONS = [
    'calendar-event', 'calendar-check', 'calendar-x', 'people', 'person', 'person-fill',
    'gear', 'gear-fill', 'star', 'star-fill', 'trophy', 'trophy-fill',
    'check-circle', 'check-circle-fill', 'x-circle', 'x-circle-fill',
    'exclamation-triangle', 'exclamation-triangle-fill', 'info-circle', 'info-circle-fill',
    'bell', 'bell-fill', 'chat-dots', 'chat-dots-fill', 'discord', 'robot',
    'moon-stars', 'moon-stars-fill', 'sun', 'lightning', 'lightning-fill',
    'list-check', 'journal-text', 'inbox', 'hourglass-split', 'shield-check',
    'bug', 'bug-fill', 'palette', 'palette-fill', 'code-slash', 'terminal'
];

/**
 * Contrast of a colour on a surface, as text for the styleguide.
 *
 * @param {string} value -> Token value, e.g. "#8f8f9a".
 * @param {string} surface -> Surface colour.
 * @returns {string} -> e.g. "5,62 : 1"; "" when one value is no opaque plain colour.
 */
export function contrastLabel(value, surface) {
    const color = parseColor(value);
    const background = parseColor(surface);
    if (!color || !background || color.a !== 1 || background.a !== 1) return '';
    return `${contrastRatio(color, background).toFixed(2).replace('.', ',')} : 1`;
}

// Names of the custom properties that tokens.css defines on :root
function readTokenNames() {
    for (const sheet of document.styleSheets) {
        if (!sheet.href || !sheet.href.includes('/css/tokens.css')) continue;
        const names = [];
        for (const rule of sheet.cssRules) {
            if (rule.selectorText !== ':root') continue;
            for (const name of rule.style) {
                if (name.startsWith('--')) names.push(name);
            }
        }
        return names;
    }
    return [];
}

function renderTokens(container) {
    const names = readTokenNames();
    const root = getComputedStyle(document.documentElement);
    const valueOf = (name) => root.getPropertyValue(name).trim();
    const surface = valueOf(CONTRAST_SURFACE);
    container.innerHTML = TOKEN_GROUPS.map(group => `
        <h5 class="sg-section-title">${group.title}</h5>
        <div class="sg-token-grid mb-4">${names.filter(name => group.match.test(name)).map(name => `
            <div class="sg-token" data-token="${escapeHtml(name)}" data-kind="${group.kind}">
                <div class="sg-token-sample sg-token-sample-${group.kind}"></div>
                <div class="sg-token-name">${escapeHtml(name)}</div>
                <div class="sg-token-value">${escapeHtml(valueOf(name))}</div>
                <div class="sg-token-contrast">${group.kind === 'color' ? contrastLabel(valueOf(name), surface) : ''}</div>
            </div>`).join('')}
        </div>`).join('');
    // Samples get their value through the CSSOM; new markup carries no style attributes
    for (const item of container.querySelectorAll('.sg-token')) {
        const property = SAMPLE_PROPERTY[item.dataset.kind];
        if (property) item.querySelector('.sg-token-sample').style.setProperty(property, `var(${item.dataset.token})`);
    }
}

function renderLegacy() {
    document.getElementById('sg-buttons').innerHTML = LEGACY_BUTTONS.map(variant =>
        `<button type="button" class="btn ${variant}">${variant}</button>`
    ).join('');

    document.getElementById('sg-cards').innerHTML = `
      <div class="row g-3 mb-4">
        <div class="col-md-4">
          <div class="stat-card">
            <div class="stat-icon"><i class="bi bi-star text-accent"></i></div>
            <div class="stat-value">42</div>
            <div class="stat-label">stat-card</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="profile-reg-card">
            <div class="profile-reg-info">
              <h6>profile-reg-card</h6>
              <small>Kategorie · 01. Jan 2026</small>
            </div>
            <span class="chip chip-success">Angenommen</span>
          </div>
        </div>
        <div class="col-md-4">
          <div class="profile-badge-card unlocked p-3 text-center">
            <div class="fs-2">🏆</div>
            <div class="fw-semibold mt-1">profile-badge-card</div>
            <small class="text-muted">unlocked</small>
          </div>
        </div>
      </div>`;

    document.getElementById('sg-spinners').innerHTML = `
      <div class="spinner-border spinner-border-sm text-secondary" title="spinner-border sm"></div>
      <div class="spinner-border text-accent" title="spinner-border md"></div>
      <div class="spinner-grow spinner-grow-sm text-success" title="spinner-grow sm"></div>
      <div class="spinner-grow text-warning" title="spinner-grow md"></div>`;

    document.getElementById('sg-alerts').innerHTML = `
      <div class="alert alert-success mb-2">alert-success — Aktion erfolgreich abgeschlossen.</div>
      <div class="alert alert-warning mb-2">alert-warning — Bitte beachte diesen Hinweis.</div>
      <div class="alert alert-danger mb-2">alert-danger — Ein Fehler ist aufgetreten.</div>
      <div class="alert alert-info mb-0">alert-info — Informationstext für den Nutzer.</div>`;

    document.getElementById('sg-anim-buttons').innerHTML = ANIMATIONS.map((animation, index) =>
        `<button type="button" class="btn btn-secondary btn-sm" data-click="sgRunAnimation" data-index="${index}">${animation.label}</button>`
    ).join('');

    document.getElementById('sg-icons').innerHTML = ICONS.map(icon =>
        `<div class="sg-icon-item" title="bi-${icon}">
          <i class="bi bi-${icon}"></i>
          <span>${icon}</span>
        </div>`
    ).join('');
}

export function showDebugSection() {
    if (!window.DEBUG_MODE) return;
    document.getElementById('debug-section').style.display = 'block';
    renderTokens(document.getElementById('sg-tokens'));
    renderDebugComponents(document.getElementById('sg-components'));
    renderLegacy();
    if (typeof gsap !== 'undefined') {
        gsap.from('.sg-section-title', { y: 15, opacity: 0, duration: 0.3, stagger: 0.05, ease: 'power3.out' });
    }
}

export function sgRunAnimation(index) {
    if (ANIMATIONS[index]) ANIMATIONS[index].run();
}

registerActions({
    sgRunAnimation: (el) => sgRunAnimation(Number(el.dataset.index))
});
```

In `public/js/main.js` nach `import './pages/debug.js';` einfügen:
```js
import './pages/debug-components.js';
```

- [ ] **Step 6: Styleguide-Regeln in `style.css`**

Im Block `DEBUG / STYLING GUIDE` die Regeln `.sg-color-grid`, `.sg-color-swatch`, `.sg-color-block`, `.sg-color-name` und `.sg-color-val` samt Kommentar `/* Color swatches */` löschen und an ihrer Stelle einfügen:
```css
/* The three parts: Tokens, Komponenten, Bestand */
.sg-part-title {
  margin: var(--space-48) 0 var(--space-16);
  padding-bottom: var(--space-8);
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
  font-size: var(--font-size-2xl);
  font-weight: 700;
}

/* Class names next to a component title */
.sg-classes {
  margin-left: var(--space-8);
  color: var(--accent-text);
  font-size: var(--font-size-xs);
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
}

/* Token tiles; the sample gets its value from pages/debug.js */
.sg-token-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-12);
}

.sg-token {
  min-width: 0;
  padding: var(--space-12);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius);
  background: var(--bg-card);
}

.sg-token-sample {
  height: 2.5rem;
  margin-bottom: var(--space-8);
}

.sg-token-sample-color {
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
}

.sg-token-sample-font-size {
  overflow: hidden;
  color: var(--text-primary);
  line-height: 1;
}

.sg-token-sample-font-size::before {
  content: 'Aa';
}

.sg-token-sample-space {
  max-width: 100%;
  height: var(--space-12);
  border-radius: var(--radius-pill);
  background: var(--accent-fill);
}

.sg-token-sample-radius {
  width: 4rem;
  border: 1px solid var(--border-accent);
  background: var(--bg-tint-2);
}

.sg-token-sample-shadow {
  width: 4rem;
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
}

.sg-token-sample-text {
  display: none;
}

.sg-token-name {
  color: var(--text-primary);
  font-size: var(--font-size-xs);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.sg-token-value,
.sg-token-contrast {
  color: var(--text-muted);
  font-size: var(--font-size-xs);
  overflow-wrap: anywhere;
}

/* One line of examples inside a component block */
.sg-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-8) var(--space-16);
  margin-bottom: var(--space-16);
}

.sg-row:last-child {
  margin-bottom: 0;
}

.sg-label {
  flex: 0 0 7rem;
  color: var(--text-muted);
  font-size: var(--font-size-xs);
}

.sg-samples {
  display: flex;
  flex: 1 1 16rem;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-8);
  min-width: 0;
}

/* A dialog shown in the page flow instead of as an overlay */
.sg-modal-static {
  position: static;
  display: block;
  height: auto;
  overflow: visible;
}

.sg-modal-static .modal-dialog {
  max-width: 28rem;
  margin: 0;
}
```

- [ ] **Step 7: Tests laufen grün**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/styleguide.test.js test/cssRules.test.js test/frontendCsp.test.js test/frontendModules.test.js`
Expected: PASS, kein `fail`.

Run: `npm run test:e2e 2>&1 | tail -8`
Expected: alle Tests `passed`, auch die drei aus `styleguide.spec.js` in beiden Projekten.

Ragt im Test `long content stays inside the page` ein Element heraus, nennt die Fehlermeldung dessen Klasse. Ursache ist dann eine feste Breite oder ein fehlendes `min-width: 0` an dieser Klasse in Step 6 oder in `components.css`.

- [ ] **Step 8: Selbst ansehen**

```bash
DEBUG_MODE=true npm run dev:mock
```
`http://localhost:3000` öffnen, als Admin anmelden, im Menü „Debug“ wählen. Prüfen: Token-Kacheln zeigen Farbe, Wert und Kontrast; alle neun Blöcke sind da; Tabs wechseln; ein Toast je Typ hat eine andere Kante; der Dialog öffnet und schließt; bei 390 px Breite (DevTools) scrollt die Seite nicht seitlich. Server mit Strg+C beenden.

- [ ] **Step 9: Wiki nachziehen**

`docs/wiki/modules/frontend-app.md`: die Zeile `| \`pages/debug.js\` | styling guide | \`showDebugSection\`, \`sgRunAnimation\` |` ersetzen durch:
```markdown
| `pages/debug.js` | styleguide: tokens and remaining page styles | `showDebugSection`, `contrastLabel(value, surface)`, `sgRunAnimation` |
| `pages/debug-components.js` | styleguide: the nine components | `renderDebugComponents(container)`; actions `sgShowDialog`, `sgShowToast` |
```

`docs/wiki/modules/frontend-markup.md`: unter `## Rules` die Zeile `- When \`DEBUG_MODE=true\`, the \`#debug\` "styling guide" section …` ersetzen durch:
```markdown
- When `DEBUG_MODE=true`, the `#debug` styleguide shows every token (read from `tokens.css`, with its contrast on a card) and every component with its class names — look there before adding UI.
```

Run: `npm run wiki`

- [ ] **Step 10: Commit**

```bash
npm test 2>&1 | tail -8
git add public/index.html public/js/pages/debug.js public/js/pages/debug-components.js public/js/main.js public/css/style.css playwright.config.js test/styleguide.test.js e2e/styleguide.spec.js docs/wiki
git commit -m "Rebuild the styleguide around tokens and the nine components

The old styling guide listed 16 colours by hand and drifted from the
stylesheet. It now reads the tokens from tokens.css, shows the contrast
of each colour, and has one block per component with all variants. A
browser test walks through it on desktop and phone width.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Obergrenzen, Abschlussvergleich und Doku

**Files:**
- Modify: `test/cssRules.test.js`
- Modify: `docs/wiki/modules/frontend-markup.md`, `docs/wiki/ops/testing.md`, `docs/wiki/concepts/security.md`, `docs/wiki/index.md`
- Modify: `CLAUDE.md`, `server.js` (Kommentar), `docs/superpowers/plans/2026-10-07-dems-3.0-prioplan.md`
- Create: `data/d02/final.txt`, `data/d02/mr.md` (nicht im Repo)

**Interfaces:**
- Consumes: alles aus Task 1–12
- Produces: Konstanten `STYLE_ATTRIBUTE_BUDGET` und `IMPORTANT_BUDGET` in `test/cssRules.test.js`, die D-16 und spätere Tickets senken.

- [ ] **Step 1: Failing test für die Obergrenzen**

In `test/cssRules.test.js` unter `RAW_COLOR` einfügen:
```js
// Upper limits that only go down: lower the number when you remove some,
// never raise it. Before D-02 there were 132 style attributes and 57
// !important. D-16 brings the style attributes to 0.
const STYLE_ATTRIBUTE_BUDGET = 132;
const IMPORTANT_BUDGET = 57;
```

Am Dateiende anhängen:
```js
test('the number of style attributes matches its budget', () => {
    const count = [INDEX_HTML, ...frontendSources().map(entry => entry.source)]
        .reduce((sum, source) => sum + (source.match(/style="/g) || []).length, 0);
    assert.equal(count, STYLE_ATTRIBUTE_BUDGET, `found ${count} style attributes; lower STYLE_ATTRIBUTE_BUDGET if you removed some, otherwise use a class`);
});

test('the number of !important matches its budget', () => {
    const count = allRules().flatMap(rule => rule.declarations).filter(declaration => /!important$/.test(declaration.value)).length;
    assert.equal(count, IMPORTANT_BUDGET, `found ${count} !important; lower IMPORTANT_BUDGET if you removed some, otherwise fix the selector or the load order`);
});
```

Run: `node --test test/cssRules.test.js 2>&1 | grep -E 'found [0-9]+'`
Expected: zwei Zeilen `found <n> style attributes …` und `found <m> !important …` mit `n` kleiner als 132 und `m` kleiner als 57.

Ist eine der Zahlen größer als der Ausgangswert, hat ein früherer Task etwas hinzugefügt. Dann die neuen Stellen suchen (`git diff main -- public | grep '^+' | grep -E 'style="|!important'`) und durch Klassen bzw. passende Selektoren ersetzen, bevor es weitergeht.

- [ ] **Step 2: Konstanten auf den gemessenen Stand setzen**

Die beiden Zahlen aus Step 1 als `STYLE_ATTRIBUTE_BUDGET` und `IMPORTANT_BUDGET` eintragen.

Run: `node --test test/cssRules.test.js`
Expected: PASS, 14 Tests.

- [ ] **Step 3: Abschlussvergleich**

```bash
node scripts/style-snapshot.js --out data/d02/final.json
node scripts/style-snapshot.js --compare data/d02/before.json data/d02/final.json > data/d02/final.txt
head -5 data/d02/final.txt; wc -l data/d02/final.txt
```

`data/d02/final.txt` durchgehen. Jede Gruppe muss zu einem Punkt aus „Gewollte sichtbare Änderungen“ der Spec passen:

| Gruppe in der Ausgabe | Punkt der Spec |
|---|---|
| `color`/`border-top-color` auf `rgb(143, 143, 154)`, `rgb(167, 139, 250)`, `rgb(248, 113, 113)` | Hilfetext, violetter Text, Fehlertext |
| Buttons: `background-color`, `background-image: … -> none`, `min-height`, Radius, Innenabstand | Hauptbutton flach, einheitliche Höhe und Radius |
| `a` ohne Klasse: `color` | Links violett |
| `div#app-toast` und Geschwister, `removed`/`added` im Toast | Toasts mit Symbol und Kante |
| `div.modal-content`, `-header`, `-footer` | Dialoge einheitlich |
| `font-size` und Folgewerte | Schriftgrößen auf der Skala |
| andere Deckkraft derselben Farbe bei `background-color`, `border-top-color`, `box-shadow` | Tönungen auf weniger Stufen |
| `border-top-left-radius` | Radien auf weniger Stufen |
| `h1.info-title`: `font-family` | Info-Titel in Inter |
| `div.maintenance-banner`, `div.planned-maintenance-banner` | Banner in Statusfarben |
| Chips: Innenabstand, Schriftgröße, `min-height` | Chips aus einer Definition |
| `z-index` der fünf Regeln aus Task 11 | benannte Ebenen |

Bleibt eine Gruppe übrig, die zu keinem Punkt passt, ist sie ein Fehler: Ursache im zugehörigen Task suchen, beheben, Vergleich wiederholen. Die Hover-Änderung der Karten zeigt der Vergleich nicht (er misst den Ruhezustand); sie ist in Task 7 per Test abgesichert.

- [ ] **Step 4: `docs/wiki/modules/frontend-markup.md` auf den Endstand bringen**

Die TL;DR-Zeile ersetzen durch:
```markdown
> TL;DR: `index.html` contains every section and modal statically; JS toggles `display`. Styling is three files, loaded in this order: `tokens.css` (every colour, font size, spacing, radius, layer and shadow as a CSS variable), `components.css` (Bootstrap bridge and the nine components) and `style.css` (page-specific rules in banner-commented blocks). No raw colour, px/rem font size or z-index ≥ 10 outside `tokens.css`. Find things by element id (HTML) or block header (CSS) with `grep -n`.
```

Die Abschnitte `## style.css blocks`, `## components.css blocks` und `## Theme variables (…)` ganz ersetzen durch:
```markdown
## Stylesheets (`public/css/`)

| File | Content | Rule |
|---|---|---|
| `tokens.css` | one `:root` block with all design tokens (dark scheme) | the only file with colour values, font sizes in px/rem and layer numbers |
| `components.css` | BOOTSTRAP BRIDGE → BUTTON → DIALOG → TABS → TOAST → CARD → CHIP → SKELETON → EMPTY STATE → AVATAR | values only from tokens; `!important` only in the colour helpers |
| `style.css` | page-specific blocks, see below | values only from tokens; one rule per selector list |

`style.css` blocks (grep the header text): LOADING SCREEN → NAVBAR → SECTIONS → EVENT CARDS (+ Event Series, Rendered Markdown) → COUNTDOWN → CATEGORY PILLS (filter bar) → BADGES (upper-case rule of the event chips) → STATS CARDS → DATE & TIME → WAITLIST → FORMS → TABLE → FORM BUILDER → ENTITY PICKER → LOGIN CARD → ADMIN EVENT CARD → CONFETTI → PROFILE SECTION → RESPONSIVE → UTILITY → INFO SECTION → EASYMDE CUSTOMIZATION → Participant Warning Badges → Calendar View → Event Comments → BOT CONTROL CENTER → EVENT WIZARD STEPPER → MAINTENANCE MODE → EVENT DETAIL (banner, sidebar, capacity bar, participants) → EVENT CARD (gradient placeholder, updated layout) → LOCATION AUTOCOMPLETE → DEBUG / STYLING GUIDE → ROLE SLOTS → DATE POLLS.

## Tokens (`tokens.css`)

| Group | Tokens |
|---|---|
| Surfaces | `--bg-primary`, `--bg-secondary`, `--bg-card`, `--bg-glass`, `--bg-glass-hover`, `--bg-tint-1/2/3` (white 4/8/12 %), `--bg-inset`, `--bg-scrim` |
| Text | `--text-primary`, `--text-secondary`, `--text-muted` |
| Borders | `--border-subtle`, `--border-strong`, `--border-accent` |
| Accent | `--accent` (brand violet: borders, icons, glows), `--accent-light`, `--accent-dark`, `--accent-text` (violet text and links), `--accent-fill` + `--accent-fill-hover` + `--on-accent` (solid fill and the text on it), `--accent-tint-1/2`, `--accent-glow` |
| Status | per `success`, `warning`, `danger`, `info`: `--<s>` (text), `--<s>-bg`, `--<s>-border`, `--<s>-fill`, `--on-<s>`; plus `--danger-fill-hover`; Discord: `--discord`, `--discord-hover`, `--on-discord` |
| Type | `--font-body` (Inter), `--font-logo` (UnifrakturCook, only `.loading-logo` and `.brand-text`), `--font-size-xs` 12 px … `-sm` 14, `-md` 16, `-lg` 18, `-xl` 20, `-2xl` 24, `-3xl` 32, `-4xl` 40, `-display` and `-logo` (fluid) |
| Spacing | `--space-4`, `-8`, `-12`, `-16`, `-24`, `-32`, `-48`, `-64` (name = pixels; not Bootstrap's `p-3` numbering) |
| Radius | `--radius-sm` 8 px, `--radius` 12 px, `--radius-lg` 16 px, `--radius-pill` |
| Layers | `--z-dropdown` 1000 < `--z-sticky` < `--z-nav` < `--z-banner` < `--z-dialog` < `--z-toast` < `--z-overlay` 2000 (Bootstrap's scale); local stacking from -1 to 9 may stay a number |
| Shadows, motion | `--shadow-sm/md/lg`, `--shadow-glow`, `--shadow-ring`; `--duration-fast/base/slow`, `--ease-standard`, `--transition` |

Contrast rules, enforced by `test/designTokens.test.js` (WCAG AA): every text colour (`--text-*`, `--accent-text`, the four status colours) has at least 4.5:1 on every surface and on `--bg-tint-1`; on `--bg-tint-2` and `--bg-tint-3` only `--text-primary` and `--text-secondary` do, so use only those there; a status colour has 4.5:1 on its own `-bg`; `--on-*` has 4.5:1 on its fill. White text never sits on `--accent`, it sits on `--accent-fill`.

## Components (`components.css`)

| Component | Classes | Old names that still work |
|---|---|---|
| Button | `.btn` + `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-discord`; `.btn-sm` 32 px, default 40 px, `.btn-lg` 48 px; `.btn-icon` | `.btn-accent` = primary; `.btn-outline-light`, `.btn-outline-secondary` = secondary; also themed: `.btn-warning`, `.btn-outline-primary/success/warning/danger` |
| Card | `.glass-card`; reacts to hover only as `.glass-card[data-click]`, `a.glass-card` or `.glass-card.is-clickable` | – |
| Chip | `.chip` + `.chip-success/warning/danger/info/accent`, `.chip-sm`; a `<button class="chip">` filters, `.active` marks the chosen one | `.badge-pill` (+ `.status-pending/accepted/rejected/waitlisted`), `.category-pill`, `.event-status-badge` (+ `.event-status-active/archived`), `.event-category-tag` |
| Tabs | `.nav.nav-pills` with `.nav-link` and `data-bs-toggle="pill"`; counter as `.chip.chip-sm`; scrolls sideways when the entries do not fit | – |
| Dialog | Bootstrap `.modal` markup | – |
| Toast | `showToast(message, type)`; class `toast-<type>` colours the edge and the icon | – |
| Empty state | `emptyState({ icon, title, text, action })` → `.empty-state` | – |
| Skeleton | `.skeleton` + `.skeleton-text` (`.is-short`), `-title`, `-img`, `-chip`, `-avatar`, `-card-body` | – |
| Avatar | `avatar({ url, name, size })` → `.avatar` (36 px), `.avatar-sm` 24, `.avatar-lg` 64, `.avatar-xl` 96, `.avatar-initials`; `.avatar-stack`, `.avatar-more` | the ten page-specific avatar classes stay until D-09 |

The Bootstrap bridge sets Bootstrap's own variables from the tokens (`--bs-body-*`, `--bs-btn-*`, `--bs-modal-*`, `--bs-toast-*`, `--bs-nav-pills-*`, `--bs-alert-*`) and overrides the colour helpers `.text-*`, `.bg-*`, `.text-bg-*` for primary, success, warning, danger and info. `.text-muted` renders `--text-secondary` (Bootstrap ties it to its "secondary" colour); use `.text-body-tertiary` for `--text-muted`.

```

Unter `## Rules` am Ende anfügen:
```markdown
- New CSS uses tokens only; a missing value becomes a new token in `tokens.css` (the contrast test must stay green). `test/cssRules.test.js` fails on a raw colour, a px/rem font size, a z-index ≥ 10, a px radius, a selector list defined twice, and on more `style` attributes or `!important` than its budgets allow.
- Build UI from the components above; add a variant to `components.css` and to the styleguide (`pages/debug-components.js`) instead of a page-specific copy.
- Hover feedback (glow, lift) only on elements that do something when clicked.
- The `style` attributes in `index.html` and the modules are legacy (budget in `test/cssRules.test.js`, D-16 removes them); new markup uses classes, dynamic values go through `element.style.setProperty`.
```

Im Frontmatter `sources:` zusätzlich `test/cssRules.test.js` und `test/designTokens.test.js` eintragen. Die Blockliste gegenprüfen:
```bash
grep -A1 -E '^/\* ═+ \*/$' public/css/style.css | grep -E '^/\* [A-Z]' | sed -E 's/^\/\* *//; s/ *\*\/$//'
```
Expected: dieselben Blocknamen in derselben Reihenfolge wie in der Liste oben (ohne die klein geschriebenen Unterabschnitte). Weicht etwas ab, die Liste im Wiki an die Datei anpassen.

- [ ] **Step 5: Übrige Wiki-Knoten**

`docs/wiki/ops/testing.md`:
- Frontmatter `sources:` ergänzen um `e2e/styleguide.spec.js`, `scripts/style-snapshot.js`, `test/cssSource.js`, `test/cssRules.test.js`, `test/designTokens.test.js`, `test/components.test.js`, `test/styleguide.test.js`, `test/contrast.test.js`, `test/styleSnapshot.test.js`.
- In die Tabelle der Testdateien (nach der Zeile zu `vendorAssets.test.js`) einfügen:
  ```markdown
  | `designTokens.test.js` | every required token exists in `public/css/tokens.css`; WCAG AA contrast of every text colour on every surface, on the tints and on the solid fills (maths: `public/js/core/contrast.js`, tested in `contrast.test.js`) |
  | `cssRules.test.js` | guards for `components.css` and `style.css` (reader: `test/cssSource.js`): load order in `index.html`, no raw colour, px/rem font size, z-index ≥ 10 or px radius, no selector list twice, logo font only on the logo, component selectors present and not restyled in `style.css`, budgets for `style` attributes and `!important` |
  | `components.test.js` | `showToast` (type class, icon, unknown type, missing icon element), `renderSkeletonEvents`, `initialsOf`, `avatar`, `emptyState` (escaping) |
  | `styleguide.test.js` | the styleguide renders the nine component blocks, has its three parts in `index.html`, sets no `style` attributes; `contrastLabel` |
  | `styleSnapshot.test.js` | comparison logic of `scripts/style-snapshot.js` |
  ```
- Im Abschnitt `## Browser smoke tests` nach dem Punkt zu `e2e/tour.spec.js` einfügen:
  ```markdown
  - `e2e/styleguide.spec.js`: opens `#debug` as admin (the test server runs with `DEBUG_MODE=true`) and checks that the tokens and all nine components render, nothing reaches beyond the page width, many tabs scroll sideways on the phone, toast types differ and the confirm dialog opens.
  ```
- Am Ende des Abschnitts einen neuen Abschnitt anfügen:
  ```markdown
  ## Comparing the look before and after (`scripts/style-snapshot.js`)

  For CSS refactorings that should not change the look: `node scripts/style-snapshot.js --out data/before.json` starts its own mock server on port 3124, logs in as admin, visits the core pages on 1440 px and 390 px and writes the computed styles of every element (hidden dialogs included, `#debug-section` excluded). After the change write a second file and run `node scripts/style-snapshot.js --compare data/before.json data/after.json`: one line per property and value pair with the number of elements and sample labels. It records the resting state only (no hover, no focus). Not part of `npm test`; needs `npx playwright install chromium`.
  ```

`docs/wiki/concepts/security.md`: in der Zeile `| H-05 | …` den Schluss `` `style-src` keeps `'unsafe-inline'` until D-02 removes the `style` attributes `` ersetzen durch `` `style-src` keeps `'unsafe-inline'` until D-16 removes the `style` attributes (their number is pinned by a budget in `test/cssRules.test.js`) ``.

`docs/wiki/index.md`: die Zeile `` | `public/index.html`, `public/css/style.css` | frontend-markup | `` ersetzen durch `` | `public/index.html`, `public/css/tokens.css`, `public/css/components.css`, `public/css/style.css` | frontend-markup | `` und nach der Zeile `` | `e2e/*`, `playwright.config.js` | testing | `` einfügen: `` | `scripts/style-snapshot.js` | testing | ``.

- [ ] **Step 6: `CLAUDE.md`, `server.js`, Prio-Plan**

`CLAUDE.md`:
- Zeilenzahlen messen: `wc -l public/index.html public/css/*.css`. Unter „Save tokens“ in der Zeile „Never read these files whole“ die Angaben zu `public/css/style.css` und `public/index.html` auf die gemessenen Werte setzen (auf Zehner gerundet) und `public/css/components.css` mit seiner Zeilenzahl ergänzen. Den Satz danach ergänzen um: `` For CSS, `docs/wiki/modules/frontend-markup.md` lists tokens, components and blocks. ``
- Unter „Rules“ nach dem Punkt „**Frontend:** …“ einen Punkt einfügen:
  ```markdown
  - **Styles:** colours, font sizes, spacing, radii, layers and shadows only as tokens from `public/css/tokens.css` (no raw value in `components.css` or `style.css`; `npm test` checks it and the AA contrast). Build UI from the components in `public/css/components.css` (button, card, chip, tabs, dialog, toast, empty state, skeleton, avatar; helpers `avatar()`, `emptyState()` in `public/js/core/components.js`); the styleguide is `#debug` with `DEBUG_MODE=true`. No new `style="…"` attributes.
  ```

`server.js`: den Kommentar
```js
            // styles keep 'unsafe-inline' until D-02 removes the style attributes.
```
ersetzen durch:
```js
            // styles keep 'unsafe-inline' until D-16 removes the style attributes (budget: test/cssRules.test.js).
```

`docs/superpowers/plans/2026-10-07-dems-3.0-prioplan.md`: in der Tabelle von „M2 · Design 3.0“ nach der Zeile `| D-15 | …` einfügen (die gemessene Zahl aus Step 2 steht im Test, hier bleibt der Ausgangswert):
```markdown
| D-16 | P1 | `style`-Attribute entfernen, CSP für Stile verschärfen | Vor D-02 standen 132 `style="…"`-Attribute in `index.html` und den Modulen; deshalb erlaubt die CSP `'unsafe-inline'` für Stile (Rest von Audit H-05). D-01 hatte das für D-02 angekündigt; es wandert hierher, weil D-04 bis D-08 die Seiten vorher neu bauen. → Restliche Attribute durch Klassen ersetzen, die Obergrenze in `test/cssRules.test.js` auf 0 senken, danach `style-src 'self'` und `style-src-attr 'none'`. | S | D-04, D-05, D-07, D-08 |
```

Run: `npm run wiki`

- [ ] **Step 7: Alles grün**

```bash
npm test 2>&1 | tail -8
npm run test:e2e 2>&1 | tail -6
git status --short
```
Expected: `# fail 0`; Playwright ohne `failed`; `git status` zeigt nur die Dateien dieses Tasks und `package-lock.json` (bleibt unangetastet), nichts aus `data/`.

- [ ] **Step 8: Commit**

```bash
git add test/cssRules.test.js docs/wiki CLAUDE.md server.js docs/superpowers/plans/2026-10-07-dems-3.0-prioplan.md
git commit -m "Pin the style attribute and !important counts, document the design system

Both numbers went down in this ticket; a budget test keeps them from
creeping back up until D-16 removes the style attributes and tightens
the CSP for styles. The wiki, CLAUDE.md and the priority plan describe
tokens, components and the rules the guard tests enforce.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Text für den Merge Request vorbereiten**

`data/d02/mr.md` schreiben (deutsch, Abschnitte Problem / Ursache / Änderung / Verifikation):
- **Titel:** `D-02: Design-Tokens und Komponenten-Bibliothek`
- **Problem:** die Befunde aus dem Überblick der Spec (182 Farbwerte, 28 Schriftgrößen, 55 doppelte Selektoren, Kontraste unter 4,5:1).
- **Ursache:** Variablen gab es nur für Farben, Schrift und Radius; Bootstrap wurde mit `!important` überschrieben; Blöcke wurden kopiert statt geändert.
- **Änderung:** die drei Stylesheets, die neun Komponenten mit Zweitnamen, der Styleguide, die Wächter-Tests; dazu die Liste „Gewollte sichtbare Änderungen“ aus der Spec.
- **Verifikation:** `npm test` und `npm run test:e2e` mit den Zahlen aus Step 7; die erste Zeile von `data/d02/final.txt` und die Zuordnung der Gruppen aus Step 3; die neuen Obergrenzen aus Step 2.
- **Offen:** GitLab-Ticket für D-16 anlegen.

Den Merge Request legt Lyonel an (für die Kommandozeile sind keine GitLab-Zugangsdaten hinterlegt). Der Branch wird nicht gepusht, bevor er zugestimmt hat.

