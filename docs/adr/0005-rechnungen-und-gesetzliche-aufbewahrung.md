# ADR 0005: Rechnungen separat, PDF on-demand, externe Aufbewahrung

- **Status:** App-Verhalten akzeptiert; Compliance-Risiko offen
- **Datum:** 2026-10-06
- **Fachentscheidung:** Auftraggeber, Name nicht angegeben

## Entscheidung

- Rechnung in eigener Tabelle, Admin-only, genau eine pro Angebot/Orderkopie.
- Suchbar über Rechnungsnummer, Auftragsnummer und Kundenname. Beziehung zur Order darf bei Order-Purge nicht kaskadieren; Ordernummer/Kundenname werden als Such-Snapshot behalten.
- Rechnungsnummer separat von DB-ID, eindeutig, im Adminbereich initialisierbar und später bearbeitbar.
- Bei der Anlage übernimmt die Rechnung eine manuell eingegebene Nummer.
  Eine positive ganzzahlige `R-<Nummer>` (auch mit führenden Nullen) setzt den
  nächsten automatischen Wert transaktional auf das Maximum aus bisherigem
  `nextValue` und `Nummer + 1`. Andere manuelle Formate verbrauchen keine
  automatische Nummer und verändern den Nummernkreis nicht. Ohne manuelle
  Eingabe wird die nächste `R-<nextValue>` vergeben und der Wert erhöht.
  Fehlgeschlagene Anlagen rollen auch die Nummernkreisänderung zurück.
  Spätere Änderungen einer Rechnung verändern den Nummernkreis nicht.
- Der neue Rechnungseditor zeigt die verwendete Nummer ohne Helper-Texte
  am Rechnungsnummernfeld; auch die nächste automatische Nummer wird dort
  nicht als Hinweis angezeigt. Der
  Editor trägt die geladene nächste Nummer initial als überschreibbaren
  TextField-Eingabewert ein und sendet diesen Wert beim Speichern mit.
  Der Admin-only
  Vorschau-GET `/api/admin/invoices/next-number` liest nur `nextValue`,
  ohne Reservierung oder Datenänderung (`Cache-Control: no-store`).
  Bei paralleler Anlage kann sich die automatische Vorschau bis zum Speichern
  ändern; verbindlich ist die serverseitige Vergabe beim Speichern.
  Der DB-`Int` begrenzt manuelle sequenzwirksame Nummern bei der Anlage auf
  `R-2147483646`, damit `Nummer + 1` darstellbar bleibt; größere Werte werden
  mit Validierungsfehler abgewiesen. Die bisherige Editierbarkeit bleibt erhalten.
- Rechnung ist einfache CRUD; keine Versionshistorie. Änderungen überschreiben den aktuellen DB-Stand.
- `Invoice.revision` schützt diesen aktuellen Stand vor Lost Updates:
  PUT verlangt die geladene Revision, vergleicht und erhöht sie atomar.
  Ein veralteter Entwurf bleibt lokal erhalten und erhält
  `409 INVOICE_CONFLICT`; Archiv/Restore erhöhen ebenfalls die Revision.
  Der Zähler speichert keine früheren Rechnungsstände.
- Nach erfolgreichem Speichern übernimmt der Editor die bestätigten API-Daten
  in das Formular, bevor der Dirty-State zurückgesetzt wird. Normalisierte
  Werte und die verbindliche Rechnungsnummer bleiben so mit dem PDF konsistent.
- Rechnungsentwürfe und Rechnungsanlagen aus archivierten Aufträgen werden mit
  `409 ORDER_ARCHIVED` abgewiesen. Die Erstellung prüft den Archivstatus unter
  einer Zeilensperre in derselben Transaktion wie Nummernvergabe und Anlage.
  Der Auftrag muss zuerst wiederhergestellt werden; Blanco-Rechnungen bleiben
  unabhängig davon möglich.
- Rechnungen verwenden ausschließlich 19 % oder 0 % Umsatzsteuer; die API
  weist andere Steuersätze zurück. Vorhandene abweichende Werte werden nicht
  automatisch umgerechnet. Der Editor verlangt dafür eine ausdrückliche
  Auswahl eines zulässigen Satzes, bevor erneut gespeichert werden kann.
- Einzelpreise auf Rechnungs- und Gutschriftpositionen sind Bruttopreise und
  beinhalten den ausgewählten Steuersatz. Der Gesamtbetrag ist die Summe der
  Positions-Bruttopreise; die Umsatzsteuer wird daraus centgenau herausgerechnet,
  der Nettobetrag ergibt sich als Differenz. Preise, die aus Auftragspositionen
  übernommen werden, werden daher nicht nochmals um Umsatzsteuer erhöht.
- Kalenderdaten und Zahlen werden auch serverseitig strikt geprüft;
  unmögliche Daten, `Infinity`, negative oder nicht darstellbare Zeilen-/
  Gesamtbeträge werden abgewiesen. UI und PDF verwenden denselben
  Domain-Summenhelper ohne zusätzliche Zwischenrundung je Zeile.
