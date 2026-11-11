# Publish the Docker image from CI and tell admins about new versions

## Intent

DEMS is open source now: the GitHub repository `VibeGenZero/DEMS` became public on
2026-11-11, and the Docker Hub image `moritakahashi/dems` goes public too. Other
community operators will self-host it. Two things are missing for that:

1. **Publishing is manual.** `.github/workflows/ci.yml` already builds the image and
   checks its HEALTHCHECK on every push to `main` and on tags, but pushes nothing.
   Images and GitHub releases are made by hand.
2. **Operators do not learn about updates.** An installation has no way to notice
   that a newer DEMS exists. The in-app news dialog (`updates.json`) only shows
   what is new *after* an operator updated.

The owner decided:

- **Release images come from git tags, not from every push.** A push to `main`
  publishes only a moving `edge` image. `latest` (live) and `beta` (pre-releases)
  move only when the owner pushes a git tag such as `3.0.0`. A merge to `main`
  must never change what live installations pull.
- **Admins of each installation see a hint** in the admin "System" view when a newer
  version is out. Members see nothing new.
- The installation finds the newest version through the **public GitHub Releases**
  of the repository (no Docker Hub API, no extra hosted file).

## Goals

### Pipeline

- On a push to `main`, after `test` and `docker-build` are green: push
  `moritakahashi/dems:edge` and `moritakahashi/dems:sha-<short sha>`.
- On a git tag, after `test` and `docker-build` are green:
  - Check first that the tag equals `version` in `package.json` **and** in
    `updates.json`, and that `updates.json` has a release entry for that version.
    Any mismatch fails the job before anything is pushed, with a message that names
    the mismatch.
  - Push `<version>` and `sha-<short sha>`, plus `latest` for a final release
    (no `-` in the version) or `beta` for a pre-release (`3.0.0-rc.2`,
    `3.0.0-beta.4`). Never both.
  - Create the GitHub release for the tag if none exists: release notes are the
    `news` entries of that version in `updates.json` (title as a heading, content
    as text), plus the pull commands for the image. Pre-releases are marked as
    pre-release. An existing release (made by hand) stays untouched.
- Every image carries the OCI labels `org.opencontainers.image.source`
  (`https://github.com/VibeGenZero/DEMS`), `.revision` (commit sha), `.version`
  (the version, or `edge`) and `.created`, so `docker inspect` and Docker Hub show
  where an image came from.
- Login uses the repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`
  (a Docker Hub personal access token with Read & Write on `moritakahashi/dems`).

### Install from the published image by default

The owner decided: operators install from Docker Hub, not from source.

- `compose.yaml` pulls `moritakahashi/dems:latest` (no `build:`). An operator needs
  only `compose.yaml` (and optionally `.env`), no git checkout. Update:
  `docker compose pull && docker compose up -d`. This is also the command the
  admin card shows.
- Building from source moves to a second file (e.g. `compose.build.yaml`, an
  override or a full copy, builder's choice) that keeps today's
  `build: { context: ., target: runtime }`. The CI `docker-build` health check uses
  it, so a PR still tests the image built from its own code, not the published one.
- README: install and update steps rewritten for the image (download
  `compose.yaml`, `docker compose up -d`); building from source stays as a short
  alternative. `docs/wiki/ops/docker.md` and `deployment.md` follow.
- `compose.dev.yaml` (mock mode) does not change.

### Update check in the server

- The server asks `GET https://api.github.com/repos/<repo>/releases` (anonymous,
  public repo) shortly after start and then every 12 hours, and remembers the
  answer in memory.
- It picks the highest version above the running one (`version` from
  `package.json`) by SemVer order, ignoring drafts:
  - an installation on a final release considers only final releases;
  - an installation on a pre-release also considers newer pre-releases (a test
    environment on `3.0.0-rc.1` hears about `3.0.0-rc.2` and `3.0.0`).
- A failed or slow request (timeout ~5 s, GitHub down, rate limit, invalid JSON,
  tags that are no SemVer) changes nothing visible: the last good answer stays,
  the error goes to the log once per failure, never as a stack trace loop.
- New admin endpoint (behind the existing admin guard) returns the current state,
  e.g. `{ enabled, current, latest, updateAvailable, releaseUrl, checkedAt }`.
  It answers from memory and never waits for GitHub.
- Operators can switch the check off with an environment variable (it is the only
  outgoing request DEMS makes on its own besides Discord).

### Admin hint

- The admin "System" view (`#system`, `public/js/admin/system.js`) shows a card:
  - update available: „Neue Version <latest> verfügbar (installiert: <current>)“,
    a link „Was ist neu?“ to the GitHub release, and the update command
    `docker compose pull && docker compose up -d`;
  - up to date: „DEMS <current> ist aktuell“ with the time of the last check;
  - switched off or never answered: a short neutral line, no warning colours.
- German texts, existing components and tokens only, Bootstrap icons, no emoji.

## Non-goals

- Updating installations automatically (Watchtower or similar).
- Announcing releases in Discord (webhook) or to members in the app.
- Docker Hub "Automated Builds" or syncing the Docker Hub description from the
  README.
- Changing the in-app news dialog or the `updates.json` format.
- The GitLab pipeline (`.gitlab-ci.yml`) — it keeps building without pushing.

