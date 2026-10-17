# GSAP-Animationen für DEMS 3.0 Beta 2 — Design Spec
**Datum:** 2026-10-17 · **Branch:** `feature/gsap-animations` (von `origin/main`) · **Danach, nicht Teil dieses Entwurfs:** Versionssprung auf `3.0.0-beta.2` mit Neuigkeiten (eigener Branch und MR, Texte von Beta 1 aus dem Stash als Grundlage)

## Ziel und Warum

Beta 2 soll sich lebendiger und hochwertiger anfühlen. DEMS nutzt GSAP 3.12.5 (`public/vendor/gsap/gsap.min.js`) bisher nur für Einblendungen. Neu ist **eine gemeinsame Bewegungssprache**: eine Federung (`back.out(1.4)`), die überall gleich wirkt. Das Herzstück ist das Öffnen einer Event-Karte wie eine App auf dem iPhone.

**Erfolgskriterien**
- Die Karte öffnet und schließt sich wie im Prototyp gewählt (Variante A, Bounce 1.4, Dauer ×1.0, Werte unten).
- Die sechs weiteren Animationen laufen an den genannten Stellen mit derselben Federung.
- Mit „Bewegung reduzieren“ (`prefers-reduced-motion: reduce`) gibt es keine Bewegung, nur kurzes Überblenden.
- Keine Animation blockiert Klicks oder verzögert Inhalte spürbar; nichts ruckelt auf dem Desktop.
- `npm test` und `npm run test:e2e` sind grün; keine neue Abhängigkeit.

**Nicht im Umfang:** Feinschliff für Handys (dieselben Animationen laufen dort, ohne eigene Abstimmung); die Kalender-Ansicht; Animationen in Discord; der Versionssprung.

**Anti-Ziele:** unterschiedliche Federungen je Stelle; Animationen, die man abwarten muss, bevor man klicken kann (außer dem ~1 s langen Kartenflug); Bewegung trotz „Bewegung reduzieren“; Inline-Styles im Markup oder `<style>`-Elemente (CSP); Emojis als Symbole.

## Entscheidungen des Nutzers

- **Karte:** Variante A „Erst Mitte, dann Vollbild“, Bounce 1.4, Dauer ×1.0 — im Prototyp „mega gut“.
- **Alle sechs Ideen** kommen rein (Erfolgsmoment, Filtern mit Nachrücken, Dialoge und Meldungen, Balken und Zahlen, gleitender Marker, Klapp-Ziffern).
- **Bestätigte Annahmen:** Kartenflug nur beim Klick auf eine Karte der Übersicht; Öffnen über einen Link (Discord, Lesezeichen, Kalender) ohne Kartenflug. Browser-Zurück, „Zurück zur Übersicht“ und Esc schließen mit derselben Animation. Die Übersicht tritt dahinter zurück und wird dunkler. „Vollbild“ ist der Inhaltsbereich unter der Navigationsleiste; die Leiste bleibt sichtbar. Optimiert wird für den Desktop.
- **Bestätigte Orte** der sechs Ideen: siehe Teil 2.
- **Reihenfolge:** erst dieser Branch mit MR, danach der Versionssprung.

## Teil 1 — Karte öffnen und schließen

Die Karte (`<a class="event-card" href="#event/<id>">` in `#events-grid`) fliegt in die Mitte des Inhaltsbereichs, wächst dort zum Vollbild und wird zur Event-Seite. Beim Schließen schrumpft die Seite in der Mitte zur Karte, die federnd an ihren Platz zurückkehrt.

**Werte aus dem Prototyp** (Zeiten in Sekunden, `S` = `back.out(1.4)`):

| Schritt | Start | Dauer | Bewegung | Ease |
|---|---|---|---|---|
| Übersicht dunkler | 0 | 0.4 | Abdunkelung 0 → 1 | linear |
| Übersicht tritt zurück | 0 | 0.6 | `scale` 1 → 0.95 | `power2.out` |
| Abheben und in die Mitte | 0 | 0.5 | Karte in die Mitte des Inhaltsbereichs, `scale` 1.06 | `S` |
| Wachsen zum Vollbild | 0.42 | 0.55 | auf die Fläche des Inhaltsbereichs, `scale` 1, Eckenradius → 0, Banner auf Seitenhöhe | `power3.inOut` |
| Kartengesicht aus | 0.42 | 0.18 | Datum, Titel, Plätze der Karte ausblenden | linear |
| Seiteninhalt ein | Ende − 0.2 | 0.35 | `opacity` 0 → 1, `y` 18 → 0 | `power2.out` |

