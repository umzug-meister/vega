# Hostinger-Cron: Archivbereinigung und Mail-Outbox-Retry

**Stand:** 2026-10-16
**Geltung:** Order-/Finanzarchiv-Purges sowie Retry für alle Mails der Outbox
(Anfrage-Benachrichtigungen und In-App-Versand).
**Prinzip:** Öffentliche Anfragen werden sofort beantwortet (`201 { orderNumber }`);
der Versand läuft zweistufig: Sofortversuch nach dem DB-Commit plus dieser
Cron-Lauf als Retry für sicher wiederholbare Versuche. Derselbe Lauf entfernt
abgelaufene archivierte Orders nach 60 Tagen und Finanzdatensätze nach 30 Tagen.
Es gibt keinen öffentlichen Wartungsendpunkt und keinen zweiten Mail-Service.

## Was der Lauf tut

- Der Einstieg `scripts/cron.js` startet `apps/server/dist/cron.js`; dieser ruft
  `deliverDueOutboxMail()` für `PENDING`/`FAILED` mit
  `nextAttemptAt <= now`, max. `MAIL_MAINTENANCE_LIMIT`, Default 25, Cap 200).
- Derselbe Lauf löscht Orders mit `archivedAt` und fälligem `purgeAt` (60 Tage)
  sowie archivierte Rechnungen, Gutschriften und Mahnungen mit fälligem
  `purgeAt` (je 30 Tage). Wiederhergestellte Datensätze werden nicht gelöscht.
  Abhängige Finanzdatensätze werden vor Rechnungen und Orders bearbeitet;
  Rechnungs-Snapshots bleiben beim Order-Purge erhalten und GCS-Bilder werden
  nicht aktiv gelöscht.
- Erfolg (`204`, ohne Body) → `SENT` + genau ein `EmailEvent`, atomar mit
  ggf. Mahnungs-`sentAt` und Optionsangebots-Journal.
- Sicher nicht gesendet und wiederholbar (z. B. fehlgeschlagener
  Absender-Preflight oder explizite `429`-Ablehnung) → `FAILED` mit
  exponentiellem `nextAttemptAt`. Permanente Ablehnung → `REJECTED`,
  kein automatischer Retry.
- Netzwerkfehler/Timeout nach Beginn des Send-POSTs, `5xx`, unerwartete
  Antwort oder unklarer DB-Abschluss nach Versand → `UNKNOWN`.
  Diese Einträge werden **niemals automatisch erneut gesendet**.
  Auch ein eventuell bereits erfolgreicher, aber nicht bestätigter DB-Commit
  darf keinen zweiten Provideraufruf auslösen.
- Verwaiste `SENDING`-Claims werden nach 90 Sekunden (30 Sekunden
  Provider-Timeout plus 60 Sekunden Reserve) atomar auf `UNKNOWN` gesetzt.
  Der Claim bleibt damit auch nach Prozessabbruch sicher gesperrt.
- Geloggt werden nur Zähler (`sent`, `failed`, `unknown`, `limit`), niemals Empfänger,
  Inhalte, Token oder Providerantworten.
- `failed` zählt fehlgeschlagene Versuche dieses Laufs, einschließlich
  neuer unklarer Ergebnisse. `unknown` zählt alle aktuell ungeklärten
  Einträge. Exit-Code `0` bedeutet nur: Lauf abgeschlossen, **nicht**
  „alle Mails gesendet“. `unknown > 0` verlangt Betreiberprüfung.
  Exit-Code `1` = Crash oder Mailtransport nicht
  konfiguriert.

Der automatische Providerabgleich ist nicht enthalten; für `UNKNOWN` gibt es
die unten beschriebene manuelle Recovery.

## Versanddialog und Statusprüfung

Der Dialog speichert pro Dokument nur Versandkennung und Zustand in
`sessionStorage`, keine Empfänger, Betreffe oder Mailtexte. Nach Antwortverlust,
Dialog-Neuöffnung oder Reload verwendet „Status prüfen“ dieselbe Kennung und
sendet **keinen** neuen Entwurf an den Mailtransport.

`POST …/emails/status` ist autorisiert wie der jeweilige Dokumentbereich.
Eine noch nicht eingereihte Kennung wird atomar auf `NOT_QUEUED`
stillgelegt (`MAIL_CANCELLED`, ohne Mailinhalt). Das verhindert, dass ein
verspäteter Originalrequest nach dem Statuscheck doch noch versendet wird.
Erst nach `NOT_QUEUED`, sicherer Ablehnung oder abgeschlossenem Versand darf
ausdrücklich ein neuer Entwurf mit neuer Kennung gestartet werden.
`SENDING`, `RETRY_SCHEDULED` und `UNKNOWN` erlauben keinen neuen Versand.

## Was auf Hostinger anzulegen ist

1. **Genau ein wiederkehrender Cron-Job**, mindestens täglich (z. B. früh
   morgens Europe/Berlin). Wer schnellere Mail-Retries will, darf häufiger
   laufen lassen (z. B. stündlich); der Claim (`PENDING`/`FAILED` →
   `SENDING`, `attempts+1`) macht parallele Läufe idempotent.
2. **Arbeitsverzeichnis:** Repository-Root des Vega-Deployments (mit
   `package.json`, `scripts/cron.js` und `apps/server/dist/`).
