# GSAP-Animationen (Beta 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DEMS bekommt eine gemeinsame Federung und sieben Animationen: den Kartenflug beim Öffnen und Schließen eines Events sowie Erfolgsmoment, Filtern mit Nachrücken, federnde Dialoge und Toasts, wachsende Balken und Zahlen, gleitende Marker und Klapp-Ziffern.

**Architecture:** Ein neues Modul `core/motion.js` hält die Federung, die Prüfung auf „Bewegung reduzieren“ und kleine Helfer. Jede Animation lebt im Modul ihres Bereichs oder in einem neuen Nachbarmodul (`events/card-flight.js`, `events/overview-motion.js`, `events/countdown.js`, `events/detail-motion.js`, `core/tab-glider.js`). Der Kartenflug ist eine feste Ebene (`#card-flight`) über der Seite: Sie zeigt eine Kopie der Karte, die wächst, während der Router im Hintergrund die Event-Seite lädt, und schrumpft beim Zurückkehren auf die neu gezeichnete Karte.

**Tech Stack:** Vanilla ES-Module unter `public/js/`, GSAP 3.12.5 (global `gsap`), Bootstrap 5 (Dialoge, Toasts), `node:test` mit dem Fake-DOM aus `test/helpers.js`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-gsap-animations-design.md`

## Global Constraints

- Federung überall `back.out(1.4)` (Konstante `SPRING` in `core/motion.js`), Dauer ×1.0.
- „Bewegung reduzieren“ (`prefers-reduced-motion: reduce`): keine Bewegung und kein `scale`, nur Überblenden ≤ 0.2 s oder sofort. Gilt für alles, was dieser Branch baut oder ändert (Toasts, Kartenerscheinen, Event-Seite, `sectionFadeIn`); Boot-Animation und Info-Seite bleiben.
- Keine neue Abhängigkeit, keine neue Vendor-Datei, kein GSAP-Plugin.
- CSP: keine `style`-Attribute im Markup, keine `<style>`-Elemente, keine Inline-Handler; GSAP setzt Styles über das CSSOM (erlaubt).
- Farben, Radien, Schatten, Ebenen nur als Tokens aus `public/css/tokens.css`; Symbole nur Bootstrap Icons, keine Emojis (auch nicht in JS-Kommentaren).
- Frontend-Module ≤ 500 Zeilen (`events/detail.js` steht bei 499), keine Ausführung beim Import außer `registerActions(` (Startcode nur in `main.js`), geteilte Werte nur über `state` aus `core/state.js`, Aktionen über `data-click` + `registerActions`.
- Texte für Nutzer auf Deutsch; Code, Kommentare, Commits, Wiki auf Englisch.
- Optimiert für den Desktop; auf dem Handy laufen dieselben Animationen ohne eigene Abstimmung.
- Commits: englischer Imperativ-Betreff, Warum im Text, Attribution-Zeilen der Session.

## Review Focus

- Zurück zur Übersicht, während die Events langsam laden oder fehlschlagen: Die Flug-Ebene darf nicht hängen bleiben; nach spätestens 1.5 s landet die Karte oder schrumpft in der Mitte und blendet aus (Task 3, Schritt 9).
- Doppelklick auf eine Karte: genau ein Flug, Ende auf der Event-Seite, keine zweite Ebene (Task 3, Schritt 9).
- Fenstergröße ändert sich, während die Event-Seite offen ist: Beim Schließen wird neu gemessen, die Karte landet an ihrem neuen Platz (Task 3, Schritt 9).
- Schnelles Tippen in der Suche und schnelles Wechseln der Kategorie: keine gestapelten Animationen, am Ende stehen alle Karten ohne Rest-Transform an ihrem Grid-Platz (Task 4, Schritt 5).
- Fenstergröße ändert sich bei offenem Menü oder Tabs: Der Marker sitzt danach unter dem aktiven Punkt (Task 6, Schritt 5).

---

### Vorbereitung: Spec und Plan committen

- [ ] **Schritt 1:** `git add docs/superpowers/specs/2026-10-17-gsap-animations-design.md docs/superpowers/plans/2026-10-17-gsap-animations.md` und committen: „Plan the GSAP animations for beta 2“.

---

### Task 1: Bewegungs-Grundlage

**Files:**
- Create: `public/js/core/motion.js`
- Modify: `public/js/core/update-effects.js` (nutzt `prefersReducedMotion` aus `motion.js`), `public/css/style.css` (`sectionFadeIn` unter reduzierter Bewegung), `test/helpers.js` (gsap-Attrappe zeichnet auf)
- Test: `test/motion.test.js`

**Interfaces:**
- Produces (`core/motion.js`):
  - `SPRING = 'back.out(1.4)'`
  - `prefersReducedMotion(): boolean`
  - `calmVars(vars: Object): Object` — rein: entfernt `x, y, xPercent, yPercent, scale, scaleX, scaleY, rotation`, setzt `duration` auf `Math.min(vars.duration ?? 0.2, 0.2)`, `ease: 'none'`, entfernt `stagger`; alles andere (u. a. `opacity`, `autoAlpha`, `onComplete`, `width`, `value`) bleibt.
  - `animateTo(targets, vars): Object|null` und `animateFromTo(targets, fromVars, toVars): Object|null` — bei reduzierter Bewegung mit `calmVars`; bleibt danach keine Eigenschaft außer `duration/ease/delay/onComplete` übrig, `gsap.set(targets, toVars ohne Bewegung)` und `onComplete` sofort, Rückgabe `null`.
  - `countUp(element, to: number, { duration = 0.8, delay = 0 } = {}): void` — Text zählt von 0 hoch (`power2.out`), reduziert: sofort `to`.
  - `growMeter(meter: HTMLProgressElement, { from = 0, duration = 0.8, delay = 0 } = {}): void` — tweent `value` von `from` auf den aktuellen Wert mit `SPRING`; reduziert: nichts.
- Produces (`test/helpers.js`): `loadFrontendApp` gibt zusätzlich `animations` zurück: `[{ method, targets, vars, fromVars }]` für `gsap.to/from/fromTo/set` und für Aufrufe auf `gsap.timeline()`-Objekten (`method: 'timeline.to'` usw.). Die Attrappe ruft `onComplete` von `to/fromTo/from` sofort auf; `timeline({ onComplete })` ruft es in einem Microtask; `killTweensOf` und `delayedCall` werden aufgezeichnet und nicht ausgeführt.

- [ ] **Schritt 1: Failing Tests** in `test/motion.test.js` (rein über `loadFrontendModules`, Fake-DOM über `loadFrontendApp`):

```js
test('calmVars keeps fades and drops every movement', () => {
  assert.deepEqual(calmVars({ x: 40, y: 12, scale: 0.86, opacity: 1, duration: 0.45, ease: 'back.out(1.4)', stagger: 0.1 }),
    { opacity: 1, duration: 0.2, ease: 'none' });
  assert.equal(calmVars({ opacity: 0, duration: 0.15 }).duration, 0.15);
});
test('with reduced motion a spring becomes a short fade', async () => {
  const { app, animations } = await loadFrontendApp({}, { reducedMotion: true });
  app.animateFromTo('#x', { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: app.SPRING });
  assert.deepEqual(animations.at(-1).vars, { opacity: 1, duration: 0.2, ease: 'none' });
});
test('a pure movement without a fade is set at once under reduced motion', async () => {
  const { app, animations } = await loadFrontendApp({}, { reducedMotion: true });
  let done = false;
  app.animateTo('#x', { scale: 1, duration: 0.5, onComplete: () => { done = true; } });
  assert.equal(animations.at(-1).method, 'set');
  assert.equal(done, true);
});
test('the section fade has no movement under reduced motion', () => {
  // style.css: @media (prefers-reduced-motion: reduce) sets .app-section to an opacity-only animation
});
```

Der letzte Test liest `public/css/style.css` über `test/cssSource.js` und prüft, dass ein `@media (prefers-reduced-motion: reduce)`-Block `.app-section` eine Animation ohne `transform` gibt (eigener Keyframe `sectionFadeInCalm` nur mit `opacity`).

- [ ] **Schritt 2:** `node --experimental-vm-modules --test test/motion.test.js` → FAIL (`core/motion.js` fehlt, `animations` undefined).
- [ ] **Schritt 3:** `core/motion.js` schreiben; `update-effects.js` importiert `prefersReducedMotion` von dort (eigene Funktion entfernen); gsap-Attrappe in `test/helpers.js` wie oben; CSS-Regel und Keyframe in `style.css`.
- [ ] **Schritt 4:** `node --experimental-vm-modules --test test/motion.test.js` → PASS; danach `npm test` → grün (die neue Attrappe ruft `onComplete` sofort; bricht ein bestehender Test, ist das ein Befund über den Test: anpassen und im Ledger festhalten).
- [ ] **Schritt 5: Commit** „Add one spring and a reduced-motion switch for every animation“.

---

### Task 2: Dialoge und Toasts federn

**Files:**
- Create: nichts; Code in `public/js/core/motion.js` (`springDialog`, `initDialogMotion`)
- Modify: `public/js/core/ui.js` (`showToast`), `public/js/main.js` (Start), `public/css/components.css` oder `style.css` (Bootstrap-Übergang des Dialogs abschalten), `test/components.test.js` (eigene gsap-Attrappe erweitern, falls nötig)
- Test: `test/motion.test.js`, `e2e/motion.spec.js` (neu)

**Interfaces:**
- Consumes: `animateFromTo`, `animateTo`, `SPRING`
- Produces: `initDialogMotion(root: Document): void` — hängt sich an `show.bs.modal` (Dialog `.modal-dialog` aus `scale` 0.86, `y` 12, `opacity` 0 → 1/0/1, 0.45 s, `SPRING`) und `hide.bs.modal` (`scale` 0.94, `opacity` 0, **0.15 s**, `power2.in`). Wird in `main.js` neben `initActions(document)` aufgerufen.

- [ ] **Schritt 1: Failing Tests:**
  - `test('every dialog springs open and shrinks away')`: `loadFrontendApp`, ein Fake-Element mit Klasse `modal` und Kind `.modal-dialog`; `show.bs.modal` auslösen → letzte Aufzeichnung ist `fromTo` auf dem `.modal-dialog` mit `fromVars` `{ scale: 0.86, y: 12, opacity: 0 }` und `vars.ease === 'back.out(1.4)'`; `hide.bs.modal` → `to` mit `scale: 0.94`, `duration: 0.15`.
  - `test('a toast springs in from the right')`: `showToast('x', 'success')` → `fromTo` auf `#app-toast` mit `fromVars.x === 40`, `vars.ease === 'back.out(1.4)'`, `vars.duration === 0.5`; mit `reducedMotion: true` ohne `x`.
- [ ] **Schritt 2:** Tests laufen lassen → FAIL.
- [ ] **Schritt 3:** `initDialogMotion` und `showToast` umsetzen. Der Bootstrap-Übergang von `.modal.fade .modal-dialog` (`transform`/`transition`) wird per CSS abgeschaltet, damit GSAP den Dialog allein bewegt; die Deckkraft-Blende von `.modal.fade` bleibt. Bootstraps Schutz während des Einblendens bleibt dadurch bestehen (`_isTransitioning` hält etwa 5 ms).
- [ ] **Schritt 4:** Unit-Tests → PASS. E2E: `e2e/motion.spec.js` anlegen mit `test('a dialog springs open and its buttons work at once')` (Desktop: Admin, Event-Tabelle, „Löschen …“, nach `waitForDialog` ist `.modal-dialog` ohne Rest-Transform, „Abbrechen“ schließt); `npx playwright test e2e/motion.spec.js e2e/admin.spec.js` → PASS (der Test „a click on the confirm button during the fade-in …“ bleibt grün).
- [ ] **Schritt 5: Commit** „Let dialogs and toasts spring like the cards“.

---

### Task 3: Kartenflug

**Files:**
- Create: `public/js/events/card-flight.js`
- Modify: `public/js/events/cards.js` (Karte trägt `data-click="openEventCard"` und `data-event-id`), `public/js/core/actions.js` (Klicks mit Zusatztaste auf Links mit echtem `href` gehen an den Browser), `public/js/core/router.js` (`handleRoute` gibt die Promise des Bereichs zurück; Schließen-Haken), `public/js/events/list.js` (zwischengespeicherte Karten statt Skeletons beim Zurückkehren; fliegende Karte verstecken; kein gestaffeltes Erscheinen nach einem Flug), `public/js/core/state.js` (`flyingEventId: null`), `public/js/main.js` (`initCardFlight(document)`), `public/index.html` (`#card-flight`, „Zurück zur Übersicht“ → `data-click="closeEventPage"`), `public/css/style.css` (Ebene, Blatt, Banner, `.event-card.is-flying`)
- Test: `test/cardFlight.test.js`, `test/frontendActions.test.js`, `e2e/motion.spec.js`

**Interfaces:**
- Consumes: `SPRING`, `prefersReducedMotion` (Task 1); `handleRoute(): Promise<void>` (dieser Task); `showEventsSection(): Promise<void>`
- Produces (`events/card-flight.js`):
  - `FLIGHT_OPEN = { dim: 0.4, recede: 0.6, lift: 0.5, growAt: 0.42, grow: 0.55, faceOut: 0.18, contentIn: 0.35 }`
  - `FLIGHT_CLOSE = { contentOut: 0.15, faceInAt: 0.1, faceIn: 0.2, shrinkAt: 0.05, shrink: 0.45, homeOverlap: 0.06, home: 0.55, recede: 0.55, dim: 0.45 }`
  - `LIFT_SCALE = 1.06`, `RECEDE_SCALE = 0.95`, `SCRIM_OPACITY = 0.8`, `DETAIL_BANNER_HEIGHT = 220`, `LAND_TIMEOUT_MS = 1500`
  - `isPlainClick(event): boolean` — linke Taste, keine Strg/Cmd/Umschalt/Alt
  - `centerRect(rect, viewport): { left, top, width, height }` — Karte in der Mitte des Fensters: `left = (viewport.width − rect.width) / 2`, `top = (viewport.height − rect.height) / 2`
  - `fullRect(viewport): { left: 0, top: 0, width, height }` — das ganze Fenster; die feste Navigationsleiste liegt darüber (wie das Banner der echten Seite, das unter der Leiste beginnt)
  - `openEventCard(card: HTMLElement): Promise<void>` (Aktion `openEventCard`)
  - `beginCardClose(route: string): boolean` — `true`, wenn die offene Seite per Flug kam und `route === 'events'`; baut dann sofort das Blatt aus einer Kopie der Event-Seite (IDs entfernt). Jede andere Route beendet den Flugzustand.
  - `landCardFlight(overviewShown: Promise<void>): Promise<void>`
  - `closeEventPage(): void` (Aktion) — nach einem Flug `history.back()`, sonst `navigateTo('events')`
  - `initCardFlight(root: Document): void` — Esc schließt eine per Flug geöffnete Seite, außer ein Dialog ist offen (`.modal.show`) oder der Fokus steht in `input`, `textarea`, `select` oder einem `contenteditable`

**Ablauf (Entscheidungen für den Builder):**
- **Öffnen:** Beim normalen Klick `state.flyingEventId` setzen, Scrollposition der Übersicht merken, Karte messen, Ebene aufbauen: Abdunkelung (`var(--bg-scrim)`, Ziel-Deckkraft `SCRIM_OPACITY`), Blatt mit Banner-Schicht (Bild der Karte mit `object-fit: cover` oder der Banner-Hintergrund der Karte; Overlay-Verlauf wie `.event-detail-banner-overlay`) und Gesicht (Kopie der Karte). Die echte Karte bekommt `.is-flying`. `#events-section` tritt zurück (`scale` `RECEDE_SCALE`). Zeitleiste exakt nach `FLIGHT_OPEN` und der Tabelle der Spec. Erreicht das Blatt das Vollbild: `history.pushState(null, '', '#event/<id>')`, `window.scrollTo(0, 0)`, `await handleRoute()`; danach Ebene ausblenden (`contentIn`) und Rücksetzen (`#events-section` ohne Transform). Ein zweiter Aufruf, solange ein Flug läuft, tut nichts. Mit reduzierter Bewegung: direkt `navigateTo('event/<id>')`, kein Flugzustand.
- **Schließen:** `handleRoute` ruft `beginCardClose(route)` **bevor** es die Bereiche ausblendet. Bei `true` zeigt das Blatt die Kopie der Seite im aktuellen Scrollstand; dann blendet `handleRoute` normal um und ruft `landCardFlight(showEventsSection())`. Die Übersicht zeichnet sofort die zwischengespeicherten Karten (die fliegende mit `.is-flying`), stellt die gemerkte Scrollposition wieder her und lädt im Hintergrund neu. `landCardFlight` wartet auf die Übersicht (höchstens `LAND_TIMEOUT_MS`), misst die Karte frisch (`[data-event-id="<id>"]`) und fliegt nach `FLIGHT_CLOSE` heim. Gibt es keine Karte im sichtbaren Fensterbereich, schrumpft das Blatt in der Mitte und blendet aus (0.3 s). Am Ende `.is-flying` entfernen, `state.flyingEventId = null`, Ebene verstecken.
- **Klicks mit Zusatztaste:** `actions.js` lässt bei `<a>` mit `data-click` und echtem `href` (nicht leer, nicht `#`) Strg-, Cmd-, Umschalt- und Alt-Klicks sowie andere Maustasten unberührt (kein `preventDefault`, keine Aktion).

- [ ] **Schritt 1: Failing Unit-Tests** in `test/cardFlight.test.js`:

```js
test('a card flies to the middle of the window', () => {
  assert.deepEqual(centerRect({ left: 40, top: 500, width: 400, height: 300 }, { width: 1440, height: 900 }),
    { left: 520, top: 300, width: 400, height: 300 });
});
test('the flight times are the ones chosen in the prototype', () => {
  assert.deepEqual(FLIGHT_OPEN, { dim: 0.4, recede: 0.6, lift: 0.5, growAt: 0.42, grow: 0.55, faceOut: 0.18, contentIn: 0.35 });
  assert.equal(LIFT_SCALE, 1.06);
});
test('the banner grows to the height of the event page banner', () => {
  // .event-detail-banner-header in style.css has height: 220px
});
test('only a plain left click flies', () => {
  assert.equal(isPlainClick({ button: 0 }), true);
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])
    assert.equal(isPlainClick({ button: 0, ...extra }), false);
});
test('with reduced motion a card opens its page directly', async () => {
  // loadFrontendApp(routes, { reducedMotion: true }); runAction('openEventCard', card) → location.hash === '#event/dev-1', no 'timeline.*' recorded
});
test('the overview card carries the flight action and its event id', () => {
  // renderEventCard({ id: 'e1', … }) contains data-click="openEventCard" and data-event-id="e1"
});
```

In `test/frontendActions.test.js`: `test('a click with a modifier on an action link is left to the browser')` — Strg-Klick auf `<a href="#event/x" data-click="…">` → Aktion läuft nicht, `preventDefault` nicht gerufen; auf `href="#"` läuft sie weiter.

- [ ] **Schritt 2:** `node --experimental-vm-modules --test test/cardFlight.test.js test/frontendActions.test.js` → FAIL.
- [ ] **Schritt 3:** `card-flight.js`, `actions.js`, `cards.js`, `state.js`, `index.html`, `style.css` nach den Interfaces umsetzen (Öffnen).
- [ ] **Schritt 4:** Unit-Tests → PASS.
- [ ] **Schritt 5:** `router.js` (`handleRoute` gibt `showEventsSection()`/`showEventDetail()` zurück; `beginCardClose` vor dem Ausblenden; `landCardFlight` im Fall `events`), `list.js` (Karten aus dem Zwischenspeicher, `.is-flying`, kein Staffeln nach einem Flug, Scrollposition), `main.js` (`initCardFlight(document)`), Schließen in `card-flight.js`.
- [ ] **Schritt 6: Failing E2E** in `e2e/motion.spec.js` (Desktop):
  - `test('a card flies open into its event page')`: Karte „Community-Spieleabend“ klicken → `#card-flight` sichtbar, danach `toHaveURL(/#event\/dev-event-open/)`, `#event-detail-section` sichtbar, `#card-flight` versteckt, keine Fehler (`watchErrors`).
  - `test('Esc, the back button and "Zurück zur Übersicht" fly the card home')`: je Weg öffnen, schließen, danach `#card-flight` versteckt, URL `#events`, die Karte hat wieder ihre Box von vorher (±2 px) und kein `.is-flying`.
  - `test('a ctrl click opens the event in a new tab')`: `context.waitForEvent('page')` bei `click({ modifiers: ['Control'] })` → neue Seite mit `#event/…`; die alte bleibt auf `#events`.
  - `test('with reduced motion the event page opens without a flight')`: `page.emulateMedia({ reducedMotion: 'reduce' })` → `#card-flight` wird nie sichtbar (Beobachter auf die Klasse), Seite öffnet.
  - `test('Esc while typing a comment does not close the page')`.
- [ ] **Schritt 7:** `npx playwright test e2e/motion.spec.js` → die neuen Tests laufen; Fehler beheben, bis PASS.
- [ ] **Schritt 8:** `npm run test:e2e` → grün (Tour und CSP klicken Karten; sie warten bereits auf Sichtbarkeit).
- [ ] **Schritt 9: Review-Focus-Tests** in `e2e/motion.spec.js`:
  - `test('a slow overview still lands or fades the card')`: `page.route('**/api/events?upcoming=1*', …)` mit 2.5 s Verzögerung beim Zurückkehren → nach 3 s ist `#card-flight` versteckt, keine Fehler.
  - `test('a double click flies only once')`: `dblclick` auf die Karte → genau eine Flugebene, Ende auf der Event-Seite.
  - `test('a resized window lands the card at its new place')`: öffnen, `setViewportSize({ width: 1100, height: 800 })`, Esc → Karte steht an ihrer neuen Box (±2 px).
- [ ] **Schritt 10:** `npm test` und `npx playwright test e2e/motion.spec.js` → PASS. **Commit** „Fly an event card open into its page and back home“.

---

### Task 4: Filtern mit Nachrücken

**Files:**
- Create: `public/js/events/overview-motion.js`
- Modify: `public/js/events/list.js` (`renderOverview` animiert bei Kategorie, Suche und Zurücksetzen in der Grid-Ansicht)
- Test: `test/overviewMotion.test.js`, `e2e/motion.spec.js`

**Interfaces:**
- Consumes: `SPRING`, `animateTo`, `animateFromTo`, `prefersReducedMotion`
- Produces:
  - `planFilterTransition(beforeIds: string[], afterIds: string[]): { leaving: string[], staying: string[], entering: string[] }` — rein
  - `flipOffset(before: {left, top}, after: {left, top}): { x, y }` — rein, `x = before.left − after.left`
  - `filterOverview(grid: HTMLElement, render: () => void): void` — misst die Karten (Schlüssel `data-event-id`), lässt wegfallende Karten verschwinden (`scale` 0.7, `opacity` 0, 0.18 s, `power2.in`), ruft dann `render()` auf, lässt bleibende von ihrer alten Stelle gleiten (0.55 s, `SPRING`) und neue aus `scale` 0.7 erscheinen (0.45 s, `SPRING`). Ein neuer Aufruf, solange einer läuft, beendet den alten sofort (`killTweensOf` auf den Karten, `render()` sofort) und startet neu.

- [ ] **Schritt 1: Failing Tests:**

```js
test('a filter change knows which cards leave, stay and enter', () => {
  assert.deepEqual(planFilterTransition(['a', 'b', 'c'], ['b', 'd']), { leaving: ['a', 'c'], staying: ['b'], entering: ['d'] });
});
test('a staying card starts where it stood before', () => {
  assert.deepEqual(flipOffset({ left: 400, top: 120 }, { left: 20, top: 120 }), { x: 380, y: 0 });
});
```

- [ ] **Schritt 2:** → FAIL. **Schritt 3:** umsetzen; `filterByCategory`, die Aktion `searchEvents` und `resetEventFilters` rufen in der Grid-Ansicht `filterOverview(grid, () => renderOverview())`; Kalender und erstes Laden bleiben wie bisher. **Schritt 4:** → PASS.
- [ ] **Schritt 5: E2E** `test('filtering glides the remaining cards into place')` und Review-Focus `test('fast typing leaves every card at its grid place')`: „r“, „ra“, „rai“, „raid“ ohne Pause tippen, dann leeren → nach 1 s hat jede Karte `transform` `none` (oder Identität) und `opacity` 1; Anzahl wie vorher.
- [ ] **Schritt 6:** `npm test`, `npx playwright test e2e/motion.spec.js e2e/events.spec.js` → PASS. **Commit** „Let the overview cards glide when the filter changes“.

---

### Task 5: Balken und Zahlen wachsen

**Files:**
- Modify: `public/js/events/list.js` (Platz-Balken der Karten wachsen mit dem gestaffelten Erscheinen; das gestaffelte Erscheinen selbst läuft über `animateFromTo`, damit es „Bewegung reduzieren“ beachtet), `public/js/polls/polls.js` (Ja- und Vielleicht-Balken wachsen von 0 auf ihre Breite, gestaffelt 0.12 s), `public/js/admin/dashboard.js` (`.stat-value` zählt hoch)
- Test: `test/motion.test.js` (Fake-DOM), `e2e/motion.spec.js`

**Interfaces:**
- Consumes: `growMeter`, `countUp`, `animateFromTo`, `SPRING`

- [ ] **Schritt 1: Failing Tests** (Fake-DOM, Aufzeichnungen):
  - `test('the overview meters grow after the cards appear')`: `showEventsSection()` mit zwei Events → je `.capacity-meter` ein Tween auf `value` mit `SPRING`, `delay` steigt um 0.12 s.
  - `test('poll bars grow from zero')`: `renderPollDetail` → Tweens `width` von `0` mit `SPRING`.
  - `test('admin numbers count up')`: `loadAdminStats` → `countUp`-Tween je `.stat-value` (0.8 s).
  - jeweils mit `reducedMotion: true`: keine Tweens mit Bewegung, Endwerte stehen sofort.
- [ ] **Schritt 2:** → FAIL. **Schritt 3:** umsetzen (Balken: `growMeter` bzw. `width` von 0; Zahlen: `countUp`, die Zahl steht im Markup als Endwert, der Tween startet bei 0). **Schritt 4:** → PASS.
- [ ] **Schritt 5: E2E** `test('bars and numbers end at their values')`: Übersicht, Abstimmung, Admin-Statistik → nach 1.2 s haben `progress.value`, Balkenbreiten und Zahlen ihre Endwerte.
- [ ] **Schritt 6:** `npm test` → PASS. **Commit** „Grow bars and count numbers up when they appear“.

---

### Task 6: Gleitender Marker in Menü und Tabs

**Files:**
- Create: `public/js/core/tab-glider.js`
- Modify: `public/index.html` (Marker-Element in der Navigationsleiste, Startzustand `.is-hidden`), `public/css/style.css` (Navbar-Unterstrich als ein gleitendes Element statt `.nav-link.active::after` ab `lg`; darunter bleibt `::after`), `public/css/components.css` (Gleiter der `.nav-pills`, aktive Fläche wird durchsichtig, wenn ein Gleiter da ist), `public/js/core/router.js` (Marker nach dem Setzen von `.active`), `public/js/admin/event-table.js` (Tabs der Admin-Tabelle), `public/js/admin/wizard.js` (`showPreviewArea`), `public/js/pages/debug-components.js` (Styleguide-Tabs, falls sie wechseln)
- Test: `test/tabGlider.test.js`, `e2e/motion.spec.js`

**Interfaces:**
- Consumes: `SPRING`, `animateTo`
- Produces:
  - `markerBox(containerRect, linkRect, width?: number): { x: number, width: number }` — rein; ohne `width` die volle Breite des Links, mit `width` (Navbar: 30) mittig unter dem Link
  - `glideMarker(container: HTMLElement, marker: HTMLElement, activeLink: HTMLElement|null, { width, animate = true } = {}): void` — beim ersten Mal ohne Animation, danach 0.5 s `SPRING`; ohne aktiven Link versteckt
  - `glideTabs(container: HTMLElement): void` — für `.nav-pills`: legt bei Bedarf `.nav-glider` im Container an (auch nach `innerHTML`-Neuzeichnen) und startet an der zuletzt bekannten Stelle (Merker per `WeakMap` auf den Container)
- Aussehen: Navbar-Marker 30 px × 2 px, `var(--accent)`, `var(--radius-pill)` (wie das heutige `::after`); Tabs-Gleiter mit `--bs-nav-pills-link-active-bg` (`var(--accent-tint-2)`) und `var(--radius-sm)`.

- [ ] **Schritt 1: Failing Tests:** `test('the navbar marker sits centered under the link')` (`markerBox({ left: 100 }, { left: 300, width: 90 }, 30)` → `{ x: 230, width: 30 }`), `test('a tab glider takes the full tab width')` (ohne `width` → `x = link.left − container.left`, `width = link.width`).
- [ ] **Schritt 2:** → FAIL. **Schritt 3:** umsetzen und an Router, Admin-Tabs, Assistent und Styleguide anschließen; bei `resize` den Navbar-Marker ohne Animation nachsetzen (Listener in `main.js`). **Schritt 4:** → PASS.
- [ ] **Schritt 5: E2E** `test('the navbar marker glides under the active link')` (Desktop: Profil öffnen, nach 0.8 s liegt die Mitte des Markers ±2 px unter der Mitte von „Mein Profil“), `test('the admin tab glider follows the tab')`, Review-Focus `test('the marker follows a resized window')` (`setViewportSize` → Marker wieder unter dem aktiven Link).
- [ ] **Schritt 6:** `npm test`, `npx playwright test e2e/motion.spec.js e2e/admin.spec.js e2e/styleguide.spec.js` → PASS. **Commit** „Glide the active marker in the navbar and the tabs“.

---

### Task 7: Klapp-Ziffern im Countdown

**Files:**
- Create: `public/js/events/countdown.js` (zieht `formatCountdown`, `renderCountdownHTML`, `startCountdown` aus `detail.js` um; Namen und Verhalten bleiben)
- Modify: `public/js/events/detail.js` (Import statt eigener Funktionen), `public/css/style.css` (Ziffernzellen mit `overflow: hidden`)
- Test: `test/countdown.test.js`

**Interfaces:**
- Produces:
  - `changedDigits(oldText: string, newText: string): number[] | 'rebuild'` — rein; Positionen, an denen sich ein Zeichen ändert; `'rebuild'` bei anderer Länge (z. B. 10 → 9 Tage)
  - `renderCountdownHTML(cd)` zeichnet jede Ziffer als Zelle (`.countdown-digit` mit einem inneren `<span>`), Bezeichnungen und Ablauf-Text wie heute
  - `startCountdown(element, targetDate)` aktualisiert pro Sekunde nur geänderte Zellen: alte Ziffer `yPercent` −100 und ausblenden (0.35 s, `power2.in`), neue von `yPercent` 100 (0.5 s, `SPRING`); bei `'rebuild'` die ganze Einheit neu zeichnen; reduziert: Ziffer sofort tauschen

- [ ] **Schritt 1: Failing Tests:** `changedDigits('14', '13')` → `[1]`; `changedDigits('20', '19')` → `[0, 1]`; `changedDigits('10', '9')` → `'rebuild'`; `renderCountdownHTML({ days: 1, hours: 2, mins: 3, secs: 4 })` enthält acht `.countdown-digit` und die Bezeichnungen „Tage“, „Std“, „Min“, „Sek“; `renderCountdownHTML(null)` liefert den heutigen Ablauf-Text.
- [ ] **Schritt 2:** → FAIL. **Schritt 3:** umsetzen; `detail.js` wird dabei kürzer. **Schritt 4:** → PASS.
- [ ] **Schritt 5: E2E** `test('the countdown flips only the changing digit')`: Event-Seite eines kommenden Events, nach 1.5 s steht genau eine Zelle der Sekunden mit neuem Wert, die Anzahl der Zellen bleibt gleich.
- [ ] **Schritt 6:** `npm test` → PASS. **Commit** „Flip the countdown digits that change“.

---

### Task 8: Erfolgsmoment

**Files:**
- Create: `public/js/events/detail-motion.js`
- Modify: `public/js/events/detail.js` (`showEventDetail(eventId, { celebrate } = {})`; die vier `gsap.from('.col-lg-8', …)` werden ein Aufruf `revealDetail(celebrate)`), `public/js/events/registration-form.js` (Erfolg der Anmeldung; Abmelden), `public/js/events/checkin.js` (Erfolg des Check-ins)
- Test: `test/detailMotion.test.js`, `e2e/motion.spec.js`

**Interfaces:**
- Consumes: `SPRING`, `animateTo`, `animateFromTo`, `growMeter`
- Produces:
  - `pressButton(button: HTMLElement): void` — `scale` 0.94, 0.1 s, `power2.in`
  - `revealDetail(celebrate?: 'registered' | 'checkedin', { fromTaken } = {}): void` — ohne `celebrate` das heutige Hereingleiten (`.col-lg-8`, `y` 20, 0.4 s, `power3.out`, reduziert nur Blende) und der Balken der Seitenleiste wächst von 0 (`growMeter`, Teil der Idee „Balken und Zahlen“); mit `'registered'`: kein Hereingleiten, stattdessen `#detail-registered` (`scale` 0.92 → 1, Blende, 0.5 s, `back.out(2)`), Knopf in `#sidebar-action-area` (`scale` 0.94 → 1, 0.5 s, `back.out(2.2)`), `.capacity-meter` der Seitenleiste von `fromTaken` auf den neuen Wert (`growMeter`, 0.6 s); mit `'checkedin'`: der Kasten in `#checkin-section` springt (`scale` 0.92 → 1, 0.5 s, `back.out(2)`)
  - `fadeOutRegistration(): Promise<void>` — `#detail-registered` blendet aus (0.25 s), für das Abmelden
- `submitRegistration`: vor dem Senden `pressButton(btn)`, vor dem Neuaufbau den alten Wert von `#sidebar-capacity-content .capacity-meter` lesen, dann `showEventDetail(eventId, { celebrate: 'registered', fromTaken })`. `submitCheckin`: `showEventDetail(eventId, { celebrate: 'checkedin' })`. `unregisterFromEvent`: nach Erfolg `await fadeOutRegistration()`, dann `showEventDetail(eventId)`.
- Aussehen nach der Anmeldung bleibt wie heute (Status als farbiger Text, Seitenleisten-Knopf „Angemeldet“ bei jedem Status grün).

- [ ] **Schritt 1: Failing Tests** (Fake-DOM, Aufzeichnungen):
  - `test('a registration springs the status box, the button and the bar')`: `showEventDetail('e1', { celebrate: 'registered', fromTaken: 4 })` mit Routen für Event (5 von 20) und `my-registration` (`accepted`) → Tweens auf `#detail-registered` (`ease: 'back.out(2)'`), auf den Knopf (`back.out(2.2)`), auf `value` des Seitenleisten-Balkens mit `fromVars.value === 4`; kein Tween auf `.col-lg-8`.
  - `test('a page opened normally still slides in')`: ohne `celebrate` → genau ein Tween auf `.col-lg-8` und ein `value`-Tween des Seitenleisten-Balkens ab 0.
  - `test('a check-in springs the check-in box')`.
  - `test('with reduced motion the success moment only fades')`.
- [ ] **Schritt 2:** → FAIL. **Schritt 3:** umsetzen; `detail.js` bleibt ≤ 500 Zeilen (Task 7 hat Platz geschaffen). **Schritt 4:** → PASS.
- [ ] **Schritt 5: E2E** `test('registering celebrates in place')`: Tom meldet sich bei einem selbst angelegten offenen Event an (Event per Admin-Anfrage anlegen wie in `e2e/admin.spec.js`) → `#detail-registered` sichtbar, Seitenleiste „Angemeldet“, Balken zeigt einen Platz mehr, keine Fehler; danach Abmelden.
- [ ] **Schritt 6:** `npm test`, `npx playwright test e2e/motion.spec.js e2e/events.spec.js e2e/tour.spec.js` → PASS. **Commit** „Celebrate a registration and a check-in in place“.

---

### Task 9: Wiki und Gesamtlauf

**Files:**
- Modify: `docs/wiki/modules/frontend-app.md` (neue Module `core/motion.js`, `core/tab-glider.js`, `events/card-flight.js`, `events/overview-motion.js`, `events/countdown.js`, `events/detail-motion.js`; Router gibt Promises zurück; Aktionen `openEventCard`, `closeEventPage`), `docs/wiki/modules/frontend-markup.md` (Flug-Ebene, Navbar-Marker, Tabs-Gleiter, Dialog-Übergang, reduzierte Bewegung), `docs/wiki/ops/testing.md` (neue Testdateien und `e2e/motion.spec.js`, `animations` aus `loadFrontendApp`), `docs/wiki/graph.json` (generiert)

- [ ] **Schritt 1:** Knoten anpassen (Englisch).
- [ ] **Schritt 2:** `npm run wiki`, `npm test`, `npm run test:e2e` → grün.
- [ ] **Schritt 3:** Sichtprüfung im Mock-Modus (Scratch-Datenbank, Server per PID beenden): Kartenflug hin und zurück, Filter, Dialog, Toast, Marker, Countdown, Anmeldung; einmal mit „Bewegung reduzieren“ (Playwright `reducedMotion: 'reduce'`).
- [ ] **Schritt 4: Commit** „Describe the motion modules in the wiki“.
