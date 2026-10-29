---
id: ci
title: CI — GitHub Actions, GitLab pipeline and runner
type: ops
tags: [ci, github-actions, gitlab, pipeline, runner, docker-in-docker, auto-devops]
sources: [.github/workflows/ci.yml, .gitlab-ci.yml, ci/runner/compose.yaml, ci/runner/config.toml.example]
depends_on: [testing, docker]
see_also: [deployment]
---
# CI — GitHub Actions, GitLab pipeline and runner

> TL;DR: The repository lives on GitHub (`VibeGenZero/DEMS`, private) since 2026-10-29. `.github/workflows/ci.yml` runs `npm ci` + `npm test` on pushes to `main`, tags, every PR and manual runs; its `docker-build` job builds the `runtime` and `dev` images and waits for the runtime HEALTHCHECK — always on `main`, tags and manual runs, in PRs only when Docker or package files change. The older GitLab setup does the same with `.gitlab-ci.yml` on a self-hosted GitLab Runner (`ci/runner/`): an unprivileged runner for tests and a privileged Docker-in-Docker runner for jobs tagged `docker`.

## GitHub Actions (`.github/workflows/ci.yml`)

| Job | Runs | What it does |
|---|---|---|
| `test` | every run | `ubuntu-latest` (ships python3, make, g++ for npm's implicit `node-gyp rebuild` of better-sqlite3), `actions/setup-node` with Node 24 and the npm cache keyed on `package-lock.json`, `npm ci`, `npm test` (includes the wiki validation; `npm run test:e2e` does not run in CI) |
| `docker-build` | always on `main`, tags, manual runs; in PRs only when `Dockerfile`, `.dockerignore`, `package*.json` or `compose*.yaml` change | the runner's own Docker (no dind needed); builds `--target runtime` and `--target dev`, starts the runtime image with a dummy `SESSION_SECRET` and polls `docker inspect` until the HEALTHCHECK reports `healthy` (about 2 minutes at most). Nothing is pushed. |

- Triggers: `push` to `main` and tags, `pull_request`, `workflow_dispatch` (Actions tab → CI → *Run workflow*). A branch without a PR gets no run, like a GitLab branch with an open MR gets no branch pipeline.
- `concurrency` cancels the older run of the same PR or ref when a new commit arrives.
- The PR file check in `docker-build` diffs against `origin/<base>`, so its checkout uses `fetch-depth: 0`. A skipped image build shows up as green steps marked *skipped*.
- `permissions: contents: read` — the workflow needs no write access.
- Runs use GitHub-hosted minutes of the org (private repo).

The sections below describe the GitLab pipeline, which still runs as long as the GitLab project exists.

## Pipeline (`.gitlab-ci.yml`)

| Job | Stage | Runs | What it does |
|---|---|---|---|
| `test` | test | every pipeline | `node:24-bookworm` (full image: python3, make, g++ for npm's implicit `node-gyp rebuild` of better-sqlite3), npm cache keyed on `package-lock.json`, `npm ci`, `npm test` (includes the wiki validation; the Playwright browser tests `npm run test:e2e` do not run in CI) |
| `docker-build` | build | tags, `main`, MRs that change `Dockerfile`, `.dockerignore`, `package*.json` or `compose*.yaml` | `docker:29` with the `docker:29-dind` service; builds `--target runtime` and `--target dev`, starts the runtime image with a dummy `SESSION_SECRET` and polls `docker inspect` until the HEALTHCHECK reports `healthy` (about 2 minutes at most). Nothing is pushed. |

- `workflow:rules`: MR pipelines, tags and the default branch always; a branch pipeline only when the branch has no open MR, so there are no duplicate pipelines.
- All jobs are `interruptible`, and `auto_cancel: on_new_commit: interruptible` cancels older pipelines of the same ref.

## Runner (`ci/runner/`)

- One `gitlab/gitlab-runner` container (`compose.yaml`, version pinned to the GitLab version) with the host Docker socket. Only the runner manager uses the socket, to start job containers; jobs never see it.
- Two runners in `config/config.toml`. Template: `config.toml.example`; the real file holds the runner tokens and is git-ignored.

| Runner | Settings in GitLab | Docker executor |
|---|---|---|
| `dems-ci` | instance runner, no tags, runs untagged jobs | `privileged = false` — `npm ci` runs third-party install scripts, which must not reach the host |
| `dems-docker` | instance runner, tag `docker`, does not run untagged jobs | `privileged = true`, volume `/certs/client` for the dind TLS certificates |

- `concurrent = 1`, because GitLab and the live DEMS share the host. Raise it in `config.toml` and restart the container if the host has room.

## Set up or rotate a runner

1. GitLab → Admin → CI/CD → Runners → *New instance runner* (or `POST /user/runners`), once per row of the table above; note each `glrt-…` token.
2. On the GitLab host: copy `ci/runner/compose.yaml` into a directory, create `config/config.toml` there from the example with both tokens, run `docker compose up -d`.
3. Check: Admin → CI/CD → Runners shows both runners online; `docker logs gitlab-runner` shows no errors.

Auto DevOps is switched off in the project settings. With it on, a branch without `.gitlab-ci.yml` would start the Auto DevOps jobs again.

## Gotchas

- Without an online runner every job stays *pending* forever. That was the original "pipelines just stop" problem: no runner was registered on the instance at all.
- Keep `test` untagged and `dems-docker` on "tagged jobs only", otherwise tests could land on the privileged runner.
- `changes:` in a branch pipeline (no MR) compares with the previous push; on the first push of a new branch it is always true, so `docker-build` runs.
- The npm cache lives inside the checkout (`.npm/`, including npm's debug logs with the build path `/builds/<group>/<project>/`) and is restored from the CI cache. Tests that scan files must use `git ls-files`, not a directory walk, or they see that cache.
