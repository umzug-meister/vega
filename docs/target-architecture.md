# Zielarchitektur

## Kontext und Grenzen

```text
Kunde
  └─ umzugruckzuck24.de (WordPress / Content)
       └─ Loader von Vega-Node-App
            ├─ langes Formular (React/Vite-Bundle)
            ├─ öffentliche API: Safe Catalog GET + Order POST plus eng begrenzter Places-Proxy
            └─ kurzlebige GCS Upload-Links

Kundenberater/Admin
  └─ vega.umzugruckzuck24.de
       ├─ React/Vite Admin-SPA am Origin-Root (`/`); Redirect zu `/login` bzw. nach erfolgreicher Passwortprüfung zu `/two-factor`; direkter Aufruf von `/two-factor` ohne laufende Anmelde-Challenge führt zu `/login`, unbekannte Pfade zeigen 404
       ├─ Better Auth + TOTP
       ├─ Express 5 API / Domain Services
       ├─ Prisma → Hostinger MySQL
       ├─ Hostinger Mail API
       └─ Google Cloud Storage (private EU bucket)
```

Die Vega-Admin-Navigation behält die Legacy-Routen für Aufträge, Bearbeitung,
Rechnungserstellung, E-Mail-Text und Einstellungen. Einstellungen sind in
Optionen (`/settings`), Katalogbereiche (`/settings/*`) und
Nutzer (`/settings/users`) gegliedert. Legacy-Content-Pfade bleiben
als weitergeleitete Aliase verfügbar; archivierte Orders/Rechnungen und Profil
haben eigene Routen.

Maintenance (`/maintenance`) ist ein eigenständiger Hauptmenüpunkt auf derselben
Ebene wie Optionen und ausschließlich für Admins sichtbar und zugänglich.
Der bisherige Pfad `/settings/setup` leitet auf `/maintenance` weiter.
Die Seite stellt den serverseitig aus `APP_BASE_URL` erzeugten WordPress-Loadercode
und eine explizit freigegebene Liste von Runtime-Variablennamen mit Setzstatus
bereit, niemals geheime Werte. Ein manuell gestarteter, begrenzter Smoke-Test
prüft Datenbank, Formular-Build und konfigurierte Mail-/Google-/GCS-Zugänge
ohne Fachdatenänderung oder Mailversand; Einzelheiten und Prüfgrenzen stehen
in `operations.md`.

Die Admin-Oberfläche unterstützt unter „Mein Profil“ → „Darstellung“ die Auswahl
„Hell“, „Dunkel“ und „System“, auch auf Mobilgeräten. „System“ ist der Standard
und folgt Änderungen der Betriebssystemeinstellung automatisch. Eine Auswahl
bleibt lokal im Browser gespeichert. Glasflächen in Navigation und Kopfzeile
passen sich dem Modus an, Inhaltsflächen bleiben undurchsichtig.
Die fixierte Reiternavigation im Auftragseditor hat einen undurchsichtigen,
modusabhängigen Hintergrund und schließt beim Scrollen unterhalb der
responsiven Kopfzeile an, damit Formularinhalte nicht durchscheinen.

Nach erfolgreicher Neuanlage öffnet die Admin-App direkt den gespeicherten
Auftrag unter `/edit/<Auftragsnummer>`. Es gibt keine separate Erfolgsansicht.

Auftrags- und Rechnungseditoren zeigen Speichern, PDF, E-Mail und Archivieren
in der Toolbar; Aufträge zusätzlich Kopie und Rechnungserstellung. Neue
Dokumente gelten immer als ungespeichert. Änderungen setzen den Dirty-Indikator
am Speichern-Icon. Solange ein Dokument dirty ist, ist nur Speichern verfügbar;
PDF, Kopie, Archivieren und Rechnungserstellung werden erst nach erfolgreichem
Speichern freigegeben und speichern nicht implizit. Während Lade-/Speichervorgängen
oder bei Ladefehlern sind alle Dokumentaktionen gesperrt. E-Mail folgt
denselben Sperrregeln: Beim Auftrag öffnet ein Menü „Angebot versenden",
„Absage versenden" und – nur bei Angebotskopien – „2 Angebote versenden"; bei
Rechnungen (Admin-only) „Rechnung versenden". Der Versanddialog lädt einen
serverseitigen Entwurf, lässt Empfänger, Betreff und Text bearbeiten und sendet
über die Outbox. Der Auftragseditor zeigt Links zwischen Ursprungsauftrag und
seinen Kopien.

