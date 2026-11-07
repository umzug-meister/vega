# Betrieb und Konfiguration

Betriebswissen für Entwicklung und Hostinger-Betrieb. Fachregeln stehen in
`implementation-plan.md`, `target-architecture.md` und den ADRs.

## Runtime-Konfiguration

Alle Werte sind serverseitige Runtime-Variablen (Vorlage: `.env.example`). Keine
Domains oder Secrets in Vite-Builds.

| Variable                                                               | Zweck                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `DATABASE_URL`                                                         | MySQL/MariaDB-URL für Prisma-CLI und Server                           |
| `APP_BASE_URL`, `BETTER_AUTH_URL`                                      | Öffentliche Basis-URL der App                                         |
| `BETTER_AUTH_SECRET`                                                   | Zufälliges Secret, mindestens 32 Zeichen (`openssl rand -base64 32`)  |
| `BETTER_AUTH_TRUSTED_ORIGINS`                                          | Exakte Admin-Origins                                                  |
| `CORS_ALLOWED_ORIGINS`                                                 | Exakte Origins inkl. WordPress/Kundenformular; in Produktion HTTPS    |
| `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`                        | Nur für den einmaligen Seed, danach entfernen                         |
| `HOSTINGER_MAIL_API_TOKEN`, `HOSTINGER_MAILBOX_RESOURCE_ID`            | Mailversand; ohne sie antwortet Versand mit `503 MAIL_NOT_CONFIGURED` |
| `HOSTINGER_MAIL_API_BASE_URL`                                          | Optional, Standard `https://api.mail.hostinger.com`                   |
| `GOOGLE_MAPS_API_KEY`                                                  | Places-Proxy und Admin-Route; ohne Key bleibt manuelle Eingabe        |
| `GCS_BUCKET`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS` | Bild-Uploads (siehe `gcs-bucket-setup.md`)                            |

`localhost` und `127.0.0.1` sind unterschiedliche Origins. Der Kundenformular-Origin
gehört nur in `CORS_ALLOWED_ORIGINS`. Nach Änderungen an `.env` den Server neu starten.

### Fehlerlogs und Diagnose

Unerwartete Serverfehler werden mit `requestId`, Methode/Pfad, HTTP-Status,
Fehlerklasse, einer stabilen Kategorie (`errorReason`, z. B.
`database-input-validation`) und – sofern vorhanden – einem streng geprüften
Infrastrukturcode protokolliert. Bei Prisma `P2039` (nicht zugeordneter
Treiberfehler) kommen die ursprüngliche numerische Datenbank-Fehlernummer
(`databaseErrorCode`, z. B. `1267`) und der SQLSTATE (`databaseErrorState`)
hinzu; die Logmeldung nennt sie als `MariaDB <Nummer>`. Die Logmeldung selbst
nennt Statuscode und Fehlerklasse, etwa
`request failed: INTERNAL_SERVER_ERROR (PrismaClientValidationError, database-input-validation)`.
Routen dürfen zusätzlich einen whitelist-basierten `failureContext` ergänzen,
etwa `operation`, Suchart und Suchlänge der Auftragssuche; Suchbegriffe und
Kundendaten gehören nicht hinein. Prisma-Fehler ergänzen nur Tabellen-/Feldnamen
und Quellpositionen innerhalb des Servercodes. Fehlernachrichten, Stack-Text,
`cause`, SQL-Argumente, Request-Bodies, Tokens, E-Mail-Inhalte und beliebige
Fehler-Properties werden nicht geloggt. Für die Diagnose Antwort-`requestId` und
Logeintrag korrelieren; keine sensiblen Werte nachträglich in Logs aufnehmen.

### Hostinger-Reverse-Proxy

Betreiberentscheidung vom 2026-10-18: Express verwendet ausdrücklich
`app.set("trust proxy", 1)` vor Routern und Rate-Limits. Diese Einstellung gilt
auch lokal. Ohne `X-Forwarded-For` bleibt die Socket-Adresse maßgeblich;
mit Header verwendet Express die rechteste Adresse als `req.ip`. Vor den
Better-Auth-Routen überschreibt Vega `x-vega-auth-client-ip` mit genau diesem
Express-Wert; Better Auth nutzt ausschließlich diesen Header für IP-basiertes
Rate-Limiting. Ein vom Client gesendeter Header gleichen Namens wird ignoriert.

Nach Änderungen der Hosting-/Proxy-Konfiguration die Client-IP-Ermittlung und
Rate-Limits im Zielbetrieb erneut prüfen. Die Ein-Hop-Einstellung nur ändern,
wenn Hostingers Proxy-Kette verifiziert wurde; andernfalls könnten Clients ihre
IP-Rate-Limits umgehen oder gemeinsam limitiert werden. Rücknahme: die
Ein-Hop-Einstellung entfernen und den Better-Auth-Forwarding-Header deaktivieren.

### `DATABASE_URL`-Optionen

| Option             | Verhalten                        |
| ------------------ | -------------------------------- |
| `connection_limit` | Standard 5                       |
| `connect_timeout`  | Sekunden, Standard 5             |
| `pool_timeout`     | Sekunden, Standard 10            |
| `sslaccept=strict` | TLS mit Zertifikatsprüfung       |
| `sslcert`          | Pfad zur CA-Datei; aktiviert TLS |

Unbekannte/doppelte Optionen, Timeouts `0` und `sslaccept=accept_invalid_certs`
werden abgewiesen. Credentials in der URL prozentkodieren.

Der Server pinnt die Verbindung unabhängig von Hosting-/Server-Defaults auf
`utf8mb4` mit Collation `utf8mb4_unicode_ci` (Schema-Collation). MariaDB setzt
ab 11.5/11.8 für `utf8mb4` standardmäßig `uca1400`; ohne Pinning können
`contains`-/`LIKE`-Suchen mit `ER 1267 (Illegal mix of collations)` fehlschlagen.

## GCS-Produktion: CLI-Setup und Credential-Ablage

Produktionsbucket: `vega-eu-images`, Projekt: `housemoving-1527875558789`,
Service Account:
`vega-server-gcs-prod@housemoving-1527875558789.iam.gserviceaccount.com`.

Die ausführbaren Befehle stehen zentral in
[GCS-Bucket-Setup](./gcs-bucket-setup.md):

- Schritte 1–5: `gcloud`-Prüfungen, APIs, Bucket, Lifecycle, Produktions-CORS und
  bucketbezogene IAM-Rollen statt Klickanleitung.
- Schritt 6: SSH/SCP auf Port 65002 für Schlüsselablage außerhalb des Deployments,
  Verzeichnisrechte 700 und Dateirechte 600.
- Schritt 7: serverseitige Hostinger-Variablen und App-Neustart.
- Schritt 8: dokumentierter Cloud-Konfigurationsstand und offene Upload-Abnahme.

Zielpfad des Schlüssels:
`/home/u959171828/.config/vega/gcs-prod-service-account.json`.
Die Managed-App muss diesen Pfad sehen und lesen können; erfolgreicher SSH-
Zugriff allein weist das nicht nach. Keine Credentials in Git, Webroot,
Build-Artefakte oder Logs legen. SSH-`export` konfiguriert nicht die Managed-App.
Am 2026-10-18 wurden CORS und die beiden Bucket-Rollen gesetzt und geprüft;
Credential-Übertragung und End-to-End-Upload bleiben separat nachzuweisen.

## Datenbank

Lokal läuft **MariaDB 11.8.9** per Docker Compose auf `127.0.0.1:3307`, passend
zur Hostinger-Zieldatenbank. Dort meldete `SELECT VERSION();` am 2026-10-19
`11.8.9-MariaDB-log`. Hostinger nennt MariaDB ohne feste Version
([Hostinger-Support](https://www.hostinger.com/support/1583226-which-database-management-system-is-used-at-hostinger/));
vor jedem Deployment die Version erneut mit `SELECT VERSION();` prüfen.

### Hostinger-Datenbank einrichten

In hPanel eine MySQL-Datenbank und einen Datenbankbenutzer anlegen und dem
Benutzer Zugriff auf diese Datenbank geben. Für `DATABASE_URL` benötigt die App
alle vier Verbindungsangaben: Datenbankname, Benutzername, Passwort und den
Datenbank-Host. Den Host sowie einen abweichenden Port aus den Datenbankdetails
in hPanel übernehmen; `127.0.0.1` aus der lokalen `.env` gilt nur für die
Docker-Datenbank. Ein Benutzername und Passwort allein reichen nicht. Falls
Host, Datenbankname oder Benutzer in hPanel noch fehlen, zuerst die Datenbank
einrichten oder die Angaben beim Hostinger-Support erfragen.

Die URL im Format `mysql://BENUTZER:PASSWORT@HOST:PORT/DATENBANKNAME` als
serverseitige Runtime-Variable `DATABASE_URL` in der Hostinger-App konfigurieren,
nicht in ein Frontend-Build eintragen oder in Git committen. Sonderzeichen in
Benutzername und Passwort müssen URL-prozentkodiert sein. TLS-Optionen nur
konfigurieren, wenn Hostingers Datenbankdetails sie verlangen und das passende
CA-Zertifikat verfügbar ist. Anschließend die Verbindung und Version auf der
Zieldatenbank prüfen und Migrationen mit `npm run db:migrate:deploy` ausrollen.

