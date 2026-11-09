# Design

## Context

- All configuration is read from `process.env`. Most readers read it at call time (`routes/auth.js`, `bot/*`, `middleware/auth.js`, `utils/eventUrl.js`), but a few read it once at module load: `SESSION_SECRET` (session middleware in `server.js`), `BASE_URL` (CORS origin in `server.js`), and `TIMEZONE` (module constants in `bot/constants.js`, `utils/localDateTime.js`, `utils/eventSeries.js`, `utils/eventChangeNotice.js`, `utils/pollService.js`, `routes/admin.js`).
- `server.js#start()` already awaits `store.ready()` and `runMigrations()` before `app.listen()`, so the database is readable before the first request.
- `compose.yaml` already creates PostgreSQL and its password; only `.env` (`env_file: .env`, required) stands between `docker compose up` and a running stack.
- The bot client (`bot/client.js`) is built once with its intents (Message Content only with `DISCORD_THREAD_SYNC=true`); `bot/lifecycle.js` uses `client.once(Events.ClientReady)` and a one-shot `botStartSettled` promise, so today the bot can log in only once per process.
- In production cookies are `Secure` (`NODE_ENV=production`), so the setup, like the login, only works over HTTPS — in the production image `http://localhost` included (checked with Docker: the unlock answers 403 without the cookie).
- Bot-center settings (`utils/botSettings.js`) already show the pattern "singleton document + in-memory cache, exact because DEMS is one process"; this design reuses it.

## Goals / Non-Goals

**Goals:**
- Keep `process.env` as the single place code reads configuration from, so existing readers need no change beyond the load-time ones.
- Existing installations keep working without any action.
- Setup and later changes take effect without a restart wherever the code allows it.

**Non-Goals:**
- Encrypting stored secrets (see Risks).
- Moving database, port, `NODE_ENV`, `UPLOAD_DIR`, `DEBUG_MODE` or `DEV_*` into the database — they are needed before the database is reachable or are developer switches.
- Gating Discord interactions (registration button/modal, slash commands) on privacy consent; this change gates the website only.
- Changing the existing "Warum rufen wir diese Daten ab?" dialog on the login page; it stays next to the new link.
- A "factory reset" of the setup from the UI.

## Decisions

### 1. Configuration overlay into `process.env` (`utils/systemConfig.js`)

One singleton document `systemSettings/config`:

```
{ values: { DISCORD_CLIENT_ID: '…', …, SESSION_SECRET: '…' },
  setupCompletedAt: ISO | null, setupSource: 'wizard' | 'env' | null, updatedAt, updatedBy }
```

`MANAGED_KEYS` lists the keys from the spec, each with `{ secret: bool, applies: 'live' | 'bot' | 'restart', group: 'discord' | 'server' | 'security' }`. `SESSION_SECRET` is managed but internal (never listed, never editable).

`loadSystemConfig()` runs in `start()` right after the migrations:
1. Snapshot `envKeys` = managed keys with a non-empty `process.env` value (these are locked).
2. For every other key with a stored value, set `process.env[key]`.
3. Generate and store `SESSION_SECRET` if neither env nor database has one.
4. If `setupCompletedAt` is empty and the env already holds the three required Discord values, store `setupCompletedAt` with `setupSource: 'env'` (existing installations).

`saveSystemValues(changes, { by })` validates keys (managed, not locked), writes the document, then updates `process.env` (empty value → `delete process.env[key]`) and returns which `applies` classes were touched.

*Alternative considered:* a `getConfig(key)` function used everywhere. Rejected: ~60 call sites across routes, bot and utils, plus tests that set `process.env` directly. The overlay keeps all of them as they are.

*Alternative considered:* writing a `.env` file from the wizard. Rejected: the container file system is not persistent outside the volume, the file is outside the database backup, and Compose reads `env_file` only on container creation.

### 2. Load-time readers become call-time readers

- Session middleware: `server.js` builds the `express-session` middleware inside `start()` after `loadSystemConfig()`, and registers a thin wrapper at the same position in the middleware chain that delegates to it. No request reaches it before `listen()`.
- CORS: `origin` becomes a function that reads `process.env.BASE_URL` per request.
- `TIMEZONE`: a `getTimezone()` export in `utils/localDateTime.js` replaces the module constants in the six files. Its default stays `Europe/Berlin`.
- `SESSION_SECRET` check: missing → generated (step 3 above) instead of exit; placeholder → exit 1 as today. The check moves into `start()`.