Archivierte Aufträge und Rechnungen sind nicht bearbeitbar. Die Archivlisten
bieten PDF-Download zum Drucken sowie Wiederherstellung; direkte Editoraufrufe
archivierter Dokumente führen zurück ins Archiv. Auftrags-PDFs zeigen das Datum
der letzten Bearbeitung (`updatedAt`); Archivieren und Wiederherstellen verändern
diesen Zeitpunkt nicht. Für zuvor archivierte oder wiederhergestellte Aufträge,
deren `updatedAt` noch durch diese Aktionen verändert wurde, wird das Datum
aus dem letzten `UPDATED`-/`COPIED`-Journalereignis ermittelt. Ohne solche
Bearbeitungsereignisse gilt das Anlagedatum. Rechnungs-PDFs verwenden das im Admin-Formular gesetzte
Rechnungsdatum (`invoiceDate`).

Die Auftragsbearbeitung ordnet passende Cards auf größeren Bildschirmen
nebeneinander an; auf kleinen Bildschirmen stehen sie untereinander.
Der alternative Zeitraum (`dateFrom`, `dateTo`) stammt aus dem Kundenformular
und ist in der Admin-Bearbeitung schreibgeschützt. Die Admin-API weist
Änderungen dieses Zeitraums zurück; Umzugsdatum und Uhrzeit bleiben editierbar.
Erstellen-Aktionen stehen rechts und verwenden „Objekt anlegen“;
Formularpositionen verwenden „Objekt hinzufügen“, ebenfalls rechtsbündig.
Katalogtabellen bündeln Bearbeiten und Löschen in Drei-Punkte-Menüs.

Der Möbelkatalog enthält neben ID und Kategoriezuordnungen nur Name, Volumen,
Schrittgröße in Vielfachen von 0,5 (Minimum 0,5, Standard 1) und Sortierung
(Standard 0). Im Bearbeitungsdialog
folgen unter diesen Feldern die Kategorien als vertikale Checkbox-Liste,
geordnet nach Kategorie-Sortierung und bei Gleichstand nach ID.
Gewicht, Montage-/Aufpreise und die bisherigen Möbel-Flags entfallen aus
DTOs, Eingaben und Datenbank. Die Migration setzt bisher leere Schrittgrößen
auf 1; vorhandene Kategoriezuordnungen bleiben erhalten.

Die Profilseite zeigt Profil, Passwort und OTP-Einstellungen als drei getrennte,
dauerhaft sichtbare Cards im gleichen Layout wie die Auftragsbearbeitung.
Es gibt dort keine Tab-Navigation; die drei Änderungsformulare bleiben getrennt.

Die Nutzerverwaltung zeigt alle Mitarbeiterkonten ohne Suchfeld und ohne
Seitennavigation. Kontoaktionen sind je Zeile in einem Drei-Punkte-Menü gebündelt.
Die Oberfläche lädt bei Bedarf alle Seiten der weiterhin
begrenzten Admin-API automatisch nach.

Die Katalognavigation öffnet standardmäßig Leistungen (`/settings/services`),
und wird ausschließlich über das Seitenmenü bedient; in den Seiten selbst gibt
es keine zweite Tab-Navigation. Alte `/settings/content/*`-URLs leiten per
History-Replacement auf `/settings/*` weiter.
Der Preise-Reiter (`/settings/prices`) enthält die globalen Preisgruppen AGB
und Konfigurator; Leistungen enthält nur den Leistungskatalog.
Optionen enthält keine globalen Preisgruppen.
Die Angebotsverwaltung gruppiert Angebote wie im bisherigen Admin in Karten
nach LKW-Anzahl und Trägern; Änderungen laufen weiterhin über die Vega-
Katalog-API.

