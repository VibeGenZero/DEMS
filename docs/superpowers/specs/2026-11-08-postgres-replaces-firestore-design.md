# PostgreSQL statt Firestore — Design Spec
**Datum:** 2026-11-08 · **Ticket:** R-01 (GitHub #101, Prio-Plan `2026-10-07-dems-3.0-prioplan.md`, Entscheidung 4) · **Branch:** `101-r-01-datenmigration-und-abwärtskompatibilität` → PR gegen `release/3.0`

## Überblick

Heute wählt `firebaseAdmin.js` beim Laden den Datenspeicher: Sind alle `FIREBASE_*`-Werte gesetzt, nutzt DEMS Firebase Firestore (Client-SDK `firebase/firestore`), sind alle leer, nutzt es `db/sqliteAdapter.js`. Der SQLite-Adapter bildet die Firestore-Teilmenge nach, die das Projekt nutzt (`collection`, `doc`, `getDoc`, `getDocs`, `addDoc`, `setDoc`, `updateDoc`, `deleteDoc`, `query`, `where`, `orderBy`, `writeBatch`). Er speichert alles in einer Tabelle `documents (collection, id, data)` mit JSON-Text und filtert und sortiert in JavaScript.

Das laufende System des Betreibers liegt auf Firestore, aber nur mit Testdaten. Laut Entscheidung 4 im Prio-Plan bekommt DEMS 3.0 PostgreSQL als eigenen Container im Compose, mit dem es sich automatisch verbindet.

**Ziel:** Mit 3.0 läuft DEMS in Produktion auf PostgreSQL. `docker compose up` richtet die Datenbank samt Zugangsdaten selbst ein, ohne Handarbeit in der `.env`. Firestore verschwindet vollständig aus Code, Abhängigkeiten, Konfiguration und Doku. Damit spätere Releases (3.1, 3.2 …) Daten sicher umbauen können, bekommt DEMS eine Schema-Versionierung mit Migrationsschritten, die beim Start automatisch laufen.

## Entscheidungen des Betreibers

1. **Kein Datenumzug.** Die Firestore-Daten sind Testdaten und dürfen wegfallen. 3.0 startet mit einer leeren PostgreSQL-Datenbank. Es gibt kein Firestore→PostgreSQL-Skript.
2. **Firestore fällt komplett weg:** Paket `firebase`, alle `FIREBASE_*`-Variablen, die Firestore-Weiche in `firebaseAdmin.js` und alle Firestore-Hinweise in Doku und Wiki.
3. **Docker richtet die Datenbank automatisch ein.** Ein PostgreSQL-Container im Compose; Datenbank, Nutzer und Passwort entstehen beim ersten Start, und DEMS verbindet sich, ohne dass jemand die `.env` anfasst.
4. **SQLite bleibt** für `npm run dev:mock`, `compose.dev.yaml` und die Tests.
5. **Produktion ohne PostgreSQL startet nicht.** Mit `NODE_ENV=production` und ohne PostgreSQL-Konfiguration beendet sich DEMS mit einer deutschen Fehlermeldung (Exit-Code 1). Einen stillen Rückfall auf SQLite gibt es nicht.
6. **Der neue Admin-Tab „System“** (Health-Status usw.) ist ein eigenes Ticket nach diesem und gehört nicht in diesen Umfang.

## Ziele, Nicht-Ziele, Anti-Ziele

**Ziele**
- PostgreSQL-Adapter mit derselben Firestore-artigen API wie der SQLite-Adapter. Routen, Bot, Utils und Middleware ändern sich nicht.
- Gleiches Verhalten in SQLite und PostgreSQL, abgesichert durch eine gemeinsame Testsuite für beide.
- `compose.yaml` startet DEMS und PostgreSQL. Zugangsdaten werden beim ersten Start erzeugt, DEMS wartet, bis die Datenbank bereit ist.
- Schema-Versionierung: nummerierte Migrationsschritte, die beim Start genau einmal und in Reihenfolge laufen.
- Firestore vollständig entfernt, Wiki und Konfigurationsdoku entsprechen dem neuen Stand.

**Nicht-Ziele**
- Kein Datenumzug aus Firestore oder aus bestehenden SQLite-Dateien.
- Kein relationales Schema (Tabellen pro Sammlung, Spalten pro Feld). Das Speichermodell bleibt ein Dokumentenspeicher.
- Kein Admin-Tab „System“ und keine Erweiterung von `/healthz` (eigenes Ticket).
- Keine Upgrade-Anleitung für Fremdbetreiber (R-06).
- Kein Umbenennen von `firebaseAdmin.js` (siehe „Folgearbeiten“).
- Kein Betrieb mehrerer DEMS-Instanzen gegen dieselbe Datenbank.

**Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)**
- Der Betreiber muss ein Datenbank-Passwort selbst erfinden und in die `.env` schreiben, damit `docker compose up` funktioniert.
- SQLite und PostgreSQL liefern für dieselbe Abfrage unterschiedliche Ergebnisse oder Reihenfolgen.
- DEMS startet in Produktion scheinbar normal, schreibt aber in eine SQLite-Datei.
- Der PostgreSQL-Port ist von außen erreichbar.
- Ein fehlgeschlagener Migrationsschritt wird übergangen, und DEMS läuft mit halb umgebauten Daten weiter.