```sh
npm run db:migrate:dev -- --name describe_change   # neue Migration
npm run db:generate                                  # Prisma-Client nach Schemaänderung
npm run db:migrate:deploy                            # geprüfte Migrationen ausrollen
npm run db:check-schema                              # Drift-Prüfung
```

Prisma 7.10.0 generiert nach `apps/server/src/generated/prisma/` (nicht
versioniert). `dev` und `build` generieren automatisch. Migrationen seeden nicht;
dafür `npm run db:seed`. Der `mariadb@3.5.4`-Override ist in
`proof-01-integration-compatibility.md` begründet.

Der Root-Build hat ein standardmäßig deaktiviertes `postbuild`: Nur mit
`VEGA_MIGRATE_ON_BUILD=true` und gesetztem `DATABASE_URL` führt es nach dem
erfolgreichen Build `npm run db:migrate:deploy` aus. Das ist ein expliziter
Opt-in für einen kontrollierten Deployment-Build, kein Ersatz für Backup- und
Zieldatenbankprüfung. Details zum Hostinger-Ablauf stehen in
[`hostinger-setup.md`](./hostinger-setup.md).

### Legacy-Katalogimport

`npm run db:import-legacy-catalog` liest den Katalog der Bestands-App
(`umzug-meister.de/wp-json/um-configurator/v1`) und überträgt ihn in die
aktuellen Katalogtabellen:

