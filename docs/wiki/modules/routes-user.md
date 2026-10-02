---
id: routes-user
title: routes/user.js — profile, badges, settings, account
type: module
tags: [api, user, profile, badges, settings, guests, gdpr]
sources: [routes/user.js]
part_of: [architecture]
depends_on: [middleware, data-layer]
see_also: [api-index, data-model]
---
# routes/user.js — profile, badges, settings, account

> TL;DR: Mounted at `/api/user`, every route needs a logged-in user. Provides the user's registrations, a profile with stats and computed badges, a user search for guest invitations, the `acceptInvitations` setting and full account deletion.

## Endpoints

| Method | Path | Behaviour |
|---|---|---|
| GET | `/registrations` | own registrations with embedded `event`, newest first |
| GET | `/profile` | `{ user, registrations, stats, badges, unlockedBadges, totalBadges }` |
| GET | `/search?q=` | ≥2 chars; users matching `displayName`/`username`, excluding self and users with `acceptInvitations === false`; max 10 |
| GET | `/settings` | `{ acceptInvitations }` (default true) |
| PUT | `/settings` | body `{ acceptInvitations }` |
| DELETE | `/account` | batch-deletes own registrations + `users/{id}`, destroys session |

## Badges (computed on every `/profile` call, never stored)

| id | Rule |
|---|---|
| `newcomer` | ≥1 registration |
| `early-bird` | registered within 1 h after the event's `createdAt` |
| `regular` / `veteran` / `legend` | ≥5 / ≥10 / ≥20 accepted registrations (with `progress` 0–1) |
| `perfect-attendance` | ≥3 check-ins |
| `streak-master` | ≥3 accepted events in a row, each ≤30 days apart |
| `multitasker` | ≥3 upcoming accepted/pending registrations |

Badge texts are German; icons are Bootstrap Icons class names (`bi-*`).

## Gotchas

- Comments and guest references to a deleted user are not removed by `DELETE /account`.
- `/search` exposes every user who accepts invitations to any logged-in member (audit M-07).
- Events are loaded one by one per registration (no batching) — fine for small data.
