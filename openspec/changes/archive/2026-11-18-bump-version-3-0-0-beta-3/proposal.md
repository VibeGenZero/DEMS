# Proposal

## Why

The test environment runs DEMS `3.0.0-beta.2`, but `main` still carries the version `2.6.0`: the version jumps of beta 1 and beta 2 were never merged back. Since beta 2, four features landed in `main` (member overview W-15, admin evaluations W-14, message to all participants W-09, the reworked "Neuigkeiten" D-13) and are ready for the next beta cut. This change performs the version jump to `3.0.0-beta.3` in `main`, so the version badge, the once-per-version news popup and the "Was ist neu" page show the new features to the beta testers.

## What Changes

- **Version bump to `3.0.0-beta.3`** in `package.json` and `package-lock.json` (`npm version 3.0.0-beta.3 --no-git-tag-version`); the version jump lands in `main` through its own branch and merge request (the beta 1/2 pattern of keeping `main` at 2.6.0 ends here).
- **Release notes:** a new release entry `3.0.0-beta.3` at the top of `updates.json` (date, German entries for the four features, up to 3 marked as highlight, plus a note that this is a pre-release on the test environment); the top-level `version` follows. Beta 1 and beta 2 are **not** backfilled — the history jumps from 2.6.0 to 3.0.0-beta.3.
- **Pre-release versions in the data test:** `test/updatesData.test.js` accepts version strings with a pre-release suffix (`3.0.0-beta.3`) in its format check and ordering.
- **Versioning documented:** the wiki node `docs/wiki/ops/deployment.md` gains the section "Versions and pre-releases" (version sources, git tag, image tags) that was written for the beta 1 jump but never landed in `main`.
- **Release mechanics:** git tag `3.0.0-beta.3` (no `v`), Docker image with the tags `3.0.0-beta.3`, the moving tag `beta` and the commit sha — never `latest`; deployed on the test environment only (prioplan decision 6).

## Capabilities

### New Capabilities
- `release-versioning`: where the DEMS version lives, what a version jump changes, and how a pre-release is tagged and deployed.

### Modified Capabilities
- `whats-new`: the requirement "Release notes cover every version" changes — the newest release is a pre-release (`3.0.0-beta.3`), and pre-release version identifiers are valid versions everywhere the app reads one.

## Impact

- Files: `package.json`, `package-lock.json`, `updates.json`, `test/updatesData.test.js` (RED first), `docs/wiki/ops/deployment.md`, `docs/wiki/graph.json` (via `npm run wiki`).
- No application code changes: `server.js` (`GET /api/updates`), `public/js/core/updates.js`, `update-effects.js` (`3.0.0-beta.3` → confetti, already covered) and the e2e helpers read the version dynamically; `test/newsFlow.test.js` brings its own fixture versions.
- No new dependencies, no new env variables, the bot is not touched.
- Wiki nodes: `docs/wiki/ops/deployment.md`.
- No F/D/W ticket; this is the version jump of the beta series in `docs/superpowers/plans/2026-10-07-dems-3.0-prioplan.md` (R-05 does the same for the final 3.0.0).