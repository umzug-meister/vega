# Issue 01 – Integrations- und Kompatibilitäts-Proof

**Stand:** 2026-10-09/10 (punktueller Nachweis-Stand)
**Status:** Teilproof – lokale Node-24-Auth-/Prisma-Integration verifiziert; Hostinger-/Provider-Proofs offen.

> Hinweis: Dieses Dokument hält die Nachweise zum jeweiligen Laufzeitpunkt fest
> (u. a. 14 Migrationen, 57/60 Tests, Prisma 6.19.3 vor dem ORM-Upgrade). Die
> Zahlen und Versionsstände sind historisch; der aktuelle Stand steht in
> `implementation-status.md`.

## Lokaler Proof vor dem ORM-Upgrade (2026-10-09)

Ausgeführt im Verzeichnis `vega/` mit Node.js `24.21.0` und npm `11.19.0`:

| Prüfschritt | Ergebnis |
|---|---|
| Node.js / npm | `24.21.0` / `11.19.0` |
| Typecheck (Workspaces plus Prisma-Seed) | bestanden |
| Lint | bestanden, Oxlint-Korrektheitsregeln |
| Tests | bestanden, 57/57 Unit-/API-Tests, 6/6 isolierte DB-Tests und 1/1 Produktions-Smoke-Test |
| Produktionsbuild für Domain, Server, Admin und Kundenformular | bestanden |
| `npm audit` | 0 bekannte Schwachstellen nach Behebung des unten genannten Befunds |
| Prisma-Migrationen auf lokaler MariaDB 10.11.19 | 14 versionierte Migrationen auf leerer Test-DB sowie laufender lokaler DB angewendet; inklusive relationaler Adressen/Positionen, Gutschriften, Mahnungsereignisse und A3-Kontosperrung |
| Schema-Drift | Datenbank und Prisma-Schema stimmen überein |
| Ein-Prozess-Deployment | Kompilierten Server gestartet; Healthcheck, Admin/Form/Assets, Laufzeit-Loader und API-Grenzen bestanden |
| Initialadmin/Auth-Integration | Prisma-Seed → Login → erzwungener Passwortwechsel → TOTP-Enrollment → erneuter Login mit TOTP bestanden |
| A3 Mitarbeiterverwaltung | Reale DB-/HTTP-Abläufe: Admin-Passwortbestätigung, Anlage, Sperrung/Entsperrung, Rollen-/Origin-Grenzen, Mass-Assignment-Abweisung, Sitzungs-/Challenge-Widerruf, 2FA-Reset und Sole-Admin-Recovery bestanden |
| A3 Reset-/Recovery-Proof | Verschlüsselte einmalige case-sensitive Recovery-Codes, HTML-/Text-Reset-Link, Einmal-Token und generische Self-Service-Antwort; Mock-Mailerfolg/-fehler, absolute Sessiondauer/-ablauf und persistente Auth-Limits bestanden |

Der getestete Versionssatz umfasst Better Auth `1.7.7`, Prisma `6.19.3`, TypeScript `7.0.2`, Express `5.2.1`, React/React DOM `19.3.0`, Vite `8.3.2` und MUI `9.4.0`. Der Auth-Smoke-Test nutzte eine lokale, nichtproduktive MariaDB-Testdatenbank mit synthetischem Konto.

Am 2026-10-09 wurden zusätzlich Orderverwaltung, Rechnungs-CRUD und das
serverseitige Rechnungs-PDF lokal gebaut/getestet. Der PDF-Test prüft einen
gültigen PDF-Stream; das exakte visuelle Layout bleibt bei Änderungen manuell
gegen das Legacy-PDF abzunehmen.

Kundenformular, GCS-Verifikation und Optionen wurden ebenfalls lokal gebaut
und getestet. Eine rollbackgeschützte Prüfung gegen die lokale Datenbank
bestätigt Speicherung und Abweisung veralteter Einstellungsrevisionen, ohne
Geschäftswerte zu verändern. Öffentliche Formularoptionen bleiben leer, bis
der Betreiber tatsächliche Werte speichert; keine Testwerte wurden übernommen.

