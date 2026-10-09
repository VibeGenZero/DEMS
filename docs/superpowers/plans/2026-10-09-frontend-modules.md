# Frontend-Module (D-01) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `public/js/app.js` (5507 Zeilen, 182 globale Funktionen) wird zu ~28 nativen ES-Modulen ohne Build-Schritt. Alle 108 Inline-Handler werden durch Event-Delegation ersetzt, danach verbietet die CSP Inline-Skripte und Inline-Handler. Sichtbar ändert sich nichts.

**Architecture:**
1. Ein einmaliges Skript (Scratchpad, nicht im Repo) zerlegt `app.js` anhand der vorhandenen `// ─── Abschnitt ───`-Kommentare in Module. Es erzeugt die Importe, verschiebt geteilte Variablen in `core/state.js` und stellt Funktionen, die noch per Inline-Handler aufgerufen werden, über eine vorübergehende `window`-Brücke bereit.
2. `core/actions.js` verteilt `data-click`/`data-change`/`data-input` und `data-fallback` über Listener an `document`.
3. Die Bereiche werden einzeln umgestellt. Zum Schluss fällt die Brücke weg, und die CSP wird streng.
4. Das Test-Gerüst lädt die echten Module isoliert mit `vm.SourceTextModule`.

**Tech Stack:** Node.js ≥ 22, Express 5 + helmet (CSP), Vanilla-JS-SPA (native ES-Module), Bootstrap/GSAP/EasyMDE/Flatpickr/marked/DOMPurify als klassische Skripte aus `public/vendor/`, `node:test` + `node:vm` (`--experimental-vm-modules`), Playwright 1.63.0 (`npm run test:e2e`).

**Spec:** `docs/superpowers/specs/2026-10-09-frontend-modules-design.md`

**Branch:** `50-d-01-frontend-in-module-aufteilen-ohne-build-schritt` (Ticket #50). Voraussetzung: Hotfix-MR !57 (Ticket #112, `inlineArg`) ist in `main` gemergt.

## Global Constraints

- Kein Build-Schritt, kein Bundler, keine neue npm-Abhängigkeit, kein TypeScript.
- Sichtbares Verhalten bleibt gleich. Ausnahmen stehen in der Spec: Gäste-Avatar-Fallback wird `hide`, der Discord-Import-Link springt nicht mehr nach `#`.
- Alles, was Nutzer sehen, auf Deutsch; Code, Kommentare, Commits und Wiki auf Englisch; Konsolen-Ausgaben für Entwickler auf Englisch.
- Module exportieren Funktionen und Konstanten. Auf oberster Ebene läuft nur `import`/`export`, `registerActions(...)`, übergangsweise `Object.assign(window, …)` und in `main.js` die Start-Listener plus `initActions(document)`.
- Jedes Modul höchstens ~500 Zeilen (der Test erlaubt 550).
- Aktionsnamen stehen immer wörtlich im Markup (`data-click="name"`), nie als `${…}`. Jeder Wert in einem `data-*`-Attribut geht durch `escapeHtml(...)`.
- Aktionen rufen die Zielfunktion immer ausdrücklich auf (`(el) => fn(el.dataset.x)`), nie als `fn` direkt, damit kein Element als erstes Argument durchrutscht.
- Zahlen und Booleans aus `data-*` werden ausdrücklich umgewandelt (`Number(...)`, `=== 'true'`).
- `style-src` behält `'unsafe-inline'` (kommt mit D-02).
- Jeder Commit ist grün: `npm test` und `npm run test:e2e`. Commit-Texte enthalten kein `#<Zahl>` außer echten Ticket-Verweisen und keine HTML-Entities wie `&#039;`.
- Commits enden mit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_014NiN2kW8WCg1k6JwibnFqs
  ```
- Wiki: Jede Verhaltensänderung aktualisiert die betroffenen Knoten im selben Commit, danach `npm run wiki`. Textersetzungen in Wiki-Dateien nur mit `split/join` und genau einem Treffer, nie mit `String.replace` (Gefahr durch `$`-Muster).

## Review Focus

1. **Kommentar-Antwort postet genau einmal.** `replyToComment` hat bisher per `btn.onclick` den Senden-Button überschrieben. Mit Delegation würden Property-Handler und Aktion beide feuern. Test in Task 6: „Antworten“, dann zweimal posten. Der erste POST trägt `replyTo`, der zweite nicht, und es gibt genau zwei POSTs.
2. **Fehlender Import fällt erst zur Laufzeit auf.** Die Brücke verdeckt das bis Task 12. Gegenmittel:
   - Importe erzeugt das Skript.
   - Link-Prüfung über den Test-Lader in Task 3.
   - Import-Wächter in Task 12.
   - Playwright-Tour nach jedem Task.
3. **Aus `data-*` kommen Strings.** `wizardGoTo("3")` würde den Schritt-Punkt nicht aktivieren, `shiftCalendarMonth("-1")` den Monat zu `undefined` machen, `confirmInvitationPreference("false")` wäre wahr. Tests:
   - Task 9 prüft `wstep-3` auf `active`.
   - Task 5 prüft die Monatsüberschrift.
   - Task 11 prüft `false` beim Willkommensdialog.
4. **Bilder, die vor dem Modulstart scheitern.** Das Navbar-Avatar hat `src=""` und meldet seinen Fehler, bevor `main.js` läuft. Test in Task 4: `initActions` behandelt gescheiterte `img[data-fallback]` einmal nach.
5. **Standardverhalten bei Klicks.** `<a href="#">` springt nicht mehr nach `#`; Checkboxen mit Aktion schalten weiter um; die innerste Aktion gewinnt, die Karten-Aktion läuft nicht mit. Tests in Task 4.

---

### Task 0: Branch vorbereiten, Spec und Plan committen

**Files:**
- Modify: Branch `50-d-01-frontend-in-module-aufteilen-ohne-build-schritt` (Merge von `origin/main`)
- Add: `docs/superpowers/specs/2026-10-09-frontend-modules-design.md`, `docs/superpowers/plans/2026-10-09-frontend-modules.md`

- [ ] **Step 1: Hotfix-Stand holen**

```bash
git fetch origin
git log --oneline origin/main | grep -m1 "Encode values in inline handlers"   # muss den Hotfix-Commit zeigen
git checkout 50-d-01-frontend-in-module-aufteilen-ohne-build-schritt
git merge --ff-only origin/main
```
Erwartet: Fast-Forward. Danach enthält `public/js/app.js` die Funktion `inlineArg`, und es gibt `test/inlineHandlers.test.js`. Fehlt der Hotfix in `origin/main`, hier anhalten und den Nutzer fragen.

- [ ] **Step 2: Tests als Ausgangslage**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"` → alles grün (286 Tests).
Run: `npm run test:e2e 2>&1 | tail -2` → `12 passed`.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-10-09-frontend-modules-design.md docs/superpowers/plans/2026-10-09-frontend-modules.md
git commit -F - <<'EOF'
Add spec and plan for splitting the frontend into ES modules

D-01 splits public/js/app.js into native ES modules per area, replaces
inline event handlers with event delegation and then drops
'unsafe-inline' for scripts from the CSP. The plan was checked with a
prototype split: 28 modules link, all unit tests and the Playwright tour
pass with a temporary window bridge.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014NiN2kW8WCg1k6JwibnFqs
EOF
```

---

### Task 1: Quelltext-Scanner `test/jsSource.js`

Ohne Parser-Abhängigkeit trennt ein kleiner Scanner Code von Text: Strings, Template-Text, Kommentare und Regex-Literale. Ihn nutzen das Verschiebe-Skript (Task 3), der Struktur-Test (Task 3) und die Wächter (Task 12).

**Files:**
- Create: `test/jsSource.js`
- Test: `test/jsSource.test.js`

**Interfaces:**
- Produces: `maskJsSource(source: string): string` (gleiche Länge, Nicht-Code durch Leerzeichen ersetzt, Zeilenumbrüche bleiben), `lineDepths(masked: string): number[]` (Verschachtelungstiefe am Zeilenanfang, Index = Zeile − 1), `codeIdentifiers(masked: string): Array<{ name: string, index: number }>` (Bezeichner als Code: nicht nach `.`, kein Objektschlüssel).

- [ ] **Step 1: Failing test schreiben** — `test/jsSource.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { maskJsSource, lineDepths, codeIdentifiers } = require('./jsSource');

test('strings, comments and template text are blanked, positions stay', () => {
    const source = "const a = 'x(y)'; // call(z)\nconst b = `t ${f(1)} u`; /* g() */";
    const masked = maskJsSource(source);
    assert.equal(masked.length, source.length);
    assert.equal(masked, "const a = '    ';           \nconst b = `  ${f(1)}  `;          ");
});

test('a slash after a value divides, after an operator it starts a regex', () => {
    assert.equal(maskJsSource("x = a / b / c; y = s.replace(/'/g, '');"), "x = a / b / c; y = s.replace(/ /g, '');");
});

test('templates nest inside template expressions', () => {
    assert.equal(maskJsSource('`a ${`b ${c} d`} e`'), '`  ${`  ${c}  `}  `');
});

test('line depth counts braces and open template literals', () => {
    const masked = maskJsSource('function f() {\n  return `\nx`;\n}\nconst y = 1;');
    assert.deepEqual(lineDepths(masked), [0, 1, 2, 1, 0]);
});

test('code identifiers skip property names and object keys', () => {
    const names = codeIdentifiers(maskJsSource('const o = { key: value, other }; o.prop(call());')).map(ref => ref.name);
    assert.deepEqual(names, ['const', 'o', 'value', 'other', 'o', 'call']);
});
```

- [ ] **Step 2: Test laufen lassen**

Run: `node --test test/jsSource.test.js`
Expected: FAIL mit `Cannot find module './jsSource'`

- [ ] **Step 3: Implementierung** — `test/jsSource.js` mit genau diesem Inhalt:

```js
/**
 * Small source scanner for the frontend guard tests and the D-01 split script.
 * No parser dependency: it only needs to tell code from text.
 */

const REGEX_AFTER_WORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'else', 'do', 'await', 'yield']);
const REGEX_AFTER_CHARS = '(,=:[!&|?{};+-*%<>~^';

/**
 * Blank out everything in JavaScript source that is not code: comments,
 * string and template-literal text, regex literal bodies. Quotes, backticks,
 * `${`/`}` of template expressions and newlines stay, and every character
 * keeps its index, so a match in the result maps 1:1 onto the source.
 *
 * @param {string} source -> JavaScript source.
 * @returns {string} -> Masked source of the same length.
 */
function maskJsSource(source) {
    const out = source.split('');
    const length = source.length;
    const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
    // One entry per open `${`: how many plain `{` are open inside it
    const templateBraces = [];
    let prev = '';
    let prevWord = '';
    let i = 0;

    const regexAllowed = () => {
        if (prev === 'word') return REGEX_AFTER_WORDS.has(prevWord);
        return prev === '' || REGEX_AFTER_CHARS.includes(prev);
    };
    // Scan template text from `start`; returns the index after the closing backtick or after `${`
    const scanTemplate = (start) => {
        let j = start;
        while (j < length) {
            if (source[j] === '\\') { j += 2; continue; }
            if (source[j] === '`') { blank(start, j); prev = '`'; return j + 1; }
            if (source[j] === '$' && source[j + 1] === '{') {
                blank(start, j);
                templateBraces.push(0);
                prev = '{';
                return j + 2;
            }
            j++;
        }
        blank(start, length);
        return length;
    };

    while (i < length) {
        const ch = source[i];
        const next = source[i + 1];
        if (ch === '/' && next === '/') {
            const end = source.indexOf('\n', i);
            const stop = end === -1 ? length : end;
            blank(i, stop);
            i = stop;
            continue;
        }
        if (ch === '/' && next === '*') {
            const end = source.indexOf('*/', i + 2);
            const stop = end === -1 ? length : end + 2;
            blank(i, stop);
            i = stop;
            continue;
        }
        if (ch === '"' || ch === "'") {
            let j = i + 1;
            while (j < length && source[j] !== ch && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
            blank(i + 1, j);
            prev = ch;
            i = j + 1;
            continue;
        }
        if (ch === '`') {
            i = scanTemplate(i + 1);
            continue;
        }
        if (ch === '/' && regexAllowed()) {
            let j = i + 1;
            let inClass = false;
            while (j < length && source[j] !== '\n') {
                const c = source[j];
                if (c === '\\') { j += 2; continue; }
                if (c === '[') inClass = true;
                else if (c === ']') inClass = false;
                else if (c === '/' && !inClass) break;
                j++;
            }
            blank(i + 1, j);
            j++;
            while (j < length && /[a-z]/i.test(source[j])) j++;
            prev = '/';
            i = j;
            continue;
        }
        if (ch === '{' && templateBraces.length) templateBraces[templateBraces.length - 1]++;
        if (ch === '}' && templateBraces.length) {
            if (templateBraces[templateBraces.length - 1] === 0) {
                templateBraces.pop();
                i = scanTemplate(i + 1);
                continue;
            }
            templateBraces[templateBraces.length - 1]--;
        }
        if (/\s/.test(ch)) { i++; continue; }
        if (/[\w$]/.test(ch)) {
            let j = i;
            while (j < length && /[\w$]/.test(source[j])) j++;
            prev = 'word';
            prevWord = source.slice(i, j);
            i = j;
            continue;
        }
        prev = ch;
        prevWord = '';
        i++;
    }
    return out.join('');
}

/**
 * Nesting depth at the start of every line of masked source: brackets,
 * braces, parentheses and open template literals all count.
 *
 * @param {string} masked -> Output of maskJsSource().
 * @returns {number[]} -> Depth per line (index = line number - 1).
 */
function lineDepths(masked) {
    const stack = [];
    const depths = [0];
    for (let i = 0; i < masked.length; i++) {
        const ch = masked[i];
        if (ch === '\n') { depths.push(stack.length); continue; }
        if (ch === '`') {
            if (stack[stack.length - 1] === '`') stack.pop(); else stack.push('`');
        } else if (ch === '$' && masked[i + 1] === '{' && stack[stack.length - 1] === '`') {
            stack.push('${');
            i++;
        } else if (ch === '{' || ch === '(' || ch === '[') {
            stack.push(ch);
        } else if (ch === '}' || ch === ')' || ch === ']') {
            stack.pop();
        }
    }
    return depths;
}

/**
 * Identifiers used as code in masked source: not after `.`, `?.`, and not
 * an object key (`{ name:` / `, name:`).
 *
 * @param {string} masked -> Output of maskJsSource().
 * @returns {Array<{ name: string, index: number }>} -> Every reference.
 */
function codeIdentifiers(masked) {
    const found = [];
    for (const match of masked.matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)) {
        const after = masked.slice(match.index + match[0].length, match.index + match[0].length + 50).match(/^\s*(\S)(\S)?/);
        const before = masked.slice(Math.max(0, match.index - 200), match.index).match(/(\S)\s*$/);
        const isKey = after && after[1] === ':' && after[2] !== ':' && before && (before[1] === '{' || before[1] === ',');
        if (!isKey) found.push({ name: match[0], index: match.index });
    }
    return found;
}

module.exports = { maskJsSource, lineDepths, codeIdentifiers };
```

- [ ] **Step 4: Test laufen lassen**

Run: `node --test test/jsSource.test.js` → `# pass 5`, `# fail 0`

- [ ] **Step 5: Gegenprobe auf `app.js`**

```bash
node -e "
const fs = require('fs');
const { maskJsSource, lineDepths } = require('./test/jsSource');
const src = fs.readFileSync('public/js/app.js', 'utf8').replace(/\r\n/g, '\n');
const m = maskJsSource(src);
const d = lineDepths(m);
const starts = m.split('\n').filter((l, i) => d[i] === 0 && /^\S/.test(l) && !/^[}\])]/.test(l));
console.log(m.length === src.length, d[d.length - 1], starts.length);"
```
Expected: `true 0 229` (183 Funktionen inkl. `inlineArg`, 42 Variablen, 4 Listener).

- [ ] **Step 6: Commit**

```bash
git add test/jsSource.js test/jsSource.test.js
git commit -F - <<'EOF'
Add a small JavaScript source scanner for frontend tests

Splitting app.js into modules and guarding the result needs to tell code
from strings, template text, comments and regex literals. The project
has no parser dependency and should not get one for tests, so a scanner
blanks everything that is not code and keeps positions.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014NiN2kW8WCg1k6JwibnFqs
EOF
```

---

### Task 2: Modul-Lader im Test-Gerüst und `npm test`-Flag

**Files:**
- Modify: `test/helpers.js` (neue Funktionen `loadFrontendModules`, `frontendSources`; Export-Liste)
- Modify: `package.json` (Script `test`)
- Create: `test/fixtures/frontend-modules/main.js`, `test/fixtures/frontend-modules/counter.js`, `test/fixtures/frontend-modules/broken.js`
- Test: `test/frontendLoader.test.js`

**Interfaces:**
- Produces:
  - `loadFrontendModules(entryFile: string, context: vm.Context): Promise<Map<string, Object>>`. Der Schlüssel ist der Pfad relativ zum Ordner von `entryFile`, mit `/`, zum Beispiel `core/state.js`; der Wert ist der Modul-Namespace. Jeder Aufruf erzeugt neue Modul-Instanzen.
  - `frontendSources(): Array<{ file: string, source: string }>` liefert alle `.js` unter `public/js`, sortiert, Pfade mit `/`.

- [ ] **Step 1: Fixtures anlegen**

`test/fixtures/frontend-modules/counter.js`:
```js
let value = 0;

export function increment() {
    value += 1;
}

export function count() {
    return value;
}
```

`test/fixtures/frontend-modules/main.js`:
```js
import { count, increment } from './counter.js';

export function bump() {
    increment();
    return count();
}

export function pageTitle() {
    return document.title;
}
```

`test/fixtures/frontend-modules/broken.js`:
```js
import { missing } from './counter.js';

export function useMissing() {
    return missing;
}
```