WordPress bleibt CMS und Einbettungsfläche. Es ist nicht länger Order-Backend, Auth-System oder Mailer. Alte WordPress-REST-Daten und Altdaten werden nicht migriert. Das Formular-Bundle wird aus derselben Codebasis wie die Node-App gebaut; der kleine Loader auf Vega liefert absolute URLs. Die konkreten Runtime-Pfade kommen aus Konfiguration und werden nicht in Vite-Builds eingebrannt.

## Laufzeitmodule

### Express-Server

- Statische Admin- und Kundenformular-Builds ausliefern.
- Admin-SPA am Origin-Root: Legacy-Pfade `/`, `/edit/:id`, `/blanco`, `/settings/*` und `/email-text/:id`; zusätzlich `/invoices`, `/invoices/archived`, `/orders/archived`, `/profile`. Unbekannte Admin-Pfade zeigen 404.
- Better Auth-Routen und Session-Cookies auf Vega hosten.
- Öffentliche und geschützte API-Router getrennt registrieren.
- Request-ID, strukturierte Logs, Rate-Limits, CSP und Security-Headers zentral konfigurieren.
- Tägliche interne Maintenance-Ausführung über Hostinger Cron; kein ungeschützter öffentlicher Purge-Endpunkt.

### Domain Services

- Order/Copy/Archive Service: implementiert Nummernvergabe, Kopien,
  Bearbeitungsflag, Archivieren/Wiederherstellen und minimales Journal;
  der 60-Tage-Purge bleibt Cron-Arbeit.
- Catalog/Pricing Service: Server ist Preisquelle; Einzelangebotsabweichungen werden im jeweiligen Order-Datensatz gespeichert.
- Invoice/Credit Service: implementiert Admin-only Rechnungs-CRUD mit optionalem
  Auftragsbezug, Such-Snapshots und Rechnungs-PDF-on-demand sowie Gutschriften
  (eine je Rechnung) und Mahnstufen 1–3 mit PDF und Mail; Mahnungen werden mit
  ihrer Rechnung archiviert/wiederhergestellt.
- Mail Service: Hostinger API Adapter, Outbox, Retry/Failure Handling,
  Actor/Event Logs und Versanddialoge für Angebote, Absagen, Rechnungen,
  Gutschriften und Mahnungen.
- Upload Service: GCS URL-Signierung, Upload-Verifikation und Zuordnung von Bildreferenzen.
- Settings Service: versionierter Singleton für die sechs aktiven
  Legacy-Optionen (`boxCbm`, `kleiderboxCbm`, `origin`, `dataPrivacyUrl`,
  `successUrl`, `boxCalculatorUrl`) und freigegebene Mailwerte
  (`companyEmail`, `emailFromName`, `emailFromAddress`). Änderung nur durch
  Admins, Konfliktschutz über Revision; leere Werte bleiben unkonfiguriert.
- PDF Service: Rechnungen werden serverseitig aus aktuellen DB-Daten im
  übernommenen Legacy-Layout erzeugt; Gutschrift- und Mahn-PDFs ebenso.
  Lange Positionen und Texte werden vollständig auf Folgeseiten verteilt,
  Tabellenköpfe wiederholt und Summen zusammengehalten. UI, Validierung und
  PDF verwenden dieselbe Summenberechnung aus `@vega/domain`, ohne
  zusätzliche Zwischenrundung je Position.

## Rollen-/Berechtigungsmatrix

| Bereich/Aktion                                        | Admin | Kundenberater |       Öffentlich |
| ----------------------------------------------------- | ----: | ------------: | ---------------: |
| Eigene Authentifizierung/2FA                          |    ja |            ja |             nein |
| Kundenanfragen lesen/bearbeiten                       |    ja |            ja |             nein |
| Angebotskopie erstellen/kopieren/anpassen/archivieren |    ja |            ja |             nein |
| Preis einer einzelnen Angebotskopie anpassen          |    ja |            ja |             nein |
| Globale Preise, Services, Möbel, Kategorien ändern    |    ja |          nein |             nein |
| Mitarbeiter/Accounts verwalten                        |    ja |          nein |             nein |
| Rechnungen, Gutschriften, Mahnungen                   |    ja |          nein |             nein |
| Öffentliche Katalogprojektion lesen                   |    ja |            ja | ja, nur Safe DTO |
| Neue Anfrage absenden                                 |    ja |            ja | ja, Rate-Limited |
| Aufträge/Kunden öffentlich lesen                      |  nein |          nein |             nein |

