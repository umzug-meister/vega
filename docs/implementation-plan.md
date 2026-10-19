# Umzug Ruck Zuck – Umsetzungsplan

**Status:** abgestimmte Zielplanung für die Umsetzung durch Agents  
**Stand:** 2026-10-15

**Wichtig:** Dieser Plan beschreibt Zielverhalten und offene Arbeitspakete.
Lokale Nachweise ersetzen keine externen Freigabe-Gates.

## 1. Ziel

Die heutigen zusammengehörenden Funktionen werden in **einer verwalteten Node.js-App bei Hostinger** zusammengeführt. WordPress bleibt die öffentliche Website und Einbettungsfläche des Kundenformulars. Das bisherige WordPress-Plugin, die bisherigen Daten und die alten Deployments sind keine Ziel-Backends und werden nicht migriert.

Die neue App startet mit einer **frischen Hostinger-MySQL-Datenbank**. Stammdaten wie Möbel, Kategorien, Services und Standardpreise werden vom Betreiber nach dem Start manuell angelegt.

## 2. Festgelegter Umfang

### Enthalten

- Ein öffentliches, deutschsprachiges, umfangreiches Umzugsformular auf der WordPress-Hauptseite.
- Das bestehende Script-Einbettungsmodell bleibt; WordPress ruft einen kleinen Loader auf der Vega-Subdomain auf. Der Loader stellt absolute Asset-/API-Pfade bereit.
- Das Berater-/Admin-Frontend auf der Vega-Subdomain.
- Auftragsbearbeitung, Angebotskopien, Preis-/Service-/Möbel-/Kategorieverwaltung, Buchhaltung, Rechnungen, Gutschriften, Mahnungen und E-Mail-Abläufe.
- Serverseitige Validierung, Geschäftsregeln, Preisberechnung, Berechtigungen, PDFs und E-Mail-Versand.
- Kundenbilder: lokale Vorschau und Browser-Komprimierung, danach Upload in einen privaten Google-Cloud-Storage-Bucket in einer EU-Region.

### Ausgeschlossen

- Eigenständiges Expressformular.
- Eigenständige Möbellisten-Seite.
- Eigenständiger Möbel-/Volumenrechner. Der im langen Formular eingebettete
  Rechner gehört seit der ausdrücklichen Freigabe vom 2026-10-09 zum Umfang.
- Kundenkonten oder ein globales Kundenprofil.
- Übernahme alter Aufträge, Kunden, Bilder, Rechnungen oder sonstiger Altdaten.
- Betrieb mehrerer separater Node-/Mail-Services.

## 3. Technologievorgaben

- Hostinger verwaltete Node.js-Web-App, Node.js **24 LTS**.
- Express **5** als HTTP-Server/API.
- TypeScript **7** für Server und Frontends.
- Vite, React **19**, aktuelle Material-UI-Version zum Umsetzungszeitpunkt.
- Better Auth für Mitarbeiter-Authentifizierung.
- Prisma mit versionierten Migrationen gegen Hostinger MySQL.
- Hostinger Mail API, direkt und ausschließlich serverseitig.
- Google Cloud Storage für neue Bilder.
- Google Places für Adresssuche mit bisheriger Länderbeschränkung Deutschland/Österreich.

Exakte Versionen sind in `package.json`/`package-lock.json` gepinnt; offen ist nur der Nachweis im echten CI-/Hostinger-Lauf (A1).

## 4. Zielverhalten

### 4.1 Kundenformular und öffentliche API

- Kunden benötigen keinen Login.
- Öffentliche API: nur POST zum Einreichen einer Anfrage sowie GET für ausdrücklich kundenrelevante Katalog-/Angebotsdaten.
- Enge Google-Ausnahme (ADR 0003): nur
  `POST /api/customer-form/places/autocomplete` und `POST /api/customer-form/places/address`
  als minimale öffentliche Service-API (DE/AT-Vorschläge, Session-Token, danach nur
  `street`/`postalCode`/`city`; rate-limitiert, `Cache-Control: no-store`, manueller
  Fallback bei `503`/`502`). Kein generischer Google-Proxy, kein Place-/Auftragsspeicher,
  kein öffentlicher Order-Read.