- [ ] **Step 2: Failing test schreiben** — `test/frontendLoader.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');

const FIXTURES = path.join(__dirname, 'fixtures', 'frontend-modules');

test('every load builds new module instances in its own context', async () => {
    const first = await loadFrontendModules(path.join(FIXTURES, 'main.js'), vm.createContext({ document: { title: 'A' } }));
    const second = await loadFrontendModules(path.join(FIXTURES, 'main.js'), vm.createContext({ document: { title: 'B' } }));
    first.get('main.js').bump();
    first.get('main.js').bump();
    assert.equal(first.get('main.js').bump(), 3);
    assert.equal(second.get('main.js').bump(), 1);
    assert.equal(second.get('main.js').pageTitle(), 'B');
    assert.deepEqual([...first.keys()].sort(), ['counter.js', 'main.js']);
});

test('an import of a name the other module does not export fails the load', async () => {
    await assert.rejects(loadFrontendModules(path.join(FIXTURES, 'broken.js'), vm.createContext({})), /missing/);
});

test('without the vm modules flag the loader says how to run the tests', () => {
    const script = `require(${JSON.stringify(path.join(REPO_ROOT, 'test', 'helpers.js'))})
        .loadFrontendModules(${JSON.stringify(path.join(FIXTURES, 'main.js'))}, require('vm').createContext({}))
        .catch(err => { console.error(err.message); process.exit(3); });`;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.equal(result.status, 3);
    assert.match(result.stderr, /--experimental-vm-modules.*npm test/);
});
```

- [ ] **Step 3: Test laufen lassen**

Run: `node --experimental-vm-modules --disable-warning=ExperimentalWarning --test test/frontendLoader.test.js`
Expected: FAIL mit `loadFrontendModules is not a function`

- [ ] **Step 4: Implementierung in `test/helpers.js`** — direkt vor dem Kommentarblock von `loadFrontendApp` einfügen:

```js
const FRONTEND_DIR = path.join(REPO_ROOT, 'public', 'js');

/**
 * Source of every frontend module, for text checks across the whole SPA.
 *
 * @returns {Array<{ file: string, source: string }>} -> One entry per file below public/js (path with /), sorted.
 */
function frontendSources() {
    return fs.readdirSync(FRONTEND_DIR, { recursive: true })
        .filter(file => file.endsWith('.js'))
        .sort()
        .map(file => ({ file: file.split(path.sep).join('/'), source: fs.readFileSync(path.join(FRONTEND_DIR, file), 'utf8') }));
}

/**
 * Link and evaluate the ES modules reachable from `entryFile` inside a vm
 * context. Every call builds new module instances, so module state never
 * leaks from one test into the next. Needs node --experimental-vm-modules
 * (npm test sets it).
 *
 * @param {string} entryFile -> Absolute path of the entry module.
 * @param {Object} context -> vm context with the page globals.
 * @returns {Promise<Map<string, Object>>} -> Module namespace by path relative to the entry's folder (with /).
 */
async function loadFrontendModules(entryFile, context) {
    if (typeof vm.SourceTextModule !== 'function') {
        throw new Error('Frontend tests load ES modules and need node --experimental-vm-modules; run them with npm test');
    }
    const root = path.dirname(entryFile);
    const modules = new Map();
    const load = (file) => {
        if (!modules.has(file)) {
            modules.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file, context }));
        }
        return modules.get(file);
    };
    const entry = load(entryFile);
    await entry.link((specifier, referrer) => load(path.resolve(path.dirname(referrer.identifier), specifier)));
    await entry.evaluate();
    return new Map([...modules].map(([file, module]) => [path.relative(root, file).split(path.sep).join('/'), module.namespace]));
}
```

In `module.exports` die Zeile `loadFrontendApp` ersetzen durch:
```js
    loadFrontendApp,
    loadFrontendModules,
    frontendSources
```

- [ ] **Step 5: `package.json`** — Script `test` ersetzen:

```json
    "test": "node --experimental-vm-modules --disable-warning=ExperimentalWarning --test \"test/**/*.test.js\"",
```

- [ ] **Step 6: Tests laufen lassen**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"` → alles grün, 3 Tests mehr. Es darf keine `ExperimentalWarning` in der Ausgabe stehen.

- [ ] **Step 7: Wiki** — `docs/wiki/ops/testing.md`: in der Befehlstabelle bzw. -liste ergänzen, dass `npm test` mit `--experimental-vm-modules` läuft. Für eine einzelne Frontend-Testdatei: `node --experimental-vm-modules --test test/<datei>.test.js`. Danach `npm run wiki` und `npm test`.

- [ ] **Step 8: Commit**

```bash
git add test/helpers.js test/frontendLoader.test.js test/fixtures/frontend-modules package.json docs/wiki
git commit -F - <<'EOF'
Load frontend ES modules in tests with vm.SourceTextModule

The SPA is about to become native ES modules. Tests must load the real
module graph, isolated per test, without a bundler. vm.SourceTextModule
does that but needs --experimental-vm-modules, so npm test sets the flag
and the loader explains it when the flag is missing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014NiN2kW8WCg1k6JwibnFqs
EOF
```

---

### Task 3: `app.js` in Module zerlegen (mit `window`-Brücke)

**Files:**
- Delete: `public/js/app.js`
- Create: `public/js/main.js`, `public/js/core/{state,boot,auth,router,ui,updates}.js`, `public/js/events/{list,detail,slots,registration-form,guests,checkin,comments}.js`, `public/js/polls/{polls,admin}.js`, `public/js/admin/{dashboard,event-actions,wizard,wizard-builders,registrations,maintenance,bot-control,bot-messages,discord-import}.js`, `public/js/pages/{profile,info,debug}.js` (erzeugt)
- Modify: `public/index.html` (Script-Tag), `test/helpers.js` (`loadFrontendApp`), `test/authFrontend.test.js`, `test/eventCards.test.js`, `test/eventDetailReset.test.js`, `test/eventForm.test.js`, `test/profileRegistrations.test.js`, `test/startup.test.js`, `test/inlineHandlers.test.js`
- Modify (Doku): `docs/wiki/modules/frontend-app.md` (neu geschrieben), 19 weitere Wiki-Seiten (Tabelle in Step 9), `CLAUDE.md`
- Test: `test/frontendModules.test.js`

**Interfaces:**
- Consumes: `maskJsSource`, `lineDepths`, `codeIdentifiers` (Task 1); `loadFrontendModules`, `frontendSources` (Task 2)
- Produces:
  - Module wie in der Spec-Tabelle. Jede Deklaration auf oberster Ebene ist exportiert, Namen sind über alle Module eindeutig.
  - `state` aus `core/state.js` mit den 15 geteilten Werten: `currentUser`, `cachedRoles`, `countdownTimers`, `csrfToken`, `descriptionEditor`, `startDatePicker`, `endDatePicker`, `serverName`, `selectedSlotId`, `selectedAltSlotIds`, `detailEventId`, `currentPoll`, `pendingPollDecision`, `botStatusRefreshInterval`, `selectedGuests`.
  - `shiftCalendarMonth(delta: number)` in `events/list.js`.
  - `await loadFrontendApp(routes, { storage })` liefert `{ app, state, element, toasts, requests, location, fire }`. `app` enthält jeden Export jedes Moduls.

- [ ] **Step 1: Failing Struktur-Test** — `test/frontendModules.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { frontendSources, REPO_ROOT } = require('./helpers');
const { maskJsSource, lineDepths } = require('./jsSource');

// Code that may run on import besides import/export declarations
const ALLOWED_TOP_LEVEL = [/^registerActions\(/, /^Object\.assign\(window, /];
const MAIN_TOP_LEVEL = [/^document\.addEventListener\(/, /^initActions\(/];
const MAX_MODULE_LINES = 550;

test('app.js is gone and index.html loads the entry module', () => {
    assert.equal(fs.existsSync(path.join(REPO_ROOT, 'public', 'js', 'app.js')), false);
    const html = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
    assert.match(html, /<script type="module" src="\/js\/main\.js"><\/script>/);
    assert.doesNotMatch(html, /\/js\/app\.js/);
});

test('every module stays small and runs no code on import', () => {
    const sources = frontendSources();
    assert.ok(sources.length >= 25, `only ${sources.length} modules`);
    for (const { file, source } of sources) {
        const text = source.replace(/\r\n/g, '\n');
        const lines = text.split('\n');
        assert.ok(lines.length <= MAX_MODULE_LINES, `${file} has ${lines.length} lines`);
        const maskedText = maskJsSource(text);
        const masked = maskedText.split('\n');
        const depths = lineDepths(maskedText);
        const allowed = file === 'main.js' ? [...ALLOWED_TOP_LEVEL, ...MAIN_TOP_LEVEL] : ALLOWED_TOP_LEVEL;
        masked.forEach((line, i) => {
            if (depths[i] !== 0 || !/^\S/.test(line) || /^[}\])]/.test(line) || /^(import|export) /.test(line)) return;
            assert.ok(allowed.some(pattern => pattern.test(line)), `${file}:${i + 1} runs code on import: ${line.trim()}`);
        });
    }
});
```

Run: `npm test 2>&1 | grep -E "^not ok"` → FAIL: `app.js is gone …` und `every module …` (`only 1 modules`).

- [ ] **Step 2: Kalender-Pfeile auf eine Funktion umstellen** (die Brücke kann keine Modul-Variablen schreiben)

In `public/js/app.js`:
- `onclick="calendarMonth--; if(calendarMonth<0){calendarMonth=11;calendarYear--} renderCalendar(cachedEvents)"` wird zu `onclick="shiftCalendarMonth(-1)"`.
- `onclick="calendarMonth++; if(calendarMonth>11){calendarMonth=0;calendarYear++} renderCalendar(cachedEvents)"` wird zu `onclick="shiftCalendarMonth(1)"`.

Direkt vor `function renderCalendar(` einfügen:
```js
/**
 * Show the previous or next month in the calendar view.
 *
 * @param {number} delta -> -1 or 1.
 * @returns {void}
 */
function shiftCalendarMonth(delta) {
    calendarMonth += delta;
    if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; }
    if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; }
    renderCalendar(cachedEvents);
}
```
Run: `npm test 2>&1 | grep -E "^# fail"` → nur die 2 neuen Struktur-Tests rot.

- [ ] **Step 3: Verschiebe-Skript ablegen** — `<scratchpad>/split-app.js` (nicht im Repo) mit genau diesem Inhalt:

```js
/**
 * D-01: split public/js/app.js into ES modules (one-off tool, not committed).
 *
 * node split-app.js <repo root> <output public/js dir>
 *
 * - Top-level declarations go to the module of their "// ─── Section ───"
 *   header (MODULE_BY_SECTION) unless MODULE_BY_NAME says otherwise; other
 *   top-level statements (document.addEventListener …) go to main.js in order.
 * - Every top-level declaration is exported. A top-level `let` that another
 *   module reads or writes moves into core/state.js and becomes `state.<name>`.
 * - Imports are computed from code identifiers (strings and comments ignored).
 * - Functions called from inline handlers (index.html and HTML strings) are put
 *   on window by a temporary bridge in their module.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const { maskJsSource, lineDepths, codeIdentifiers } = require(path.join(ROOT, 'test', 'jsSource.js'));

const MODULE_BY_SECTION = {
    'Boot Animation': 'core/boot.js',
    'Auth': 'core/auth.js',
    'SPA Router': 'core/router.js',
    'Countdown': 'events/list.js',
    'Events Section': 'events/list.js',
    'Location Autocomplete': 'admin/wizard.js',
    'Category Filter': 'events/list.js',
    'Detail View Helpers': 'events/detail.js',
    'Role Slots (event page)': 'events/slots.js',
    'Event Detail': 'events/detail.js',
    'Date Polls': 'polls/polls.js',
    'Date Polls (admin)': 'polls/admin.js',
    'Check-in System': 'events/checkin.js',
    'Event Comments': 'events/comments.js',
    'Form Field Types & Widgets': 'events/registration-form.js',
    'Discord Import': 'admin/discord-import.js',
    'Updates System': 'core/updates.js',
    'Initialization': 'main.js',
    'Profile Section': 'pages/profile.js',
    'Debug / Styling Guide Section': 'pages/debug.js',
    'Admin Section': 'admin/dashboard.js',
    'Audit Log': 'admin/dashboard.js',
    'System Reset': 'admin/dashboard.js',
    'Participant Warning Badge': 'events/list.js',
    'Series Toggle': 'events/list.js',
    'Debounced Search': 'events/list.js',
    'View Toggle (Grid / Calendar)': 'events/list.js',
    'Duplicate Event': 'admin/event-actions.js',
    'Calendar View': 'events/list.js',
    'Event Wizard Navigation': 'admin/wizard.js',
    'Event CRUD': 'admin/wizard.js',
    'Roles': 'admin/wizard.js',
    'Form Builder': 'admin/wizard-builders.js',
    'Role Slots (wizard)': 'admin/wizard-builders.js',
    'Registrations': 'admin/registrations.js',
    'Bot Messages': 'admin/bot-messages.js',
    'Discord Sync': 'admin/event-actions.js',
    'Utilities': 'core/ui.js',
    'Info Section': 'pages/info.js',
    'Guest Search': 'events/guests.js',
    'Account Settings': 'pages/profile.js',
    'First-Login Modal': 'pages/profile.js'
};

const MODULE_BY_NAME = {
    getErrorMessage: 'core/ui.js',
    showConfirmDialog: 'core/ui.js',
    submitRegistration: 'events/registration-form.js',
    unregisterFromEvent: 'events/registration-form.js',
    toggleDetailSeriesDates: 'events/detail.js',
    formatSlotLabel: 'events/slots.js',
    checkMaintenanceStatus: 'admin/maintenance.js',
    showMaintenanceModal: 'admin/maintenance.js',
    saveMaintenanceSettings: 'admin/maintenance.js',
    activatePanicMode: 'admin/maintenance.js',
    deactivatePanicMode: 'admin/maintenance.js',
    botStatusRefreshInterval: 'admin/bot-control.js',
    showBotControlSection: 'admin/bot-control.js',
    formatUptime: 'admin/bot-control.js',
    loadBotStatus: 'admin/bot-control.js',
    loadBotRunningEvents: 'admin/bot-control.js',
    loadBotSettings: 'admin/bot-control.js',
    saveBotSettingsForm: 'admin/bot-control.js',
    deleteEvent: 'admin/event-actions.js',
    deleteEventSeries: 'admin/event-actions.js',
    changeEventStatus: 'admin/event-actions.js',
    renderAnnounceButtonsPreview: 'admin/event-actions.js',
    announceEvent: 'admin/event-actions.js',
    sendAnnouncement: 'admin/event-actions.js',
    startEvent: 'admin/event-actions.js',
    endEvent: 'admin/event-actions.js',
    exportRegistrations: 'admin/event-actions.js'
};

// Called through a name built at runtime: onclick="${handler}(…)" in renderPollAdminBar
const DYNAMIC_HANDLER_NAMES = ['showPollAnnounceDialog', 'showPollEditor', 'closePollFromUi', 'showPollDecideDialog', 'deletePollFromUi'];

const MODULE_DOCS = {
    'main.js': 'Entry point: loads every module (registrations and the temporary window bridge run on import) and starts the app.',
    'core/state.js': 'Values that several modules read or write. One object, so a module changes `state.currentUser` instead of reassigning an imported binding.',
    'core/boot.js': 'Boot animation, CSRF token, server info and the startup sequence (finishLoading).',
    'core/auth.js': 'Login state: /auth/me, logged-in/logged-out views, logout.',
    'core/router.js': 'Hash router: handleRoute, navigateTo and the pending route before a login.',
    'core/ui.js': 'Shared UI helpers: escaping, Markdown, toasts, error banner, confirm dialog, skeletons.',
    'core/updates.js': '"Neuigkeiten & Updates" dialog.',
    'events/list.js': 'Event overview: cards, categories, search, grid/calendar view, countdowns, series dates.',
    'events/detail.js': 'Event page: banner, sidebar, participants, series dates.',
    'events/slots.js': 'Role slots on the event page: picker, roster, own slot.',
    'events/registration-form.js': 'Registration form widgets, sign-up and sign-off.',
    'events/guests.js': 'Guest search and selected guests of a registration.',
    'events/checkin.js': 'Check-in section of the event page.',
    'events/comments.js': 'Comments and questions on the event page.',
    'polls/polls.js': 'Date polls: overview, detail page, votes.',
    'polls/admin.js': 'Date polls for admins: editor, announce, close, delete, decide.',
    'admin/dashboard.js': 'Admin area: stats, event cards, audit log, system reset.',
    'admin/event-actions.js': 'Admin actions on one event: status, delete, announce, start/end, export, duplicate, Discord sync.',
    'admin/wizard.js': 'Event wizard: steps, create/edit/save, roles, location autocomplete.',
    'admin/wizard-builders.js': 'Event wizard builders: registration form fields and role slots.',
    'admin/registrations.js': 'Registrations dialog: list, accept/reject, move slot.',
    'admin/maintenance.js': 'Maintenance mode and panic mode.',
    'admin/bot-control.js': 'Bot control center: status, running events, settings.',
    'admin/bot-messages.js': 'Bot message templates dialog.',
    'admin/discord-import.js': 'Import of Discord scheduled events into the wizard.',
    'pages/profile.js': 'Profile page, account settings, first-login dialog.',
    'pages/info.js': 'Info page and "Meine Daten".',
    'pages/debug.js': 'Debug styling guide (#debug).'
};

const source = fs.readFileSync(path.join(ROOT, 'public', 'js', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const masked = maskJsSource(source);
const lines = source.split('\n');
const maskedLines = masked.split('\n');
const depths = lineDepths(masked);
const lineOffsets = [];
lines.reduce((offset, line, i) => { lineOffsets[i] = offset; return offset + line.length + 1; }, 0);

// ── 1. Cut the file into top-level chunks ────────────────────────────────
const chunks = [];
let section = 'Preamble';
let pending = [];
let current = null;
for (let i = 0; i < lines.length; i++) {
    const header = depths[i] === 0 && lines[i].match(/^\/\/ ─── (.+?) ─+\s*$/);
    if (header) { section = header[1]; pending = []; current = null; continue; }
    const startsStatement = depths[i] === 0 && /^\S/.test(maskedLines[i]) && !/^[}\])]/.test(maskedLines[i]);
    if (startsStatement) {
        current = { section, lines: [...pending, i], declLine: i };
        pending = [];
        chunks.push(current);
        continue;
    }
    if (depths[i] === 0 && maskedLines[i].trim() === '') { pending.push(i); continue; }
    if (!current) throw new Error(`line ${i + 1} belongs to no statement`);
    current.lines.push(...pending, i);
    pending = [];
}

for (const chunk of chunks) {
    const head = masked.slice(lineOffsets[chunk.declLine]).match(/^(?:async\s+)?function\s+([\w$]+)|^(let|const|var)\s+([\w$]+)/);
    chunk.kind = !head ? 'statement' : head[1] ? 'function' : head[2];
    chunk.name = head ? head[1] || head[3] : null;
    chunk.module = chunk.kind === 'statement' ? 'main.js' : (MODULE_BY_NAME[chunk.name] || MODULE_BY_SECTION[chunk.section] || null);
    const first = lineOffsets[chunk.lines[0]];
    const last = chunk.lines[chunk.lines.length - 1];
    chunk.start = first;
    chunk.end = lineOffsets[last] + lines[last].length;
    chunk.ids = new Set(codeIdentifiers(masked.slice(chunk.start, chunk.end)).map(ref => ref.name));
}

// ── 2. Where is each name declared, who uses it ───────────────────────────
const declaredIn = new Map();
for (const chunk of chunks) if (chunk.name) declaredIn.set(chunk.name, chunk);
const usedBy = (name) => new Set(chunks.filter(chunk => chunk.ids.has(name) && chunk.name !== name).map(chunk => chunk.module).filter(Boolean));

// Preamble lets live where they are used; shared lets move to state
const stateNames = [];
for (const chunk of chunks) {
    if (chunk.kind !== 'let') continue;
    const users = usedBy(chunk.name);
    if (chunk.module) users.add(chunk.module);
    if (users.size > 1) { chunk.module = 'core/state.js'; stateNames.push(chunk.name); }
    else if (!chunk.module) chunk.module = [...users][0];
}
const unplaced = chunks.filter(chunk => !chunk.module);
if (unplaced.length) throw new Error(`no module for: ${unplaced.map(chunk => chunk.name || chunk.section).join(', ')}`);

// ── 3. Inline handler targets → bridge ───────────────────────────────────
const handlerNames = new Set(DYNAMIC_HANDLER_NAMES);
// Handler text without its `${…}` parts: those run while rendering, not on click
const withoutExpressions = (value) => {
    let out = '';
    let depth = 0;
    for (let i = 0; i < value.length; i++) {
        if (value[i] === '$' && value[i + 1] === '{') { depth++; i++; continue; }
        if (depth) {
            if (value[i] === '{') depth++;
            else if (value[i] === '}') depth--;
            continue;
        }
        out += value[i];
    }
    return out;
};
const collectHandlerCalls = (text) => {
    for (const attr of text.matchAll(/\son(?:click|change|input|error)="([^"]*)"/g)) {
        for (const call of withoutExpressions(attr[1]).matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
            if (declaredIn.get(call[1])?.kind === 'function') handlerNames.add(call[1]);
        }
    }
};
collectHandlerCalls(fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8'));
collectHandlerCalls(source);
const variablesInHandlers = [];
for (const attr of source.matchAll(/\son(?:click|change|input|error)="([^"]*)"/g)) {
    for (const ref of withoutExpressions(attr[1]).matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?!\s*\()/g)) {
        if (['let', 'const'].includes(declaredIn.get(ref[1])?.kind)) variablesInHandlers.push(ref[1]);
    }
}
if (variablesInHandlers.length) throw new Error(`inline handlers touch module variables: ${[...new Set(variablesInHandlers)].join(', ')}`);

// ── 4. Write the modules ─────────────────────────────────────────────────
const warnings = [];
const modules = new Map();
for (const chunk of chunks) {
    if (!modules.has(chunk.module)) modules.set(chunk.module, []);
    modules.get(chunk.module).push(chunk);
}

/**
 * JSDoc block with the text wrapped at 76 characters.
 */
function docComment(text) {
    const lines = [''];
    for (const word of text.split(' ')) {
        const last = lines.length - 1;
        if (lines[last] && lines[last].length + word.length + 1 > 76) lines.push(word);
        else lines[last] = lines[last] ? `${lines[last]} ${word}` : word;
    }
    return `/**\n${lines.map(line => ` * ${line}`).join('\n')}\n */`;
}

const relativeImport = (from, to) => {
    const rel = path.posix.relative(path.posix.dirname(from), to);
    return rel.startsWith('.') ? rel : `./${rel}`;
};

/**
 * Chunk text with `state.` in front of every state name used as code.
 */
function renameStateNames(chunk) {
    const text = source.slice(chunk.start, chunk.end);
    const codeText = masked.slice(chunk.start, chunk.end);
    let result = '';
    let last = 0;
    for (const ref of codeIdentifiers(codeText)) {
        if (!stateNames.includes(ref.name)) continue;
        const before = codeText.slice(Math.max(0, ref.index - 40), ref.index);
        const after = codeText.slice(ref.index + ref.name.length, ref.index + ref.name.length + 40);
        if (/\b(let|const|var)\s+$/.test(before)) warnings.push(`${chunk.module}: local declaration of state name ${ref.name} in ${chunk.name || 'statement'}`);
        let replacement = `state.${ref.name}`;
        // `{ name }` / `, name }` is shorthand, `${name}` in a template is not
        if (/(?:(?<!\$)\{|,)\s*$/.test(before) && /^\s*[},]/.test(after)) {
            warnings.push(`${chunk.module}: shorthand { ${ref.name} } in ${chunk.name || 'statement'} written as ${ref.name}: state.${ref.name}`);
            replacement = `${ref.name}: state.${ref.name}`;
        }
        result += text.slice(last, ref.index) + replacement;
        last = ref.index + ref.name.length;
    }
    return result + text.slice(last);
}

function exportDeclaration(chunk, text) {
    const declOffset = lineOffsets[chunk.declLine] - chunk.start;
    return `${text.slice(0, declOffset)}export ${text.slice(declOffset)}`;
}

const stateChunks = modules.get('core/state.js') || [];
modules.delete('core/state.js');
const allModuleNames = [...modules.keys(), 'core/state.js'];

for (const [moduleName, moduleChunks] of modules) {
    const own = new Set(moduleChunks.map(chunk => chunk.name).filter(Boolean));
    const imports = new Map();
    let usesState = false;
    for (const chunk of moduleChunks) {
        for (const name of chunk.ids) {
            if (stateNames.includes(name)) { usesState = true; continue; }
            const target = declaredIn.get(name);
            if (!target || own.has(name) || target.module === moduleName) continue;
            if (!imports.has(target.module)) imports.set(target.module, new Set());
            imports.get(target.module).add(name);
        }
    }
    const header = [docComment(MODULE_DOCS[moduleName])];
    if (moduleName === 'main.js') {
        // Side-effect imports: every module registers its actions on import
        for (const name of allModuleNames.filter(name => name !== 'main.js' && name !== 'core/state.js').sort()) {
            if (!imports.has(name)) header.push(`import './${name}';`);
        }
    }
    if (usesState) header.push(`import { state } from '${relativeImport(moduleName, 'core/state.js')}';`);
    for (const [target, names] of [...imports].sort(([a], [b]) => a.localeCompare(b))) {
        header.push(`import { ${[...names].sort().join(', ')} } from '${relativeImport(moduleName, target)}';`);
    }
    const body = moduleChunks.map(chunk => {
        const text = renameStateNames(chunk);
        return chunk.kind === 'statement' ? text : exportDeclaration(chunk, text);
    });
    const bridged = moduleChunks.map(chunk => chunk.name).filter(name => handlerNames.has(name));
    if (bridged.length) {
        body.push(`// Temporary bridge for inline handlers; D-01 replaces them with data-click and removes it\nObject.assign(window, { ${bridged.join(', ')} });`);
    }
    const text = `${header.join('\n')}\n\n${body.join('\n\n').replace(/\n{3,}/g, '\n\n')}\n`;
    fs.mkdirSync(path.dirname(path.join(OUT, moduleName)), { recursive: true });
    fs.writeFileSync(path.join(OUT, moduleName), text);
}