## Design

### 1. Auswahl des Datenspeichers (`firebaseAdmin.js`)

`firebaseAdmin.js` bleibt die einzige Stelle, die den Speicher wählt (CLAUDE.md-Regel „Data access only through `firebaseAdmin.js`“). Die Regel lautet neu:

| Bedingung | Speicher |
|---|---|
| PostgreSQL konfiguriert (`DATABASE_URL` oder `PGHOST` gesetzt) | PostgreSQL-Adapter |
| sonst, `NODE_ENV=production` | Abbruch: deutsche Meldung, was fehlt, `process.exit(1)` |
| sonst | SQLite-Adapter (`SQLITE_PATH`, Standard `./data/dems.sqlite`) |

`dev/mockMode.js` leert `DATABASE_URL` und alle `PG*`-Variablen, so wie heute die `FIREBASE_*`-Werte. Der Mock-Modus läuft damit immer auf SQLite. `test/helpers.js` nimmt `DATABASE_URL` und das Präfix `PG` in die Liste der Variablen auf, die nicht in Tests durchsickern dürfen (`LEAKING_PREFIXES`/`LEAKING_KEYS`). Die `FIREBASE_`-Einträge dort entfallen.

Die Startmeldung nennt den gewählten Speicher, ohne Passwort.

### 2. Gemeinsamer Kern und zwei Adapter

Der Code, der heute in `db/sqliteAdapter.js` steckt und nicht SQLite-spezifisch ist, wird nach `db/documentStore.js` herausgezogen: Referenz-Objekte (`collection`, `doc`, `query`, `where`, `orderBy`), Auto-IDs, Snapshots, `getFieldValue`, `matchesWhere`, die Sortierung und die Merge-Regeln von `updateDoc` und `writeBatch`. Er arbeitet gegen eine kleine Speicher-Schnittstelle (lesen, alle einer Sammlung lesen, upsert, löschen, Transaktion).

- `db/sqliteAdapter.js` liefert diese Schnittstelle mit `better-sqlite3`, Verhalten unverändert.
- `db/postgresAdapter.js` liefert sie mit `pg` (neue Abhängigkeit, reines JavaScript ohne Kompilieren; Grund: PostgreSQL-Anbindung laut Entscheidung 4).

So gibt es genau eine Implementierung der Filter-, Sortier- und Merge-Logik, und beide Speicher verhalten sich zwingend gleich.

