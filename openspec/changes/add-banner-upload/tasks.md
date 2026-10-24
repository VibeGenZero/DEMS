# Tasks

## 1. Banner store (pure helpers and file handling)

- [x] 1.1 Write `test/bannerStore.test.js` first (RED): `detectImageType` for PNG/JPEG/GIF87a/GIF89a/WebP headers, SVG, HTML, an empty buffer and a truncated header; `isBannerPath` for valid paths and for `../`, other extensions, upper case and extra segments; `saveBanner` writes `<uuid>.<ext>` into a temp `UPLOAD_DIR` and leaves no temp file; `isStoredBanner` for an existing and a missing file; `bannerForDiscord` for empty, external, upload and missing file with a fixed `BASE_URL`. Verify that `npm test` fails on the missing module.
- [x] 1.2 Implement `utils/bannerStore.js` (`BANNER_PATH`, `ALLOWED_TYPES`, `MAX_BANNER_BYTES`, `bannerDir()`, `detectImageType`, `isBannerPath`, `saveBanner`, `isStoredBanner`, `bannerForDiscord`) as in design decisions 2–4 and 6. Verify that `node --test test/bannerStore.test.js` is green.
- [x] 1.3 Add `releaseBanners(paths)` and `sweepOrphanBanners({ maxAgeMs, now })`, with tests first against the dev SQLite through `firebaseAdmin.js`: a file used by two events survives releasing one of them; an unused one is deleted; external URLs are ignored; the sweep keeps young and used files and deletes old unused ones; a failing `unlink` is logged and does not throw. Verify the tests are green.
- [x] 1.4 Document the module in `docs/wiki/modules/utils.md`. Verify it with `npm run wiki`.

## 2. Upload endpoint, serving and config

- [x] 2.1 Write tests in `test/devServer.test.js` first (RED), with personas: `admin` uploads a PNG as raw body → 200 with `bannerUrl` matching the pattern, and a logged-out GET of that path → 200 `image/png` with `nosniff`; JPEG declared as `image/png` → `.jpg`; SVG/HTML → 400 with the German message; > 5 MB → 413 "Das Bild darf höchstens 5 MB groß sein."; empty body → 400; `member` → 403; missing CSRF header → refused; GET `/uploads/banners/notes.txt` and an encoded `../` path → 404; the upload is in the audit log as `UPLOAD_BANNER`; after each refused upload the folder holds no new file. Extend `test/helpers.js` with a `sendRaw(method, path, buffer, contentType)` on the persona client when it is needed. Verify the tests fail.
- [x] 2.2 Add `POST /api/admin/uploads/banner` in `routes/admin.js` (static path, own `try/catch`, route-level `express.raw` wrapper with a 413 JSON answer, `addAuditLog`). Mount `/uploads/banners` in `server.js` before the session middleware and the SPA fallback, with the name guard. Verify the 2.1 tests are green.
- [x] 2.3 Set `UPLOAD_DIR` / `DEV_UPLOAD_DIR` in `dev/mockMode.js` (mock default `data/dev-uploads`), add a `test/mockMode.test.js` case for it first, and make sure the dev server tests use a temp dir. Document both variables (German comments) in `.env.example` and in `docs/wiki/ops/configuration.md`. Note in `docs/wiki/ops/docker.md` that the files live in `/app/data/uploads` on the volume. Verify `npm test` passes the configuration and wiki checks.
- [x] 2.4 Update `docs/wiki/reference/api-index.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/concepts/security.md` (type check by bytes, no SVG, public read-only path, `nosniff`) and `docs/wiki/modules/dev-mock-mode.md`. Run `npm run wiki`.

## 3. Banner value accepted everywhere

- [x] 3.1 Tests first: `test/devServer.test.js` saves an event with an uploaded path → 200; with a missing-file path, `/api/admin/reset` and `javascript:` → 400 "Banner muss eine http(s)-URL oder ein hochgeladenes Bild sein." (replace the old message in the existing test); `test/eventPreview.test.js` keeps the upload path; `test/wizardChecks.test.js` accepts the path and shows the new wizard message; `test/eventCards.test.js` renders `<img>` for the path, but not for `/relative.png` or other relative values. Verify they fail.
- [x] 3.2 Update `middleware/validators.js` (`isStoredBanner`), `utils/eventPreview.js` (`bannerOf`), `public/js/core/ui.js` (`isValidBannerUrl` plus exported `BANNER_PATH`) and `public/js/admin/wizard-checks.js`. Add a test asserting that the frontend `BANNER_PATH` and the server `BANNER_PATH` have the same source. Verify the 3.1 tests are green.
- [x] 3.3 Update `docs/wiki/concepts/data-model.md` (`bannerUrl`: http(s) URL or upload path, validated). Run `npm run wiki`.

