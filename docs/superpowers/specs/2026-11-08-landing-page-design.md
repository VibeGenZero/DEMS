# Landing-Page für DEMS — Design Spec
**Datum:** 2026-11-08 · **Branch:** `chore/landing-page` (von `release/3.0`) · **Ersetzt:** die alte Seite in `landing/`

## Überblick

In `landing/` liegt eine ältere Landing-Page (`index.html`, `style.css`, `script.js`, `screenshots/`). Sie sieht aus wie DEMS vor 3.0: Inter und Font Awesome von CDNs, eigene Farben statt der Tokens aus `public/css/tokens.css`, Screenshots der alten Oberfläche. Sie ist im Git.

**Ziel:** Eine neue Landing-Page, die Betreiber großer Discord-Server überzeugt, DEMS selbst zu hosten. Sie sieht aus wie die App selbst, hat einen starken animierten Einstieg und lebt nur lokal beim Betreiber des Projekts: `landing/` kommt in die `.gitignore`.

## Zielgruppe und Botschaft

- **Wer:** Betreiber großer Discord-Server, die regelmäßig Events planen (Raids, Spieleabende, Turniere, Community-Treffen) und DEMS noch nicht kennen.
- **Schmerz (Aussage des Betreibers):** Die Events, die Discord selbst anbietet, sind sehr minimalistisch, besonders bei Rollen: Man kann kaum steuern, wer an welchem Event teilnehmen darf.
- **Botschaft:** Discord-Events sind ein Kalendereintrag – DEMS regelt, wer mitdarf, wer wirklich kommt und wer wen mitbringt.
- **Was der Besucher tun soll:** DEMS selbst hosten. DEMS ist Open Source (MIT) und kostenlos. Dafür gibt es genau **einen** Hauptknopf: **„Auf GitHub ansehen“**. Von dort holt man sich das Docker-Image oder geht weiter zu Docker Hub.

## Entscheidungen des Betreibers

1. **Hero-Animation:** Logo und voller Name stehen animiert da und rutschen dann sanft zu **DEMS** zusammen. Gewählte Variante: „B“. Der Name „Dein Event-Management-System“ steht in Inter; alle Buchstaben außer den Anfangsbuchstaben D, E, M, S steigen verschwommen nach oben weg, die vier rutschen zusammen und werden zum Wortlogo.
2. **Logo-Schrift:** keine Fraktur, sondern **Space Grotesk** (Bold) für das Wortlogo DEMS und die Überschriften.
3. **Stil:** derselbe wie das Projekt (Farben, Akzent-Lila, Inter, Komponenten-Look der App).
4. **Selbst-Hosting:** Betreiber hosten DEMS selbst, zum Beispiel bei Hostinger. Der Betreiber bekommt einen Promo-Link von Hostinger und trägt ihn später ein.
5. **Ein Hauptknopf:** „Auf GitHub ansehen“ (oben im Hero und im Abschluss). Hostinger erscheint nur als Empfehlung in Schritt 1 der Anleitung.
6. **Ort:** Die neue Seite ersetzt den Inhalt von `landing/`. `landing/` kommt in die `.gitignore` und wird aus dem Repo entfernt (`git rm -r --cached landing`); die Dateien bleiben lokal, die alte Fassung bleibt in der Git-Historie.
7. **Open Source:** DEMS wird Open Source unter der MIT-Lizenz (`LICENSE` liegt im Repo). Der Betreiber macht das GitHub-Repo `VibeGenZero/DEMS` und das Docker-Image `moritakahashi/dems` vor dem Start der Seite öffentlich; der GitHub-Knopf führt also auf ein öffentliches Repo, `docker pull` geht ohne Login.

## Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**
- Eine statische Seite (HTML, CSS, JS), die man ohne Build-Schritt öffnen oder auf jeden Static-Host legen kann.
- Wirkt auf den ersten Blick wie DEMS: dunkler Grund, Lila-Akzent, Inter, Bootstrap Icons, Space Grotesk für Logo und Überschriften.
- Hochwertige, ruhige Animationen: der Logo-Übergang im Hero, Einblendungen beim Scrollen, ein animierter Vergleich und eine kleine animierte Discord-Szene.
- Deutsch für alle Texte.
- Läuft mobil gut (ab 360 px Breite), ohne horizontales Scrollen.