| Schließen | Start | Dauer | Bewegung | Ease |
|---|---|---|---|---|
| Seiteninhalt aus | 0 | 0.15 | ausblenden | linear |
| Kartengesicht ein | 0.1 | 0.2 | einblenden | linear |
| Schrumpfen zur Karte | 0.05 | 0.45 | Kartengröße in der Mitte, `scale` 1.06, Eckenradius zurück, Banner auf Kartenhöhe | `power3.inOut` |
| Zurück an den Platz | Ende − 0.06 | 0.55 | an die Stelle der Karte, `scale` 1 | `S` |
| Übersicht kommt zurück | wie „Zurück an den Platz“ | 0.45–0.55 | Abdunkelung aus, `scale` → 1 | `power2.out` |

**Randfälle (meine Entscheidungen):**
- Strg-/Mittelklick auf eine Karte öffnet wie bisher einen neuen Tab, ohne Kartenflug; Enter auf einer fokussierten Karte fliegt wie ein Klick.
- Lädt die Event-Seite länger als der Flug, zeigt die wachsende Fläche schon Banner und Titel der Karte; der restliche Inhalt blendet ein, sobald er da ist.
- Gibt es beim Schließen die Karte nicht mehr an ihrem Platz (Filter geändert, Event nicht mehr in der Liste, Karte außerhalb des sichtbaren Bereichs), schrumpft die Fläche in der Mitte und blendet aus.
- Die Scrollposition der Übersicht bleibt beim Zurückkehren erhalten.
- Ein zweiter Klick während des Flugs öffnet nichts Zweites.

## Teil 2 — Sechs weitere Animationen

Alle mit `S` = `back.out(1.4)`.

1. **Erfolgsmoment** — Anmeldung auf der Event-Seite (`events/registration-form.js`) und erfolgreiches Einchecken (`events/checkin.js`). Die Seite behält ihr heutiges Aussehen nach der Anmeldung; die Federn spielen auf dem, was dann erscheint (meine Entscheidung, keine neuen Bauteile):
   - Der geklickte Knopf drückt sich ein (`scale` 0.94, 0.1 s, `power2.in`).
   - Der Knopf der Seitenleiste springt in seinen heutigen Zustand „Angemeldet“ (`scale` 0.94 → 1, 0.5 s, `back.out(2.2)`). Er bleibt wie heute bei jedem Status grün.
   - Der Platz-Balken der Seitenleiste rückt vom alten zum neuen Wert (0.6 s, `S`).
   - Der Kasten „Bereits registriert“ mit dem Status springt herein (`scale` 0.92 → 1 und einblenden, 0.5 s, `back.out(2)`). Der Status bleibt farbiger Text wie heute, ein Chip kommt nicht dazu.
   - Dafür aktualisiert sich die Seite nach der Anmeldung an Ort und Stelle, statt mit dem heutigen Hereingleiten von `.col-lg-8` komplett neu einzufliegen.
   - Einchecken: Der Kasten des Check-ins springt in seinen eingecheckten Zustand (wie oben, 0.5 s, `back.out(2)`); Plätze ändern sich dabei nicht.
   - Abmelden bekommt nur ein ruhiges Ausblenden.
