# Design

## Context

- `bannerUrl` is a plain string on the event (`docs/wiki/concepts/data-model.md`). Since F-14, `validateEvent` in `middleware/validators.js` accepts only empty or `http(s)` values. The frontend check `isValidBannerUrl` (`public/js/core/ui.js`), the wizard check (`public/js/admin/wizard-checks.js`) and the preview (`utils/eventPreview.js`, `bannerOf`) have their own copies of that rule.
- Places where `bannerUrl` is used: `bot.js` `embed.setImage(event.bannerUrl)` (event embed) and `scheduledEvent.setImage(event.bannerUrl)` in `createScheduledEvent`; frontend `events/cards.js`, `events/detail.js`, `admin/wizard-preview.js`.
- `bannerUrl` is copied as is by recurring series (`POST /events`) and by `POST /events/:id/duplicate`, so several events can point to the same file.
- Body parsing: only `express.json()` and `urlencoded` are global; there is no multipart library. The CSRF check in `server.js` works off a header, so it also covers a request with a raw body.
- Docker keeps `/app/data` on a volume (`compose.yaml`, `Dockerfile`). The CSP already allows `img-src 'self'`.
- Mock mode already serves the seed banners from `dev/banners` under `/dev-banners` with absolute `BASE_URL` URLs. The seed stays as it is.

## Goals / Non-Goals

**Goals:**
- Store uploaded banners as files and the path in the event, with no new dependency.
- Keep one rule for "valid banner" that the server, preview and frontend share in meaning, pinned by tests.
- Make clean-up reference-based so shared files (series, duplicates) survive.

**Non-Goals:**
- No resizing, cropping, re-encoding or EXIF stripping (would need an image library such as `sharp`). The file is stored byte for byte.
- No migration of existing external URLs into uploads.
- No upload outside the event wizard (no media library, no banners for polls or templates).
- Firestore mode keeps the files on the local disk as well; there is no cloud storage.
- The PostgreSQL decision from the prioplan (decision 4) is out of scope here.

## Decisions

1. **Raw body instead of multipart.** `POST /api/admin/uploads/banner` uses `express.raw({ type: () => true, limit: '5mb' })` on that route only. The frontend sends `fetch(url, { method: 'POST', body: file, headers: { 'Content-Type': file.type, 'X-CSRF-TOKEN': … } })`. Why: one file, no form fields, so there is no need for multer/busboy (CLAUDE.md: no new dependencies). The parser is wrapped so that its "entity.too.large" error becomes our own 413 JSON answer with a German message instead of the Express default page. Accepting any content type in the parser and checking the bytes afterwards means a wrong declared type gives our 400 message, not an empty body.
   *Alternative:* base64 inside JSON. Rejected: about a third larger, and the global JSON limit would have to grow for every route.

2. **Type from magic bytes.** A small pure function `detectImageType(buffer)` in the new `utils/bannerStore.js` recognises PNG (`89 50 4E 47 0D 0A 1A 0A`), JPEG (`FF D8 FF`), GIF (`GIF87a`/`GIF89a`) and WebP (`RIFF....WEBP`) and returns `png|jpg|gif|webp` or `null`. SVG is never accepted, because it can carry scripts.

3. **Storage layout and name.** Files go to `<UPLOAD_DIR>/banners/<crypto.randomUUID()>.<ext>`. `UPLOAD_DIR` defaults to `path.join(process.cwd(), 'data', 'uploads')`, which is `/app/data/uploads` in Docker (already on the volume). `dev/mockMode.js` sets `UPLOAD_DIR` to `data/dev-uploads` unless `DEV_UPLOAD_DIR` is given, like `DEV_SQLITE_PATH`, so mock uploads never mix with real ones (both `UPLOAD_DIR` and `DEV_UPLOAD_DIR` go into `.env.example` and `docs/wiki/ops/configuration.md`). Tests point it at a temp folder. The folder is created on demand (`mkdir -p`). The file is written to a temp name first and then renamed, so a half-written file never gets a valid name.

4. **The path is the stored value.** `bannerUrl` holds `/uploads/banners/<uuid>.<ext>` (decision 4: the database stores only the path). One regex `BANNER_PATH = /^\/uploads\/banners\/[0-9a-f-]{36}\.(png|jpg|gif|webp)$/` exists in `utils/bannerStore.js` (server) and in `public/js/core/ui.js` (frontend, ESM cannot import the CJS module). A test asserts that both sources have the same pattern. On the server, `validateEvent` also checks that the file exists (`isStoredBanner(path)`), so an admin cannot point an event at a made-up path. The preview (`bannerOf`) and the wizard check accept the pattern without checking the disk.
   *Alternative:* store the absolute URL `BASE_URL + path`. Rejected: breaks when the domain changes and goes against decision 4.

