# ADR 0007: Servermail über Hostinger, Backend-PDFs

- **Status:** Akzeptiert
- **Datum:** 2026-10-05

## Entscheidung

- Hostinger Mail API wird serverseitig für alle Mailflows verwendet.
- Firmenempfänger, Absendername/-adresse sind nicht geheime Admin-Einstellungen. API-Token und Mailbox-ID sind Runtime-Secrets.
- Templates bleiben codebasiert wie aktuell. Kundenberater können den konkreten E-Mail-Text/Betreff bearbeiten.
- Anfrage wird in MySQL gespeichert, bevor E-Mailversand erfolgt. Mailfehler verlieren keine Anfrage und können erneut versucht werden.
- Erfolgreicher In-App-Mailversand protokolliert Aktion, Benutzername und Zeit.
- PDF-Layouts bleiben zunächst wie Bestand. PDF-Erzeugung erfolgt im Backend on-demand; Dateien werden nicht dauerhaft gespeichert.

## Umsetzungsstand (2026-10-09)

- Der Hostinger-Adapter, die persistente Outbox und die Reset-Mailvorlage sind
  implementiert. Echte Provider-Calls bleiben bis zu nichtproduktiven
  Zugangsdaten ein Proof-Gate.
- Rechnungs-PDFs werden serverseitig aus `Invoice` im übernommenen Legacy-Layout
  erzeugt und als Download ausgeliefert; ebenso Gutschriften und Mahnungen
  (`pdfkit`). Auftrags-/Angebots-PDFs nutzen serverseitig
  `jspdf`/`jspdf-autotable` über `OrderPdfBuilder`; die Bibliothek läuft
  ausschließlich im Backend, nie im Browser.
- Auftrags-/Angebots-PDFs werden serverseitig erzeugt. Editierbare
  Versanddialoge für Angebot, „2 Angebote" (nur aus Kopien), Absage,
  Rechnung, Gutschrift und Mahnung sind umgesetzt. PDF-Anhänge werden beim Einreihen erzeugt, base64
  in `EmailOutbox.attachments` gehalten und nach erfolgreichem Versand auf
  `NULL` gesetzt; dauerhaft gespeicherte PDFs entstehen nicht. Gutschrift- und
  Mahnungsmails verknüpfen die Outbox mit Auftrag bzw. `ReminderEvent`.
- Bei einer neuen öffentlichen Anfrage gehen zwei Mails raus: die Bestätigung
  an den Kunden und die Benachrichtigung an `companyEmail`. Die
  `V1.Send.Request`-Spezifikation der Hostinger-API kennt kein `Reply-To`
  (weder Header noch Feld); ein solcher Header kann über den genutzten
  API-Versand daher nicht gesetzt werden. Die Firmenmail enthält stattdessen
  Name, Auftragsnummer, einen Link zum Auftrag (`/edit/<Auftragsnummer>`,
  Basis aus der serverseitigen `APP_BASE_URL`) und einen `mailto:`-Link auf die im Formular
  angegebene Kundenadresse mit vorbelegtem Betreff. Ein echtes `Reply-To`
  bräuchte einen SMTP-Versandweg mit eigenen Zugangsdaten und ist als offene
  Architekturentscheidung nicht umgesetzt.
  Der Auftragslink steht ausschließlich in der Firmenbenachrichtigung, nicht
  in der Kundenbestätigung; der Auftragszugriff erfordert weiterhin eine
  berechtigte Mitarbeiteranmeldung.
- Mitarbeitende pflegen im Profil einen optionalen Signaturnamen
  (`User.signatureName`). Er wird beim Einreihen in `EmailOutbox.signatureName`
  übernommen und im Grußblock der Mailhülle über „Ihr Umzug Ruck Zuck Team“
  gesetzt. Ohne Signaturnamen bleibt der Standardgruß.