- Öffentliche Datenantworten enthalten ausschließlich freigegebene Felder, beispielsweise Name, Beschreibung, Auswahloption und Kundenpreis. Es gibt keine öffentlichen Auftrags-/Kundenlese-Endpunkte und keine generischen Optionsendpunkte.
- Der Formular-POST wird serverseitig validiert und vor Mailversand dauerhaft gespeichert.
- CORS wird auf die konfigurierte WordPress-Origin begrenzt. CORS ist kein Authentifizierungs- oder Zugriffsschutz.
- Öffentliche Requests erhalten Rate-Limits. Es gibt zunächst weder CAPTCHA noch Honeypot.
- Serverseitige Feld-/Schema- und Größenprüfung ist obligatorisch. Client-Validierung bleibt nur UX-Hilfe.

### 4.2 Authentifizierung und Rechte

- Rollen: `Admin` und `Kundenberater`.
- Anmeldung mit E-Mail/Passwort; neu gesetzte Passwörter müssen mindestens 8 Zeichen einschließlich Großbuchstabe, Kleinbuchstabe und Zahl enthalten. Passwort-Reset über Hostinger-Mail; TOTP-Zwei-Faktor-Authentifizierung verpflichtend für Admins, optional für Kundenberater (selbst ein-/ausschaltbar mit Passwortbestätigung). Mitarbeiter-E-Mail-Adressen müssen nicht verifiziert werden.
- Keine öffentliche Registrierung. Admins können Mitarbeiterkonten anlegen/sperren und auch die Rolle `Admin` vergeben; für ein Konto können sie eine Passwort-Reset-Mail auslösen.
- Erneute Anmeldung ist spätestens alle 30 Tage erforderlich (absolute Session-Höchstdauer; Aktivität verlängert die Session nicht).
- Erster Admin: einmaliger, serverseitiger Bootstrap, danach deaktiviert. Kein öffentliches Setup.
- Erstadmin wird über einen einmaligen Prisma-Seed als `root_user` angelegt. `INITIAL_ADMIN_EMAIL` und `INITIAL_ADMIN_PASSWORD` sind serverseitige Runtime-Variablen und nach dem Seed zu entfernen. Beim ersten Login ist Passwortwechsel plus erfolgreiches TOTP-Enrollment erforderlich, bevor geschützte Admin-Funktionen zugänglich sind.
- Wiederherstellungscodes bei 2FA-Einrichtung; Admin-Reset für andere Accounts; dokumentierter serverseitiger Recovery-Pfad für den einzigen Admin. Anlage, Sperrung/Entsperrung, Rollenwechsel, Passwort-Reset-Mail und 2FA-Reset verlangen jeweils das aktuelle Admin-Passwort (Fachentscheidung 2026-10-09, ADR 0002).
- Admin darf alle Bereiche bedienen, darunter Mitarbeiterkonten, globale Preise, Kataloge und Buchhaltung.
- Kundenberater dürfen Anfragen/Aufträge bearbeiten, Einzelangebote erstellen/kopieren/anpassen/archivieren, individuelle Einzelangebotspreise ändern, E-Mails mit PDF versenden und Aufträge archivieren/wiederherstellen.
- Kundenberater ändern keine globalen Preisvorgaben, Möbel-/Service-/Kategorie-Stammdaten oder Benutzer und bearbeiten keine Rechnungen/Buchhaltung.
- Autorisierung wird in jedem Server-Use-Case/API-Endpunkt geprüft; UI-Ausblendung allein ist kein Schutz.

### 4.3 Aufträge, Angebotskopien und „edited“