2. **Filtern mit Nachrücken** — Kategorie-Leiste und Suche der Übersicht (Grid-Ansicht, `events/list.js`): wegfallende Karten `scale` 0.7 und `opacity` 0 (0.18 s, `power2.in`), bleibende gleiten von der alten an die neue Stelle (0.55 s, `S`), neue erscheinen aus `scale` 0.7 (0.45 s, `S`). Schnelles Tippen in der Suche stapelt keine Animationen.
3. **Dialoge und Meldungen** — alle 14 Bootstrap-Dialoge in `public/index.html`: Abdunkelung 0.25 s, Dialog aus `scale` 0.86 und `y` 12 (0.45 s, `S`); Schließen `scale` 0.94 und ausblenden (0.18 s, `power2.in`). Der Schutz „ein Klick auf Bestätigen während des Einblendens zählt nicht“ (`e2e/admin.spec.js`) bleibt. Toasts (`showToast`) federn von rechts herein (`x` 40 → 0, 0.5 s, `S`) und gleiten hinaus (0.25 s).
4. **Balken und Zahlen** — Platz-Balken der Übersichtskarten (mit dem gestaffelten Erscheinen), Kapazität in der Seitenleiste der Event-Seite, Abstimmungsergebnisse, Zahlen der Admin-Statistik: Balken 0 → Wert (0.8 s, `S`, gestaffelt 0.12 s), Zahlen zählen hoch (0.8 s, `power2.out`).
5. **Gleitender Marker** — aktiver Punkt der Navigationsleiste (`#main-navbar .nav-link.active`) und alle Tabs der Tabs-Komponente (`.nav-pills`, z. B. Aktiv / Entwürfe / Archiv): die Markierung gleitet zum neuen Punkt (0.5 s, `S`). Beim ersten Anzeigen steht sie ohne Animation. Das Aussehen der aktiven Markierung bleibt wie heute.
6. **Klapp-Ziffern** — Countdown der Event-Seite (`startCountdown` in `events/detail.js`): nur geänderte Ziffern bewegen sich; die alte geht nach oben weg (`yPercent` −100, 0.35 s, `power2.in`), die neue kommt von unten (`yPercent` 100 → 0, 0.5 s, `S`).

## Teil 3 — Querschnitt

- **Ein gemeinsamer Ort** für die Bewegung (mein Vorschlag: `public/js/core/motion.js`): Federung, Dauern, die Prüfung auf „Bewegung reduzieren“ (heute in `core/update-effects.js`), kleine Helfer. Mit „Bewegung reduzieren“: keine Bewegung und kein `scale`, nur Überblenden ≤ 0.2 s oder sofort.
- **Reichweite von „Bewegung reduzieren“ (meine Entscheidung):** Es gilt für alles, was dieser Branch neu baut oder ändert. Dazu gehören die Toasts, das gestaffelte Erscheinen der Übersichtskarten, das Hereingleiten der Event-Seite und das CSS-Einblenden `sectionFadeIn` der Bereiche (eine Regel unter `@media (prefers-reduced-motion: reduce)`), weil es am Ende des Kartenflugs mitspielt. Die Boot-Animation und die Info-Seite (Partikel, Logo-Glühen) bleiben, wie sie sind.
- **Projektregeln:** GSAP setzt Styles über das CSSOM, das erlaubt die CSP; im Markup keine `style`-Attribute und keine `<style>`-Elemente. Farben, Radien und Schatten nur als Tokens. Symbole sind Bootstrap Icons. Module ≤ 500 Zeilen (`events/detail.js` hat schon 499 → neuer Code in neue Module). Module führen beim Import keinen Code aus; Aktionen über `registerActions`.
- **Tests:** Der Fake-DOM der Frontend-Tests ersetzt `gsap` nur durch `from/to/fromTo/set` (`test/helpers.js`) und muss für neue Aufrufe erweitert werden. Reine Logik (Positionsdifferenzen, geänderte Ziffern, Zweig für reduzierte Bewegung, Schließen über den Router) wird mit `node:test` geprüft. E2E (Desktop): Karte öffnen, Fläche erreicht den Inhaltsbereich, Schließen mit Esc und Browser-Zurück, Karte wieder an ihrem Platz; ein Lauf mit `reducedMotion: 'reduce'`. Die bestehenden E2E-Tests (Dialoge, Tour) bleiben grün.
- **Wiki:** `modules/frontend-app.md`, bei CSS-Änderungen `modules/frontend-markup.md`, `ops/testing.md`; danach `npm run wiki`.

## Was dem Builder überlassen bleibt

Die Technik: ob die Karte als Kopie über der Seite fliegt oder die echten Elemente animiert werden, wie die Bootstrap-Dialoge eingehängt werden, wie die Kartenposition nach dem Neuzeichnen der Übersicht gemessen wird, eigene Positionsdifferenzen statt eines GSAP-Plugins (eine neue Vendor-Datei nur mit klarem Grund), die Aufteilung in Module und die genaue CSS.

**Prototypen** (lokal, nicht in git): `.superpowers/brainstorm/96-1792229255/content/card-open.html` und `more-ideas.html`. Die maßgeblichen Werte stehen oben.
