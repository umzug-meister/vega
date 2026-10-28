# PWA-Spezifikation für Vega

**Status:** Vorschlag zur Umsetzung; noch nicht implementiert  
**Stand:** 2026-10-25

## Ziel

Die Admin-/Berater-App soll auf unterstützten Geräten installierbar sein und
sich wie eine eigenständige App starten lassen. Die PWA-Erweiterung ergänzt das
bestehende Express-/Vite-Deployment. Sie führt weder einen zweiten Server noch
einen Offline-Zugriff auf Aufträge ein.

## Umfang und Abgrenzung

- **PWA-Ziel:** die authentifizierte Admin-/Berater-SPA unter der Vega-Origin.
- **Nicht PWA-Ziel:** das Kundenformular. Es bleibt ein per Loader in WordPress
  eingebettetes Formular ohne iframe. Ein Manifest oder Service Worker darf
  dessen WordPress-Seite oder deren Cache-Verhalten nicht verändern.
- **Kein Offline-Betrieb für Fachfunktionen:** Aufträge, Kunden-, Katalog- und
  Finanzdaten werden nicht offline gespeichert. Schreibvorgänge werden weder
  zwischengespeichert noch später automatisch wiederholt.
- **Keine Push-Benachrichtigungen** in der ersten Ausbaustufe.

## Architekturvorgaben

- Der vorhandene Express-Prozess liefert Admin-SPA, API und Kundenformular
  weiterhin gemeinsam aus. PWA-Dateien gehören zum Admin-Build und werden
  unter derselben Vega-Origin bereitgestellt.
- Manifest und Service Worker gelten nur für den Admin-App-Scope (`/`). Die
  Implementierung muss dafür sorgen, dass der Worker keine Requests oder
  Antworten unter `/customer-form/` kontrolliert oder cached.
- Startziel ist `/`; die bestehende Session-Prüfung und Umleitung zu `/login`
  bleiben serverseitig maßgeblich. Der Service Worker darf Authentifizierung,
  Rollenprüfung, CORS oder CSRF-/Origin-Schutz nicht ersetzen.
- Es werden keine neuen Hostnamen, API-Schlüssel oder Secrets in Vite-Variablen
  oder Browser-Bundles aufgenommen. Die PWA nutzt dieselbe Runtime-Origin und
  dieselbe Auth-Session wie die normale Admin-App.
- Produktion benötigt HTTPS. `localhost` bzw. `127.0.0.1` für lokale
  Entwicklung ist ausreichend; der Hostinger-HTTPS-/Domain-Proof bleibt Teil
  der bestehenden Deployment-Abnahme.

## Funktionale Anforderungen

### Installierbarkeit und Darstellung

- Ein Web-App-Manifest enthält Name und Kurzname „Vega“, `start_url: "/"`,
  `scope: "/"`, `display: "standalone"`, die Theme-/Hintergrundfarben der
  Admin-Oberfläche sowie passende Icons einschließlich Maskable-Icon.
- Icons werden als versionierte, lokal ausgelieferte Assets im Admin-Build
  gepflegt. Es werden keine externen Icon-CDNs benötigt.
- Die Admin-Seite verlinkt das Manifest und setzt Theme-Farbe sowie
  `apple-touch-icon` für Plattformen, die dafür separate Metadaten erwarten.
- Die vorhandene responsive Bedienoberfläche bleibt auf schmalen Displays
  nutzbar. Eine besondere native Navigation oder neue mobile Fachfunktion ist
  nicht Teil dieses PWA-Pakets.

### Service Worker und Cache

- Der Worker cached ausschließlich statische, gehashte Admin-Build-Assets, die
  zum Starten der Oberfläche erforderlich sind. Strategie und Cache-Namen sind
  versioniert; alte Vega-App-Caches werden beim Aktivieren entfernt.
- HTML-Dokumente (insbesondere `/`, `/login` und geschützte SPA-Routen),
  `/api/**`, `/health`, Auth-Endpunkte, Antworten mit `Set-Cookie` sowie alle
  personalisierten oder benutzerspezifischen Antworten werden **nicht**
  persistiert. Für diese Requests gelten Netzwerkzugriff und die vorhandenen
  `Cache-Control`-Regeln.
- Der Worker enthält keine Auftrags-, Kunden-, Formular-, Mail-, Rechnungs-,
  Sitzungs- oder Authentifizierungsdaten. Auch ein offline eingereichter
  Entwurf wird nicht in IndexedDB, Cache Storage oder Local Storage abgelegt.
- Bei fehlender Verbindung zeigt die App eine verständliche Offline-Meldung
  und blockiert nicht erfolgreich ausführbare Änderungen. Beim Wiederverbinden
  wird kein Schreibvorgang automatisch erneut abgesendet.