- Eine Angebotsvariante bleibt wie bisher ein **eigener Auftragsdatensatz** mit eigener fortlaufender Auftragsnummer. Eine neue Kundenanfrage und jede Kopie erhalten eine neue Nummer; Startwert des Auftragskreises: `1000`.
- Angebotskopien werden unabhängig bearbeitet und archiviert. Änderungen/Löschen an einer Kopie kaskadieren nicht auf Ursprung oder Geschwisterkopien. Beim Erzeugen mehrerer Angebote werden mehrere PDF-Dokumente mit jeweils eigener Auftragsnummer versendet.
- Ursprungsbeziehung bleibt erhalten, solange der Ursprungsdatensatz existiert. Datenbankbeziehungen dürfen beim Löschen keine Geschwisterdatensätze löschen.
- Es gibt keinen allgemeinen Statusautomaten. Das bestehende Bearbeitungskennzeichen wird als Boolean `edited` umgesetzt:
  - Neue Kundenanfrage: `false`.
  - Angebotskopie: bei Erstellung `true`.
  - Tatsächliche Bearbeitung oder erfolgreicher In-App-Mailversand: aktueller Datensatz wird `true`.
  - Öffnen/Ansehen allein ändert das Feld nicht.
  - Änderungen an Kopien setzen weder Ursprung noch Geschwisterkopien auf `true`.
  - Extern versandte E-Mails können nicht als tatsächlicher Versand erkannt werden.
- Audit-/Aktionsprotokoll: Aktion, Zeitstempel, Benutzername und Auftrags-/Angebotsbezug. Keine Feld-Diffs oder Vorher-/Nachher-Werte. E-Mail-Versand wird nur bei Erfolg als versendet markiert. Audit-Einträge werden mit dem Auftrag gelöscht.

#### Serverautoritative Angebotskalkulation

- Nur Admins und Kundenberater können auf ausdrücklichen Klick über
  `POST /api/admin/orders/pricing-preview` einen Staff-Entwurf kalkulieren.
  Der Browser ist weder Katalog- noch Berechnungsquelle. Speichern, Kopieren,
  PDF-Export und Mailversand kalkulieren nicht automatisch neu.
- `CatalogOffer.sum` ist der gepflegte Basispreis; `hourPrice` beschreibt
  weitere Stunden, aber erzeugt keine zusätzliche Arbeitsstunde im Angebot.
  Ein Rabatt wird ausschließlich auf den Basispreis gerechnet.
- Anfahrtskosten werden zentral nach LKW-Anzahl gepflegt, unabhängig von der
  Trägerzahl (`ridingCostsTruck1` bis `ridingCostsTruck4`). In München gilt
  dieser LKW-Tarif; andernorts gilt das Maximum aus diesem Tarif und
  `distanceKm * kmPrice * trucks`. Der Kilometerbetrag wird auf das nächste
  Vielfache von 5 EUR gerundet. Lokale Adressen werden
  anhand ihres Ortsfelds erkannt; aktive Haupt- und aktivierte Nebenadressen
  werden berücksichtigt.
- Halteverbotszonen verwenden die Summe der aktivierten Adressen mal
  `hvzPrice`. Alle ausgewählten Katalog-Services und Packungen werden anhand
  der aktuellen Mengen und serverseitigen Einzelpreise einbezogen. Der
  Katalogpreis wird bei Auswahl als Einzelpreis vorbelegt und kann im Auftrag
  von Admins und Kundenberatern je Position angepasst werden; auch
  Freitextpositionen können einen Einzelpreis erhalten. Diese Mitarbeiterpreise
  werden serverseitig validiert, im Auftrags-JSON gespeichert und von der
  ausdrücklichen Positionskalkulation verwendet. Freitextpositionen ohne
  Einzelpreis blockieren die automatische Kalkulation, nicht das manuelle
  Angebot. Packungen behalten den Hinweis „wird nach Verbrauch berechnet“.
- Jede fertige Auftragsposition wird auf Cent gerundet; erst danach wird die
  Bruttosumme exakt gebildet. Order-Bruttobeträge werden nicht mit der
  Netto-/Umsatzsteuerarithmetik von Rechnungen vermischt. Die Positionskarte
  zeigt zusätzlich eine rein informative Netto-/MwSt.-Aufteilung der
  Bruttosumme mit fest 19 % (`Netto = Brutto / 1,19`, MwSt. = Brutto − Netto);
  sie ändert weder gespeicherte Positionen noch den Steuersatz einer Rechnung.
