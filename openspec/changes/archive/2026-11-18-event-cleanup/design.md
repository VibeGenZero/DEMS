# Design

## Context

- The role is handed out in `utils/registrationService.js` (`notifyStatusChange`, `notifyRegistration`) and `utils/eventUtils.js` (waitlist promotion) through `assignRole`, and taken back only in `unregister` through `removeRole` (`bot/guild.js`). Both helpers answer `false` for "bot not ready" and for any Discord error alike.
- `deleteEventChannels(eventId)` (`bot/channels.js`) reads the channel ids from the event, deletes the channels and clears the ids; it answers `false` when the bot is not ready, there are no channels or Discord fails. `routes/admin.js` calls it on end/cancel/status only when `autoCreateChannels` is set and the event was `active`, and on delete always.
- The automatic archive (`utils/eventArchive.js`, W-01) only flips the status, writes `AUTO_ARCHIVE_EVENT` and refreshes announcements. It runs at start (after `whenBotSettled`) and every 5 minutes.
- B-09 set the precedent for an offline bot: a state is stored only after a successful call, so the next scheduler pass catches up.

## Goals / Non-Goals

**Goals:**
- One clean-up function used by every path that ends an event for good, so the rules (accepted only, shared role, logging) live in one place.
- Fire and forget from the routes; nothing in Discord can fail a status change.

**Non-Goals:**
- No clean-up of events archived before this change (no marker → never touched).
- No change to `unregister` (it keeps removing the role without the shared-role check).
- No UI change; the admin sees the result in the audit log.

## Decisions

### 1. `utils/eventCleanup.js`

- `cleanupEvent(eventId, { bot } = {})` (`bot` defaults to `require('../bot')`, injectable for tests): reads the event; collects the user ids of its `accepted` registrations; drops those protected by the shared-role rule (decision 3). Has nothing to do (no role or no remaining member, and no channel id) → returns `'nothing'` without writing. Else writes `discordCleanup: 'pending'`, then:
  - role: `bot.removeRoleFromMembers(roleId, userIds)` → `{ removed, failed }`, or `false` when the bot is not ready;
  - channels: `bot.deleteEventChannels(eventId)` when a channel id is stored;
  - the role call answered `false`, or the channel ids are still stored afterwards → stays `pending`, returns `'pending'`;
  - else `discordCleanup: 'done'`, audit `DISCORD_CLEANUP` by `system` ("Removed role <id> from n members; deleted event channels"), returns `'done'`.
  Never throws (try/catch, logged).
- `retryPendingCleanups()`: every event with `discordCleanup === 'pending'` and status `archived` or `cancelled` → `cleanupEvent`. In-memory filter on `getDocs(collection(db, 'events'))` filtered by `where('discordCleanup', '==', 'pending')`.
- `restoreEventRole(eventId, event, { bot })`: for a status change to `active` when `discordCleanup` is set: `'done'` → `assignRole` for every accepted member (loop over the existing helper, a rare admin action); in both cases write `discordCleanup: null`, so a pending clean-up never fires later.

Alternative considered: a plain `isBotReady()` export and the existing `removeRole` in a loop. Rejected: one guild fetch per member and no difference between "offline" and "member left" — the new helper answers both in one call.

### 2. Bot helper `removeRoleFromMembers(roleId, userIds)` in `bot/guild.js`

`if (!state.isReady) return false`; fetches the guild once; per member `guild.members.fetch(id)` + `member.roles.remove(roleId)` in its own try/catch (unknown member 10007 or a missing role count as `failed`, logged with `debugLog`/`console.error`); returns `{ removed, failed }`. Exported through `bot.js` (both pinned lists in `test/botModules.test.js` / `test/botRealExports.test.js`). Twin in `dev/mockBot.js`: logs `Rolle @<name> von n Mitgliedern entfernt` and returns `{ removed: n, failed: 0 }`.

### 3. Shared-role rule

Events with the same `assignRoleId` (`where('assignRoleId', '==', roleId)`), other id, status `draft` or `active` → their `accepted` registrations' user ids are kept. Over-but-not-yet-archived events still count; they clean up themselves when archived.

### 4. Call sites

| Path | Change |
|---|---|
| `archiveEndedEvents` | after each archive `cleanupEvent(id)` (awaited inside the loop, errors logged); then `retryPendingCleanups()` once per pass |
| `PUT /events/:id/status` | to `archived`/`cancelled` from another status → `cleanupEvent` (replaces the channel deletion for these targets); to `active` → `restoreEventRole`; to `draft` keeps today's channel deletion |
| `PUT /events/:id/cancel`, `POST /events/:id/end` | `cleanupEvent` instead of `deleteEventChannels` |
| `PUT /events/:id` (`applySavedEvent`) | status becomes `archived`/`cancelled` → `cleanupEvent`; becomes `active` from them → `restoreEventRole` |
| `DELETE /events/:id`, `DELETE /events/series/:seriesId` | `await cleanupEvent(id)` instead of `deleteEventChannels` (needs the event and its registrations, so before the deletes) |

Routes call it without `await` (fire and forget, `.catch(console.error)`), except the deletes.

Channels now go whenever ids are stored, also without `autoCreateChannels` — an archived or cancelled event has no use for them.

### 5. Data

`discordCleanup`: `'pending'` | `'done'` | `null`. Not in the event whitelist (server-only). Duplicating an event or extending a series must not copy it (check `duplicate` and `extendSeries`, which already drop B-09's fields).

### 6. Dev mock

New mock role „Event-Teilnehmer“ (`ROLE_ID.EVENT`) in `dev/mockGuild.js`. Seed: the running event (`EVENT_ID.RUNNING`) and the past, still active event (`EVENT_ID.PAST`) get `assignRoleId: ROLE_ID.EVENT` and fake channel ids, so the archive at dev start and „Jetzt beenden“ show the clean-up in the mock log.

## Risks / Trade-offs

- [The event role is a role members had before (e.g. „Mitglied“)] → It is taken back, as `unregister` already does today; documented in the wiki. DEMS cannot tell.
- [Discord keeps refusing a channel deletion (missing right)] → The clean-up stays pending and the scheduler retries every 5 minutes with a logged error, as B-09 does for server events.
- [Many accepted members] → One call per member; Discord's rate limit queue in discord.js spreads them. Clean-up runs outside the request.
- [Deleting with the bot offline] → No marker survives the deletion; the role stays. Accepted.

## Migration Plan

None. Old archived events carry no marker and are left alone; rollback = revert, the extra field is ignored.