**Nicht-Ziele**
- Kein Teil der App: Die Seite wird nicht von `server.js` ausgeliefert, nicht ins Docker-Image gebaut (`landing/` steht schon in `.dockerignore`) und nicht von `npm test` geprüft.
- Kein Anmelde-, Kontakt- oder Newsletter-Formular, kein Tracking, keine Cookies.
- Keine Übersetzung ins Englische.
- Kein Build-Werkzeug (Tailwind, Bundler, Framework).

**Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)**
- Die Seite sieht aus wie eine generische SaaS-Vorlage statt wie DEMS.
- Animationen sind hektisch, blockieren das Lesen oder lassen sich nicht abschalten; der Text ist erst nach der Animation lesbar.
- Der Name „Discord“ steht im Produktnamen oder Logo (Markenregel des Projekts: Discord nur zur Beschreibung der Anbindung, siehe `test/branding.test.js` und `docs/wiki/reference/decisions.md`).
- Externe Abhängigkeiten zur Laufzeit (CDN-Schriften, CDN-Skripte, Font Awesome), sodass die Seite offline oder mit strenger CSP kaputtgeht.
- Mehr als ein Hauptknopf konkurriert um Aufmerksamkeit.

## Aufbau der Seite

1. **Kopfleiste (fest, glasig):** links das kleine DEMS-Wortlogo, rechts Anker-Links (Funktionen, Selbst hosten, FAQ) und der GitHub-Knopf als kleine Variante. Auf Mobil wird die Link-Liste zu einem Menü-Knopf.
2. **Hero:** Animation laut Entscheidung 1, danach ein kurzer Slogan, ein kleiner Chip „Open Source · MIT-Lizenz“ und darunter der Hauptknopf „Auf GitHub ansehen“ (Icon `bi-github`). Im Hintergrund ein weicher Lila-Schein wie im Ladebildschirm der App. Dazu ein dezenter Hinweis zum Weiterscrollen.
3. **Das Problem:** zwei, drei Sätze. Kernaussage: Discord-Events sind ein Kalendereintrag; Zugang, Plätze und Aufstellung regelt man heute per Hand.
4. **Vergleich Discord-Event ↔ DEMS:** Tabelle oder zwei Spalten mit Zeilen, die beim Scrollen nacheinander einklappen:
   - Zugang: jeder ↔ nur bestimmte Rollen, Freigabe durch Admins
   - Plätze: keine Grenze ↔ Teilnehmerlimit, Warteliste mit Nachrücken samt Bestätigung
   - Aufstellung: – ↔ Rollen-Slots (Tank, Heiler, …) mit Ausweichrolle
   - Anmeldung: „Interessiert“ ↔ Formular mit Pflichtfeldern, „Vielleicht“, Gäste
   - Danach: – ↔ Erinnerungen per DM, Check-in, Ankündigung, die sich selbst aktualisiert

   Die Spalte „Discord-Event“ meint die eingebauten Server-Events von Discord. Die Formulierungen bleiben sachlich, ohne Abwertung.
5. **Funktionen im Detail:** drei bis vier Blöcke im Wechsel Text links und Bild rechts, jeweils mit echtem Screenshot der aktuellen App:
   - Rollen und Zugang
   - Anmeldung direkt in Discord (Knopf und Dialog)
   - Warteliste und Slots
   - Admin-Dashboard
