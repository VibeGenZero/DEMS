---
id: dev-mock-mode
title: Dev mock mode (dev/) — run without Discord and Firebase
type: module
tags: [dev, mock, seed, personas, local-development, testing]
sources: [dev/mockMode.js, dev/mockGuild.js, dev/mockBot.js, dev/devAuth.js, dev/seed.js, dev/seedData.js, dev/start.js, dev/reset.js, compose.dev.yaml]
part_of: [architecture]
depends_on: [bot, data-layer, routes-auth]
see_also: [run-and-debug, testing, docker]
---
# Dev mock mode (dev/) — run without Discord and Firebase

> TL;DR: `npm run dev:mock` (or `docker compose -f compose.dev.yaml up --build`) starts DEMS with `DEV_MOCK=true`: a separate SQLite file with seeded dummy data, a persona login instead of Discord OAuth, and a simulated Discord server whose actions are logged as `[MOCK-DISCORD]`. It refuses to start with `NODE_ENV=production`.

## Files

| File | Role |
|---|---|
| `dev/mockMode.js` | switch `IS_MOCK_MODE`; production guard (exit 1); forces env: `SQLITE_PATH` = `DEV_SQLITE_PATH` or `data/dems.dev.sqlite`, blank `FIREBASE_*` + bot token, mock guild/admin role/announce channel ids, `BASE_URL=http://localhost:<PORT>`; defaults `SESSION_SECRET=dems-dev-mock-secret`, `ADMIN_RESET_PASSWORD=dev` |
| `dev/mockGuild.js` | static mock server "DEMS Dev Server": roles (Admin, Moderator, Raid-Team, VIP, Mitglied, managed "DEMS Bot"), channels (incl. non-public `#mod-intern`), 2 scheduled events, 4 personas, 9 members, `findMember`, `defaultAvatar` |
| `dev/mockBot.js` | replaces the Discord-facing exports of `bot.js` (merged at the end of `bot.js`); `sendChannelMessage` returns fake `{ channelId, messageId }`, `refreshEventAnnouncements` logs `Ankündigung von "…" aktualisiert`, `refreshPollMessages` logs `Abstimmung "…" aktualisiert`, `markPollMessagesDeleted` logs the delete notice |
| `dev/devAuth.js` | `/auth/discord` and `/auth/discord/callback` → `/auth/dev-login` (persona page) → `/auth/dev-login/:personaId` sets the same session as the real login |
| `dev/seedData.js` | `buildSeedData(now)`: 12 events (open, form, full+waitlist, role-only raid with slots (Ben Tank, Kira in her fallback Heiler, Felix waitlisted), 7-field web-only form, running with check-in `DEMO42`, past, archived, draft, 3-part weekly series), 12 users, 32 registrations, comments, audit log, settings, 2 date polls (open raid poll for the Raid-Team without Lena's vote, decided "Sommerfest-Termin" linked to the archived event) with 5 votes; exports `EVENT_ID`, `SERIES_EVENT_IDS`, `CHECKIN_CODE`, `RAID_SLOT_ID`, `POLL_ID` |
| `dev/seed.js` | `seedIfEmpty()` (marker `devMeta/seed`), `resetAndSeed()`; refuses to load outside mock mode or with a non-SQLite backend |
| `dev/start.js` / `dev/reset.js` | entry points of `npm run dev:mock` / `npm run dev:reset` |

## Personas (`/auth/dev-login/<id>`)

| id | Name | Purpose |
|---|---|---|
| `admin` | Mori (Admin) | admin area, bot control, maintenance |
| `raider` | Lena | member with role Raid-Team (raid with slots: tank is full → try a fallback role) |
| `member` | Tom | plain member, not registered for the open event, can check in with `DEMO42` |
| `newbie` | Neo (Neuling) | first login (`isNewUser`), no profile until first login |

## Behaviour differences to production

- Rate limiters are skipped (`skip: () => IS_MOCK_MODE` in `server.js`).
- Reminder DMs from `checkReminders` call the real (not ready) `sendDM` → only "Bot not ready" warnings.
- Dates are relative to the first seed; after a few days the sample events are in the past → `npm run dev:reset`.

Design: `docs/superpowers/specs/2026-09-29-dev-mock-mode-design.md`, plan: `docs/superpowers/plans/2026-09-29-dev-mock-mode.md`.