```sh
npm run db:import-legacy-catalog             # Vorschau ohne Datenänderung
npm run db:import-legacy-catalog -- --apply  # schreibt transaktional
```

Der Import ersetzt den gesamten Katalog (Kategorien, Möbel mit
Kategorie-Verknüpfungen, Services, Packmaterial, Angebote) sowie `boxCbm` und
`kleiderboxCbm` in `appSettings`; die Transaktion ist dabei atomar. Er
übernimmt nur Felder der Zielstruktur: Legacy-`t35` wird zu `trucks`,
`desc`/`description` zu `description`, `imgUrl` zu `media`; die entfernten
Felder (`montagePrice`, `extraPrice`, `bulky`, `m100`, `m150`, `colli`, Slug)
und `Counter`-Zähler werden verworfen. Schrittgrößen in Vielfachen von 0,5,
einschließlich 0,5, werden übernommen; ungültige Schrittgrößen werden auf 1
gesetzt und als Hinweis gemeldet. Datensätze ohne Namen oder Kategorie sowie
mit ungültigen Preisen/Volumen werden übersprungen und als Hinweis gemeldet.
Der Plan liegt in
`apps/server/src/catalog/legacy-import.ts`, das Skript in
`prisma/import-legacy-catalog.ts`.

## Erstadmin