6. **Animierte Discord-Szene:** eine nachgebaute (nicht echte) Discord-Nachricht des DEMS-Bots mit Event-Ankündigung. Ein Mauszeiger klickt „Anmelden“, der Teilnehmerzähler springt hoch, die Warteliste füllt sich. Die Szene ist in HTML und CSS gebaut, ohne Discord-Logos oder -Grafiken.
7. **In drei Schritten zum eigenen DEMS:**
   1. VPS mit Docker anlegen, zum Beispiel bei Hostinger (Promo-Link)
   2. `docker compose up`: PostgreSQL, Datenbank und Passwort richten sich selbst ein
   3. Discord-Bot im Developer Portal anlegen, Werte in die `.env` eintragen, Bot einladen

   Jeder Schritt hat eine Nummer, die sich beim Einblenden „zeichnet“, und Schritt 2 ein kleines Terminal-Fenster mit Tipp-Animation.
8. **FAQ (aufklappbar):**
   - Brauche ich Programmierkenntnisse?
   - Was kostet das? (DEMS ist Open Source unter MIT und kostet nichts; du zahlst nur deinen Server)
   - Darf ich DEMS anpassen? (ja, MIT-Lizenz)
   - Gehören die Daten mir? (ja, alles läuft auf dem eigenen Server)
   - Wie groß darf mein Server sein?
   - Wie bekomme ich Updates?
9. **Abschluss:** großes DEMS-Wortlogo, ein Satz, der Hauptknopf „Auf GitHub ansehen“.
10. **Fußzeile:** Hinweis „Nicht mit Discord Inc. verbunden“ (wie in der App), „Open Source unter MIT-Lizenz“, Links zu GitHub, Docker Hub und `LICENSE`, Jahr.

## Animationen

- **Werkzeug:** GSAP 3.12.5 (Core) als lokale Kopie aus `public/vendor/gsap/gsap.min.js`. Einblendungen beim Scrollen über `IntersectionObserver`, damit kein weiteres GSAP-Plugin nötig ist.
- **Hero:** Ablauf wie im Entwurf `hero-fonts.html` (Variante Space Grotesk):
  - nach etwa 1 s steigen die übrigen Buchstaben verschwommen auf (etwa 1,1 s)
  - danach werden die Anfangsbuchstaben zu DEMS in Space Grotesk mit lila Verlauf und wachsen
  - nach etwa 2,8 s folgen Leuchten, Slogan und Knopf
  - Gesamtdauer unter 3,5 s
- **Scrollen:** Abschnitte schieben sich beim Erscheinen leicht von unten herein und blenden auf. Vergleichszeilen und Funktionskarten erscheinen nacheinander (Stagger etwa 80 ms). Jede Einblendung läuft nur einmal.
- **Kleine Effekte:**
  - Screenshots kippen auf dem Desktop leicht mit der Maus, höchstens 6°
  - der GitHub-Knopf hat einen sanften Lichtschimmer beim Überfahren
  - Nummern der drei Schritte zeichnen sich
  - das Terminal tippt Schritt 2
  - die Discord-Szene spielt einmal ab, wenn sie sichtbar wird, und hat einen Knopf zum Wiederholen
- **Bewegung reduzieren:** Bei `prefers-reduced-motion: reduce` gibt es keine Animationen: Das fertige DEMS-Logo, Slogan, Knopf und alle Abschnitte stehen sofort da, die Szene zeigt ihren Endzustand.
- **Ohne JavaScript:** Alles ist lesbar. Der Hero zeigt dann direkt das fertige Logo; die Startzustände der Animationen setzt erst das Skript.

## Technik

- **Dateien in `landing/`:** `index.html`, `css/landing.css`, `js/landing.js`, `vendor/` (GSAP, Bootstrap Icons, Schriften), `img/` (Screenshots, Favicon). Die alten Dateien (`style.css`, `script.js`, `screenshots/`) werden entfernt.
- **Design-Tokens:** `landing/css/landing.css` übernimmt die Werte aus `public/css/tokens.css`, also eine Kopie, kein Verweis, weil die Seite eigenständig ist. Verwendet werden Hintergründe, Textfarben, Akzent, Radien, Schatten und Schriftgrößen; die Seite schreibt keine eigenen Farbwerte daneben. Ein helles Schema folgt `prefers-color-scheme` mit den hellen Tokens der App.
- **Schriften lokal:**
  - Inter aus `public/vendor/fonts/` (inklusive OFL-Lizenzdatei)
  - Space Grotesk Bold als `woff2` mit Lizenzdatei (Open Font License), einmalig heruntergeladen von Google Fonts oder Fontsource
  - kein Aufruf zur Laufzeit an fremde Server