- Berechnete Positionen können direkt angepasst werden. Eine neue Kalkulation
  ersetzt bestehende Positionen erst nach Bestätigung. Gespeicherte
  Positionen sind die verbindlichen Beträge; Katalogänderungen werden nur
  durch eine neue, ausdrücklich bestätigte Kalkulation übernommen.
- Ein serverseitiger `pricingSnapshot` im bestehenden Order-JSON hält die
  verwendeten Preisstände für Services, Packungen und AGB sowie die
  Preisgrundlage. PDF-Tabellen und Angebotsmails verwenden gespeicherte
  Positionen; Order-PDF-Preislisten verwenden denselben Snapshot und zeigen
  bei alten Orders ohne Snapshot keine erfundenen historischen Einzelpreise.
  Kopien übernehmen den Snapshot unverändert. Keine öffentliche Preisvorschau
  und keine anonymen Preis-/Snapshot-Overrides.

### 4.4 Archivierung und Aufbewahrung

- Aufträge werden nur durch ausdrückliche Benutzeraktion archiviert. Eine separate Archivansicht erlaubt Wiederherstellung.
- Kundenberater und Admins dürfen Aufträge archivieren/wiederherstellen.
- Wiederherstellen stoppt die 60-Tage-Frist; erneutes Archivieren startet sie neu.
- Ein täglicher Hostinger-Cronjob entfernt Datensätze, die seit mindestens 60 Tagen archiviert sind. Er löscht nur den ausgewählten Auftrag/die Kopie und zugehörige Aktionsprotokolle, nicht Geschwister.
- GCS-Bilder werden bei Auftragslöschung nicht aktiv gelöscht.
- Admins archivieren Rechnungen und Gutschriften; Mahnungen werden mit ihrer Rechnung archiviert; alle sind bis zur endgültigen Löschung wiederherstellbar. Ein täglicher, idempotenter Purge entfernt jeden dieser Finanzdatensätze 30 Tage nach seiner Archivierung; erneutes Archivieren startet die Frist neu.
- Die externe gesetzliche Aufbewahrung ausgestellter Rechnungen/Gutschriften liegt außerhalb der App und in der Verantwortung des Betreibers. Vor Änderungen, Archivierung oder Purge muss der externe Archivprozess durch Buchhaltung/Steuerberatung bestätigt sein; ein Confirmation-Dialog beweist keine externe Sicherung.

### 4.5 Datenmodell

- Keine zentrale Kundenkartei. Kundendaten bleiben beim jeweiligen Auftrag/Angebotsdatensatz.
- Prisma/MySQL-Modell mit relationalen, durch Migrationen versionierten Tabellen. Suchbare/identitätskritische Felder werden nicht ausschließlich als unvalidierter Blob gespeichert.
- Mindestbereiche: Auth/Benutzer/Rollen, Aufträge, Auftragsadressen/-positionen, Möbel/Kategorien/Services/Preisvorgaben, GCS-Referenzen, Aktionsprotokolle, E-Mail-Outbox/-Ereignisse, Rechnungen, Gutschriften und Mahnungsereignisse.
- Auftrags-/Rechnungsnummern sind von internen DB-IDs getrennt. Nummern werden serverseitig transaktional vergeben und eindeutig validiert.
- Rechnungen liegen in einer eigenen Tabelle, genau eine Rechnung pro Angebot/Auftragskopie. Die Rechnung ist nach Rechnungsnummer, Auftragsnummer und Kundenname suchbar.
- Rechnung verweist auf das Angebot, aber das Löschen des Auftrags löscht die Rechnung nicht. Auftragsnummer und Kundenname werden als Such-Snapshot in der Rechnung gespeichert; eine FK-Beziehung darf nur gelöst werden, nicht kaskadierend löschen.
- Rechnungsnummernkreis ist getrennt, fortlaufend, über die Admin-Oberfläche initialisier- und später editierbar. Die gedruckte Rechnungsnummer ist nicht die DB-ID.
- Bei Rechnungsanlage setzt eine manuelle positive ganzzahlige `R-<Nummer>`
  den nächsten automatischen Wert nur aufwärts auf `Nummer + 1`; führende
  Nullen bleiben in der Rechnungsnummer erhalten. Andere manuelle Formate
  verändern und verbrauchen den Nummernkreis nicht. Ohne manuelle Nummer gilt
  die transaktionale automatische Vergabe. Änderungen bestehender Rechnungen
  beeinflussen den Nummernkreis weiterhin nicht (ADR 0005).
