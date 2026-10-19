# Vega bei Hostinger einrichten

Schritt-für-Schritt-Runbook für eine **nichtproduktive Erstinstallation** und
den späteren Produktiv-Rollout. Die konkreten hPanel-Bezeichnungen und
SSH-Pfade hängen vom gebuchten Tarif ab. Vor dem Go-live müssen Node 24,
SSH/CLI-Zugriff, Datenbankzugriff, Build/Start und Cron im tatsächlichen Tarif
nachgewiesen werden (siehe [ADR 0008](./adr/0008-hostinger-deployment.md)).

> **Wichtig:** Der lokale Build und die Tests belegen noch keinen erfolgreichen
> Hostinger-Betrieb. Laut [Implementierungsstand](./implementation-status.md)
> sind Provider-, Cron-, WordPress- und Archivierungs-Proofs weiterhin
> Go-live-Arbeit. Die lokalen 60-/30-Tage-Purge-Läufe ersetzen weder den
> Cron-Proof noch die externe gesetzliche Rechnungs-/Gutschriftenaufbewahrung.

## 1. Vorbereitungen

Du brauchst:

- eine Vega-Subdomain, z. B. `app.example.de`, mit aktiviertem HTTPS;
- einen Hostinger-Tarif, der eine Node.js-Web-App mit **Node.js 24**,
  `npm ci`, eigenem Startprozess und den unten beschriebenen CLI-Aufrufen
  unterstützt;
- Zugriff auf das hPanel, die Vega-App-Dateien per SSH und die
  Hostinger-Datenbankdetails;
- die WordPress-Origin, z. B. `https://www.example.de` (nur Origin, kein Pfad);
- sichere Werte für Mail, Admin-Bootstrap und – falls eingesetzt – Google/GCS.

Keine Passwörter, Tokens oder privaten Schlüssel in Git, `.env` im
Produktions-Repository, Frontend-Builds, Cron-Befehlszeilen oder Logs ablegen.
Runtime-Werte in hPanel nur in den serverseitigen Variablen der Node-App
hinterlegen. `.env.example` enthält ausschließlich eine lokale Vorlage und ist
keine Produktionskonfiguration.

## 2. Datenbank im hPanel anlegen

1. Im hPanel eine neue MySQL-Datenbank und einen eigenen Datenbankbenutzer
   erstellen.
2. Den Benutzer dieser Datenbank zuweisen und die von Vega benötigten Rechte
   vergeben.
3. Datenbankname, Benutzer, Passwort, Datenbank-Host und ggf. Port sicher
   notieren. `localhost` oder `127.0.0.1` aus der lokalen Docker-Konfiguration
   sind **nicht** automatisch der Hostinger-Datenbankhost.
4. Die Datenbank-Engine/-Version ermitteln; wenn möglich mit einem SQL-Client
   ausführen:

   ```sql
   SELECT VERSION();
   ```

   Hostinger dokumentiert MariaDB, aber keine feste Serverversion. Bei
   Kompatibilitätsproblemen vor dem Rollout den tatsächlichen Versionsstand mit
   der lokalen MariaDB-10.11.19-Basis vergleichen.

Die URL wird als `DATABASE_URL` gesetzt:

```text
mysql://<BENUTZER>:<PASSWORT>@<DB_HOST>:<PORT>/<DATENBANK>
```