With this, every managed key except `DISCORD_THREAD_SYNC` (client intents) takes effect live or via a bot re-login.

### 3. Restartable bot login (`bot/lifecycle.js`)

New helper `restartBot(token)` exported through `bot.js`: destroy the client if it is logged in, log in with the new token, and resolve `{ ok, error, guildName }` once `ClientReady` fired (or on error / 30 s timeout). `error` is a code: `invalid_token` (Discord rejects the token), `disallowed_intents` ("Used disallowed intents": Server Members Intent, or Message Content Intent with thread sync, is off in the Developer Portal), `timeout`, `unknown`. The setup and system routes map each code to a German message that names the guide step. The ready listener becomes `client.on` so a second login runs slash-command registration and `applyBotSettings()` again; `botStartSettled` stays one-shot for the schedulers. Guarded with `try/catch`; twin in `dev/mockBot.js` that logs and resolves `{ ok: true, guildName: <mock guild> }`.

Applied when `DISCORD_BOT_TOKEN` or `DISCORD_GUILD_ID` change (wizard Discord step, system settings). `DISCORD_THREAD_SYNC` changes report `restartRequired: true`, because the intents are fixed at client construction.

The wizard step needs roles and channels of the guild: it reuses the existing `getGuildRoles(guildId)` / `getGuildChannels(guildId)` from `bot/guild.js` after the re-login. The client id/secret check is a plain OAuth request (`POST https://discord.com/api/v10/oauth2/token`, `grant_type=client_credentials`), not a bot call; it lives in `routes/setup.js` next to the other Discord REST calls style of `routes/auth.js` (shared `discordFetch` moved to `utils/discordFetch.js`).

### 4. Setup mode and PIN (`utils/setupState.js`, `routes/setup.js`)

- `isSetupRequired()` = not mock mode and `setupCompletedAt` empty and a required Discord key missing in `process.env`. Computed after `loadSystemConfig()`, cached in memory, cleared by `completeSetup()`.
- PIN: `process.env.SETUP_PIN` or `crypto.randomInt(0, 1e8)` padded to 8 digits, kept in memory only. Printed at start: `🔑 Setup-PIN: 12345678 — öffne <BASE_URL or http://localhost:PORT> und gib sie ein.`. Not stored, so a restart prints a fresh one and an old log line stops working.
- `setupGate` middleware in `server.js` before the routers: in setup mode it answers 503 for the paths the spec lists; otherwise it is a no-op.
- `POST /api/setup/unlock` has its own `express-rate-limit` (5 per 15 min per IP) and compares with `safeEqual`. Success sets `req.session.setupUnlocked = true` (session regenerated first, like a login, so a pre-set cookie is useless). All other setup endpoints check that flag and `isSetupRequired()`; after completion they answer 409 `Die Einrichtung ist bereits abgeschlossen.`.
- Endpoints (all JSON, German errors, CSRF on POST):
  - `GET /api/setup/status` → `{ required, unlocked, locked: [keys from env], defaults: { BASE_URL (env, else derived from request host and protocol), TIMEZONE } }`
  - `POST /api/setup/unlock` `{ pin }`
  - `GET /api/setup/invite-url?clientId=` → `{ url }` from `buildBotInviteUrl` (`utils/botPermissions.js`), 400 when the id is not 17–20 digits; unlocked sessions only. The permission list stays in one place instead of being copied into the frontend. The admin "System" view uses the same helper through `GET /api/admin/system/invite-url`.
  - `POST /api/setup/discord` `{ clientId, clientSecret, botToken, guildId }` → check credentials, store, `restartBot`, check guild membership → `{ guildName, roles, channels, categories }` or 400 with `inviteUrl` (from `buildBotInviteUrl`)
  - `POST /api/setup/complete` `{ baseUrl, serverName, timezone, adminRoleId, announceChannelId, eventCategoryId, threadSync, adminResetPassword, privacyMarkdown? }` → validate (`baseUrl` absolute http(s), `timezone` accepted by `Intl.DateTimeFormat`, ids empty or Discord snowflakes, reset password ≥ 12 chars), store, optional policy (decision 6), `setupCompletedAt`, end setup mode, destroy the setup session.
- Locked keys are ignored on save and shown read-only by the wizard.