- Ein fehlgeschlagener Start im Offline-Modus darf keine veraltete oder
  geschützte HTML-Antwort anzeigen. Ein Offline-Fallback darf nur eine statische
  Meldung ohne Fachdaten enthalten.

### Updates und Fehlerverhalten

- Neue Versionen werden erkannt und nach Möglichkeit beim nächsten Laden
  aktiviert. Ein laufender Auftrag-/Formularentwurf darf nicht durch einen
  stillen Seiten-Reload verloren gehen; die Oberfläche informiert über ein
  verfügbares Update und lädt erst nach einer geeigneten Nutzeraktion neu.
- Ist der Service Worker nicht verfügbar oder seine Registrierung schlägt
  fehl, funktioniert die Admin-App weiterhin als normale Web-App.
- Abmelden löscht keine fachlichen Browserdaten, weil die PWA solche Daten
  nicht lokal speichert. Es muss dennoch geprüft werden, dass kein API- oder
  HTML-Cache nach Abmeldung private Inhalte offenlegt.

## Umsetzungsschritte

1. Admin-Build um Manifest, Icon-Assets, benötigte HTML-Metadaten und
   Service-Worker-Registrierung ergänzen; Installierbarkeit in den unterstützten
   Browsern festlegen und dokumentieren.
2. Worker-Scope und Express-Auslieferung so konfigurieren, dass der Worker nur
   Vega-Admin-Assets kontrolliert. Die Trennung zum Kundenformularpfad
   `/customer-form/` explizit absichern.
3. Eine Allowlist für cachebare Admin-Build-Assets verwenden. Ausschlüsse für
   Dokumente, API, Healthcheck, Auth, Cookies und personalisierte Antworten
   technisch erzwingen; kein generisches „cache all GET“-Verhalten einführen.
4. Offline- und Update-Hinweise in der Admin-Oberfläche ergänzen. Netzwerkfehler
   dürfen bestehende API-Fehlerbehandlung nicht umgehen.
5. Betriebsdokumentation um PWA-Auslieferung, HTTPS-Voraussetzung,
   Update-Verhalten und Cache-Invalidierung ergänzen.
6. Hostinger-/Browser-Abnahme durchführen; lokale Tests allein bestätigen weder
   Installation auf Zielgeräten noch den produktiven HTTPS-/Cache-Pfad.

## Abnahmekriterien

- Installierbarkeit wird in den vereinbarten Desktop- und Mobilbrowsern unter
  HTTPS angeboten; Start aus dem App-Launcher öffnet Vega und erhält den
  vorhandenen Login-Schutz.
- Nach erfolgreichem Login funktionieren Admin und Kundenberater entsprechend
  ihrer bestehenden Rollen und Sessions unverändert.
- DevTools-/Browser-Cache-Prüfung bestätigt: nur freigegebene gehashte
  Admin-Assets werden gespeichert; keine API-, Auth-, HTML- oder
  nutzerspezifischen Antworten.
- Offline-Aufruf zeigt nur die vorgesehene allgemeine Offline-Meldung. Nach
  Wiederverbindung ist kein Request automatisch wiederholt worden.
- `/customer-form/`, der WordPress-Loader und dessen absolute Assets werden
  nicht vom Admin-Service-Worker kontrolliert oder verändert.
- Ein Update auf eine neue Version entfernt veraltete App-Assets, ohne eine
  laufende Bearbeitung kommentarlos neu zu laden.
- Normale Web-Nutzung funktioniert bei deaktiviertem oder fehlgeschlagenem
  Service Worker weiter.

## Offene Entscheidungen vor Implementierung

- Welche Browser-/Betriebssystem-Kombinationen werden offiziell unterstützt?
- Soll eine Installationshilfe in der Admin-Oberfläche angeboten werden oder
  genügt der native Installationsdialog des Browsers?
- Welche Markenfarben und Icons sind für Manifest und Plattform-Icons freigegeben?
- Soll die Admin-Oberfläche außerhalb der Installierbarkeit überhaupt einen
  statischen Offline-Startscreen bereitstellen? Standard dieses Vorschlags ist
  eine neutrale Offline-Meldung ohne gecachte HTML-App.

## Beziehung zu bestehenden Vega-Vorgaben

Diese Spezifikation konkretisiert die getrennten Vite-Frontends und den
gemeinsamen Express-Auslieferungsprozess aus `adr/0001` und dem
Implementierungsplan. Sie ändert weder die WordPress-Embed-Entscheidung aus
`adr/0003` noch die Regeln für Better Auth, Safe DTOs, Datenaufbewahrung und
serverseitige Autorisierung. Bei Konflikten gelten Zielarchitektur und
akzeptierte ADRs.
