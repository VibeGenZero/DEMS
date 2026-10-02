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

> TL;DR: Mounted at `/auth`. `/auth/discord` redirects to Discord OAuth2 (scopes `identify guilds guilds.members.read`); `/auth/discord/callback` exchanges the code, checks guild membership and admin role, applies the maintenance login block, upserts the `users` document and stores the session user; `/auth/me` returns the session user; `/auth/logout` destroys the session.

## Endpoints

| Method | Path | Result |
|---|---|---|
| GET | `/auth/discord` | 302 to `https://discord.com/api/oauth2/authorize?...` with `redirect_uri = ${BASE_URL}/auth/discord/callback` |
| GET | `/auth/discord/callback?code=` | 302 to `/#events` on success, else `/?error=<code>` |
| GET | `/auth/me` | session user JSON, or `null` (status 200) when logged out; clears `isNewUser` after the first read |
| GET | `/auth/logout` | destroys session, 302 to `/` |

## Callback steps

1. No `code` → `/?error=no_code`.
2. `POST https://discord.com/api/v10/oauth2/token` (via `discordFetch`, retries transient socket errors twice) → no `access_token` → `/?error=token_failed`.
3. `GET /users/@me` (profile) and `GET /users/@me/guilds/{DISCORD_GUILD_ID}/member` → not OK → `/?error=not_member`.
4. `isAdmin = member.roles.includes(DISCORD_ADMIN_ROLE_ID)` (false when the variable is empty).
5. `getLoginBlockReason(isAdmin)` → `panic_mode` / `maintenance_login_disabled` redirect for non-admins.
6. Avatar URL: `cdn.discordapp.com/avatars/{id}/{hash}.png` or the default embed avatar.
7. `saveUserProfile(...)` (errors are logged, login continues) → `isNewUser`.
8. `req.session.user = { id, username, displayName, avatar, roles, isAdmin, isNewUser }` → `/#events`.

Error codes are translated in the frontend by `getErrorMessage(code)` (`public/js/app.js`).

## Where in code

| What | grep anchor |
|---|---|
| retry wrapper | `async function discordFetch` |
| OAuth redirect | `router.get('/discord',` |
| callback | `router.get('/discord/callback'` |
| maintenance gate (shared) | `getLoginBlockReason` (middleware/maintenance.js) |
| profile upsert (shared) | `saveUserProfile` (utils/userProfile.js) |

## Gotchas

- No OAuth `state` parameter and no `req.session.regenerate()` after login (security audit H-01/H-02, still open).
- `isAdmin` and `roles` are cached in the session for 24 h; role changes in Discord apply only after re-login.
- In dev mock mode `dev/devAuth.js` shadows `/discord` and `/discord/callback` with the persona login — see [dev-mock-mode](dev-mock-mode.md).