3. **Befehl (nach `npm run build`):** `node scripts/cron.js`.
4. **Umgebung:** exakt dieselben serverseitigen Runtime-Variablen wie für den
   App-Prozess, mindestens:
   `DATABASE_URL`, `BETTER_AUTH_SECRET` (≥ 32 Zeichen), `APP_BASE_URL`,
   `HOSTINGER_MAIL_API_TOKEN`, `HOSTINGER_MAILBOX_RESOURCE_ID`.
   Optional: `MAIL_MAINTENANCE_LIMIT` (1–200, Default 25).
   Keine Secrets in die Cron-Befehlszeile schreiben; keine Ausgaben mit
   Mailinhalten aufbewahren.

## Verifikation (Release-Nachweis)

1. Einmal manuell im Zielverzeichnis starten und beide JSON-Zeilen prüfen:
   `archive-maintenance` mit Purge-Zählern und `mail-maintenance` mit
   `sent`, `failed`, `unknown` und `limit`.
2. In der Datenbank prüfen, dass fällige `EmailOutbox`-Einträge auf `SENT`
   wechseln und genau ein `EmailEvent` je Eintrag entsteht.
3. Cron-Protokoll des Hostings prüfen: regelmäßige `0`-Exits, keine `1`-Exits;
   Exit-Code `1` signalisiert einen Fehler in mindestens einem Teil-Lauf.
4. Sicher wiederholbare Fehler (`FAILED` + `lastErrorCode`) beheben und
   den nächsten Lauf abwarten. `UNKNOWN` ausschließlich wie unten auflösen;
   Status oder Idempotency-Key nicht per SQL zurücksetzen.

## Unklaren Versand manuell abgleichen

Die maßgebliche OpenAPI-Spezifikation
[`hostinger-email-api-definition.json`](../hostinger-email-api-definition.json)
beschreibt für den Send-POST eine Kopie in `INBOX.Sent`, aber keinen
Idempotency-Key und keinen Statusendpunkt für diesen POST. Ein fehlender
Treffer im Gesendet-Ordner ist **kein** Beleg dafür, dass nicht gesendet wurde.

1. Unsichere Einträge ohne Mailinhalte auflisten:
   `node apps/server/dist/mail/mail-reconciliation-cli.js inspect`.
2. Vor Auflösung **App-Prozess und alle Mail-Cron-Läufe stoppen**. Laufende
   Provideranfragen müssen beendet sein; nötigenfalls die 70-Sekunden-Frist
   abwarten. `--workers-stopped` bestätigt diesen Betreiber-Schritt, ersetzt
   ihn aber nicht technisch.
3. Den ursprünglichen Versand anhand Nachricht, Zeitpunkt und Empfänger mit
   `INBOX.Sent` bzw. dem Anbieter abgleichen. Nicht erneut eine Testmail senden.
   Den Nachweis außerhalb der CLI sichern; als `evidenceRef` nur eine
   Referenz ohne Mailinhalte oder Zugangsdaten verwenden.
4. Genau einen belegten Ausgang auflösen:

```sh
# Bestätigter Originalversand: UID aus INBOX.Sent und originaler UTC-Zeitpunkt.
node apps/server/dist/mail/mail-reconciliation-cli.js resolve \
  OUTBOX_ID sent OPERATOR TICKET_REF SENT_UID 2026-10-16T12:00:00Z --workers-stopped

# Nur bei ausdrücklicher Anbieterbestätigung, dass nicht gesendet wurde.
node apps/server/dist/mail/mail-reconciliation-cli.js resolve \
  OUTBOX_ID not-sent OPERATOR TICKET_REF --provider-confirmed-not-sent --workers-stopped
```

`sent` setzt `SENT`, Versandjournal, ggf. Mahnungs-`sentAt` und
Optionsangebots-Aktion atomar. Dies belegt die Providerübergabe, nicht die
Zustellung beim Kunden. `not-sent` setzt `PENDING` für einen späteren sicheren
Retry, ohne ein Versandereignis zu erfinden. Beide Wege erzeugen atomar einen
terminalen Outbox-Nachweis (`MAIL_RECONCILIATION`/`RESOLVED`) mit Operator,
Versuchsnummer und Evidenzreferenz. Eine zweite oder konkurrierende Auflösung
wird abgewiesen. CLI-Fehler liefern Exit-Code `1`, Erfolg `0`.

Danach App/Cron wieder starten, Status und Zähler kontrollieren.
Ohne belastbaren Providerbeleg bleibt `UNKNOWN` stehen; die CLI kann
den tatsächlichen Versand nicht selbst feststellen.

## Offene Gates

- Tatsächliche Cron-Ausführung im gebuchten Tarif ist vor Go-live
  nachzuweisen (CLI-Verfügbarkeit je nach Managed-Node-Tarif prüfen).
- Vollständige Mailkonfiguration (Firmen-/Absenderadresse) bleibt
  Go-live-Voraussetzung: Ohne sie bleiben Firmenmails als sichtbarer
  Konfigurationsfehler stehen.
- Provider-Proof inkl. Send-Erfolg, Ablehnung, unklarem Ausgang und manuellem
  Abgleich bleibt vor dem Produktivbetrieb erforderlich.