// core/state.js: initial values from the moved `let` declarations
const stateLines = stateChunks.map(chunk => {
    const text = source.slice(lineOffsets[chunk.declLine], chunk.end);
    const codeText = masked.slice(lineOffsets[chunk.declLine], chunk.end);
    const init = codeText.match(/^let\s+[\w$]+\s*=\s*/);
    const semicolon = codeText.lastIndexOf(';');
    const value = init ? text.slice(init[0].length, semicolon).trim() : 'undefined';
    const comment = text.slice(semicolon + 1).trim();
    return `    ${chunk.name}: ${value}${comment ? `, ${comment}` : ','}`;
});
stateLines[stateLines.length - 1] = stateLines[stateLines.length - 1].replace(/,(\s*\/\/.*)?$/, '$1');
fs.writeFileSync(path.join(OUT, 'core/state.js'), `${docComment(MODULE_DOCS['core/state.js'])}\nexport const state = {\n${stateLines.join('\n')}\n};\n`);

// ── 5. Report ────────────────────────────────────────────────────────────
console.log(`state: ${stateNames.join(', ')}`);
console.log(`bridge: ${handlerNames.size} names`);
for (const name of [...modules.keys(), 'core/state.js'].sort()) {
    console.log(`${String(fs.readFileSync(path.join(OUT, name), 'utf8').split('\n').length).padStart(5)}  ${name}`);
}
for (const warning of warnings) console.log(`WARNING ${warning}`);
```

- [ ] **Step 4: Zerlegen**

```bash
S=<scratchpad>
node "$S/split-app.js" . public/js
git rm -q public/js/app.js
```
Erwartete Ausgabe (Zeilenzahlen ±10, wegen `inlineArg` ist `core/ui.js` etwas größer):
```
state: currentUser, cachedRoles, countdownTimers, csrfToken, descriptionEditor, startDatePicker, endDatePicker, serverName, selectedSlotId, selectedAltSlotIds, detailEventId, currentPoll, pendingPollDecision, botStatusRefreshInterval, selectedGuests
bridge: 81 names
  241  admin/bot-control.js
  …
  514  events/list.js
  …
```
Es darf keine `WARNING`-Zeile kommen. Kommt eine, die genannte Stelle von Hand prüfen und korrigieren (z. B. eine lokale Variable mit dem Namen eines `state`-Werts umbenennen).

Wichtig: Das Skript liest `public/js/app.js`. Deshalb `git rm` erst **nach** dem Lauf.

- [ ] **Step 5: `public/index.html`**

`<script src="/js/app.js"></script>` wird zu `<script type="module" src="/js/main.js"></script>` (gleiche Stelle, nach GSAP). Mit dem Edit-Werkzeug ändern, nicht mit PowerShell `Set-Content`, das würde ein BOM schreiben.

- [ ] **Step 6: `loadFrontendApp` auf Module umstellen** (`test/helpers.js`)

- Signatur: `function loadFrontendApp(routes, { storage = {} } = {}) {` wird zu `async function loadFrontendApp(routes, { storage = {} } = {}) {`.
- Den Block ab `const source = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'app.js'), 'utf8');` bis zum Ende der Funktion ersetzen durch:

```js
    const app = {};
    for (const [file, namespace] of await loadFrontendModules(path.join(FRONTEND_DIR, 'main.js'), context)) {
        for (const [name, value] of Object.entries(namespace)) {
            if (name in app) throw new Error(`${name} is exported twice (${file})`);
            app[name] = value;
        }
    }
    const fire = (type) => listeners.filter(entry => entry.type === type).forEach(entry => entry.listener({ type }));
    return { app, state: app.state, element: (id) => registry.get(id) || null, toasts, requests, location: context.location, fire };
}
```
`context.window = context;` bleibt davor stehen.

JSDoc von `loadFrontendApp` anpassen:
- Erster Satz: „Load the frontend ES modules (public/js/main.js) into a fresh node:vm context with a fake DOM built from the ids in public/index.html.“
- `@returns {Promise<Object>} -> { app, state, element, toasts, requests, location, fire }`: app holds every export of every module, state is core/state.js; der Rest wie bisher.

- [ ] **Step 7: Frontend-Tests nachziehen** — Skript `<scratchpad>/convert-tests.js`:

```js
// Switch the frontend tests to the async module loader and core/state.js.
const fs = require('fs');

const files = ['authFrontend', 'eventCards', 'eventDetailReset', 'eventForm', 'profileRegistrations', 'startup', 'inlineHandlers']
    .map(name => `test/${name}.test.js`);
