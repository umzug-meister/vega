# Plan: Postfach → Auftrag mit Gemini

Status: Umgesetzt (PR 1–3 in einem Branch). Review-Entscheidungen (Zugriff später auf alle Mitarbeiter erweitert, inkl. Berater),
kein Reply-To (Empfänger = Absender), `Order.source` bleibt unverändert (Verknüpfung
über `sourceMailUid`/`sourceMessageId`), E-Mail/Telefon werden geschwärzt,
Anhang-Limits, `\Seen`/`\Answered`-Nebeneffekte akzeptiert. Setup: `gemini-setup.md`.
Google-AVV: freigegeben (Entscheidung des Betreibers). Offene Compliance-Punkte: keine.

## Ziel

Die Admin-App erhält den Menüpunkt „E-Mail Postfach". Eingehende E-Mails werden gelesen,
eine Mail wird ausgewählt und per Gemini in einen Auftragsentwurf überführt.
Layout: links 1/3 Mailanzeige, rechts (2/3) die Auftragsverarbeitung. Nach dem
Speichern kann der Auftrag als Antwort (Reply) auf die Originalmail gesendet werden.

## Festgelegte Entscheidungen

- **Postfach:** dasselbe `mailboxResourceId` wie beim Versand, nur `INBOX`.
- **Abruf:** live über das Backend (Pagination/Suche), keine Mail-Inhalte in der DB.
- **Zugriff:** zunächst nur Admins (serverseitig geprüft). Berater erst nach
  Entscheidung über ein eigenes Eingangs-Postfach.
- **Gemini:** Vertex AI, Region `global` (entschieden; Modelle im Projekt nur dort verfügbar), vorhandener Google-Service-Account. Modell per
  Config (Standard Flash), Structured Output (JSON-Schema), Feature-Flag `GEMINI_ENABLED`.
- **Prompt:** Mailtext, Anhänge und Möbelkatalog. Absendername/-adresse werden nicht
  übermittelt; im Text werden E-Mail-Adressen und Telefonnummern geschwärzt. Gemini
  darf keine Namen/E-Mails ausgeben. Name und E-Mail im Entwurf setzt das Backend
  aus dem Absender.
- **Weiterleitungen:** Die ursprüngliche Anfrage im Mailtext wird als Datenquelle
  ausgewertet; eindeutige spätere Korrekturen gehen vor. Nicht auflösbare
  Widersprüche gehören in die Notiz. Kunden- und Antwortadresse werden nicht
  automatisch aus weitergeleiteten Headern übernommen: Sie basieren weiterhin
  auf dem Absender der empfangenen Mail und müssen geprüft werden.
  Teiladressen und separat genannte Etagen werden je Be- oder Entladestelle
  übernommen; fehlende Straßen, Hausnummern und Postleitzahlen bleiben leer.
- **Ergebnis:** nur Entwurf im Auftragsformular (wie ein neuer Auftrag), Speichern
  nach menschlicher Prüfung über die bestehende Validierung. Preise und Volumen
  berechnet ausschließlich das Backend.
- **Anhänge:** PDF, Bilder, `.docx`, `.xlsx`, `.csv` (Office serverseitig zu Text).
  `.doc`/`.xls` werden nicht gelesen, der Nutzer erhält einen Hinweis. Anhänge werden
  nicht als Order-Bilder gespeichert.
- **Möbel:** Gemini bekommt die Katalogliste und mappt Synonyme (Sofa → Couch) auf
  Katalog-ID + Menge. Unbekannte Möbel kommen mit „ca."-Volumenschätzung ins
  Notizfeld und zählen nicht ins berechnete Volumen; das Volumen wird dann als
  „unvollständig" markiert, vor dem Angebotsversand erscheint eine Warnung.
- **Zusätzliche Entwurfsfelder:** Eindeutige Angaben zu weiteren Adressen,
  Hausstockwerken, Nebenräumen, umzuziehenden Zimmern, Betten und Möbelbreiten,
  Kartons, besonderen Gegenständen, Besichtigung, Kostenübernahme und
  Terminverbindlichkeit werden vorgeschlagen. Leistungen und Packmaterial werden
  nur anhand von Art und ID des serverseitig geladenen Katalogs zugeordnet;
  Preise stammen nicht von Gemini. Formularvorgaben sind manuell zu prüfen;
  die Prüfung und Korrektur des Entwurfs bleibt beim Personal.
  Kartonvolumen wird anhand der serverseitigen Volumenkonfiguration berechnet;
  fehlt ein benötigter Wert, bleibt das Volumen als unvollständig markiert.
  Ein erkannter Zeitraum ist im noch ungespeicherten KI-Entwurf editierbar;
  nach dem Speichern bleiben die bestehenden Sperrregeln für den Zeitraum erhalten.
- **Antwort:** über das Header-Menü des Auftrags, per Hostinger `send` mit `inReplyTo`
  (setzt Threading-Header und `\Answered`). Original wird zitiert. Empfänger:
  Reply-To, sonst From, nicht editierbar. Text aus der Auftragsmail-Vorlage
  (editierbar), PDF-Anhang wie im bestehenden Flow, Versand über `EmailOutbox`.
