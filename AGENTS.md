# Projektanweisungen

Diese Datei gilt für das Vega-Repository einschließlich `docs/` und
`old-app/`. Das Legacy-Verzeichnis ist in `.gitignore`
ausgeschlossen und dient ausschließlich als Referenz; seine eigenen
Git-Metadaten bleiben erhalten. Vor Änderungen in einem Unterverzeichnis
zusätzlich dessen `AGENTS.md` lesen; insbesondere gelten die Legacy-Regeln in
`old-app/um-configurator/AGENTS.md` für das WordPress-Plugin.

## Projektbereiche und Quellen

- `docs/` ist die maßgebliche und stets zu verwendende Produkt- und
  Architekturquelle für Vega. Vor jeder Implementierung die betroffenen
  Abschnitte in `docs/implementation-plan.md`,
  `docs/target-architecture.md` und den relevanten ADRs lesen. Den aktuellen
  Stand führt `docs/implementation-status.md`, Betrieb/Konfiguration
  `docs/operations.md`. Glossar und Integrations-Proofs in `docs/` ergänzen bei Bedarf Begriffe und
  technische Randbedingungen. Für Vega keine parallelen Dokumentkopien
  außerhalb von `docs/` als Quelle verwenden.
- `old-app/` enthält das zu modernisierende Bestandssystem. Untersuche dort
  die tatsächlichen Abläufe, Formulare, Datenfelder, Vorlagen und PDFs, wenn
  eine Funktion portiert wird. Übernimm nur Verhalten, das mit den Zieldokumenten
  vereinbar ist; Legacy-REST-Routen, WordPress als Order-Backend, alte Daten,
  Mail-Proxy- und AWS-Abhängigkeiten sind keine Zielarchitektur.
- Das Vega-Repository ist das Zielprojekt und ein eigenes Git-Repository. Neue
  Anwendungsimplementierung, Tests und zugehörige technische Änderungen gehören
  grundsätzlich hierhin. `old-app/` bleibt aus dem Vega-Repository
  ausgeschlossen und dient als Referenz, außer der Auftrag verlangt ausdrücklich
  eine Änderung am Bestand.
- `hostinger-email-api-definition.json` ist die maßgebliche OpenAPI-
  Spezifikation für die Hostinger-Mail-Integration. Sie beschreibt den
  Mail-Provider, nicht den gesamten Vega-Fach-API-Vertrag. Für Vega-Routen und
  Geschäftsregeln gelten `docs/` und die dort freigegebenen Verträge.
- Die Hostinger-Zieldatenbank läuft laut `SELECT VERSION()` auf MariaDB
  `11.8.9` (`11.8.9-MariaDB-log`). `docker-compose.yml` und CI pinnen dieselbe
  Version. Details stehen in `docs/operations.md`.

## Vorgehen bei Änderungen

1. Prüfe zuerst die Zielarchitektur und den passenden Schritt im
   Implementierungsplan. Arbeite Abhängigkeiten und Freigabe-Gates in deren
   Reihenfolge ab; bei offenen Fach-, Sicherheits- oder Compliance-Entscheidungen
   dokumentiere den Blocker, statt eine Regel zu erfinden.
2. Vergleiche zu portierende Funktionalität mit `old-app/`, aber setze sie
   in der Zielstruktur des Vega-Repositories neu um. Keine Bestandsdatenmigration
   und keine ungeprüfte Übernahme alter Endpunkte oder Zugangsdaten.
3. Halte die Zielstruktur und Paketbefehle aus `package.json` aktuell.
   Zielruntime ist Node.js 24; Architekturvorgaben sind Express 5, TypeScript 7,
   React 19, Vite und MUI. Ein Express-Prozess liefert API und getrennte
   Admin- und Kundenformular-Builds aus.
4. Nach Codeänderungen mindestens `npm run typecheck`, `npm run lint`,
   `npm test` und `npm run build` ausführen (Node 24, Installation aus
   `package-lock.json`). Bei Schema- oder Auth-Änderungen zusätzlich
   `npm run test:database` gegen eine separate `_test`-Datenbank.
   Ergänze oder ändere Tests für das betroffene Verhalten.

## Nicht verhandelbare Zielregeln

- WordPress bleibt Content- und Einbettungsschicht. Kundenformular wird als
  Script/Loader ohne iframe eingebunden; Hostnamen und Geheimnisse gehören nicht
  in Vite-Builds. Öffentliche APIs geben nur ausdrücklich freigegebene Safe DTOs
  aus; es gibt keinen öffentlichen Order-/Kundenlesezugriff.
- Backend ist autoritative Stelle für Validierung, Preise, Geschäftsregeln und
  Rollen. UI-Ausblendung und CORS ersetzen keine serverseitige Autorisierung.
- MUI-Eingabefelder werden kompakt dargestellt: `TextField` nutzt global
  `margin="dense"` und `size="small"` über das Admin-Theme. Für neue oder
  überarbeitete Formulare diese Voreinstellung beibehalten und keine einzelnen
  Felder auf `normal`/`medium` zurücksetzen.
- Authentifizierung nutzt Better Auth mit TOTP (Pflicht für Admins, optional
  für Kundenberater) und den in den
  Dokumenten festgelegten Rollen. Datenbank ist frisches Hostinger-MySQL mit
  Prisma und versionierten Migrationen; Bestandsdaten werden nicht migriert.
- Mail, Auth, Google, GCS und Datenbank-Credentials bleiben ausschließlich in
  serverseitiger Runtime-Konfiguration. Keine echten Secrets in Dateien,
  Browser-Bundles, Tests, Logs oder Beispielen.
- Bei E-Mail-Aufgaben zuerst die passende Operation samt Schema, Auth,
  Erfolgs-/Fehlerantworten in `hostinger-email-api-definition.json`
  nachschlagen. Hostinger-Aufrufe erfolgen serverseitig mit Bearer-Token aus
  Runtime-Konfiguration. Die API nutzt JSON und ein `data`-Envelope für
  Antworten außer `204`; `204` hat keinen Antwortkörper. Fehler maschinell über
  `code` behandeln, niemals Tokens, Passwörter oder E-Mail-Inhalte loggen.
  Anhänge, Timeouts, Idempotenz und Retry-Verhalten gemäß API-Spezifikation und
  Umsetzungsplan prüfen.
- Alte Abläufe dürfen nur portiert werden, wenn sie nicht den dokumentierten
  Datenschutz-, Berechtigungs-, Aufbewahrungs- oder Sicherheitsregeln
  widersprechen. Bei Konflikten gilt die freigegebene Zielarchitektur; offene
  Fachentscheidungen bleiben explizit offen.