Alle Rechte werden im Backend geprüft. `Admin` hat alle Rechte; `Kundenberater` erhält keine versteckten Admin-APIs.

### Better Auth Sicherheitskonfiguration

- Prisma-Adapter mit dem Schema, das für die gepinnte Better-Auth-Version generiert wurde. Bei Änderung von Adapter/Plugins CLI-Schema erneut generieren und Migration prüfen.
- Better-Auth-Konfiguration benennt Prisma-Modelle gemäß ORM-Modellnamen (nicht SQL-Tabellennamen); generiertes Plugin-Schema wird nicht von Hand an der CLI vorbei geändert.
- E-Mail/Passwort aktiv; neu gesetzte Passwörter erfordern mindestens 8 Zeichen sowie Großbuchstabe, Kleinbuchstabe und Zahl. `sendResetPassword` nutzt den serverseitigen Hostinger-Maildienst. Reset-Antworten geben nicht preis, ob ein Account existiert; Reset-Token sind kurzlebig/einmalig und Passwortreset widerruft bestehende Sessions.
- `twoFactor` Server- und Client-Plugin für TOTP. Enrollment benötigt Passwortbestätigung und einen erfolgreichen ersten Code; nur dann gilt 2FA als aktiviert. Einmalige Recovery-Codes verschlüsselt speichern/anzeigen; Pflicht nur für Admins; Kundenberater richten TOTP optional ein und können es mit Passwortbestätigung deaktivieren. 2FA-Reset erzwingt bei Admins erneutes Enrollment.
- Der Initialpasswortwechsel widerruft andere Sitzungen und übernimmt die
  Ersatzcookies der aktuellen Sitzung. TOTP-Start, Enrollment-Abschluss und
  erlaubte Deaktivierung widerrufen ebenfalls andere Sitzungen; eine bereits
  aktive Sitzung darf nicht allein durch die Konto-Freischaltung Zugriff erhalten.
- Serverseitige Middleware blockiert geschützte Kundendatenrouten, bis 2FA aktiviert ist. Kein „trusted device“-Bypass zum Start.
- `BETTER_AUTH_SECRET` ist ein zufälliges, einzigartiges Secret (mindestens 32 Zeichen/hohe Entropie) aus Hostinger Runtime-Variablen.
- Trusted Origins werden exakt aus Runtime-Konfiguration abgeleitet. Der Public-Form-Origin ist CORS-Origin, aber nicht automatisch Auth-Origin. Kein Wildcard-Origin, keine deaktivierte CSRF-/Origin-Prüfung und keine Cross-Subdomain-Cookies, da Login und Admin auf derselben Vega-Origin liegen.
- HTTPS, `Secure`, `HttpOnly` und `SameSite=Lax` Cookies. Proxy-IP-Header nur dann vertrauen, wenn der Hostinger-Reverse-Proxy verifiziert ist.
- Better-Auth-Rate-Limits bleiben aktiviert; Login, Reset und 2FA bekommen strengere endpoint-spezifische Limits mit persistenter Speicherung statt nur In-Memory-Countern. Proxy-IP-Header werden nur nach Verifikation der Hostinger-Proxykette vertraut.
- Mitarbeiter-E-Mail-Adressen müssen nicht verifiziert werden. Admins legen Konten an, können auch die Rolle `Admin` vergeben und Passwort-Reset-Mails auslösen. Sessions haben eine absolute Höchstdauer von 30 Tagen; spätestens dann ist eine erneute Anmeldung erforderlich. Anlage, Sperrung/Entsperrung, Rollenwechsel, Passwort-Reset-Mail und 2FA-Reset erfordern jeweils serverseitig das aktuelle Admin-Passwort (ADR 0002).
- Kontoaktionen laufen ausschließlich über Admin-only Vega-Endpunkte. Sperrung, Rollenwechsel und 2FA-Reset widerrufen Sitzungen/Challenges; Sperrung verhindert neue Sitzungen. Selbst-Lockout und Verlust des letzten aktiven Admins sind geschützt. Der einzige Admin erhält einen ausdrücklich bestätigten serverseitigen TOTP-Recovery-Pfad, keinen erneuten Bootstrap. Identität und Sicherung sind vorher außerhalb der App zu prüfen.
- Der Initial-Admin `root_user` wird einmalig per Prisma-Seed aus `INITIAL_ADMIN_EMAIL`/`INITIAL_ADMIN_PASSWORD` provisioniert; keine Bootstrap-Secrets im Client oder in Logs. Erstzugriff bleibt bis Passwortwechsel und TOTP-Verifizierung gesperrt.

