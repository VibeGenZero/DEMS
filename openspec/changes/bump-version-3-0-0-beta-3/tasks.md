# Tasks

## 1. Tests first (RED)

- [x] 1.1 Extend `test/updatesData.test.js`: version regex accepts an optional pre-release suffix (`3.0.0-beta.3`), `newer()` compares the numeric major.minor.patch prefix (no `NaN`), the history 1.1.0–2.6.0 stays present with 2.7.0 absent, and the newest release is pinned to `3.0.0-beta.3` with `data.version === '3.0.0-beta.3'`; verify `node --test test/updatesData.test.js` fails on the current files
- [x] 1.2 Add a case to `test/updateEffects.test.js` that `updateEffectKind('3.0.0-beta.3')` returns `confetti`; verify it fails before the version bump is visible to the test data (it reads no fixture, so confirm with `node --test test/updateEffects.test.js` after 2.2 at the latest)

## 2. Version jump and release notes

- [x] 2.1 Run `npm version 3.0.0-beta.3 --no-git-tag-version` and verify `package.json` and both `package-lock.json` places show `3.0.0-beta.3`
- [x] 2.2 Prepend the release entry `3.0.0-beta.3` to `updates.json` (release day as `YYYY-MM-DD`, top-level `version` too): the pre-release notice ("Vorabversion auf der Test-Umgebung", normal entry) plus four German feature entries — Auswertungen für Admins (W-14), Mitgliederübersicht (W-15), Nachricht an alle Teilnehmer (W-09), überarbeitete Neuigkeiten mit Popup und „Was ist neu"-Seite (D-13) — with `highlight: true` on exactly three feature entries; verify 1.1 and 1.2 pass
- [x] 2.3 Verify no other test pins the old version: `node --test test/newsFlow.test.js test/startup.test.js test/navLinks.test.js` stays green (they bring their own fixture versions) and `git grep "2.6.0" -- package.json package-lock.json updates.json` finds nothing

## 3. Wiki

- [x] 3.1 Add the section „Versions and pre-releases" to `docs/wiki/ops/deployment.md` (from the beta 1 stash, adapted): version is the same SemVer string in `package.json`, `package-lock.json` (`npm version <version> --no-git-tag-version`) and `updates.json`, git tag without `v`, image tags version + moving `beta` + commit sha, `latest` only for live releases, pre-releases on the test environment only, and the note that two pre-releases of the same version need a suffix ordering rule once a second beta entry exists; update the TL;DR if needed and run `npm run wiki`; verify `node --test test/wiki.test.js` passes

## 4. Release mechanics

- [ ] 4.1 Create the branch `chore/3.0.0-beta.3` off `main`, merge it into `main` via MR and verify the CI pipeline (test + docker-build health check) is green
- [ ] 4.2 Tag the merge commit `3.0.0-beta.3` (no `v`) and verify the tag pipeline runs green
- [ ] 4.3 Note the sha of the currently deployed beta 2 image, build and push the new image with the tags `3.0.0-beta.3`, `beta` and its commit sha (never `latest`), pull it on the test environment and verify `/api/updates` there answers with `version: "3.0.0-beta.3"` and the popup opens once after login with the three highlighted features

## 5. Final verification

- [x] 5.1 Run `npm test` and verify everything is green
- [x] 5.2 Run `npm run test:e2e` (the news popup and the „Was ist neu" page run against the new version) and verify the updates and news flows pass