for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const crlf = raw.includes('\r\n');
    // Code lines only: JSDoc lines (" * … loadFrontendApp()") stay
    const lines = raw.replace(/\r\n/g, '\n').split('\n')
        .map(line => (/^\s*\*/.test(line) ? line : line.replace(/(?<!await )\bloadFrontendApp\(/g, 'await loadFrontendApp(')));
    // Per test block: destructure `state` where the block used the old accessors
    const text = lines.join('\n').split(/(?=\ntest\()/).map(block => {
        const usesState = /app\.(setCurrentUser|setCsrfToken|getCurrentUser)\(/.test(block);
        let result = block.replace(/test\(('[^']*'), \(\) => \{/, 'test($1, async () => {');
        if (usesState) result = result.replace(/const \{ ([^}]*?)(?<!state) \} = await loadFrontendApp\(/, 'const { $1, state } = await loadFrontendApp(');
        return result
            .replace(/(\w+)\.app\.setCurrentUser\(([^)]*)\);/g, '$1.state.currentUser = $2;')
            .replace(/\bapp\.setCurrentUser\(([^)]*)\);/g, 'state.currentUser = $1;')
            .replace(/\bapp\.setCsrfToken\(([^)]*)\);/g, 'state.csrfToken = $1;')
            .replace(/\bapp\.getCurrentUser\(\)/g, 'state.currentUser');
    }).join('');
    fs.writeFileSync(file, crlf ? text.replace(/\n/g, '\r\n') : text);
}
console.log('converted', files.length);
```
Run: `node <scratchpad>/convert-tests.js`

Danach von Hand mit dem Edit-Werkzeug:
- In `test/authFrontend.test.js` und `test/startup.test.js`:
  - `const appJs = fs.readFileSync(path.join(REPO_ROOT, 'public', 'js', 'app.js'), 'utf8');` wird zu `const appJs = frontendSources().map(entry => entry.source).join('\n');`.
  - Den Import ergänzen: `const { loadFrontendApp, frontendSources, REPO_ROOT } = require('./helpers');`.
- In `test/eventForm.test.js` steht danach `frontend.state.currentUser = ADMIN;`. `frontend` ist das Ergebnis von `await loadFrontendApp(...)` und hat `state`. Das ist so richtig.
- Mit `git diff test/` alle Änderungen lesen. Jede Destrukturierung mit `state` muss `state` auch benutzen.

- [ ] **Step 8: Tests laufen lassen**

Run: `npm test 2>&1 | grep -E "^not ok|^# (pass|fail)"`
Expected: Nur `the project wiki is valid and graph.json is up to date` ist rot (Quellen `public/js/app.js` fehlen). Alles andere ist grün, auch die Struktur-Tests aus Step 1 und `inlineHandlers.test.js`.

- [ ] **Step 9: Wiki und `CLAUDE.md`** — Skript `<scratchpad>/wiki-d01-split.js`, dann `node <scratchpad>/wiki-d01-split.js`:

```js
// D-01 split: point the wiki at the modules. split/join, exactly one match each.
const fs = require('fs');

const SOURCES = {
    'concepts/auth-session.md': 'public/js/core/auth.js, public/js/core/boot.js',
    'concepts/date-polls.md': 'public/js/polls/polls.js, public/js/polls/admin.js',
    'concepts/event-lifecycle.md': 'public/js/admin/event-actions.js, public/js/admin/wizard.js',
    'concepts/form-fields.md': 'public/js/events/registration-form.js, public/js/admin/wizard-builders.js',
    'concepts/maintenance-mode.md': 'public/js/admin/maintenance.js',
    'concepts/role-slots.md': 'public/js/events/slots.js, public/js/admin/wizard-builders.js, public/js/admin/registrations.js',
    'concepts/security.md': 'public/js/core/ui.js',
    'howto/add-event-field.md': 'public/js/admin/wizard.js, public/js/events/detail.js, public/js/events/list.js',
    'howto/add-form-field-type.md': 'public/js/events/registration-form.js, public/js/admin/wizard-builders.js',
    'overview/architecture.md': 'public/js',
    'overview/directory-map.md': 'public/js',
    'reference/conventions.md': 'public/js/core/ui.js',
    'reference/glossary.md': 'public/js',
    'reference/known-issues.md': 'public/js'
};

const TEXT = [
    ['docs/wiki/concepts/form-fields.md', '(`renderFormFields` in app.js)', '(`renderFormFields` in `events/registration-form.js`)'],
    ['docs/wiki/concepts/form-fields.md', 'in `utils/formFields.js` and `app.js`).', 'in `utils/formFields.js` and `public/js/events/registration-form.js`).'],
    ['docs/wiki/concepts/form-fields.md', '`function initEntityPicker` (app.js)', '`function initEntityPicker` (`public/js/events/registration-form.js`)'],
    ['docs/wiki/concepts/form-fields.md', '`function getFormFieldsFromBuilder` (app.js)', '`function getFormFieldsFromBuilder` (`public/js/admin/wizard-builders.js`)'],
    ['docs/wiki/concepts/form-fields.md', '`DISCORD_MODAL_MAX_FIELDS` in `app.js`', '`DISCORD_MODAL_MAX_FIELDS` in `public/js/events/registration-form.js`'],
    ['docs/wiki/concepts/maintenance-mode.md', '(`checkMaintenanceStatus` in app.js)', '(`checkMaintenanceStatus` in `public/js/admin/maintenance.js`)'],
    ['docs/wiki/concepts/registration-flow.md', '`submitRegistration()` in `app.js`', '`submitRegistration()` in `public/js/events/registration-form.js`'],
    ['docs/wiki/concepts/discord-integration.md', 'via `renderAnnounceButtonsPreview` (app.js)', 'via `renderAnnounceButtonsPreview` (`public/js/admin/event-actions.js`)'],
    ['docs/wiki/howto/add-api-endpoint.md', '**Frontend call** (`public/js/app.js`):', '**Frontend call** (the module of the area under `public/js/`, see [frontend-app](../modules/frontend-app.md); CSRF token from `state` in `core/state.js`):'],
    ['docs/wiki/howto/add-api-endpoint.md', "'X-CSRF-TOKEN': csrfToken }", "'X-CSRF-TOKEN': state.csrfToken }"],
    ['docs/wiki/howto/add-event-field.md', '| 5 | `public/js/app.js` | `editEvent()`', '| 5 | `public/js/admin/wizard.js` | `editEvent()`'],
    ['docs/wiki/howto/add-event-field.md', '| 6 | `public/js/app.js` | render it', '| 6 | `public/js/events/detail.js`, `public/js/events/list.js`, `public/js/admin/dashboard.js` | render it'],
    ['docs/wiki/howto/add-form-field-type.md', '| 4 | `public/js/app.js` | `FORM_FIELD_TYPE_LABELS`', '| 4 | `public/js/events/registration-form.js` | `FORM_FIELD_TYPE_LABELS`'],
    ['docs/wiki/howto/add-form-field-type.md', '| 5 | `public/js/app.js` | `renderFormFields`', '| 5 | `public/js/events/registration-form.js`, `public/js/admin/wizard-builders.js` | `renderFormFields`'],
    ['docs/wiki/modules/frontend-markup.md', 'GSAP (`/vendor`), `/js/app.js` |', 'GSAP (`/vendor`), `<script type="module" src="/js/main.js">` (ES modules, see [frontend-app](frontend-app.md)) |'],
    ['docs/wiki/modules/routes-auth.md', '(`public/js/app.js`).', '(`public/js/core/ui.js`).'],
    ['docs/wiki/ops/testing.md', '| `loadFrontendApp(routes)` | runs `public/js/app.js` in `node:vm`;', '| `await loadFrontendApp(routes)` | links the ES modules from `public/js/main.js` with `loadFrontendModules` in a fresh `node:vm` context per call (needs `--experimental-vm-modules`, set by `npm test`); returns `{ app, state, … }` — `app` holds every export of every module, `state` is `core/state.js` (`state.currentUser = persona` logs a user in);'],
    ['docs/wiki/ops/testing.md', 'because most `app.js` handlers swallow errors', 'because most frontend handlers swallow errors'],
    ['docs/wiki/overview/architecture.md', '`index.html` + `js/app.js` + `css/style.css`', '`index.html` + `js/main.js` with ES modules per area (`js/core`, `js/events`, `js/polls`, `js/admin`, `js/pages`) + `css/style.css`'],
    ['docs/wiki/overview/directory-map.md', 'Four files hold most of the tokens (`public/js/app.js`, `public/css/style.css`, `bot.js`, `public/index.html`)', 'Three files hold most of the tokens (`public/css/style.css`, `bot.js`, `public/index.html`)'],
    ['docs/wiki/overview/directory-map.md', '| `public/js/app.js` | ~4550 | the whole SPA: boot, router, sections, admin, forms | **grep** function from the map in [frontend-app](../modules/frontend-app.md) |', '| `public/js/main.js` + `public/js/{core,events,polls,admin,pages}/*.js` | ~20–520 each | the SPA as ES modules, one per area | open the module from the map in [frontend-app](../modules/frontend-app.md) |'],
    ['docs/wiki/overview/request-lifecycle.md', '`public/js/app.js` calls `fetchCSRFToken()` once at startup (`GET /api/csrf-token`, stored in the global `csrfToken`) and sends `headers: { \'X-CSRF-TOKEN\': csrfToken }`', '`public/js/core/boot.js` calls `fetchCSRFToken()` once at startup (`GET /api/csrf-token`, stored in `state.csrfToken` from `core/state.js`) and sends `headers: { \'X-CSRF-TOKEN\': state.csrfToken }`'],
    ['docs/wiki/reference/conventions.md', '- Global functions in `public/js/app.js`, referenced from inline `onclick`.', '- Frontend code lives in ES modules under `public/js/` (one per area, see [frontend-app](../modules/frontend-app.md)); values several modules share are in `state` (`core/state.js`). Functions still called from inline `onclick` sit on `window` through a temporary bridge at the end of their module (removed by D-01).'],
    ['docs/wiki/index.md', '| `public/js/app.js` | frontend-app |', '| `public/js/**` | frontend-app |'],
    ['CLAUDE.md', '**Never read these files whole:** `public/js/app.js` (~4550 lines), `public/css/style.css`', '**Never read these files whole:** `public/css/style.css`'],
    ['CLAUDE.md', '- Ignore `node_modules/`', '- The frontend is ES modules under `public/js/` (one per area, ≤ ~500 lines); open only the module from the map in `docs/wiki/modules/frontend-app.md`.\n- Ignore `node_modules/`'],
    ['CLAUDE.md', 'global functions in `public/js/app.js` used by inline `onclick`;', 'ES modules under `public/js/` (one per area; shared values in `state` from `core/state.js`), functions still used by inline `onclick` sit on a temporary `window` bridge at the end of their module;']
];

const replaceOnce = (file, from, to) => {
    const raw = fs.readFileSync(file, 'utf8');
    const text = raw.replace(/\r\n/g, '\n');
    const parts = text.split(from);
    if (parts.length !== 2) throw new Error(`${file}: expected 1 match, found ${parts.length - 1}: ${from.slice(0, 70)}`);
    const out = parts.join(to);
    fs.writeFileSync(file, raw.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out);
};

for (const [page, modules] of Object.entries(SOURCES)) {
    const file = `docs/wiki/${page}`;
    const line = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n').find(l => l.startsWith('sources: ['));
    replaceOnce(file, line, line.split('public/js/app.js').join(modules));
}
for (const [file, from, to] of TEXT) replaceOnce(file, from, to);
console.log('wiki updated');
```

Dann `docs/wiki/modules/frontend-app.md` neu schreiben:
- **Frontmatter:** `title: public/js — SPA modules and function map`, `sources: [public/js/main.js, public/js/core, public/js/events, public/js/polls, public/js/admin, public/js/pages]`, die übrigen Felder bleiben.
- **TL;DR:** „The SPA is native ES modules without a build step: `public/js/main.js` imports one module per area (`core/`, `events/`, `polls/`, `admin/`, `pages/`, each ≤ ~500 lines). Values several modules share live in `state` (`core/state.js`). A hash router (`handleRoute`) shows one `<section class="app-section">` at a time; every section has a `show*Section()` loader that fetches the REST API and renders HTML strings. Find the module below and open only that file.“
- **Boot sequence:** Wie bisher, aber Schritt 1 lautet „`main.js` registers the startup listeners in the old order: …“. Die Nummer-Hinweise „#1/#2/#3“ bleiben.
- **Router:** unverändert.
- **„Function map by section“** wird zu „## Module map“ mit dieser Tabelle, erzeugt mit:
  ```bash
  node -e "
  const fs = require('fs'), path = require('path');
  for (const f of fs.readdirSync('public/js', { recursive: true }).filter(f => f.endsWith('.js')).map(f => f.split(path.sep).join('/')).sort()) {
    const t = fs.readFileSync('public/js/' + f, 'utf8').replace(/\r\n/g, '\n');
    const doc = (t.match(/^\/\*\*\n((?: \* .*\n)+) \*\//) || [, ''])[1].replace(/ \* /g, '').replace(/\n/g, ' ').trim();
    const fns = [...t.matchAll(/^export (?:async )?function ([\w$]+)/gm)].map(m => '\x60' + m[1] + '\x60');
    console.log('| \x60' + f + '\x60 | ' + doc + ' | ' + fns.join(', ') + ' |');
  }"
  ```
  Kopfzeile: `| Module | Area | Functions (grep \`function <name>\`) |`. Die bisherigen Hinweise aus der alten Tabelle bleiben als Klammer am Funktionsnamen stehen, wo sie Verhalten erklären. Das betrifft `showEventDetail`, `resetEventDetailAreas`, `showProfileSection`, `canOpenEvent`, `reminderHoursOf`, `logout`, `markdownPreview`, `inlineArg`, `showPollEditor`, `collectPollEditor`, `startEventFromPoll` und `renderPollAnswerIcon`.
- **„Globals“** wird zu „## State“: Die 15 Felder von `state` mit je einem Halbsatz aus der alten Globals-Liste. Dazu der Satz „Module-local values (e.g. `activeCategory`, `cachedEvents`, `currentWizardStep`, `calendarMonth`) stay in their module.“ und „`window.DEBUG_MODE`, `window.VERBOSE_LOG`, `window._demsGuildId` stay window properties.“
- **Rules for changes:**
  - Der Fetch-Header wird `'X-CSRF-TOKEN': state.csrfToken`.
  - Die onclick-Regel lautet: „Inline `onclick="fn(...)"` handlers still exist (CSP allows `unsafe-inline`) — the function must be listed in the temporary `Object.assign(window, { … })` bridge at the end of its module; text values go in as `fn(${inlineArg(value)})`. D-01 replaces these with `data-click` actions.“
  - Neue Regel: „New code: export the function, import what you call (`import { escapeHtml } from '../core/ui.js'`), never assign to an imported binding — shared values go through `state`.“

Run: `npm run wiki && npm test 2>&1 | grep -E "^# (tests|pass|fail)"` → alles grün.

- [ ] **Step 10: Browser-Tour**

Run: `npm run test:e2e 2>&1 | tail -2` → `12 passed`.

- [ ] **Step 11: Browser-Prüfung im Mock-Modus**

Den Server mit einer Scratch-Datenbank auf Port 3131 starten. Dafür `DEV_SQLITE_PATH=<scratchpad>/d01.sqlite PORT=3131 node dev/start.js` im Hintergrund laufen lassen. Dann als `admin` einloggen über `/auth/dev-login/admin`, vorher `localStorage.dems_boot_ts` setzen. Durchklicken:
- Event öffnen, Kommentar „Antworten“
- Profil
- Admin: Assistent öffnen und Schritt 2
- Bot-Zentrale

Die Konsole darf keine Fehler zeigen. Danach den Prozess auf Port 3131 per PID beenden (`Get-NetTCPConnection -LocalPort 3131`).

- [ ] **Step 12: Commit**

```bash
git add -A public/js public/index.html test docs/wiki CLAUDE.md
git status --short   # darf nur diese Pfade zeigen; keine Scratchpad-Dateien
git commit -F - <<'EOF'
Split app.js into ES modules per area

The SPA was one 5500-line script with 182 global functions, so every
redesign ticket would land in the same file. A one-off script cut it
along its existing section comments into 28 native ES modules (no build
step): every top-level declaration is exported, imports are computed
from code identifiers, and top-level variables that several modules
read or write moved into core/state.js. Functions that inline handlers
still call stay reachable through a temporary window bridge until the
handlers become data-click actions. The calendar arrows now call
shiftCalendarMonth instead of assigning module variables inline.

Tests load the real module graph per test; a structure test keeps app.js
gone, modules small and import-time code limited.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014NiN2kW8WCg1k6JwibnFqs
EOF
```

---

### Task 4: `core/actions.js` – Event-Delegation und Bild-Fallbacks

**Files:**
- Create: `public/js/core/actions.js`
- Modify: `public/js/main.js` (Import und `initActions(document);` als erste Anweisung nach den Importen)
- Test: `test/frontendActions.test.js`

**Interfaces:**
- Produces (Exporte von `core/actions.js`):
  - `registerActions(map: Object<string, (element, event) => any>): void`. Ein doppelter Name wirft `Error('Action "<name>" is registered twice')`.
  - `initActions(root: Document): void`. Hängt `click`/`change`/`input`-Listener und einen Capture-`error`-Listener an `root`; behandelt bereits gescheiterte `img[data-fallback]`.
  - `runAction(name: string, element, event = {}): Promise<void>`. Fehler und unbekannte Namen landen als `console.error`, es wird nie geworfen.
  - `actionNames(): string[]`
  - Eingebaute Aktionen: `toggleVisible` (`data-change`, `data-target`), `hide` (`data-click`, `data-target`), `scrollTo` (`data-click`, `data-target`).
  - Fallbacks: `data-fallback="hide" | "invisible" | "initials"` (`initials` liest `data-initials` und `title`).

- [ ] **Step 1: Failing test** — `test/frontendActions.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const vm = require('vm');
const { loadFrontendModules, REPO_ROOT } = require('./helpers');

const ACTIONS_FILE = path.join(REPO_ROOT, 'public', 'js', 'core', 'actions.js');

/**
 * Element double: attributes, dataset (data-* in camelCase), parent chain for closest().
 */
function fakeElement(tag, attributes = {}, children = []) {
    const dataset = {};
    for (const [name, value] of Object.entries(attributes)) {
        if (name.startsWith('data-')) dataset[name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = value;
    }
    const element = {
        tagName: tag.toUpperCase(), attributes, dataset, parent: null, style: {}, replacement: null,
        title: attributes.title || '', checked: attributes.checked === 'checked', complete: false, naturalWidth: 0,
        getAttribute: (name) => (name in attributes ? attributes[name] : null),
        closest(selector) {
            const name = selector.slice(1, -1);
            for (let node = this; node; node = node.parent) if (name in node.attributes) return node;
            return null;
        },
        replaceWith(node) { this.replacement = node; }
    };
    for (const child of children) child.parent = element;
    return element;
}

/**
 * Load core/actions.js alone with a recording document and console.
 */
async function loadActions({ elements = {}, images = [] } = {}) {
    const listeners = [];
    const errors = [];
    const document = {
        addEventListener: (type, listener, capture) => listeners.push({ type, listener, capture: !!capture }),
        getElementById: (id) => elements[id] || null,
        querySelectorAll: (selector) => (selector === 'img[data-fallback]' ? images : []),
        createElement: (tag) => ({ tagName: tag.toUpperCase(), className: '', title: '', textContent: '' })
    };
    const context = vm.createContext({ document, console: { error: (...args) => errors.push(args.map(String).join(' ')) } });
    const actions = (await loadFrontendModules(ACTIONS_FILE, context)).get('actions.js');
    const dispatch = (type, target) => {
        const event = { type, target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        for (const entry of listeners.filter(l => l.type === type)) entry.listener(event);
        return event;
    };
    return { actions, document, errors, dispatch, listeners };
}

// initActions always gets the document of the vm context returned by loadActions()
test('the nearest element with an action handles the click, the outer one does not', async () => {
    const { actions, document, dispatch } = await loadActions();
    const calls = [];
    actions.registerActions({ openCard: (el) => calls.push(['card', el.dataset.id]), openDate: (el) => calls.push(['date', el.dataset.id]) });
    actions.initActions(document);
    const icon = fakeElement('i');
    const date = fakeElement('a', { 'data-click': 'openDate', 'data-id': 'd1' }, [icon]);
    fakeElement('div', { 'data-click': 'openCard', 'data-id': 'c1' }, [date]);

    const event = dispatch('click', icon);
    await Promise.resolve();
    assert.deepEqual(calls, [['date', 'd1']]);
    assert.equal(event.defaultPrevented, true, 'a link with an action does not jump to #');
});

test('buttons and checkboxes keep their default behaviour', async () => {
    const { actions, document, dispatch } = await loadActions();
    actions.registerActions({ save: () => {}, toggle: () => {} });
    actions.initActions(document);
    assert.equal(dispatch('click', fakeElement('button', { 'data-click': 'save' })).defaultPrevented, false);
    assert.equal(dispatch('click', fakeElement('input', { 'data-click': 'toggle', type: 'checkbox' })).defaultPrevented, false);
});

test('change and input events use their own attributes', async () => {
    const { actions, document, dispatch } = await loadActions();
    const calls = [];
    actions.registerActions({ pick: (el) => calls.push(['pick', el.value]), typed: () => calls.push(['typed']) });
    actions.initActions(document);
    const select = fakeElement('select', { 'data-change': 'pick' });
    select.value = 'b';
    dispatch('change', select);
    dispatch('input', fakeElement('input', { 'data-input': 'typed' }));
    dispatch('click', select);   // no data-click: nothing happens
    assert.deepEqual(calls, [['pick', 'b'], ['typed']]);
});

test('an unknown action and a failing action are reported, not thrown', async () => {
    const { actions, document, dispatch, errors } = await loadActions();
    actions.registerActions({ broken: () => { throw new Error('kaputt'); }, rejects: async () => { throw new Error('später kaputt'); } });
    actions.initActions(document);
    dispatch('click', fakeElement('button', { 'data-click': 'nope' }));
    dispatch('click', fakeElement('button', { 'data-click': 'broken' }));
    dispatch('click', fakeElement('button', { 'data-click': 'rejects' }));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(errors.length, 3);
    assert.match(errors[0], /Unknown action "nope"/);
    assert.match(errors[1], /Action "broken" failed.*kaputt/);
    assert.match(errors[2], /Action "rejects" failed.*später kaputt/);
});

test('an action name can only be registered once', async () => {
    const { actions } = await loadActions();
    actions.registerActions({ once: () => {} });
    assert.throws(() => actions.registerActions({ once: () => {} }), /Action "once" is registered twice/);
    assert.ok(actions.actionNames().includes('once'));
});

test('runAction calls the handler with element and event', async () => {
    const { actions } = await loadActions();
    const seen = [];
    actions.registerActions({ track: (el, event) => seen.push([el.dataset.id, event.type]) });
    await actions.runAction('track', fakeElement('button', { 'data-id': '7' }), { type: 'click' });
    assert.deepEqual(seen, [['7', 'click']]);
});

test('built-in actions show, hide and scroll to their target', async () => {
    const options = { style: { display: 'none' } };
    const log = { style: { display: '' } };
    let scrolled = null;
    const area = { scrollIntoView: (opts) => { scrolled = opts; } };
    const { actions } = await loadActions({ elements: { options, log, area } });
    const box = fakeElement('input', { 'data-change': 'toggleVisible', 'data-target': 'options' });
    box.checked = true;
    await actions.runAction('toggleVisible', box);
    assert.equal(options.style.display, '');
    box.checked = false;
    await actions.runAction('toggleVisible', box);
    assert.equal(options.style.display, 'none');
    await actions.runAction('hide', fakeElement('button', { 'data-target': 'log' }));
    assert.equal(log.style.display, 'none');
    await actions.runAction('scrollTo', fakeElement('button', { 'data-target': 'area' }));
    assert.deepEqual({ ...scrolled }, { behavior: 'smooth' });
});

test('broken images fall back: hide, invisible, initials', async () => {
    const { actions, document, listeners } = await loadActions();
    actions.initActions(document);
    const onError = listeners.find(l => l.type === 'error');
    assert.equal(onError.capture, true, 'error events do not bubble, the listener must capture');
    const hide = fakeElement('img', { 'data-fallback': 'hide' });
    const invisible = fakeElement('img', { 'data-fallback': 'invisible' });
    const initials = fakeElement('img', { 'data-fallback': 'initials', 'data-initials': 'X', title: "X'+(globalThis.pwned=1)+'" });
    for (const target of [hide, invisible, initials]) onError.listener({ type: 'error', target });
    assert.equal(hide.style.display, 'none');
    assert.equal(invisible.style.visibility, 'hidden');
    assert.deepEqual({ ...initials.replacement }, { tagName: 'DIV', className: 'participant-avatar-placeholder', title: "X'+(globalThis.pwned=1)+'", textContent: 'X' });
});

test('images that failed before the modules ran get their fallback at start', async () => {
    const failed = fakeElement('img', { 'data-fallback': 'hide', src: '' });
    failed.complete = true;
    const loading = fakeElement('img', { 'data-fallback': 'hide', src: '/a.png' });
    const loaded = fakeElement('img', { 'data-fallback': 'hide', src: '/b.png' });
    loaded.complete = true;
    loaded.naturalWidth = 32;
    const { actions, document } = await loadActions({ images: [failed, loading, loaded] });
    actions.initActions(document);
    assert.equal(failed.style.display, 'none');
    assert.equal(loading.style.display, undefined);
    assert.equal(loaded.style.display, undefined);
});
```

Run: `npm test 2>&1 | grep -E "frontendActions|^# fail"` → FAIL (`ENOENT … core/actions.js`).

- [ ] **Step 2: Implementierung** — `public/js/core/actions.js`:

```js
/**
 * Event delegation for the SPA. Markup names an action, the module that owns
 * the function registers what it does:
 *   <button data-click="editEvent" data-event-id="…">
 *   registerActions({ editEvent: (el) => editEvent(el.dataset.eventId) });
 * Replaces inline onclick/onchange/oninput/onerror handlers, so the CSP can
 * forbid them. Broken images use data-fallback="hide|invisible|initials".
 */

const actions = new Map();

// Event type -> attribute that names the action
const ACTION_ATTRIBUTES = { click: 'data-click', change: 'data-change', input: 'data-input' };

const FALLBACKS = {
    hide: (img) => { img.style.display = 'none'; },
    invisible: (img) => { img.style.visibility = 'hidden'; },
    initials: (img) => {
        const placeholder = document.createElement('div');
        placeholder.className = 'participant-avatar-placeholder';
        placeholder.title = img.title;
        placeholder.textContent = img.dataset.initials || '?';
        img.replaceWith(placeholder);
    }
};

/**
 * Register actions by name. Every module registers its own on import.
 *
 * @param {Object<string, Function>} map -> Name -> (element, event) => any.
 * @returns {void}
 */
export function registerActions(map) {
    for (const [name, handler] of Object.entries(map)) {
        if (actions.has(name)) throw new Error(`Action "${name}" is registered twice`);
        actions.set(name, handler);
    }
}

/**
 * Names of all registered actions (for the guard tests).
 *
 * @returns {string[]}
 */
export function actionNames() {
    return [...actions.keys()];
}

/**
 * Run one action. Unknown names and errors end up in the console, never as
 * an exception in the event listener.
 *
 * @param {string} name -> Action name.
 * @param {Element} element -> Element that carries the action attribute.
 * @param {Event|Object} [event] -> Triggering event.
 * @returns {Promise<void>}
 */
export async function runAction(name, element, event = {}) {
    const handler = actions.get(name);
    if (!handler) {
        console.error(`Unknown action "${name}"`);
        return;
    }
    try {
        await handler(element, event);
    } catch (err) {
        console.error(`Action "${name}" failed:`, err);
    }
}

/**
 * Listen for actions and image errors below `root`; give images that failed
 * before the modules ran their fallback now.
 *
 * @param {Document} root -> Usually document.
 * @returns {void}
 */
export function initActions(root) {
    for (const [type, attribute] of Object.entries(ACTION_ATTRIBUTES)) {
        root.addEventListener(type, (event) => dispatch(event, attribute));
    }
    // error does not bubble; the capture phase still sees it at the root
    root.addEventListener('error', (event) => {
        const target = event.target;
        if (target && target.tagName === 'IMG' && target.dataset && target.dataset.fallback) applyFallback(target);
    }, true);
    for (const img of root.querySelectorAll('img[data-fallback]')) {
        if (img.complete && img.naturalWidth === 0) applyFallback(img);
    }
}

function dispatch(event, attribute) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    // The innermost element with an action wins; outer actions do not run
    const element = target.closest(`[${attribute}]`);
    if (!element) return;
    if (attribute === 'data-click' && element.tagName === 'A') event.preventDefault();
    runAction(element.getAttribute(attribute), element, event);
}

function applyFallback(img) {
    const fallback = FALLBACKS[img.dataset.fallback];
    if (fallback) fallback(img);
    else console.error(`Unknown image fallback "${img.dataset.fallback}"`);
}

registerActions({
    toggleVisible: (el) => {
        const target = document.getElementById(el.dataset.target);
        if (target) target.style.display = el.checked ? '' : 'none';
    },
    hide: (el) => {
        const target = document.getElementById(el.dataset.target);
        if (target) target.style.display = 'none';
    },
    scrollTo: (el) => document.getElementById(el.dataset.target)?.scrollIntoView({ behavior: 'smooth' })
});
```

- [ ] **Step 3: `main.js` verdrahten** — Import `import { initActions } from './core/actions.js';` zu den Importen, und als erste Anweisung nach den Importen:

```js
initActions(document);
```

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test 2>&1 | grep -E "^not ok|^# (tests|pass|fail)"` → alles grün.
Run: `npm run test:e2e 2>&1 | tail -2` → `12 passed`.

- [ ] **Step 5: Wiki** — `docs/wiki/modules/frontend-app.md`:
- Module map: Zeile für `core/actions.js` ergänzen.
- Rules: „Actions: `data-click="name"` / `data-change` / `data-input` on the element, parameters in `data-*` (escaped with `escapeHtml`), `registerActions({ name: (el) => fn(el.dataset.x) })` at the end of the owning module; the innermost action wins; links get `preventDefault`. Broken images: `data-fallback="hide|invisible|initials"`. Built-in: `toggleVisible`, `hide`, `scrollTo` with `data-target`.“

`npm run wiki`, `npm test`.

- [ ] **Step 6: Commit**

```bash
git add public/js/core/actions.js public/js/main.js test/frontendActions.test.js docs/wiki
git commit -F - <<'EOF'
Add event delegation for data-click, data-change and data-input

Inline event handlers keep the CSP at 'unsafe-inline' and put handler
code into HTML strings. core/actions.js lets markup name an action
while the owning module registers it; one listener per event type on
document dispatches to the innermost element with an action. Images
get their fallback from data-fallback through a capturing error
listener, and images that failed before the modules ran are handled
at start.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014NiN2kW8WCg1k6JwibnFqs
EOF
```

---

## Gemeinsames Vorgehen für die Bereichs-Tasks 5–11

Jeder Bereichs-Task folgt demselben Ablauf:

1. **Test zuerst** in `test/actionAttributes.test.js`. Die Datei entsteht in Task 5 per `git mv test/inlineHandlers.test.js test/actionAttributes.test.js`. Die Helfer stehen weiter unten.
2. **Markup umstellen** laut Tabelle des Tasks. Inline-Handler entfernen, `data-click`/`data-change`/`data-input` mit wörtlichem Namen setzen und Parameter als `data-*` mit `escapeHtml(...)` übergeben. `event.stopPropagation()` und `return false` fallen ersatzlos weg.
3. **Aktionen registrieren:** Am Ende des Moduls einen `registerActions({ … })`-Block anlegen (Import aus `../core/actions.js`), und zwar **vor** der Brücke.
4. **Brücke kürzen:** Aus `Object.assign(window, { … })` jeden Namen streichen, der in keinem Inline-Handler mehr vorkommt. Prüfen mit:
   ```bash
   grep -rhoE '\son(click|change|input|error)="[^"]*' public/index.html public/js | grep -oE '[A-Za-z_$][A-Za-z0-9_$]*\(' | sort -u
   ```
   Jeder Name in einer Brücke muss in dieser Liste stehen. Ist eine Brücke leer, Zeile und Kommentar löschen.
5. **Bereich prüfen:** `grep -nE '\son(click|change|input|error)=' <Moduldateien des Tasks>` muss leer sein, bei `index.html` nur für die Abschnitte des Tasks.
6. `npm test`, `npm run test:e2e`, Wiki (`frontend-app.md`, falls sich Funktionsnamen oder Signaturen ändern), `npm run wiki`, Commit.

**Helfer in `test/actionAttributes.test.js`** (in Task 5 einfügen, nach den Konstanten):

```js
const fs = require('fs');
const path = require('path');
const { REPO_ROOT } = require('./helpers');

const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');

/**
 * Elements in rendered HTML that carry `attribute`, with every attribute decoded.
 *
 * @param {string} html -> Rendered HTML.
 * @param {string} attribute -> e.g. "data-click".
 * @returns {Array<{ tag: string, attributes: Object<string, string> }>}
 */
function elementsWith(html, attribute) {
    const found = [];
    for (const tag of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
        const attributes = {};
        for (const attr of tag[2].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
            attributes[attr[1]] = decodeAttribute(attr[2] ?? attr[3]);
        }
        if (attribute in attributes) found.push({ tag: tag[1].toLowerCase(), attributes });
    }
    return found;
}

/**
 * Elements whose data-click/change/input names `action`; at least one must exist.
 */
function actionTargets(html, action, type = 'click') {
    const targets = elementsWith(html, `data-${type}`).filter(element => element.attributes[`data-${type}`] === action);
    assert.ok(targets.length > 0, `no element with data-${type}="${action}"`);
    return targets;
}

/**
 * Element double for app.runAction(): dataset from the data-* attributes.
 */
function actionElement({ tag, attributes }, extra = {}) {
    const dataset = {};
    for (const [name, value] of Object.entries(attributes)) {
        if (name.startsWith('data-')) dataset[name.slice(5).replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = value;
    }
    return { tagName: tag.toUpperCase(), dataset, value: attributes.value, getAttribute: (name) => attributes[name] ?? null, ...extra };
}

function assertNoInlineHandlers(html) {
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i);
}
```

`decodeAttribute` steht schon in der Datei (aus dem Hotfix). Die alten Helfer `attributeValues`, `handlerCalling`, `runHandler` und `assertCallsOnly` werden in dem Task gelöscht, in dem ihr letzter Nutzer verschwindet (Task 9).

---

### Task 5: Übersicht (Karten, Kategorien, Suche, Raster/Kalender)

**Files:**
- Modify: `public/js/events/list.js`, `public/js/core/router.js`, `public/index.html` (Suche, Ansicht-Buttons, Zurück-Button der Event-Seite)
- Rename: `test/inlineHandlers.test.js` → `test/actionAttributes.test.js`
- Modify: `e2e/tour.spec.js`

**Interfaces:**
- Consumes: `registerActions`, `runAction` (Task 4); `shiftCalendarMonth(delta)` (Task 3)
- Produces: Aktionen `navigateTo` (router, `data-route`), `showEventsSection`, `toggleSeriesDates` (`data-card-id`), `filterByCategory` (`data-category`), `debouncedSearch` (`data-input`), `switchView` (`data-view`), `shiftCalendarMonth` (`data-delta`)

| Stelle | vorher | nachher |
|---|---|---|
| `index.html` Suchfeld | `oninput="debouncedSearch()"` | `data-input="debouncedSearch"` |
| `index.html` Raster-Button | `onclick="switchView('grid')"` | `data-click="switchView" data-view="grid"` |
| `index.html` Kalender-Button | `onclick="switchView('calendar')"` | `data-click="switchView" data-view="calendar"` |
| `index.html` Zurück (Event-Seite) | `onclick="navigateTo('events')"` | `data-click="navigateTo" data-route="events"` |
| `showEventsSection` Fehler-Button | `onclick="showEventsSection()"` | `data-click="showEventsSection"` |
| Serien-Termine (2×) | `onclick="event.stopPropagation(); navigateTo('event/${d.id}'); return false;"` | `data-click="navigateTo" data-route="event/${escapeHtml(d.id)}"` |
| Serien-Umschalter | `onclick="event.stopPropagation(); toggleSeriesDates('${seriesCardId}'); return false;"` | `data-click="toggleSeriesDates" data-card-id="${escapeHtml(seriesCardId)}"` |
| Event-Karte | `onclick="navigateTo('event/${event.id}')"` | `data-click="navigateTo" data-route="event/${escapeHtml(event.id)}"` |
| Kategorie „Alle“ | `onclick="filterByCategory('')"` | `data-click="filterByCategory" data-category=""` |
| Kategorie | `onclick="filterByCategory(${inlineArg(cat)})"` | `data-click="filterByCategory" data-category="${escapeHtml(cat)}"` |
| Kalender zurück/vor | `onclick="shiftCalendarMonth(-1)"` / `(1)` | `data-click="shiftCalendarMonth" data-delta="-1"` / `"1"` |
| Kalender-Event | `onclick="event.stopPropagation();navigateTo('event/${ev.id}')"` | `data-click="navigateTo" data-route="event/${escapeHtml(ev.id)}"` |

Am Ende von `events/list.js`:
```js
registerActions({
    showEventsSection: () => showEventsSection(),
    toggleSeriesDates: (el) => toggleSeriesDates(el.dataset.cardId),
    filterByCategory: (el) => filterByCategory(el.dataset.category),
    debouncedSearch: () => debouncedSearch(),
    switchView: (el) => switchView(el.dataset.view),
    shiftCalendarMonth: (el) => shiftCalendarMonth(Number(el.dataset.delta))
});
```
Am Ende von `core/router.js`:
```js
registerActions({ navigateTo: (el) => navigateTo(el.dataset.route) });
```

- [ ] **Step 1: Datei umbenennen und Helfer einfügen**

`git mv test/inlineHandlers.test.js test/actionAttributes.test.js`, dann die Helfer aus dem gemeinsamen Abschnitt einfügen.

- [ ] **Step 2: Failing tests** — den Test `category pills filter by the exact category` ersetzen durch:

```js
test('the overview opens events and filters categories through actions', async () => {
    const solo = adminEvent('solo', { title: 'Solo' });
    const series = adminEvent('s1', { title: 'Serie', seriesId: 'series-1', seriesDates: [{ id: 's1', startDate: '2026-10-20T18:00:00.000Z' }, { id: 's2', startDate: '2026-10-27T18:00:00.000Z' }] });
    const { app, state, element, location, requests } = await loadFrontendApp({
        '/api/events/categories': [TRICKY_TEXT],
        '/api/events': { data: [solo, series], meta: { total: 2, page: 1, limit: 20, totalPages: 1 } }
    });
    state.currentUser = MEMBER;
    await app.showEventsSection();
    const grid = element('events-grid').innerHTML;
    const bar = element('category-filter-bar').innerHTML;
    assertNoInlineHandlers(grid);
    assertNoInlineHandlers(bar);

    const card = actionTargets(grid, 'navigateTo').find(target => target.attributes['data-route'] === 'event/solo');
    await app.runAction('navigateTo', actionElement(card));
    assert.equal(location.hash, '#event/solo');
    const routes = actionTargets(grid, 'navigateTo').map(target => target.attributes['data-route']);
    assert.ok(routes.includes('event/s2'), 'series dates open their event');

    const pill = actionTargets(bar, 'filterByCategory').find(target => target.attributes['data-category'] === TRICKY_TEXT);
    await app.runAction('filterByCategory', actionElement(pill));
    assert.ok(requests.some(r => r.url.includes(`category=${encodeURIComponent(TRICKY_TEXT)}`)), 'filters by the exact category');
});

test('the calendar arrows move one month in each direction', async () => {
    const { app, state, element } = await loadFrontendApp({
        '/api/events/categories': [],
        '/api/events': { data: [], meta: { total: 0, page: 1, limit: 20, totalPages: 1 } }
    });
    state.currentUser = MEMBER;
    const [calendarButton] = elementsWith(INDEX_HTML, 'data-click').filter(e => e.attributes['data-view'] === 'calendar');
    await app.runAction('switchView', actionElement(calendarButton));
    const month = () => element('events-calendar').innerHTML.match(/<h4>([^<]*)<\/h4>/)[1];
    const start = month();
    const back = actionTargets(element('events-calendar').innerHTML, 'shiftCalendarMonth').find(t => t.attributes['data-delta'] === '-1');
    await app.runAction('shiftCalendarMonth', actionElement(back));
    assert.notEqual(month(), start);
    assert.doesNotMatch(month(), /undefined/);
    const forward = actionTargets(element('events-calendar').innerHTML, 'shiftCalendarMonth').find(t => t.attributes['data-delta'] === '1');
    await app.runAction('shiftCalendarMonth', actionElement(forward));
    assert.equal(month(), start);
});
```
Run: `npm test 2>&1 | grep -E "actionAttributes|^# fail"` → FAIL (`no element with data-click="navigateTo"` bzw. `"switchView"`).

Lässt `switchView('calendar')` den Kalender nicht rendern, weil `renderCalendar` erst in `showEventsSection` läuft, dann im zweiten Test vor `switchView` ein `await app.showEventsSection();` einfügen.

- [ ] **Step 3: Markup und Aktionen umstellen** laut Tabelle; `registerActions` in `events/list.js` und `core/router.js`; Brücke kürzen. `navigateTo` bleibt in der Router-Brücke, bis Task 6 und Task 11 ihre Stellen umgestellt haben.

- [ ] **Step 4: Tour erweitern** — in `e2e/tour.spec.js` nach `await expect(page.locator('#events-grid .event-card').first()).toBeVisible();`:

```js
        // Grid/calendar switch, month arrows and category filter run as data-click actions
        await page.locator('#view-calendar-btn').click();
        await expect(page.locator('#events-calendar')).toBeVisible();
        await page.locator('#events-calendar [data-click="shiftCalendarMonth"][data-delta="1"]').click();
        await page.locator('#view-grid-btn').click();
        await expect(page.locator('#events-grid')).toBeVisible();
        await page.locator('#category-filter-bar .category-pill', { hasText: 'Gaming' }).click();
        await expect(page.locator('#events-grid .event-card', { hasText: 'Community-Spieleabend' })).toBeVisible();
        await expect(page.locator('#events-grid')).not.toContainText('Raid: Schattenfestung');
        await page.locator('#category-filter-bar .category-pill', { hasText: 'Alle' }).click();
```

- [ ] **Step 5: Tests, Tour, Wiki, Commit**

Run: `npm test` (alles grün), `npm run test:e2e` (`12 passed`), `npm run wiki`.

```bash
git add public/js public/index.html test e2e docs/wiki
git commit -F - <<'EOF'
Use data-click actions in the event overview

Cards, series dates, category pills, the search box, the grid/calendar
switch and the calendar arrows no longer use inline handlers. The
innermost action wins, so the stopPropagation calls on series dates and
calendar entries are gone; category names travel as plain data
attributes instead of JS strings.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014NiN2kW8WCg1k6JwibnFqs
EOF
```

---

### Task 6: Event-Seite (Details, Slots, Formular, Gäste, Check-in, Kommentare)

**Files:**
- Modify: `public/js/events/{detail,slots,registration-form,guests,checkin,comments}.js`, `public/index.html` (Gastsuche, Abmelden)
- Modify: `test/helpers.js` (Fake-Element `focus() {}`; `requests` speichert `body`)
- Modify: `test/actionAttributes.test.js`, `e2e/tour.spec.js`

**Interfaces:**
- Consumes: Task 4, Task 5 (`navigateTo`-Aktion)
- Produces:
  - `replyToComment(commentId: string, userName: string)`. **Signatur ändert sich**, `eventId` fällt weg. Die Funktion fasst den Senden-Button nicht mehr an.
  - Die Aktion `postComment` liest `#comment-input.dataset.replyTo`, löscht es und ruft `postComment(eventId, replyTo)`.
  - `requests`-Einträge im Test-Gerüst haben jetzt `{ url, method, headers, body }`.

| Stelle | vorher | nachher |
|---|---|---|
| `detail.js` Button „zur Anmeldung“ | `onclick="document.getElementById('detail-register-area')?.scrollIntoView({behavior:'smooth'}); return false;"` | `data-click="scrollTo" data-target="detail-register-area"` |
| `detail.js` Teilnehmer-Avatar | `onerror="const fallback = …; this.replaceWith(fallback)"` | `data-fallback="initials"` (`data-initials` bleibt) |
| `detail.js` Serien-Termin | `onclick="navigateTo('event/${se.id}'); return false;"` | `data-click="navigateTo" data-route="event/${escapeHtml(se.id)}"` |
| `detail.js` Serien-Umschalter | `onclick="toggleDetailSeriesDates(); return false;"` | `data-click="toggleDetailSeriesDates"` |
| `slots.js` Slot-Karte | `onclick="selectPrimarySlot(this.dataset.slotId)"` | `data-click="selectPrimarySlot"` (`data-slot-id` bleibt) |
| `slots.js` Wunschrolle | `onclick="toggleAltSlot(this.dataset.slotId)"` | `data-click="toggleAltSlot"` |
| `slots.js` Aufstellungs-Avatar | `onerror="this.style.visibility='hidden'"` | `data-fallback="invisible"` |
| `slots.js` Slot wechseln | `onclick="switchMySlot(this.dataset.eventId)"` | `data-click="switchMySlot"` (`data-event-id` bleibt) |
| `checkin.js` Code erzeugen | `onclick="generateCheckinCode('${eventId}')"` | `data-click="generateCheckinCode" data-event-id="${escapeHtml(eventId)}"` |
| `checkin.js` Einchecken | `onclick="submitCheckin('${eventId}')"` | `data-click="submitCheckin" data-event-id="${escapeHtml(eventId)}"` |
| `comments.js` Senden | `onclick="postComment('${eventId}')"` | `data-click="postComment" data-event-id="${escapeHtml(eventId)}"` |
| `comments.js` Kommentar-Avatar | `onerror="this.style.display='none'"` | `data-fallback="hide"` |
| `comments.js` Antworten | `onclick="replyToComment('${eventId}', '${comment.id}', ${inlineArg(comment.userName)})"` | `data-click="replyToComment" data-comment-id="${escapeHtml(comment.id)}" data-user-name="${escapeHtml(comment.userName)}"` |
| `comments.js` Löschen | `onclick="deleteComment('${eventId}', '${comment.id}')"` | `data-click="deleteComment" data-event-id="${escapeHtml(eventId)}" data-comment-id="${escapeHtml(comment.id)}"` |
| `guests.js` Suchergebnis | `onclick="addGuestToList(${inlineArg({ … })})"` | `data-click="addGuestToList" data-user-id="${escapeHtml(u.id)}" data-display-name="${escapeHtml(u.displayName)}" data-avatar="${escapeHtml(u.avatar \|\| '')}"` |
| `guests.js` Ergebnis-Avatar | `onerror="this.src='/img/default-avatar.png'"` | `data-fallback="hide"` |
| `guests.js` gewählter Gast, Avatar | `onerror="this.src=''"` | `data-fallback="hide"` |
| `guests.js` Gast entfernen | `onclick="removeGuestFromList(${inlineArg(g.id)})"` | `data-click="removeGuestFromList" data-user-id="${escapeHtml(g.id)}"` |
| `index.html` Gastsuche | `oninput="debounceGuestSearch()"` | `data-input="debounceGuestSearch"` |
| `index.html` Abmelden vom Event | `onclick="unregisterFromEvent()"` | `data-click="unregisterFromEvent"` |

`replyToComment` neu (`comments.js`):
```js
export function replyToComment(commentId, userName) {
    const input = document.getElementById('comment-input');
    if (!input) return;
    input.value = `@${userName} `;
    input.focus();
    // The postComment action sends the next comment as a reply to this one
    input.dataset.replyTo = commentId;
}
```

Registrierungen:
```js
// events/detail.js
registerActions({ toggleDetailSeriesDates: () => toggleDetailSeriesDates() });

// events/slots.js
registerActions({
    selectPrimarySlot: (el) => selectPrimarySlot(el.dataset.slotId),
    toggleAltSlot: (el) => toggleAltSlot(el.dataset.slotId),
    switchMySlot: (el) => switchMySlot(el.dataset.eventId)
});

// events/checkin.js
registerActions({
    generateCheckinCode: (el) => generateCheckinCode(el.dataset.eventId),
    submitCheckin: (el) => submitCheckin(el.dataset.eventId)
});

// events/comments.js
registerActions({
    postComment: (el) => {
        // A reply target set by replyToComment applies to the next post only
        const input = document.getElementById('comment-input');
        const replyTo = input?.dataset.replyTo || null;
        if (input) delete input.dataset.replyTo;
        return postComment(el.dataset.eventId, replyTo);
    },
    replyToComment: (el) => replyToComment(el.dataset.commentId, el.dataset.userName),
    deleteComment: (el) => deleteComment(el.dataset.eventId, el.dataset.commentId)
});

// events/guests.js
registerActions({
    debounceGuestSearch: () => debounceGuestSearch(),
    addGuestToList: (el) => addGuestToList({ id: el.dataset.userId, displayName: el.dataset.displayName, avatar: el.dataset.avatar }),
    removeGuestFromList: (el) => removeGuestFromList(el.dataset.userId)
});

// events/registration-form.js
registerActions({ unregisterFromEvent: () => unregisterFromEvent() });
```

- [ ] **Step 1: Test-Gerüst** (`test/helpers.js`)
- In `createFakeElement` nach `removeEventListener() {},` die Zeile `focus() {},` einfügen.
- In `fetch` die Zeile `requests.push({ url, method: options.method || 'GET', headers: options.headers || {} });` ersetzen durch `requests.push({ url, method: options.method || 'GET', headers: options.headers || {}, body: options.body });`.
- In der JSDoc von `loadFrontendApp` den Hinweis `{ url, method, headers }` zu `{ url, method, headers, body }` ändern.

- [ ] **Step 2: Failing tests** — in `test/actionAttributes.test.js` drei Tests ersetzen. `the reply button passes a comment author name with quotes as plain text` wird zu:

```js
test('replying sends the next comment once as a reply, the one after as a normal comment', async () => {
    const comment = { id: 'c1', userId: 'u-x', userName: QUOTE_NAME, text: 'Hallo', createdAt: '2026-10-01T18:00:00.000Z' };
    const { app, state, element, requests } = await loadFrontendApp(eventRoutes({ comments: [comment] }));
    state.currentUser = MEMBER;
    await app.showEventDetail('ev');
    await settle();
    const html = element('comments-section').innerHTML;
    assertNoInlineHandlers(html);

    const [reply] = actionTargets(html, 'replyToComment');
    assert.equal(reply.attributes['data-user-name'], QUOTE_NAME);
    await app.runAction('replyToComment', actionElement(reply));
    assert.equal(element('comment-input').value, `@${QUOTE_NAME} `);

    const [send] = actionTargets(html, 'postComment');
    element('comment-input').value = 'Antwort';
    await app.runAction('postComment', actionElement(send));
    await settle();
    element('comment-input').value = 'Noch was';
    await app.runAction('postComment', actionElement(send));
    await settle();

    const posts = requests.filter(r => r.method === 'POST').map(r => JSON.parse(r.body));
    assert.deepEqual(posts, [{ text: 'Antwort', replyTo: 'c1' }, { text: 'Noch was', replyTo: null }]);
});
```

`a broken participant avatar falls back to initials without running the name` wird zu:
```js
test('a participant avatar carries its initials fallback as data', async () => {
    const participant = { displayName: AVATAR_NAME, avatar: 'https://cdn.example/avatar.png' };
    const { app, state, element } = await loadFrontendApp(eventRoutes({ participants: [participant] }));
    state.currentUser = MEMBER;
    await app.showEventDetail('ev');
    await settle();
    const html = element('detail-participants-avatars').innerHTML;
    assertNoInlineHandlers(html);
    const [img] = elementsWith(html, 'data-fallback');
    assert.deepEqual([img.attributes['data-fallback'], img.attributes['data-initials'], img.attributes.title], ['initials', 'X', AVATAR_NAME]);
});
```

`adding a guest from the search passes the member as data` und `removing a selected guest passes the id unchanged` werden zu:
```js
test('guests are added and removed through actions with their exact data', async () => {
    const user = { id: '42', displayName: ENTITY_NAME, username: 'mal', avatar: 'https://cdn.example/a.png' };
    const { app, state, element } = await loadFrontendApp({ '/api/user/search?q=ma': [user] });
    element('guest-search-input').value = 'ma';
    await app.searchGuests();
    const results = element('guest-search-results').innerHTML;
    assertNoInlineHandlers(results);

    const [add] = actionTargets(results, 'addGuestToList');
    await app.runAction('addGuestToList', actionElement(add));
    assert.deepEqual({ ...state.selectedGuests[0] }, { id: '42', displayName: ENTITY_NAME, avatar: user.avatar });

    const selected = element('selected-guests').innerHTML;
    assertNoInlineHandlers(selected);
    const [remove] = actionTargets(selected, 'removeGuestFromList');
    await app.runAction('removeGuestFromList', actionElement(remove));
    assert.equal(state.selectedGuests.length, 0);
});
```
Run: `npm test 2>&1 | grep -E "^not ok"` → die drei neuen Tests rot.

- [ ] **Step 3: Markup, `replyToComment`, Aktionen und Brücke umstellen** laut Tabelle und Code oben. Die alte Override-Logik in `replyToComment` (`btn.onclick = …`) wird gelöscht. In `events/guests.js` wird `inlineArg` nicht mehr importiert, sobald es dort nicht mehr vorkommt, ebenso in `comments.js`.

- [ ] **Step 4: Tour erweitern** — Test `the raid shows the role picker …` direkt nach `await expect(page.locator('#detail-no-access')).toBeHidden();` ergänzen:

```js
    // Slot choice and wish roles run as data-click actions
    const firstSlot = page.locator('#slot-picker-cards [data-click="selectPrimarySlot"]').first();
    await firstSlot.click();
    await expect(firstSlot).toHaveClass(/selected/);
    const firstWish = page.locator('#slot-alt-chips [data-click="toggleAltSlot"]').first();
    await firstWish.click();
    await expect(firstWish).toHaveClass(/selected/);
```
`firstWish` wird nach dem Klick neu gerendert. Der Locator sucht neu, das ist gewollt.

- [ ] **Step 5: Tests, Tour, Wiki, Commit**

Wiki:
- `docs/wiki/modules/frontend-app.md`: Signatur `replyToComment(commentId, userName)` und den Satz „the `postComment` action sends a pending reply (`#comment-input.dataset.replyTo`) once“.
- `docs/wiki/ops/testing.md`: `requests` hat jetzt `body`.

Run: `npm test` (grün), `npm run test:e2e` (`12 passed`), `npm run wiki`.

```bash
git add public/js public/index.html test e2e docs/wiki
git commit -F - <<'EOF'
Use data-click actions on the event page

Slot picker, check-in, comments, guests, series dates and avatar
fallbacks no longer use inline handlers. replyToComment used to swap the
send button's onclick; with delegation that would have posted twice, so
it now only marks the reply target and the postComment action sends it
once. Display names travel as data attributes, never as JS code.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014NiN2kW8WCg1k6JwibnFqs
EOF
```

---

### Task 7: Abstimmungen

**Files:**
- Modify: `public/js/polls/polls.js`, `public/js/polls/admin.js`, `public/index.html` (Abstimmungs-Bereich und -Dialoge)
- Modify: `test/actionAttributes.test.js`, `e2e/tour.spec.js`

**Interfaces:**
- Produces: Aktionen `setPollVote`, `showPollEditor`, `addPollOptionRow`, `removePollOptionRow`, `togglePollRoles`, `savePoll`, `showPollAnnounceDialog`, `sendPollAnnouncement`, `closePollFromUi`, `deletePollFromUi`, `showPollDecideDialog`, `startEventFromPoll` (Poll-Aktionen lesen `data-poll-id`).

| Stelle | vorher | nachher |
|---|---|---|
| `polls.js` Stimm-Buttons | `onclick="setPollVote(this.dataset.optionId, this.dataset.state)"` | `data-click="setPollVote"` (`data-option-id`, `data-state` bleiben) |
| `admin.js` Termin entfernen | `onclick="this.closest('.poll-option-row').remove()"` | `data-click="removePollOptionRow"` |
| `admin.js` `renderPollAdminBar` | `onclick="${handler}(this.dataset.pollId)"` | siehe Code unten |
| `index.html` Neue Abstimmung | `onclick="showPollEditor()"` | `data-click="showPollEditor"` |
| `index.html` Termin hinzufügen | `onclick="addPollOptionRow()"` | `data-click="addPollOptionRow"` |
| `index.html` Rollen-Schalter | `onchange="togglePollRoles()"` | `data-change="togglePollRoles"` |
| `index.html` Speichern | `onclick="savePoll()"` | `data-click="savePoll"` |
| `index.html` Posten | `onclick="sendPollAnnouncement()"` | `data-click="sendPollAnnouncement"` |
| `index.html` Event erstellen | `onclick="startEventFromPoll()"` | `data-click="startEventFromPoll"` |

`renderPollAdminBar`: Die Aktionsnamen müssen wörtlich im Quelltext stehen. Der Helfer bekommt deshalb das fertige Attribut statt eines Namens:
```js
    const button = (cls, action, icon, label) =>
        `<button class="btn btn-sm ${cls}" data-poll-id="${id}" ${action}><i class="bi ${icon} me-1"></i>${label}</button>`;
    const buttons = [button('btn-outline-light', 'data-click="showPollAnnounceDialog"', 'bi-discord', 'In Discord posten')];
    if (poll.status === 'open') {
        buttons.push(button('btn-outline-light', 'data-click="showPollEditor"', 'bi-pencil', 'Bearbeiten'));
        buttons.push(button('btn-outline-light', 'data-click="closePollFromUi"', 'bi-lock', 'Abstimmung beenden'));
    }
    if (poll.status !== 'decided') {
        buttons.push(button('btn-accent', 'data-click="showPollDecideDialog"', 'bi-calendar-plus', 'Event erstellen'));
    }
    buttons.push(button('btn-outline-danger', 'data-click="deletePollFromUi"', 'bi-trash', 'Löschen'));
```

Registrierungen:
```js
// polls/polls.js
registerActions({ setPollVote: (el) => setPollVote(el.dataset.optionId, el.dataset.state) });

// polls/admin.js
registerActions({
    showPollEditor: (el) => showPollEditor(el.dataset.pollId),
    addPollOptionRow: () => addPollOptionRow(),
    removePollOptionRow: (el) => el.closest('.poll-option-row').remove(),
    togglePollRoles: () => togglePollRoles(),
    savePoll: () => savePoll(),
    showPollAnnounceDialog: (el) => showPollAnnounceDialog(el.dataset.pollId),
    sendPollAnnouncement: () => sendPollAnnouncement(),
    closePollFromUi: (el) => closePollFromUi(el.dataset.pollId),
    deletePollFromUi: (el) => deletePollFromUi(el.dataset.pollId),
    showPollDecideDialog: (el) => showPollDecideDialog(el.dataset.pollId),
    startEventFromPoll: () => startEventFromPoll()
});
```
`showPollEditor(pollId = null)`: Ohne `data-poll-id` ist `el.dataset.pollId` `undefined`, und der Standardwert `null` greift wie beim bisherigen Aufruf ohne Argument.

- [ ] **Step 1: Failing test** (`test/actionAttributes.test.js`):

```js
test('the poll admin bar names its actions literally and passes the poll id', async () => {
    const { app, state, element } = await loadFrontendApp({});
    state.currentUser = { ...MEMBER, isAdmin: true };
    app.renderPollAdminBar({ id: "p'1", status: 'open' });
    const html = element('poll-admin-bar').innerHTML;
    assertNoInlineHandlers(html);
    const names = elementsWith(html, 'data-click').map(e => [e.attributes['data-click'], e.attributes['data-poll-id']]);
    assert.deepEqual(names, [
        ['showPollAnnounceDialog', "p'1"], ['showPollEditor', "p'1"], ['closePollFromUi', "p'1"],
        ['showPollDecideDialog', "p'1"], ['deletePollFromUi', "p'1"]
    ]);
});
```
Run: rot (`[]` statt der Liste).

Gibt es `#poll-admin-bar` nicht als Id in `index.html`, liefert `element(...)` `null`. Dann in `renderPollAdminBar` die tatsächlich verwendete Id nachsehen und im Test einsetzen.

- [ ] **Step 2: Umstellen** laut Tabelle; Brücke kürzen (die fünf dynamischen Namen fallen jetzt auch weg).

- [ ] **Step 3: Tour** — neuer Test am Ende von `e2e/tour.spec.js`:

```js
test('the raider votes in the open poll', async ({ page }) => {
    const errors = watchErrors(page);
    await loginAs(page, 'raider');
    await navigate(page, 'polls');
    await page.locator('#polls-open .poll-card').first().click();
    await expect(page.locator('#poll-detail-section')).toBeVisible();
    const yes = page.locator('#poll-detail [data-click="setPollVote"][data-state="yes"]').first();
    await yes.click();
    await expect(page.locator('#poll-detail [data-click="setPollVote"][data-state="yes"]').first()).toHaveAttribute('aria-pressed', 'true');
    expect(errors).toEqual([]);
});
```
Desktop und Handy laufen gegen dieselbe Datenbank. Die Stimme „yes“ ist idempotent, deshalb ist die Reihenfolge egal.

- [ ] **Step 4: Tests, Tour (`14 passed`), Wiki, Commit**

```bash
git add public/js public/index.html test e2e docs/wiki
git commit -F - <<'EOF'
Use data-click actions for date polls

Votes, the poll editor and the admin bar no longer use inline handlers.
The admin bar built handler names at runtime; it now writes every
action name literally so a test can check that each one is registered.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014NiN2kW8WCg1k6JwibnFqs
EOF
```

---

### Task 8: Admin-Dashboard, Event-Aktionen, Anmeldungen

**Files:**
- Modify: `public/js/admin/{dashboard,event-actions,registrations}.js`, `public/index.html` (Admin-Kopfleiste, Dropdown, Audit-Log, Reset- und Ankündigungs-Dialog)
- Modify: `test/actionAttributes.test.js`, `e2e/tour.spec.js`

**Interfaces:**
- Produces: Aktionen `editEvent`, `showRegistrations`, `deleteEventSeries`, `exportRegistrations`, `announceEvent`, `duplicateEvent`, `syncDiscordEvent`, `changeEventStatus`, `startEvent`, `endEvent`, `deleteEvent` (alle mit `data-event-id`, Serie mit `data-series-id`, Status mit `data-status`, Titel mit `data-event-title`), `updateRegStatus`, `moveRegistrationSlot`, `showImportDiscordEventsModal`, `showCreateEventModal`, `showBotMessagesModal`, `loadAuditLog`, `showMaintenanceModal`, `showResetModal`, `activatePanicMode`, `performSystemReset`, `sendAnnouncement`

| Stelle | vorher | nachher |
|---|---|---|
| Serien-Termin bearbeiten | `onclick="editEvent('${se.id}')"` | `data-click="editEvent" data-event-id="${escapeHtml(se.id)}"` |
| Serien-Termin Anmeldungen | `onclick="showRegistrations('${se.id}', ${inlineArg(se.title)})"` | `data-click="showRegistrations" data-event-id="${escapeHtml(se.id)}" data-event-title="${escapeHtml(se.title)}"` |
| Serie löschen | `onclick="deleteEventSeries('${event._seriesId}')"` | `data-click="deleteEventSeries" data-series-id="${escapeHtml(event._seriesId)}"` |
| Karte Anmeldungen | `onclick="showRegistrations('${event.id}', ${inlineArg(event.title)})"` | `data-click="showRegistrations" data-event-id="${escapeHtml(event.id)}" data-event-title="${escapeHtml(event.title)}"` |
| Export / Ankündigen / Duplizieren / Bearbeiten / Sync / Start / Ende / Löschen | `onclick="<fn>('${event.id}')"` | `data-click="<fn>" data-event-id="${escapeHtml(event.id)}"` |
| Status (3× Link) | `onclick="changeEventStatus('${event.id}', 'active'); return false;"` | `data-click="changeEventStatus" data-event-id="${escapeHtml(event.id)}" data-status="active"` (ebenso `draft`, `archived`) |
| Annehmen / Ablehnen | `onclick="updateRegStatus('${reg.id}', 'accepted', '${eventId}', ${inlineArg(eventTitle)})"` | `data-click="updateRegStatus" data-reg-id="${escapeHtml(reg.id)}" data-status="accepted" data-event-id="${escapeHtml(eventId)}" data-event-title="${escapeHtml(eventTitle)}"` (ebenso `rejected`) |
| Slot verschieben | `onchange="moveRegistrationSlot(this)"` | `data-change="moveRegistrationSlot"` |
| `index.html` Import / Neu / Bot-Nachrichten / Audit-Log | `onclick="<fn>()"` | `data-click="<fn>"` |
| `index.html` Dropdown Wartung / Reset / Panik | `onclick="<fn>(); return false;"` | `data-click="<fn>"` |
| `index.html` Audit-Log schließen | `onclick="document.getElementById('audit-log-container').style.display='none'"` | `data-click="hide" data-target="audit-log-container"` |
| `index.html` Reset ausführen | `onclick="performSystemReset()"` | `data-click="performSystemReset"` |
| `index.html` Ankündigung senden | `onclick="sendAnnouncement()"` | `data-click="sendAnnouncement"` |

Registrierungen:
```js
// admin/dashboard.js
registerActions({
    loadAuditLog: () => loadAuditLog(),
    showResetModal: () => showResetModal(),
    performSystemReset: () => performSystemReset()
});

// admin/event-actions.js
registerActions({
    deleteEvent: (el) => deleteEvent(el.dataset.eventId),
    deleteEventSeries: (el) => deleteEventSeries(el.dataset.seriesId),
    changeEventStatus: (el) => changeEventStatus(el.dataset.eventId, el.dataset.status),
    announceEvent: (el) => announceEvent(el.dataset.eventId),
    sendAnnouncement: () => sendAnnouncement(),
    startEvent: (el) => startEvent(el.dataset.eventId),
    endEvent: (el) => endEvent(el.dataset.eventId),
    exportRegistrations: (el) => exportRegistrations(el.dataset.eventId),
    duplicateEvent: (el) => duplicateEvent(el.dataset.eventId),
    syncDiscordEvent: (el) => syncDiscordEvent(el.dataset.eventId)
});

// admin/registrations.js
registerActions({
    showRegistrations: (el) => showRegistrations(el.dataset.eventId, el.dataset.eventTitle),
    updateRegStatus: (el) => updateRegStatus(el.dataset.regId, el.dataset.status, el.dataset.eventId, el.dataset.eventTitle),
    moveRegistrationSlot: (el) => moveRegistrationSlot(el)
});
```
`editEvent` und `showCreateEventModal` registriert Task 9 in `admin/wizard.js`, `showImportDiscordEventsModal` Task 10 in `admin/discord-import.js`, `showBotMessagesModal` Task 10 in `admin/bot-messages.js`, `showMaintenanceModal` und `activatePanicMode` Task 10 in `admin/maintenance.js`. Diese Buttons sind nach Task 8 schon umgestellt. Bis Task 9/10 würden sie deshalb `Unknown action` melden. Damit jeder Commit grün und benutzbar ist, registriert Task 8 diese sechs Aktionen gleich mit, jeweils im eigenen Modul der Funktion:
```js
// admin/wizard.js
registerActions({ editEvent: (el) => editEvent(el.dataset.eventId), showCreateEventModal: () => showCreateEventModal() });
// admin/discord-import.js
registerActions({ showImportDiscordEventsModal: () => showImportDiscordEventsModal() });
// admin/bot-messages.js
registerActions({ showBotMessagesModal: () => showBotMessagesModal() });
// admin/maintenance.js
registerActions({ showMaintenanceModal: () => showMaintenanceModal(), activatePanicMode: () => activatePanicMode() });
```
Task 9/10 ergänzt diese Blöcke dann, statt neue anzulegen. Ein Modul hat am Ende genau einen `registerActions`-Block.

- [ ] **Step 1: Failing tests** — die Tests `admin event cards open the registrations with the exact title` und `accepting and rejecting a registration keeps the exact event title` ersetzen:

```js
test('admin cards name every action with the event it belongs to', async () => {
    const { app, state, element, requests } = await loadFrontendApp({
        '/api/admin/all-events': [
            adminEvent('single'),
            adminEvent('s1', { seriesId: 'series', startDate: '2026-10-21T18:00:00.000Z' }),
            adminEvent('s2', { seriesId: 'series', startDate: '2026-10-28T18:00:00.000Z' })
        ],
        '/api/admin/events/single/registrations': { data: [], slots: [] }
    });
    state.currentUser = { ...MEMBER, isAdmin: true };
    await app.loadAdminEvents();
    const html = element('admin-events-grid').innerHTML;
    assertNoInlineHandlers(html);
    for (const target of elementsWith(html, 'data-click')) {
        const { attributes } = target;
        assert.ok(['single', 's1', 's2'].includes(attributes['data-event-id']) || attributes['data-series-id'] === 'series',
            `${attributes['data-click']} without its event`);
    }
    const open = actionTargets(html, 'showRegistrations').find(t => t.attributes['data-event-id'] === 'single');
    await app.runAction('showRegistrations', actionElement(open));
    assert.equal(element('reg-event-title').textContent, TRICKY_TEXT);
    assert.ok(requests.some(r => r.url === '/api/admin/events/single/registrations'));
});

test('accepting a registration sends the status and reloads with the exact title', async () => {
    const reg = { id: 'r1', userId: 'u-x', userName: 'Mia', status: 'pending', source: 'web', createdAt: '2026-10-01T18:00:00.000Z' };
    const { app, state, element, requests } = await loadFrontendApp({
        '/api/admin/events/ev/registrations': { data: [reg], slots: [] },
        '/api/admin/registrations/r1/status': { success: true }
    });
    state.currentUser = { ...MEMBER, isAdmin: true };
    await app.showRegistrations('ev', TRICKY_TEXT);
    const html = element('registrations-tbody').innerHTML;
    assertNoInlineHandlers(html);
    const accept = actionTargets(html, 'updateRegStatus').find(t => t.attributes['data-status'] === 'accepted');
    assert.equal(accept.attributes['data-event-title'], TRICKY_TEXT);
    element('reg-event-title').textContent = '';
    await app.runAction('updateRegStatus', actionElement(accept));
    const put = requests.find(r => r.method === 'PUT');
    assert.deepEqual([put.url, JSON.parse(put.body)], ['/api/admin/registrations/r1/status', { status: 'accepted' }]);
    assert.equal(element('reg-event-title').textContent, TRICKY_TEXT);
});
```
Run: rot.

- [ ] **Step 2: Umstellen** laut Tabelle; Registrierungen; Brücke kürzen.

- [ ] **Step 3: Tour** — im Admin-Zweig der Tour nach `await expect(page.locator('#admin-events-grid .admin-event-card').first()).toBeVisible();`:

```js
            // Audit log opens and closes through actions
            await page.locator('[data-click="loadAuditLog"]').click();
            await expect(page.locator('#audit-log-container')).toBeVisible();
            await page.locator('#audit-log-container [data-click="hide"]').click();
            await expect(page.locator('#audit-log-container')).toBeHidden();
```

- [ ] **Step 4: Tests, Tour, Wiki, Commit**

```bash
git add public/js public/index.html test e2e docs/wiki
git commit -F - <<'EOF'
Use data-click actions in the admin dashboard

Event cards, the status menu, the registrations dialog, the audit log
and the admin toolbar no longer use inline handlers. Event titles travel
as data attributes, so a title with an apostrophe no longer breaks the
registrations buttons.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014NiN2kW8WCg1k6JwibnFqs
EOF
```

---

### Task 9: Event-Assistent

**Files:**
- Modify: `public/js/admin/{wizard,wizard-builders}.js`, `public/index.html` (`#eventModal`)
- Modify: `test/actionAttributes.test.js` (alte Helfer löschen), `e2e/tour.spec.js`

**Interfaces:**
- Produces: Aktionen `wizardGoTo` (`data-step`, Zahl), `wizardNext`, `wizardBack`, `saveEvent`, `handleLocationInput` (`data-input`), `selectLocationChannel` (`data-channel-id`/`-name`/`-type`), `toggleSlotEditor` (`data-change`), `addSlotRow`, `applySlotPreset` (`data-preset`), `removeSlotRow`, `updateSlotTotals` (`data-input`), `addFormField`, `toggleOptionsInput` (`data-change`), `removeFormField`

| Stelle | vorher | nachher |
|---|---|---|
| `index.html` Schritt-Punkte 1–5 | `onclick="wizardGoTo(N)"` | `data-click="wizardGoTo" data-step="N"` |
| `index.html` Ort | `oninput="handleLocationInput()"` | `data-input="handleLocationInput"` |
| `index.html` Wiederholung | `onchange="document.getElementById('recurring-options').style.display=this.checked?'':'none'"` | `data-change="toggleVisible" data-target="recurring-options"` |
| `index.html` Slots an/aus | `onchange="toggleSlotEditor()"` | `data-change="toggleSlotEditor"` |
| `index.html` Slot hinzufügen | `onclick="addSlotRow()"` | `data-click="addSlotRow"` |
| `index.html` Vorlage MMO-Raid | `onclick="applySlotPreset('mmo-raid')"` | `data-click="applySlotPreset" data-preset="mmo-raid"` |
| `index.html` Feld hinzufügen | `onclick="addFormField()"` | `data-click="addFormField"` |
| `index.html` Kanal-Optionen | `onchange="document.getElementById('channel-config-options').style.display=…"` | `data-change="toggleVisible" data-target="channel-config-options"` |
| `index.html` eigene Nachricht | `onchange="document.getElementById('custom-msg-options').style.display=…"` | `data-change="toggleVisible" data-target="custom-msg-options"` |
| `index.html` Zurück / Weiter / Speichern | `onclick="wizardBack()"` usw. | `data-click="wizardBack"` / `"wizardNext"` / `"saveEvent"` |
| `wizard.js` Ort-Vorschlag | `onclick="selectLocationChannel(${inlineArg(c.id)}, ${inlineArg(c.name)}, ${inlineArg(c.type)})"` | `data-click="selectLocationChannel" data-channel-id="${escapeHtml(c.id)}" data-channel-name="${escapeHtml(c.name)}" data-channel-type="${escapeHtml(c.type)}"` |
| `wizard-builders.js` Feldtyp | `onchange="toggleOptionsInput(this)"` | `data-change="toggleOptionsInput"` |
| `wizard-builders.js` Feld entfernen | `onclick="this.parentElement.remove()"` | `data-click="removeFormField"` |
| `wizard-builders.js` Plätze | `oninput="updateSlotTotals()"` | `data-input="updateSlotTotals"` |
| `wizard-builders.js` Slot entfernen | `onclick="removeSlotRow(this)"` | `data-click="removeSlotRow"` |

Registrierungen (`admin/wizard.js`, den Block aus Task 8 erweitern):
```js
registerActions({
    editEvent: (el) => editEvent(el.dataset.eventId),
    showCreateEventModal: () => showCreateEventModal(),
    wizardGoTo: (el) => wizardGoTo(Number(el.dataset.step)),
    wizardNext: () => wizardNext(),
    wizardBack: () => wizardBack(),
    saveEvent: () => saveEvent(),
    handleLocationInput: () => handleLocationInput(),
    selectLocationChannel: (el) => selectLocationChannel(el.dataset.channelId, el.dataset.channelName, el.dataset.channelType)
});
```
`admin/wizard-builders.js`:
```js
registerActions({
    addFormField: () => addFormField(),
    toggleOptionsInput: (el) => toggleOptionsInput(el),
    removeFormField: (el) => el.parentElement.remove(),
    toggleSlotEditor: () => toggleSlotEditor(),
    addSlotRow: () => addSlotRow(),
    applySlotPreset: (el) => applySlotPreset(el.dataset.preset),
    removeSlotRow: (el) => removeSlotRow(el),
    updateSlotTotals: () => updateSlotTotals()
});
```
Nach diesem Task gibt es keinen Aufruf von `inlineArg` mehr. Die Funktion bleibt bis Task 12 in `core/ui.js` und wird dort gelöscht.

- [ ] **Step 1: Failing tests** — `location suggestions select the exact channel` ersetzen und einen Schritt-Test ergänzen:

```js
test('a location suggestion fills the exact channel', async () => {
    const channel = { id: '7', name: TRICKY_TEXT, type: 'voice' };
    const { app, element } = await loadFrontendApp({ '/api/admin/channels': [channel] });
    element('event-location-text').value = 'bob';
    await app.handleLocationInput();
    const html = element('location-suggestions').innerHTML;
    assertNoInlineHandlers(html);
    const [suggestion] = actionTargets(html, 'selectLocationChannel');
    await app.runAction('selectLocationChannel', actionElement(suggestion));
    assert.deepEqual(
        [element('event-location-text').value, element('event-location-channel-id').value, element('event-location-channel-type').value],
        [`#${TRICKY_TEXT}`, '7', 'voice']
    );
});

test('a wizard step dot jumps to its step as a number', async () => {
    const { app, element } = await loadFrontendApp({});
    const dot = actionTargets(INDEX_HTML, 'wizardGoTo').find(t => t.attributes['data-step'] === '3');
    await app.runAction('wizardGoTo', actionElement(dot));
    assert.equal(element('wizard-step-counter').textContent, 'Schritt 3 von 5');
    assert.equal(element('wstep-3').classList.contains('active'), true);
    assert.equal(element('wstep-2').classList.contains('completed'), true);
});
```
Danach `attributeValues`, `handlerCalling`, `runHandler` und `assertCallsOnly` aus der Datei löschen, falls sie niemand mehr nutzt (`grep -n "runHandler\|assertCallsOnly\|handlerCalling\|attributeValues" test/actionAttributes.test.js`). Ebenso `vm`, falls unbenutzt.

Run: rot.

- [ ] **Step 2: Umstellen** laut Tabelle; Registrierungen; Brücke kürzen.

- [ ] **Step 3: Tour** — im Admin-Zweig nach dem Audit-Log-Block:

```js
            // Event wizard: open, next, step dot, back, close
            await page.locator('[data-click="showCreateEventModal"]').first().click();
            await expect(page.locator('#eventModal')).toBeVisible();
            await page.locator('#event-title').fill('E2E-Rundgang');
            await page.locator('#wizard-btn-next').click();
            await expect(page.locator('#wizard-step-counter')).toHaveText('Schritt 2 von 5');
            await page.locator('#eventModal [data-click="wizardGoTo"][data-step="4"]').click();
            await expect(page.locator('#wizard-step-counter')).toHaveText('Schritt 4 von 5');
            await page.locator('#wizard-btn-back').click();
            await expect(page.locator('#wizard-step-counter')).toHaveText('Schritt 3 von 5');
            await page.locator('#eventModal [data-bs-dismiss="modal"]').first().click();
            await expect(page.locator('#eventModal')).toBeHidden();
```

- [ ] **Step 4: Tests, Tour, Wiki, Commit**

```bash
git add public/js public/index.html test e2e docs/wiki
git commit -F - <<'EOF'
Use data-click actions in the event wizard

Step navigation, location suggestions, the form builder and the slot
editor no longer use inline handlers. Step numbers are converted with
Number() so the step indicator still marks the active step.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014NiN2kW8WCg1k6JwibnFqs
EOF
```

---

### Task 10: Wartung, Bot-Zentrale, Bot-Nachrichten, Discord-Import, Neuigkeiten

**Files:**
- Modify: `public/js/admin/{maintenance,bot-control,bot-messages,discord-import}.js`, `public/js/core/updates.js`, `public/index.html`
- Modify: `test/actionAttributes.test.js`, `e2e/tour.spec.js`

| Stelle | vorher | nachher |
|---|---|---|
| `index.html` Bot-Einstellungen neu laden | `onclick="loadBotSettings()"` | `data-click="loadBotSettings"` |
| `index.html` Panik beenden | `onclick="deactivatePanicMode()"` | `data-click="deactivatePanicMode"` |
| `index.html` Wartung speichern | `onclick="saveMaintenanceSettings()"` | `data-click="saveMaintenanceSettings"` |
| `index.html` Bot-Nachrichten speichern | `onclick="saveBotMessages()"` | `data-click="saveBotMessages"` |
| `index.html` Neuigkeiten „Verstanden“ | `onclick="closeUpdatesModal()"` | `data-click="closeUpdatesModal"` |
| `discord-import.js` Listeneintrag (`<a href="#">`) | `onclick="selectDiscordEvent(this)"` | `data-click="selectDiscordEvent"`. Der Verteiler ruft jetzt `preventDefault()` auf. Vorher sprang der Link nach `#`, und der Router zeigte die Übersicht hinter dem Dialog. |
| `discord-import.js` Event-Daten am Eintrag | `data-event='${JSON.stringify(ev).replace(/'/g, "&apos;")}'` | `data-event="${escapeHtml(JSON.stringify(ev))}"`. Bisher wurde `&` nicht escapt, und ein Name mit `&quot;` kam verfälscht im Assistenten an. |
| `discord-import.js` Event-Bild | `<img src="${ev.image}"` | `<img src="${escapeHtml(ev.image)}"` |

Registrierungen (Blöcke aus Task 8 erweitern bzw. neu):
```js
// admin/maintenance.js
registerActions({
    showMaintenanceModal: () => showMaintenanceModal(),
    saveMaintenanceSettings: () => saveMaintenanceSettings(),
    activatePanicMode: () => activatePanicMode(),
    deactivatePanicMode: () => deactivatePanicMode()
});
// admin/bot-control.js
registerActions({ loadBotSettings: () => loadBotSettings() });
// admin/bot-messages.js
registerActions({ showBotMessagesModal: () => showBotMessagesModal(), saveBotMessages: () => saveBotMessages() });
// admin/discord-import.js
registerActions({ showImportDiscordEventsModal: () => showImportDiscordEventsModal(), selectDiscordEvent: (el) => selectDiscordEvent(el) });
// core/updates.js
registerActions({ closeUpdatesModal: () => closeUpdatesModal() });
```

- [ ] **Step 1: Failing test**

```js
test('Discord import entries keep the event as data for the wizard', async () => {
    const { app, state, element } = await loadFrontendApp({
        '/api/admin/import/discord-events': [{ id: 'd1', name: TRICKY_TEXT, description: 'x', scheduledStartTimestamp: Date.parse('2026-10-20T18:00:00.000Z'), image: null }]
    });
    state.currentUser = { ...MEMBER, isAdmin: true };
    await app.fetchDiscordEvents();
    const html = element('discord-events-list').innerHTML;
    assertNoInlineHandlers(html);
    const [entry] = actionTargets(html, 'selectDiscordEvent');
    assert.equal(JSON.parse(entry.attributes['data-event']).name, TRICKY_TEXT);
});
```
Run: rot.

- [ ] **Step 2: Umstellen** laut Tabelle; Brücke kürzen.

- [ ] **Step 3: Tour** — neuer Test:

```js
test('the news dialog closes through its action', async ({ page }) => {
    const errors = watchErrors(page);
    // Skip only the boot animation, so the news dialog shows
    await page.addInitScript(() => localStorage.setItem('dems_boot_ts', String(Date.now())));
    await page.goto('/auth/dev-login/member');
    const dialog = page.locator('#updatesModal');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-click="closeUpdatesModal"]').click();
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
});
```
Im Admin-Zweig der Tour nach `await navigate(page, 'bot-control');`:
```js
            await page.locator('[data-click="loadBotSettings"]').click();
```

- [ ] **Step 4: Tests, Tour (`16 passed`), Wiki, Commit**

```bash
git add public/js public/index.html test e2e docs/wiki
git commit -F - <<'EOF'
Use data-click actions in maintenance, bot control, import and news

The remaining admin dialogs and the news dialog no longer use inline
handlers. The Discord import entries are links; the dispatcher now
prevents their jump to "#", which used to switch the page behind the
dialog to the overview. Their event data is HTML-escaped now, so an
ampersand in a Discord event name reaches the wizard unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014NiN2kW8WCg1k6JwibnFqs
EOF
```

---

### Task 11: Profil, Info, Debug, Navbar

**Files:**
- Modify: `public/js/pages/{profile,debug}.js`, `public/js/core/auth.js`, `public/index.html` (Navbar, Profil, Debug, Willkommensdialog)
- Modify: `test/profileRegistrations.test.js`, `test/actionAttributes.test.js`

| Stelle | vorher | nachher |
|---|---|---|
| `index.html` Navbar-Avatar | `onerror="this.style.display='none'"` | `data-fallback="hide"` |
| `index.html` Logout | `onclick="logout()"` | `data-click="logout"` |
| `index.html` Konto-Einstellungen | `onchange="saveAccountSettings()"` | `data-change="saveAccountSettings"` |
| `index.html` Konto löschen | `onclick="deleteUserAccount()"` | `data-click="deleteUserAccount"` |
| `index.html` Verbose-Log | `onchange="toggleVerboseLog(this.checked)"` | `data-change="toggleVerboseLog"` |
| `index.html` Test-Toast | `onclick="showToast('🐛 Test-Toast vom Styling Guide!', 'info')"` | `data-click="showTestToast"` |
| `index.html` Willkommen Nein / Ja | `onclick="confirmInvitationPreference(false)"` / `(true)` | `data-click="confirmInvitationPreference" data-accept="false"` / `"true"` |
| `profile.js` Anmeldungs-Karte | `onclick="${canOpenEvent(reg.event) ? \`navigateTo('event/${reg.event.id}')\` : ''}"` | `${canOpenEvent(reg.event) ? \`data-click="navigateTo" data-route="event/${escapeHtml(reg.event.id)}"\` : ''}` |
| `debug.js` Animationen | `onclick="sgRunAnimation(${i})"` | `data-click="sgRunAnimation" data-index="${i}"` |

Registrierungen:
```js
// core/auth.js
registerActions({ logout: () => logout() });
// pages/profile.js
registerActions({
    saveAccountSettings: () => saveAccountSettings(),
    deleteUserAccount: () => deleteUserAccount(),
    toggleVerboseLog: (el) => toggleVerboseLog(el.checked),
    confirmInvitationPreference: (el) => confirmInvitationPreference(el.dataset.accept === 'true')
});
// pages/debug.js
registerActions({
    showTestToast: () => showToast('🐛 Test-Toast vom Styling Guide!', 'info'),
    sgRunAnimation: (el) => sgRunAnimation(Number(el.dataset.index))
});
```

- [ ] **Step 1: Failing tests**

`test/profileRegistrations.test.js`: Jedes `assert.match(card, /navigateTo\('event\/<id>'\)/)` wird zu `assert.match(card, /data-click="navigateTo" data-route="event\/<id>"/)`, zum Beispiel `/data-click="navigateTo" data-route="event\/game-night"/`. `assert.doesNotMatch(card, /navigateTo/)` bleibt.

`test/actionAttributes.test.js`:
```js
test('the welcome dialog sends false and true as booleans', async () => {
    const { app, requests } = await loadFrontendApp({ '/api/user/settings': { success: true } });
    for (const button of actionTargets(INDEX_HTML, 'confirmInvitationPreference')) {
        await app.runAction('confirmInvitationPreference', actionElement(button));
    }
    const bodies = requests.filter(r => r.method !== 'GET').map(r => r.body);
    assert.equal(bodies.length, 2);
    assert.ok(bodies[0] !== bodies[1], 'no and yes send different values');
    assert.ok(bodies.some(body => /false/.test(body)), `"false" must arrive as false: ${bodies.join(' | ')}`);
});
```
Vor dem Schreiben in `pages/profile.js` nachsehen, welche URL `confirmInvitationPreference` aufruft, und sie als Route eintragen. Steht dort eine andere URL als `/api/user/settings`, die tatsächliche nehmen.

Run: rot.

- [ ] **Step 2: Umstellen** laut Tabelle; Registrierungen; Brücke kürzen. Danach muss jede Brücke leer sein. Prüfen: `grep -rn "Object.assign(window" public/js` liefert höchstens noch Zeilen, deren Namensliste leer ist. Diese Zeilen und ihre Kommentare löschen.

- [ ] **Step 3: Tests, Tour, Wiki, Commit**

Run: `grep -rnE '\son(click|change|input|error)=' public/index.html public/js` → leer.

```bash
git add public/js public/index.html test docs/wiki
git commit -F - <<'EOF'
Use data-click actions in profile, debug page and navbar

These were the last inline handlers. Booleans and numbers from data
attributes are converted explicitly, so "Nein" in the welcome dialog
still declines invitations. Every window bridge is empty and removed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014NiN2kW8WCg1k6JwibnFqs
EOF
```

---

### Task 12: Strenge CSP, Wächter-Tests, Doku-Abschluss

**Files:**
- Modify: `server.js` (CSP), `public/js/core/ui.js` (`inlineArg` löschen), `test/frontendModules.test.js` (Brücken-Muster aus der Positivliste), `test/devServer.test.js` (CSP-Test)
- Create: `test/frontendCsp.test.js`
- Modify (Doku): `docs/wiki/concepts/security.md`, `docs/wiki/reference/decisions.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/reference/conventions.md`, `docs/wiki/ops/testing.md`, `CLAUDE.md`

- [ ] **Step 1: Failing guard tests** — `test/frontendCsp.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadFrontendApp, frontendSources, REPO_ROOT } = require('./helpers');
const { maskJsSource, codeIdentifiers } = require('./jsSource');

const INDEX_HTML = fs.readFileSync(path.join(REPO_ROOT, 'public', 'index.html'), 'utf8');
const INLINE_HANDLER = /\son[a-z]+\s*=\s*["']/i;
const ACTION_ATTRIBUTE = /data-(?:click|change|input)="([^"]*)"/g;

test('no inline event handler is left in index.html or the modules', () => {
    assert.doesNotMatch(INDEX_HTML, INLINE_HANDLER);
    for (const { file, source } of frontendSources()) assert.doesNotMatch(source, INLINE_HANDLER, file);
});

test('every action named in the markup is registered and named literally', async () => {
    const { app } = await loadFrontendApp({});
    const registered = new Set(app.actionNames());
    const used = [INDEX_HTML, ...frontendSources().map(entry => entry.source)]
        .flatMap(text => [...text.matchAll(ACTION_ATTRIBUTE)].map(match => match[1]));
    assert.ok(used.length > 80, `only ${used.length} actions found`);
    for (const name of used) {
        assert.doesNotMatch(name, /\$\{/, `action name built at runtime: ${name}`);
        assert.ok(registered.has(name), `action "${name}" is not registered`);
    }
});

test('no module puts functions on window', () => {
    for (const { file, source } of frontendSources()) assert.doesNotMatch(source, /Object\.assign\(window/, file);
});

test('a module that calls a function of another module imports it', () => {
    const sources = frontendSources();
    const owner = new Map();
    for (const { file, source } of sources) {
        for (const match of source.matchAll(/^export (?:async )?function ([\w$]+)/gm)) owner.set(match[1], file);
    }
    for (const { file, source } of sources) {
        const text = source.replace(/\r\n/g, '\n');
        const imported = new Set([...text.matchAll(/^import \{([^}]*)\} from/gm)]
            .flatMap(match => match[1].split(',').map(name => name.trim()).filter(Boolean)));
        const masked = maskJsSource(text);
        for (const ref of codeIdentifiers(masked)) {
            const from = owner.get(ref.name);
            if (!from || from === file || !/^\s*\(/.test(masked.slice(ref.index + ref.name.length))) continue;
            assert.ok(imported.has(ref.name), `${file} calls ${ref.name}() from ${from} without importing it`);
        }
    }
});
```

`test/devServer.test.js`, neuer Test (der Server aus `before` läuft schon):
```js
test('the CSP forbids inline scripts and inline event handlers', async () => {
    const res = await fetch(`${server.baseUrl}/`);
    const directives = res.headers.get('content-security-policy').split(';').map(part => part.trim());
    assert.ok(directives.includes("script-src 'self'"), directives.join('; '));
    assert.ok(directives.includes("script-src-attr 'none'"), directives.join('; '));
});
```

In `test/frontendModules.test.js` aus `ALLOWED_TOP_LEVEL` das Muster `/^Object\.assign\(window, /` streichen.

Run: `npm test 2>&1 | grep -E "^not ok"` → nur der CSP-Test ist rot. Melden die Wächter-Tests schon etwas, ist das ein echter Fund aus den Tasks 5–11. Dann zuerst diesen beheben.

- [ ] **Step 2: CSP** (`server.js`)

```js
            scriptSrc: ["'self'"],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
```
Den Kommentar über `scriptSrc` ergänzen: `// No inline scripts or handlers: actions run through data-click (public/js/core/actions.js); styles keep 'unsafe-inline' until D-02`.

- [ ] **Step 3: `inlineArg` löschen** aus `public/js/core/ui.js` (Funktion und JSDoc). `grep -rn "inlineArg" public test` muss leer sein.

- [ ] **Step 4: Tests**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"` → alles grün.
Run: `npm run test:e2e 2>&1 | tail -2` → `16 passed`. Mit der strengen CSP meldet Chromium jeden übersehenen Inline-Handler als Konsolenfehler, und `watchErrors` lässt die Tour scheitern.

- [ ] **Step 5: Doku**

- `docs/wiki/concepts/security.md`:
  - TL;DR: „(scripts, styles and fonts only from `'self'`, still allows `unsafe-inline`)“ wird zu „(scripts, styles and fonts only from `'self'`; no inline scripts or event handlers; styles still allow `unsafe-inline`)“.
  - Zeile XSS: der `inlineArg`-Teil wird zu „values for actions in `data-*` attributes (escaped with `escapeHtml`, read via `dataset`), never in handler code“.
  - Zeile H-05: Status wird zu „**done for scripts** (D-01): `script-src 'self'`, `script-src-attr 'none'`; actions via `data-click`/`data-change`/`data-input` (`core/actions.js`); `style-src` keeps `'unsafe-inline'` until D-02 removes the `style` attributes“.
  - `sources` um `public/js/core/actions.js` ergänzen.
- `docs/wiki/reference/decisions.md`: neue Zeile `| 2026-10-09 | frontend as native ES modules per area, event delegation (\`data-click\`/\`data-change\`/\`data-input\`, \`data-fallback\`) instead of inline handlers, CSP without \`'unsafe-inline'\` for scripts (D-01) | redesign tickets work in small modules; the CSP stops inline handlers from coming back | [spec](../../superpowers/specs/2026-10-09-frontend-modules-design.md), [plan](../../superpowers/plans/2026-10-09-frontend-modules.md) |`. Bei „Standing decisions“ ergänzen: „No inline event handlers or inline scripts: markup names actions (`data-click`), modules register them (`registerActions`).“
- `docs/wiki/modules/frontend-markup.md`: Abschnitt „## Actions“ mit Attributen (`data-click`, `data-change`, `data-input`, Parameter als `data-*`), `data-fallback` und den eingebauten Aktionen `toggleVisible`, `hide`, `scrollTo` mit `data-target`; Verweis auf [frontend-app](frontend-app.md).
- `docs/wiki/modules/frontend-app.md`: Die Regel zur Brücke und zu `inlineArg` wird ersetzt durch die Regel aus Task 4 plus: „Never write `onclick=` or other inline handlers — the CSP blocks them and `test/frontendCsp.test.js` fails.“ `inlineArg` aus der Module map streichen.
- `docs/wiki/reference/conventions.md`: Der Satz zur Brücke wird zu „Markup names actions (`data-click="name"`), the owning module registers them with `registerActions`.“
- `docs/wiki/ops/testing.md`: Zeilen für `test/frontendCsp.test.js` (keine Inline-Handler, Aktionen registriert, keine `window`-Brücke, Import-Wächter), `test/frontendModules.test.js` (Struktur), `test/frontendActions.test.js` und `test/jsSource.js` ergänzen; der CSP-Test steht in `devServer.test.js`.
- `CLAUDE.md`:
  - Frontend-Regel: Der Teil zu ES-Modulen und Brücke wird zu „ES modules under `public/js/` (one per area; shared values in `state` from `core/state.js`); actions via `data-click`/`data-change`/`data-input` + `registerActions` in the owning module (no inline handlers — the CSP blocks them);“. Der Teil „values inside inline handlers with `inlineArg` (never `'${escapeHtml(x)}'` in handler code)“ wird zu „values for actions in `data-*` attributes, escaped with `escapeHtml`“.
  - Sicherheitsregel: Nach „(the CSP allows scripts, styles and fonts only from `'self'`)“ ergänzen: „; no inline scripts or event handlers (`script-src-attr 'none'`)“.

Run: `npm run wiki && npm test 2>&1 | grep -E "^# (tests|pass|fail)"` → grün.

- [ ] **Step 6: Browser-Prüfung im Mock-Modus** (eigener Port und Scratch-Datenbank wie in Task 3, Step 11)

- Als `admin`:
  - Übersicht: Kalender, Kategorie, Serie aufklappen
  - Event-Seite: Kommentar antworten und senden, Gast suchen und hinzufügen
  - Admin: Karten-Menü Status, Anmeldungen annehmen, Assistent komplett durchklicken, Ort-Vorschlag, Formularfeld und Slot hinzufügen und entfernen
  - Wartung, Bot-Zentrale, Bot-Nachrichten, Discord-Import
  - Debug-Seite (`DEBUG_MODE`): Test-Toast und Animation
- Als `newbie`: Willkommensdialog „Nein“.
- Die Konsole darf keine Fehler und keine CSP-Verstöße zeigen. Danach den Server per PID beenden.

- [ ] **Step 7: Commit**

```bash
git add server.js public/js test docs/wiki CLAUDE.md
git commit -F - <<'EOF'
Forbid inline scripts and handlers in the CSP

With every inline handler replaced by data-click actions, script-src
drops 'unsafe-inline' and script-src-attr is 'none' (audit finding H-05
for scripts). Guard tests keep it that way: no inline handlers in
index.html or the modules, every action name registered and literal, no
window bridge, and every cross-module call imported. styles keep
'unsafe-inline' until D-02 removes the style attributes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_014NiN2kW8WCg1k6JwibnFqs
EOF
```

---

## Abschluss

- `git log --oneline origin/main..HEAD` zeigt 14 Commits (Spec/Plan, Scanner, Lader, Zerlegung, Aktionen, 7 Bereiche, CSP).
- `grep -rn "#[0-9]" <(git log --format=%B origin/main..HEAD)` zeigt keine Treffer außer gewollten Ticket-Verweisen.
- Danach wie gewohnt: Zusammenfassung auf Deutsch, Frage „Soll ich pushen und den MR anlegen?“. MR-Titel „D-01: Frontend in Module aufteilen (ohne Build-Schritt)“, Beschreibung Problem / Ursache / Änderung / Verifikation, `Closes #50`.