Für A1/A2 besteht ein Node-24-CI-Workflow mit Lockfile-Installation, Lint,
Typecheck, frischen Migrationen, Schema-Drift-Prüfung, Tests und Build.
Die lokale DB-Prüfung verwendet eine separate, leere `_test`-Datenbank und
verifiziert eindeutige Geschäftsnummern, atomaren Rollback und parallele
Nummernvergabe, unabhängige Kopien und Finanzbelege, Mail-/Journal-Kaskaden,
relationalen Read/Edit/Copy sowie die additive Überführung von Vega-Entwürfen.
Der GitHub-gehostete Workflow wurde hier nicht ausgeführt; seine tatsächliche
Ausführung und das Hostinger-Deployment bleiben externe Nachweise.

Der A3-Proof verwendet ausschließlich synthetische Mitarbeiterkonten in einer
separaten `_test`-Datenbank und gemockte Hostinger-Antworten, keine echten
Mails. Better Auths generischer Reset-Endpunkt unterdrückt Versandfehler;
deshalb bestätigt der Admin-Resetpfad den Erfolg zusätzlich anhand des
abgeschlossenen Mailcallbacks. Die Sperrungs-Migration erhält bestehende
Konten, Aufträge und Optionen. Das Auth-/Plugin-Schema wurde mit CLI `1.7.7`
in ein separates Vergleichsartefakt generiert, nicht über das Fachschema
geschrieben. Die Admin-UI nutzt typisierte Additional Fields statt ungeprüfter
Session-Casts.

### Beim Proof gefundener Dependency-Befund

Der erste Audit-Lauf meldete zwei kritische Findings über `concurrently@9.2.4` → `shell-quote@1.9.0` (GHSA-pqg4-j6r4-53mv). `vega/package.json` pinnt Overrides für `shell-quote`, `mysql2` und `deepmerge-ts`; damals wurde Prisma `6.19.3` ohne den verwundbaren Prisma-7-MariaDB-Treiber verwendet. Der damalige `npm audit` meldete 0 bekannte Schwachstellen. Es wurde kein `npm audit fix --force` verwendet.

Für Rechnungs-, Gutschrift- und Mahnungs-PDFs wird serverseitig `pdfkit`
verwendet, nicht die Legacy-Browserbibliothek `jspdf`; `npm audit --omit=dev`
meldet weiterhin 0 Vulnerabilities. Auftrags-/Angebots-PDFs nutzen seit
2026-10-10 ebenfalls nur serverseitig `jspdf`/`jspdf-autotable`, nie im Browser.

Bei `npm ci` meldet npm weiterhin, dass das optionale Install-Script von `fsevents@2.3.3` nicht in `allowScripts` freigegeben ist. Installation, Tests und Builds funktionieren trotzdem; das Script wurde nicht zusätzlich freigegeben.

## Lokaler Prisma-7-Upgrade-Proof (2026-10-10)

Ausgeführt mit Node.js `24.18.0` und npm `11.16.0`. Prisma CLI,
`@prisma/client` und `@prisma/adapter-mariadb` sind exakt `7.10.0`;
Better Auth bleibt unverändert bei `1.7.7`.

