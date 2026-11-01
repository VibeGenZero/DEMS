# Design

## Context

- `/event` exists since B-13 with the admin subcommand `create` (`bot/adminCommands.js`); `handleAutocomplete` sends every `/event` autocomplete to the template autocomplete. Discord sends the base names (`event`, `polls`) and the subcommand.
- The vote flow lives in `bot/polls.js`: `poll_vote:<pollId>` → `handlePollVoteButton` (deferred private answer with the vote selects; checks open, maintenance and roles). Any message can carry that button.
- `buildEventAnnouncement(event, eventId, roster, intro)` (`bot/messages.js`) builds the V2 announcement; it returns `{ flags: IsComponentsV2, components }` and is also used for the wizard preview. Its buttons (`event_register`, `event_slot`) work from any message.
- `bot/myEvents.js` has `formatStatus(entry)` for the status line of a profile entry (`toProfileEntry` of `utils/profileEvents.js`, waitlist place via `waitlistPositions`).

## Goals / Non-Goals

**Goals:**
- Reuse the existing layouts and button flows; the new code only selects data and composes the answer.

**Non-Goals:**
- No new posted message, no new custom ID, no new export of `bot.js`.

## Decisions

### 1. New module `bot/infoCommands.js`

Both commands are read-only member answers; a module of their own keeps `bot/commands.js` (now ~370 lines) and `bot/polls.js` small. It requires `./messages`, `./myEvents`, `./registration` (roles) directly — calls between `bot/` modules are real, which is fine here: nothing is sent except the interaction answer.

### 2. `/abstimmungen`

- `loadOpenPollsFor(roleIds, userId, now)`: all polls → `isPollOpen` (status + deadline) and `canVote(poll, roleIds)`; votes of the member from `pollVotes` (`<pollId>_<userId>` doc) → `voted`. Sort by deadline (empty last), then `createdAt`.
- `buildOpenPollsMessage(items, total)`: V2 container like `/my-events` (accent `DEMS_ACCENT`): heading „🗳️ Offene Abstimmungen“, per poll a text block (title, „N Termine · bis <deadline in TIMEZONE>“ or „ohne Frist“, voted state) and an action row with „Abstimmen“ (`poll_vote:<id>`, primary) and „Ansehen“ (link `buildPollUrl`). Five polls = 1 + 5 × 2 + separators stays under the 40-component limit (checked with `countComponents`). More than five → closing text „… und N weitere“ with `buildSiteUrl('polls')`. None → plain text „📭 Gerade läuft keine Abstimmung.“ + link.
- `deferReply` ephemeral first (reads all polls and votes).

### 3. `/event info`

- Definition: `/event` gets a second subcommand `info` (de `info`, description „Zeigt die Details eines Events“) with the required string option `event` (autocomplete). The `/event` command stays visible to everybody; `create` keeps its admin check.
- Autocomplete: `handleAutocomplete` for `event` looks at `interaction.options.getSubcommand()`: `create` → templates (B-13), `info` → `handleEventInfoAutocomplete` (active, `!isEventOver`, title contains the typed text, sorted by start, ≤ 25, name ≤ 100).
- Answer: `deferReply` ephemeral → load event; missing or `!isEventVisibleTo({ isAdmin }, event)` (admin = `hasAdminRole` of B-13) → „❌ Event nicht gefunden.“ → `loadEventRoster` → `buildEventAnnouncement(event, id, roster)`; with an own registration a top-level text display „Dein Status: <formatStatus(toProfileEntry(...))>“ (plus slot as in `/my-events`) is appended after the container; `editReply({ ...message, flags: IsComponentsV2 })` (the defer already made it ephemeral).
- `formatEntry`'s slot part moves into an exported `formatStatusWithSlot(entry)` in `bot/myEvents.js`, used by both.

### 4. Seed

The seed already has the open poll `dev-poll-raid` (deadline in 3 days) and active events; a test in `test/seed.test.js` pins that `dev-poll-raid` is open, so the command test and a manual run have it.

## Risks / Trade-offs

- [Many polls and votes] → one read of `polls` and one of `pollVotes` per command; the community size keeps this small, as on the website's poll list.
- [Announcement layout is long] → it is the same message members already see in the channel; Discord's limits are respected by `buildEventAnnouncement`, the status line adds < 100 characters.