**Tabelle in PostgreSQL:** dieselbe wie in SQLite, `documents (collection TEXT, id TEXT, data TEXT, PRIMARY KEY (collection, id))`. Die Daten bleiben JSON-**Text** und werden nicht als `JSONB` gespeichert. `JSONB` sortiert Objektschlüssel um, und DEMS verlässt sich an Stellen auf die Reihenfolge der Schlüssel, z. B. bei Formularantworten, die nach Feldlabel gespeichert sind (Known Issue 4). Gefiltert wird ohnehin in JavaScript, `JSONB` brächte also keinen Vorteil.

**Asynchroner Start:** Anders als SQLite braucht PostgreSQL einen Verbindungsaufbau. Der Adapter legt beim ersten Gebrauch Tabelle und Index an (`CREATE TABLE IF NOT EXISTS`) und hält ein `ready`-Promise, auf das jede API-Funktion intern wartet. `firebaseAdmin.js` exportiert zusätzlich `ready()` (bei SQLite sofort erfüllt) und `close()`. `server.js` wartet vor `app.listen`, vor `startBot` und vor den Schedulern auf `ready()` und die Migrationen (Abschnitt 3). Schlägt das fehl, beendet sich der Prozess mit einer deutschen Meldung und Exit-Code 1, und Docker startet ihn neu. Der Verbindungsaufbau versucht es eine begrenzte Zeit mit wachsendem Abstand erneut, damit ein langsam startender Postgres-Container kein Fehlstart ist.

**`writeBatch`** läuft in PostgreSQL als echte Transaktion (`BEGIN`/`COMMIT`, bei Fehler `ROLLBACK`) auf einer Verbindung des Pools.

**Herunterfahren:** `gracefulShutdown` in `server.js` ruft nach dem Stoppen von Bot und Schedulern `close()` auf und schließt damit den Pool.

### 3. Schema-Versionierung und Migrationen

- Migrationsschritte liegen als `db/migrations/NNN-<kurzname>.js` und exportieren `{ id, description, up(api) }`. `api` ist dieselbe Firestore-artige API, die alle anderen nutzen. Ein Schritt läuft dadurch unverändert auf SQLite und PostgreSQL.
- Erledigte Schritte stehen in der Sammlung `schemaMigrations` (Dokument-ID = Schritt-ID, Daten `{ appliedAt: <ISO>, description }`).
- `db/migrate.js` (Runner) liest beim Start alle Dateien, sortiert sie nach Nummer und führt die noch nicht erledigten nacheinander aus. Nach jedem Erfolg wird der Schritt eingetragen. Schlägt ein Schritt fehl, bricht der Start ab (deutsche Meldung mit Schritt-ID), und spätere Schritte laufen nicht.
- Der Runner läuft bei jedem Start, auch im Mock-Modus und auf SQLite.
- Mit 3.0 gibt es noch keine echten Schritte, denn die Datenbank startet leer. Der Ordner enthält eine kurze `README.md` mit den Regeln: Schritte nie nachträglich ändern; jeder Schritt muss wiederholbar sein, weil ein Abbruch zwischen `up` und dem Eintrag möglich ist; Daten nur über die API verändern. Der Runner wird mit Test-Schritten aus einem Fixture-Ordner geprüft.

### 4. Docker und Compose

`compose.yaml` bekommt drei Dienste:

