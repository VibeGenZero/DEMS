---
id: conventions
title: Coding conventions
type: reference
tags: [conventions, style, language, git, commits, testing, jsdoc]
sources: [bot, utils/formFields.js, routes/events.js, public/js/core/ui.js, test/helpers.js]
see_also: [testing, data-layer, glossary]
---
# Coding conventions

> TL;DR: CommonJS Node ≥22, no build step, no TypeScript. German for everything users see, English for code, comments and docs. Data access only through `firebaseAdmin.js`; every route handler has its own `try/catch` and answers `{ error: '<German>' }`. Tests with `node:test`, written first. English imperative commit messages, German PR descriptions.

## Language

| Thing | Language | Example |
|---|---|---|
| UI texts, API error messages, Discord messages, toasts | German | `'Event nicht gefunden'` |
| identifiers, comments, JSDoc, commit messages, wiki | English | `promoteFromWaitlist` |
| `.env.example` comments, README, PR descriptions, specs | German | existing files |

## Code style

- CommonJS (`require`, `module.exports = { ... }` at the end of the file).
- Indentation: match the file — 4 spaces almost everywhere; `firebaseAdmin.js` and `db/sqliteAdapter.js` use 2.
- Names: `camelCase` functions/variables, `UPPER_SNAKE_CASE` constants (`MODAL_MAX_FIELDS`, `REGISTER_BUTTON_PREFIX`), `kebab-case` file ids in the wiki.
- JSDoc in newer code (`bot/registration.js`, `bot/registrationModal.js`, `utils/`, `dev/`): summary line, blank line, `@param {type} name -> meaning`, `@returns {type} -> meaning`, optional `@example`. Use the `->` style for new functions.
- Comments explain *why*; keep them short.
- Magic values become named constants next to related ones.

## Backend patterns

- Handler: `try { ... } catch (err) { console.error('<Context> error:', err); res.status(500).json({ error: '...' }); }`.
- Data: Firestore modular API from `firebaseAdmin.js`; dates as ISO strings; filter/sort in memory instead of composite indexes.
- Admin mutations: `addAuditLog(ACTION, adminId, details, targetId)`.
- Verbose traces: `debugLog(label, data)` (only active with `DEBUG_MODE=true`).
- Discord calls: through `bot.js` helpers (code in the area modules of `bot/`) that no-op without a ready bot; ephemeral replies via `flags: MessageFlags.Ephemeral`.
- Express 5: named wildcards, no writes to `req.query`.

## Frontend patterns

- Frontend code lives in ES modules under `public/js/` (one per area, see [frontend-app](../modules/frontend-app.md)); values several modules share are in `state` (`core/state.js`). Markup names actions (`data-click="name"`), the owning module registers them with `registerActions`; there are no inline handlers.
- Escape everything interpolated into HTML with `escapeHtml`; Markdown only via `renderMarkdownSafe`; card previews via `escapeHtml(markdownPreview(text))`.
- `fetch` with `X-CSRF-TOKEN: csrfToken` on mutating calls; feedback with `showToast(msg, 'success'|'danger'|'warning'|'info')`.
- Colours from CSS variables in `:root`.

## Tests

- `node:test` + `node:assert/strict`, files `test/<topic>.test.js`, helpers in `test/helpers.js` — see [testing](../ops/testing.md).
- TDD: failing test first, then code. No new test dependencies.

## Git and PRs

- Branches: `feature/<topic>`, `fix/<topic>`, `chore/<topic>` (plus tool-generated `claude/...`).
- Commits: English imperative subject ("Support doc(collectionRef, id) in the SQLite adapter"), body explains why, AI-assisted commits end with a `Co-Authored-By:` trailer.
- PRs: German title and description (Problem / Ursache / Änderung / Verifikation).
- Larger features: spec in `docs/superpowers/specs/`, plan in `docs/superpowers/plans/` ([decisions](decisions.md)).

## Wiki maintenance

When code changes behaviour documented here: update the node(s) listed in the file→node table of [index](../index.md), run `npm run wiki`, commit `docs/wiki/graph.json` with the change. `npm test` fails on stale graphs or broken links.