*Alternative considered:* storing a hashed PIN in the database so it survives restarts. Rejected: the log of the current start is always at hand (`docker compose logs dems`), and a per-start PIN limits how long a leaked log line is useful.

### 5. System settings in the admin area

- `GET /api/admin/system/settings` → `[{ key, group, value | null, isSet, source: 'env'|'db'|'none', locked, applies }]`; `value` is `null` for secrets.
- `PUT /api/admin/system/settings` `{ password, values: { KEY: value } }` → `safeEqual(password, process.env.ADMIN_RESET_PASSWORD)` (401 otherwise), reject unknown/locked keys (400), skip empty secret fields, `saveSystemValues`, `restartBot` when bot keys changed, `addAuditLog('UPDATE_SYSTEM_SETTINGS', { keys })` → `{ success, restartRequired }`.
- Changing `ADMIN_RESET_PASSWORD` itself needs the old one in `password`.
- Both routes live in `routes/admin.js` (already guarded by `requireAdmin`), static paths above any `/:id`.
- Frontend: `public/js/admin/system.js`, a new tab "System" in the admin section (component tabs, cards, chips "aus .env"/"gesetzt"), reset-password dialog before saving, toast on success; the privacy editor (EasyMDE, already vendored) is a card in the same view.

*Why the reset password:* a Discord admin role is broad in many communities; changing the bot token, guild or admin role can take over or lock out the installation, so it needs the same second factor as the system reset.

### 6. Privacy policy and consent (`utils/privacyPolicy.js`)

- Document `privacyPolicy/current`: `{ markdown, version, updatedAt, updatedBy }`; in-memory cache of `{ version }` (one process). `savePrivacyPolicy(markdown, by)` bumps the version only when the trimmed text differs; empty text deletes the document.
- `PUT /api/admin/privacy` `{ markdown }` → audit `UPDATE_PRIVACY_POLICY` `{ version }`. `GET /api/privacy` public (no `requireAuth`), returns `{ markdown, version, updatedAt }` or 404.
- Users: `privacyAcceptedVersion` (int), `privacyAcceptedAt` (ISO) on `users/<id>`; written only by `POST /api/user/privacy/accept` `{ version }` (409 when not current) through `utils/userProfile.js`.
- Session: the OAuth callback (and `dev/devAuth.js`) reads the accepted version from the user document into `req.session.user.privacyAcceptedVersion`. Sessions from before this change have no field; the gate loads it once from the user document and stores it in the session.
- `privacyGate` middleware in `server.js` after `createRoleRefresh`: for a logged-in session, when a policy exists and the session's accepted version is lower, every `/api/*` request answers 403 `{ error: 'Bitte akzeptiere zuerst die Datenschutzerklärung.', privacyRequired: true }`, except `/api/privacy`, `/api/user/privacy/accept`, `/api/csrf-token`, `/api/server-info`, `/api/maintenance/status`, `/api/updates`. `/auth/*` (incl. `/auth/me`, `/auth/logout`) is untouched; `/auth/me` adds `privacyRequired`.
- Frontend: `public/js/pages/privacy.js` renders `#privacy` (public route, `renderMarkdownSafe`) and the consent dialog (Bootstrap modal, not closable by backdrop/Escape) shown by `checkAuth()` when `privacyRequired`; "Akzeptieren" → accept endpoint → continue the normal boot; "Ablehnen" → `logout()`. `core/api` responses with `privacyRequired` re-open the dialog (covers a new version during a session). The login page gets a "Datenschutz" link (`#login-privacy-link`, `.is-hidden` until `/api/privacy` answered 200); the info view gets the same link.

### 7. Setup wizard frontend (`public/js/pages/setup.js`)