- **Icons:** Bootstrap Icons aus `public/vendor/bootstrap-icons/`, keine Emojis.
- **CSP-tauglich wie die App:** keine Inline-Skripte, keine Inline-Event-Handler, keine `style="…"`-Attribute. Damit kann die Seite mit derselben strengen CSP laufen, wenn sie später hinter einem Server liegt.
- **Barrierefreiheit:**
  - echte Überschriften-Hierarchie
  - der animierte Name hat einen zugänglichen Text („DEMS – Dein Event-Management-System“)
  - Kontraste wie in der App (AA)
  - FAQ mit `<details>`/`<summary>`
  - sichtbarer Fokus
- **Links an einer Stelle:** GitHub-URL, Docker-Hub-URL und Hostinger-Promo-Link stehen als Konstanten oben in `landing/js/landing.js` und als `href` in `index.html`. Ein Kommentar markiert den Hostinger-Platzhalter `HOSTINGER_PROMO_LINK`, bis der echte Link da ist.
- **Screenshots:** neu aufgenommen aus `npm run dev:mock` (Personas und Dummy-Daten) per Playwright, Desktop 1440 × 900, dunkles Schema, als WebP oder PNG unter `landing/img/`. Ohne echte Nutzerdaten.
- **Git:** `landing/` in `.gitignore`, `git rm -r --cached landing`. In demselben Commit werden die Verweise im Repo angepasst. Wiki und Doku dürfen nicht mehr behaupten, die Landing-Page liege im Repo: `docs/wiki/overview/directory-map.md`, CLAUDE.md (die Zeile „Ignore … `landing/`“ bleibt sinnvoll) und `.dockerignore` (bleibt). `npm test` und `npm run wiki` müssen grün bleiben. Die Spec selbst wird committet.

## Entscheidungen des Designers (nicht vom Betreiber vorgegeben)

- Helles Schema nach `prefers-color-scheme` mit den hellen Tokens der App.
- Einblendungen über `IntersectionObserver` plus GSAP-Core statt des ScrollTrigger-Plugins: keine weitere Datei, gleiche Wirkung für einmalige Einblendungen.
- Die animierte Discord-Szene (Abschnitt 6) und die Tipp-Animation im Terminal als zusätzliche Hingucker.
- FAQ-Fragen wie oben. „Wie groß darf mein Server sein?“ wird ohne harte Zahl beantwortet: ausgelegt auf große Communitys, die Datenmengen pro Server sind klein. „Was kostet das?“ nennt keine Hosting-Preise.
- Docker-Hub-Link auf `https://hub.docker.com/r/moritakahashi/dems`.

## Was dem Builder überlassen ist

- Konkrete Texte (Slogan, Funktionsbeschreibungen, FAQ-Antworten) im Ton der App: direkt, freundlich, ohne Werbesprech, mit „du“.
- Genaue Zeiten und Kurven der Animationen innerhalb der Vorgaben oben.
- Layout-Details, Abstände und Umbrüche, Mobil-Menü.
- Welche drei bis vier Screenshots genau und wie sie zugeschnitten werden.
- Ob Space Grotesk aus Google Fonts oder Fontsource kommt.

## Folgearbeiten

- Repo und Docker-Image öffentlich schalten (Betreiber). Danach `docs/wiki/ops/deployment.md` anpassen, das heute noch „private image“ und `docker login` nennt.

- Hostinger-Promo-Link eintragen, sobald vorhanden.
- Optional: die Seite auf einem eigenen Host oder als GitHub Pages veröffentlichen. Das liegt außerhalb dieses Umfangs, weil `landing/` nicht im Repo liegt.
