---
id: routes-polls
title: routes/polls.js — member API for date polls
type: module
tags: [api, polls, voting]
sources: [routes/polls.js]
part_of: [architecture]
depends_on: [middleware, data-layer]
see_also: [date-polls, api-index]
---
# routes/polls.js — member API for date polls

> TL;DR: Mounted at `/api/polls`, every route needs a logged-in member. Lists polls with the own vote status, returns one poll with tally and own vote, and stores a vote (`PUT /:id/vote`, blocked during maintenance). Admin routes for polls live in `routes/admin.js`.

| Method | Path | Behaviour |
|---|---|---|
| GET | `/` | all polls: open first (by deadline), then closed/decided newest first; `{ id, title, status, deadline, optionCount, voterCount, labels, favorite, myVoteStatus, canVote, eventId, createdAt }` |
| GET | `/:id` | poll without `announcements`, effective `status`, `labels` (defaults filled in), `tally` (names/avatars), `favoriteOptionId`, `myVote`, `canVote`, `isOpen`; 404 when missing |
| PUT | `/:id/vote` | `checkRegistrationAllowed`; body `{ optionId, state }` changes one date to `yes`, `maybe` or `no` (merged into the stored vote under the poll lock — the website sends this, so fast clicks keep each other; 400 `Ungültige Auswahl` for another state) or `{ yes, maybe }` replaces the whole vote → `savePollVote` → same shape as `GET /:id`; 400 closed, 403 role, 404 missing |
