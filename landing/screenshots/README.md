# Screenshots

Lege hier deine Screenshots für die Galerie auf der Landing Page ab.

## Dateinamen-Konvention

| Kategorie   | Beispiel-Dateiname              |
|-------------|--------------------------------|
| Dashboard   | `dashboard-overview.png`        |
| Dashboard   | `dashboard-profile.png`         |
| Events      | `events-detail.png`             |
| Events      | `events-create.png`             |
| Admin       | `admin-dashboard.png`           |
| Admin       | `admin-auditlog.png`            |
| Bot         | `bot-control.png`               |
| Bot         | `bot-discord-messages.png`      |

## Empfohlene Maße

- **Format:** PNG oder WebP
- **Auflösung:** 1280×800 px (16:10) oder 1920×1080 px (16:9)
- **Max. Dateigröße:** ~500 KB pro Bild

## Einbinden in index.html

Ersetze die `screenshot-placeholder`-Divs durch echte `<img>`-Tags:

```html
<div class="gallery-preview">
    <img src="screenshots/dashboard-overview.png" alt="Event-Uebersicht" loading="lazy">
    ...
</div>
```
