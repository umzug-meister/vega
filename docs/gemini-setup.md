# Gemini-Einrichtung (Postfach → Auftragsentwurf)

Die Analyse einer Mail läuft über **Vertex AI (Gemini), Region `global`** (Modelle sind im Projekt nur dort verfügbar; keine EU-Datenresidenz, AVV ist freigegeben).
Gemini liefert nur einen Auftragsentwurf; Preise und Volumen berechnet das Backend.
Die Funktion ist standardmäßig aus (`GEMINI_ENABLED` nicht gesetzt).

## 1. Google-Cloud-Projekt vorbereiten

1. Projekt wählen oder anlegen (kann das GCS-Projekt sein) und Abrechnung aktivieren.
2. API aktivieren: `gcloud services enable aiplatform.googleapis.com --project <PROJECT>`.
3. Service Account anlegen (oder den bestehenden verwenden) und ihm die Rolle
   **Vertex AI User** (`roles/aiplatform.user`) geben:

   ```sh
   gcloud iam service-accounts create vega-gemini --project <PROJECT>
   gcloud projects add-iam-policy-binding <PROJECT> \
     --member serviceAccount:vega-gemini@<PROJECT>.iam.gserviceaccount.com \
     --role roles/aiplatform.user
   ```

4. Schlüssel nur serverseitig ablegen (wie in `gcs-bucket-setup.md`); niemals ins
   Repository, in Builds oder Logs.

## 2. Runtime-Variablen (serverseitig)

| Variable                         | Wert                                                                 |
| -------------------------------- | -------------------------------------------------------------------- |
| `GEMINI_ENABLED`                 | `true` schaltet die Analyse ein; erfordert `GOOGLE_CLOUD_PROJECT`    |
| `GOOGLE_CLOUD_PROJECT`           | Projekt-ID                                                           |
| `GOOGLE_APPLICATION_CREDENTIALS` | Pfad zur Service-Account-JSON (oder Application Default Credentials) |
| `GEMINI_LOCATION`                | Optional, Standard `global` (keine EU-Datenresidenz) oder Region     |
| `GEMINI_MODEL`                   | Optional, Standard `gemini-3.1-flash-lite`                           |

Zusätzlich nötig: `HOSTINGER_MAIL_API_TOKEN` und `HOSTINGER_MAILBOX_RESOURCE_ID`
(Postfach liest `INBOX` derselben Mailbox, die auch sendet). Nach Änderungen den
Server neu starten.

## 3. Lokal testen

- Ohne Google-Zugang: `GEMINI_ENABLED` weglassen; das Postfach zeigt dann
  „KI-Analyse nicht aktiviert". Die Tests (`npm test`) mocken Gemini und Hostinger.
- Mit Zugang: `gcloud auth application-default login`, dann `GEMINI_ENABLED=true`
  und `GOOGLE_CLOUD_PROJECT` setzen.

## 4. Datenschutz und Verhalten

- An Gemini gehen: Betreff, Mailtext, lesbare Anhänge, Möbelkatalog (ID + Name).
  **Nicht** gesendet: Absendername/-adresse (Header), E-Mail-Adressen und
  Telefonnummern im Text werden vor dem Versand geschwärzt. Der Name/die Adresse
  des Absenders wird lokal in den Entwurf übernommen.
- **Restrisiko:** Namen im Fließtext und in Signaturen werden nicht erkannt.
  PDF- und Foto-Anhänge gehen unverändert an Gemini; darin enthaltene Namen,
  E-Mail-Adressen und Telefonnummern werden nicht geschwärzt. Geschwärzt werden
  nur Betreff, Mailtext und der aus `.docx`/`.xlsx`/`.csv` extrahierte Text.
  Der AVV mit Google ist vom Betreiber **freigegeben**; Aufbewahrungs-/No-Training-
  Einstellungen des Projekts bleiben im Google-Cloud-Projekt zu prüfen.
- Prompts und Antworten werden nicht geloggt; Mailinhalte werden nicht gespeichert.
- Das Lesen des Mailtexts setzt bei Hostinger `\Seen`; der Reply setzt `\Answered`.
- Gelesen werden PDF, Bilder, `.docx`, `.xlsx`, `.csv`. `.doc`/`.xls` werden
  nicht gelesen (Hinweis im Panel). Limits: 10 Anhänge, 20 MB gesamt,
  10 MB je Datei, Zip-Bomb-Schutz.
- XLSX-Anhänge werden serverseitig mit `read-excel-file` gelesen (kein
  ExcelJS). Die Extraktion übernimmt Blattnamen und tabgetrennte Zellwerte,
  einschließlich gespeicherter Formelergebnisse, ohne Formeln auszuführen.
  Sie begrenzt die Ausgabe auf 5 Blätter, 500 nichtleere Zeilen je Blatt,
  30 Spalten und insgesamt 60.000 Zeichen. Die ZIP-Prüfung läuft vor dem Parser.
- Ein Rate-Limit begrenzt Analysen (10/Stunde und eine gleichzeitig je Nutzer).
- Weitergeleitete Anfragen werden als Datenquelle gelesen; eindeutige spätere
  Korrekturen gehen vor, unauflösbare Widersprüche landen in der Notiz. Kunde
  und Antwortadresse stammen immer vom Absender der empfangenen Mail.
- Mail-HTML wird serverseitig mit einer engen Allowlist bereinigt; Skripte,
  aktive Inhalte und Remote-Bilder werden nicht angezeigt. Anhänge laufen über
  den Backend-Proxy mit Content-Type-Prüfung und `nosniff`.
- Mehrfachverarbeitung derselben Mail wird nicht verhindert.
- Zugriff für alle angemeldeten Mitarbeiter (Admins und Kundenberater, nach
  abgeschlossener Einrichtung/TOTP). Berater dürfen das gesamte Postfach der
  konfigurierten Mailbox sehen. Mails können nur mit aktiven, nicht
  archivierten Aufträgen verknüpft werden.

## 5. Antwort auf die Originalmail

- „Antwort“ im Postfach sendet ein Reply-All: `Reply-To` (sonst `From`) ist
  Empfänger, ursprüngliche `To`/`Cc` werden `Cc`. Details in ADR 0007.
- Ein mit der Mail verknüpfter Auftrag kann als Angebot auf die Originalmail
  geantwortet werden. Die Originalmail wird per Message-ID gesucht; Empfänger
  ist ihr Absender.
- Die Signatur setzt der Server beim Versand zwischen Antworttext und Zitat.
  Das Zitat liegt wie jede Staff-Mail in `EmailOutbox.contentHtml` und wird mit
  dem Auftrag aufbewahrt; „keine Mailinhalte gespeichert“ gilt nur für den
  Postfach-Abruf.