## Datenmodell – fachliche Beziehungen

- `Order` speichert Kunden-/Adressdaten direkt, kein `Customer`-Stamm.
- `Order.orderNumber` ist eindeutige Geschäftsnummer; DB-PK separat.
- `OrderAddress` hält Straße/PLZ/Ort pro eindeutiger Adressrolle relational,
  optionale validierte Adressdetails bleiben JSON. `OrderPosition` hält
  Möbel-, Service- und Verpackungspositionen mit Reihenfolge, Menge und
  Volumensnapshot. Katalog-IDs sind historische Referenzwerte, keine
  Löschkaskaden auf Auftragspositionen. Bei Anlage, Änderung und Kopie werden
  Beziehungen transaktional geschrieben; API-Reads und Rechnungsadressen
  verwenden die relationalen Werte. Der validierte Formularsnapshot bleibt
  für die übrigen Details erhalten.
- Nach der serverseitigen Katalognormalisierung wird der gesamte Auftrag
  erneut validiert, bevor Nummer oder Datensatz geschrieben werden.
  Bereits gespeicherte Katalogpositionen bleiben historische Snapshots,
  auch nach Ausblenden oder Löschen im Katalog; Mengen dürfen angepasst
  werden. Neue Positionen und geänderte Katalogmetadaten müssen dagegen
  anhand des aktuellen Katalogs zulässig sein.
- `Order.revision` und `Invoice.revision` sichern Updates per atomarem
  Vergleich ab. Veraltete PUTs liefern `409`, fehlende Revisionen `400`.
  Beziehungen und Journal werden erst nach erfolgreichem Claim in derselben
  Transaktion geändert. Archivieren und Restore erhöhen den Zähler, ohne
  das fachliche Bearbeitungsdatum zu verändern. Es entsteht keine Historie.
- Der Intake-Endpunkt `POST /api/orders` ist öffentlich und für abgeschlossene
  Staff-Sessions verwendbar. Er speichert validierte Kunden-, Mehrfachadress-,
  Umzugsgut-, Zusatzleistungs-, Termin- und Positionsdaten, vergibt die Nummer
  serverseitig ab 1000 und liefert ausschließlich die neue Auftragsnummer zurück.
  Preisfelder sind bei anonymen Requests verboten; Staff-Preisangaben werden
  serverseitig typ- und wertebereichsgeprüft. Öffentliche Order-Reads bleiben
  verboten; anonyme Requests werden serverseitig limitiert.
- Die serverseitige Angebotskalkulation ist eine ausdrückliche Staff-Aktion
  (`POST /api/admin/orders/pricing-preview`), kein Effekt beim Speichern,
  Kopieren, Exportieren oder Mailversand. Sie verwendet den gepflegten
  `CatalogOffer.sum`, einen Basisrabatt, Fahrtkosten, Halteverbotszonen sowie
  ausgewählte Katalog-Services und Packungen. Der Katalog-Einzelpreis wird bei
  Auswahl vorbelegt; Admins und Kundenberater dürfen ihn pro Auftragsposition
  überschreiben oder für Freitextpositionen eingeben. Die API validiert und
  persistiert diese Staff-Einzelpreise und verwendet sie bei der ausdrücklichen
  Vorschau; Freitextpositionen ohne Einzelpreis sind nicht automatisch
  kalkulierbar. Fahrtkosten außerhalb Münchens
  sind das Maximum aus dem zentralen Anfahrtstarif pro LKW-Anzahl (unabhängig
  von der Trägerzahl) und Kilometerpreis mal Entfernung und LKW-Anzahl; der
  Kilometerbetrag wird auf das nächste Vielfache von 5 EUR gerundet. In München
  gilt der zentrale Anfahrtstarif pro LKW-Anzahl. Der Rabatt gilt nur für den
  Basispreis. Fertige Positionen werden
  auf Cent gerundet und als Bruttobeträge summiert; die Rechnungsarithmetik
  bleibt davon getrennt. Die Positionskarte darf zusätzlich die
  Bruttosumme informativ mit fest 19 % in Netto und MwSt. aufteilen
  (`Netto = Brutto / 1,19`); diese Anzeige ändert weder Orders noch
  Rechnungssteuersätze.