`finishLoading()` calls `GET /api/setup/status` right after the CSRF token. When `required`, it shows `#setup-section` and skips `checkAuth()` / routing. Steps as cards with a step indicator: PIN → Discord app (with the Discord guide, see below) → Server (selects filled from the Discord step's roles/channels, free id input as fallback) → Sicherheit (reset password twice) → Datenschutz (optional, EasyMDE) → Fertig ("Mit Discord anmelden" → `/auth/discord`). All actions via `data-click` + `registerActions`, no inline styles, tokens only, Bootstrap Icons.

**Discord guide (`public/js/pages/discord-guide.js`).** One module owns the guide texts and renders them, so the wizard and the admin "System" view show the same guide. `renderDiscordGuide({ baseUrl, inviteUrl, done })` returns the HTML of five collapsible cards (Bootstrap collapse, `bi-1-circle` … `bi-5-circle`, `bi-check-circle-fill` when done): create the application → OAuth2 (client id, "Reset Secret", redirect URL with a copy button) → bot (token, Server Members Intent on, Message Content Intent only for the comment sync, "Public Bot" off) → invite (button with `inviteUrl`, otherwise a hint to fill in the client id) → server id (developer mode, "Server-ID kopieren"). The redirect URL and invite link are escaped with `escapeHtml`; the Developer Portal link is a plain `https://discord.com/developers/applications` anchor with `rel="noopener"`. The done marks live in the module state of the open wizard only (no storage). Each input field of the Discord step carries a hint and a `data-click="openGuideStep"` link to its step. The wizard asks `/api/setup/invite-url` (debounced) when the client id field changes. No screenshots: the portal changes its look often, and images would have to be vendored and kept up to date.

### 8. Compose

`env_file: [{ path: .env, required: false }]` (Compose ≥ 2.24). The CI `docker-build` job additionally starts the stack without `.env` and expects the health check to pass and `GET /api/setup/status` to answer `required: true`.

### Env variables

New: `SETUP_PIN` (optional, fixed setup PIN; otherwise generated per start). Changed: `SESSION_SECRET`, `DISCORD_*`, `SERVER_NAME`, `BASE_URL`, `TIMEZONE`, `ADMIN_RESET_PASSWORD` become optional in `.env` (the wizard stores them). Both go into `.env.example` (German comments) and `docs/wiki/ops/configuration.md`.

### Discord helpers

`restartBot(token)` in `bot/lifecycle.js`, exported through `bot.js`, twin in `dev/mockBot.js`. Reused: `getGuildRoles`, `getGuildChannels`, `buildBotInviteUrl`.

## Risks / Trade-offs

- [Secrets in plaintext in the database and its backups] → PostgreSQL has no published port in `compose.yaml`; the API never returns secrets; the backup docs get a warning. Encryption with a key file in the `dems-secrets` volume can follow later without changing the specs.
- [PIN visible to anyone who can read the container log] → that person already controls the host; the PIN changes on every start and stops working after the setup.
- [Setup over plain `http://<ip>` fails silently (Secure cookie, CSP `upgrade-insecure-requests`)] → the wizard is the first thing a new operator sees, so the start log line says "über HTTPS", `GET /api/setup/status` reports `httpsRequired` and the PIN step shows a warning; `docs/wiki/ops/deployment.md` and known-issues entry #12 name the setup case.
- [A bot re-login fails after a token change and leaves the bot offline] → the old token stays stored when the Discord check fails (the check runs before the save); the response carries the German error.
- [`process.env` overlay hides where a value came from] → `source` in the settings view and a start log line `⚙️ Konfiguration: 9 Werte aus der Datenbank, 3 aus .env`.
- [Consent gate costs a request per check] → current version from memory, accepted version from the session; one user-document read only for old sessions.
- [Admins lock themselves out by a wrong `DISCORD_ADMIN_ROLE_ID`] → Discord `ADMINISTRATOR` still counts as admin; values in `.env` always win as an escape hatch.

## Migration Plan

1. Deploy as usual. `loadSystemConfig()` marks installations with a complete `.env` as set up (`setupSource: 'env'`) and stores a generated session secret only if `.env` has none (never the case for them).
2. No data reshaping, so no `db/migrations/` step; the new documents are created on demand.
3. Without a stored policy the consent gate is inactive, so members notice nothing until an admin writes one.
4. Rollback: the previous version ignores `systemSettings` and `privacyPolicy`; it needs a complete `.env` again (installations set up by the wizard must write their values into `.env` before rolling back; secrets are not shown in the "System" view, so the operator takes them from the Discord Developer Portal).

- [The Developer Portal renames buttons or moves pages, and the guide goes stale] → all texts sit in `discord-guide.js`, the wiki copy in `docs/wiki/ops/deployment.md` names the same module, and the guide quotes the English portal labels exactly so they are easy to search for.

## Open Questions

- Wording of the default privacy policy suggestion shown in the wizard editor (empty or a short template) — content only, decided during implementation with the user.