- Rechnungen sind einfache CRUD-Datensätze ohne Versionshistorie. Änderungen überschreiben den aktuellen DB-Stand.
- Auftrags- und Rechnungsänderungen verlangen die geladene `revision`.
  Der Server erhöht sie atomar; ein überholter Stand liefert `409`, ohne
  den gespeicherten Beleg oder den lokalen Entwurf zu überschreiben.
  Archivieren und Restore erhöhen die Revision ebenfalls. Das ist
  Konfliktschutz, keine Versionshistorie.
- PDFs werden im Backend bei Bedarf erzeugt und heruntergeladen bzw. als Mailanhang erzeugt; es gibt keine dauerhaft gespeicherten PDF-Dateien. Admins sichern benötigte externe PDF-Stände selbst.
- Gutschriften bleiben optional, eine pro Rechnung, in eigener Tabelle und mit Nummerierungsverhalten wie bisher. Mahnungen werden als Ereignisse an Rechnungen gespeichert. Rechnungen, Gutschriften und Mahnungsereignisse erhalten eigene Archiv-/Purge-Felder; Admins archivieren sie einheitlich und der App-Purge erfolgt jeweils 30 Tage danach.

### 4.6 E-Mail und PDF

- Alle bisherigen E-Mail-Flows laufen über die Hostinger Mail API: Anfragebestätigung an Firma und Kunde, Angebote, Absagen, Rechnungen und Mahnungen.
- E-Mail-Vorlagen bleiben codebasiert wie bisher. Kundenberater dürfen den konkreten Text/Betreff vor jedem Versand bearbeiten.
- Firmenempfänger, Absendername und Absenderadresse sind nicht geheime Admin-Einstellungen. Hostinger API-Token und Mailbox-ID sind ausschließlich serverseitige Umgebungsvariablen.
- Requests werden zuerst gespeichert. Mailfehler verlieren keine Anfrage; Fehler werden angezeigt/protokolliert und können erneut versucht werden.
- Automatische Wiederholung gilt nur bei sicher nicht erfolgtem Versand.
  Unklare Ergebnisse nach dem Send-POST oder verwaiste `SENDING`-Claims
  werden `UNKNOWN` und benötigen einen belegten Providerabgleich; kein
  Blind-Retry. Die Bedienung und Recovery stehen in `hostinger-mail-cron.md`.
- In-App-Mailaktionen protokollieren Actor/Aktion/Zeit. Versand gilt nur bei erfolgreicher Hostinger-API-Antwort als gesendet.
- Bestehende Angebots-/Rechnungs-PDF-Layouts bleiben zunächst erhalten; PDF-Erzeugung wandert vom Browser ins Backend.
- Lange Rechnungen, Gutschriften und Mahnungen erhalten explizite
  Seitenumbrüche und wiederholte Tabellenköpfe; Positionen, Summen und
  Schlussangaben dürfen nicht außerhalb der Seite verschwinden.

### 4.7 Bilder

- Browser komprimiert vor Upload auf JPEG, längste Kante höchstens 2000 px, Qualität ca. 80 %, höchstens 10 MB je Bild.
- **Keine Begrenzung der Bildanzahl pro Auftrag.** Nur Bilddateien; keine Word-, PDF- oder sonstigen Dokumentdateien.
- Private GCS-Bucket in EU-Region. Browser erhält nur kurzlebige, eingeschränkte Upload-/Download-Links, keine GCS-Zugangsdaten.
- Backend prüft Uploadanfrage, Dateimetadaten/-typ/-größe und die Zuordnung zum Auftrag. Clientfilter allein ist keine Sicherheitskontrolle.
- GCS-Lifecycle löscht Objekte 180 Tage nach Upload, unabhängig davon, ob der Auftrag archiviert/gelöscht wurde. Bildlinks im Datensatz dürfen danach ungültig sein.

