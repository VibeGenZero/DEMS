---
id: dev-mock-mode
title: Dev mock mode (dev/) — run without Discord and Firebase
type: module
tags: [dev, mock, seed, personas, local-development, testing]
sources: [dev/mockMode.js, dev/mockGuild.js, dev/mockBot.js, dev/devAuth.js, dev/dev-login.css, dev/seed.js, dev/seedData.js, dev/banners, dev/start.js, dev/reset.js, compose.dev.yaml]
part_of: [architecture]
depends_on: [bot, data-layer, routes-auth]
see_also: [run-and-debug, testing, docker]
---
# Dev mock mode (dev/) — run without Discord and Firebase

> TL;DR: `npm run dev:mock` (or `docker compose -f compose.dev.yaml up --build`) starts DEMS with `DEV_MOCK=true`: a separate SQLite file with seeded dummy data, a persona login instead of Discord OAuth, and a simulated Discord server whose actions are logged as `[MOCK-DISCORD]`. It refuses to start with `NODE_ENV=production`.

## Files

| File | Role |
|---|---|
| `dev/mockMode.js` | switch `IS_MOCK_MODE`; production guard (exit 1); forces env: `SQLITE_PATH` = `DEV_SQLITE_PATH` or `data/dems.dev.sqlite`, `UPLOAD_DIR` = `DEV_UPLOAD_DIR` or `data/dev-uploads` (uploaded banners, W-12), blank `FIREBASE_*` + bot token, mock guild/admin role/announce channel ids, `BASE_URL=http://localhost:<PORT>`; defaults `SESSION_SECRET=dems-dev-mock-secret`, `ADMIN_RESET_PASSWORD=dev` |
| `dev/mockGuild.js` | static mock server "DEMS Dev Server": roles (Admin, Moderator, Raid-Team, VIP, Mitglied, managed "DEMS Bot"), channels (incl. non-public `#mod-intern`), 2 scheduled events, 4 personas, 9 members, `findMember`, `defaultAvatar` |
| `dev/mockBot.js` | replaces the Discord-facing exports of `bot.js` (merged at the end of `bot.js`; calls between the `bot/` modules keep the real functions); `sendChannelMessage` logs the V2 component JSON and returns fake `{ channelId, messageId, guildId }`, `ensureAnnouncementThread` keeps a stored thread or logs `Diskussions-Thread "…" … eröffnet` with a fake id of the mock server, `refreshEventAnnouncements` logs `Ankündigung von "…" aktualisiert` + the payload, `refreshPollMessages` logs `Abstimmung "…" aktualisiert` + the payload, `markPollMessagesDeleted` logs the delete notice |
| `dev/devAuth.js` | `/auth/discord` and `/auth/discord/callback` → `/auth/dev-login` (persona page; its look is `dev/dev-login.css`, served as `/auth/dev-login.css`, because the CSP allows no style element) → `/auth/dev-login/:personaId` starts the session like the real login (`startUserSession`: new session id + CSRF token) |
| `dev/seedData.js` | `buildSeedData(now)`: 14 events (open, form, full+waitlist, role-only raid with slots (Ben Tank, Kira in her fallback Heiler, Felix waitlisted), 7-field web-only form, running with check-in `DEMO42`, past "Retro-Spieleabend" (still `active` in the seed, a week over: the archive scheduler archives it at the first start), "Feierabend-Runde" (`dev-event-ended`, ended three hours ago: over, takes no registration, archived only a day later), archived, draft, a cancelled "LAN-Abend" two weeks ago, 3-part weekly series; each with an SVG banner from `dev/banners/` (`EVENT_BANNERS`), served at `/dev-banners/` only in mock mode, the workshop's file missing on purpose), 12 users (Dennis accepts no invitations; DM choices of W-16: Kira no change or cancellation DMs, Jonas no reminders), 38 registrations (Tom/`member`: waitlisted on the full event, pending at the tournament, rejected at the workshop; Mori/`admin`: slot "Schaden" in the raid; Lena and Tom at the cancelled event), comments, audit log, settings, 2 date polls (open raid poll for the Raid-Team without Lena's vote and with own answers "Bin dabei / Vielleicht / Kann nicht", decided "Sommerfest-Termin" linked to the archived event) with 5 votes, 1 event template "Raid-Abend" (W-10: Raid-Team only, manual approval, slots Tank 1 / Heiler 2 / Schaden 3, form field "Charaktername", reminders 24 h and 1 h, location Event-Voice); exports `EVENT_ID`, `SERIES_EVENT_IDS`, `CHECKIN_CODE`, `RAID_SLOT_ID`, `POLL_ID` |
| `dev/seed.js` | `seedIfEmpty()` (marker `devMeta/seed`), `resetAndSeed()`; refuses to load outside mock mode or with a non-SQLite backend |
| `dev/start.js` / `dev/reset.js` | entry points of `npm run dev:mock` / `npm run dev:reset` |

## Personas (`/auth/dev-login/<id>`)

| id | Name | Purpose |
|---|---|---|
| `admin` | Mori (Admin) | admin area, bot control, maintenance; plays "Schaden" in the raid (slot chip in the profile) |
| `raider` | Lena | member with role Raid-Team (raid with slots: tank is full → try a fallback role) |
| `member` | Tom | plain member, not registered for the open event, can check in with `DEMO42`; his profile shows every registration status |
| `newbie` | Neo (Neuling) | first login (`isNewUser`), no profile until first login; accepted guest of Chiara at the workshop (guest view) |

## Behaviour differences to production

- Rate limiters are skipped (`skip: () => IS_MOCK_MODE` in `server.js`).
- Reminder DMs from `checkReminders` call the real (not ready) `sendDM` → only "Bot not ready" warnings.
- Dates are relative to the first seed; after a few days the sample events are in the past (and a day after their end the archive scheduler moves them into the archive tab) → `npm run dev:reset` (a dev database seeded before D-04 also needs it once for the banners).

Design: `docs/superpowers/specs/2026-09-29-dev-mock-mode-design.md`, plan: `docs/superpowers/plans/2026-09-29-dev-mock-mode.md`.
