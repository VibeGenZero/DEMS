# Design

## Context

`main` carries 2.6.0 in `package.json` and `updates.json`; the beta 1/2 version jumps stayed on release branches (beta 1 notes survive in a stash on `chore/3.0.0-beta.1`). The current `updates.json` is the D-13 release-list format: `releases` newest first, top-level `version` equal to `releases[0].version`, history 1.1.0–2.6.0. The app reads the version dynamically (`server.js` `GET /api/updates`, `public/js/core/updates.js`, `update-effects.js`, e2e helpers), so no application code changes with the bump. See proposal.md — Why.

## Goals / Non-Goals

**Goals:**
- One jump to `3.0.0-beta.3` that lands in `main` and reaches the test environment as a tagged image.
- Release notes that make the four new features (W-14, W-15, W-09, D-13) visible to beta testers in German.
- The version convention (sources, git tag, image tags) documented in the wiki where it currently exists only in the beta 1 stash.

**Non-Goals:**
- Backfilling the `3.0.0-beta.1`/`beta.2` entries into the release history (user decision).
- The final 3.0.0 jump (prioplan R-05: `latest` tag, live deployment, highlights) — this change only covers the beta series.
- Any frontend/backend behaviour change; the popup, page, badge and effects keep their D-13 behaviour.

## Decisions

- **Bump via `npm version 3.0.0-beta.3 --no-git-tag-version`:** sets `package.json` and `package-lock.json` in one step, the same way the beta 1 jump did it. Alternative (hand-editing both files) risks the two drifting; the lockfile also carries the version in two places.
- **Version equality through the existing data test:** `test/updatesData.test.js` already pins `version === releases[0].version`; it gains the pinned expectation `3.0.0-beta.3` and, because its version regex `^\d+\.\d+\.\d+$` rejects pre-releases, an optional suffix `-[\w.+-]+`. Its `newer()` helper compares only the first three numeric segments — `3.0.0-beta.3` vs `2.6.0` already compares correctly (3 > 2), but the test should compare the numeric prefix so no `NaN` sneaks in.
- **Four feature entries plus a pre-release notice:** like the beta 1 notes ("Das ist eine Vorabversion auf der Test-Umgebung …"), the entry set starts with a short notice that this is a pre-release on the test environment, followed by the four features (admin evaluations W-14, member overview W-15, message to participants W-09, reworked news page D-13). Highlights go on three of them so the popup shows exactly 3 (the D-13 popup rule); the pre-release notice stays a normal entry so it does not push a feature out of the popup.
- **No code changes:** `updateEffectKind('3.0.0-beta.3')` already returns `confetti` (major bump, suffix ignored by design), the e2e helpers read `version` from `updates.json`, and `test/newsFlow.test.js`/`startup.test.js` bring their own fixture versions. Only `test/updatesData.test.js` is touched (RED first), plus one new `updateEffectKind` case pinning `3.0.0-beta.3` → `confetti` so a future change to the regex cannot silently demote the beta to "bugs".
- **Wiki section from the stash:** the "Versions and pre-releases" text of the beta 1 stash is adapted for `docs/wiki/ops/deployment.md` (version sources, `npm version`, git tag without `v`, image tags version + `beta` + sha, `latest` only for live releases). `docs/wiki/ops/ci.md` and `modules/server.md` stay as they are — CI only builds and health-checks images, it does not publish them.
- **Branch and tag:** branch `chore/3.0.0-beta.3` off `main`, MR into `main` (user decision: version jumps land in `main` from now on), git tag `3.0.0-beta.3` (no `v`) on the merge commit. The tag triggers the CI `docker-build` health check automatically.

## Risks / Trade-offs

- [History jumps from 2.6.0 to `3.0.0-beta.3`] → Accepted (user decision); the "Was ist neu" page still shows the full pre-3.0 history.
- [Testers on the test environment have already seen `3.0.0-beta.2` and get the popup again for a "new" version] → Intended: the popup is once per version, and the beta notes are the release notes.
- [`newer()` cannot order two pre-releases of the same triple (`3.0.0-beta.3` vs `3.0.0-beta.4`)] → Not needed while only one beta entry exists; if a later beta is added, the test's comparison must grow a suffix rule — noted in the wiki section.

## Migration Plan

1. Merge the MR, tag `3.0.0-beta.3`, build and push the image with `3.0.0-beta.3`, `beta` and the sha tags, pull it on the test environment.
2. Rollback: re-deploy the previous `beta`-tagged image (the moving tag points to beta 2 until it is overwritten, so note the sha of beta 2 before pushing) and revert the merge in `main`; nothing else persists a version.