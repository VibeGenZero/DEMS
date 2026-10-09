# CLAUDE.md — DEMS (Dein Event-Management-System)

DEMS lets a Discord community plan events: members log in with Discord, register on the website or directly in Discord (button + modal), admins manage events, registrations, announcements, bot settings and maintenance mode. One Node.js process runs an Express 5 REST API + static SPA and a discord.js bot; data lives in Firestore or a local SQLite file behind the same Firestore-style API.

## Start here: the wiki

The project knowledge graph is in **`docs/wiki/`**. Entry point: **`docs/wiki/index.md`** (node list, task → node table, file → node table). Machine-readable index with one-line summaries, tags, sources and edges: `docs/wiki/graph.json`. Read the 1–3 nodes your task needs instead of exploring the code.

| Task | Node |
|---|---|
| overview | `docs/wiki/overview/architecture.md`, `docs/wiki/overview/directory-map.md` |
| endpoints | `docs/wiki/reference/api-index.md`, `docs/wiki/howto/add-api-endpoint.md` |
| registrations, waitlist, guests | `docs/wiki/concepts/registration-flow.md` |
| data shapes | `docs/wiki/concepts/data-model.md`, `docs/wiki/modules/data-layer.md` |
| Discord bot | `docs/wiki/modules/bot.md`, `docs/wiki/concepts/discord-integration.md` |
| frontend | `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md` |
| run, debug, test | `docs/wiki/howto/run-and-debug.md`, `docs/wiki/ops/testing.md` |
| config, Docker, deploy | `docs/wiki/ops/configuration.md`, `docs/wiki/ops/docker.md`, `docs/wiki/ops/deployment.md` |
| CI pipeline, GitLab runner | `docs/wiki/ops/ci.md` |
| known bugs and traps | `docs/wiki/reference/known-issues.md`, `docs/wiki/concepts/security.md` |
| German term in a ticket | `docs/wiki/reference/glossary.md` |

## Commands

```bash
npm install
npm run dev:mock     # no Discord/Firebase needed: personas + dummy data on http://localhost:3000
npm run dev:reset    # reset the dev mock database
npm run dev          # real Discord (needs .env), nodemon
npm start            # production-like
npm test             # all node:test suites (incl. wiki validation)
npm run test:e2e     # browser smoke tests (Playwright; once: npx playwright install chromium)
npm run wiki         # regenerate docs/wiki/graph.json after editing wiki pages
docker compose -f compose.dev.yaml up --build   # mock mode in Docker
```

Node ≥ 22. No build step, no TypeScript, no linter config.

## Save tokens

- **Never read these files whole:** `public/css/style.css` (~3270), `bot.js` (~2200), `public/index.html` (~1760), `routes/admin.js` (~1180). The wiki nodes list their functions/sections — `grep -n "function <name>" <file>` and read ~80 lines from there.
- The frontend is ES modules under `public/js/` (one per area, ≤ ~500 lines); open only the module from the map in `docs/wiki/modules/frontend-app.md`.
- Ignore `node_modules/`, `public/vendor/`, `landing/`, `package-lock.json`, `data/`.
- `docs/wiki/graph.json` has one node per line: `grep '"waitlist"' docs/wiki/graph.json` (or a file name like `"bot.js"`) returns complete nodes with summary, sources and neighbours — cheaper than opening pages or reading the whole file.

## Rules

- **Data access only through `firebaseAdmin.js`** (Firestore modular API: `collection`, `doc`, `getDoc`, `getDocs`, `addDoc`, `setDoc`, `updateDoc`, `deleteDoc`, `query`, `where`, `orderBy`, `writeBatch`). Never import `better-sqlite3` or `firebase/firestore` directly. Dates are ISO strings. Filter/sort in memory instead of composite indexes; no `limit`.
- **Language:** everything users see (UI, API `{ error }` messages, Discord messages) in German; code, comments, commits and the wiki in English.
- **Routes:** each handler has its own `try/catch` and answers `res.status(x).json({ error: '<German>' })`. Admin routes live in `routes/admin.js` (already guarded). Static paths go above `/:id`. Admin mutations call `addAuditLog(...)`.
- **Express 5:** named wildcards (`/{*splat}`), `req.body` defaults to `{}` via a shim, never assign to `req.query`.
- **CSRF:** mutating `/api/*` and `/auth/*` requests (e.g. `POST /auth/logout`) need header `X-CSRF-TOKEN` (frontend `state.csrfToken` from `public/js/core/state.js`). Logins go through `startUserSession` (new session + CSRF token).
- **Frontend:** ES modules under `public/js/` (one per area; shared values in `state` from `core/state.js`); actions via `data-click`/`data-change`/`data-input` + `registerActions` in the owning module (no inline handlers — the CSP blocks them); escape interpolated values with `escapeHtml`, values for actions in `data-*` attributes, escaped with `escapeHtml`, Markdown only via `renderMarkdownSafe` (previews: `escapeHtml(markdownPreview(text))`); `showToast(msg, 'success'|'danger'|'warning'|'info')`.
- **Discord:** new Discord calls go into exported `bot.js` helpers guarded by `if (!isReady) return <neutral>` + `try/catch`, and get a logging twin in `dev/mockBot.js`. Use `flags: MessageFlags.Ephemeral` and `Events.ClientReady`. Links to an event only via `buildEventUrl(id)` from `utils/eventUrl.js`.
- **Security:** never return `checkinCode` or other secrets in event responses; choose `requireAuth`/`requireAdmin` explicitly; no CDNs: libraries and fonts go as pinned files into `public/vendor/` (the CSP allows scripts, styles and fonts only from `'self'`; no inline scripts or event handlers (`script-src-attr 'none'`)).
- **Config:** document new env variables in `.env.example` (German comments) and `docs/wiki/ops/configuration.md`.
- **Dev mock mode** (`DEV_MOCK=true`) must stay impossible with `NODE_ENV=production`.
- **Tests:** `node:test` + `node:assert/strict`, test first (TDD), helpers in `test/helpers.js`; server behaviour via `test/devServer.test.js` with personas (`admin`, `raider`, `member`, `newbie`).
- **No new dependencies** without a clear reason.

## Keep the wiki true

When you change behaviour that a wiki node describes, update that node in the same commit (file → node table in `docs/wiki/index.md`), then run `npm run wiki`. `npm test` fails on broken edges, missing source paths, broken links or a stale `graph.json`. When you fix an entry of `docs/wiki/reference/known-issues.md`, remove it there.

## Git

- Branches `feature/…`, `fix/…`, `chore/…`. Commit messages: English imperative subject + why in the body. PR titles/descriptions in German (Problem / Ursache / Änderung / Verifikation).
- Larger features: spec in `docs/superpowers/specs/`, plan in `docs/superpowers/plans/`.

## Top traps (details: `docs/wiki/reference/known-issues.md`)

1. Opening the app via plain `http://<ip>` (not localhost) hangs on the loading screen — helmet CSP `upgrade-insecure-requests`; serve via HTTPS.
2. Sessions are stored in the database (collection `sessions`, `utils/sessionStore.js`) and survive restarts; `roles`/`isAdmin` are re-read from Discord at most every 5 minutes (`createRoleRefresh`).
3. Event field changes must be whitelisted in BOTH `POST /events` and `PUT /events/:id` in `routes/admin.js`.
4. Form answers are keyed by field label.
5. Compose: `.env` reaches the container only via `env_file:`.
