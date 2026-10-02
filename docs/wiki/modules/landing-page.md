---
id: landing-page
title: landing/ — standalone marketing page
type: module
tags: [landing, marketing, static-site, screenshots]
sources: [landing/index.html, landing/script.js, landing/style.css, landing/screenshots]
see_also: [directory-map]
---
# landing/ — standalone marketing page

> TL;DR: `landing/` is a separate static marketing website for DEMS (hero, features, screenshot gallery, security, tech stack, config, beta access). It is NOT served by `server.js` (which only serves `public/`) and is excluded from the Docker image. Ignore it for app work.

## Files

| File | Content |
|---|---|
| `landing/index.html` | sections `#hero`, `#features`, `#gallery` (tabs: dashboard, events, admin, bot control), `#security`, `#tech`, `#config`, `#beta`, footer |
| `landing/script.js` | `initNavbar`, `initMobileMenu`, `initGalleryTabs`, `initScrollAnimations`, `initSmoothScroll`, `initLightbox`, `copyEnv` |
| `landing/style.css` | own stylesheet (~1750 lines), incl. CSS placeholders for missing screenshots |
| `landing/screenshots/` | PNG screenshots + README |

## Rules

- Changes to the app UI do not update the landing page automatically; screenshots are manual.
- Host it separately (any static host). Do not add it to `express.static`.
