# Plugin SDK 1.1 and the „Badges“ plugin — design

Issue: [#162 Plugin: Eigene Badges](https://github.com/VibeGenZero/DEMS/issues/162).
Builds on [2026-11-19-plugin-sdk-design](2026-11-19-plugin-sdk-design.md) (SDK 1.0, #155)
and the wiki node `docs/wiki/concepts/plugin-sdk.md`.

## Intent

Admins want to create their own badges, decide what a badge "does" and optionally hand
out a Discord role with it ("kann ggf. auch Rollen verteilen, wenn jemand ein bestimmtes
Badge bekommt"). The profile already shows built-in badges (`routes/user.js`, computed on
every call, never stored), but they are fixed in code.

SDK 1.0 cannot carry such a plugin: a plugin cannot read registrations or check-ins,
cannot change Discord roles, cannot find a member to award something to, and has no place
on the profile. SDK 1.1 adds exactly these four things, cut generically, and the new
official plugin „Badges“ is their first user. Everything else the 1.0 spec named for 1.1
(Discord commands/buttons/modals, `ctx.schedule`, the event page panel, registration
status hooks) moves to SDK 1.2 — an API without a real user tends to be cut wrong.

## Goals

1. **SDK 1.1**, additive: every SDK 1.0 plugin keeps working unchanged.
   - `registrations:read`: read registrations, hook `registration.checkedIn`.
   - `discord:roles`: list, give and take Discord roles, never admin or dangerous roles.
   - `ctx.members.search(query)` under the existing `members:read`.
   - `ctx.profile.badges(provider)`: a plugin adds badges to the member's own profile.
2. **Plugin „Badges“** (`plugins/badges`, official): admins create, edit and delete
   badges (name, description, icon, colour), award them by hand or by an automatic rule
   (participations or check-ins, optionally only of one event category), optionally tie a
   Discord role to a badge, and members see their badges in the profile next to the
   built-in ones. Optional DM to the member and post in a channel for a new badge.
3. Release as DEMS 3.5.0.

## Non-goals

- Rules never take a badge away. Only an admin revokes.
- No badge gallery, leaderboard or badges on other members' pages; no Discord command
  (`/badges` needs `discord:commands`, SDK 1.2).
- No rule combinations (AND/OR), no rules on other data than participations/check-ins.
- Guest places do not count for plugin rules (only the member's own registrations).
- No uploaded images as icons — Bootstrap Icons only.
- No registration status hooks (`registration.created`, `.statusChanged`, …): they would
  need an emission in about ten writers; participations are counted when the event ends.

## Anti-goals (a failure even if it technically works)

- A plugin makes someone a DEMS admin, or hands out a role with moderation/administration
  rights, through `ctx.discord`.
- Revoking a badge takes away a role the member had before or got elsewhere.
- A slow or broken plugin makes the profile slow or fail.
- Creating a rule for an existing community floods members or a channel with messages.

## Approaches (decided in the conversation)

| | Scope of SDK 1.1 | Trade-off |
|---|---|---|
| **A (chosen)** | Only what the badges plugin needs, cut generically | small, every new API is used and tested by a real plugin at once; the rest of the old 1.1 list waits for 1.2 |
| B | Everything the 1.0 spec planned for 1.1, plus the badge parts | two to three times the work before the first release; commands/schedule/event panel without a user yet |

Branches (decided): `feature/plugin-sdk-1.1` from `main` holds this spec and the SDK
work; `feature/badges-plugin` branches off it, its PR targets `feature/plugin-sdk-1.1`;
the SDK branch then goes to `main` with the version bump.

Inside A, the profile part was a choice between a **server-side badge provider** (chosen:
the core renders plugin badges with its own escaping and the same look, counts them in
„x von y“, and a plugin adds no markup to a core page) and a client-side profile panel
(`ui.addProfilePanel`, more flexible but a new rendering surface on a core page and a
different look). The participation trigger was a choice between `event.ended` (chosen:
already emitted for every ended event — auto-archive 24 h after the end, or „Beenden“)
and new registration status hooks (about ten writers to cover and pin, see Non-goals).

## Part 1: SDK 1.1

### Versioning

- `plugin.json` `sdk` accepts `1` and `1.1`; any other value stays
  „Inkompatibel (SDK <n>)“. `SDK_VERSION` stays the major `1`; a new constant names the
  minor (`SDK_MINOR = 1`). System › Plugins shows no SDK version today and stays so.
- The new permissions `registrations:read` and `discord:roles` require `sdk: 1.1`;
  declared with `sdk: 1` → „Ungültig: Die Berechtigung „…“ braucht SDK 1.1.“
- `ctx.members.search` and `ctx.profile` exist for every plugin (additive, no new right).
- Known limit: DEMS 3.4.x shows a `sdk: 1.1` manifest as „Ungültig: SDK-Version fehlt.“
  (it checks `Number.isInteger`). Official plugins ship with the image, so only a custom
  plugin on an old DEMS sees that; the wiki says so.

### `registrations:read` — „Anmeldungen lesen“

`ctx.registrations.list({ eventId, userId } = {})` → array, sorted by `createdAt`:

```
{ id, eventId, userId, status, source, createdAt, checkedIn, checkedInAt, slotId }
```

`checkedIn` is always a boolean, `checkedInAt` and `slotId` `null` when absent. Never
`formAnswers`, `guests`, `pendingGuests`, `guestCheckins`, `offer`, `checkinInvitedAt` or
other fields: a plugin gets attendance, not what a member typed into a form. Filters are
optional and combine; invalid filter values (not a doc id) return `[]`. All filtering in
memory (project rule).

Hook `registration.checkedIn` `{ registration, eventId }` (`registration` in the shape
above), needs `registrations:read`, emitted after a member's own check-in is stored:

| Writer | Path |
|---|---|
| `checkInMember` (`utils/checkin.js`) | web code check-in `POST /api/events/:id/checkin`, Discord check-in button |
| admin toggle | `PUT /api/admin/registrations/:id/checkin` with `checkedIn: true`, without `guestId` |

Not emitted: guest check-ins, clearing a check-in, an already checked-in registration.
The event is not in the payload — a plugin with `events:read` calls `ctx.events.get`.
Pinned in `test/pluginHookEmission.test.js` like the 1.0 hooks; same queue, clone,
timeout and handler limit rules.

### `discord:roles` — „Discord-Rollen vergeben und entziehen“

| Method | Returns |
|---|---|
| `ctx.discord.listRoles()` | `[{ id, name, color }]` of the roles a plugin may use (guard below), highest first; `color` `#rrggbb` or `null`; bot not ready → `[]` |
| `ctx.discord.addRole(userId, roleId)` | `{ ok: true, changed }` (`changed: false` when the member already had it) or `{ ok: false, reason }` |
| `ctx.discord.removeRole(userId, roleId)` | same; `changed: false` when the member did not have it |

`reason` is German: „Der Bot ist nicht verbunden.“, „Das Mitglied ist nicht auf dem
Server.“, „Nachrichtengrenze erreicht …“-style limit text („Rollengrenze erreicht (bis HH:MM)“),
„Discord hat die Änderung abgelehnt.“. A role the guard refuses throws
`PluginDataError` „Diese Rolle darf ein Plugin nicht vergeben.“ (a programming or
configuration error, not a runtime state).

**Guard**, checked on every call against the live guild data (a role edited in Discord
after it was chosen is refused from then on):

- not `@everyone`, not managed (bot, integration, booster roles);
- not `DISCORD_ADMIN_ROLE_ID` (members with it are DEMS admins);
- none of these permission bits: Administrator, ManageGuild, ManageRoles, ManageChannels,
  ManageWebhooks, ManageGuildExpressions, ManageEvents, ManageMessages, ManageThreads,
  ManageNicknames, KickMembers, BanMembers, ModerateMembers, MentionEveryone,
  ViewAuditLog, ViewGuildInsights (one constant, tested);
- below the bot's highest role (Discord would refuse; checked first for a clear answer).

The guard applies to removing too (taking roles from admins would be a denial of service).
Limit: ≤ 500 role changes per plugin per sliding 10 minutes, in memory, next to the DM and
post limits of `createMessageLimiter`; the card shows it like the message limit. The SDK
writes no audit entry per change (a rule run would flood the log); the plugin audits its
own actions. Implemented as helpers in `bot/guild.js` behind `state.isReady` + `try/catch`,
exported through `bot.js`, with logging twins in `dev/mockBot.js` (a few mock roles, one
of them refused by the guard, so the dev mode shows both).

### `ctx.members.search(query)` (`members:read`)

Up to 20 `{ id, name, avatar }` (same shape as `ctx.members.get`) of stored `users`
whose display name, user name or global name contains `query` (trimmed, case-insensitive,
2–50 characters; shorter → `[]`), sorted by name. Only members who logged in once (have a
`users` document). It does not filter on `acceptInvitations` — that is a guest-invitation
choice, not a visibility flag; who may search is the plugin route's `access`.

### `ctx.profile.badges(provider)`

`provider({ userId })` → array (or promise of one) of

```
{ id, name, description, icon, color?, unlocked, progress? }
```

- Registered only during `register()` (like routes and hooks), at most one per plugin; no
  permission (a member sees data about themself).
- `GET /api/user/profile` calls the providers of all switched-on plugins in parallel after
  the built-in badges, **2 s** each. A throw, a timeout or an invalid answer drops that
  plugin's badges for this call, logs, and sets `lastError`; the profile always answers.
- The core validates and copies every entry: at most 50 per plugin; `id` 1–40 of
  `[a-zA-Z0-9-]` (becomes `p:<pluginId>:<id>`); `name` 1–40 characters; `description`
  ≤ 200; `icon` `^bi-[a-z0-9-]+$`; `color` `#rrggbb` or absent; `unlocked` boolean;
  `progress` a number 0–1 or absent. An invalid entry is dropped alone (logged once per call).
- Rendering stays `renderBadgeList` (`public/js/pages/profile-view.js`): plugin badges come
  after the built-in ones within „erreicht“ and „offen“; `unlockedBadges`/`totalBadges`
  count them. An unknown icon name falls back to `bi-award` there already.

### Unchanged rules that matter here

Reserved `userId` field → account deletion purges plugin data; `PLUGINS_SAFE_MODE` runs
no provider and no hook; a switched-off plugin's provider is not called.

## Part 2: The „Badges“ plugin

`plugins/badges/` with `plugin.json`, `server.js`, `rules.js` (pure), `client.js`,
`client.css`, `assets/` as needed. Node built-ins only, no DEMS imports (guard tests).

```json
{
  "id": "badges", "name": "Badges", "version": "1.0.0", "sdk": 1.1,
  "description": "Eigene Badges für die Community – von Hand oder automatisch vergeben, optional mit Discord-Rolle.",
  "permissions": ["events:read", "registrations:read", "members:read", "discord:roles", "discord:dm", "discord:channel"],
  "settings": [
    { "key": "announceChannel", "type": "channel", "label": "Kanal für neue Badges",
      "help": "Leer lassen, wenn neue Badges nicht im Kanal erscheinen sollen." },
    { "key": "dmOnAward", "type": "boolean", "label": "Mitglieder per DM über neue Badges informieren" }
  ]
}
```

(Manifest settings have no defaults: `dmOnAward` starts off.)

### Data (`ctx.data`)

- `badges/<badgeId>`: `{ name (1–40), description (≤ 200), icon (bi-* from the plugin's
  icon list), color (#rrggbb), rule, roleId|null, createdAt, createdBy, updatedAt, updatedBy }`,
  at most 100 badges. `rule` is `{ type: 'manual' }` or
  `{ type: 'participations'|'checkins', count: 1–1000, category: string|null }`.
- `awards/<badgeId>_<userId>`: `{ badgeId, userId, awardedAt, awardedBy ('rule' or the
  admin id), roleAdded (the plugin gave the role, the member did not have it), roleSynced,
  revokedAt|null, revokedBy|null }`. A revoked award stays as a tombstone so a rule does
  not hand the badge back; awarding by hand again clears it. `userId` is the reserved
  field: account deletion purges the member's awards.

### Rules (`rules.js`, pure, unit-tested)

- **Teilnahme**: the member's own registration with status `accepted` for an event with
  status `archived`.
- **Check-in**: the member's own registration with `checkedIn === true` for an event that
  is not `cancelled`.
- `category` set → only events with exactly that `category`.
- A rule badge is due when the count reaches `count` and no award (active or tombstone)
  exists. Progress for the profile: `min(1, count / rule.count)`.

### Triggers

All evaluations of the plugin run one after another on one in-memory queue (no two
evaluations award the same badge twice; the award doc id is deterministic anyway).

| Trigger | Evaluates | Messages |
|---|---|---|
| `event.ended` | members with an accepted registration of that event | DM + channel post |
| `registration.checkedIn` | that member | DM + channel post |
| a rule badge is created, or its rule or category changed | every member (backfill) | none — silent, roles only |
| admin awards by hand | that member | DM + channel post |

Each evaluation reads registrations and events once and counts in memory.

### Effects

Awarding writes the award first, then — on a per-plugin background queue, never inside the
30 s route budget — gives the role (`roleAdded` = `changed`; a failure leaves
`roleSynced: false`), then the DM (`dmOnAward` on: „Du hast das Badge **<Name>** erhalten!“
+ link button „Zum Profil“ → `#profile`) and the channel post (`announceChannel` set:
„**<Mitglied>** hat das Badge **<Name>** erhalten.“ — display name, no mention).

- **Revoke** (admin): `revokedAt/By` set; the role is removed only if `roleAdded` and no
  other active award of the member carries the same role; no DM. The same "still carried by
  another badge" check applies to deleting a badge and to changing its role.
- **Account deletion**: the core purges the awards before `member.deleted` runs, so the
  plugin no longer knows which roles it gave — the roles stay on the Discord member (they
  left DEMS, not the server). The wiki node says so.
- A role that is also an event role (`assignRoleId`) is not refused, but the event's role
  clean-up would take it away after the event; the editor shows a hint
  „Diese Rolle wird auch von Events vergeben und danach wieder entzogen.“ when it is one.
- **Badge deleted** (confirm dialog: „<n> Mitglieder haben dieses Badge. Es wird bei allen
  entfernt, ebenso die Rolle „<Rolle>“, wo das Badge sie vergeben hat.“): awards deleted,
  roles removed where `roleAdded`.
- **Role of a badge changed**: holders lose the old role where `roleAdded` and get the new
  one (same queue, `roleAdded` recomputed).
- **Retry**: a badge card with holders at `roleSynced: false` shows „Rolle bei <n>
  Mitgliedern noch nicht vergeben“ and „Erneut versuchen“.
- Audit (`ctx.audit`): badge created/changed/deleted, awarded/revoked by hand; a rule run
  writes one summary entry („Badge „<Name>“: <n> Mitglieder automatisch ausgezeichnet“),
  not one per member.

### Admin page

`ui.addPage({ access: 'admin', tab: { label: 'Badges', icon: 'bi-award' } })`, built from
the core components (card, chip, button, dialog, empty state, avatar):

```
Badges                                         [+ Neues Badge]
┌──────────────────────────────────────────────────────────┐
│ (●) Raid-Veteran                      Ab 10 Teilnahmen    │
│     „Zehn Raids dabei gewesen“        Kategorie: Raid     │
│     [Rolle: Veteran]  12 Mitglieder                        │
│     [Inhaber] [Bearbeiten] [Löschen]                       │
├──────────────────────────────────────────────────────────┤
│ (●) Gründungsmitglied                 Von Hand            │
│     3 Mitglieder        [Vergeben] [Inhaber] [Bearbeiten]  │
└──────────────────────────────────────────────────────────┘
```

- Editor (dialog): Name, Beschreibung, Icon (grid of a curated list of about 40
  Bootstrap Icons, each checked against the vendored font in a test), Farbe (colour input,
  stored as hex, shown through `data-style-*`), Vergabe (Von Hand / Ab N Teilnahmen /
  Ab N Check-ins), Kategorie (optional, from the categories of existing events), Discord-Rolle
  („Keine“ + `ctx.discord.listRoles()`; empty list → hint „Der Bot ist nicht verbunden
  oder es gibt keine Rolle, die ein Plugin vergeben darf.“).
- „Inhaber“: holders with avatar, date and „von Hand“/„automatisch“, each with „Entziehen“.
- „Vergeben“ (manual badges, also usable for rule badges): member search via
  `ctx.members.search`, debounced, then confirm.
- All plugin routes for this page are `access: 'admin'`.

### Member side

The provider returns the member's active awards as `unlocked` badges, plus rule badges not
yet earned with `progress` (locked). Manual badges not awarded and revoked badges are not
shown. Members get no extra tab.

## Delivery

1. SDK on `feature/plugin-sdk-1.1`: versioning + manifest, `registrations:read` + hook,
   `discord:roles` (+ bot helpers, mock twins), `ctx.members.search`, `ctx.profile.badges`
   + profile route; tests first; wiki (`plugin-sdk`, `write-plugin`, `routes-user`,
   `bot`, `data-model` if touched), `npm run wiki`.
2. Plugin on `feature/badges-plugin` (from the SDK branch), PR into the SDK branch: rules,
   data, triggers, effects, admin page, provider, dev seed of two badges; tests (rules,
   dev server with personas, guard tests); wiki entry for the plugin.
3. Release on the SDK branch: `npm version 3.5.0 --no-git-tag-version`, `updates.json`
   entry (German), PR to `main` (German, Problem / Ursache / Änderung / Verifikation).
4. The design summary goes as a German comment on #162 once this spec is approved.

## Left to the builder

- Module splits (≤ ~500 lines), names of internal helpers, where the role guard constant lives.
- Exact German copy beyond the strings above, the curated icon list, the layout of the
  dialog within the core components.
- Implementation of the in-memory queues and the role limiter (reuse `createMessageLimiter`
  where it fits).
- Seed data for the dev mock mode.
