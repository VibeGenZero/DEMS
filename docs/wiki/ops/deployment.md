---
id: deployment
title: Deployment — VPS with Docker (Hostinger + Traefik example)
type: ops
tags: [deployment, vps, hostinger, traefik, https, docker-hub, production]
sources: [compose.yaml, compose.build.yaml, Dockerfile, server.js, public/js/pages/discord-guide.js]
depends_on: [docker, configuration]
see_also: [security, known-issues]
---
# Deployment — VPS with Docker (Hostinger + Traefik example)

> TL;DR: Run the public image `moritakahashi/dems` (or build from source with `compose.build.yaml`) with a compose file that passes an optional `.env` into the container (`env_file`; without one DEMS starts its setup wizard, #138), runs PostgreSQL next to DEMS (password generated on the first start) and sits behind a TLS reverse proxy. On a Hostinger VPS the Docker Manager stores projects under `/docker/<project>/` and Traefik routes `*.hstgr.cloud` hosts via container labels. One SemVer version lives in package, news and git tag; pre-release images carry the moving tag `beta`, live releases `latest`.

## Requirements

- HTTPS in front of DEMS (Traefik, Caddy, PaaS) — plain `http://<ip>:3000` breaks the SPA (CSP `upgrade-insecure-requests`, see [security](../concepts/security.md)).
- Persistent storage: PostgreSQL with its data on a volume (production refuses to start without it), plus `/app/data` on a volume for uploaded banners (`UPLOAD_DIR`, default `/app/data/uploads`).
- Discord developer portal: redirect `https://<host>/auth/discord/callback`, Server Members Intent enabled.
- Bot invited with the URL it logs on startup ("Bot Invite URL"); a bot invited before 2.7 lacks Connect and CreateEvents — re-invite or add them to the bot role.
- Either a `.env` with `BASE_URL=https://<host>` and the Discord values ([configuration](configuration.md)), or no Discord values at all: DEMS then starts in setup mode (#138). Open `https://<host>`, enter the setup PIN from the log (`docker compose logs dems`, line `Setup-PIN: …`) and fill in the wizard; it stores the values in the database ([security](../concepts/security.md#first-run-setup-138)). The wizard needs HTTPS like the login (Secure session cookie in production): set up the TLS proxy first.

## Discord-Anwendung anlegen

The setup wizard shows this guide in its Discord step, the admin "System" view in a dialog; the texts live in `public/js/pages/discord-guide.js` (keep both in step). The portal labels are those of the English Developer Portal.

1. **Anwendung anlegen** — [Discord Developer Portal](https://discord.com/developers/applications) → „New Application“ → name (also the bot's name) → accept the terms → „Create“.
2. **OAuth2** — copy the „Client ID“; „Reset Secret“ and copy the client secret at once (shown only once); under „Redirects“ „Add Redirect“ with exactly `<BASE_URL>/auth/discord/callback` → „Save Changes“. A different address makes every login fail.
3. **Bot** — „Reset Token“ and copy the token (shown once, never share it); under „Privileged Gateway Intents“ switch on „Server Members Intent“ (required: without it Discord refuses the login with "Used disallowed intents"); „Message Content Intent“ only for the comment sync (`DISCORD_THREAD_SYNC`); switch „Public Bot“ off (recommended) → „Save Changes“.
4. **Bot einladen** — open the invite link (the wizard builds it from the client id with every permission DEMS needs; the start log prints it too), pick the server (needs „Server verwalten“ there), keep all permissions → „Autorisieren“.
5. **Server-ID** — Discord user settings → „Erweitert“ → „Entwicklermodus“ on → right-click the server icon → „Server-ID kopieren“.

## Hostinger VPS (Docker Manager + Traefik)

Project folder `/docker/dems/` contains `docker-compose.yml` and the `.env` written by the Docker Manager UI. The host below is the project's example VPS (`srv1657105`); use the host Hostinger assigns to yours.

```yaml
services:
  db-secret:
    image: postgres:18-alpine
    restart: "no"
    volumes:
      - dems-secrets:/secrets
    command:
      - sh
      - -c
      - |
        if [ ! -s /secrets/db_password ]; then
          head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n' > /secrets/db_password
        fi
        chmod 0444 /secrets/db_password

  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_DB=dems
      - POSTGRES_USER=dems
      - POSTGRES_PASSWORD_FILE=/run/dems-secrets/db_password
    volumes:
      - dems-pg:/var/lib/postgresql
      - dems-secrets:/run/dems-secrets:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dems -d dems"]
      interval: 5s
      retries: 12
    depends_on:
      db-secret:
        condition: service_completed_successfully

  dems:
    image: moritakahashi/dems:${DEMS_TAG:-latest}   # DEMS_TAG=beta in .env for the test environment
    container_name: dems
    restart: unless-stopped
    init: true
    env_file:
      - .env
    environment:
      - NODE_ENV=production
      - PORT=3000
      - PGHOST=postgres
      - PGDATABASE=dems
      - PGUSER=dems
      - PGPASSWORD_FILE=/run/dems-secrets/db_password
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "3000"
    labels:
      - traefik.enable=true
      - traefik.http.routers.dems.rule=Host(`dems.srv1657105.hstgr.cloud`)
      - traefik.http.routers.dems.entrypoints=websecure
      - traefik.http.routers.dems.tls.certresolver=letsencrypt
      - traefik.http.services.dems.loadbalancer.server.port=3000
    volumes:
      - dems-data:/app/data
      - dems-secrets:/run/dems-secrets:ro

volumes:
  dems-data:
  dems-pg:
  dems-secrets:
```

Traefik labels go on `dems` only; `postgres` publishes no port. Switching an existing 2.x/rc install over: replace the old file with this one, remove `FIREBASE_*` from `.env`, `docker compose up -d` — the database starts empty (3.0 has no Firestore import).

Hostinger's own templates use `${COMPOSE_PROJECT_NAME}.${TRAEFIK_HOST}` for the host rule; a fixed host works as well.

## Update / operate

```bash
cd /docker/dems && docker compose pull && docker compose up -d --force-recreate   # the admin "System" view shows when a newer release exists
docker compose logs -f
docker inspect dems --format '{{range .Config.Env}}{{println .}}{{end}}' | cut -d= -f1   # which variables arrived (names only)
docker compose exec -T postgres pg_dump -U dems dems > dems-db-backup.sql                                    # database backup
docker run --rm -v dems_dems-data:/data -v $PWD:/backup alpine tar czf /backup/dems-uploads.tgz -C /data .   # uploads backup
```

## Versions and pre-releases

The version is one SemVer string in three places: `package.json`, `package-lock.json` and `updates.json` (the news dialog shows it). Bump it with `npm version <version> --no-git-tag-version`, then write the matching release entry in `updates.json`. The git tag of a release carries the same text without a leading `v` (e.g. `3.0.0-beta.3`); a build number is not part of the version — an image's commit sha tag identifies the build (a `+build` suffix is no valid image tag).

Release process: bump the version and write the `updates.json` entry on the release branch → merge to `main` (CI pushes `edge`) → `git tag <version> && git push origin <version>` → the `publish` job checks the tag against the version files, pushes `<version>`, `sha-<7>` and `latest` (or `beta` for a pre-release) and creates the GitHub release from the `updates.json` news ([ci](ci.md)). Installations see the new version in the admin "System" view within 12 hours (`utils/updateCheck.js`); a pre-release install told about a final release is asked to set `DEMS_TAG=latest`.

Pre-releases are the beta series towards 3.0 (`3.0.0-beta.1`, `3.0.0-beta.2`, …) and the release candidate (`3.0.0-rc.1`). They run on the test environment only; the live system receives the final releases (prioplan decision 6).

3.0.0 (2026-11-11) is the first release published by the `publish` job: its news entry sums up the whole 3.0 series for members coming from 2.6.0, because the live system skipped the pre-releases.

Published image: the public Docker Hub repository `moritakahashi/dems` (no `docker login` needed). `latest` is the live release; a pre-release image gets its version tag and the moving tag `beta`, never `latest`; a release image also carries `sha-<7-char commit>`; `edge` (+ `edge-<7>`) follows `main` and is meant for the test environment only. A compose file picks the channel with `DEMS_TAG` (default `latest`).

Ordering note: `test/updatesData.test.js` orders the history like SemVer: a release is newer than its pre-releases, and pre-release parts compare one by one (numbers as numbers, words alphabetically), so `3.0.0-rc.1` > `3.0.0-beta.3` and `3.0.0-beta.10` > `3.0.0-beta.9`. The history keeps every published pre-release.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| the setup wizard appears although `.env` holds the Discord values | compose file has no `env_file:` → `.env` values never reach the container | add `env_file: [{ path: .env, required: false }]`, `--force-recreate`; or finish the wizard instead |
| wizard hangs on the loading screen or the PIN does not stick | opened via plain `http://<ip>` (CSP `upgrade-insecure-requests`, `Secure` session cookie) | set up the TLS proxy and open it via HTTPS; in production `http://localhost` does not work either (the PIN step warns) |
| SPA stuck on "Initialisiere System..." | page served via plain HTTP on a non-localhost host | use the HTTPS host |
| back on the login page right after the Discord login | `NODE_ENV=production` makes the cookies `Secure`, but the request reached DEMS via plain HTTP (no TLS proxy, or no `X-Forwarded-Proto`) | open the HTTPS host; the production image is not meant for plain-HTTP tests (use `compose.dev.yaml`) |
| everyone logged out after deploy | `SESSION_SECRET` changed (cookies signed with the old secret no longer match) or the `sessions` collection was wiped | keep `SESSION_SECRET` stable across deploys |
| Traefik 404 | labels not applied / host not resolving | check labels, DNS, `docker ps` networks |
| wrong client IPs in rate limits | more than one proxy hop | `trust proxy` is set to 1 in `server.js` |
