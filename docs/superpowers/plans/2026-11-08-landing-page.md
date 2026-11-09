# DEMS Landing Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone, git-ignored landing page in `landing/` in the DEMS look, with the name collapsing into a Space Grotesk DEMS wordmark, that sends operators of large Discord servers to the public GitHub repo.

**Architecture:** Plain static files (no build): `landing/index.html`, `landing/css/landing.css` (copy of the app tokens + page styles), `landing/js/landing.js` (GSAP core + IntersectionObserver). All assets are local copies under `landing/vendor/` and `landing/img/`. Because `landing/` is git-ignored, its tests are a local Playwright check script `landing/check.js` (run with the repo's `@playwright/test`), not part of `npm test`.

**Tech Stack:** HTML, CSS, vanilla JS (ES module), GSAP 3.12.5 core (from `public/vendor/gsap/`), Bootstrap Icons (from `public/vendor/bootstrap-icons/`), Inter (from `public/vendor/fonts/`), Space Grotesk 700 (woff2, OFL), Playwright (Chromium) for checks and screenshots.

**Spec:** `docs/superpowers/specs/2026-11-08-landing-page-design.md`

## Global Constraints

- All visible text German, addressed with „du“; product name „DEMS – Dein Event-Management-System“; „Discord“ never in the product name or logo.
- No request to any other host at runtime: no CDN, no Google Fonts link, no Font Awesome.
- No inline `<script>` bodies, no `on*=` attributes, no `style="…"` attributes, no `<style>` elements.
- Colours, radii, shadows and font sizes only as CSS custom properties copied from `public/css/tokens.css` (dark `:root` + light block under `@media (prefers-color-scheme: light)`).
- Icons only Bootstrap Icons (`bi-*`); no emojis.
- Exactly one primary button label: „Auf GitHub ansehen“ → `https://github.com/VibeGenZero/DEMS` (hero and closing; the header may show a small variant).
- Hostinger link placeholder constant `HOSTINGER_PROMO_LINK` (default `https://www.hostinger.com/`), Docker Hub `https://hub.docker.com/r/moritakahashi/dems`.
- Hero timing: collapse starts ≈ 1.0 s, letters gone ≈ 2.1 s, glow + tagline + chip + button by ≈ 2.8 s, everything done < 3.5 s.
- `prefers-reduced-motion: reduce` → no animation; final state immediately. Without JS → everything readable, hero shows the final DEMS wordmark.
- Mobile from 360 px width without horizontal scroll.
- Only the repo changes (`.gitignore`, removal of `landing/` from the index, docs) are committed; everything in `landing/` stays local.

## Review Focus

1. **Font not yet loaded when the hero starts** → the morph would flash in a fallback font. Start the hero timeline only after `document.fonts.ready` (with a 1.5 s cap). Check in Task 3: `hero waits for fonts` (font requests finish before the collapse class is set).
2. **Long German words on 360 px** („Event-Management-System“, „Anmeldeformular“) → overflow. Check in every task: `no horizontal scroll at 360 px`; use `hyphens: auto` + `lang="de"` and shrink the hero name with `clamp()`.
3. **Light system scheme** → hard-coded dark backgrounds in the Discord scene or screenshots' frames look broken. Check in Task 6: full-page screenshot with `colorScheme: 'light'` reviewed, contrast of text tokens kept.
4. **Screen readers and the split-letter name** → reading „D e i n …“ letter by letter. The animated name is `aria-hidden`, a visually hidden heading carries „DEMS – Dein Event-Management-System“. Check in Task 3: `hero has one accessible h1`.
5. **Links opened from `file://`** → relative asset paths must work without a server. Check in Task 2: `check.js` loads the page via `file://` as well as via a local static server.

---

### Task 1: Take `landing/` out of the repo

**Files:**
- Modify: `.gitignore`, `docs/wiki/overview/directory-map.md` (row for `landing/`), `CLAUDE.md` only if it claims the page is in the repo (the „Ignore … `landing/`“ hint stays), `docs/wiki/graph.json` via `npm run wiki`
- Remove from the index (files stay on disk): `landing/`

- [ ] **Step 1:** `grep -rn "landing" docs/wiki CLAUDE.md README.md .gitignore .dockerignore` and note every line that says the page lives in the repo.
- [ ] **Step 2:** Append to `.gitignore` a block `# Landing page: local only, not part of the repo` + `landing/`. Run `git rm -r --cached landing` and confirm `ls landing` still lists the old files.
- [ ] **Step 3:** Update the `landing/` row in `directory-map.md` to „local landing page, git-ignored (spec `docs/superpowers/specs/2026-11-08-landing-page-design.md`)“ and any other line from Step 1. `npm run wiki`.
- [ ] **Step 4:** Run `npm test` → PASS (the wiki check must not reference `landing/` files as sources). `git status` shows only deletions under `landing/` plus the edited files.
- [ ] **Step 5:** Commit `Move the landing page out of the repository` (body: why — the page is a local marketing artifact; the old version stays in history).

### Task 2: Check script, scaffold and local assets

**Files (all git-ignored):**
- Create: `landing/check.js`, `landing/index.html`, `landing/css/landing.css`, `landing/js/landing.js`, `landing/vendor/gsap/gsap.min.js`, `landing/vendor/bootstrap-icons/` (css + fonts + LICENSE), `landing/vendor/fonts/` (`inter-latin.woff2`, `OFL-Inter.txt`, `space-grotesk-latin-700.woff2`, `OFL-SpaceGrotesk.txt`, `fonts.css`), `landing/img/favicon.svg`
- Delete: `landing/style.css`, `landing/script.js`, `landing/screenshots/`, old `landing/index.html`

**Interfaces:**
- Produces: `node landing/check.js [--update-shots]`. It starts a static server for `landing/` on a free port, opens the page in Chromium (desktop 1440×900, mobile 360×740, plus `file://` once) and fails with a list of named checks. Later tasks add checks to the exported list `CHECKS` (array of `{ name, run(page, ctx) }`) in the same file. With `--update-shots` it writes `landing/shots/{desktop,mobile,light,reduced}.png` for visual review.

- [ ] **Step 1: Write `landing/check.js` with these checks first**
  - `no external requests`: every request URL starts with the local origin or `file://`
  - `no inline code or styles`: in the HTML source, no `<script>` with a body, no `\son[a-z]+=`, no `style=`, no `<style`
  - `no console errors`: listen to `console` (type error) and `pageerror`
  - `all assets load`: no response ≥ 400, no failed request
  - `no horizontal scroll at 360 px`: `document.documentElement.scrollWidth <= 360`
  - `primary button`: every `.btn-primary` reads „Auf GitHub ansehen“ and links to the GitHub URL from the Global Constraints
  - `file:// works`: page loads with no failed request
- [ ] **Step 2:** `node landing/check.js` → FAIL (page missing / assets missing).
- [ ] **Step 3: Copy and fetch the assets**
  - copy GSAP, Bootstrap Icons and Inter from `public/vendor/`
  - Space Grotesk 700: `npm pack @fontsource/space-grotesk@5` in a new empty temp dir, extract it there, then copy `files/space-grotesk-latin-700-normal.woff2` → `landing/vendor/fonts/space-grotesk-latin-700.woff2` and its `LICENSE` → `OFL-SpaceGrotesk.txt`
  - nothing is installed into the repo
- [ ] **Step 4: Scaffold the page**
  - `index.html`: `lang="de"`, `<meta name="color-scheme" content="dark light">`, title „DEMS – Dein Event-Management-System“, meta description, favicon, the stylesheets and `<script type="module" src="js/landing.js">`, empty `<header>`, `<main>` with the section shells (ids `hero`, `problem`, `vergleich`, `funktionen`, `szene`, `hosten`, `faq`, `start`), `<footer>`
  - `landing.css`: the token blocks copied from `public/css/tokens.css` (dark + light via `prefers-color-scheme`), `@font-face` for Inter and Space Grotesk, base typography (Inter body, Space Grotesk headings), `.btn-primary` / `.btn-ghost` / `.chip` / `.card` in the app's look, container width, section spacing, `.visually-hidden`, `.is-hidden`
  - `favicon.svg`: a DEMS mark in accent purple
- [ ] **Step 5:** `node landing/check.js` → PASS.

### Task 3: Header and hero animation

**Files:** `landing/index.html` (`header`, `#hero`), `landing/css/landing.css`, `landing/js/landing.js`, `landing/check.js`

**Interfaces:**
- `landing.js` exports nothing; it reads `matchMedia('(prefers-reduced-motion: reduce)')` once as `reducedMotion`. On `<html>` it sets `js` (scripted start states may apply) and `motion-ok` (when animations run).
- Hero markup: `<h1 class="visually-hidden">DEMS – Dein Event-Management-System</h1>`, an `aria-hidden` `.hero-name` with one `<span class="ch rest|init">` per character (built in HTML, not by JS, so it is readable without JS), `.hero-mark` (final wordmark DEMS in Space Grotesk, gradient text), `.hero-tagline`, `.chip` „Open Source · MIT-Lizenz“, primary button, scroll hint.

- [ ] **Step 1: Add checks to `check.js` first**
  - `hero has one accessible h1`: exactly one `h1`, text „DEMS – Dein Event-Management-System“, `.hero-name` has `aria-hidden="true"`
  - `hero ends on DEMS`: after 3.5 s the visible text of the hero wordmark is „DEMS“ and the button is visible
  - `reduced motion shows the final state at once`: with `reducedMotion: 'reduce'`, at 100 ms the wordmark and button are visible and no `.ch.rest` is visible
  - `without JS the hero is final`: context with `javaScriptEnabled: false`, the wordmark and button are visible
  - `hero waits for fonts`: Space Grotesk has loaded before `<html>` gets the class `hero-collapsed`
- [ ] **Step 2:** `node landing/check.js` → those checks FAIL.
- [ ] **Step 3: Build header and hero**
  - glass header with the small wordmark, anchor links, a small GitHub button and the mobile menu (`<button aria-expanded>`)
  - hero animation as in the spec: CSS transitions on `max-width`/`opacity`/`transform`/`filter` for `.ch.rest`, GSAP for the wordmark grow, glow and the stagger of tagline, chip and button
  - start states only under `html.js.motion-ok`; trigger after `document.fonts.ready` (capped at 1.5 s)
- [ ] **Step 4:** `node landing/check.js` → PASS; `node landing/check.js --update-shots`, look at `shots/desktop.png` and `shots/mobile.png`.

### Task 4: Problem, comparison and features with fresh screenshots

**Files:** `landing/index.html` (`#problem`, `#vergleich`, `#funktionen`), css, js, `landing/check.js`, `landing/capture.js`, `landing/img/*.png`

**Interfaces:**
- `node landing/capture.js` starts `dev/start.js` from the repo root with a temp `DEV_SQLITE_PATH`/`DEV_UPLOAD_DIR` on a free port, logs in as persona `admin` (`/auth/dev-login/admin`) and writes 1440×900 dark screenshots to `landing/img/`:
  - `events.png`: event overview `/#events`
  - `event-detail.png`: a slot event from the seed
  - `admin.png`: admin dashboard
  - `bot.png`: bot center
- Reveal helper in `landing.js`: elements with `data-reveal` (optional `data-reveal-stagger` on a parent) fade and slide in once via IntersectionObserver + `gsap.to`; under reduced motion they are simply visible.

- [ ] **Step 1: Add checks first**
  - `comparison has five rows`: `#vergleich` has the rows Zugang, Plätze, Aufstellung, Anmeldung, Danach, each with a Discord cell and a DEMS cell
  - `feature images load`: every `#funktionen img` has `naturalWidth > 0` and a German `alt`
  - `reveals end visible`: after scrolling to the bottom and waiting 1.5 s, no `[data-reveal]` has opacity < 1
- [ ] **Step 2:** checks FAIL.
- [ ] **Step 3: Content**
  - write `capture.js` and run it
  - write the texts: problem (2–3 sentences), the comparison rows exactly as in spec section 4, four feature blocks (Rollen & Zugang, Anmeldung direkt in Discord, Warteliste & Slots, Admin-Dashboard) alternating text and image
  - screenshots get the desktop tilt (≤ 6°, `pointermove`, off under reduced motion and on touch)
- [ ] **Step 4:** checks PASS; update and review the shots.

### Task 5: Discord scene and the three hosting steps

**Files:** `landing/index.html` (`#szene`, `#hosten`), css, js, `landing/check.js`

**Interfaces:**
- Scene markup is a mocked bot message:
  - avatar with the DEMS mark, bot name „DEMS“, „BOT“ tag
  - embed: title „Raid-Abend · Freitag 20:00“, counter `.scene-count` („12/20“), buttons „Anmelden“ / „Vielleicht“ / „Abmelden“
  - a fake cursor `.scene-cursor` and a list `.scene-list`
  - no Discord logo or brand image
- `playScene()` runs once when 40 % visible: cursor moves to „Anmelden“, click ripple, counter 12 → 20, waitlist note „+3 auf der Warteliste“. A „Nochmal“ button replays it.
- Steps: three cards; numbers drawn with an SVG stroke on reveal; step 1 links to `HOSTINGER_PROMO_LINK` („z. B. bei Hostinger“); step 2 has a terminal that types `docker compose up -d`, then shows the lines `✔ db-secret`, `✔ postgres`, `✔ dems` (as Bootstrap Icons `bi-check2`, not emoji); step 3 links to the Discord Developer Portal.

- [ ] **Step 1: Add checks first**
  - `scene ends at 20/20 with waitlist`: scroll the scene into view, wait 4 s; `.scene-count` = „20/20“, waitlist note visible
  - `scene replay`: click „Nochmal“, it restarts and ends at the same state
  - `reduced motion scene`: shows the end state at once
  - `terminal ends typed`: after reveal + 3 s the terminal shows `docker compose up -d` and three done lines
  - `hostinger link`: step 1 link = `HOSTINGER_PROMO_LINK` constant, `rel="noopener sponsored"`, `target="_blank"`
- [ ] **Step 2:** checks FAIL.
- [ ] **Step 3:** Build scene, steps and terminal. Export the link constants at the top of `landing.js` (comment marking the Hostinger placeholder); the `href`s in `index.html` use the same URLs.
- [ ] **Step 4:** checks PASS; update and review the shots.

### Task 6: FAQ, closing, footer and final review

**Files:** `landing/index.html` (`#faq`, `#start`, `footer`), css, `landing/check.js`, `landing/README.md`

- [ ] **Step 1: Add checks first**
  - `faq is native`: six `<details>` in `#faq`, each with a `<summary>`, the questions from spec section 8; opening one shows its answer
  - `footer notes`: the footer contains „Nicht mit Discord Inc. verbunden“, „MIT-Lizenz“, links to GitHub, Docker Hub and `https://github.com/VibeGenZero/DEMS/blob/main/LICENSE`
  - `headings in order`: no heading level skipped (h1 → h2 → h3)
  - `focus visible`: tabbing to the primary button gives it a visible `outline` or `box-shadow`
- [ ] **Step 2:** checks FAIL.
- [ ] **Step 3: FAQ, closing and footer**
  - FAQ answers as in the spec: no prices, no hard server size; updates via `docker compose pull && docker compose up -d`
  - closing: big wordmark, one sentence, the primary button
  - footer as checked above
  - `landing/README.md` (German): how to open the page locally, `node landing/check.js`, `node landing/capture.js`, and where to put the Hostinger link
- [ ] **Step 4:** `node landing/check.js --update-shots` → all checks PASS; review `desktop.png`, `mobile.png`, `light.png`, `reduced.png` against the anti-goals of the spec (generic SaaS look, hectic motion, Discord in the name).
- [ ] **Step 5:** `npm test` → PASS (repo untouched by the page). Nothing in `landing/` is committed; `git status` shows no `landing/` entries.