## Anti-goals (a failure even if it technically works)

- A plain push to `main` moves `latest` or `beta`.
- A tag whose version does not match `package.json`/`updates.json` reaches Docker
  Hub.
- The update check slows down or breaks startup, the admin page or the tests
  when GitHub is unreachable.
- The update check sends anything about the installation (server name, guild,
  users, version in a query string). GitHub sees only a plain request from the
  server's IP with a generic `User-Agent` (GitHub requires one).
- Secrets show up in logs, or a fork's run fails red only because it has no
  Docker Hub secrets.

## Constraints

- Follow `CLAUDE.md`: German user-facing text, English code/comments/wiki, TDD with
  `node:test`, no new npm dependencies (Node 22+ has `fetch`), new env variables in
  `.env.example` (German comments) and `docs/wiki/ops/configuration.md`, wiki nodes
  updated in the same commit and `npm run wiki`.
- Tag format stays as today: the bare version without a leading `v`
  (`3.0.0-rc.1`), see `docs/wiki/ops/deployment.md` → "Versions and pre-releases".
- The workflow keeps `permissions: contents: read` at the top; only the publish job
  gets `contents: write` (for the release).
- `npm test` and the server tests must never reach GitHub: the check is off or
  pointed at a local fake in tests, and off in dev mock mode.

## Builder's calls (decided by Claude, open to change)

- **One publish job** in `.github/workflows/ci.yml` (`needs: [test, docker-build]`,
  only on `push` events to `main` or tags) using the official Docker actions
  (`docker/login-action`, `docker/setup-buildx-action`, `docker/build-push-action`,
  `docker/metadata-action` optional), pinned like the existing actions.
- **Platforms `linux/amd64` and `linux/arm64`** (QEMU), so self-hosters on ARM
  servers can pull it; better-sqlite3 has prebuilds for both. If the arm64 build
  turns out far too slow, drop to amd64 and note it in the wiki.
- **Missing secrets → skip, not fail**: the job checks for `DOCKERHUB_TOKEN` and
  ends green with a notice when it is empty (forks, misconfiguration).
- Image name as a workflow-level `env` (`IMAGE: moritakahashi/dems`).
- The `concurrency` group stays; a newer `main` push may cancel an older `edge`
  publish.
- Env variables: `UPDATE_CHECK=false` switches the check off (default on);
  `UPDATE_CHECK_REPO` (default `VibeGenZero/DEMS`) lets forks point at their own
  releases. Tests may need one more knob for a local fake API base URL — the
  builder decides the shape.
- The SemVer comparison that `test/updatesData.test.js` uses today moves into a
  small shared helper (e.g. `utils/semver.js`) used by the test and the check.
- Module e.g. `utils/updateCheck.js` with an injectable `fetch` and clock for unit
  tests; started/stopped from `server.js` next to the other schedulers (timer
  `unref`'d, stopped on shutdown).
- **Pre-release installation, final release out:** `beta` never moves to a final
  release, so `docker compose pull` on a `:beta` installation would not bring it.
  When a pre-release installation sees a newer *final* release, the card says so
  and tells the admin to switch the image tag from `beta` to `latest`. A newer
  pre-release keeps the normal text.
- **`edge` images know they are `edge`:** the publish job passes build args that the
  Dockerfile bakes into the runtime image as env (e.g. `DEMS_CHANNEL=edge`,
  `DEMS_COMMIT=<sha>`). On `edge` the update check is off (its `package.json`
  version is stale between releases) and the card shows a neutral line
  „Entwicklungsstand (edge, Commit <short sha>)“. `edge` is meant for the owner's
  test box, not for operators.
- On a tag the version check also covers `package-lock.json`. "Pre-release" is
  judged from the version string (contains `-`), not from GitHub's `prerelease`
  flag. Tag pushes rebuild the image (no re-tagging of the `main` image). The
  existing `3.0.0-rc.1` release stays as it is.
- `UPDATE_CHECK` is an env variable only, not a setting in the System view.

## Wiki and docs to update

- `docs/wiki/ops/ci.md` — the publish job, tags, secrets, how to set them up.
- `docs/wiki/ops/deployment.md` — image is public (no `docker login` on the VPS),
  release process: bump version + `updates.json` → merge → push tag → pipeline
  pushes images and creates the release.
- `docs/wiki/ops/docker.md` — `compose.yaml` pulls the image, the build file builds
  from source; `README.md` install/update steps.
- `docs/wiki/ops/configuration.md` + `.env.example` — the new variables.
- Admin API and frontend nodes for the new endpoint and card
  (`docs/wiki/reference/api-index.md`, `modules/routes-admin.md` or `server.md`,
  `modules/frontend-app.md`), then `npm run wiki`.

## Owner's one-time setup (outside the code)

1. Docker Hub → `moritakahashi/dems` → Settings → Visibility → public.
2. Docker Hub → Account settings → Personal access tokens → token with Read & Write,
   scoped to `moritakahashi/dems`.
3. GitHub → `VibeGenZero/DEMS` → Settings → Secrets and variables → Actions →
   secrets `DOCKERHUB_USERNAME` (`moritakahashi`) and `DOCKERHUB_TOKEN`.
