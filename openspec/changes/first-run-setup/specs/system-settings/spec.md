# Spec Delta

## Purpose

Keeps the operational configuration of DEMS (Discord app, guild, roles, channels, URL, time zone, secrets) in the database so it survives restarts, lets `.env` override it, and lets admins change it in the admin area.

## ADDED Requirements

### Requirement: Stored configuration values
DEMS SHALL keep these values in the database: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_ADMIN_ROLE_ID`, `DISCORD_ANNOUNCE_CHANNEL_ID`, `DISCORD_EVENT_CATEGORY_ID`, `DISCORD_THREAD_SYNC`, `SERVER_NAME`, `BASE_URL`, `TIMEZONE`, `ADMIN_RESET_PASSWORD`. Database, port, Node environment, upload folder, debug and dev values SHALL stay environment-only.

#### Scenario: Stored value in effect
- **WHEN** `TIMEZONE=Europe/Vienna` is stored in the database and not set in the environment
- **THEN** bot messages and series dates use `Europe/Vienna`

#### Scenario: Environment-only value
- **WHEN** an admin tries to store `PGHOST` or `DEBUG_MODE` through the system settings
- **THEN** the value is rejected with 400 and nothing is stored

### Requirement: Environment wins
A value set (non-empty) in the environment SHALL take precedence over the stored value and SHALL be reported as locked with source `env`. A stored value SHALL apply only while the environment leaves the key empty.

#### Scenario: Both set
- **WHEN** `DISCORD_GUILD_ID` is `111` in `.env` and `222` in the database
- **THEN** DEMS uses `111` and the system settings show the key as locked with source `env`

#### Scenario: Removed from .env
- **WHEN** the operator removes `DISCORD_GUILD_ID` from `.env` and restarts
- **THEN** DEMS uses the stored `222`

### Requirement: Generated session secret
Without `SESSION_SECRET` in the environment, DEMS SHALL generate a random secret of at least 32 bytes on the first start, store it and reuse it on every later start. The placeholder `your_random_session_secret_here` SHALL still stop the start. The secret SHALL never be shown or editable.

#### Scenario: Sessions survive a restart
- **WHEN** DEMS runs without `SESSION_SECRET` in the environment, a member logs in, and DEMS restarts
- **THEN** the member is still logged in

#### Scenario: Placeholder
- **WHEN** `SESSION_SECRET=your_random_session_secret_here`
- **THEN** DEMS exits with code 1 and a German message

### Requirement: Reading the system settings
`GET /api/admin/system/settings` (admins only) SHALL list each stored key with its source (`env`, `db`, `none`), whether it is locked, and whether a change needs a restart. Values of `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN` and `ADMIN_RESET_PASSWORD` SHALL NOT be returned, only whether they are set.

#### Scenario: Secrets masked
- **WHEN** an admin reads the system settings
- **THEN** the response contains no client secret, bot token, reset password or session secret, and marks each secret as set or not set

#### Scenario: Non-admin
- **WHEN** a member without admin rights calls the endpoint
- **THEN** the response is 403

### Requirement: Changing the system settings
`PUT /api/admin/system/settings` (admins only) SHALL change only unlocked keys and SHALL require the current admin reset password. An empty secret field SHALL keep the stored secret. A successful change SHALL take effect without a restart, except where reported otherwise, and SHALL write an audit log entry without secret values.

#### Scenario: Change the admin role
- **WHEN** an admin saves a new `DISCORD_ADMIN_ROLE_ID` with the correct reset password
- **THEN** the value is stored, used for the next role refresh, and the audit log has `UPDATE_SYSTEM_SETTINGS` naming the key but no value of a secret

#### Scenario: Wrong reset password
- **WHEN** an admin saves with a wrong reset password
- **THEN** the response is 401 with `Ungültiges Admin-Reset-Passwort.` and nothing changes

#### Scenario: Locked key
- **WHEN** an admin tries to change a key whose source is `env`
- **THEN** the response is 400 with a German error naming the key, and nothing changes

#### Scenario: New bot token
- **WHEN** an admin saves a new valid bot token
- **THEN** the bot logs out and logs in again with the new token without a restart of DEMS

#### Scenario: Thread sync needs a restart
- **WHEN** an admin changes `DISCORD_THREAD_SYNC`
- **THEN** the value is stored and the response and the settings view say that it takes effect after a restart

### Requirement: System tab in the admin area
The admin area SHALL have a "System" view that shows the settings grouped as Discord, Server and Sicherheit, marks locked values with "aus .env", shows secrets as "gesetzt"/"nicht gesetzt", and asks for the reset password before saving.

#### Scenario: Locked field
- **WHEN** an admin opens "System" and `BASE_URL` comes from `.env`
- **THEN** the `BASE_URL` field is read-only and labelled "aus .env"

#### Scenario: Discord guide from the System view
- **WHEN** an admin chooses "Anleitung anzeigen" in the Discord group
- **THEN** the same Discord guide as in the setup wizard opens, with the redirect URL of the current `BASE_URL` and the invite link of the current client id