## 4. Clean-up wired into the admin routes

- [x] 4.1 Tests first in `test/devServer.test.js`: replacing an uploaded banner via `PUT /events/:id` deletes the old file; clearing it deletes it; `DELETE /events/:id` deletes it; a duplicated event keeps the file alive after the original is deleted; `DELETE /events/series/:seriesId` deletes the shared file once; `DELETE /reset` with `events` deletes the banners; an external URL never touches the folder. Verify they fail.
- [x] 4.2 Call `releaseBanners` in `PUT /events/:id`, `DELETE /events/:id`, `DELETE /events/series/:seriesId` and `DELETE /reset`, and call `sweepOrphanBanners` once at startup in `server.js` without blocking it. Verify the 4.1 tests are green and the server still starts in mock mode (`/healthz` 200).
- [x] 4.3 Describe the clean-up rules in `docs/wiki/modules/routes-admin.md` and `docs/wiki/concepts/data-model.md`. Run `npm run wiki`.

## 5. Discord

- [x] 5.1 Tests first: `bannerForDiscord` cases from 1.1 cover the values. Add a test (in `test/discordPreview.test.js` or a new `test/botBanner.test.js`, whichever builds the embed without a client) showing that the event embed gets `BASE_URL + path` for an upload and the external URL unchanged. Verify it fails.
- [x] 5.2 Use `bannerForDiscord` in the embed builder and in `createScheduledEvent` in `bot.js` (file path for uploads, URL otherwise; keep the existing `try/catch`). Check that `dev/mockBot.js` needs no new twin, because no new exported helper exists, and that `test/mockBot.test.js` is still green. Verify the 5.1 test is green.
- [x] 5.3 Document in `docs/wiki/modules/bot.md` how banners reach Discord, including the limit that a non-public `BASE_URL` gives an embed without an image. Run `npm run wiki`.

## 6. Wizard UI

- [x] 6.1 Tests first: in `test/eventForm.test.js` (or the wizard test that loads the frontend with `loadFrontendApp`, run with `--experimental-vm-modules`), picking a 7 MB file or `image/svg+xml` gives the German toast and no request; a valid file sends one POST with the raw file, `Content-Type` and `X-CSRF-TOKEN`, writes the returned path into `#event-banner-url` and shows the preview; "Entfernen" clears the field and hides the preview; a 400 answer shows its `error` as a danger toast. Verify they fail.
- [x] 6.2 Change the banner block in `public/index.html` (hidden file input, "Bild hochladen" and "Entfernen" buttons with `bi-upload` / `bi-x-lg`, `data-click` / `data-change`, `type="text" inputmode="url"`, new help text, no inline styles) and add `uploadBanner` / `clearBanner` in `public/js/admin/wizard.js`, registered with `registerActions`. Verify the 6.1 tests and `test/cssRules.test.js` / `test/frontendCsp.test.js` are green.
- [x] 6.3 Extend `e2e/wizard.spec.js`: the admin uploads a small PNG fixture, saves the event and sees the banner on the event page. Verify that `npm run test:e2e` is green.
- [x] 6.4 Update `docs/wiki/modules/frontend-app.md` (wizard banner upload). Run `npm run wiki`.

## 7. Integration check

- [x] 7.1 In mock mode with a scratch `DEV_SQLITE_PATH` and `DEV_UPLOAD_DIR`: upload a banner in the wizard, save, check the card, the event page and the mock bot log; replace the banner and check that the old file is gone. Verify this with a Playwright screenshot script or a manual check.
- [x] 7.2 Run `npm test` and `npm run test:e2e` (three times, because of shared-DB races) and verify everything is green.

## Workflow follow-up

- After the merge: `/opsx:archive` on a `chore/openspec-archive-…` branch from `origin/main`. This syncs `event-banners` into `openspec/specs/`.
- Remove nothing from `docs/wiki/reference/known-issues.md` unless the apply phase finds a related entry.
