# Docker publish + update check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CI publishes the DEMS image to Docker Hub (`edge` from `main`, versions + `latest`/`beta` from git tags, plus the GitHub release), operators install from that image, and every installation tells its admins in the "System" view when a newer release exists.

**Architecture:** A small shared SemVer helper feeds two consumers: `scripts/release.js` (tag checks and release notes for the workflow) and `utils/updateCheck.js` (polls the public GitHub Releases API every 12 h, keeps the answer in memory). `routes/adminSystem.js` serves that status, `public/js/admin/system.js` renders a card. `compose.yaml` pulls the image; `compose.build.yaml` is an override that builds from source and is what CI health-checks.

**Tech Stack:** Node ≥ 22 (built-in `fetch`, `AbortSignal.timeout`), Express 5, `node:test`, GitHub Actions with the official Docker actions, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-11-docker-publish-update-check-design.md`

## Global Constraints

- Work on a new branch `feature/docker-publish-update-check` from `origin/main` (worktree); first commit = the spec and this plan.
- No new npm dependencies.
- User-facing text German; code, comments, commits, wiki English. Commit subjects English imperative + why in the body, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- TDD with `node:test` + `node:assert/strict`; helpers from `test/helpers.js`.
- Image name `moritakahashi/dems`; repo `VibeGenZero/DEMS`; tags are the bare version without `v` (`3.0.0`, `3.0.0-rc.2`).
- Tag rules: `main` → `edge` + `sha-<7-char sha>`; tag `X` → `X` + `sha-<7>` + (`latest` if `X` has no `-`, else `beta`). Never `latest` and `beta` together, never `latest`/`beta` from `main`.
- Update check: `GET https://api.github.com/repos/<repo>/releases?per_page=30`, headers `Accept: application/vnd.github+json`, `User-Agent: DEMS-update-check`, timeout 5000 ms, first run 30 s after start, then every 12 h, timers `unref()`'d. Nothing about the installation in the request.
- Env: `UPDATE_CHECK` (`false` = off, default on), `UPDATE_CHECK_REPO` (default `VibeGenZero/DEMS`), `DEMS_TAG` (compose only, default `latest`). Image-baked: `DEMS_CHANNEL` (`edge`|`beta`|`latest`|empty), `DEMS_COMMIT` (full sha|empty). Document each in `.env.example` (German comments) and `docs/wiki/ops/configuration.md`.
- Frontend: no inline styles/handlers, `escapeHtml` on every interpolated value, existing components (`glass-card system-card`, `chip`, `btn`), Bootstrap icons, no emoji, tokens only if CSS is needed at all.
- Every task that changes behaviour a wiki node describes updates that node and runs `npm run wiki`; every task ends with `npm test` green.

## Review Focus

1. GitHub answers 403 (rate limit), 5xx, non-JSON, a non-array, or times out → status keeps the last good answer, one `console.warn`, no crash, no unhandled rejection. (Task 3 tests.)
2. Release list contains drafts, `v`-prefixed tags, non-SemVer tags (`latest`, `nightly`), older versions → drafts and non-SemVer ignored, `v` stripped, only versions above the running one count. (Task 3 tests.)
3. `html_url` in the API answer is not `https://github.com/...` (or a `javascript:` URL) → `releaseUrl` is `null` and the card renders no link; all values escaped in the card. (Task 3 + Task 5 tests.)
4. Test suites that spawn `server.js` never reach GitHub → `cleanEnv` defaults `UPDATE_CHECK=false`. (Task 4 test.)
5. A tag whose version differs from `package.json`, `package-lock.json` or `updates.json`, or `updates.json` without a release entry for it → `scripts/release.js check` exits 1 naming each mismatch, before any push. (Task 2 tests.)

---

### Task 1: Shared SemVer helper

**Files:**
- Create: `utils/semver.js`
- Create: `test/semver.test.js`
- Modify: `test/updatesData.test.js:9-42` (drop the local `split`/`compareParts`/`newer`, use the helper)
- Modify: `docs/wiki/modules/utils.md` (one line for `semver.js`), `docs/wiki/index.md` file → node table