## 5. Anwendungsschnittstellen (Planvertrag)

Geteilte DTOs liegen in `packages/domain`. Trennung:

- `GET /api/catalog/...`: kundensichere Listen/Preise für die tatsächlich aktiven Schritte des langen Formulars.
- `POST /api/public/orders`: Validierung, Preis-/Domänenprüfung soweit relevant, persistente Anfrageanlage und anschließende E-Mail-Outbox.
- `POST /api/public/uploads/...`: Upload-Sitzung/kurzlebige GCS-Berechtigungen; Uploadobjekte müssen dem finalen Auftrag zuordenbar sein.
- `POST /api/customer-form/places/...`: einzige öffentliche Google-Ausnahme (Autocomplete + Adressdetails, siehe § 4.1); keine weiteren Proxy-Routen.
- `/api/auth/*`: Better Auth.
- `/api/admin/orders`, `/api/admin/catalog`, `/api/admin/invoices`, `/api/admin/settings`, `/api/admin/staff`, `/api/admin/profile`, `/api/admin/credits`, `/api/admin/reminders`: ausschließlich autorisierte Bereiche.
- `/api/admin/routes` (Streckenberechnung Depot → Umzugsadressen → Depot): authentifizierte Admin-API für Admin/Kundenberater; automatische Erstberechnung und Neuberechnung nach geänderter, vollständiger Adresse, Button als manueller Retry.
- Keine Alt-WordPress-REST-Route als Zielvertrag übernehmen.

## 6. Code-/Deployment-Struktur

Ein Root-Repository mit npm Workspaces, ein Build-/Releaseprozess und ein Hostinger-Prozess:

```text
apps/
  server/          Express 5, Better Auth, API, Prisma, Mail, PDF, GCS
  admin/           React 19 / Vite / MUI – Berater/Admin-SPA
  customer-form/   React 19 / Vite – nur langes Formular
packages/
  domain/          geteilte DTOs, Validierung und fachliche Typen
prisma/            schema.prisma und versionierte Migrationen
docs/              Architektur, ADRs, Glossar, Betriebsanweisungen
```

Express liefert Admin-SPA, öffentlichen Formular-Loader/-Bundles und APIs aus. WordPress enthält nur den Embed-Aufruf/Loader-Kontext und bleibt Content-CMS. Domains, Auth-Basis-URL, CORS-Origins und Geheimnisse kommen aus Hostinger-Runtime-Variablen, nicht aus dem Vite-Build.

## 7. Arbeitspakete

Umgesetzte Details stehen im Code, in den Tests und in den ADRs; den aktuellen
Stand führt `docs/implementation-status.md`. Hier bleiben nur offene Arbeit und
Abnahmekriterien.