Sonderzeichen in Benutzername, Passwort und Datenbankname müssen
URL-prozentkodiert sein. TLS-Parameter (`sslaccept=strict` und ggf. `sslcert`)
nur ergänzen, wenn Hostinger sie verlangt und das erforderliche CA-Zertifikat
am App-/CLI-Laufzeitpfad sicher verfügbar ist. Keine TLS-Prüfung abschalten.
Details: [Betrieb und Konfiguration](./operations.md#datenbank).

## 3. Node.js-App und Quellcode bereitstellen

1. Im hPanel eine Node.js-Web-App für die Vega-Subdomain anlegen und Node.js
   **24.x** auswählen.
2. Das Vega-Repository aus dem vorgesehenen Git-Deployment bereitstellen.
   Falls der Tarif den Git-Import nicht unterstützt, die Dateien über den
   unterstützten Hostinger-Deploymentweg übertragen. Nicht `old-app/`
   deployen: Es ist nur Referenz und gehört nicht zur Ziel-App.
3. Das **Repository-Root** als Arbeits-/Projektverzeichnis verwenden. Das ist
   das Verzeichnis mit `package.json`, `package-lock.json`, `apps/` und
   `prisma/`.
4. Als Framework **Express.js** auswählen, nicht React/Vite. In der Ansicht
   „Build- und Ausgabeeinstellungen“ diese Werte eintragen:

   | Einstellung      | Wert            |
   | ---------------- | --------------- |
   | Build command    | `npm run build` |
   | Package manager  | `npm`           |
   | Output directory | `.`             |
   | Entry file       | `server.js`     |

   Die versionierte Root-Einstiegsdatei lädt `apps/server/dist/main.js`.
   Das gesamte Projekt bleibt als Output erhalten: Der Server braucht auch
   die beiden Frontend-Builds und die Workspace-Pakete. Nicht nur einen
   einzelnen `dist`-Ordner ausgeben.

   Installation und Build bleiben getrennt; es gibt keinen Root-`postinstall`-
   Build. `.npmrc` installiert mit `include=dev` die Build-Werkzeuge auch bei
   `NODE_ENV=production`. Der normale Build führt keine Migrationen, keinen
   Seed und keinen Legacy-Import aus und startet keinen Server.
   Falls weitere Befehlsfelder vorhanden sind, gilt:

   ```sh
   npm ci
   npm run build
   npm start
   ```

   `npm run build` generiert den Prisma-Client, prüft TypeScript und baut den
   Server sowie beide Frontends. Der Express-Server bedient API, Admin-App und
   Kundenformular gemeinsam. Der Startbefehl ist `npm start`; nicht separat
   Vite-Dev-Server starten. Der Prozess muss den von Hostinger bereitgestellten
   `PORT` verwenden können (Vega verwendet `PORT` oder standardmäßig `3000`).

5. Wenn Node 24 nicht verfügbar ist oder nach der Installation kein
   Build-Lauf im Log erscheint, die Build-Einstellungen prüfen und nötigenfalls
   mit Hostinger klären. Die tatsächlich
   unterstützte Start-/Build-Konfiguration vor Go-live dokumentieren.

### Erfolgreiche Erstinstallation über den Build-Befehl (2026-10-18)

Der Betreiber hat die Erstinstallation am 2026-10-18 als erfolgreich bestätigt.
Da in der SSH-Shell Node/npm nicht verfügbar waren, erfolgte die Einrichtung
im Node-Build-Prozess von hPanel. Der dortige Build command blieb
`npm run build`; lediglich das Root-Build-Skript wurde für dieses Deployment
vorübergehend erweitert:

1. Prisma-Client generieren, TypeScript prüfen, Server und beide Frontends bauen.
2. `npm run db:migrate:deploy` ausführen.
3. `npm run db:seed` für den Erstadmin ausführen.
4. `npm run db:import-legacy-catalog -- --apply` ausführen.

Die Schritte waren mit `&&` verkettet, sodass ein Fehler die weiteren Schritte
verhindert hätte. Die benötigten Werte `DATABASE_URL`, `INITIAL_ADMIN_EMAIL`
und `INITIAL_ADMIN_PASSWORD` wurden der Build-Umgebung serverseitig
bereitgestellt; keine Secret-Werte gehören in Befehle oder Dokumentation.
Die erfolgreiche Einrichtung ersetzt keinen vollständigen Go-live-/Provider-Proof.

Die temporäre Erweiterung ist wieder entfernt. Standardmäßig baut
`npm run build` nur die Anwendung. Ein Root-`postbuild` führt
`npm run db:migrate:deploy` ausschließlich aus, wenn die serverseitige
Build-Umgebungsvariable `VEGA_MIGRATE_ON_BUILD=true` gesetzt ist; dann muss
`DATABASE_URL` auf die richtige Ziel-Datenbank zeigen. Für einen gezielten
Rollout kann die Variable für den Build gesetzt und danach wieder entfernt
werden. Vorher ein geprüftes Datenbank-Backup erstellen. Alternativ Migrationen
wie in Abschnitt 5 separat ausführen. Niemals die Variable für lokale Builds
oder einen Build mit unklarer `DATABASE_URL` aktivieren.

`INITIAL_ADMIN_EMAIL` und `INITIAL_ADMIN_PASSWORD` anschließend im hPanel
entfernen und die App neu starten. Initialpasswort ändern und TOTP einrichten.

**Nicht als regulären Releaseprozess wiederholen:** Der Legacy-Import ersetzt
den aktuellen Katalog. Seed und Import gehören nicht zum regulären Build- oder
Migrationsschritt.
Vor Datenbankänderungen eine Sicherung erstellen. Ein fehlgeschlagenes
Deployment oder ein Commit-Revert macht Datenbankänderungen nicht rückgängig.

### Fehler: `Entry file not found`

Repository-Root `./`, Framework Express.js und Eingabedatei `server.js` prüfen.
Die Änderung muss im deployten Git-Commit enthalten sein. Ein `dist`-Verzeichnis
ist nicht versioniert und existiert erst nach `npm run build`. Im Log
müssen `prisma generate`, TypeScript und beide Vite-Builds
erfolgreich durchlaufen. Erst danach startet `server.js`.
Eine npm-Warnung zu einem nicht freigegebenen `core-js`-Postinstall ist nicht
die Ursache für eine fehlende Eingabedatei; dafür keine pauschale
Installationsskript-Freigabe erteilen.

## 4. Runtime-Variablen in hPanel setzen

Variablen an der Node-App setzen, nicht mit `VITE_`-Präfix und nicht als
Browser-Konfiguration. Für Produktion sind mindestens folgende Werte
erforderlich:

| Variable                        | Wert / Hinweise                                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                      | `production`                                                                                                                                       |
| `DATABASE_URL`                  | Vollständige MySQL-URL aus Schritt 2                                                                                                               |
| `APP_BASE_URL`                  | Öffentliche Vega-Origin mit HTTPS, z. B. `https://app.example.de`                                                                                  |
| `BETTER_AUTH_URL`               | Dieselbe öffentliche Vega-Origin, ohne Pfad                                                                                                        |
| `BETTER_AUTH_SECRET`            | Zufälliger, einmaliger Secret-Wert mit mindestens 32 Zeichen; lokal z. B. mit `openssl rand -base64 32` erzeugen und nur direkt in hPanel einfügen |
| `BETTER_AUTH_TRUSTED_ORIGINS`   | Exakte Origins, kommagetrennt; produktiv mindestens die Vega-Origin, z. B. `https://app.example.de`                                                |
| `CORS_ALLOWED_ORIGINS`          | Exakte HTTPS-Origins, kommagetrennt: Vega-Origin und WordPress-Origin, z. B. `https://app.example.de,https://www.example.de`                       |
| `HOSTINGER_MAIL_API_TOKEN`      | Serverseitiger Hostinger-Mail-API-Token                                                                                                            |
| `HOSTINGER_MAILBOX_RESOURCE_ID` | Resource-ID des Postfachs; ggf. aus dem Mail-API-Setup ermitteln                                                                                   |

`BETTER_AUTH_TRUSTED_ORIGINS` und `CORS_ALLOWED_ORIGINS` sind Listen von
**Origins** im Format `https://host[:port]`, ohne Slash, Pfad oder Wildcard
`*`. `localhost` und `127.0.0.1` nicht in die Produktionslisten übernehmen.
Den Kundenformular-Origin nur in CORS eintragen, nicht automatisch als
Better-Auth-Origin. WordPress muss den Vega-Loader von der Vega-Origin laden.

Optionale Variablen nur setzen, wenn die jeweilige Integration eingerichtet
und getestet ist:

| Variable                         | Wann setzen                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HOSTINGER_MAIL_API_BASE_URL`    | Nur für einen dokumentierten API-Endpoint-Override; standardmäßig `https://api.mail.hostinger.com`                                                      |
| `GOOGLE_MAPS_API_KEY`            | Places API (New) und Routes API; serverseitig beschränken, Quoten/Kosten überwachen                                                                     |
| `GOOGLE_CLOUD_PROJECT`           | Google-Cloud-Projekt für GCS                                                                                                                            |
| `GCS_BUCKET`                     | GCS-Bucket für Bild-Uploads; Bucket- und Berechtigungssetup siehe [GCS-Anleitung](./gcs-bucket-setup.md)                                                |
| `GOOGLE_APPLICATION_CREDENTIALS` | Nur wenn Hostinger eine sicher bereitgestellte externe ADC-Credentials-Datei unterstützt; Datei außerhalb des Repositories und nicht öffentlich ablegen |
| `MAIL_MAINTENANCE_LIMIT`         | Optionaler Cron-Batch, 1–200; Standard 25                                                                                                               |
| `HOST`, `PORT`                   | Nur falls der Host sie nicht selbst setzt; Standard-Host ist `0.0.0.0`, Standard-Port `3000`                                                            |

Wenn GCS-Credentials nicht sicher als Runtime-Credentials bereitgestellt werden
können, GCS nicht aktivieren und den Bild-Upload-Go-live als blockiert
behandeln. Absenderadresse, Firmenempfänger und Absendername werden in der
Admin-App gepflegt, nicht als Geheimnisse in hPanel.

Nach jeder Änderung an Runtime-Variablen die App über hPanel neu starten.
Auth-Secret und Datenbankzugang nachträglich nicht unkoordiniert ändern: das
Secret schützt Auth-Sitzungen, und eine falsche Datenbank-URL kann die App
unverfügbar machen.

## 5. Deployment per SSH: Build und Migrationen

SSH ist nötig, wenn hPanel keinen passenden Build-/Migrationsschritt anbietet
oder wenn Migrationen/Seed gezielt ausgeführt werden müssen. SSH-Zugang im
hPanel aktivieren und dort angezeigten Host, Port und Benutzernamen verwenden:

```sh
ssh -p <SSH_PORT> <SSH_USER>@<SSH_HOST>
cd <VEGA_REPOSITORY_ROOT>
pwd
node --version
npm --version
```

`pwd` muss das Repository-Root zeigen. `node --version` muss `v24.x` und npm
mindestens Version 11 ausgeben. Der reale Root-Pfad ist tarifabhängig; keinen
Pfad aus einem Beispiel ungeprüft übernehmen.

Vor **jedem** Release:

1. In hPanel ein aktuelles Datenbank-Backup erstellen und prüfen, dass der
   Wiederherstellungsweg bekannt ist. Das App-Deployment enthält keinen
   Ersatz für Hostinger-Backups.
2. Den freigegebenen Commit bereitstellen. Bei einem Git-Checkout im SSH-Root:

   ```sh
   git status --short
   git pull --ff-only origin <DEPLOY_BRANCH>
   npm ci
   npm run build
   ```

   Bei einem anderen von hPanel verwalteten Deployment den dort vorgesehenen
   Release-Schritt verwenden, aber anschließend dieselben Migrationen und
   Smoke-Checks ausführen. Keine unbekannten lokalen Änderungen überschreiben.

3. Datenbankmigrationen aus dem Repository-Root gegen die **Ziel-Datenbank**
   ausrollen:

   ```sh
   npm run db:migrate:deploy
   ```

   Der SSH-Prozess muss dabei `DATABASE_URL` sicher erhalten. hPanel-
   App-Variablen werden nicht zwingend an SSH-Shells vererbt: vor dem Lauf
   prüfen, dass die Ziel-URL tatsächlich verfügbar ist, ohne sie auszugeben.
   Falls nicht, in Bash interaktiv verdeckt einlesen (Eingabe wird nicht
   angezeigt; der Befehl selbst enthält keinen Secret-Wert):

   ```sh
   read -r -s -p 'DATABASE_URL: ' DATABASE_URL; printf '\n'
   export DATABASE_URL
   npm run db:migrate:deploy
   unset DATABASE_URL
   ```

   Alternativ Hostingers sichere CLI-/Umgebungsverwaltung verwenden. Nicht als
   `DATABASE_URL=...` in die Befehlszeile, Shell-History oder ein versioniertes
   `.env` schreiben.

4. Erst nach erfolgreichem Build und Migration den Node-Prozess in hPanel
   starten bzw. neu starten. Migrationen nicht mit `migrate dev` auf der
   Produktionsdatenbank ausführen und keine Tabellen manuell ändern.

Wenn Migrationen fehlschlagen: Release nicht starten/fortsetzen. Fehlermeldung
ohne Zugangsdaten sichern, Ursache beheben und ggf. das vorab geprüfte
Backup-/Rollback-Verfahren verwenden. Keine destruktiven Datenbankkommandos als
spontane Reparatur ausführen.

## 6. Einmaligen Admin anlegen

Der Bootstrap legt nur den ersten Admin an. Initiale Werte ausschließlich
serverseitig als temporäre Umgebungsvariablen bereitstellen:

```text
INITIAL_ADMIN_EMAIL=<ADMIN_EMAIL>
INITIAL_ADMIN_PASSWORD=<EINMALIGES_STARKES_PASSWORT>
```

Das Passwort muss mindestens 8 Zeichen mit Großbuchstabe, Kleinbuchstabe und
Zahl haben. Falls der Seed in SSH ausgeführt werden muss, müssen sowohl
`DATABASE_URL` als auch diese beiden Werte in der Shell-Umgebung vorhanden
sein. Wenn sie nicht in die SSH-Shell vererbt werden, können sie in Bash
verdeckt abgefragt werden:

```sh
read -r -s -p 'DATABASE_URL: ' DATABASE_URL; printf '\n'
read -r -p 'INITIAL_ADMIN_EMAIL: ' INITIAL_ADMIN_EMAIL
read -r -s -p 'INITIAL_ADMIN_PASSWORD: ' INITIAL_ADMIN_PASSWORD; printf '\n'
export DATABASE_URL INITIAL_ADMIN_EMAIL INITIAL_ADMIN_PASSWORD
npm run db:seed
unset DATABASE_URL INITIAL_ADMIN_EMAIL INITIAL_ADMIN_PASSWORD
```

Den Seed im Repository-Root ausführen. Die Eingabewerte werden nicht in der
Shell-History gespeichert, sofern sie nicht zusätzlich in Befehle kopiert
werden; kopiere oder logge sie daher nicht.

Bei `Initial admin created` sofort `INITIAL_ADMIN_EMAIL` und
`INITIAL_ADMIN_PASSWORD` aus der hPanel-App-Konfiguration entfernen und den
App-Prozess neu starten. Bei `already exists` wird kein Passwort geändert.
Nach dem ersten Login Initialpasswort ändern und TOTP einrichten, bevor
geschützte Admin-Daten genutzt werden. Es gibt kein öffentliches Signup.

## 7. Funktion prüfen

Nach dem Neustart:

1. `https://<VEGA_HOST>/health` aufrufen; erwartet wird HTTP 200 mit
   `{"status":"ok","service":"vega"}`.
2. `https://<VEGA_HOST>/` öffnen, mit dem Bootstrap-Admin anmelden, Passwort
   ändern und TOTP vollständig einrichten.
3. In der Admin-App **Maintenance** öffnen. Die Variablenübersicht zeigt nur
   Namen/Setzstatus, keine Werte. Smoke-Test durchführen und Ergebnisse für
   Datenbank, Frontend-Build und konfigurierte Provider kontrollieren.
4. Den WordPress-Loader gemäß [Betriebsanleitung](./operations.md#wordpress-einbettung)
   in einer nichtöffentlichen WordPress-Testseite einbinden. CORS, CSP,
   Formularübermittlung und vollständigen Upload separat testen.
5. Test-Mail nur an einen freigegebenen Testempfänger senden und Antwort,
   Fehlerfälle, Anhänge sowie Hostinger-Mail-API im realen Tarif verifizieren.
   Maintenance-Smoke-Test allein sendet keine Mail und beweist keine Zustellung.

## 8. Hostinger-Cron für Archiv-Purges und Mail-Retries einrichten

Im hPanel einen Cron-Job anlegen, sofern der Tarif Node-CLI-Cron-Ausführung
unterstützt:

- **Arbeitsverzeichnis:** Repository-Root des Deployments;
- **Befehl:** `node scripts/cron.js` (einziger Vega-Cron-Einstieg; nicht zusätzlich
  einzelne Maintenance-Dateien einplanen);
- **Zeitplan:** mindestens täglich; für häufigere Retries z. B. stündlich;
- **Umgebung:** dieselben serverseitigen Runtime-Werte wie für die App,
  insbesondere `DATABASE_URL`, `NODE_ENV`, `APP_BASE_URL`,
  `BETTER_AUTH_SECRET`, `BETTER_AUTH_TRUSTED_ORIGINS`,
  `CORS_ALLOWED_ORIGINS`, `HOSTINGER_MAIL_API_TOKEN` und
  `HOSTINGER_MAILBOX_RESOURCE_ID`.

Cron-Umgebungen erben App-Variablen nicht zwingend. Nutze dafür hPanel-
Runtime-/Cron-Secrets, wenn verfügbar; Secrets nicht in den Cron-Befehl
schreiben. Vor Aktivierung den Befehl einmal manuell im Zielverzeichnis mit
dem tatsächlichen Cron-Umgebungskontext ausführen. Erwartet werden zwei
JSON-Zeilen: `archive-maintenance` mit den Zählern für Orders, Rechnungen,
Gutschriften und Mahnungen sowie `mail-maintenance` mit `sent`, `failed`,
`unknown` und `limit`. Exit-Code 0 bedeutet nur, dass beide Läufe
abgeschlossen wurden. `unknown > 0` erfordert Betreiberprüfung; solche
Einträge werden nicht automatisch erneut versandt.

Dieser Lauf bearbeitet **Mail-Retries und Order-/Finanzbeleg-Purges**. Die
Purges verarbeiten nur archivierte Datensätze, deren gespeichertes `purgeAt`
erreicht ist; Order-Frist 60 Tage, Finanzfrist 30 Tage. Das Laufprotokoll
beweist die Ausführung, aber nicht, dass ein Datensatz tatsächlich fällig war.
Siehe [Cron-Runbook](./hostinger-mail-cron.md).

## 9. Release- und Go-live-Checkliste

- [ ] Node 24, npm 11, Build, `npm start`, Portzuweisung und SSH-Befehle im
      tatsächlichen Hostinger-Tarif nachgewiesen.
- [ ] Datenbankverbindung und -version geprüft; Backup und Restore praktisch
      getestet.
- [ ] `npm ci`, `npm run build` und `npm run db:migrate:deploy` erfolgreich.
- [ ] Produktions-Origins sind HTTPS, exakt und ohne Wildcards; keine Secrets
      in Frontend-Builds.
- [ ] Erster Admin provisioniert, Bootstrap-Variablen entfernt, Passwort
      geändert und TOTP eingerichtet.
- [ ] Hostinger-Mail-API mit Testempfänger, Anhängen, Ablehnungen und unklarem
      Versandausgang geprüft; Absender-/Empfängerwerte in Vega konfiguriert.
- [ ] Google Places/Routes und GCS (falls verwendet) mit produktionsnahen
      Berechtigungen, Quoten, CORS und Lifecycle getestet.
- [ ] WordPress-Loader, CSP/CORS, Formular, Anfrage, Admin-Login und Bild-Upload
      End-to-End getestet.
- [ ] Cron-Verfügbarkeit und Mail-Retry-Lauf nachgewiesen; `UNKNOWN`-Verfahren
      bekannt.
- [ ] `scripts/cron.js` im Hostinger-Tarif ausgeführt und Purges für archivierte Aufträge
      (60 Tage) sowie Finanzbelege (30 Tage) mit fälligen Testdatensätzen verifiziert.
- [ ] Externe gesetzliche Rechnungs-/Gutschriftenaufbewahrung sowie
      Backup-/Restore-Verantwortung mit den zuständigen Betreibern freigegeben.
- [ ] Rollback-Prozess für App-Build und Datenbankmigrationen dokumentiert.

Weiterführend:

- [Betrieb und Konfiguration](./operations.md)
- [Mail-Retry-Cron und `UNKNOWN`-Abgleich](./hostinger-mail-cron.md)
- [GCS-Bucket einrichten](./gcs-bucket-setup.md)
- [Implementierungsstand und offene Arbeit](./implementation-status.md)
- [ADR 0008 – Verwaltete Hostinger Node.js-App](./adr/0008-hostinger-deployment.md)