`npm run db:seed` legt einmalig `root_user` mit `INITIAL_ADMIN_EMAIL` und
`INITIAL_ADMIN_PASSWORD` an; ein erneuter Seed ändert nichts. Beim ersten Login
Initialpasswort ändern und TOTP einrichten.

## Signaturfarbe

Die Signaturfarbe wird im Mitarbeiterprofil gewählt. Unterstützt werden
Schwarz (`#000000`, Standard), Blau (`#28527A`) und Orange (`#CB722F`). Die
Farbe wird mit jeder E-Mail in der Outbox gespeichert, damit ein späterer Retry
dieselbe Signaturdarstellung verwendet. Die Vorschau im Profil reagiert direkt
auf Änderungen an Name und Farbauswahl.

### Migration

Die Migration `20261018100000_user_signature_color` ergänzt den Benutzer und
die E-Mail-Outbox. Bestehende Benutzer erhalten den schwarzen Standardwert;
bereits eingereihte Nachrichten ohne Farbsnapshot werden beim Versand ebenfalls
schwarz dargestellt.

## Recovery bei Verlust des einzigen Admin-Authenticators

Nur für autorisierte Betreiber mit Server-/DB-Zugang. Vorher Identität über einen
unabhängigen Kontakt und eine aktuelle DB-Sicherung prüfen. Gibt es einen weiteren
aktiven Admin, dessen Mitarbeiterverwaltung nutzen (2FA-Reset); die CLI verweigert dann.

```sql
SELECT id FROM user WHERE role = 'Admin' AND blocked = false;
```

```sh
npm run auth:recover-admin -- <user-id> --confirm-identity-and-backup
```

Widerruft Sitzungen, Challenges, Authenticator und Recovery-Codes; Passwort und
Rolle bleiben. Danach anmelden und TOTP neu einrichten. Bei verlorenem Passwort
den Mailreset nutzen – ohne Mailversand ist das ein Betriebsblocker, kein Grund
für einen neuen Seed.

## Tests

