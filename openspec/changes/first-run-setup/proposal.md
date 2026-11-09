# Proposal

Ticket: GitHub issue #138 ("startup").

## Why

Setting DEMS up today means writing a `.env` by hand (Discord app values, guild id, admin role, `SESSION_SECRET`, `BASE_URL`, …) before the first `docker compose up`. A wrong or missing value only shows up as a crash or a broken login. Operators want to start the container and finish the setup in the browser, and the values must survive restarts and updates. Communities also need their own privacy policy that members accept before they use the site, and DEMS has no place for one.

## What Changes

- **Setup wizard on first start.** When no setup has been completed and the required Discord values are not in the environment, DEMS starts in *setup mode*: the API answers only the setup endpoints, and the SPA shows a wizard instead of the login.
- **Setup PIN.** In setup mode DEMS creates a random PIN on every start and prints it in the server log (`docker compose logs dems`). `SETUP_PIN` in `.env` sets it instead. The wizard opens only after the PIN is entered; wrong guesses are rate-limited.
- **Configuration in the database.** The wizard stores the Discord app values, guild, admin role, announcement channel, event category, thread sync, server name, `BASE_URL`, time zone and the admin reset password in the database (`systemSettings/config`). On start DEMS loads them into the process environment. A value set in `.env` always wins and is shown as locked.
- **Generated session secret.** Without `SESSION_SECRET` in `.env`, DEMS generates one on the first start and keeps it in the database. The placeholder value still stops the start.
- **Discord guide in the wizard.** The Discord step walks the operator through creating the Discord application and bot in five steps: create the application, OAuth2 (client id, client secret, redirect URL to copy), bot (token, Server Members Intent, Public Bot), invite the bot (link with all needed permissions, built from the entered client id), copy the server id. Each input field points to its step, and errors such as a missing intent name the step to fix. The admin "System" view opens the same guide.
- **Bot without restart.** Once the wizard has the Discord values, the bot logs in at once, so the wizard can offer roles and channels from the server.
- **System settings in the admin area.** A new admin tab "System" shows every stored value with its source (`.env`, Datenbank, leer) and lets admins change the non-locked ones. Secrets are only ever shown masked. Saving needs the admin reset password and writes an audit log entry.
- **Privacy policy page.** Admins write a privacy policy (Markdown) in the wizard or later in the admin area. It is public at `#privacy`, linked as "Datenschutz" on the login page and in the info area.
- **Consent on login.** While a policy exists, a member whose accepted version is older than the current one must accept it before the website shows anything else. Every saved change to the policy creates a new version, so everyone accepts again. Declining logs the member out.
- **Compose without `.env`.** `compose.yaml` makes `.env` optional; `docker compose up -d` alone brings up PostgreSQL (already automatic) and DEMS in setup mode.
- Existing installations whose `.env` already holds the required values are marked as set up on their first start with this version and never see the wizard. Without a stored policy nobody has to accept anything.

## Capabilities

### New Capabilities
- `first-run-setup`: setup mode, setup PIN, the wizard steps, and when an installation counts as set up.
- `system-settings`: which configuration values live in the database, the `.env` precedence, loading them at start, the generated session secret, and editing them in the admin area.
- `privacy-consent`: the admin-written privacy policy, its versions, the public page, and the consent gate at login.

### Modified Capabilities
- None. No existing spec in `openspec/specs/` covers configuration, the login gate or the setup.

## Impact

- **Code:** `server.js` (setup gate, consent gate, session middleware created after the configuration is loaded, CORS origin read per request), new `utils/systemConfig.js`, `utils/privacyPolicy.js`, `routes/setup.js`, new admin routes in `routes/admin.js`, `routes/auth.js` / `middleware/auth.js` (accepted version in the session), `bot/lifecycle.js` (restartable login) plus `dev/mockBot.js`, module-level `TIMEZONE` constants (`bot/constants.js`, `utils/localDateTime.js`, `utils/eventSeries.js`, `utils/eventChangeNotice.js`, `utils/pollService.js`, `routes/admin.js`) become a getter.
- **Frontend:** new `public/js/pages/setup.js`, `public/js/pages/discord-guide.js` (guide shared by the wizard and the System view), `public/js/pages/privacy.js`, `public/js/admin/system.js`; new sections and dialog in `public/index.html`; boot sequence (`core/boot.js`, `core/auth.js`, `core/router.js`).
- **API:** new `/api/setup/*` (incl. `/api/setup/invite-url`), `/api/admin/system/invite-url`, `/api/privacy`, `/api/user/privacy/accept`, `/api/admin/system/*`; `/auth/me` gains `privacyRequired`.
- **Data:** new singleton documents `systemSettings/config` and `privacyPolicy/current`; `users` gains `privacyAcceptedVersion` and `privacyAcceptedAt`.
- **Config/ops:** new env variable `SETUP_PIN`; `SESSION_SECRET` and the Discord values become optional in `.env`; `compose.yaml` `env_file` becomes optional.
- **Dependencies:** none.
- **Wiki nodes:** `docs/wiki/ops/configuration.md`, `docs/wiki/ops/docker.md`, `docs/wiki/ops/deployment.md`, `docs/wiki/modules/server.md`, `docs/wiki/concepts/auth-session.md`, `docs/wiki/concepts/security.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/reference/api-index.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/modules/routes-auth.md`, `docs/wiki/modules/routes-user.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/modules/frontend-markup.md`, `docs/wiki/modules/bot.md`, `docs/wiki/modules/dev-mock-mode.md`, `docs/wiki/ops/testing.md`.