| Paket                   | Offen                                                                                                                                                                 | Abnahme                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A0 Proof                | Hostinger Node 24/Build/Start/Cron, Mail-API-Anhänge, GCS, WordPress-Loader/CORS in nichtproduktiver Umgebung (lokaler Teil: `proof-01-integration-compatibility.md`) | End-to-End-Proof in Zielumgebung; Tarifgrenzen notiert                               |
| A1 Build                | Tatsächlicher GitHub-CI-Lauf und Hostinger-Deployment                                                                                                                 | Sauberer CI-Build; Deployment liefert API und beide Frontends                        |
| A2 Datenmodell          | – (lokal vollständig)                                                                                                                                                 | Leere DB per Migration; keine Kaskaden auf Geschwister/Rechnungen                    |
| A3 Auth                 | Reset-Mail-Proof mit echtem Hostinger-Versand                                                                                                                         | Kein Signup; Rollenmatrix serverseitig; Admin-2FA vor Datenzugriff                   |
| A4 Geschäftslogik       | Hostinger-Ausführung und Purge-Proof mit fälligen Testdatensätzen über den zentralen `scripts/cron.js`-Einstieg                                                       | Kein öffentlicher Order-Read; serverseitige Positionskalkulation statt Browserpreise |
| A5 Kundenformular       | Realer WordPress-/Hostinger-Einbettungsproof                                                                                                                          | Loader lädt in WordPress; Anfrage ohne Login; Consent funktioniert                   |
| A6 Admin-SPA            | – (lokal vollständig)                                                                                                                                                 | Rollenrechte auf API-Ebene                                                           |
| A7 Mail/PDF/Buchhaltung | 30-Tage-Finanz-Purge, Provider-End-to-End-Test                                                                                                                        | Mailfehler verlieren keine Anfrage; Versand protokolliert; PDFs nicht persistiert    |
| A8 GCS-Bilder           | Realer Provider-/CORS-/Lifecycle-Proof                                                                                                                                | Keine Credentials im Browser; Lifecycle nachweisbar                                  |
| A9 Qualität             | E2E-Szenarien und Security Review (IDOR, XSS/Mail-Editor, CORS, Rate-Limits, Uploads)                                                                                 | Keine öffentlichen Datenlesewege; Restore-/Purge-/Mailfehler abgedeckt               |
| A10 Betrieb             | Hostinger-Deployment, Cron, Runbook (Grundlage: `operations.md`, `hostinger-mail-cron.md`, `gcs-bucket-setup.md`)                                                     | Deployment-/Rollback-/Cron-Anleitung vorhanden                                       |

## 8. Konfigurations- und Betriebsgrenzen

### Hostinger Runtime

Mindestens erforderlich (vollständige Liste: `operations.md`):

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `APP_BASE_URL`, `CORS_ALLOWED_ORIGINS` (inkl. WordPress-Origin)
- `HOSTINGER_MAIL_API_TOKEN`, `HOSTINGER_MAILBOX_RESOURCE_ID`
- Google-Maps-Schlüssel ausschließlich serverseitig: ein einziger `GOOGLE_MAPS_API_KEY`
  für Places API (New) (öffentlicher Proxy `/api/customer-form/places/*`) und
  Routes API (Admin-API `/api/admin/routes/*`); auf genau diese zwei APIs beschränkt,
  keine `VITE_*`-Variablen, keine Schlüssel in Builds, Antworten oder Logs.
  IP-Beschränkung nur bei nachgewiesener fester Hostinger-Egress-IP, sonst
  API-Beschränkung plus Quoten-/Kostenmonitoring.
- GCS-Projekt-/Bucket-/Credentials über sichere Serverkonfiguration
- Externe Archiv- und nichtproduktive Providerzugänge ausschließlich als serverseitige Runtime-Umgebungsvariablen; Variablennamen erst mit Auswahl der konkreten Integration festlegen.
- optionaler Secret/Signatur für interne Cron-Aufrufe
- Einmalige Bootstrapwerte nur für ersten Start; nach Anlage entfernen/deaktivieren.

`BETTER_AUTH_SECRET` muss ein eindeutiges, zufälliges Secret mit mindestens 32 Zeichen/hoher Entropie sein. Better Auth erhält ausschließlich die produktive Vega-Origin und explizite lokale/Staging-Origins als Trusted Origins; keine Wildcard und keine Subdomain-Cookies, solange kein Login über mehrere Subdomains erforderlich ist. HTTPS-, `HttpOnly`-, `Secure`- und CSRF-/Origin-Schutz bleiben aktiviert. Auth-Rate-Limits werden persistent konfiguriert und für Login, Passwort-Reset und 2FA separat gesetzt. Proxy-IP-Header werden nur nach Verifikation der Hostinger-Proxykette vertraut.

Nicht geheime Mailwerte (Firmenempfänger, Absendername, Absenderadresse) sind Admin-Einstellungen. Keine API-Tokens oder GCS-Keys dürfen im Admin-/Formularbundle erscheinen.

### Betreiberaufgaben außerhalb der App

- Hostinger-Backup und Restore selbst konfigurieren/testen.
- Startkatalog und Preisvorgaben in der Admin-App manuell einrichten.
- Go-live-Abnahme und finale Umschaltung selbst durchführen.
- Externes Rechnungs-/Gutschriftenarchiv und dessen gesetzliche Aufbewahrung organisieren; benötigte technische Konfiguration/Zugänge bei Integration ausschließlich als serverseitige Runtime-Umgebungsvariablen bereitstellen.
- Erforderliche Google-Maps- und GCS-Projekte/Buckets/Schlüssel freischalten.

