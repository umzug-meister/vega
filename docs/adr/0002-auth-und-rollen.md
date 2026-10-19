# ADR 0002: Better Auth, TOTP und zwei Rollen

- **Status:** Akzeptiert
- **Datum:** 2026-10-06
- **Fachentscheidung:** Auftraggeber, Name nicht angegeben

## Entscheidung

Better Auth mit E-Mail/Passwort und TOTP: verpflichtend für Admins, optional für Kundenberater. Kundenberater können TOTP im Profil freiwillig einrichten und mit Passwortbestätigung selbst wieder deaktivieren. Bewusster Trade-off (Entscheidung des Produktinhabers): Ohne TOTP genügt bei Kundenberatern ein kompromittiertes Passwort für Zugriff auf Auftrags- und Kundendaten. Neu gesetzte Passwörter müssen mindestens 8 Zeichen enthalten, darunter je einen Großbuchstaben, Kleinbuchstaben und eine Zahl. Mitarbeiter-E-Mail-Adressen müssen nicht verifiziert werden. Es gibt keine öffentliche Registrierung. Ein einmaliger Prisma-Seed legt `root_user` als ersten Admin an. Die Login-E-Mail und das Initialpasswort kommen aus `INITIAL_ADMIN_EMAIL` und `INITIAL_ADMIN_PASSWORD` in der serverseitigen Runtime-Konfiguration. Beim ersten Login muss das Initialpasswort geändert und – bei Admins – TOTP eingerichtet/verifiziert werden, bevor geschützte Admin-Funktionen freigeschaltet werden. Danach können Admins Konten anlegen und ihnen auch die Rolle `Admin` zuweisen. Admins können für ein Konto eine Passwort-Reset-Mail auslösen; das neue Passwort setzt der Kontoinhaber über den kurzlebigen Reset-Link selbst. Recovery-Codes und ein dokumentierter Admin-Reset-Prozess werden vorgesehen.

Better Auth wird mit der exakt gepinnten Version und deren Prisma-Adapter-/Plugin-Schema betrieben. `twoFactor` Server- und Client-Plugin stellen TOTP bereit; Enrollment benötigt Passwortbestätigung und eine erste erfolgreiche Codeprüfung. Einmalige Recovery-Codes werden geschützt ausgegeben/gespeichert. Geschützte Kundendatenrouten verweigern Zugriff, bis 2FA aktiviert ist.

`BETTER_AUTH_SECRET` ist ein starkes, eindeutiges Runtime-Secret (mindestens 32 Zeichen/hohe Entropie). Trusted Origins bleiben eng, CSRF-/Origin-Checks aktiv und Better-Auth-Rate-Limits persistent. Login-, Passwortreset- und 2FA-Routen erhalten strengere endpoint-spezifische Limits. Da Admin-SPA und Auth-API auf Vega derselben Origin liegen, werden keine Cross-Subdomain-Cookies benötigt. Secure/HttpOnly-Cookies gelten in Produktion.

Rollen sind `Admin` und `Kundenberater`. Berechtigungen werden serverseitig auf Use-Case-/API-Ebene erzwungen.

## Berechtigungskern

- Admin: Benutzer, globale Kataloge/Preise, alle Orders und Angebote, Rechnungen, Gutschriften und Mahnungen.
- Kundenberater: Orders bearbeiten, Einzelangebote kopieren/anpassen/archivieren, individuellen Angebotspreis festlegen, E-Mail/PDF versenden, Order archivieren/wiederherstellen.
- Kundenberater dürfen keine globalen Preis-/Katalogdaten, Benutzer oder Buchhaltungsdatensätze verwalten.

## Folgen

