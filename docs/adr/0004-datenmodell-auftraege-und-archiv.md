# ADR 0004: Frische relationale Datenbank, unabhängige Orderkopien

- **Status:** Akzeptiert
- **Datum:** 2026-10-05

## Entscheidung

Eine frische MySQL-Datenbank mit Prisma. Es findet keine Migration von Kunden-/Auftrags-/Altdaten statt. Es gibt kein globales Kundenprofil; Kundendaten verbleiben pro Order.

Angebotskopien bleiben eigenständige Orders mit neuer Auftragsnummer und Bezug zum Ursprung. Auftragsnummern beginnen bei 1000. Kopien können unabhängig bearbeitet, archiviert und wiederhergestellt werden.

`edited` ist ein Bearbeitungsflag, keine Lesebestätigung: Eingang false, Kopie true, tatsächliche Änderung/erfolgreiche In-App-Mail true; Lesen allein ändert es nicht. Aktion, Benutzername und Zeitstempel werden protokolliert, aber keine Feld-Diffs. Events werden mit dem Order entfernt.

Archivieren erfolgt explizit. Restore stoppt die 60-Tage-Frist; erneutes Archivieren startet sie neu. Täglicher Hostinger-Cron entfernt nur den jeweiligen abgelaufenen Datensatz.

## Folgen

- Keine automatischen Kaskaden zwischen Geschwisterkopien.
- Rechnungen dürfen nicht per FK-Cascade mit Orders gelöscht werden.
- Startkatalog/Preise werden nach Setup manuell durch Admins angelegt.
- Das Frontend erhält keinen Zugriff auf beliebige Order-IDs/öffentliche Order-Reads.
- Auftrags-PUTs vergleichen `revision` atomar vor Relationsänderungen;
  ein veralteter Stand liefert `409`. Archiv/Restore erhöhen die Revision,
  behalten aber `updatedAt` bei. Kopien sperren ihre aktive Quelle während
  der Transaktion.
- Historische Katalog-Snapshots bleiben auch nach Kataloglöschung oder
  Ausblenden bearbeitbar; Mengenänderungen aktualisieren keine alten
  Namen/Volumina. Neue bzw. geänderte Referenzen benötigen einen gültigen
  aktuellen Katalogeintrag. Normalisierte Daten werden vor Persistenz
  nochmals vollständig validiert.

## Umsetzungsstand (2026-10-09)

- Öffentlicher Order-POST, Staff-Bearbeitung, Angebotskopien,
  Archivieren/Wiederherstellen und minimaler Aktionsjournal-Read sind umgesetzt.
- Das Journal hält Anlage, Anpassung, Kopie, Archivierung, Wiederherstellung und
  Rechnungs-PDF-Export fest. Öffentliche Anfragen verwenden als Akteur `-`;
  Feld-Diffs werden nicht gespeichert.
- Der tägliche 60-Tage-Purge läuft über den zentralen Root-Einstieg `cron.js`;
  die tatsächliche Ausführung im Hostinger-Tarif bleibt ein Release-Proof.
- Adress- und Positionskerne liegen in `OrderAddress`/`OrderPosition`;
  Anlage, Änderung, Kopie und Read verwenden diese Beziehungen transaktional.
  Bestehende Vega-Snapshots werden additiv übernommen; keine Legacy-Daten.
- Datenbanktests prüfen die Unabhängigkeit der Kopien und erhaltene Rechnungen.
  Auftragseigene Mail-Outbox-Inhalte und Mailereignisse werden ebenso wie das
  Aktionsjournal mit dem Auftrag gelöscht, nicht als personenbezogene Waisen
  weiter aufbewahrt.

## Preisstand und serverseitige Kalkulation (2026-10-16)

- Die automatische Preisvorschau ist eine ausdrückliche Staff-Aktion. Sie
  ersetzt vorhandene Auftragspositionen nur nach Bestätigung; direkte
  individuelle Positionsänderungen bleiben möglich. Das bestehende JSON-Feld
  heißt intern weiterhin `details.conditions`.
- Gespeicherte Angebotsbeträge ändern sich nicht bei Katalogänderung,
  erneutem Speichern, Kopie, Export oder Mailversand. Nur eine bestätigte
  Neukalkulation verwendet aktuelle Katalogwerte.
- Die Berechnungsgrundlage und verwendeten Einzelpreis-/Tarifstände liegen als
  validierter `pricingSnapshot` im bestehenden Order-JSON. Die endgültigen
  Angebotspreise sind die gespeicherten Auftragspositionen, keine zweite
  konkurrierende Preisliste. Kopien erhalten eigenständige Snapshots.
- Orders ohne Snapshot behalten ihre bisherigen Positionen; fehlende
  historische Einzelpreise werden in Preislisten nicht durch aktuelle
  Katalogwerte ersetzt. Es erfolgt keine Migration von Bestandsdaten.
- Serverseitige Dezimalarithmetik rundet fertige Positionen auf Cent und
  summiert diese Bruttobeträge. Rechnungs- und Mahnberechnungen bleiben
  getrennt.

## Auftragspositionen für Zusatzleistungen und Packmaterial (2026-10-17)

- Beim Auswählen eines Katalogeintrags wird dessen Einzelpreis im
  Auftragseditor vorbelegt. Admins und Kundenberater können den Preis pro
  Auftragsposition ändern; Freitextpositionen benötigen für die automatische
  Kalkulation einen explizit eingegebenen Einzelpreis.
- Der optionale Einzelpreis gehört zum jeweiligen Auftrags-JSON, nicht zum
  globalen Katalog. Die serverseitige Staff-Validierung begrenzt den Wert;
  öffentliche Anfragen dürfen keine Einzelpreise setzen. Die ausdrückliche
  Positionskalkulation verwendet den eingegebenen Einzelpreis, andernfalls
  den aktuellen Katalogpreis.
- Der Preis-Override ist Teil der Preisgrundlage im `pricingSnapshot`. Eine
  spätere Katalogänderung überschreibt gespeicherte Auftrags-Einzelpreise
  nicht; erst eine ausdrückliche Änderung oder Neukalkulation kann sie ändern.

## Informative Netto-/MwSt.-Anzeige der Positionssumme (2026-10-17)

- Die gespeicherte Positionssumme bleibt ein Bruttobetrag und wird nicht
  verändert. Die Admin-Positionskarte zeigt zusätzlich eine informative
  Aufteilung mit fest 19 %: Netto = Brutto / 1,19, MwSt. = Brutto − Netto;
  Rundung erfolgt auf Cent und die MwSt. wird als Differenz berechnet.
- Diese Anzeige ist keine Rechnungsberechnung und legt keinen
  Rechnungssteuersatz fest. Rechnungssteuer bleibt unabhängig am jeweiligen
  Rechnungsbeleg.
