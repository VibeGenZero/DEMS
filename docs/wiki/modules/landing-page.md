---
id: landing-page
title: landing/ — local marketing page (git-ignored)
type: module
tags: [landing, marketing, static-site, screenshots, gitignore]
sources: [.gitignore, docs/superpowers/specs/2026-11-08-landing-page-design.md]
see_also: [directory-map]
---
# landing/ — local marketing page (git-ignored)

> TL;DR: `landing/` holds the DEMS landing page for operators of large Discord servers. Since 2026-11-08 it is **git-ignored** and lives only on the maintainer's machine; the repository keeps just the spec (`docs/superpowers/specs/2026-11-08-landing-page-design.md`). It is NOT served by `server.js` and is excluded from the Docker image. Ignore it for app work.

## What is in the folder (locally)

| Path | Content |
|---|---|
| `landing/index.html`, `css/`, `js/` | static page: hero (the name collapses into the Space Grotesk wordmark DEMS), comparison Discord event ↔ DEMS, features, animated Discord scene, three self-hosting steps, FAQ |
| `landing/vendor/` | local copies of GSAP, Bootstrap Icons, Inter and Space Grotesk — no CDN |
| `landing/check.js`, `landing/capture.js` | Playwright check script and screenshot capture from `npm run dev:mock` (the page's tests; not part of `npm test`) |

## Rules

- Nothing under `landing/` is committed; the old page (before 3.0) stays in the git history.
- Changes to the app UI do not update the landing page; re-run `node landing/capture.js` for new screenshots.
- Host it separately (any static host). Do not add it to `express.static`.