- Kunden sind anonyme Formularnutzer und erhalten keine Sessions/Accounts.
- TOTP-Enrollment/Recovery muss vor Produktivbetrieb getestet werden.
- Rollenänderung oder Account-Sperre wirkt auf API-Zugriff, nicht nur auf sichtbare Menüs.
- Passwortreset versendet generische Antworten, nutzt kurzlebige Einmal-Token und widerruft bestehende Sessions.
- Der verpflichtende Initialpasswortwechsel widerruft andere Sessions;
  Ersatzcookies erhalten die aktuelle Sitzung. TOTP-Start, erfolgreicher
  Enrollment-Abschluss und erlaubte Deaktivierung widerrufen andere
  Sitzungen, ohne unabhängige normale TOTP-Logins gegenseitig abzumelden.
- Eine Anmeldung ist spätestens alle 30 Tage erforderlich. Die absolute Sessiondauer beträgt höchstens 30 Tage und wird durch laufende Aktivität nicht verlängert.
- Fachentscheidung vom 2026-10-09: Anlage, Sperrung/Entsperrung, Rollenwechsel,
  Passwort-Reset-Mail und 2FA-Reset verlangen jeweils das aktuelle Passwort des
  ausführenden Admins. Die Bestätigung wird serverseitig geprüft und persistent
  auf fünf Versuche je Admin und Minute begrenzt.

## Umsetzungsstand (2026-10-09)

- Der Self-Service-Passwortreset nutzt den serverseitigen Hostinger-Mailadapter,
  gibt für bekannte und unbekannte E-Mail-Adressen dieselbe Antwort und widerruft
  nach erfolgreichem Reset Sitzungen.
- Profil-E-Mail-Änderungen verlangen eine Passwortbestätigung und widerrufen
  andere Sessions.
- `/users` und `/api/admin/staff` bieten Suche/Paginierung, Anlage,
  Sperrung/Entsperrung, Rollenwechsel, Passwort-Reset-Mail und 2FA-Reset. Neue
  Accounts benötigen ein sicher separat übergebenes Initialpasswort,
  Passwortwechsel; Admin-Konten zusätzlich erfolgreiches TOTP-Enrollment.
- Rollenwechsel, Sperrung und 2FA-Reset widerrufen alle Sitzungen sowie offene
  Reset-/2FA-Challenges. Entsperrung stellt keine alten Sitzungen wieder her.
  Sperrung verhindert auch neue Better-Auth-Sitzungen. Die Lifecycle-Transaktion
  prüft den ausführenden Admin erneut und schützt vor Selbstsperrung,
  Selbstherabstufung und Verlust des letzten aktiven Admins.
- Admins können TOTP nicht deaktivieren; Kundenberater nur selbst über
  `/two-factor/disable` mit Passwortbestätigung (serverseitige Rollenprüfung).
  TOTP kann nicht durch OTP-Enrollment ersetzt oder per `trustDevice`
  umgangen werden. Die Rollenregel steht in `isTotpRequired` in
  `@vega/domain`; ein zum Admin beförderter Kundenberater ohne TOTP muss es
  vor weiterem Zugriff einrichten. Recovery-Codes bleiben case-sensitiv,
  verschlüsselt und einmalig verwendbar. Ein Admin-2FA-Reset löscht Faktoren und
  Codes; Admins müssen danach neu einrichten, Kundenberater können es.
- Der einzige aktive Admin kann mit dem ausdrücklich bestätigten,
  serverseitigen `auth:recover-admin`-Befehl wiederhergestellt werden. Identität
  und Datenbanksicherung müssen vorab außerhalb der App geprüft werden;
  Anleitung in `docs/operations.md`. Der Befehl ändert kein Passwort und ist kein
  erneuter Bootstrap.
- Der Admin-Mailpfad meldet Erfolg erst nach bestätigtem Hostinger-Versand;
  Better Auths generische Self-Service-Antwort bleibt unverändert. Reset-Links
  stehen sowohl im HTML- als auch im Textteil der Mail.
- Isolierte DB-/HTTP-Tests decken Kontoaktionen, Passwort-/TOTP-Gates,
  Rollenmatrix, Recovery, Mailerfolg/-fehler, Origin-Checks und persistente
  Auth-Rate-Limits ab. Ein tatsächlicher Hostinger-/Mail-Proof bleibt extern.