- Berechnete Positionen bleiben im Admin-Editor anpassbar. Erneutes Ersetzen
  vorhandener Positionen verlangt eine Bestätigung. Katalognormaländerungen
  ändern gespeicherte Preise nicht. Der serverseitige `pricingSnapshot` im
  bestehenden Order-JSON hält verwendete Katalog-/Tarifpreise, optionale
  positionsbezogene Staff-Einzelpreise und Berechnungsgrundlagen fest; die finalen Beträge liegen ausschließlich in den
  Auftragspositionen (intern `details.conditions`). Vorschau- und Katalogkonflikte liefern `409`. Orders ohne
  Snapshot bleiben bearbeitbar und werden nicht nachträglich neu bepreist.
- Preisrelevante fehlende Grundlagen, insbesondere eine unbekannte Entfernung
  für Nicht-München, blockieren nur die automatische Kalkulation. Manuelle
  Angebote und unvollständige Entwürfe bleiben möglich. Anonyme Requests
  können weder den Staff-Preisweg noch einen `pricingSnapshot` setzen.
- Öffentliche Katalogprojektionen sind getrennte, rate-limitierte GETs unter
  `/api/catalog/categories`, `/api/catalog/furniture`, `/api/catalog/offers`,
  `/api/catalog/packings`, `/api/catalog/services` und
  `/api/catalog/service-rates`. Packungen und Leistungen werden öffentlich nur
  ausgeliefert, wenn `show=true` ist. Die Admin-CRUD-Routen liegen getrennt unter
  `/api/admin/catalog/*`, verlangen eine abgeschlossene Admin-Session und geben
  nur explizit freigegebene DTO-Felder aus.
- Angebotskopie ist ein neuer Order-Datensatz mit neuer Nummer und nullable Ursprung-Relation. Die Kopie ist eigenständig; FK-Regeln dürfen keine anderen Orders löschen.
- `Order.edited` beschreibt die bestehende Bearbeitungsmarkierung, nicht „gesehen“: Kundeingang false, Kopie true, tatsächliche Änderung/erfolgreiche In-App-Mail true; Öffnen allein unverändert.
- `Order.archivedAt`/`purgeAt` bestimmen 60-Tage-Frist; Restore setzt Archivzustand zurück, Re-Archive startet Frist neu.
- `OrderImage` speichert Objekt-Key/Link-Metadaten. Order-Purge löscht nicht das GCS-Objekt.
- `Invoice` ist eigene Tabelle mit optionaler, für gesetzte Bezüge eindeutiger
  Beziehung zu einem Angebots-Order. Blanco-Rechnungen haben keinen Orderbezug.
  Sie enthält `orderNumberSnapshot`, `customerNameSnapshot`, Rechnungsnummer,
  Rechnungsadresse, Positionen, Fälligkeiten und fachliche Rechnungsfelder.
  Beim Order-Purge gilt `SET NULL` statt Cascade; Snapshots bleiben zum Suchen
  bis Invoice-Purge. Positionspreise sind Brutto inklusive des ausgewählten
  Rechnungssteuersatzes; die Rechnungssumme erhöht sie nicht nochmals um MwSt.
