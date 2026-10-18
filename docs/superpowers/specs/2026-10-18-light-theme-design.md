# Helles Farbschema — Design Spec
**Datum:** 2026-10-18 · **Ticket:** D-15 (GitLab #64, Prio-Plan `2026-10-07-dems-3.0-prioplan.md`, Entscheidung 7) · **Abhängig von:** D-02 (Tokens und Komponenten), D-03 (AA-Kontrast); berührt D-08 (Profil, Karte „Einstellungen“)

## Überblick

DEMS hat nur ein dunkles Schema. Seit D-02 stehen alle Farben, Schatten und Tönungen als Tokens in `public/css/tokens.css` (ein `:root`-Block); `components.css` und `style.css` enthalten keine rohen Farbwerte (`test/cssRules.test.js` prüft das), und `test/designTokens.test.js` prüft den AA-Kontrast der Tokens. Ein zweites Schema heißt deshalb vor allem: zweiter Satz Farb-Tokens plus Umschalter.

Was heute trotzdem fest „dunkel“ ist:
- `<html data-bs-theme="dark">` ist fest im Markup; die Bootstrap-Brücke in `components.css` hängt am Selektor `[data-bs-theme="dark"]`.
- Bootstrap-Klassen, die helle Schrift oder dunklen Grund erzwingen: `navbar-dark` (1×), `text-light` (1×), `text-white` (2×), `text-white-50` (8×), `bg-dark` (3×), `table-dark` (4×), `btn-close-white` (15×) in `public/index.html` und `public/js/`.
- Der Datumswähler lädt immer `public/vendor/flatpickr/dark.css`.
- Der Styleguide (`#debug`, `pages/debug.js`) liest nur Regeln mit dem Selektor `:root` aus `tokens.css`.

**Ziel:** Wer DEMS lieber hell nutzt, bekommt eine helle Oberfläche im Stil von Discord hell, in der alles lesbar ist und nichts dunkel „übrig bleibt“. Standard ist die Systemeinstellung; die eigene Wahl trifft man im Profil.

**Erfolgskriterien**
- Mit hellem System (oder Wahl „Hell“) ist jede Seite hell: Login, Event-Übersicht, Event-Seite, Abstimmungen, Profil, Admin, Bot-Zentrale, Info, Styleguide, Ladebildschirm, Dialoge, Toasts, Menüs, Formulare, Tabellen, Datumswähler und Markdown-Editor.
- Beim Neuladen mit gespeicherter Wahl „Hell“ blitzt kein dunkles Bild auf (kein Flackern vor dem ersten Zeichnen).
- Wahl „System“ folgt einer Änderung der Systemeinstellung live, ohne Neuladen.
- Alle Kontrast-Prüfungen aus `test/designTokens.test.js` laufen für beide Schemata und sind grün.
- Keine der oben genannten Dunkel-Klassen steht mehr in `public/index.html` oder `public/js/`; ein Test hält das fest.
- `npm test` und `npm run test:e2e` sind grün; keine neue Abhängigkeit.

**Nicht im Umfang**
- Speicherung der Wahl im Account oder Sync zwischen Geräten (Ticket: „wird im Browser gespeichert“).
- Umschalter in der Navbar oder auf der Login-Seite.
- Helle Discord-Vorschau im Event-Assistenten; die Landingpage (`landing/`); Event-Banner und ihre Farbverläufe (`events/detail.js`); Akzentfarbe pro Event.
- Hochkontrast-Modus, weitere Schemata, Handy-spezifische Arbeit (siehe D-05).

**Darf nicht passieren**
- Weiße oder hellgraue Schrift auf hellem Grund irgendwo in der App, auch in selten besuchten Ecken (Wartungs-Reset-Dialog, Panic-Lockdown, Discord-Import, Gästesuche).
- Ein dunkler Blitz beim Laden oder ein halb animierter Wechsel, bei dem einige Flächen langsam überblenden und andere springen.
- Das dunkle Schema sieht danach spürbar anders aus als heute. Kleine Verschiebungen dort, wo eine feste Dunkel-Klasse durch ein Token gleicher Bedeutung ersetzt wird, sind erlaubt (Entscheidung 9) und werden im MR aufgelistet.

**Entscheidungen (18.10.2026)**
1. Helle Optik wie Discord hell, Variante „graue Seite, weiße Karten“: Seite in Discord-Grau, Karten weiß mit feinem Rand und weichem Schatten, Text in Discords Dunkelgrau, Violett bleibt Akzent (Buttons, Links, aktive Zustände).
2. Drei Wahlmöglichkeiten: Hell, Dunkel, System. Standard ist System (`prefers-color-scheme`).
3. Der Umschalter sitzt im Profil: neue erste Zeile „Darstellung“ in der Karte „Einstellungen“ (`#account-settings-card`) mit drei Vorschau-Kacheln Hell / Dunkel / System.
4. Die Wahl speichert nur der Browser (`localStorage`). Ausgeloggt (Login-Seite) gilt die gespeicherte Wahl, sonst System.
5. Alles folgt dem Schema: Ladebildschirm, Wartungs- und Lockdown-Banner, Dialoge, Toasts, Menüs, Formulare, Datumswähler, Editor.
6. Die Discord-Vorschau im Event-Assistenten bleibt dunkel (sie zeigt Discords Aussehen; die `--discord-*`-Tokens gelten in beiden Schemata).
7. Der Wechsel geschieht sofort, ohne Überblendung.
8. Der Styleguide zeigt Tokens und Kontrast des gerade aktiven Schemas.
9. Dunkel muss nicht pixelgleich bleiben: Feste Dunkel-Klassen werden nach Bedeutung durch vorhandene Tokens ersetzt (z. B. `text-white-50` → `--text-secondary`, `bg-dark` → Kartenfläche), auch wenn sich das dunkle Schema dort minimal verschiebt. Keine Extra-Tokens, die Bootstraps heutige Dunkelwerte nachbauen. Die Verschiebungen stehen im MR.

## Teil 1 · Tokens für zwei Schemata

`tokens.css` bekommt einen zweiten Satz Farb- und Schatten-Tokens. Ein Attribut am `<html>` steuert beides, DEMS-Tokens und Bootstrap 5.3: `data-bs-theme="dark"` oder `"light"`.

Aufbau (Entscheidung des Builders im Detail, aber mit diesen Eigenschaften):
- Nicht-Farb-Tokens (Schrift, Abstände, Radien, Ebenen, Motion) stehen einmal in `:root`.
- Die dunklen Farb- und Schatten-Tokens gelten für `:root` und `[data-bs-theme="dark"]`, die hellen für `[data-bs-theme="light"]` — also nicht nur am `<html>`, sondern an jedem Element. So kann ein Teilbaum ein Schema erzwingen; das nutzen die Vorschau-Kacheln im Profil (Teil 4). *(meine Entscheidung)*
- Im hellen Block stehen nur Tokens, deren Wert sich ändert. Die `--discord-*`-Tokens bleiben nur im dunklen/`:root`-Block (Entscheidung 6).
- Der Kopfkommentar „Design tokens (dark scheme)“ wird angepasst.

**Startpalette hell** (Ausgangspunkt; die Kontrast-Tests entscheiden, einzelne Werte darf der Builder nachziehen):

| Token | Wert | Herkunft |
|---|---|---|
| `--bg-primary` | `#f2f3f5` | Discord hell, Seitengrau |
| `--bg-secondary` | `#ebedef` | Discord hell |
| `--bg-card` | `#ffffff` | weiße Karten |
| `--bg-glass` / `-hover` | `rgba(255, 255, 255, 0.85)` / `rgba(255, 255, 255, 0.95)` | Navbar, Glas-Flächen |
| `--bg-tint-1/2/3` | `rgba(0, 0, 0, 0.03/0.06/0.10)` | Tönungen werden dunkel statt weiß |
| `--bg-inset` | `rgba(0, 0, 0, 0.04)` | |
| `--bg-scrim` | `rgba(242, 243, 245, 0.9)` | |
| `--text-primary` / `-secondary` / `-muted` | `#313338` / `#4e5058` / `#5c5e66` | Discord hell |
| `--border-subtle` / `-strong` | `rgba(0, 0, 0, 0.08)` / `rgba(0, 0, 0, 0.16)` | entspricht `#e3e5e8` auf Weiß |
| `--border-accent` | `rgba(124, 58, 237, 0.35)` | |
| `--accent` / `--accent-text` | `#7c3aed` / `#6d28d9` | Violett, auf Hell dunkler gewählt |
| `--accent-fill` / `-hover` / `--on-accent` | `#7c3aed` / `#6d28d9` / `#ffffff` | wie dunkel |
| `--accent-tint-1/2`, `--accent-glow` | `rgba(124, 58, 237, 0.06/0.12)`, `rgba(124, 58, 237, 0.3)` | |
| Status-Text | success `#15803d`, warning `#a16207`, danger `#b91c1c`, info `#0e7490` | dunklere Töne für AA auf Hell |
| Status-Tönungen/-Ränder | wie dunkel, Deckkraft nach Bedarf | |
| Status-Flächen | success `#15803d` + `#ffffff`, warning `#eab308` + `#0a0a0f`, danger `#dc2626` / `#b91c1c` + `#ffffff`, info `#0e7490` + `#ffffff` | |
| Schatten | `--shadow-sm` `0 1px 3px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.04)`, `-md`/`-lg` entsprechend weicher als dunkel, `--shadow-glow` schwächer | „weicher Schatten“ aus Entscheidung 1 |

Die Brand-Regel bleibt: `--accent` ≥ 3:1 als Nicht-Text-Farbe, alle Textfarben ≥ 4,5:1.

## Teil 2 · Schema wählen, anwenden, merken

**Speicher:** `localStorage`-Schlüssel `dems_theme` mit `light`, `dark` oder `system`; fehlt er oder ist er ungültig, gilt `system`. Lesen und Schreiben in `try/catch` (gesperrter Speicher → System, Wahl gilt nur bis zum Neuladen).

**Auflösen:** `system` → `matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'`. Das Ergebnis kommt als `data-bs-theme` an `document.documentElement`.

**Vor dem ersten Zeichnen:** Ein kleines klassisches Skript (kein ES-Modul, denn Module laufen verzögert) aus `'self'` wird synchron im `<head>` vor den Stylesheets geladen und setzt das Attribut. Die CSP bleibt unverändert (kein Inline-Skript). Das feste `data-bs-theme="dark"` im Markup bleibt als Rückfall, falls das Skript nicht läuft.

**Live:** Bei Wahl `system` hört DEMS auf das `change`-Ereignis der Media-Query und wechselt sofort. Bei `light`/`dark` wird das Ereignis ignoriert.

**Sofortiger Wechsel (Entscheidung 7):** Viele Elemente haben `transition: var(--transition)` (`all 300ms`). Damit beim Umschalten nicht einige Flächen überblenden, schaltet DEMS Übergänge für den Wechsel kurz ab (z. B. eine Klasse am `<html>` für einen Frame). Wie, entscheidet der Builder; das `!important`-Budget in `cssRules.test.js` darf dabei nicht steigen.

**Code-Aufteilung** (Builder): Die Logik (gültige Werte, Auflösen, Lesen/Schreiben) soll ohne Browser testbar sein (`node:test`, wie die anderen Frontend-Module über `test/helpers.js`). Ob das Boot-Skript und ein Modul `core/theme.js` sich die Logik teilen (z. B. über ein kleines globales Objekt des Boot-Skripts) oder das Modul sie dupliziert, ist offen; Doppelung nur, wenn ein Test beide gleich hält.

## Teil 3 · Bootstrap und feste Dunkel-Stellen

- **Brücke:** `[data-bs-theme="dark"] { --bs-body-* … }` in `components.css` gilt künftig für beide Schemata (z. B. `[data-bs-theme]`). `COMPONENT_SELECTORS` in `cssRules.test.js` wird angepasst.
- **Klassen ersetzen** (Ersatz nach Bedeutung, Vorschläge):
  - `navbar-dark` → entfernen; Navbar-Farben kommen aus den Tokens (prüfen, dass Toggler-Icon und Links in beiden Schemata sichtbar sind).
  - `text-light`, `text-white` → entfernen oder `text-body`; `text-white-50` → `text-secondary`.
  - `bg-dark` (Dialog `modal-content`, Gästesuche in `events/guests.js`) → Token-Fläche (`bg-card`/`list-group`-Brücke), `border-secondary` prüfen.
  - `table-dark` → `table` mit der bestehenden Token-Brücke (`.table-dark`-Regeln in `style.css` werden auf die neue Klasse umgezogen, die Optik im Dunkeln bleibt).
  - `btn-close-white` → `btn-close`; Bootstrap 5.3 färbt es über `data-bs-theme` selbst richtig.
- **Wächter-Test:** keine dieser sieben Klassen mehr in `public/index.html` und `public/js/` (wie der Test für `glass-modal`).
- **Datumswähler:** `flatpickr/dark.css` darf nur im dunklen Schema wirken (z. B. `<link id="…">`, dessen `disabled` die Schema-Logik setzt, oder Token-Overrides statt der Vendor-Datei). Im hellen Schema gilt flatpickrs Grundstil.
- **Editor (EasyMDE/CodeMirror):** ist in `style.css` schon über Tokens gestylt; prüfen, dass Toolbar, Cursor und Auswahl in Hell sichtbar sind.
- **Rest:** Beim Durchgang durch alle Seiten (Teil 6) auffallende Stellen, die sich auf „dunkler Grund“ verlassen (z. B. `rgba(255,255,255,…)` als Token-Missbrauch, Glows, `color-scheme`), werden mit Tokens gelöst, nicht mit Sonderregeln pro Schema in `style.css`. Wo eine schema-spezifische Regel unvermeidbar ist, gehört der Wert als Token in `tokens.css`.

## Teil 4 · Umschalter im Profil

Neue erste Zeile in `#account-settings-card`, vor „Einladungen erhalten“, getrennt durch die vorhandene `<hr>`-Optik:

- Titel „Darstellung“, Hinweis „Gilt nur in diesem Browser.“ (Stil wie die anderen Zeilen: `fw-semibold` + `small text-muted`).
- Darunter drei Kacheln nebeneinander: **Hell**, **Dunkel**, **System**. Jede Kachel zeigt eine kleine Vorschau (Kopfstreifen + Fläche) und die Beschriftung. Hell und Dunkel nutzen die Tokens ihres Schemas über ein lokales `data-bs-theme` an der Vorschau (Teil 1); System zeigt beide Hälften nebeneinander.
- Technisch eine echte Radiogruppe (`<input type="radio" name="…">` + `<label>`), Tastatur-bedienbar, sichtbarer Fokus (`--shadow-ring`). Die aktive Kachel hat Akzent-Rand und -Tönung wie im Mockup.
- Auswahl wirkt sofort (Teil 2), ohne Speichern-Knopf und ohne Server-Aufruf; keine Toast-Meldung nötig.
- Aktion über `data-change` + `registerActions` im zuständigen Modul (`pages/profile.js` oder `core/theme.js`), kein Inline-Handler, keine `style`-Attribute.
- Beim Öffnen des Profils ist die gespeicherte Wahl markiert.

## Teil 5 · Styleguide

- `readTokenNames()` in `pages/debug.js` liest die Token-Namen nicht mehr nur aus `:root`-Regeln, sondern aus allen Regeln von `tokens.css`.
- Werte und Kontrast-Hinweise kommen wie heute aus `getComputedStyle` und zeigen damit das aktive Schema. Wechselt das Schema, während `#debug` offen ist, werden die Tokens neu gerendert (oder der Styleguide sagt, dass ein Neuladen nötig ist — Builder).

## Teil 6 · Tests und Prüfung

- **Token-Tests:** `test/cssSource.js` bekommt einen Leser für die Tokens eines Schemas (dunkel = `:root` + dunkler Block, hell = dunkel überlagert mit dem hellen Block). Alle Kontrast-Tests in `designTokens.test.js` laufen für beide Schemata; die Discord-Vorschau-Prüfung bleibt einmalig. „Jedes Pflicht-Token ist definiert“ gilt für beide.
- **Schema-Logik:** Unit-Tests für Auflösen (light/dark/system × Systemwert), ungültige/fehlende Speicherwerte, gesperrten Speicher.
- **Wächter:** Dunkel-Klassen (Teil 3); das Boot-Skript steht im `<head>` vor dem ersten Stylesheet (`frontendLoader`/`cssRules`-Test).
- **E2E (Playwright):** Playwright emuliert standardmäßig `colorScheme: 'light'`; mit Standard „System“ würde die bestehende Suite still auf Hell wechseln. Die bestehende Suite wird deshalb auf `colorScheme: 'dark'` festgelegt, dazu kommen eigene Hell-Prüfungen: mit `colorScheme: 'light'` hat `<html>` `data-bs-theme="light"`; Wahl „Dunkel“ im Profil schaltet sofort und übersteht ein Neuladen; Wahl „System“ folgt `page.emulateMedia({ colorScheme })`. Kein zweiter kompletter Rundgang in Hell; den deckt der Browser-Durchgang ab. *(meine Entscheidung)* `scripts/style-snapshot.js` erzwingt ebenfalls Dunkel.
- **Browser-Durchgang** im Mock-Modus, beide Schemata, Desktop: alle Seiten aus den Erfolgskriterien, Personas `admin` und `member`, inkl. Dialoge (Event-Assistent, Wartung, Löschen), Toasts, Datumswähler, Editor, Login-Seite. Gefundene Stellen werden mit Tokens behoben.
- **Dunkel unverändert:** `scripts/style-snapshot.js` vergleicht berechnete Stile des dunklen Schemas gegen `origin/main` (wie bei D-02); erwartete Unterschiede nur dort, wo Klassen ersetzt wurden, und die werden im MR genannt.

## Wiki

- `docs/wiki/modules/frontend-markup.md`: Tokens in zwei Schemata, Selektoren, Brücke, ersetzte Bootstrap-Klassen, Regel „schema-spezifische Werte nur als Token“.
- `docs/wiki/modules/frontend-app.md`: Boot-Skript, `core/theme.js` (oder wo die Logik landet), `localStorage.dems_theme`, Profil-Zeile „Darstellung“.
- Danach `npm run wiki`.

## Dem Builder überlassen

- Exakte Werte der hellen Palette innerhalb der Kontrast-Regeln und der Optik aus Entscheidung 1.
- Dateiname und Form des Boot-Skripts; wie Boot-Skript und Modul sich die Logik teilen.
- Technik für den Wechsel ohne Übergänge.
- Technik, um `flatpickr/dark.css` im hellen Schema abzuschalten.
- Ersatzklassen im Detail, im Rahmen von Entscheidung 9.
