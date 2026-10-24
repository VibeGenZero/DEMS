# Proposal

Ticket: **W-12 Banner hochladen** (GitLab work item 76, branch `76-w-12-banner-hochladen`, depends on F-14, which is done: `bannerUrl` is already checked on the server).

## Why

Today an event banner can only be set as an external URL. Admins first have to host the image somewhere else (Imgur, Discord CDN). Those links break when the host deletes the file, and the only check is whether the link starts with `http(s)://`. Decision 4 of the DEMS 3.0 prioplan sets the target: banners are files in the data volume, and the database stores only their path.

## What Changes

- New admin endpoint that takes one image (PNG, JPEG, WebP or GIF, at most 5 MB) as the raw request body. It checks the real file content (magic bytes), not just the declared type, stores the file under a random name in the data volume and returns its path `/uploads/banners/<uuid>.<ext>`.
- Uploaded banners are served read-only and publicly under `/uploads/banners/` (Discord has to fetch them for embeds). SVG and other types are never served from there.
- An event's `bannerUrl` may now be either an external `http(s)` URL (as before) or the path of an uploaded banner that exists. Server validation, the wizard checks, the preview and the frontend banner check all accept both forms.
- Event wizard: next to the existing URL field there is an "Bild hochladen" button with a size/type check in the browser, an upload, a preview and "Entfernen". The URL field stays: you can upload a file or enter a URL.
- Discord: for uploaded banners the bot builds the absolute URL from `BASE_URL` (embed image). The Discord scheduled event gets the file content directly, so it works even without a public URL.
- Clean-up: when a banner is replaced or removed, an event is deleted, a series is deleted or events are wiped by the admin reset, the server deletes the file once no event uses it anymore (series and duplicates share the path). On startup, uploads older than 24 hours that no event uses are deleted (uploads where the wizard was closed without saving).
- New env variable `UPLOAD_DIR` (default `./data/uploads`, so in Docker it is on the existing `/app/data` volume). The dev mock mode uses its own folder (`DEV_UPLOAD_DIR`, default `data/dev-uploads`).

No breaking change: existing events with external URLs keep working unchanged.

## Capabilities

### New Capabilities
- `event-banners`: how an event gets its banner (external URL or uploaded file), the upload checks, serving the files, their use in Discord and the clean-up of unused files.

### Modified Capabilities
- none

## Impact

- Code: `server.js` (static `/uploads/banners`, startup sweep), `routes/admin.js` (upload endpoint; release old banners in `PUT /events/:id`, `DELETE /events/:id`, `DELETE /events/series/:seriesId`, `DELETE /reset`), new `utils/bannerStore.js`, `middleware/validators.js`, `utils/eventPreview.js`, `bot.js` (embed image and scheduled event image), `dev/mockMode.js`, frontend `public/js/core/ui.js` (`isValidBannerUrl`), `public/js/admin/wizard.js`, `public/js/admin/wizard-checks.js`, `public/index.html` (wizard banner block).
- API: new `POST /api/admin/uploads/banner`; `bannerUrl` in `POST /events` and `PUT /events/:id` accepts the upload path.
- Config: `UPLOAD_DIR` in `.env.example` and `docs/wiki/ops/configuration.md`.
- Dependencies: none (Express' built-in `express.raw`, no multer, no image library).
- Wiki nodes: `docs/wiki/reference/api-index.md`, `docs/wiki/modules/routes-admin.md`, `docs/wiki/concepts/data-model.md`, `docs/wiki/concepts/security.md`, `docs/wiki/modules/bot.md`, `docs/wiki/modules/frontend-app.md`, `docs/wiki/ops/configuration.md`, `docs/wiki/ops/docker.md`, `docs/wiki/modules/dev-mock-mode.md`, `docs/wiki/modules/utils.md`.
