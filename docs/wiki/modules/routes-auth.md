---
id: routes-auth
title: routes/auth.js — Discord OAuth2 login
type: module
tags: [auth, oauth2, discord, login, logout, session]
sources: [routes/auth.js, middleware/maintenance.js, utils/userProfile.js]
part_of: [architecture]
depends_on: [middleware, utils, data-layer]
see_also: [auth-session, dev-mock-mode, maintenance-mode]
---
# routes/auth.js — Discord OAuth2 login

> TL;DR: Mounted at `/auth`. `/auth/discord` redirects to Discord OAuth2 (scopes `identify guilds guilds.members.read`) with a one-time `state` kept in the session; `/auth/discord/callback` exchanges the code, checks guild membership and admin role, applies the maintenance login block, upserts the `users` document and stores the session user; `/auth/me` returns the session user; `POST /auth/logout` (CSRF token) destroys the session.

## Endpoints

| Method | Path | Result |
|---|---|---|
| GET | `/auth/discord` | 302 to `https://discord.com/api/oauth2/authorize?...` with `redirect_uri = ${BASE_URL}/auth/discord/callback` and `state` (32 random bytes hex, stored as `req.session.oauthState`) |
| GET | `/auth/discord/callback?code=&state=` | 302 to `/#events` on success, else `/?error=<code>` |
| GET | `/auth/me` | session user JSON, or `null` (status 200) when logged out; clears `isNewUser` after the first read |
| POST | `/auth/logout` | CSRF token required (server.js); destroys the session → `{ success: true }` |

## Callback steps

1. `state` missing or not the one stored in the session → `/?error=invalid_state`; the stored state is deleted on every callback, so it works once.
2. No `code` → `/?error=no_code`.
3. `POST https://discord.com/api/v10/oauth2/token` (via `discordFetch`, retries transient socket errors twice) → no `access_token` → `/?error=token_failed`.
4. `GET /users/@me` (profile) and `GET /users/@me/guilds/{DISCORD_GUILD_ID}/member` → not OK → `/?error=not_member`.
5. `isAdmin = member.roles.includes(DISCORD_ADMIN_ROLE_ID)` (false when the variable is empty).
6. `getLoginBlockReason(isAdmin)` → `panic_mode` / `maintenance_login_disabled` redirect for non-admins.
7. Avatar URL: `cdn.discordapp.com/avatars/{id}/{hash}.png` or the default embed avatar.
8. `saveUserProfile(...)` (errors are logged, login continues) → `isNewUser`.
9. `startUserSession(req, { id, username, displayName, avatar, roles, isAdmin, isNewUser })` (`middleware/auth.js`): new session id and CSRF token, then `req.session.user` → `/#events`.

Error codes are translated in the frontend by `getErrorMessage(code)` (`public/js/app.js`).

## Where in code

| What | grep anchor |
|---|---|
| retry wrapper | `async function discordFetch` |
| OAuth redirect | `router.get('/discord',` |
| callback | `router.get('/discord/callback'` |
| logout | `router.post('/logout'` |
| new session after login (shared) | `startUserSession` (middleware/auth.js) |
| maintenance gate (shared) | `getLoginBlockReason` (middleware/maintenance.js) |
| profile upsert (shared) | `saveUserProfile` (utils/userProfile.js) |

## Gotchas

- Tests run these routes against a fake Discord API: `test/fixtures/fakeDiscordServer.js` stubs `fetch` for `discord.com/api` and starts `server.js` (see [testing](../ops/testing.md)).
- `isAdmin` and `roles` are cached in the session for 24 h; role changes in Discord apply only after re-login.
- In dev mock mode `dev/devAuth.js` shadows `/discord` and `/discord/callback` with the persona login — see [dev-mock-mode](dev-mock-mode.md).