- Hauptrechnung, Gutschrift und Mahnungen behalten getrennte Entwürfe
  über Tabwechsel. Navigation verlangt vor dem Verwerfen eine Bestätigung;
  Speichern eines Unterbelegs verwirft keinen anderen Entwurf. PDF-, Mail-
  und Archivaktionen sind bei ungespeicherten Änderungen gesperrt.
- Fehlgeschlagene Lesezugriffe auf Gutschrift oder Mahnungen beenden den
  Ladezustand und bieten eine gezielte Wiederholung, ohne andere Entwürfe
  zu verwerfen. Fehlende Unterbeleg-Daten gelten nicht als leere Liste;
  sie sperren die Hauptrechnung nach Abschluss der Anfrage nicht dauerhaft.
- Aktive und archivierte Rechnungslisten sind serverseitig paginiert;
  Suchtreffer hinter den ersten 100 Datensätzen bleiben erreichbar.
- Wird eine Rechnung während des Speicherns archiviert, antwortet die API
  mit `409 INVOICE_ARCHIVED`; bei zwischenzeitlicher Löschung mit `404`.
- PDF wird bei Bedarf aus dem aktuellen DB-Stand im Backend erzeugt und vom Admin lokal gespeichert. App speichert keine PDF-Dateien.
- Archivierte Rechnungen sind nicht bearbeitbar; die Archivliste bietet nur
  PDF-Download und Wiederherstellung. Das PDF-Rechnungsdatum ist stets das im
  Admin-Formular gesetzte `invoiceDate`, nicht das Bearbeitungs-, Export- oder
  Archivierungsdatum.
- Admins können Rechnungen und Gutschriften explizit archivieren (Mahnungen folgen ihrer Rechnung) und bis zur endgültigen Löschung wiederherstellen. Für alle drei Finanzdatentypen gilt dieselbe Frist: 30 Tage nach Archivierung werden sie aus der App-Datenbank gelöscht; erneutes Archivieren startet die Frist neu.
- Externe Archivierung ausgestellter Rechnungen/Gutschriften organisiert der Betreiber. Benötigte technische Konfiguration/Zugänge werden bei Bedarf ausschließlich serverseitig als Runtime-Umgebungsvariablen bereitgestellt. Die App zeigt nur eine allgemeine Bestätigung und prüft nicht, ob ein externes Archiv tatsächlich existiert.
- Gutschrift: separat, optional und höchstens eine je Rechnung; Nummerierungsverhalten wie Bestand. Mahnungen als Ereignisse an der Rechnung.

## Kritischer Vorbehalt

§ 14b UStG verlangt grundsätzlich eine achtjährige Aufbewahrung von Rechnungen; § 147 AO kann die Aufbewahrung bei steuerlicher Relevanz beeinflussen. Die App-Regel „30 Tage bis zur Löschung“ erfüllt diese externe Aufbewahrungspflicht nicht. Vor Produktivbetrieb muss ein geeignetes externes Archiv die erforderlichen Belege tatsächlich aufbewahren; die konkrete Ablage/Prozedur muss Steuerberatung bestätigen. Der Confirmation-Dialog allein erfüllt dies nicht.

Ein bearbeiteter DB-Datensatz kann den früher ausgestellten PDF-Stand nicht rekonstruieren. Benötigte Rechnungsstände müssen vor Änderungen/Archivierung extern gesichert werden.

## Umsetzungsstand (2026-10-09)

- Admin-only Rechnungs-CRUD, Blanco-Rechnungen, optionale eindeutige
  Auftragsbezüge, Such-Snapshots, Archivierung/Wiederherstellung und
  serverseitiger PDF-Download sind umgesetzt.
- `CreditNote` und `ReminderEvent` sind als A2-Datenmodell mit eigenen
  Archiv-/Purge-Feldern und Such-Snapshots vorhanden. `SET NULL` beim
  Rechnungs-Purge schützt ihre unabhängige Aufbewahrung. Gutschriftennummern
  sind eindeutig, ohne eine neue Nummerierungsregel oder Dummy-Startwerte
  vorzugeben.
- Gutschriften (Admin-only, eine je Rechnung, Rechnungs-Snapshot) und
  Mahnungen (Stufen 1–3 nur in Reihenfolge) sind mit PDF und Mailversand
  umgesetzt. Mahnungen haben keine eigene Archivaktion: Archivieren bzw.
  Wiederherstellen der Rechnung archiviert bzw. stellt alle ihre Mahnungen
  mit derselben 30-Tage-Frist wieder her.
  `ReminderEvent.sentAt` setzt ausschließlich der erfolgreiche Outbox-Versand.
- Die 30-Tage-Finanzbereinigung und externe Archivintegration bleiben offen. Dieser ADR-Vorbehalt ist daher unverändert
  ein Produktiv-Release-Gate.

## Referenzen

- https://www.gesetze-im-internet.de/ustg_1980/__14b.html
- https://www.gesetze-im-internet.de/ao_1977/__147.html