**Interfaces:**
- Produces:
  - `parseVersion(version: string) -> { core: [number, number, number], pre: string[] } | null` — accepts an optional leading `v`; `null` for anything not `MAJOR.MINOR.PATCH(-pre)?`.
  - `compareVersions(a: string, b: string) -> number` — negative/0/positive; same order as the current test (release > its pre-releases; pre parts one by one, numeric numerically, numeric < word, words alphabetically, shorter prefix older). Throws `TypeError` on an unparsable version.
  - `isPrerelease(version: string) -> boolean`.

- [ ] **Step 1: Write the failing test** `test/semver.test.js`: move the six assertions of `'versions order like SemVer, pre-releases included'` there as `compareVersions(a, b) > 0` / `<= 0`; add `parseVersion('v3.0.0')` deep-equals `{ core: [3, 0, 0], pre: [] }`, `parseVersion('latest') === null`, `parseVersion('3.0') === null`, `isPrerelease('3.0.0-rc.1') === true`, `isPrerelease('3.0.0') === false`, `compareVersions('3.0.0-rc.1', '3.0.0-rc.1') === 0`, `compareVersions('3.0.0-beta', '3.0.0-beta.1') < 0`.
- [ ] **Step 2: Run** `node --test test/semver.test.js` → FAIL (`Cannot find module '../utils/semver'`).
- [ ] **Step 3: Implement** `utils/semver.js` (CommonJS, JSDoc like the other utils) and switch `test/updatesData.test.js` to `compareVersions(prev, next) > 0`.
- [ ] **Step 4: Run** `node --test test/semver.test.js test/updatesData.test.js` → PASS.
- [ ] **Step 5: Wiki + full suite:** update `utils.md` and the index table, `npm run wiki`, `npm test` → PASS.
- [ ] **Step 6: Commit** `Add a shared SemVer helper` (body: the update check and the release script need the order the news test already used).

### Task 2: Release script for the workflow

**Files:**
- Create: `scripts/release.js`
- Create: `test/releaseScript.test.js`

**Interfaces:**
- Consumes: `parseVersion`, `isPrerelease` from `utils/semver.js`.
- Produces (exported, plus a CLI):
  - `checkRelease({ tag: string, pkg: object, lock: object, updates: object }) -> string[]` — empty when fine; otherwise one English message per problem (CI log, not user-facing): tag not matching `/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/` (a `v` prefix counts as wrong, message contains `not a version`); `pkg.version`, `lock.version`, `lock.packages[''].version`, `updates.version` each ≠ tag (message names the file and both values); no `updates.releases[]` entry with `version === tag`.
  - `releaseNotes({ updates: object, version: string, image: string }) -> string` — Markdown: for each `news` entry of that release `### <title>` + blank line + `<content>`; then a section `### Docker` with `docker pull <image>:<version>` and the moving tag (`latest` or `beta`).
  - `channelOf(version: string) -> 'latest' | 'beta'`.
  - CLI: `node scripts/release.js check <tag>` (reads the three files from the repo root, prints problems to stderr, exit 1 if any; exit 0 silently otherwise), `node scripts/release.js notes <tag>` (prints notes to stdout), `node scripts/release.js channel <tag>` (prints `latest`/`beta`).

- [ ] **Step 1: Write the failing tests** in `test/releaseScript.test.js` with small inline fixtures:
  - `checkRelease` returns `[]` for tag `3.0.0` when all four versions are `3.0.0` and a release `3.0.0` exists.
  - tag `3.0.1` with `pkg.version` `3.0.0` → one message matching `/package\.json.*3\.0\.0.*3\.0\.1/`; lockfile mismatch → message matching `/package-lock\.json/`; missing release entry → message matching `/updates\.json.*3\.0\.1/`; tag `v3.0.0` or `latest` → message matching `/not a version/`.
  - `releaseNotes` for a release with two news entries contains `### <title1>` before `### <title2>`, contains `docker pull moritakahashi/dems:3.0.0-rc.2` and `moritakahashi/dems:beta` for `3.0.0-rc.2`, `:latest` for `3.0.0`.
  - CLI: `runNode` / `spawnSync(process.execPath, ['scripts/release.js', 'check', '0.0.0-nope'])` from the repo root exits 1; `check <current package.json version>` exits 0 (reads the real files, so this pins that they agree today).