## 9. Nicht verhandelbare Risiken / Release-Gates

1. **Rechnungsaufbewahrung:** § 14b UStG verlangt grundsätzlich acht Jahre Aufbewahrung von Rechnungen, Fristbeginn ist grundsätzlich das Ende des Ausstellungsjahres; § 147 AO kann bei steuerlicher Relevanz weitere Aufbewahrung bewirken. Die App löscht archivierte Rechnungen, Gutschriften und Mahnungsdatensätze/-ereignisse nach 30 Tagen und hat weder PDF-Archiv noch Versionierung. Der Betreiber stellt benötigte technische Archivkonfiguration bei Bedarf serverseitig als Runtime-Umgebungsvariablen bereit. Die tatsächliche externe Aufbewahrung muss vor Produktivbetrieb durch Buchhaltung/Steuerberatung bestätigt sein. Ein allgemeiner Confirmation-Dialog oder Runtime-Wert ersetzt keine Aufbewahrung.
2. **Rechnungsänderungen:** Die App überschreibt Rechnungsdaten als einfache CRUD-Operation. Vor Änderung/Archivierung muss der Betreiber benötigte ausgestellte PDF-Stände extern sichern; die App kann frühere PDFs nicht rekonstruieren.
3. **Node-/Paketkompatibilität:** Hostinger unterstützt Node 24.x. Die gepinnten Versionen sind im echten CI- und Hostinger-Lauf nachzuweisen.
4. **Cron:** Die 60-Tage-Order-Bereinigung, 30-Tage-Finanzbeleg-Bereinigung und Mail-Retries benötigen einen verlässlichen Hostinger-Scheduler. A0 muss nachweisen, wie der Managed-Node-Tarif den täglichen Task sicher startet.
5. **WordPress-Loader:** Sicherstellen, dass WordPress nur den Loader enthält und die Formbuild-URLs zur Laufzeit absolut aufgelöst werden; die Domains dürfen nicht in Vite-Builds fest codiert sein.
6. **Better Auth-Konfiguration:** Mitarbeiter-E-Mail-Verifikation ist nicht erforderlich; Admins legen Konten an und können Passwort-Reset-Mails auslösen. Sessions laufen spätestens nach 30 Tagen absolut ab. Adapter-/Plugin-Schema muss zur exakt gepinnten Better-Auth-Version passen. Das aktuelle Admin-Passwort ist bei jeder Anlage, Sperrung/Entsperrung, Rollenänderung, Passwort-Reset-Mail und jedem 2FA-Reset erforderlich (ADR 0002).
7. **Finanzbeleg-Purge:** Die einheitliche 30-Tage-Frist für Rechnungen, Gutschriften und Mahnungen ist entschieden; der Betreiber stellt benötigte technische Archivkonfiguration bei Bedarf als Runtime-Umgebungsvariablen bereit. Die tatsächliche externe Aufbewahrung der gesetzlich erforderlichen Belege muss vor Produktivbetrieb dennoch bestätigt sein.

## 10. Verifikation / Referenzen

- Hostinger unterstützt Node.js 18/20/22/24: https://www.hostinger.com/support/how-to-select-the-node-js-version-for-your-application/
- Node.js-Web-Apps auf Business/Cloud-Hosting: https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/
- Hostinger Cron Jobs: https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/
- Hostinger Mail API/OpenAPI: https://api.mail.hostinger.com/ und Repository-Datei `hostinger-email-api-definition.json`.
- UStG § 14b: https://www.gesetze-im-internet.de/ustg_1980/__14b.html
- AO § 147: https://www.gesetze-im-internet.de/ao_1977/__147.html
- Aktuelle WP-Einbettung: öffentliche Seite referenziert CSS/JS unter `/konfigurator/form/`; das Ziel verwendet stattdessen den abgestimmten Loader auf der Vega-Subdomain.