- Rechnungsnummer ist von DB-ID und Auftragsnummer getrennt; einstellbarer Nummernkreis, editierbar, DB-seitig eindeutig.
- `CreditNote` ist separater optionaler Beleg (höchstens einer je Rechnung;
  eindeutige frei gesetzte Geschäftsnummer wie im Bestand, kein erfundener
  initialer Gutschriftennummernwert). `ReminderEvent` hält Mahnungsdaten und
  einen erst bei erfolgreichem Versand zu setzenden `sentAt` fest. Beide
  Tabellen enthalten Rechnungsnummer-/Kunden-/Auftragsnummer-Snapshots;
  Rechnungs-Purge setzt ihre FK-Bezüge auf NULL, ohne sie vor ihrer eigenen
  Aufbewahrungsfrist zu löschen. Use-Cases und UI folgen unter A7.
- `Invoice`, `CreditNote` und `ReminderEvent` haben jeweils eigene Archiv-/Purge-Felder. Admins archivieren die Finanzdatensätze; Purge erfolgt einheitlich nach 30 Tagen, Restore ist bis dahin möglich.
- `OrderActivityEvent` enthält nur Objekt, Aktion, Zeitstempel und Benutzername;
  keine Feld-Diffs. Öffentliche Anfragen verwenden als Akteur `-`. Derzeitige
  Aktionen umfassen Anlage, Bearbeitung, Kopie, Archivierung, Wiederherstellung
  und Rechnungs-PDF-Export. Order-Purge entfernt seine Events.
- `EmailOutbox`/`EmailEvent` hält Retry-Zustand und erfolgreichen Versand inkl. Benutzer/Aktion/Zeitpunkt.
- Nur nachweislich nicht gesendete Mails sind automatisch wiederholbar.
  `UNKNOWN` blockiert Wiederholung; Recovery erfolgt operatorgestützt und
  protokolliert nach Providerabgleich. Statuschecks schicken keine Mailtexte
  und können keinen Versand auslösen. Fehlende Versandkennungen werden
  terminal als `NOT_QUEUED` gesperrt, um verspätete Originalrequests
  abzufangen (siehe `hostinger-mail-cron.md`).
- Auftragseigene Outbox-Inhalte und Mailereignisse werden beim Order-Purge
  ebenfalls gelöscht. Nicht auftragsgebundene Auth-Mails sind davon unabhängig.
- Katalog-/Preisstammdaten werden initial manuell gepflegt.

## API-Sicherheitsgrenze

- `public` Router enthalten ausschließlich Endpunkte, die der Gastflow tatsächlich braucht.
- Der lange Formularflow erhält validierte Katalog-/Serviceprojektionen und kann eine Anfrage erstellen; er erhält niemals Order-Read-Zugriff.
- Einzige öffentliche Google-Ausnahme: `POST /api/customer-form/places/autocomplete` und
  `POST /api/customer-form/places/address` (DE/AT-Filter, Session-Token, Antwortprojektion auf
  `street`/`postalCode`/`city`, Rate-Limit, `Cache-Control: no-store`, manueller Fallback).
  Kein generischer Google-Proxy, kein Place-Speicher, kein öffentlicher Order-Read.
- `admin` Router verlangen gültige Better-Auth-Session plus Rollen-/Capability-Check.
- Die Streckenberechnung unter `/api/admin/routes` (Depot → 2–4 Umzugsadressen → Depot,
  Kilometer gerundet in den ungespeicherten Entwurf; automatische Erst- und
  Adressänderungsberechnung über dieselbe Staff-API, Button als manueller Retry) ist
  ausschließlich authentifizierte Admin-API für Admin/Kundenberater. Direkt
  aufeinanderfolgende identische Adressen erzeugen einen Abschnitt mit 0 km/0 Min.;
  andere Abschnitte bleiben Teil der Google-Routenberechnung.
- Admin-only Finanzrouten liegen unter `/api/admin/invoices`; Kundenberater und
  öffentliche Clients erhalten keinen Finanzbeleg-Zugriff.
