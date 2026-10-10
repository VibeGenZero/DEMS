# Design-Tokens und Komponenten-Bibliothek — Design Spec
**Datum:** 2026-10-10 · **Ticket:** D-02 (GitLab #51, Prio-Plan `2026-10-07-dems-3.0-prioplan.md`)

## Überblick

`public/css/style.css` hat 3680 Zeilen und 24 CSS-Variablen, die nur Farben, Schrift und Radius abdecken. Daneben stehen 182 fest verdrahtete Farbwerte (139 `rgba()`, 43 Hex), 28 verschiedene Schriftgrößen an 130 Stellen, 9 verschiedene `z-index`-Werte und 57 `!important`-Überschreibungen gegen Bootstrap. 55 Selektoren sind doppelt definiert (Profil-, Info- und Badge-Block; known-issues #18 nennt nur den ersten). Mehrere Farbpaare liegen unter dem AA-Kontrast von 4,5:1: Hilfetext auf Karten 3,72, Weiß auf dem Akzent-Violett 4,23, Weiß auf Rot 3,76, weiße Schrift am hellen Ende der Wartungs-Banner 2,16 und 2,65. Zehn Avatar-Klassen, vier Chip-Klassen und rund ein Dutzend lose Leer-Hinweise zeigen dasselbe in unterschiedlichem Markup.

D-02 legt einen vollständigen Satz Tokens und neun Komponenten an, zeigt beides im Styleguide `#debug` und stellt das bestehende CSS darauf um. Die Seiten selbst werden nicht umgebaut.

Grundlage ist die D-02-Zeile des Prio-Plans; der Tickettext auf GitLab war beim Schreiben nicht abrufbar.

**Ziel:** D-03 bis D-15 bauen Seiten aus fertigen, einheitlichen Bausteinen, und das helle Farbschema (D-15) muss später nur Werte in einer Datei tauschen.

**Erfolgskriterien**
- `public/css/tokens.css` und `public/css/components.css` existieren; `index.html` lädt Bootstrap → `tokens.css` → `components.css` → `style.css`.
- In `components.css` und `style.css` steht kein Farbwert, keine Schriftgröße in px/rem und kein `z-index` ab 10 als Zahl.
- Kein Selektor ist in `components.css` und `style.css` zusammen doppelt definiert (je Media-Kontext); known-issues #18 ist gelöscht.
- Alle Kontrastregeln aus Teil 2 gelten (Test).
- `--font-logo` kommt nur in `.loading-logo` und `.brand-text` vor; `.info-title` steht in Inter.
- `#debug` zeigt alle Tokens und die neun Komponenten und scrollt bei 390 px Breite nicht horizontal.
- Die Zahl der `style`-Attribute und der `!important` steigt nicht (Test mit Obergrenze).
- `npm test` und `npm run test:e2e` sind grün; der Vorher-Nachher-Vergleich zeigt nur Abweichungen aus der Liste „Gewollte sichtbare Änderungen“.
- Keine neue Abhängigkeit, kein Build-Schritt.

**Nicht im Umfang**
- Seiten umbauen oder ihr Markup ändern (D-04 bis D-08). Ausnahmen: die tote Klasse `.glass-modal`, das Toast-Markup und der Styleguide selbst.
- Die 132 `style="…"`-Attribute entfernen und `style-src` verschärfen: neues Ticket D-16 (Teil 8). D-02 liefert nur den Zähl-Test.
- Abstände in Seitenregeln auf die Skala runden.
- `style.css` pro Seite aufteilen.
- Helles Farbschema (D-15), Fokusrahmen, ARIA und `prefers-reduced-motion` (D-03), Avatar überall ausrollen (D-09).

**Entscheidungen (10.10.2026)**
1. Umfang: Grundlage plus Aufräumen; die `style`-Attribute verschwinden mit den Seiten.
2. Ansatz: Tokens speisen Bootstrap. Button, Dialog, Toast und Tabs bleiben Bootstrap-Klassen; Karte, Chip, Leerzustand, Skeleton und Avatar sind eigene Klassen.
3. Hauptbutton: flach (`#7c3aed`, beim Überfahren `#6d28d9`), kein Verlauf.
4. Tabs: Segmente.
5. Karten reagieren nur aufs Überfahren, wenn sie klickbar sind.

---

## Teil 1 — Dateien und Laden

| Datei | Inhalt |
|---|---|
| `public/css/tokens.css` (neu) | Ein einziger `:root`-Block mit allen Tokens. Die einzige CSS-Datei mit Farbwerten, Schriftgrößen und Ebenen als Zahl. |
| `public/css/components.css` (neu) | Bootstrap-Brücke (Teil 3) und die neun Komponenten (Teil 4), jede in einem Block mit Banner-Kommentar |
| `public/css/style.css` | Seiten-Spezifisches, auf Tokens umgestellt, ohne Duplikate (Teil 5) |
| `public/js/core/components.js` (neu) | `avatar()`, `initialsOf()`, `emptyState()` |
| `public/js/core/contrast.js` (neu) | `parseColor()`, `composite()`, `contrastRatio()`; ohne DOM, vom Styleguide und vom Test benutzt |
| `public/js/pages/debug.js` | Styleguide: Tokens und Bestand |
| `public/js/pages/debug-components.js` (neu) | Styleguide: die neun Komponenten |
| `scripts/style-snapshot.js` (neu) | Vorher-Nachher-Vergleich der berechneten Stile (Teil 7) |

`index.html` lädt die drei Stylesheets nacheinander über `<link>`, ohne `@import`, alle mit `?v=3`.

Die 24 bestehenden Variablennamen bleiben (496 Verwendungen). Einzige Umbenennung: `--font-display` → `--font-logo`.

---

## Teil 2 — Tokens

Werte gelten für das dunkle Schema. „neu“ = bisher nicht vorhanden, „geändert“ = neuer Wert.

### Farben

| Gruppe | Token | Wert | |
|---|---|---|---|
| Flächen | `--bg-primary` / `--bg-secondary` / `--bg-card` | `#0a0a0f` / `#12121a` / `#16161f` | |
| | `--bg-glass` / `--bg-glass-hover` | `rgba(22, 22, 31, 0.85)` / `rgba(30, 30, 45, 0.9)` | |
| | `--bg-tint-1` / `-2` / `-3` | Weiß mit 4 % / 8 % / 12 % | neu |
| | `--bg-inset` | `rgba(0, 0, 0, 0.25)` | neu |
| | `--bg-scrim` | `rgba(10, 10, 15, 0.9)` (Navbar, Notfall-Sperre, Banner-Schleier) | neu |
| Text | `--text-primary` / `--text-secondary` | `#e4e4e7` / `#a1a1aa` | |
| | `--text-muted` | `#8f8f9a` | geändert (`#71717a`) |
| Rahmen | `--border-subtle` / `--border-accent` | Weiß 6 % / Violett 30 % | |
| | `--border-strong` | Weiß 14 % | neu |
| Akzent | `--accent` / `--accent-light` / `--accent-dark` | `#8b5cf6` / `#a78bfa` / `#6d28d9` | |
| | `--accent-text` | `#a78bfa` | neu |
| | `--accent-fill` / `--accent-fill-hover` / `--on-accent` | `#7c3aed` / `#6d28d9` / `#ffffff` | neu |
| | `--accent-tint-1` / `-2` | Violett 8 % / 15 % | neu |
| | `--accent-glow` | Violett 40 % | |
| Erfolg | `--success` (Text) | `#22c55e` | |
| | `--success-fill` / `--on-success` | `#22c55e` / `#0a0a0f` | neu |
| Warnung | `--warning` (Text) | `#eab308` | |
| | `--warning-fill` / `--on-warning` | `#eab308` / `#0a0a0f` | neu |
| Info | `--info` (Text) | `#06b6d4` | |
| | `--info-fill` / `--on-info` | `#06b6d4` / `#0a0a0f` | neu |
| Gefahr | `--danger` (Text) | `#f87171` | geändert (`#ef4444`) |
| | `--danger-fill` / `--danger-fill-hover` / `--on-danger` | `#dc2626` / `#b91c1c` / `#ffffff` | neu |
| je Status | `--<status>-bg` / `--<status>-border` | Statusfarbe mit 15 % / 30 % (Gefahr auf Basis `#ef4444`) | neu |
| Discord | `--discord` / `--discord-hover` / `--on-discord` | `#5865f2` / `#4752c4` / `#ffffff` | neu |

`--accent` ist die Markenfarbe für Rahmen, Symbole und Leuchten. Text in Violett nimmt `--accent-text`, weiße Schrift steht auf `--accent-fill`, nie auf `--accent`.

### Kontrastregeln (WCAG AA)

Basisflächen sind `--bg-primary`, `--bg-secondary`, `--bg-card` sowie `--bg-glass` und `--bg-glass-hover` (jeweils über `--bg-primary` gelegt). Textfarben sind `--text-primary`, `--text-secondary`, `--text-muted`, `--accent-text`, `--success`, `--warning`, `--danger`, `--info`.

| Regel | Mindestwert | Schwächstes Paar heute berechnet |
|---|---|---|
| Jede Textfarbe auf jeder Basisfläche | 4,5 | `--text-muted` 5,26 |
| Jede Textfarbe auf `--bg-tint-1` über jeder Basisfläche | 4,5 | `--text-muted` 4,72 |
| `--text-primary` und `--text-secondary` auf `--bg-tint-2` und `--bg-tint-3` | 4,5 | `--text-secondary` 4,56 |
| Statusfarbe und `--accent-text` auf der eigenen Tönung (`-bg`, `--accent-tint-2`) | 4,5 | `--danger` 5,21 |
| `--on-*` auf der zugehörigen Fläche | 4,5 | `--on-discord` 4,61 |
| `--accent` auf jeder Basisfläche (kein Text) | 3,0 | 3,97 |

Daraus folgt die Nutzungsregel: Auf `--bg-tint-2` und `--bg-tint-3` steht nur `--text-primary` oder `--text-secondary`.

### Skalen

| Gruppe | Tokens |
|---|---|
| Schriftgröße | `--font-size-xs` 0.75rem · `-sm` 0.875rem · `-md` 1rem · `-lg` 1.125rem · `-xl` 1.25rem · `-2xl` 1.5rem · `-3xl` 2rem · `-4xl` 2.5rem · `-display` `clamp(2.5rem, 7vw, 4.5rem)` |
| | `--font-size-logo` `clamp(3rem, 8vw, 6rem)` (nur Ladebild) |
| Schrift | `--font-body` (Inter), `--font-logo` (UnifrakturCook, nur Logo) |
| Abstand | `--space-4` 0.25rem · `-8` 0.5rem · `-12` 0.75rem · `-16` 1rem · `-24` 1.5rem · `-32` 2rem · `-48` 3rem · `-64` 4rem (Name = Pixel, damit nichts mit Bootstraps `p-3` verwechselt wird) |
| Radius | `--radius-sm` 8px · `--radius` 12px · `--radius-lg` 16px · `--radius-pill` 999px |
| Ebene | `--z-dropdown` 1000 · `--z-sticky` 1020 · `--z-nav` 1030 · `--z-banner` 1040 · `--z-dialog` 1055 · `--z-toast` 1090 · `--z-overlay` 2000 |
| Schatten | `--shadow-sm` `0 4px 15px rgba(0, 0, 0, 0.3)` · `--shadow-md` `0 8px 24px rgba(0, 0, 0, 0.4)` · `--shadow-lg` `0 20px 60px rgba(0, 0, 0, 0.5)` · `--shadow-glow` (wie heute) · `--shadow-ring` `0 0 0 3px var(--accent-glow)` |
| Bewegung | `--duration-fast` 150ms · `--duration-base` 300ms · `--duration-slow` 600ms · `--ease-standard` `cubic-bezier(0.4, 0, 0.2, 1)` · `--transition` (wie heute, aus den beiden gebildet) |

Die Ebenen folgen Bootstraps eigenen Werten, damit Dialoge, Menüs und Toasts wie bisher übereinander liegen. Lokales Stapeln innerhalb eines Elements (`z-index` von -1 bis 9) bleibt als Zahl erlaubt.

---

## Teil 3 — Bootstrap-Brücke

Bootstrap 5.3.2 gestaltet seine Komponenten über eigene CSS-Variablen. Der erste Block von `components.css` setzt sie aus den Tokens; dadurch entfallen die meisten `!important`.

| Bereich | Gesetzt wird |
|---|---|
| Grundwerte (`[data-bs-theme="dark"]`) | `--bs-body-bg`, `--bs-body-color`, `--bs-body-font-family`, `--bs-secondary-color` (= `--text-secondary`), `--bs-tertiary-color` (= `--text-muted`), `--bs-border-color`, `--bs-border-radius`, `-sm`, `-lg`, `-pill` |
| Links | `a` bekommt `--accent-text` (heute Bootstraps Blau) |
| Buttons | je Variante `--bs-btn-color`, `-bg`, `-border-color` und deren `hover`-, `active`-, `disabled`-Formen; Größen über `--bs-btn-padding-*`, `--bs-btn-font-size`, `--bs-btn-border-radius` |
| Dialog | `--bs-modal-bg`, `-border-color`, `-border-radius`, `-header-border-color`, `-footer-border-color`, `-zindex` |
| Toast | `--bs-toast-bg`, `-color`, `-border-color`, `-border-radius`, `-zindex` |
| Tabs | `--bs-nav-pills-*`, `--bs-nav-link-*` |
| Alerts | `--bs-alert-color`, `-bg`, `-border-color` je `.alert-success`, `-warning`, `-danger`, `-info` |
| Farb-Helfer | `.text-primary`, `-success`, `-warning`, `-danger`, `-info` → Textfarben; `.bg-*` und `.text-bg-*` → Fläche und Schrift darauf |

Bootstraps Farb-Helfer tragen selbst `!important`; nur dort darf `components.css` ebenfalls `!important` verwenden. `.text-muted` zeigt über `--bs-secondary-color` den Wert von `--text-secondary`; für den gedämpften Ton gibt es `.text-body-tertiary`.

Formularfelder sind keine der neun Komponenten: Der bestehende FORMS-Block bleibt in `style.css`, wird auf Tokens umgestellt und verliert `!important`, wo die Ladereihenfolge genügt.

---

## Teil 4 — Komponenten

Alte Klassennamen bleiben als Zweitnamen in derselben Selektorliste gültig (`.chip, .badge-pill { … }`). So gibt es eine Definition, und das Seiten-Markup bleibt unberührt.

| # | Komponente | Klassen | Zweitnamen aus dem Bestand |
|---|---|---|---|
| 1 | Button | `.btn` + `.btn-primary`, `.btn-secondary`, `.btn-ghost` (neu), `.btn-danger`, `.btn-discord`; `.btn-sm` 32 px, Standard 40 px, `.btn-lg` 48 px; `.btn-icon` (quadratisch) | `.btn-accent` = primary; `.btn-outline-light`, `.btn-outline-secondary` = secondary |
| 2 | Karte | `.glass-card`; `.is-clickable` | – |
| 3 | Chip | `.chip` + `.chip-success`, `-warning`, `-danger`, `-info`, `-accent`; `.chip-sm`; als `<button>` klickbar, gewählt mit `.active` | `.badge-pill` (+ `.status-pending`, `-accepted`, `-rejected`, `-waitlisted`), `.category-pill`, `.event-status-badge` (+ `-draft`, `-active`, `-archived`), `.event-category-tag` |
| 4 | Tabs | `.nav.nav-pills` als Segmente, Zähler als `.chip.chip-sm` | – |
| 5 | Dialog | `.modal` mit `.modal-content`, `-header`, `-body`, `-footer` | `.glass-modal` entfällt (Regel und 14 Verwendungen) |
| 6 | Toast | `.toast` + `.toast-success`, `-danger`, `-warning`, `-info` | – |
| 7 | Leerzustand | `.empty-state`, `-icon`, `-title`, `-text` | – |
| 8 | Skeleton | `.skeleton`, `-text`, `-title`, `-img`; neu `-chip`, `-avatar` | – |
| 9 | Avatar | `.avatar` 36 px, `.avatar-sm` 24, `.avatar-lg` 64, `.avatar-xl` 96; `.avatar-initials`; `.avatar-stack`, `.avatar-more` | – (Rollout in D-09) |

**Button.** Einheitlicher Radius (`--radius`, klein `--radius-sm`). Die übrigen Varianten im Bestand (`.btn-outline-primary`, `-success`, `-warning`, `-danger` und `.btn-warning`) bekommen ihre Farben aus den Tokens und stehen im Styleguide unter „Bestand“; `.btn-link` bleibt bei Bootstraps Werten.

**Karte.** Rahmen, Leuchten und Anheben beim Überfahren gelten nur für `.glass-card[data-click]`, `a.glass-card` und `.glass-card.is-clickable`. Dieselbe Regel gilt für Seitenkarten: `.stat-card` und `.info-card` sind statisch und verlieren ihre Hover-Regel; `.profile-reg-card` (Link) und `.event-card` behalten sie.

**Chip.** Neutral: `--bg-tint-2` mit `--text-secondary`. Status: eigene Tönung, eigener Rahmen, Statusfarbe als Text. Gewählter Filter-Chip: `--accent-fill` mit `--on-accent`. `.event-status-badge` und `.event-category-tag` behalten Großschreibung und Sperrung über eine zweizeilige Regel in `style.css`.

**Tabs.** Die Liste bekommt Hintergrund `--bg-tint-1`, Rahmen und Innenabstand; der aktive Eintrag `--accent-tint-2` mit `--text-primary`. Bei Platzmangel scrollt die Liste horizontal, ohne umzubrechen.

**Toast.** `showToast(message, type)` behält seine Signatur. Statt `text-bg-<type>` setzt es `toast-<type>`; daran hängen eine farbige linke Kante und ein Symbol (`bi-check-circle-fill`, `bi-x-circle-fill`, `bi-exclamation-triangle-fill`, `bi-info-circle-fill`) in der Statusfarbe. Das Markup von `#app-toast` bekommt dafür ein Symbol-Element. Heute sehen alle Typen gleich aus, weil `.toast { background: … !important }` die Typfarbe überdeckt.

**Skeleton.** `renderSkeletonEvents` benutzt die neuen Bausteine statt seiner vier `style`-Attribute.

### Helfer in `core/components.js`

| Funktion | Ergebnis |
|---|---|
| `initialsOf(name)` | Anfangsbuchstaben der ersten zwei Wörter, groß; ein Wort → ein Buchstabe; leer → `?` |
| `avatar({ url, name, size })` | Mit `url`: `<img class="avatar …" alt title data-fallback="initials" data-initials>`; ohne: `<span class="avatar avatar-initials …" title>`. `size` ist `sm`, `lg`, `xl` oder fehlt. |
| `emptyState({ icon, title, text, action })` | Block mit Symbol (`bi-<icon>`), Titel, optionalem Text und optionalem Button; `action` ist fertiges Button-Markup des Aufrufers, weil Aktionsnamen wörtlich im Markup stehen müssen (Regel aus D-01) |

Name, Adresse, Titel und Text laufen durch `escapeHtml`; nur `action` wird unverändert eingesetzt. Der Bild-Fallback `initials` in `core/actions.js` erzeugt für `.avatar`-Bilder ein `.avatar.avatar-initials` mit denselben Größenklassen; für Bilder ohne `.avatar` bleibt er, wie er ist.

---

## Teil 5 — Bestand aufräumen

| Bereich | Regel |
|---|---|
| Farben | Jeder Farbwert wird das nächstliegende Token. Violett-Tönungen: bis 10 % → `--accent-tint-1`, 12–25 % → `--accent-tint-2`, 30 % → `--border-accent`, 40 % → `--accent-glow`. Weiß-Tönungen: bis 5 % → `--bg-tint-1`, 6–8 % → `--bg-tint-2`, ab 10 % → `--bg-tint-3`; als Rahmen `--border-subtle` oder `--border-strong`. Status-Tönungen: bis 20 % → `-bg`, ab 30 % → `-border`. |
| Verläufe | Bleiben, bestehen aber aus Tokens. Steht Text darauf, beginnen sie bei `--accent-fill`. |
| Schriftgrößen | Unter 0.8rem → `xs`; 0.8–0.9 → `sm`; 0.95–1 → `md`; 1.1–1.2 → `lg`; 1.3–1.35 → `xl`; 1.4–1.6 → `2xl`; 1.8–2 → `3xl`; 2.5 → `4xl`; größer → `display`. Die beiden `clamp()`-Größen werden `--font-size-display` (Info-Titel) und `--font-size-logo` (Ladebild). Angaben in `em` bleiben. |
| Ebenen | 1000–1050 und 9999/10000 werden Tokens: Wartungs-Banner `--z-banner` (geplante Wartung eine Stufe darunter per `calc`), Ort-Vorschläge `--z-dropdown`, Notfall-Sperre `--z-overlay`, Ladebild eine Stufe darüber. |
| Radien | 6–10 px → `--radius-sm`; 20 px → `--radius-lg`; 99/999 px → `--radius-pill`; 2–4 px an Balken → `--radius-pill`, sonst `--radius-sm`; `50%` bleibt. |
| Schatten, Übergänge | Schatten mit eigenem Farbwert werden Schatten-Tokens; Leuchten aus `var(--accent-glow)` bleiben. Dauern runden auf `fast`, `base`, `slow`. |
| Wartungs-Banner | Wartung: `--warning-fill` mit `--on-warning`; geplante Wartung: `--info-fill` mit `--on-info` (heute weiße Schrift auf Orange- und Blau-Verlauf, am hellen Ende 2,16 und 2,65). |
| Duplikate | Jeder der 55 doppelten Selektoren wird eine Regel mit dem heute wirksamen Ergebnis: je Eigenschaft gewinnt die spätere Definition, Eigenschaften nur aus dem früheren Block bleiben erhalten. |
| Umzug | Die Blöcke BUTTONS, GLASS CARDS, CATEGORY PILLS, BADGES, TOAST und SKELETON LOADING ziehen nach `components.css`. |
| Abstände | Bleiben in Seitenregeln unverändert. |

### Gewollte sichtbare Änderungen

- Hilfetext, violetter Text, Fehlertext und Gefahr-Button in den neuen Farben; Links violett statt blau.
- Hauptbutton flach statt Verlauf; alle Buttons 40 px hoch (klein 32, groß 48) mit einheitlichem Radius.
- Toasts mit Symbol und farbiger Kante; Dialoge einheitlich.
- Statische Karten reagieren nicht mehr aufs Überfahren.
- Schriftgrößen auf der Skala (kleinste 12 px statt 8,8 px), Tönungen und Radien auf weniger Stufen.
- `.info-title` in Inter; Wartungs-Banner in Statusfarben mit dunkler Schrift.

---

## Teil 6 — Styleguide `#debug`

Sichtbar nur mit `DEBUG_MODE=true`, wie bisher. `#debug-section` in `index.html` enthält nur noch Kopf und drei Container.

| Teil | Container | Inhalt |
|---|---|---|
| Tokens | `#sg-tokens` | Farben (Wert und live berechneter Kontrast auf den Basisflächen), Schriftgrößen, Abstände, Radien, Ebenen, Schatten. `debug.js` liest die Namen aus dem `:root`-Block von `tokens.css` und gruppiert sie nach Präfix. |
| Komponenten | `#sg-components` | Neun Blöcke `#sg-button`, `#sg-card`, `#sg-chip`, `#sg-tabs`, `#sg-dialog`, `#sg-toast`, `#sg-empty-state`, `#sg-skeleton`, `#sg-avatar`, jeweils alle Varianten und Zustände mit Klassennamen. Dialog und Toast lassen sich über einen Button auslösen. |
| Bestand | `#sg-legacy` | Formulare, Alerts, Spinner, Animationen, Icons, übrige Button-Varianten, `stat-card` und Profilkarten |

Neuer Styleguide-Code verwendet keine `style`-Attribute; Farbfelder setzen ihren Wert per `element.style.setProperty`.

---

## Teil 7 — Tests und Verifikation

Alle Tests entstehen vor dem jeweiligen Code (`node:test`).

| Datei | Prüft |
|---|---|
| `test/designTokens.test.js` | Pflicht-Tokens aus Teil 2 vorhanden; Kontrastregeln; `contrast.js` (Hex, `rgb()`, `rgba()`, Überlagerung) |
| `test/cssRules.test.js` | Außerhalb von `tokens.css`: kein Farbwert, keine Schriftgröße in px/rem, kein `z-index` ab 10 als Zahl, kein Radius in px. Kein doppelter Selektor. Komponenten-Selektoren stehen in `components.css` und nicht noch einmal in `style.css`. `--font-logo` nur in den Logo-Regeln. Ladereihenfolge und `?v=` in `index.html`. Obergrenzen für `style`-Attribute (`index.html` und `public/js`) und `!important`. |
| `test/cssSource.js` (+ `cssSource.test.js`) | Kleiner CSS-Leser für die beiden Tests (Kommentare entfernen, Regeln und Media-Kontext trennen), ohne Abhängigkeit |
| `test/contrast.test.js`, `test/styleSnapshot.test.js` | Kontrastrechnung; Vergleichslogik des Snapshot-Skripts |
| `test/components.test.js` | `initialsOf`, `avatar`, `emptyState`: Escaping, Größen, Fallback-Attribute; `showToast` setzt Typklasse und Symbol |
| `test/styleguide.test.js` | Die neun Block-Ids kommen im Styleguide-Code vor |
| `e2e/styleguide.spec.js` | `#debug` auf Desktop und 390 px: alle neun Blöcke sichtbar, kein horizontales Scrollen, kein Konsolen- oder CSP-Fehler, Toast-Typen unterscheidbar |

„Doppelt“ heißt: Dieselbe Selektorliste steht im selben Media-Kontext mehr als einmal, über `components.css` und `style.css` hinweg. So wurden auch die 55 heutigen Fälle gezählt.

Die Obergrenzen stehen als Konstante im Test und entsprechen dem Stand nach dem Umbau (heute 132 `style`-Attribute und 57 `!important`). Wer welche entfernt, senkt die Konstante.

`playwright.config.js` startet den Test-Server zusätzlich mit `DEBUG_MODE=true`. Die bestehende Tour muss damit grün bleiben.

**Vorher-Nachher-Vergleich.** `node scripts/style-snapshot.js --out <datei>` startet den Mock-Server auf eigenem Port mit frischer Datenbank, meldet sich als Admin an, besucht Events, eine Event-Seite, Abstimmungen, Profil, Admin, Bot-Zentrale und Info bei 1440 und 390 px und schreibt danach je Element des ganzen Dokuments (auch der verborgenen Dialoge) die berechneten Werte für Farbe, Hintergrund, Rahmen, Schrift, Radius, Abstand, Schatten und Ebene. `#debug` bleibt außen vor, weil der Styleguide komplett neu entsteht. `--compare <vorher> <nachher>` listet die Abweichungen nach Eigenschaft und Selektor. Ein Lauf vor dem Umbau, einer danach; die Liste kommt in die Merge-Request-Beschreibung. Kein Teil von `npm test`.

---

## Teil 8 — Doku

| Stelle | Änderung |
|---|---|
| `docs/wiki/modules/frontend-markup.md` | Drei CSS-Dateien, Token-Gruppen, Komponenten-Tabelle mit Zweitnamen, Regeln (Tokens statt Werte, Kontrastregel, Hover nur bei Aktion) |
| `docs/wiki/modules/frontend-app.md` | `core/components.js`, `core/contrast.js`, `pages/debug-components.js` |
| `docs/wiki/ops/testing.md` | Neue Tests, `style-snapshot.js`, `DEBUG_MODE` im Browser-Test |
| `docs/wiki/concepts/security.md` | `style-src 'unsafe-inline'` bleibt bis D-16 |
| `docs/wiki/reference/known-issues.md` | #18 entfällt |
| `docs/wiki/index.md`, `graph.json` | Neue Dateien in der Datei → Knoten-Tabelle; `npm run wiki` |
| `CLAUDE.md` | Frontend-Regel „Tokens und Komponenten verwenden, keine Werte außerhalb von `tokens.css`“; Zeilenzahlen unter „Save tokens“ |
| `server.js` | Kommentar an `styleSrc` verweist auf D-16 statt D-02 |
| Prio-Plan | Neue Zeile D-16 |

**D-16 (neu, P1, Größe S, nach D-04, D-05, D-07, D-08):** „`style`-Attribute entfernen, CSP für Stile verschärfen“. Die D-01-Spec hatte das für D-02 angekündigt; es wandert dorthin, weil die betroffenen Seiten vorher neu gebaut werden. Fertig, wenn die Obergrenze im Zähl-Test bei 0 steht und der Server `style-src 'self'` mit `style-src-attr 'none'` schickt. Das GitLab-Ticket legt Lyonel an.

---

## Risiken

| Risiko | Umgang |
|---|---|
| Runden im Bestand verändert eine Seite ungewollt. | Vorher-Nachher-Vergleich; jede Abweichung muss zu „Gewollte sichtbare Änderungen“ passen. |
| Zusammengeführte Duplikate verschieben die Kaskade. | Regel bleibt an der Position des späteren Blocks; der Vergleich deckt Abweichungen auf. |
| Eine Bootstrap-Komponente bietet keine Variable für eine Eigenschaft. | Gezielte Regel in der Brücke, nach Bootstrap geladen; `!important` nur gegen Bootstraps eigene `!important`-Helfer. |
| `DEBUG_MODE=true` im Browser-Test verändert die Tour. | Tour läuft vor dem Zusammenführen auf beiden Viewports; schlägt sie fehl, bekommt der Styleguide-Test einen eigenen Server. |
