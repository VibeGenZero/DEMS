# Security Policy

> **English:** Please do not report security vulnerabilities through public issues. Use GitHub's private reporting instead: **Security › Report a vulnerability** in this repository ([direct link](https://github.com/VibeGenZero/DEMS/security/advisories/new)). We confirm every report within 7 days. Reports in English are welcome.

## Eine Sicherheitslücke melden

Bitte melde Sicherheitslücken **nicht** als öffentliches Issue, in Discord oder in einem Pull Request. Nutze stattdessen die private Meldung von GitHub:

1.  Im Repository auf **Security** › **Report a vulnerability** gehen ([direkter Link](https://github.com/VibeGenZero/DEMS/security/advisories/new)).
2.  Die Lücke beschreiben. Nur du und die Maintainer sehen die Meldung.

Hilfreich in der Meldung:

*   betroffene Version (steht unter **Admin › System** oder in `package.json`) und ob du das Image von Docker Hub oder einen eigenen Build nutzt,
*   Schritte zum Nachstellen, am besten im Mock-Modus (`npm run dev:mock`), der ohne echtes Discord auskommt,
*   was ein Angreifer damit erreichen kann (z. B. fremde Daten lesen, Admin-Rechte bekommen).

Bitte schicke keine echten Bot-Tokens, Passwörter oder Daten fremder Communitys mit, und teste nur gegen deine eigene Installation.

## Was nach deiner Meldung passiert

1.  **Innerhalb von 7 Tagen** bestätigen wir den Eingang und geben eine erste Einschätzung, ob und wie schwer DEMS betroffen ist.
2.  Wir halten dich in der Meldung auf dem Laufenden und stimmen Rückfragen dort mit dir ab.
3.  Der Fix erscheint in einem neuen Release (Docker-Image `latest` bzw. `beta`). Installationen sehen das Update unter **Admin › System**.
4.  Danach veröffentlichen wir ein GitHub Security Advisory. Wenn du möchtest, nennen wir dich dort als Finder.

Bitte veröffentliche Details erst, wenn der Fix erschienen ist oder wir gemeinsam einen Termin vereinbart haben.

## Unterstützte Versionen

| Version | Sicherheits-Fixes |
| --- | --- |
| neueste 3.x (Docker-Tag `latest`) | ja |
| neueste Vorabversion (Docker-Tag `beta`), solange es eine gibt | ja |
| ältere 3.x-Versionen | nein – bitte auf die neueste aktualisieren |
| 2.x und älter | nein |

Fixes gibt es nur als neues Release, nicht als Patch für ältere Stände.

## Was dazugehört

Zum Beispiel:

*   Login, Sitzungen und Admin-Rechte umgehen, z. B. ohne Admin-Rolle Admin-Funktionen nutzen,
*   Daten anderer Mitglieder lesen oder ändern, die man nicht sehen dürfte (Anmeldungen, Formularantworten, Check-in-Codes),
*   Cross-Site-Scripting, CSRF oder Umgehen der Content Security Policy,
*   Einrichtungsassistent ohne Setup-PIN erreichen oder Konfiguration ohne Admin-Reset-Passwort ändern,
*   über Discord-Befehle, Buttons oder Popups Dinge tun, die auf der Website nicht erlaubt wären,
*   Geheimnisse (Bot-Token, Client Secret, Session-Secret) aus Antworten, Logs oder dem Docker-Image auslesen,
*   Lücken im veröffentlichten Docker-Image oder in der CI, über die fremder Code in ein Release gelangt.

## Was nicht dazugehört

*   Fehler in der Einrichtung einer einzelnen Installation, z. B. kein HTTPS, eine öffentlich erreichbare Datenbank oder ein schwaches Admin-Reset-Passwort – siehe die Hinweise unten.
*   Lücken in Discord selbst oder in Diensten Dritter – bitte direkt dort melden.
*   Denial of Service durch reine Last oder Spam.
*   Fehlende Sicherheits-Header oder Best Practices ohne konkreten Angriffsweg.
*   Der Mock-Modus (`DEV_MOCK=true`): Er ist nur zum Entwickeln gedacht und startet mit `NODE_ENV=production` gar nicht.

Unsicher, ob etwas dazugehört? Melde es trotzdem privat – wir sortieren das.

## Hinweise für Betreiber

*   **HTTPS ist Pflicht.** Betreibe DEMS nur hinter einem TLS-Proxy; ohne HTTPS funktionieren Login und Einrichtung nicht.
*   **Aktuell bleiben.** Spiele Updates mit `docker compose pull && docker compose up -d` ein, sobald **Admin › System** eine neue Version meldet. Sicherheits-Fixes kommen nur für die neueste Version.
*   **Geheimnisse schützen.** Die `.env` (falls vorhanden) und die Docker-Volumes enthalten Bot-Token, Client Secret und das Datenbank-Passwort. Gib sie niemandem und lege sie nicht in ein Repository. Ein geleaktes Bot-Token im Developer Portal sofort neu erzeugen und unter **Admin › System** eintragen.
*   **Datenbank nicht öffnen.** Die mitgelieferte `compose.yaml` veröffentlicht PostgreSQL bewusst nicht nach außen – lass das so.
*   **Starkes Admin-Reset-Passwort.** Es schützt Systemeinstellungen, System-Reset und das Beenden des Panic-Modus.
*   **Rechte sparsam vergeben.** Admin in DEMS ist, wer die Admin-Rolle hat oder auf dem Discord-Server „Administrator“ ist. Vergib beides nur an vertraute Personen.
*   **Backups.** Sichere die Datenbank regelmäßig (`docker compose exec -T postgres pg_dump -U dems dems > dems-backup.sql`) und bewahre die Sicherung geschützt auf: Sie enthält die Daten deiner Mitglieder.
