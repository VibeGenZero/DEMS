---
id: date-polls
title: Date polls — finding a date with "passt" / "wenn nötig"
type: concept
tags: [polls, voting, dates, doodle, discord, scheduler, events]
sources: [utils/pollService.js, utils/pollStore.js, utils/adminActions.js, bot/adminCommands.js, routes/polls.js, routes/admin.js, bot/polls.js, public/js/polls/polls.js, public/js/polls/admin.js]
depends_on: [data-model]
see_also: [routes-polls, discord-integration, event-lifecycle, role-slots]
---
# Date polls — finding a date with "passt" / "wenn nötig"

> TL;DR: Admins propose 2–10 dates (`polls`), members vote per date with "passt" or "wenn nötig" (admins can rename the three answers per poll) on the web or through a Discord button with two prefilled selects (`pollVotes`, one document per member). The posted Discord message shows the tally live. A scheduler closes polls after their deadline and DMs the creator; "Event erstellen" opens the event wizard prefilled and `POST /api/admin/events` with `fromPoll` decides the poll and DMs every voter.

## Data

- `polls`: `title`, `description`, `options: [{ id, startDate, endDate }]`, `deadline`, `status: open|closed|decided`, `accessMode`/`requiredRoles`, `labels: { yes, maybe, no }`, `winnerOptionId`, `eventId`, `announcements`, `createdBy`, `createdAt`, `updatedAt`, `closedAt`. A poll without `labels` (older dev data) gets `DEFAULT_POLL_LABELS` through `getPollLabels`.
- `pollVotes` (ID `<pollId>_<userId>`): `{ pollId, userId, userName, yes: optionId[], maybe: optionId[], updatedAt }`; an empty vote is deleted.

## Rules (`utils/pollService.js`, pure)

| Function | Rule |
|---|---|
| `normalizePollInput` | 2–10 dates, new or moved dates in the future, no duplicates; dates with votes may not be removed or moved; only open polls can be edited; `labels` via `normalizePollLabels` (max. 30 characters, empty = default, the three must differ, missing on edit = keep) |
| `getPollLabels` | the three answers of a poll, defaults `passt` / `wenn nötig` / `passt nicht` |
| `normalizeVote` | known dates only, date order; "passt" wins if a date is in both lists |
| `applyVoteChange` | sets one date to `yes`, `maybe` or `no` (`VOTE_STATES`) and keeps the others |
| `isPollOpen` / `effectivePollStatus` | open = status `open` and before the deadline; members see an expired open poll as `closed` |
| `tallyPoll` / `getFavoriteOptionId` | counts and names per date; favorite = most "passt", then "wenn nötig", then earliest |

## Flows (`utils/pollStore.js`)

All writes run under `withEventLock('poll:<id>')`: `savePollVote`, `updatePoll`, `closePoll`, `decidePollWithEvent`/`decidePoll`, `deletePoll`. DMs and `notifyPollChanged` run after the lock. `savePollVote` takes either a full `{ yes, maybe }` or an `update(stored)` function that is applied to the stored vote under the lock (per-date web clicks, Discord selects) -> parallel changes of one member are not lost. `decidePollWithEvent({ pollId, optionId, createEvent })` checks the decision, runs `createEvent` and marks the poll decided in one locked step. `startPollScheduler` (5 min, independent of the bot's reminder setting) calls `closeExpiredPolls`. Account deletion calls `deleteUserPollVotes`.

## Discord

`buildPollMessage(poll, tally, intro)` (B-05: Components V2 container, accent while open, green when decided, grey when closed; 🏆 favorite, up to 5 names per date, status-dependent heading, footer and buttons; the ping line `intro` is stored per posted message and kept by refreshes). `poll_vote:<id>` → `deferReply` → `buildPollVoteReply` with `poll_yes:<id>` / `poll_maybe:<id>` selects; a change → `deferUpdate`, the changed list wins (a date picked as "wenn nötig" leaves "passt"), merged into the stored vote under the lock and saved at once. The poll's `labels` appear in the select placeholders, the "Gespeichert" line, the "nur „…“" line of the posted message and the decision DM; Discord keeps its emojis (✅/🤔), the website uses Bootstrap Icons instead. `refreshPollMessages` edits posted messages; a deleted poll's messages become a grey "🗑️ Abstimmung gelöscht" container without buttons (`markPollMessagesDeleted` → `buildPollDeletedMessage`). Polls never get a discussion thread.

## Created in Discord (B-13)

`/abstimmung erstellen` (admins only) opens a modal with Titel, Termine (one per line, `TT.MM.JJJJ HH:MM`, end optional after „–“, „-“ or „bis“, 2–10 lines; `parsePollLines` in `utils/localDateTime.js`) and Beschreibung. A valid modal runs `createPoll` and `announcePoll` (`utils/adminActions.js`, the same code as `POST /polls` and `…/announce`) and answers with the link to the posted message; without announcement channel the poll exists but is not posted. Refused input offers „Korrigieren“. Details: [discord-integration](discord-integration.md).

## Gotchas

- Voting is blocked during maintenance/panic like registrations (`checkRegistrationAllowed`, `isRegistrationBlocked`).
- Check, event creation and decision run under the poll lock: a poll becomes at most one event (double click, two admins), and a failing creation leaves it open.
- An event from a poll must be `active` (400 `Ein Event aus einer Abstimmung muss aktiv sein.`) because every voter gets a DM with its link; "Event erstellen" presets the wizard status to Aktiv.
- Polls cannot be reopened.
