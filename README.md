# Vega

Auftrags- und Angebotsverwaltung für Umzug Ruck Zuck: ein Express-Server mit
Admin-App und einbettbarem Kundenformular. WordPress bleibt CMS.

## Schnellstart

Voraussetzungen: Node.js 24, npm 11, Docker.

```sh
cp .env.example .env      # BETTER_AUTH_SECRET und INITIAL_ADMIN_* setzen
npm ci
npm run db:up
npm run db:migrate:dev
npm run db:seed
npm run dev
```

- Admin: <http://127.0.0.1:5173/>
- Kundenformular: <http://127.0.0.1:5174/customer-form/>
- API/Health: <http://127.0.0.1:3000/health>

## Prüfen und bauen

```sh
npm run typecheck && npm run lint && npm test && npm run build
npm start
```

## Struktur

```text
apps/server/         Express 5, Better Auth, Prisma, Mail, PDF
apps/admin/          React 19 / Vite / MUI Admin-App
apps/customer-form/  React 19 / Vite Kundenformular
packages/domain/     Geteilte Typen und Regeln
prisma/              Schema und Migrationen
docs/                Architektur, ADRs, Betrieb
```

## Dokumentation

- [Betrieb und Konfiguration](docs/operations.md) – Runtime, Datenbank, Recovery und Prüfungen
- [Architektur](docs/target-architecture.md) und [ADRs](docs/adr/) – Fachregeln und Entscheidungen
- [Glossar](docs/glossary.md) – Fachbegriffe
- [Installierbare Admin-App](docs/pwa-specification.md) – Cache, Updates und Offline-Verhalten
