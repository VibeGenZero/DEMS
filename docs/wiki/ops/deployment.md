---
id: deployment
title: Deployment — VPS with Docker (Hostinger + Traefik example)
type: ops
tags: [deployment, vps, hostinger, traefik, https, docker-hub, production]
sources: [compose.yaml, Dockerfile, server.js]
depends_on: [docker, configuration]
see_also: [security, known-issues]
---
# Deployment — VPS with Docker (Hostinger + Traefik example)

> TL;DR: Run the private image `moritakahashi/dems` (or build from source) with a compose file that passes `.env` into the container (`env_file`), keeps SQLite on a volume and sits behind a TLS reverse proxy. On a Hostinger VPS the Docker Manager stores projects under `/docker/<project>/` and Traefik routes `*.hstgr.cloud` hosts via container labels. One SemVer version lives in package, news and git tag; pre-release images carry the moving tag `beta`, live releases `latest`.

## Requirements

- HTTPS in front of DEMS (Traefik, Caddy, PaaS) — plain `http://<ip>:3000` breaks the SPA (CSP `upgrade-insecure-requests`, see [security](../concepts/security.md)).
- Persistent storage: Docker volume for SQLite, or Firebase.
- Discord developer portal: redirect `https://<host>/auth/discord/callback`, Server Members Intent enabled.
- Bot invited with the URL it logs on startup ("Bot Invite URL"); a bot invited before 2.7 lacks Connect and CreateEvents — re-invite or add them to the bot role.
- `.env` with at least `SESSION_SECRET`, `BASE_URL=https://<host>`, Discord values ([configuration](configuration.md)).

## Hostinger VPS (Docker Manager + Traefik)

Project folder `/docker/dems/` contains `docker-compose.yml` and the `.env` written by the Docker Manager UI. The host below is the project's example VPS (`srv1657105`); use the host Hostinger assigns to yours.

```yaml
services:
  dems:
    image: moritakahashi/dems:latest
    container_name: dems
    restart: unless-stopped
    init: true
    env_file:
      - .env
    environment:
      - NODE_ENV=production
      - PORT=3000
      - SQLITE_PATH=/app/data/dems.sqlite
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

volumes:
  dems-data:
```

Hostinger's own templates use `${COMPOSE_PROJECT_NAME}.${TRAEFIK_HOST}` for the host rule; a fixed host works as well. Pulling the private image needs `docker login` on the VPS (read-only access token).

## Update / operate

```bash
cd /docker/dems && docker compose pull && docker compose up -d --force-recreate
docker compose logs -f
docker inspect dems --format '{{range .Config.Env}}{{println .}}{{end}}' | cut -d= -f1   # which variables arrived (names only)
docker run --rm -v dems_dems-data:/data -v $PWD:/backup alpine tar czf /backup/dems-backup.tgz -C /data .   # backup
```

## Versions and pre-releases

The version is one SemVer string in three places: `package.json`, `package-lock.json` and `updates.json` (the news dialog shows it). Bump it with `npm version <version> --no-git-tag-version`, then write the matching release entry in `updates.json`. The git tag of a release carries the same text without a leading `v` (e.g. `3.0.0-beta.3`); a build number is not part of the version — an image's commit sha tag identifies the build (a `+build` suffix is no valid image tag).

Pre-releases are the beta series towards 3.0 (`3.0.0-beta.1`, `3.0.0-beta.2`, …) and the release candidate (`3.0.0-rc.1`). They run on the test environment only; the live system receives the final releases (prioplan decision 6).

Published image: the private Docker Hub repository `moritakahashi/dems`. `latest` is the live release; a pre-release image gets its version tag and the moving tag `beta`, never `latest`; every image also carries its commit sha.

Ordering note: `test/updatesData.test.js` compares the numeric major.minor.patch prefix only, which orders one pre-release above the older history. Once a second pre-release of the same version enters the history (e.g. `3.0.0-beta.3` and `3.0.0-beta.4`), that test needs a suffix ordering rule.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| restart loop "SESSION_SECRET ist nicht gesetzt" | compose file has no `env_file:` → `.env` values never reach the container | add `env_file: [.env]`, `--force-recreate` |
| SPA stuck on "Initialisiere System..." | page served via plain HTTP on a non-localhost host | use the HTTPS host |
| back on the login page right after the Discord login | `NODE_ENV=production` makes the cookies `Secure`, but the request reached DEMS via plain HTTP (no TLS proxy, or no `X-Forwarded-Proto`) | open the HTTPS host; the production image is not meant for plain-HTTP tests (use `compose.dev.yaml`) |
| everyone logged out after deploy | `SESSION_SECRET` changed (cookies signed with the old secret no longer match) or the `sessions` collection was wiped | keep `SESSION_SECRET` stable across deploys |
| Traefik 404 | labels not applied / host not resolving | check labels, DNS, `docker ps` networks |
| wrong client IPs in rate limits | more than one proxy hop | `trust proxy` is set to 1 in `server.js` |
