# ADR 0003: WordPress-Loader und minimale öffentliche API

- **Status:** Akzeptiert
- **Datum:** 2026-10-05

## Kontext

Die öffentliche Website bleibt WordPress. Das aktuelle Formular wird als Script/CSS eingebettet, nicht in einem iframe. Der künftige Loader liegt auf der Vega-Node-App. Kunden müssen Services/Katalogdaten lesen und Anfragen absenden können, dürfen aber keine Kunden-/Auftragsdaten lesen.

## Entscheidung

- WordPress ruft den Vega-Loader auf; der Loader stellt absolute Asset-/API-Pfade bereit.
- Nur der lange deutsche Umzugsflow bleibt; Express- und eigenständiger
  Möbellistenflow entfallen. **Änderung vom 2026-10-09 auf ausdrückliche
  Freigabe:** Der in das lange Formular eingebettete Möbel-/Volumenrechner
  wird für die gewünschte Legacy-Übernahme ebenfalls portiert.
- Public API beschränkt sich auf Safe Catalog GET und Order POST (plus begrenzte Upload-Anbahnung).
- Enge Ausnahme: öffentlicher Places-Proxy nur für die zwei Aktionen
  `POST /api/customer-form/places/autocomplete` und `POST /api/customer-form/places/address`
  (DE/AT-Vorschläge, danach genau `street`/`postalCode`/`city`; rate-limitiert, `Cache-Control: no-store`,
  manueller Fallback; kein generischer Google-Proxy, kein Place-/Order-Speicher, kein öffentlicher Order-Read).
- Admin-Streckenberechnung ist authentifizierte Admin-API unter `/api/admin/routes`
  (`GET /config`, `POST /distance`; Depot-Rundreise ab Betriebsstandort). Die
  Erstberechnung startet automatisch nach dem Laden der Konfiguration, eine
  geänderte, vollständige Adresse löst beim Verlassen des Felds eine
  Neuberechnung aus; der Button bleibt als manueller Retry.
- CORS-Allowlist, Rate-Limits, Schema-/Payloadprüfung und API-seitige Freigabe projektspezifischer DTOs.
- Kein Honeypot/CAPTCHA zum Start.
- Hostnamen werden nicht in Frontend-Builds fest codiert.

## Folgen

- WordPress bleibt erforderlich, aber nur als CMS-/Embed-Schicht.
- CORS wird nicht als Sicherheitsgrenze behandelt.
- Vor Umsetzung ist der Loader mit WordPress/Hostinger Routing und der Origin-Allowlist zu verifizieren.

## Lokaler Umsetzungsstand (2026-10-09)

Der Loader `/customer-form/loader.js` liest die Vite-Manifestdatei und liefert
absolute JS-/CSS-/API-Pfade aus der Server-Runtime. Das Formular verwendet einen
eigenen Mountpoint und scoped MUI-Basisstile, kein iframe und keinen globalen
CSS-Reset für die WordPress-Seite. Die explizite Projektion unter
`/api/customer-form/config` enthält nur Datenschutz-/Erfolgs-/Kartonrechner-Links,
Kartonvolumina und Verfügbarkeitsflags; Standort, Firmenempfänger,
Absenderdaten und Providerzugänge bleiben davon ausgeschlossen.

## Ergänzung Google-Maps (2026-10-11)

Die einzige öffentliche Google-Ausnahme sind die zwei Places-Aktionen unter
`/api/customer-form/places/*` (Autocomplete-Vorschläge ab 3 Zeichen mit
DE/AT-Filter und Session-Token, danach Adressdetails projiziert auf
`street`/`postalCode`/`city`). Beide sind rate-limitiert, senden
`Cache-Control: no-store` und geben weder API-Schlüssel noch
Google-Rohantworten, Betriebsadresse oder Mitarbeiterdaten aus. Fällt der
Provider aus oder fehlt der Key (`503`/`502`), bleibt die manuelle Eingabe
voll möglich; die eingereichte Adresse wird serverseitig unabhängig validiert.
Die Streckenberechnung (`/api/admin/routes/*`) ist ausschließlich
authentifizierte Admin-API für Admin/Kundenberater mit abgeschlossener
2FA-Session: Depot → 2–4 Umzugsadressen → Depot,
gerundet auf ganze Kilometer in den ungespeicherten Entwurf. Ein einziger
serverseitiger `GOOGLE_MAPS_API_KEY` deckt Places API (New) und Routes API ab
(bewusste Betreiberentscheidung: gemeinsame Quoten, keine getrennte Rotation).
Unmittelbar aufeinanderfolgende gleiche Adressen werden vor dem Provideraufruf
zusammengefasst und nachher als Null-Kilometer-/Null-Minuten-Abschnitt
wiederhergestellt; die übrigen Streckenabschnitte werden normal berechnet.
Der echte Google-/Hostinger-Provider-Proof bleibt offen.

## Ergänzung automatische Streckenberechnung (2026-10-17)

Der bisherige explizite Klick ist nicht mehr die einzige Auslösung. Sobald
Auftragsentwurf und Konfiguration geladen sind (`GET /api/admin/routes/config`),
berechnet die Admin-Oberfläche einmal automatisch, wenn der Betriebsstandort
gesetzt, Google-Routes verfügbar, alle
aktiven Be-/Entladeadressen vollständig sind und noch keine manuelle oder
berechnete Entfernung vorliegt. Ein bereits vorhandener manueller oder
berechneter Kilometerwert wird beim Öffnen nicht überschrieben. Ändert der
Mitarbeiter Straße, PLZ oder Ort einer aktiven Adresse, wird die Route beim
Verlassen des Felds neu berechnet, sobald alle aktiven Adressen vollständig
sind; unveränderte Blurs und Änderungen an nicht routenrelevanten Feldern
lösen keine Anfrage aus. Laufende Berechnungen werden bei einer neueren
Adressversion abgebrochen, veraltete Antworten ignoriert. Fehlender Key,
fehlender Betriebsstandort oder unvollständige Adressen setzen die Automatik
aus, ohne die manuelle Eingabe zu blockieren; Providerfehler zeigen einen
Fehler, ohne den zuletzt gespeicherten Kilometerwert zu löschen. Der Button
„Fahrstrecke berechnen" bleibt als manueller Retry erhalten. Browser rufen
Google weiterhin nie direkt auf; der Schlüssel bleibt in der Server-Runtime.