- [ ] **Step 2: Run** `node --test test/releaseScript.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement** `scripts/release.js` (`require.main === module` guards the CLI).
- [ ] **Step 4: Run** → PASS; `npm test` → PASS.
- [ ] **Step 5: Commit** `Add a release script for tag checks and release notes` (body: the publish job must refuse a tag that does not match the version files).

### Task 3: Update checker

**Files:**
- Create: `utils/updateCheck.js`
- Create: `test/updateCheck.test.js`
- Modify: `.env.example` (new block "Update-Prüfung": `# UPDATE_CHECK=false` and `# UPDATE_CHECK_REPO=VibeGenZero/DEMS`, German comments: what is sent — only a plain request from the server's IP to GitHub, nothing about the installation — and when to switch it off)
- Modify: `docs/wiki/ops/configuration.md` (both variables), `docs/wiki/modules/utils.md`, `docs/wiki/index.md`

**Interfaces:**
- Consumes: `parseVersion`, `compareVersions`, `isPrerelease`.
- Produces:
  - `selectLatestRelease(releases: Array, current: string) -> { version: string, url: string | null } | null` — ignores non-objects, `draft: true`, tags that do not parse; strips a leading `v` from `tag_name`; if `current` is final, skips pre-releases; returns the highest version strictly above `current`, else `null`. `url` = `html_url` only if it is a string starting with `https://github.com/`, else `null`.
  - `createUpdateChecker({ currentVersion: string, env?: object = process.env, mockMode?: boolean = false, fetchImpl?: Function = fetch, now?: () => Date, log?: { warn: Function } = console }) -> { start(): void, stop(): void, checkNow(): Promise<void>, getStatus(): UpdateStatus }`
  - `UpdateStatus = { enabled: boolean, reason: null | 'disabled' | 'edge' | 'mock' | 'invalid-repo', current: string, latest: string | null, updateAvailable: boolean, switchToLatest: boolean, releaseUrl: string | null, checkedAt: string | null (ISO), channel: string | null, commit: string | null (first 7 chars) }`
    - `enabled === false` when `mockMode`, `env.UPDATE_CHECK === 'false'`, `env.DEMS_CHANNEL === 'edge'`, or `env.UPDATE_CHECK_REPO` not matching `/^[\w.-]+\/[\w.-]+$/` (reason in that priority order); a disabled checker never calls `fetchImpl` and `start()` sets no timer.
    - `switchToLatest` = `updateAvailable && isPrerelease(current) && !isPrerelease(latest)`.
    - `checkedAt` is set only on a successful answer (also when no newer version exists).
  - Module singleton: `startUpdateCheck({ mockMode: boolean }) -> void` (creates the checker with `require('../package.json').version` and starts it), `stopUpdateCheck() -> void`, `getUpdateStatus() -> UpdateStatus` (a disabled-looking status with `reason: null`, `enabled: false` if never started).

- [ ] **Step 1: Write the failing tests** (`fetchImpl` is a stub returning `{ ok, status, json: async () => body }` and recording its calls):
  - `selectLatestRelease`: from `[3.0.0-rc.2, 3.0.0, v3.0.1, latest, draft 3.1.0, 2.6.0]` with current `3.0.0` → `{ version: '3.0.1', ... }`; current `3.0.0-rc.1` with `[3.0.0-rc.2]` → `3.0.0-rc.2`; current `3.0.0` with only `[3.0.1-beta.1]` → `null`; current `3.0.1` → `null`; `html_url: 'javascript:alert(1)'` → `url: null`.
  - checker on current `3.0.0`, answer `[{ tag_name: '3.0.1', html_url: 'https://github.com/VibeGenZero/DEMS/releases/tag/3.0.1' }]` → after `checkNow()`: `updateAvailable: true`, `latest: '3.0.1'`, `checkedAt` = the injected `now()` ISO; the one fetch URL is exactly `https://api.github.com/repos/VibeGenZero/DEMS/releases?per_page=30` and its headers carry `User-Agent: DEMS-update-check`.
  - current `3.0.0-rc.1`, answer `[3.0.0]` → `switchToLatest: true`; answer `[3.0.0-rc.2]` → `switchToLatest: false`.
  - after a good check, a stub answering `{ ok: false, status: 403 }`, then one that throws, then one whose `json()` throws, then `[]`-less `{ message: 'x' }` → status still shows the earlier `latest`/`checkedAt`, `log.warn` called once per failed check, no rejection from `checkNow()`.
  - `{ UPDATE_CHECK: 'false' }` → `enabled: false, reason: 'disabled'`; `{ DEMS_CHANNEL: 'edge', DEMS_COMMIT: 'abcdef1234567' }` → `reason: 'edge', commit: 'abcdef1'`; `mockMode: true` → `reason: 'mock'`; `{ UPDATE_CHECK_REPO: 'a/b/c' }` → `reason: 'invalid-repo'`; in all four `checkNow()` makes no fetch call.
  - `UPDATE_CHECK_REPO: 'someone/fork'` → fetch URL uses `someone/fork`.