1. **`db-secret`** (einmaliger Init-Dienst, gleiches Image wie `postgres`): Liegt im Volume `dems-secrets` noch keine Datei `db_password`, erzeugt er ein zufälliges Passwort und legt es dort ab, lesbar für den Nutzer `node` im DEMS-Container. Bei jedem weiteren Start lässt er die vorhandene Datei unverändert.
2. **`postgres`** (Image `postgres` mit fest gepinnter Major-Version, Alpine-Variante): `POSTGRES_DB=dems`, `POSTGRES_USER=dems`, `POSTGRES_PASSWORD_FILE` zeigt auf die Datei aus dem Secret-Volume. Daten im Volume `dems-pg`. **Kein `ports:`**, Postgres ist also nur im Compose-Netz erreichbar. Healthcheck mit `pg_isready`. `depends_on: db-secret` mit `condition: service_completed_successfully`.
3. **`dems`** wie bisher, zusätzlich `PGHOST=postgres`, `PGDATABASE=dems`, `PGUSER=dems` und `PGPASSWORD_FILE` (Datei im Secret-Volume, nur lesend eingebunden). `depends_on: postgres` mit `condition: service_healthy`. `SQLITE_PATH` entfällt. Das Volume `/app/data` bleibt für hochgeladene Banner (`UPLOAD_DIR`).

`PGPASSWORD_FILE` ist eine DEMS-eigene Variable: Der PostgreSQL-Adapter liest die Datei und übergibt das Passwort an `pg`. `DATABASE_URL` bleibt als Alternative für eine externe PostgreSQL, etwa bei einem Betrieb ohne Compose. Ist `DATABASE_URL` gesetzt, hat es Vorrang.

Im `Dockerfile` entfällt `SQLITE_PATH` aus der Runtime-Stufe, und der Kommentar zum Volume nennt nur noch die Uploads. `compose.dev.yaml` bleibt ohne PostgreSQL (Mock-Modus, SQLite). Der Firebase-Hinweis im Kopfkommentar wird angepasst.

Das Compose-Beispiel für den Hostinger-VPS in `docs/wiki/ops/deployment.md` wird genauso umgebaut (drei Dienste, Traefik-Labels nur an `dems`).

### 5. Firestore entfernen

- Paket `firebase` aus `package.json` und `package-lock.json` entfernen.
- `firebaseAdmin.js`: Firestore-Zweig und Firebase-Konfiguration weg, neue Auswahlregel aus Abschnitt 1. Der Dateiname bleibt (siehe Folgearbeiten). Ein Kopfkommentar erklärt, warum die Datei trotz des Namens nichts mit Firebase zu tun hat.
- `.env.example`: Block `FIREBASE_*` weg; neuer Block „Datenbank“ (deutsche Kommentare) mit `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`/`PGPASSWORD_FILE` und dem Hinweis, dass Compose alles automatisch setzt. `SQLITE_PATH` bleibt mit dem Hinweis „nur Entwicklung und Tests“.
- `dev/mockMode.js`, `test/helpers.js`: `FIREBASE_KEYS`/`FIREBASE_` ersetzen wie in Abschnitt 1.
- Kommentare und Log-Texte, die „Firebase“ oder „Firestore“ als aktuellen Speicher nennen (z. B. `utils/sessionStore.js`, `server.js`, `db/sqliteAdapter.js`), anpassen. Der Ausdruck „Firestore-artige API“ für die Schnittstelle bleibt bestehen.
- `CLAUDE.md`, `README.md`, `openspec/config.yaml`: Firestore als Option streichen, PostgreSQL (Produktion) und SQLite (Entwicklung/Tests) nennen.
- Wiki: alle Knoten mit Firestore-Bezug aktualisieren (u. a. `modules/data-layer.md`, `ops/configuration.md`, `ops/docker.md`, `ops/deployment.md` inkl. Backup per `pg_dump`, `ops/testing.md`, `ops/ci.md`, `overview/architecture.md`, `overview/directory-map.md`, `concepts/data-model.md`, `concepts/security.md`, `howto/add-collection.md`, `reference/conventions.md`). In `reference/decisions.md` eine Zeile „PostgreSQL ersetzt Firestore (R-01)“ ergänzen; Einträge in `reference/known-issues.md`, die nur Firestore betreffen, entfernen. Danach `npm run wiki`.
- Historische Dokumente (`docs/security/SECURITY_AUDIT_2026-04-22.md`, archivierte OpenSpec-Changes, alte Specs und Pläne) bleiben unverändert.