| Prüfschritt | Ergebnis |
|---|---|
| Reproduzierbare Installation | `npm ci` mit finalem Lockfile bestanden; nur das bereits bekannte optionale `fsevents`-Script bleibt gesperrt |
| Versionsauflösung | CLI/Client/Adapter `7.10.0`, gezielt überschriebener Treiber `mariadb@3.5.4`, keine ungültigen Peer Dependencies |
| Generate / Build ohne DB-Secrets | `db:generate` und `build` ohne `DATABASE_URL` und ohne `.env` bestanden; `db:migrate:deploy` ohne URL scheitert ausdrücklich |
| Typecheck / Lint | beide bestanden, einschließlich Seed, Recovery und neuer Konfigurationstests |
| Unit-/API-Tests | 60/60 bestanden; drei neue Tests für URL-Decoding, Pool-/Timeout-Konfiguration, Fehler ohne Credential-Ausgabe und strikte TLS-Konfiguration |
| Frische Migrationen / Status / Drift | alle 14 unveränderten SQL-Migrationen auf neuer isolierter MariaDB 10.11.19 angewendet; Status aktuell, kein Schema-Drift |
| Database-/Auth-Tests | 8/8 bestanden, auch mit `TZ=Europe/Berlin`; FK-Regeln, Rollback, parallele Nummernvergabe und kompletter A3-DB-/HTTP-Auth-Lifecycle |
| Datentypen / Fehlercodes | JSON, Decimal, UTC-DateTime mit Millisekunden, BigInt oberhalb der sicheren JS-Integergrenze sowie `P2002`/`P2025` nachgewiesen |
| Seed / Recovery-CLI | expliziter Admin-Seed, idempotente Wiederholung ohne Passwortänderung und tatsächlicher Recovery-Befehl mit Widerruf von Sitzungen/Challenges/Faktoren bestanden |
| Produktionsbuild / Deployment | alle Workspaces gebaut; 1/1 Ein-Prozess-Smoke-Test bestanden; kompilierter Prisma-Client verbindet und liest die Test-DB unter Node ohne `tsx` |
| Dependency-Audit | `npm audit` und `npm audit --omit=dev`: jeweils 0 bekannte Schwachstellen |

Die Testdatenbank lag in einem separaten, ausschließlich für diesen Proof
gestarteten und anschließend entfernten Container ohne produktive Daten.
Die laufende App-Datenbank
wurde nicht migriert, zurückgesetzt oder mit Testkonten befüllt.
DB-Testdateien laufen nun seriell, damit der Bootstrap-/Sole-Admin-Proof
nicht mit anderen Auth-Fixtures konkurriert. Unit-/Deployment-Tests setzen
ihre DB-Konfiguration ausdrücklich auf ein synthetisches, unerreichbares
Ziel und benötigen keine echten DB-Zugänge.

`prisma-client` erzeugt ESM-TypeScript unter
`apps/server/src/generated/prisma/`; `tsc` kompiliert es mit den bestehenden
NodeNext-/`.js`-Imports nach `apps/server/dist/`. Die URL liegt für die
CLI in `prisma.config.ts`, für die Runtime wird sie explizit in sichere
Adapteroptionen übersetzt. Neue SQL-Migrationen oder Auth-Schemaänderungen
waren für dieses Upgrade nicht erforderlich. Clientgenerierung und Seed
werden bewusst separat ausgeführt.

### Gezielter MariaDB-Treiber-Override

