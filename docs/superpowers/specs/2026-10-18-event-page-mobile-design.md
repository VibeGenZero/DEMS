# Event-Seite neu, mobil zuerst — Design Spec
**Datum:** 2026-10-18 · **Ticket:** D-05 (GitLab #54, Prio-Plan `2026-10-07-dems-3.0-prioplan.md`) · **Abhängig von:** D-02 (Tokens, Komponenten), F-16 (Browser-Tests); baut auf D-06 (Plätze-Satz), D-15 (zwei Schemata) und den GSAP-Animationen der Event-Seite auf

## Überblick

Die Event-Seite (`#event/<id>`, `#event-detail-section`) steht heute in zwei Bootstrap-Spalten: links Titel, Countdown, Beschreibung, Teilnehmer, Serie, Anmeldeformular und Kommentare, rechts eine klebende Seitenleiste mit Details, Kapazität und einem zweiten Anmelde-Button. Gemessen im Mock-Modus:

- Unter dem Banner bleiben rund 116 px (Desktop) bzw. 70 px (Handy) leer: `.section-container` hat 100 px Abstand für die Navbar, obwohl das Banner schon darunter liegt.
- Zwei Anmelde-Buttons: „Jetzt anmelden“ in der Seitenleiste (scrollt zum Formular oder sendet selbst) und „Teilnehmen“ im Formular.
- Auf dem Handy rutscht die Seitenleiste ans Ende: Datum, Uhrzeit, Ort, Plätze und der Button stehen erst nach den Kommentaren (beim Raid nach rund 2200 px).

**Ziel:** Wer auf einen Event-Link tippt, sieht sofort, wann und wo das Event ist und wie viele Plätze frei sind, und hat genau einen Button zum Anmelden, auf dem Handy immer erreichbar am unteren Rand. Danach folgen Beschreibung, Aufstellung und Kommentare.

**Erfolgskriterien**
- Bei 390 × 844 px stehen Datum, Uhrzeit, Ort und Plätze im ersten Bildschirm, vor der Beschreibung.
- Auf der ganzen Seite gibt es genau einen Button, der anmeldet (bzw. auf die Warteliste setzt). Auf dem Handy steht er fest am unteren Rand, solange eine Anmeldung möglich ist, und verdeckt keinen Inhalt.
- Zwischen Banner und „Zurück zur Übersicht“ höchstens 40 px.
- Reihenfolge darunter: Beschreibung, Aufstellung/Teilnehmer, Termine der Serie, Anmeldeangaben (falls nötig), Kommentare.
- Desktop (1440 px) bleibt zweispaltig mit klebender Seitenleiste; der Button steht dort in der Seitenleiste.
- `npm test` und `npm run test:e2e` grün, keine neue Abhängigkeit, kein Modul über 550 Zeilen.

**Nicht im Umfang**
- Inhalt und Logik von Anmeldung, Warteliste, Slots, Gästen, Check-in und Kommentaren (nur ihr Platz auf der Seite ändert sich).
- Banner-Gestaltung und Kartenflug (die Banner-Höhe von 220 px bleibt, `events/card-flight.js` hängt daran).
- Andere Seiten.

## Entscheidungen (18.10.2026, ohne Rückfragen getroffen; der Nutzer hat die Fragen übersprungen)

1. **Raster statt Bootstrap-Spalten.** `.event-page` mit vier Bereichen: `head` (Kategorie, Status, Titel, Countdown), `side` (Details, Kapazität, Button), `status` (bereits angemeldet, kein Zugang, vorbei, Check-in), `main` (Beschreibung, Teilnehmer/Aufstellung, Serie, Anmeldeangaben, Warteliste, Kommentare). Handy: eine Spalte in der Reihenfolge head → side → status → main. Ab 992 px: links head, status, main; rechts side über alle Zeilen, klebend.
2. **Ein Button.** `#register-btn` und `#waitlist-btn` stehen fest in `#sidebar-action-area` und senden ihr Formular über das `form`-Attribut (`form="registration-form"` bzw. `form="waitlist-form"`). In den Formularen selbst gibt es keinen Absende-Button mehr. Der Weg „Jetzt anmelden scrollt zum Formular“ und `#sidebar-register-btn` entfallen. Beschriftung bleibt „Teilnehmen“ bzw. „Auf Warteliste setzen“.
3. **Formularkarte nur bei Angaben.** Die Karte „Anmeldung“ erscheint nur, wenn es etwas einzugeben gibt (Formularfelder, Rollenwahl oder Gäste erlaubt); sonst reicht der Button. Gleiches gilt für die Wartelisten-Karte: Sie zeigt „Event ist voll“ immer, die Felder nur, wenn es welche gibt.
4. **Fester Button auf dem Handy.** Unter 992 px wird `#sidebar-action-area` zu einer Leiste am unteren Rand (Glasfläche, Rand oben, Sicherheitsabstand für Geräte mit Home-Leiste), aber nur im Zustand Anmelden/Warteliste. Die Seite bekommt dann unten Platz, damit die Leiste nichts verdeckt. Angemeldet, kein Zugang und vorbei zeigen keine feste Leiste.
5. **Fehlende Angaben.** Ein leeres Pflichtfeld fängt wie bisher zuerst die Prüfung des Browsers ab: eigene Meldung, Scroll und Fokus auf das erste leere Feld, nichts wird gesendet. Was sie durchlässt (Text nur aus Leerzeichen), meldet DEMS per Toast und scrollt ebenfalls zum Feld und setzt den Fokus, weil der Button weit vom Formular stehen kann. Bei fehlender Rolle scrollt die Seite wie heute zur Rollenwahl. Toasts stehen auf dem Handy über der Leiste, damit man den Button gleich wieder drücken kann. *(nach dem Review angepasst)*
6. **Fakten kompakt.** Unter 992 px stehen die Detailzeilen in zwei Spalten (Datum | Uhrzeit, Dauer | Ort, Erstellt von), damit Fakten, Plätze und Status in den ersten Bildschirm passen.
7. **Abstand unter dem Banner.** Der Container der Event-Seite bekommt oben `--space-16` statt 100 px; der Zurück-Button verliert seinen eigenen oberen Abstand. *(beim Umsetzen von `--space-24` verkleinert, damit die Fakten auf 390 × 844 px über die Leiste passen)*
8. **Status nach oben.** „Bereits registriert“, „Zugriff eingeschränkt“, „Dieses Event ist vorbei“ und der Check-in stehen im Bereich `status` direkt unter Titel (Desktop) bzw. unter den Fakten (Handy), nicht mehr unter Beschreibung und Teilnehmern.
9. **Abhängige Stellen.** Kommentare hängen sich an `#detail-main` statt an `.col-lg-8`; der Check-in hängt sich an `#detail-status`; die Einblend-Animation (`detail-motion.js`) zielt auf `#detail-main` statt `.col-lg-8`.

## Dem Builder überlassen
- Klassen- und Id-Namen innerhalb der Entscheidungen, Abstände (nur Tokens).
- Ob die Zustandslogik von `renderSidebarAction` umgebaut oder ergänzt wird, solange es genau einen anmeldenden Button gibt.

## Tests
- Unit (`loadFrontendApp`): Buttons sitzen im Aktionsbereich mit `form`-Attribut, keine Absende-Buttons in den Formularen; je Zustand ist genau ein anmeldender Button sichtbar; Formularkarte nur mit Angaben; Leisten-Klasse nur bei Anmelden/Warteliste; Kommentare in `#detail-main`, Check-in in `#detail-status`; fehlendes Pflichtfeld scrollt dorthin; Animation zielt auf `#detail-main`.
- E2E: Handy 390 px – Fakten vor der Beschreibung und im ersten Bildschirm, Button sichtbar am unteren Rand, nichts ragt über die Seitenbreite; Desktop – genau ein sichtbarer Anmelde-Button, Abstand Banner → Zurück-Button ≤ 40 px; bestehende Tests (Anmelden, Abmelden, Ende, Check-in) grün.

## Wiki
`docs/wiki/modules/frontend-markup.md` (Event-Seite: Bereiche, Ids, Button im Aktionsbereich), `docs/wiki/modules/frontend-app.md` (`events/detail.js`, `comments.js`, `checkin.js`, `detail-motion.js`), danach `npm run wiki`.