Nach `npm ci` baut ein separates `npm run build` Prisma-Client, Domain,
Server und beide Frontends; kein automatischer Root-`postinstall`-Build.
Build-Tools werden über `.npmrc`
(`include=dev`) auch bei einer Produktionsinstallation installiert. Hostingers
Express-Eingabedatei ist die versionierte Root-Datei `server.js`; `npm start`
nutzt denselben Einstieg. Keine Builds oder Migrationen beim Serverstart.
Details: [Hostinger-Setup](./hostinger-setup.md#3-nodejs-app-und-quellcode-bereitstellen).

```sh
npm run typecheck && npm run lint && npm test && npm run build
npm run test:deployment   # nach build: startet den kompilierten Server
```

DB-Tests nur gegen eine **separate leere Datenbank mit Namen auf `_test`**:
Migrationen mit `DATABASE_URL` darauf ausrollen, dann
`TEST_DATABASE_URL=… npm run test:database`. Niemals die App-Datenbank verwenden.
Die Regressionen umfassen echte konkurrierende Auftrags-/Rechnungs-PUTs:
genau ein Update muss erfolgreich sein, das andere muss `409` liefern,
ohne Teiländerungen an Beziehungen. UI-Interaktionen laufen lokal mit
jsdom; sie ersetzen keinen Browser-/WordPress-Proof.

Die Suite priorisiert Fachregeln, Berechtigungen, Datenintegrität,
Fehlerbehandlung und reale Bedienabläufe. Reine CSS-/MUI-Strukturprüfungen,
Quelltext-Regex und redundante Wrapper-Tests werden nicht gepflegt.
PDF-Tests sichern vollständige Inhalte und Seitenbegrenzungen statt exakter
Zeichenkoordinaten oder Zeichenstrom-Hashes; die globale Vorgabe kompakter
Admin-Eingabefelder bleibt separat abgesichert.

CI (`.github/workflows/ci.yml`) nutzt Node 24 und MariaDB 11.8.9 inkl. frischer
Migrationen und Drift-Prüfung.

## WordPress-Einbettung

Nach dem Produktionsbuild `<APP_BASE_URL>/customer-form/loader.js` in WordPress
einbinden (kein iframe). Den WordPress-Origin in `CORS_ALLOWED_ORIGINS` aufnehmen
und Styles/CSP dort prüfen.

### Maintenance und Smoke-Test

Admins finden im eigenständigen Hauptmenüpunkt **Maintenance** (`/maintenance`) die
Loader-URL und einen kopierbaren `<script>`-Einbettungscode für einen
WordPress-Block „Individuelles HTML“. Die URL wird serverseitig aus
`APP_BASE_URL` erzeugt, nicht aus der aktuellen Browseradresse.

Die Seite zeigt ausschließlich Namen und Setzstatus freigegebener
Runtime-Variablen, keine Secrets, Datenbank-URLs, Credential-Dateipfade oder
Provider-Rohantworten. Pflichtwerte, optionale Integrationen, aktive Standards
und nach dem Seed zu entfernende Erstadmin-Werte sind getrennt gekennzeichnet.
Die Übersicht beschreibt den Stand beim Serverstart. Nach Änderungen an der
Runtime-Konfiguration den Server neu starten und die Seite neu laden.
Wenn eine beim Start zwingende Variable ungültig ist oder fehlt, startet die
App weiterhin nicht; diese Fehler müssen im Deployment behoben werden.

**Smoke-Test starten** ruft die Admin-only API
`POST /api/admin/maintenance/smoke-test` auf (höchstens zweimal pro Minute
und Mitarbeiter, Origin-Prüfung, `Cache-Control: no-store`). Die Statusübersicht
`GET /api/admin/maintenance` löst selbst keine Provider-Anfragen aus.
Der Test prüft parallel mit einem Zeitlimit von zehn Sekunden:

- Datenbank: `SELECT 1`, keine Änderungen an Fachdaten; kein Migrations-/Schema-Proof.
- Formular-Build: Vite-Manifest sowie referenzierte JS-/CSS-Dateien.
- Hostinger Mail: authentifizierter Quota-GET der konfigurierten Mailbox.
  Kein Mailversand, keine Prüfung der Zustellung oder Sendeberechtigung.
- Google Places (New) und Routes: synthetische Testadresse bzw. Testkoordinaten,
  keine Kunden-/Betriebsdaten. Die echten API-Aufrufe können Quota und Kosten
  verursachen.
- GCS: Bucket-Metadaten und bestehende EU-/Privat-/180-Tage-Löschregeln.
  Keine Datei wird geschrieben; Schreibrechte und Signierung sind nicht geprüft.

Nicht konfigurierte Provider werden als „Nicht geprüft“ ausgewiesen.
Fehler einzelner Checks verhindern die übrigen Ergebnisse nicht. Die API und
Logs enthalten nur sichere Status-/Fehlerhinweise, keine Provider-Inhalte oder
Zugangsdaten. WordPress-Einbettung, CORS/CSP, Formularübermittlung, vollständiger
Bildupload und Mailzustellung müssen zusätzlich im echten Zielbetrieb geprüft
werden. Der Test ersetzt diese Freigabe-Gates nicht.

## Weitere Anleitungen

- `hostinger-setup.md` – Schritt-für-Schritt-Deployment, Runtime-Variablen, SSH, Migrationen und Go-live-Checkliste
- `hostinger-mail-cron.md` – zentraler Hostinger-Cron für Archiv-Purges und Mail-Retries (`node scripts/cron.js`)
- `gcs-bucket-setup.md` – GCS-Bucket, Lifecycle, CORS, Service Account