- [ ] **Step 2: Run** `node --test test/updateCheck.test.js` → FAIL.
- [ ] **Step 3: Implement** `utils/updateCheck.js`; the request uses `signal: AbortSignal.timeout(5000)`; `start()` schedules `checkNow` after 30 000 ms and then every 12 h (`setTimeout`/`setInterval`, both `unref()`'d); `stop()` clears both.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Docs:** `.env.example`, `configuration.md`, `utils.md`, index table; `npm run wiki`; `npm test` → PASS.
- [ ] **Step 6: Commit** `Check GitHub releases for a newer DEMS version` (body: operators otherwise never learn about updates; anonymous request, no data about the installation).

### Task 4: Wire the check into the server, admin endpoint, image channel

**Files:**
- Modify: `server.js` (`start()` after `startOfferScheduler(...)`: `startUpdateCheck({ mockMode: IS_MOCK_MODE })`; `gracefulShutdown` → `stopUpdateCheck()`)
- Modify: `routes/adminSystem.js` (new `GET /system/update-status`)
- Modify: `test/helpers.js` (`cleanEnv` sets `UPDATE_CHECK: 'false'` before the caller's `env`, so a test can still override)
- Modify: `Dockerfile` runtime stage: `ARG DEMS_CHANNEL=` / `ARG DEMS_COMMIT=` and `ENV DEMS_CHANNEL=$DEMS_CHANNEL DEMS_COMMIT=$DEMS_COMMIT` (after the existing `ENV`, before `COPY`, comment: set by the publish job)
- Test: `test/systemSettings.test.js` (append), a new assertion in an existing helpers test or `test/updateCheck.test.js`
- Modify: `docs/wiki/reference/api-index.md` (GET row), `docs/wiki/modules/routes-admin.md` (row: `/system/update-status` → `getUpdateStatus()`, answers from memory), `docs/wiki/modules/server.md` (scheduler list), `docs/wiki/ops/docker.md` (stage table: the two build args), `docs/wiki/ops/configuration.md` (`DEMS_CHANNEL`, `DEMS_COMMIT` as image-baked)

**Interfaces:**
- Consumes: `startUpdateCheck`, `stopUpdateCheck`, `getUpdateStatus` from Task 3.
- Produces: `GET /api/admin/system/update-status` → `200 UpdateStatus` (admin only through the existing guard); on an exception `500 { error: 'Versionsinfo konnte nicht geladen werden.' }`.

- [ ] **Step 1: Write the failing tests:**
  - `test/systemSettings.test.js`: admin `GET /api/admin/system/update-status` → 200, body `enabled === false`, `reason === 'mock'`, `current` equals `require('../package.json').version`; member → 403.
  - `cleanEnv()` (export it from helpers if not exported) returns `UPDATE_CHECK: 'false'`, and `cleanEnv({ UPDATE_CHECK: 'true' }).UPDATE_CHECK === 'true'`.
- [ ] **Step 2: Run** `node --test test/systemSettings.test.js` → FAIL (404 on the new path).
- [ ] **Step 3: Implement** route (own `try/catch`, no audit log — read only), server wiring, `cleanEnv` default, Dockerfile args.
- [ ] **Step 4: Run** → PASS; `docker build --target runtime --build-arg DEMS_CHANNEL=edge -t dems:chan .` then `docker run --rm dems:chan node -e "console.log(process.env.DEMS_CHANNEL)"` → prints `edge` (skip with a note if Docker is not available locally; CI covers the build).
- [ ] **Step 5: Wiki** nodes listed above, `npm run wiki`, `npm test` → PASS.
- [ ] **Step 6: Commit** `Serve the update status to admins` (body: the System view needs it; tests never reach GitHub).

### Task 5: Version card in the admin "System" view

**Files:**
- Modify: `public/index.html` (inside `#system-section` `.system-grid`, as its first child: `<div class="glass-card system-card" id="system-update-card">` with `<h3 class="system-card-title"><i class="bi bi-arrow-repeat me-2" aria-hidden="true"></i>Version</h3>` and `<div id="system-update-body"></div>`)
- Modify: `public/js/admin/system.js` (`loadUpdateStatus()` called from `showSystemSection()` next to `loadPrivacyEditor()`; renders into `#system-update-body`)
- Modify (only if needed): `public/css/components.css`/`style.css` with tokens only, e.g. for the command line
- Test: `test/systemView.test.js` (append)
- Modify: `docs/wiki/modules/frontend-app.md` (system.js line), `docs/wiki/modules/frontend-markup.md` (if a class is added)

**Interfaces:**
- Consumes: `GET /api/admin/system/update-status` → `UpdateStatus` (Task 3/4).
- Produces: nothing for later tasks.

Exact texts (German, values escaped):

| State | Body |
|---|---|
| `updateAvailable && !switchToLatest` | chip `chip chip-sm chip-info` „Update verfügbar“; „Neue Version **<latest>** verfügbar (installiert: <current>).“; link „Was ist neu?“ (`bi-box-arrow-up-right`, `target="_blank" rel="noopener noreferrer"`) only if `releaseUrl`; command `<code>docker compose pull && docker compose up -d</code>` |
| `switchToLatest` | „Version **<latest>** ist das fertige Release. Diese Installation nutzt eine Vorabversion (<current>) aus dem Kanal „beta“.“; „Setze in der .env `DEMS_TAG=latest` und führe dann `docker compose pull && docker compose up -d` aus.“; link as above |
| enabled, no update, `checkedAt` | „DEMS <current> ist aktuell. Zuletzt geprüft: <checkedAt as de-DE date + time>.“ |
| enabled, `checkedAt === null` | „DEMS <current>. Noch keine Antwort von GitHub.“ |
| `reason === 'disabled'` | „DEMS <current>. Die Update-Prüfung ist ausgeschaltet (UPDATE_CHECK=false).“ |
| `reason === 'edge'` | „Entwicklungsstand (edge, Commit <commit>). Keine Update-Prüfung.“ |
| `reason === 'mock'` | „DEMS <current> im Dev-Mock-Modus. Keine Update-Prüfung.“ |
| `reason === 'invalid-repo'` | „DEMS <current>. UPDATE_CHECK_REPO ist ungültig, die Update-Prüfung ist aus.“ |
| request failed | „Versionsinfo konnte nicht geladen werden.“ (no toast) |

- [ ] **Step 1: Write the failing tests** in `test/systemView.test.js` using `openSystem({ '/api/admin/system/update-status': <status> })`:
  - update available with `releaseUrl` → `system-update-body` innerHTML contains `Neue Version`, `3.0.1`, `href="https://github.com/VibeGenZero/DEMS/releases/tag/3.0.1"`, `rel="noopener noreferrer"`, `docker compose pull &amp;&amp; docker compose up -d`.
  - same with `releaseUrl: null` → no `<a ` in the body.
  - `switchToLatest: true` → contains `DEMS_TAG=latest`.
  - up to date → contains `ist aktuell`; `reason: 'edge', commit: 'abcdef1'` → contains `edge` and `abcdef1`; `reason: 'mock'` → `Dev-Mock-Modus`.
  - `latest: '<img src=x>'` → body contains `&lt;img` and no `<img`.
  - route answering `httpAnswer(500, { error: 'x' })` → body contains `Versionsinfo konnte nicht geladen werden`, and no danger toast recorded for it.
  - the existing tests still pass (the card does not break the settings render when the route is missing → harness 404 → the failure text).
- [ ] **Step 2: Run** `node --test test/systemView.test.js` → FAIL.
- [ ] **Step 3: Implement** markup + `loadUpdateStatus()`/`updateStatusHtml(status)` in `system.js`.
- [ ] **Step 4: Run** → PASS; `npm test` → PASS (includes CSP/inline-style, token, icon and contrast checks).
- [ ] **Step 5: Look at it:** `npm run dev:mock`, log in as `admin`, open `#system` → the card shows the mock line; take a screenshot with the `run` skill if available.
- [ ] **Step 6: Wiki** (`frontend-app.md`, `frontend-markup.md` if touched), `npm run wiki`, `npm test`.
- [ ] **Step 7: Commit** `Show the update status in the admin System view`.

### Task 6: Install from the published image by default

**Files:**
- Modify: `compose.yaml` (`dems`: remove `build:`, `image: moritakahashi/dems:${DEMS_TAG:-latest}`, comment: build from source with `compose.build.yaml`)
- Create: `compose.build.yaml` (override: `services: dems: build: { context: ., target: runtime }`, `image: dems:local`, `pull_policy: build`, header comment with the command)
- Create: `test/composeFiles.test.js`
- Modify: `.github/workflows/ci.yml` `docker-build` job: every `docker compose -f compose.yaml …` becomes `docker compose -f compose.yaml -f compose.build.yaml …` (up, ps, logs)
- Modify: `.gitlab-ci.yml` the same way where it calls compose
- Modify: `README.md` production section (lines ~140-160): install = download `compose.yaml` (`curl -O https://raw.githubusercontent.com/VibeGenZero/DEMS/main/compose.yaml`), optional `.env`, `docker compose up -d`; update = `docker compose pull && docker compose up -d`; pre-releases = `DEMS_TAG=beta` in `.env`; building from source = `docker compose -f compose.yaml -f compose.build.yaml up -d --build` as a short alternative
- Modify: `.env.example` (`# DEMS_TAG=latest` next to `DEMS_PORT`, German comment: `latest` = fertige Releases, `beta` = Vorabversionen)
- Modify: `docs/wiki/ops/docker.md` (compose table row for both files, commands, "Published image" line: public, tags `latest`/`beta`/version/`edge`/`sha-…`; CI line uses the override), `docs/wiki/ops/deployment.md` (TL;DR + "Update / operate" + remove `docker login` sentence: the image is public; Hostinger example image line `moritakahashi/dems:latest` stays), `docs/wiki/ops/configuration.md` (`DEMS_TAG`)

**Interfaces:**
- Consumes: nothing.
- Produces: the CI command `docker compose -f compose.yaml -f compose.build.yaml up --detach --build` that Task 7 leaves in place.

- [ ] **Step 1: Write the failing test** `test/composeFiles.test.js` (plain text checks):
  - `compose.yaml` contains `image: moritakahashi/dems:${DEMS_TAG:-latest}` and no line matching `/^\s+build:/m`.
  - `compose.build.yaml` contains `target: runtime` and `context: .`.
  - `ci.yml` has no `docker compose -f compose.yaml ` that is not followed by `-f compose.build.yaml`.
  - `README.md` contains `docker compose pull && docker compose up -d` and no `git pull && docker compose up -d --build`.
- [ ] **Step 2: Run** `node --test test/composeFiles.test.js` → FAIL.
- [ ] **Step 3: Implement** the file changes above.
- [ ] **Step 4: Verify:** `node --test test/composeFiles.test.js` → PASS; `docker compose -f compose.yaml -f compose.build.yaml config` shows `build` for `dems`, `docker compose -f compose.yaml config` shows `image: moritakahashi/dems:latest` (skip with a note without Docker).
- [ ] **Step 5: Wiki** nodes, `npm run wiki`, `npm test` → PASS.
- [ ] **Step 6: Commit** `Install DEMS from the published image by default` (body: operators need only compose.yaml; CI still tests the image built from the branch via compose.build.yaml).

### Task 7: Publish job

**Files:**
- Modify: `.github/workflows/ci.yml` (workflow-level `env: IMAGE: moritakahashi/dems`; new job `publish`; header comment)
- Create: `test/ciWorkflow.test.js`
- Modify: `docs/wiki/ops/ci.md` (TL;DR, job table row `publish`, tags, secrets and how to create them, skip without secrets, `permissions` note now "only `publish` gets `contents: write`"; sources add `scripts/release.js`), `docs/wiki/ops/deployment.md` ("Versions and pre-releases": release process = bump with `npm version <v> --no-git-tag-version` + entry in `updates.json` → merge to `main` → `git tag <v> && git push origin <v>` → the pipeline pushes the images and creates the GitHub release; `edge` is for the test box only)

**Interfaces:**
- Consumes: `node scripts/release.js check|notes|channel <tag>` (Task 2); Dockerfile build args `DEMS_CHANNEL`, `DEMS_COMMIT` (Task 4).

Job shape (the implementer writes the YAML):
- `needs: [test, docker-build]`; `if: github.event_name == 'push' && (github.ref == 'refs/heads/main' || startsWith(github.ref, 'refs/tags/'))`; `permissions: contents: write`; `timeout-minutes: 30`.
- Step `secrets` (env `DOCKERHUB_TOKEN: ${{ secrets.DOCKERHUB_TOKEN }}`): empty → `echo "::notice::DOCKERHUB_TOKEN fehlt, das Image wird nicht hochgeladen."` and output `ok=false`; every later step `if: steps.secrets.outputs.ok == 'true'`.
- Step `meta`: on a tag run `node scripts/release.js check "$GITHUB_REF_NAME"` (fails the job), channel = `node scripts/release.js channel …`, tags = `$IMAGE:<tag>`, `$IMAGE:sha-<7>`, `$IMAGE:<channel>`; on `main` channel = `edge`, tags = `$IMAGE:edge`, `$IMAGE:sha-<7>`. Outputs `tags` (newline list), `channel`, `version` (`<tag>` or `edge`).
- `docker/setup-qemu-action`, `docker/setup-buildx-action`, `docker/login-action` (username `secrets.DOCKERHUB_USERNAME`, password `secrets.DOCKERHUB_TOKEN`), `docker/build-push-action` with `context: .`, `target: runtime`, `platforms: linux/amd64,linux/arm64`, `push: true`, `tags`, `build-args: DEMS_CHANNEL=<channel>` + `DEMS_COMMIT=${{ github.sha }}`, labels `org.opencontainers.image.source=https://github.com/VibeGenZero/DEMS`, `.revision=${{ github.sha }}`, `.version=<version>`, `.created=<UTC ISO>`, GitHub Actions cache (`cache-from/to: type=gha`). Pin each action to its current major (look up the latest release of each; the repo pins majors like `actions/checkout@v7`).
- Step `release` (tag only, env `GH_TOKEN: ${{ github.token }}`): `gh release view "$TAG"` succeeds → print "release exists, left untouched"; otherwise `node scripts/release.js notes "$TAG" > notes.md` and `gh release create "$TAG" --verify-tag --title "DEMS $TAG" --notes-file notes.md`, plus `--prerelease` when channel is `beta`, `--latest` when `latest`.

- [ ] **Step 1: Write the failing test** `test/ciWorkflow.test.js` (text checks on `ci.yml`):
  - contains `publish:` with `needs: [test, docker-build]` and the exact `if:` line above.
  - top-level `permissions:` block still `contents: read`; the string `contents: write` appears exactly once (inside `publish`).
  - contains `scripts/release.js check`, `platforms: linux/amd64,linux/arm64`, `DEMS_CHANNEL=`, `org.opencontainers.image.source=https://github.com/VibeGenZero/DEMS`, `secrets.DOCKERHUB_TOKEN`, `::notice::`.
  - no line assigns `:latest` or `:beta` literally in the `main` branch path (assert the main-branch tag list text is exactly `edge` + `sha-` — e.g. the line producing main tags matches `/\$IMAGE:edge/` and the file has no `\$IMAGE:latest` literal).
- [ ] **Step 2: Run** `node --test test/ciWorkflow.test.js` → FAIL.
- [ ] **Step 3: Implement** the job.
- [ ] **Step 4: Verify:** `node --test test/ciWorkflow.test.js` → PASS; run `actionlint .github/workflows/ci.yml` if installed (no new dependency for it); otherwise the PR run in Task 8 is the YAML check.
- [ ] **Step 5: Wiki** `ci.md`, `deployment.md`, `npm run wiki`, `npm test` → PASS.
- [ ] **Step 6: Commit** `Publish the Docker image and the GitHub release from CI` (body: tags only move latest/beta; main publishes edge for the test box; forks without secrets skip).

### Task 8: Finish

- [ ] **Step 1:** `npm test` → all suites PASS; `npm run test:e2e` → PASS (System view card is new markup).
- [ ] **Step 2:** Push the branch, open the PR (German title/description: Problem / Ursache / Änderung / Verifikation, ending with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`). The PR run must show `docker-build` green with `compose.build.yaml` and `publish` not running (PR event).
- [ ] **Step 3:** Tell the owner the one-time setup from the spec (Docker Hub public, token, two secrets) and that the first `main` push after merge publishes `edge`; the first tag publishes a release.
