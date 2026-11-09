# Spec Delta

## Purpose

Lets an operator start a fresh DEMS installation without a hand-written `.env` and finish the configuration in the browser, protected by a setup PIN that only someone with access to the server log knows.

## ADDED Requirements

### Requirement: Setup mode
DEMS SHALL start in setup mode when no setup has been completed and the environment lacks at least one of `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `DISCORD_GUILD_ID`. Setup mode SHALL never apply in dev mock mode. Setup mode SHALL end when the wizard completes, without a restart.

#### Scenario: Fresh installation
- **WHEN** DEMS starts with an empty database and no Discord values in the environment
- **THEN** DEMS is in setup mode and `GET /api/setup/status` answers `{ required: true, unlocked: false }`

#### Scenario: Existing installation with a complete .env
- **WHEN** DEMS starts for the first time with this version, has no stored setup, and the environment holds all three required Discord values
- **THEN** DEMS records the setup as completed (source `.env`), is not in setup mode, and the login works as before

#### Scenario: Dev mock mode
- **WHEN** DEMS starts with `DEV_MOCK=true`
- **THEN** DEMS is not in setup mode

### Requirement: API locked in setup mode
In setup mode every `/api/*` and `/auth/*` request except `/api/setup/*`, `/api/csrf-token`, `/api/server-info`, `/api/maintenance/status`, `/api/privacy` and `/api/updates` SHALL answer 503 with a German `error` and `setupRequired: true`. Static files and `/healthz` SHALL stay available.

#### Scenario: Events in setup mode
- **WHEN** a browser calls `GET /api/events` while DEMS is in setup mode
- **THEN** the response is 503 with `{ error: 'DEMS ist noch nicht eingerichtet.', setupRequired: true }`

#### Scenario: Health check in setup mode
- **WHEN** the container health check calls `/healthz` in setup mode
- **THEN** the response is 200

### Requirement: Setup PIN
In setup mode DEMS SHALL hold one setup PIN: the value of `SETUP_PIN` when set, otherwise a random 8-digit PIN created at every start. DEMS SHALL print the PIN in the server log at every start while setup mode lasts. The PIN SHALL NOT be returned by any endpoint.

#### Scenario: Generated PIN in the log
- **WHEN** DEMS starts in setup mode without `SETUP_PIN`
- **THEN** the log contains a German line with an 8-digit setup PIN

#### Scenario: PIN from the environment
- **WHEN** DEMS starts in setup mode with `SETUP_PIN=12345678`
- **THEN** only `12345678` unlocks the wizard

### Requirement: Unlocking the wizard
`POST /api/setup/unlock` with the correct PIN SHALL unlock the wizard for the calling session only. A wrong PIN SHALL answer 401 `Falsche Setup-PIN.`. More than 5 attempts from one IP within 15 minutes SHALL answer 429. Every other setup step SHALL answer 403 for a session that has not unlocked the wizard.

#### Scenario: Correct PIN
- **WHEN** a session sends the correct PIN
- **THEN** the response is 200 and `GET /api/setup/status` answers `unlocked: true` for that session

#### Scenario: Other browser
- **WHEN** one browser unlocked the wizard and a second browser calls a setup step
- **THEN** the second browser gets 403

#### Scenario: Brute force
- **WHEN** one IP sends a sixth PIN attempt within 15 minutes
- **THEN** the response is 429 and the PIN is not checked

### Requirement: Discord step
The unlocked wizard SHALL accept the Discord client id, client secret, bot token and guild id, check them against Discord, store them, and log the bot in without a restart. The response SHALL name the guild and list its roles and channels, or give a German error naming the wrong value.

#### Scenario: Valid values
- **WHEN** the unlocked session submits a valid client id, secret, bot token and the id of a guild the bot is a member of
- **THEN** the values are stored, the bot is online, and the response contains the guild name, its roles and its channels

#### Scenario: Bot not on the guild
- **WHEN** the bot token is valid but the bot is not a member of the given guild
- **THEN** the response is 400 with a German error and the bot invite URL

#### Scenario: Wrong bot token
- **WHEN** the bot token is rejected by Discord
- **THEN** the response is 400 with a German error naming the bot token, and nothing is stored

#### Scenario: Server Members Intent off
- **WHEN** the bot token is valid but Discord refuses the login because the Server Members Intent is not switched on
- **THEN** the response is 400 with a German error that says to switch on "Server Members Intent" in the Developer Portal (guide step 3), and nothing is stored

#### Scenario: Wrong client secret
- **WHEN** Discord rejects the client id and client secret
- **THEN** the response is 400 with a German error naming the client secret and pointing to guide step 2, and nothing is stored

### Requirement: Discord guide in the wizard
The Discord step SHALL show a German step-by-step guide for creating the Discord application and bot, built from text and Bootstrap Icons only. Its steps SHALL be collapsible and markable as done: 1 create the application, 2 OAuth2 (client id, client secret, redirect URL), 3 bot (token, intents, public bot), 4 invite the bot, 5 copy the server id.

#### Scenario: Steps and content
- **WHEN** the unlocked session reaches the Discord step
- **THEN** the guide shows five steps: (1) open the Developer Portal (link), "New Application", name it; (2) copy the client id, "Reset Secret" and copy the client secret (shown only once), add the redirect URL; (3) "Reset Token" and copy the token, switch on "Server Members Intent", "Message Content Intent" only for the comment sync, switch off "Public Bot" (recommended); (4) open the invite link, choose the server, authorize; (5) switch on developer mode in Discord, right-click the server, "Server-ID kopieren"

#### Scenario: Redirect URL matches BASE_URL
- **WHEN** the guide shows step 2
- **THEN** it shows the redirect URL `<BASE_URL>/auth/discord/callback` built from the current `BASE_URL` (from `.env` or the wizard default) with a copy button

#### Scenario: Invite link after the client id
- **WHEN** the session enters a client id of 17 to 20 digits
- **THEN** step 4 shows an invite link with the scopes `bot` and `applications.commands` and every permission DEMS needs; without a valid client id it shows a hint to fill in the client id first

#### Scenario: Field hints
- **WHEN** the Discord step shows its four input fields
- **THEN** each field has a German hint where to find the value and a link to its guide step

#### Scenario: Step marked as done
- **WHEN** the operator marks a guide step as done
- **THEN** the step collapses and shows a check mark, and the mark stays while the wizard is open

### Requirement: Completing the setup
The unlocked wizard SHALL complete with the server values (`BASE_URL`, server name, time zone, admin role, announcement channel, event category, thread sync), an admin reset password of at least 12 characters and an optional privacy policy. Completing SHALL end setup mode and invalidate the PIN.

#### Scenario: Complete
- **WHEN** the unlocked session completes with valid values after the Discord step
- **THEN** the values are stored, setup mode ends, `GET /api/events` needs a login again (401) instead of 503, and the wizard offers "Mit Discord anmelden"

#### Scenario: Complete before the Discord step
- **WHEN** the unlocked session completes without stored Discord values
- **THEN** the response is 400 with a German error and setup mode continues

#### Scenario: Invalid BASE_URL
- **WHEN** `BASE_URL` is not an absolute http(s) URL
- **THEN** the response is 400 with a German error

### Requirement: Values from the environment in the wizard
The wizard SHALL show each value that the environment already sets as locked with the hint "aus .env", and SHALL NOT overwrite it.

#### Scenario: BASE_URL in .env
- **WHEN** `BASE_URL` is set in the environment and the wizard opens
- **THEN** the `BASE_URL` field shows that value, cannot be edited, and completing keeps the environment value

### Requirement: Setup survives a restart
Values stored by the wizard SHALL be in effect after a restart of DEMS or the container, and a completed setup SHALL NOT open the wizard again.

#### Scenario: Restart after setup
- **WHEN** the setup was completed and the container restarts with the same database and still no `.env`
- **THEN** DEMS is not in setup mode, the bot logs in, and members can log in with Discord
