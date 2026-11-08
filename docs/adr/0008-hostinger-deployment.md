# ADR 0008: Verwaltete Hostinger Node.js-App

- **Status:** Akzeptiert
- **Datum:** 2026-10-05

## Entscheidung

Die App läuft als verwaltete Node.js-Web-App bei Hostinger mit Node 24 LTS, einer Express-Instanz und Hostinger MySQL. Hostnames, Auth-URLs, CORS Origins und Geheimnisse werden zur Laufzeit konfiguriert, nicht in Vite-Builds eingebrannt.

Ein täglicher Hostinger-Cronjob verarbeitet Order-Purges nach 60 Tagen, Finanzbeleg-Purges nach 30 Tagen sowie Mail-Retries. Betreiber verwaltet Backups, initiale Katalogpflege und finalen Go-live. Provider- und Archivzugänge werden ausschließlich über serverseitige Runtime-Umgebungsvariablen bereitgestellt.

## Verifikation

Hostinger dokumentiert Node 24.x sowie Cron-Jobs für unterstützte Webhosting-Tarife. Die konkrete App muss trotzdem im tatsächlichen Tarif mit Start, Migrationslauf und Cron-Ausführung bewiesen werden.

- https://www.hostinger.com/support/how-to-select-the-node-js-version-for-your-application/
- https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/
- https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/

## Folgen

- Managed-Tarif und verfügbare Cron-Kommandos werden für den Betrieb geprüft.
- Deployment-/Rollback-Prozess und Backup-Prozess werden dokumentiert; Backup-Automatisierung wird nicht in die Anwendung eingebaut.