### 6. Tests (TDD, `node:test`)

- **Gemeinsame Vertragstests** `test/documentStore.contract.test.js`: dieselbe Testliste (CRUD, `where`-Operatoren, mehrfaches `orderBy`, `null`/`undefined` in der Sortierung, `updateDoc` auf fehlendes Dokument wirft, `writeBatch` atomar inkl. Rollback, Erhalt der Schlüsselreihenfolge, Auto-IDs) läuft gegen SQLite immer und gegen PostgreSQL, wenn `TEST_DATABASE_URL` gesetzt ist. Ohne `TEST_DATABASE_URL` wird der PostgreSQL-Teil sichtbar als übersprungen gemeldet, damit `npm test` lokal ohne Postgres grün bleibt.
- **Auswahlregel:** Produktion ohne PostgreSQL-Konfiguration → Exit-Code 1 mit deutscher Meldung; Entwicklung ohne → SQLite; Mock-Modus mit gesetztem `DATABASE_URL` → trotzdem SQLite; `PGPASSWORD_FILE` wird gelesen.
- **Migrations-Runner:** Reihenfolge, genau einmal, Eintrag in `schemaMigrations`, Abbruch beim Fehler ohne spätere Schritte, erneuter Lauf setzt fort.
- Bestehende Suites laufen unverändert auf SQLite.

### 7. CI

- GitHub Actions, Job `test`: ein `services: postgres`-Container, `TEST_DATABASE_URL` gesetzt, damit die Vertragstests dort gegen echtes PostgreSQL laufen.
- GitHub Actions, Job `docker-build`, und `.gitlab-ci.yml`: Der Smoke-Test startet das Produktions-Image nicht mehr allein (es würde laut Entscheidung 5 abbrechen), sondern per `compose.yaml` zusammen mit `db-secret` und `postgres` und wartet auf den Healthcheck. Gestartet wird mit einer Wegwerf-`.env`, die nur `SESSION_SECRET` enthält. Das prüft zugleich die automatische Einrichtung der Zugangsdaten.
- Die Bedingung im `docker-build`-Job, wann das Image gebaut wird, nimmt `db/` mit auf.
- `docs/wiki/ops/ci.md` entsprechend anpassen.

## Was dem Builder überlassen ist

- Konkrete Retry-Dauer und -Abstände beim Verbindungsaufbau, Pool-Größe.
- Wie der Init-Dienst das Passwort erzeugt (z. B. `/dev/urandom` + `base64`) und Dateirechte/Owner im Secret-Volume, solange `node` im DEMS-Container lesen kann und sonst niemand außerhalb der Container.
- Die konkrete PostgreSQL-Major-Version (aktuelle stabile, fest gepinnt).
- Die Aufteilung von `db/documentStore.js` im Detail und die Form der Speicher-Schnittstelle.
- Ob die Vertragstests eine Datei mit Schleife über beide Adapter sind oder zwei dünne Dateien mit gemeinsamer Testliste.
- Wortlaut der deutschen Fehlermeldungen.

## Folgearbeiten (eigene Tickets)

- **Admin-Tab „System“:** Health-Status (Datenbank erreichbar, Bot verbunden, Laufzeit, Version, Schema-Version aus `schemaMigrations` …); dabei auch `/healthz` um einen Datenbank-Check erweitern.
- **`firebaseAdmin.js` umbenennen** (z. B. `db/index.js`): betrifft rund 80 Dateien und die CLAUDE.md-Regel, deshalb als reiner Umbenennungs-Chore getrennt.
- **R-06 Upgrade-Anleitung:** Umstieg Firestore → PostgreSQL für Betreiber dokumentieren.
- Der Prio-Plan-Punkt „Umstieg auf das Firebase Admin SDK (Audit M-01)“ wird gegenstandslos. Im Entscheidungslog vermerken.