Auch Adapter `7.10.0` pinnt upstream noch `mariadb@3.4.5`
([npm-Metadaten](https://registry.npmjs.org/@prisma%2Fadapter-mariadb/7.10.0)).
Der zunächst vorgesehene Override auf `3.4.7` behebt Passwort-Offenlegung
und SET-Key-Injection, wurde aber im anschließenden Audit noch durch einen
weiteren ed25519-/TLS-Befund beanstandet. Deshalb verwendet der geprüfte
Versionssatz einen ausschließlich auf den Adapter begrenzten Override auf
`3.5.4`, nicht einen ungeprüften Majorwechsel oder `audit fix --force`.

| Advisory | Patch in verwendeter Linie |
|---|---|
| [GHSA-cqhc-2h57-wpxf – Password Disclosure bei TLS](https://github.com/advisories/GHSA-cqhc-2h57-wpxf) | seit `3.5.3` |
| [GHSA-v6pj-gxxw-phfw – SQL Injection bei `permitSetMultiParamEntries`](https://github.com/advisories/GHSA-v6pj-gxxw-phfw) | seit `3.5.4` |
| [GHSA-cx2f-j9fh-8g68 – Uncaught Exception bei ed25519/TLS](https://github.com/advisories/GHSA-cx2f-j9fh-8g68) | seit `3.5.4` |

Der Override weicht vom offiziellen Adapter-Pin ab; die oben ausgeführten
echten DB-/Auth-Regressionen sind deshalb Teil dieses Versions-Proofs.
Bei künftigen Updates erneut Auflösung, Audit und Kompatibilität prüfen.
TLS-Zertifikatsprüfung wird nicht abgeschaltet. Die reale
Hostinger-Verbindungs-/CA-Konfiguration und der tatsächliche GitHub-CI-Lauf
bleiben externe Nachweise, keine durch diesen lokalen Proof erfüllten Gates.

Referenz für Generator, Config, Adapter und die expliziten Generate-/Seed-
Schritte: [offizieller Prisma-v7-Upgrade-Guide](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7).

## Noch offen – externe Proofs

| Bereich | Status / benötigter Nachweis |
|---|---|
| Hostinger Managed Node 24 | Nicht geprüft. Start, Healthcheck, Runtime-Env und Prisma-Migrationslauf müssen im tatsächlichen nichtproduktiven Tarif erprobt werden. |
| Cron | Nicht geprüft. Scheduler-Aufruf, Proxy-/IP-Header und sichere interne Ausführung im Tarif nachweisen. |
| Hostinger MySQL / Prisma-Deployment | Noch nicht im tatsächlichen Hostinger-Tarif geprüft; lokaler Migrationstest belegt keine Zieltarif-Kompatibilität. |
| Hostinger Mail API | Nicht aufgerufen. API-Anfrage, Empfänger, HTML/Text, PDF-Anhang und Fehlerantwort benötigen nichtproduktive Zugangsdaten und Mock-/Testempfänger. |
| EU-GCS | Nicht geprüft. Private Bucket-Region, Signed-URL-Beschränkung, Upload-Verifikation, Staging-Bereinigung und 180-Tage-Lifecycle benötigen Testprojekt/-bucket. |
| WordPress-Loader/CORS | Nicht geprüft. WordPress-Test-Origin und nicht eingebrannte absolute Asset-/API-Pfade benötigen eine Testseite/-Origin. |
| Google Places | Nicht geprüft. Serverseitige Keybeschränkung und DE/AT-Filter benötigen nichtproduktive Runtime-Zugänge. Der Browser erhält keinen Google-Key. Lokal sind Proxy-Projektion (`street`/`postalCode`/`city`), Session-Token-Format, Fehler-/Rate-Limit-Abbildung und Secret-Freiheit mit gemocktem Fetch getestet; der echte Provideraufruf bleibt offen. |
| Google Routes | Nicht geprüft. Serverseitige Depot-/Stop-Berechnung benötigt einen nichtproduktiven Runtime-Key und den tatsächlichen Standort. Lokal sind Stoppreihenfolge (Depot → 2–4 Adressen → Depot), Validierung, Rundung auf ganze Kilometer, Fehlerabbildung und Autorisierungsgrenze (anonyme Requests erhalten `401` vor jeder Providerlogik) getestet; echte Distanz-/Preisabnahme bleibt offen. |

## Weiterhin offene Punkte (Issue 00)

- Re-Authentifizierung ist entschieden und implementiert: aktuelles Admin-Passwort bei jeder Anlage, Sperrung/Entsperrung, Rollenänderung, Reset-Mail und jedem 2FA-Reset (ADR 0002). Kein offener lokaler A3-Blocker.
- Der Betreiber stellt bei Bedarf nichtproduktive Hostinger-, Mail-, GCS- und Google-Places-Zugänge sowie WordPress-Test-Origin als Runtime-Konfiguration/Umgebungsvariablen bereit; sie liegen aktuell nicht vor.
- Der Betreiber stellt bei Bedarf die nötige externe Archivkonfiguration als serverseitige Runtime-Umgebungsvariablen bereit. Die konkrete externe Sicherung/gesetzliche Aufbewahrung ist vor Go-live weiterhin nachzuweisen; die App kann sie nicht verifizieren.

Die lokalen Auth- und Finanz-Purge-Entscheidungen aus Issue 00 sind dokumentiert. Diese Teilprüfung schließt Issue 01 dennoch nicht ab und gibt weder Finanz-Purge noch Produktionsbetrieb frei. Tarif-/Provider-Proofs und externe Aufbewahrungsbestätigung bleiben Freigabegates.