5. **Serving.** `app.use('/uploads/banners', express.static(dir, { index: false, dotfiles: 'deny', fallthrough: false }))` behind a small guard that answers 404 for every name that does not match `<uuid>.<ext>`. It is registered before the SPA catch-all and before the session middleware (like `/healthz`), so fetching an image creates no session. helmet already sets `nosniff`; `express.static` sets the content type from the extension. Cache header: `maxAge: '7d', immutable`, which is safe because names are never reused.

6. **Discord.** `utils/bannerStore.js` exports `bannerForDiscord(bannerUrl)`. It returns `{ url }` for an external URL. For an upload it returns `{ url: BASE_URL + path, file: absolutePath }`, and `{}` when the value is empty or the file is gone. In `bot.js`, the embed builder uses `.url`, and `createScheduledEvent` passes the file path when there is one (`scheduledEvent.setImage` accepts a path or buffer), otherwise the URL. No new exported Discord helper and no new Discord call, so `dev/mockBot.js` needs no new twin. The mock embed and scheduled event code paths read the same `bannerUrl` and are only checked to still log.

7. **Clean-up by reference.** `releaseBanners(paths)` in `utils/bannerStore.js` takes the banner values that just stopped being used. It ignores everything that is not an upload path, reads all events once (`getDocs(collection(db, 'events'))`, filter in memory, as the data rules require) and deletes each file no event references anymore. Errors are logged, never thrown. Callers in `routes/admin.js`:
   - `PUT /events/:id`: after saving, when the old `bannerUrl` differs from the new one → release the old one.
   - `DELETE /events/:id`, `DELETE /events/series/:seriesId`: after the deletes → release the banners of the deleted events.
   - `DELETE /reset` with target `events`: release the banners of all wiped events.
   - `sweepOrphanBanners({ maxAgeMs: 24h })` runs once at startup in `server.js` (after the database is ready, without blocking the start) and deletes unused files whose `mtime` is older than 24 hours. That also catches uploads where the wizard was closed and anything left over from a crash.
   *Alternative:* keep a `bannerRefs` counter in the database. Rejected: one more collection that can drift. Scanning the events is cheap at DEMS sizes.

8. **Wizard UI.** In the banner block of `public/index.html`: a hidden `<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" id="event-banner-file">`, a `btn` "Bild hochladen" (`bi-upload`, `data-click`) that opens it, and a "Entfernen" button (`bi-x-lg`) shown only while a banner is set. `data-change` on the file input runs `uploadBanner` in `public/js/admin/wizard.js`: it checks size and `file.type` against the same list (German toast on failure), shows a busy state on the button, uploads, writes the path into `#event-banner-url` and runs the existing preview update. The URL field changes from `type="url"` to `type="text"` with `inputmode="url"`, because the browser would mark a relative upload path as invalid. The wizard check stays the authority. Help text: "Bild hochladen (PNG, JPEG, WebP, GIF, max. 5 MB) oder direkte URL eintragen". Only existing components and tokens, no inline styles.

9. **Messages.** Server: "Nur PNG-, JPEG-, WebP- oder GIF-Bilder sind erlaubt.", "Das Bild darf höchstens 5 MB groß sein.", "Keine Bilddatei empfangen.", "Fehler beim Hochladen des Banners." (500), validation "Banner muss eine http(s)-URL oder ein hochgeladenes Bild sein." (replaces "Banner-URL muss mit http:// oder https:// beginnen."; the test in `test/devServer.test.js` changes with it). Wizard check: "Die Banner-URL muss mit http:// oder https:// beginnen oder ein hochgeladenes Bild sein." Audit action `UPLOAD_BANNER` with the file name.

## Risks / Trade-offs

- [Discord cannot fetch `BASE_URL` (localhost, private network)] → the embed shows no image. The scheduled event still gets the file. This is documented in `docs/wiki/modules/bot.md` and known issues need no entry, because production runs with a public `BASE_URL` anyway (OAuth needs it).
- [Image files are public to anyone who knows the UUID] → same as today's external URLs. UUIDs cannot be guessed and there is no listing.
- [Race: an upload is saved to an event while the startup sweep runs] → the sweep only touches files older than 24 hours.
- [Release reads all events on every banner change] → a handful of reads at DEMS size, done after the answer path's writes. Acceptable.
- [Lost files when the volume is not mounted] → the same as for SQLite today. `docs/wiki/ops/docker.md` and `deployment.md` say that `UPLOAD_DIR` must be on the volume.
- [Polyglot files (valid PNG header with HTML after it)] → served with an image content type plus `nosniff`, never as HTML. The browser renders them only as an image.
- [Firestore mode on a host without a persistent disk] → uploads are lost on redeploy. Documented in configuration. External URLs remain the way out.

## Migration Plan

No data migration: existing values are `http(s)` URLs or empty and stay valid. Deploy: the new image creates `data/uploads/banners` on the first upload. Rollback: an older version refuses upload paths in `validateEvent` when an event is saved again, and the frontend no longer renders them. Before rolling back, events with uploaded banners should get a URL or no banner. `UPLOAD_DIR` is optional.