- Mitarbeitende wählen zusätzlich Schwarz (`#000000`, Standard), Vega-Blau
  (`#28527A`) oder Orange (`#CB722F`) als Signaturfarbe. Der erlaubte Farbwert wird in
  `User.signatureColor` gespeichert und beim Einreihen in
  `EmailOutbox.signatureColor` eingefroren, damit Retry-Mails dieselbe Farbe
  behalten. Die Farbe wird auf den vollständigen Grußblock einschließlich
  Signaturname und Teamname angewendet.
- Antworten aus dem Postfach sind ein eigener Reply-All-Flow ohne
  Auftragsmail-Vorlage und mit Originalzitat. `Reply-To` wird aus dem RFC822-
  Header gelesen und hat Vorrang vor `From`; ursprüngliche `To`-/`Cc`-Adressen
  werden als `Cc` ergänzt. Eigene Mailbox, Dubletten und `Bcc` werden nicht
  übernommen. Der Server bestimmt Empfänger und Threading-UID; Hostinger sendet
  mit `inReplyTo`. Mitarbeitende editieren nur den Text; die Signatur erscheint
  nicht in der Vorschau. Beim Versand setzt der Server sie automatisch nach dem
  Antworttext und vor das Originalzitat. Reply und Inbox-Angebotsantwort nutzen
  Namen und Farbe aus dem Profil sowie klickbare internationale Firmendaten;
  ohne Signaturname erscheint kein Loginname, sondern nur das Team. To/Cc,
  Inhalt und Signatursnapshot durchlaufen die idempotente Outbox.
- Ein im Postfach generierter Auftrag wird über den normalen Order-POST/PUT
  gespeichert und danach mit der Quellmail verknüpft. „Auftrag versenden“ nutzt
  den bestehenden Angebotsentwurf und PDF-Anhang, aber die einfache Reply-
  Signatur. Dieser Versandmodus ist serverseitig auf Orders mit
  `sourceMailUid` begrenzt.
- Im editierbaren Mailtext kann zusätzlich die Textfarbe aus einer festen
  Palette (Schwarz, Grau, Rot, Orange, Grün, Blau) gesetzt oder auf die
  Standardfarbe zurückgesetzt werden. Der Editor schreibt sie als
  `<span style="color:…">`; Tiptap serialisiert Hexwerte dabei als
  `rgb(r, g, b)`. Der Server-Sanitizer normalisiert diese Schreibweise zu
  `#rrggbb` und behält ausschließlich die Eigenschaft `color` mit einem
  Hexwert (3, 4, 6 oder 8 Stellen). Alle anderen Inline-Styles bleiben
  gesperrt.

## Folgen

- Hostinger API-Attachmentspezifikation muss gegen offizielle API/`hostinger-email-api-definition.json` verifiziert werden.
- Browser erhält keinen Mail-API-Schlüssel.
- Mail Outbox/Retry muss idempotent sein, um Doppelversand zu verhindern.
- Ein mehrdeutiger Send-POST-Ausgang (Netzwerk, Timeout, 5xx) oder ein
  verwaister Claim wird `UNKNOWN`, nicht automatisch erneut gesendet.
  Nur sicher nicht gesendete Versuche dürfen in den Retry. Ein
  Operator kann nach belegtem Providerabgleich auf `SENT` bzw. `PENDING`
  auflösen; Originalversand und Recovery-Nachweis werden atomar journalisiert.
  Ablauf und Einschränkungen stehen in `hostinger-mail-cron.md`.
- Der Versanddialog behält seine Kennung über Remount/Reload, ohne
  Mailinhalte im Browserstorage abzulegen. Reine Statuschecks legen
  niemals eine Mail mit einem neu geladenen Entwurf an; fehlende Kennungen
  werden gegen verspäteten Versand stillgelegt.
- Finanz-PDFs paginieren lange Positionen und Texte explizit, wiederholen
  Tabellenköpfe und halten Summen/Schlussangaben innerhalb der Seitenränder.
