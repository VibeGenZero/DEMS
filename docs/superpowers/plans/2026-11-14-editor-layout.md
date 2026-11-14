# Roomier Event Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The event editor gives the form room: narrow preview that gives way to the AI assistant, every field group as a card, at most two fields per row, a side gutter from 768 px.

**Architecture:** Markup and state hooks first (the assistant panel marks `.editor-body` with `is-assist-open`; step 3's three-in-a-row becomes two columns), then CSS only in the EVENT EDITOR PAGE block of `public/css/style.css`. The look follows the B + C screenshots on https://claude.ai/artifact/JgT5Hs96iSi5Y8sdcfDj1J (spike CSS: B = narrow, scaled preview, hidden while the assistant is open; C = groups as cards).

**Tech Stack:** vanilla ES modules, CSS with the tokens of `public/css/tokens.css`, `node:test` view harness, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-14-editor-layout-design.md`

## Global Constraints

- Tokens only for colours, spacing, radii, layers and shadows (`--space-4 … --space-64`, `--radius-lg`, `--bg-card`, `--border-subtle`; there is no `--space-20`); no `style=""`, no `<style>`; `npm test` (tokens, contrast) green.
- No change to fields, steps, validation, saving, preview content or the assistant's behaviour.
- Phones (< 768 px) must not get narrower: gutter and card padding stay small; slot names stay readable.
- Below 1200 px the assistant keeps floating bottom right and the preview stays behind its tab.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A card that holds a Bootstrap `.row` → no doubled space at its top (row gutters inside the card padding).
- The assistant opened, then the editor left and reopened → `is-assist-open` is gone, the preview is back.
- Hidden groups (`#role-requirement-area`, `#recurring-options`, `#slot-editor-area` when slots are off, `#custom-msg-options`) → no empty card outline while hidden.
- Invalid fields (`.is-invalid` + `.invalid-feedback.d-block`) inside a card → the red mark and sentence stay readable, nothing is clipped.
- 1200–1279 px (smallest wide layout) with the assistant open → form at least ~600 px wide, no horizontal scroll.

---

### Task 1: State hook and two-per-row markup

**Files:**
- Modify: `public/js/admin/editor-assist.js` (`setPanelOpen`, `unmountEditorAssist`)
- Modify: `public/index.html` (step 3 of the editor, the row with `col-md-4` around `#event-access`, `#event-approval`, guests: three `col-md-4` → `col-md-6`; only inside `#event-editor-section`)
- Test: `test/editorAssistView.test.js`, `test/eventEditorPage.test.js`

**Interfaces:**
- Produces: class `is-assist-open` on the `.editor-body` element while the assistant panel is open (Task 2 styles it). Give the `.editor-body` div the id `event-editor-body` so the module can reach it.

- [ ] **Step 1: Write the failing tests**

```js
// editorAssistView.test.js
test('the editor body knows when the assistant is open', async () => {
    const harness = await openEditor();
    const body = harness.element('event-editor-body');
    await harness.app.runAction('toggleEditorAssist', {});
    assert.ok(body.classList.contains('is-assist-open'));
    await harness.app.runAction('toggleEditorAssist', {});
    assert.ok(!body.classList.contains('is-assist-open'));
    await harness.app.runAction('toggleEditorAssist', {});
    harness.location.hash = '#admin';
    await harness.app.handleRoute();
    assert.ok(!body.classList.contains('is-assist-open'), 'leaving the editor closes it');
});
// eventEditorPage.test.js
test('the editor puts at most two fields in a row', () => {
    const editor = HTML.slice(HTML.indexOf('<section id="event-editor-section"'), HTML.indexOf('<section id="insights-section"'));
    assert.doesNotMatch(editor, /class="col-md-4"/);
    assert.match(editor, /<div class="editor-body" id="event-editor-body">/);
});
```

- [ ] **Step 2: Run** `npm test` — expected: the two new tests FAIL.
- [ ] **Step 3: Implement** — `id="event-editor-body"` on `.editor-body`; the three `col-md-4` → `col-md-6`; `setPanelOpen(open)` also toggles `is-assist-open` on `#event-editor-body`; `unmountEditorAssist()` removes it.
- [ ] **Step 4: Run** `npm test` — expected: PASS (all).
- [ ] **Step 5: Commit** — "Let the editor know when the assistant is open and keep two fields per row".

### Task 2: Layout and cards in the stylesheet

**Files:**
- Modify: `public/css/style.css` (EVENT EDITOR PAGE block: `.editor-page`, `.editor-page .wizard-head`, `.editor-body`, `.editor-form`, the ≥ 1200 px media block with `.editor-preview-column` / `.editor-assist`)
- Modify: `docs/wiki/modules/frontend-markup.md` (EVENT EDITOR PAGE block description, the editor row of the markup table), then `npm run wiki`
- Test: `e2e/wizard.spec.js`

**Interfaces:**
- Consumes: `#event-editor-body.is-assist-open` (Task 1).

Values (from the spike, in tokens):
- From 768 px: `.editor-page` max-width `85rem`, centered, `padding-inline: var(--space-24)`; the step bar (`.editor-page .wizard-head .wizard-nav` or the head itself) max-width `55rem`, centered.
- `.editor-form` loses its own background, border and padding; each `.editor-form .wizard-page > .mb-3`, `> .row`, the step-5 `.glass-card.is-tinted` groups and `.editor-footer` become cards: `background: var(--bg-card)`, `border: 1px solid var(--border-subtle)`, `border-radius: var(--radius-lg)`, padding `var(--space-16)` (phones) / `var(--space-24)` (≥ 768 px), `margin-bottom: var(--space-16)`. A card that is a `.row` keeps its column gutters inside and has no extra top space (`--bs-gutter-y: 0` with a row gap instead, or equivalent). Elements with `.is-hidden` / `display: none` show no card.
- `.form-text`, `small.text-muted` under fields: `margin-top: var(--space-8)`; `.form-label`: `margin-bottom: var(--space-8)`.
- ≥ 1200 px: `.editor-body` columns `minmax(0, 1fr) 22.5rem auto`; `#wizard-preview-card` and `#wizard-preview-discord` `zoom: 0.8`; `.editor-body.is-assist-open` → preview column `display: none`, columns `minmax(0, 1fr) 25rem`, `.editor-assist` width `25rem`.

- [ ] **Step 1: Write the failing browser test** (desktop project, editor of `dev-event-role`):

```js
test('the assistant takes the place of the preview and the form keeps most of the width', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'wide layout');
    await loginAs(page, 'admin');
    await page.evaluate(() => { window.location.hash = '#event-editor/dev-event-role'; });
    await expect(page.locator('#event-editor-section')).toBeVisible();
    const form = page.locator('.editor-form');
    await expect(page.locator('.editor-preview-column')).toBeVisible();
    expect((await form.boundingBox()).width).toBeGreaterThan(800);
    await page.click('#event-editor-assist-toggle');
    await expect(page.locator('.editor-preview-column')).toBeHidden();
    expect((await form.boundingBox()).width).toBeGreaterThan(800);
    await page.setViewportSize({ width: 1200, height: 800 });
    expect((await form.boundingBox()).width).toBeGreaterThan(600);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.click('#event-editor-assist-toggle');
    await expect(page.locator('.editor-preview-column')).toBeVisible();
});
```

Extend the phone test („on a phone the editor has one column …") with: on step 3 the slot name input of the first row is at least 120 px wide.

- [ ] **Step 2: Run** `npm run test:e2e -- wizard` — expected: the new test FAILS (preview stays visible / form narrower than 800 px).
- [ ] **Step 3: Implement** the values above in the EVENT EDITOR PAGE block (no rule outside it); update `frontend-markup.md`; `npm run wiki`.
- [ ] **Step 4: Run** `npm test` and `npm run test:e2e` — expected: PASS (only the known `profile.spec.js:98` fails, as before). Take screenshots of steps 1–5 at 1440 px, step 1 with the assistant open, step 3 at 1280 px and 390 px, and compare them with the B + C shots on the artifact; check the Review Focus items by eye (card tops, hidden groups, an invalid field: save step 1 with an empty title).
- [ ] **Step 5: Commit** — "Give the event editor room: narrow preview, sections as cards".