- **Quell-Mail am Auftrag:** `source = "mail"`, `sourceMailUid`, `sourceMessageId`
  (Migration). Vor dem Senden Suche per Message-ID, da UIDs sich ändern können.
- **Mehrfachverarbeitung:** wird nicht verhindert; das Mailprogramm zeigt „beantwortet".
- **Sicherheit Anzeige:** nur Plaintext (HTML-Mails serverseitig zu Text), Anhänge über
  Backend-Proxy mit Content-Type-Prüfung und `nosniff`, keine Remote-Bilder.
- **Betrieb:** Rate-Limit 10 Analysen/Stunde/Nutzer, Timeout 90 s, ein Retry bei
  429/5xx, synchron mit Ladezustand und Abbruch. Audit-Eintrag in
  `OrderActivityEvent` ohne Prompt-/Mail-Inhalt. Prompt/Antwort werden nicht geloggt.
- **Anhang-Grenzen:** harte Limits für Anzahl, Download- und entpackte Größe,
  Seitenzahl, extrahierten Text; Zip-Bomb-Schutz; Zeitlimit; höchstens eine
  gleichzeitige Analyse.

## Bekannte Nebeneffekte / Risiken

- Der `/text`-Abruf setzt `\Seen`, `inReplyTo` setzt `\Answered`; das Postfach ist
  daher nicht rein lesend (akzeptiert, zu dokumentieren; Alternative ohne `\Seen` prüfen).
- Das Zitat liegt in `EmailOutbox.contentHtml` und wird mit dem Auftrag aufbewahrt;
  „keine Mail-Inhalte gespeichert" gilt nur für den Postfach-Abruf.
- Namen in Anhängen/Signaturen können Google erreichen (Restrisiko, dokumentieren).
- Mengen aus Fotos sind Schätzungen und werden als solche gekennzeichnet.

## Schritte

### PR 1 – Postfach (nur Admin)

1. `docs/` ergänzen (Entscheidungen, offene Compliance-Punkte, Plan-/Statusschritt).
2. Modul `inbox` im Server; Hostinger-Client um Liste, Suche, Nachricht, Text und
   Anhang erweitern (Fehler über `code`, Bearer-Token aus Runtime-Config).
3. Routen `GET /inbox/messages`, `GET /inbox/messages/:uid`,
   `GET /inbox/messages/:uid/attachments/:id` mit Rollenprüfung, Pagination, Safe DTOs.
4. Plaintext-Anzeige, Anhangs-Proxy, keine Inhalte loggen.
5. Admin-App: Menüpunkt „E-Mail Postfach", Mailliste/-anzeige links, Auftragspanel rechts
   (MUI, kompakte Theme-Voreinstellung).
6. Tests; `npm run typecheck`, `lint`, `test`, `build`.

### PR 2 – Analyse mit Gemini

7. `docs/gemini-setup.md`: Einrichtung Vertex AI (Projekt, EU-Region, API, Service-
   Account-Rolle, Config-Variablen, lokales Testen ohne Secrets).
8. Gemini-Client hinter Interface (in Tests gemockt), Timeout, Retry, Rate-Limit.
9. Anhangsaufbereitung (Limits, Typprüfung, Office → Text, Inline-Logos ignorieren,
   nicht lesbare Dateien melden).
10. Prompt und Structured-Output-Schema aus `packages/domain` ableiten (Termine,
    Adressen, Etage, Aufzug, Parkdistanz, Möbel, Leistungen, Bemerkung). Unbekanntes
    bleibt leer, keine Preise.
11. `POST /inbox/messages/:uid/analyze`: Validierung, Schwärzung, Absender als
    Name/E-Mail, Katalog-Mapping, Unbekanntes ins Notizfeld.
12. Entwurf im rechten Panel (KI-Felder gekennzeichnet, Hinweis zu ungelesenen
    Anhängen, Warnung „Volumen unvollständig").
13. Migration (`source`, `sourceMailUid`, `sourceMessageId`), Audit-Eintrag;
    `npm run test:database` gegen `_test`-DB.
14. Tests; alle Prüfbefehle.

### PR 3 – Antwort als Reply

15. Header-Menü: „Als Antwort senden", nur bei `source = "mail"`.
16. Quell-Mail per Message-ID suchen (Fehlermeldung bei Nicht-Fund), Empfänger
    Reply-To/From, Vorlagentext mit escaped Zitat (`blockquote`), PDF-Anhang.
17. Versand über `EmailOutbox` (Idempotenz, Retry) mit `inReplyTo`.
18. Tests, alle Prüfbefehle; `docs/operations.md` und `docs/implementation-status.md`
    aktualisieren.

## Offene Punkte

- Welches Feld in `Order.data` ist das Notizfeld (Prüfung zu Beginn von PR 2).
- Entschieden: Google-AVV freigegeben, Berater haben Zugriff auf das Postfach.
- Nicht-ändernder Abruf ohne `\Seen` bei Hostinger prüfen.