- CORS Origins kommen aus Runtime-Umgebung. Origin-Prüfung begrenzt Browserzugriff, ersetzt aber keine Auth.
- Better Auth Trusted Origins sind eine separate, engere Liste als CORS und umfassen nur Vega plus ausdrücklich eingerichtete lokale/Staging-Origin.
- Rate-Limits für öffentliche GET/POST/Upload-Anbahnung; Werte werden anhand Hostinger Proxy/IP-Verhalten im A0-Proof gesetzt.
- Server-Schema validiert jedes Eingabefeld, IDs, Zahlen/Preise, Arrays, Upload-Claims und Payload-Größen.
- Finanzdaten verlangen echte Kalenderdaten, endliche nichtnegative Zahlen
  und Beträge innerhalb der Datenbankgrenzen; auch Zeilen- und Gesamtsummen
  werden geprüft. Fehlerhafte JSON-Bodies liefern `400`, zu große `413`
  und nicht unterstützte Body-Encoding-/Charset-Angaben `415`, keine `500`.
- HTTP-Logs enthalten nur Methoden, bereinigte Pfade, Request-ID und
  Fehlercodes/Status, keine Query-Werte, Reset-Pfadtoken oder
  ungefilterten Error-Payloads.
- Keine Provider-API-Schlüssel, Mail-Tokens, GCS-Credentials oder Preise als allein browserseitige Wahrheit.

## Loader-/WordPress-Integration

- Die WordPress-Seite behält einen Script-Mountpoint/Loader; kein iframe.
- Der Loader auf Vega stellt absolute CSS-/JS-/API-Pfade zur Verfügung.
- Der Formular-Build wird aus `apps/customer-form` erzeugt und vom Node-App-Deployment ausgeliefert.
- Der eingebettete Möbel-/Volumenrechner ist seit der ausdrücklichen Freigabe
  vom 2026-10-09 Teil des langen Formulars, kein eigenständiger neuer Flow.
- Formularoptionen stammen aus einer expliziten Safe-Projektion, nicht aus
  einem generischen öffentlichen Optionsendpunkt. Möbelvolumen wird beim
  Kundeneingang aus Katalog und gespeicherten Kartonvolumina serverseitig
  normalisiert. Fehlende Kartonvolumina werden als unvollständiges Volumen
  gekennzeichnet, nicht als vollständig berechnete Nullwerte dargestellt.
- Loader-Basis und Hostnamen werden zur Laufzeit aufgelöst. Kein Hostname in Vite-Variablen, die in Clientassets gebündelt werden.
- CORS erlaubt nur die konfigurierte produktive WordPress-Origin und explizite nichtproduktive Test-Origin.
- Das WordPress-Plugin soll keine alten öffentlichen Order-/Options-REST-Routen in der neuen Integration weiterverwenden.

## Privacy/Retention und unbeaufsichtigte Tasks

| Objekt                                 | Verhalten                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neue Anfrage                           | `edited=false`; bleibt aktiv, bis explizit archiviert                                                                                                         |
| Angebotskopie                          | eigenständiger Datensatz, eigene Nummer, `edited=true`                                                                                                        |
| Archivierter Auftrag/Kopie             | Restore-fähig; Purge nach 60 Tagen ab aktueller Archivierung                                                                                                  |
| Audit eines Auftrags                   | minimaler Aktionsdatensatz; zusammen mit Order-Purge entfernt                                                                                                 |
| GCS-Objekt                             | keine Order-Purge-Kaskade; Lifecycle nach 180 Tagen ab Upload                                                                                                 |
| Rechnung, Gutschrift, Mahnungsereignis | Admin-Archivierung und Restore; einheitlicher App-Purge 30 Tage nach Archivierung. Externe gesetzliche Archivierung bleibt Betreiberprozess und Go-live-Gate. |
| Invoice PDF                            | bei Bedarf aus aktuellem DB-Stand; nicht persistent in App/GCS                                                                                                |

Der zentrale Einstieg `scripts/cron.js` verarbeitet täglich abgelaufene archivierte
Datensätze und Mail-Retries. Jeder Purge-Delete ist auf `archivedAt` und
`purgeAt <= now` beschränkt und damit idempotent; nach einem Teilfehler kann
derselbe Lauf sicher erneut gestartet werden. Im Hostinger-Tarif ist der Aufruf
von `node scripts/cron.js` vor Go-live nachzuweisen; es gibt keinen öffentlichen
Purge-Endpunkt.
