# Spec Delta

## Purpose

Lets admins give an event a banner image, either as an external link or as an uploaded file that DEMS stores itself, and keeps those files safe to serve, usable in Discord and cleaned up when no event needs them.

## ADDED Requirements

### Requirement: Admins can upload a banner image
The system SHALL offer admins an upload for one banner image as the raw request body. It SHALL accept PNG, JPEG, WebP and GIF of at most 5 MB, store the file under a new random name and answer with its path `/uploads/banners/<uuid>.<ext>`, where the extension follows the detected type. Only admins SHALL be able to upload, and the request SHALL need the CSRF token like every mutating API request. Each upload SHALL be written to the audit log.

#### Scenario: Valid PNG
- **WHEN** an admin uploads a 300 KB PNG file
- **THEN** the answer is 200 with a `bannerUrl` like `/uploads/banners/<uuid>.png` and the file can be fetched at that path

#### Scenario: Non-admin
- **WHEN** a logged-in member without admin rights uploads an image
- **THEN** the answer is 403 and no file is stored

#### Scenario: Missing CSRF token
- **WHEN** an admin uploads an image without the `X-CSRF-TOKEN` header
- **THEN** the request is refused and no file is stored

### Requirement: Uploads are checked by content and size
The system SHALL decide the image type from the file's first bytes, not from the declared content type or a name. A body whose bytes are not PNG, JPEG, WebP or GIF SHALL be refused with 400 and "Nur PNG-, JPEG-, WebP- oder GIF-Bilder sind erlaubt.". A body over 5 MB SHALL be refused with 413 and "Das Bild darf höchstens 5 MB groß sein.". An empty body SHALL be refused with 400. A refused upload SHALL leave no file behind.

#### Scenario: Disguised file
- **WHEN** an admin uploads an SVG or HTML file declared as `image/png`
- **THEN** the answer is 400 with "Nur PNG-, JPEG-, WebP- oder GIF-Bilder sind erlaubt." and no file is stored

#### Scenario: Too large
- **WHEN** an admin uploads a 6 MB JPEG
- **THEN** the answer is 413 with "Das Bild darf höchstens 5 MB groß sein." and no file is stored

#### Scenario: Declared type differs from content
- **WHEN** an admin uploads a real JPEG declared as `image/png`
- **THEN** the upload succeeds and the stored file ends in `.jpg`

### Requirement: Uploaded banners are served read-only
The system SHALL serve uploaded banners under `/uploads/banners/<name>` to everyone without login, so Discord and logged-out visitors can load them, with the content type of the stored image type and `X-Content-Type-Options: nosniff`. It SHALL serve only files with a name of the form `<uuid>.<png|jpg|webp|gif>` and answer 404 for anything else, including directory listings and paths that leave the folder.

#### Scenario: Logged-out fetch
- **WHEN** a visitor who is not logged in requests the path of an uploaded banner
- **THEN** the answer is 200 with the image and its image content type

#### Scenario: Unknown or foreign file
- **WHEN** someone requests `/uploads/banners/../dems.sqlite` or `/uploads/banners/notes.txt`
- **THEN** the answer is 404

### Requirement: An event banner is an external URL or an uploaded path
An event's `bannerUrl` SHALL be empty, an `http://` or `https://` URL, or the path of an uploaded banner whose file exists. Creating or editing an event with any other value SHALL be refused with 400 and "Banner muss eine http(s)-URL oder ein hochgeladenes Bild sein.". The event card, event page, wizard preview and Discord SHALL show both forms; existing events with external URLs SHALL keep working unchanged.

#### Scenario: Uploaded path
- **WHEN** an admin saves an event with the `bannerUrl` returned by an upload
- **THEN** the event is saved and its card and page show the banner

#### Scenario: Path without file
- **WHEN** an admin saves an event with `bannerUrl` `/uploads/banners/<uuid>.png` for which no file exists
- **THEN** the answer is 400 with "Banner muss eine http(s)-URL oder ein hochgeladenes Bild sein."

#### Scenario: Other relative path
- **WHEN** an admin saves an event with `bannerUrl` `/api/admin/reset` or `javascript:alert(1)`
- **THEN** the answer is 400 and the event is not changed

### Requirement: The wizard offers upload or URL
The event wizard SHALL offer an "Bild hochladen" button next to the banner URL field. Choosing a file SHALL check type and size in the browser first and show the same German messages as the server as a toast, then upload the file, put the returned path into the banner field and show the preview. An "Entfernen" button SHALL clear the banner. Entering a URL SHALL keep working as before.

#### Scenario: Upload in the wizard
- **WHEN** an admin picks a valid image file in the wizard
- **THEN** the image is uploaded, the preview shows it and saving the event stores its path as the banner

#### Scenario: File too large in the browser
- **WHEN** an admin picks a 7 MB image
- **THEN** a toast says "Das Bild darf höchstens 5 MB groß sein." and nothing is uploaded

#### Scenario: Remove banner
- **WHEN** an admin clicks "Entfernen" and saves the event
- **THEN** the event has no banner

### Requirement: Discord shows uploaded banners
For an uploaded banner the Discord event embed SHALL use the absolute URL formed from `BASE_URL` and the path, and the Discord scheduled event SHALL get the image file itself. External URLs SHALL be passed to Discord unchanged as before.

#### Scenario: Embed of an event with an uploaded banner
- **WHEN** the bot posts the embed of an event whose banner is `/uploads/banners/<uuid>.png` and `BASE_URL` is `https://dems.example`
- **THEN** the embed image is `https://dems.example/uploads/banners/<uuid>.png`

#### Scenario: Scheduled event
- **WHEN** the bot creates the Discord scheduled event of that event
- **THEN** it sets the cover image from the stored file

### Requirement: Unused banner files are deleted
When an event's banner is replaced or cleared, an event or series is deleted, or events are wiped by the admin reset, the system SHALL delete each uploaded file no event uses anymore and SHALL keep files other events (series, duplicates) still use. On startup it SHALL delete uploaded files older than 24 hours that no event uses. External URLs SHALL never cause a deletion. A failed deletion SHALL be logged and not fail the request.

#### Scenario: Banner replaced
- **WHEN** an admin replaces an event's uploaded banner with a new upload and saves
- **THEN** the old file is deleted

#### Scenario: Shared by a duplicate
- **WHEN** an event with an uploaded banner was duplicated and the original is deleted
- **THEN** the file stays because the copy still uses it

#### Scenario: Upload never saved
- **WHEN** an admin uploaded an image, closed the wizard without saving and the server starts more than 24 hours later
- **THEN** the file is deleted on startup

#### Scenario: Fresh upload not yet saved
- **WHEN** the server starts while an unsaved upload is only one hour old
- **THEN** the file is kept
