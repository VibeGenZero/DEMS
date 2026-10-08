---
id: decisions
title: Decision log — specs, plans, audits
type: reference
tags: [decisions, adr, history, specs, plans, audit]
sources: [docs/superpowers/specs, docs/superpowers/plans, docs/security/SECURITY_AUDIT_2026-04-22.md, ISSUE.md]
see_also: [security, dev-mock-mode, docker]
---
# Decision log — specs, plans, audits

> TL;DR: Chronological list of the design decisions that shaped DEMS, with links to the full spec/plan/audit documents. Read the linked document only when you change that area; this page gives the one-line rationale.

| Date | Decision | Why | Documents |
|---|---|---|---|
| 2026-02-15 | first security review | CSP, cookie flags, CSV injection findings | `ISSUE.md` |
| 2026-04-10 | styling update: 24 h loading-screen gate, event-detail redesign (banner header, two-column layout, details sidebar, participants), new overview cards with gradient placeholders and series cards | modern, consistent event pages | [spec](../../superpowers/specs/2026-04-10-styling-update-design.md), [plan](../../superpowers/plans/2026-04-10-styling-update.md) |
| 2026-04-11 | debug mode (`DEBUG_MODE`, request logging, `#debug` styling guide) | developer insight without production noise | [spec](../../superpowers/specs/2026-04-11-debug-mode-design.md), [plan](../../superpowers/plans/2026-04-11-debug-mode.md) |
| 2026-04-22 | full security audit with PoC | 28 findings, status tracked in [security](../concepts/security.md) | [audit](../../security/SECURITY_AUDIT_2026-04-22.md) |
| before 2026-09 | SQLite fallback with a Firestore-compatible adapter | run without Firebase; call sites unchanged | `db/sqliteAdapter.js`, README "Datenbank" |
| 2026-09 | Discord registration modal with real components (selects, labels), shared answer format | register directly in Discord | `updates.json` 2.5.0, README "Anmeldung direkt aus Discord" |
| 2026-09-29 | Docker (multi-stage, non-root, healthcheck) + dependency update (Express 5, Firebase 12, better-sqlite3 13, dotenv 18, discord.js 14.27, Node ≥22, node-fetch removed) | container deployment, current libraries | PR #31, [docker](../ops/docker.md) |
| 2026-09-29 | dev mock mode (persona login, mock bot, seed data, `node:test` suite); shared login helpers `getLoginBlockReason` / `saveUserProfile` | develop without Discord/Firebase; persona login cannot drift from OAuth | [spec](../../superpowers/specs/2026-09-29-dev-mock-mode-design.md), [plan](../../superpowers/plans/2026-09-29-dev-mock-mode.md) |
| 2026-10-02 | LLM wiki (this graph) + `CLAUDE.md` | cheaper, more accurate navigation for coding agents | [index](../index.md) |
| 2026-10-08 | product name: DEMS now stands for "Dein Event-Management-System"; technical identifiers (`dems` image, `dems-data` volume, `DEMS_PORT`, `dems.sqlite`, localStorage keys, domain) stay unchanged | "Discord" in a product name invites trademark trouble with Discord; keeping the acronym avoids migrating running deployments | `test/branding.test.js` |
| 2026-10-08 | all frontend libraries and fonts vendored in `public/vendor/` with pinned versions (F-07); CSP without CDN hosts and without `unsafe-eval` | the SPA stayed empty when the CDN was unreachable (`gsap is not defined`), `marked` had no version pin; smaller CSP (audit M-02, part of H-05) | `test/vendorAssets.test.js`, [frontend-markup](../modules/frontend-markup.md) |

## Standing decisions (apply to new work)

- Data access only via the Firestore-compatible API (keeps Firebase and SQLite interchangeable).
- No frontend build pipeline; vanilla JS + pinned libraries and fonts in `public/vendor/` (no CDN).
- German user-facing language.
- Every route works without a Discord bot (helpers degrade to no-ops).
- Dev mock mode must never be activatable in production (`NODE_ENV=production` guard).
- "Discord" never appears in the product name, only to describe the integration (Discord login, Discord bot); `test/branding.test.js` guards the old long form.
