# Installierbare Admin-App

Vega stellt für die Admin-/Berater-App ein Manifest und einen Service Worker
bereit. Die Installation wird vom Browser angeboten, wenn dessen Voraussetzungen
erfüllt sind; unter iOS erfolgt sie über „Zum Home-Bildschirm“. Verfügbarkeit
und Installationsoberfläche hängen vom Browser und Betriebssystem ab.
HTTPS ist erforderlich; `localhost` und `127.0.0.1` gelten für Tests als
sichere Ursprünge. Login, Rollen und TOTP bleiben unverändert.

## Scope und Cache

Die bestehenden Admin-Routen liegen unter `/`; deshalb hat der Worker den
Scope `/`. Ein Browser kontrolliert damit auch direkt aufgerufene
`/customer-form/`-Seiten. Ein vollständiger Ausschluss aus dem Scope ist ohne
Verlagerung der Admin-Routen oder separate Origin nicht möglich. Der Worker
behandelt Kundenformular-Navigationen und -Assets nicht und cached sie nicht.
Die in WordPress eingebettete Seite liegt auf der WordPress-Origin und ist
nicht vom Vega-Worker kontrolliert.

Der Worker cached ausschließlich beim Admin-Aufruf tatsächlich geladene,
versionierte Admin-Build-Assets aus einer beim Build erzeugten Allowlist.
Anfragen mit Authorization, Query oder fremder Origin sind ausgeschlossen;
der Cache-Fetch sendet keine Cookies. HTML, API, Auth, Health, Kundenformular,
personalisierte Inhalte und alle Schreibvorgänge werden nicht gecached.
`private`, `no-store` und `no-cache` werden respektiert. Alte Vega-Asset-Caches
werden bei Aktivierung einer neuen Version entfernt. Andere Caches bleiben
unverändert.

Für Admin-Navigationen gilt Netzwerkzugriff; bei Netzwerkausfall gibt der
Worker eine statische Offline-Meldung ohne Fachdaten zurück. Die laufende
Oberfläche meldet den Offline-Zustand. Es gibt keine Offline-Bearbeitung,
keine gespeicherten Fachdaten und keine automatische Wiederholung von
Schreibvorgängen. Bei fehlgeschlagener Worker-Registrierung funktioniert Vega
als normale Web-App weiter; die Oberfläche meldet den Fehler.

## Updates und Betrieb

Der Browser prüft den Worker beim Laden und die laufende App zusätzlich
stündlich. Eine wartende Version wird angezeigt, aber nicht automatisch
aktiviert. Erst „Aktualisieren“ und eine ausdrückliche Bestätigung aktivieren
sie und laden die Seite neu. Die Bestätigung warnt vor Verlust ungespeicherter
Eingaben, auch in anderen geöffneten Vega-Tabs. Andere Tabs werden nicht
automatisch neu geladen; nach einem Deployment können sie beim Nachladen
älterer Programmteile trotzdem einen Fehler anzeigen. Deshalb vor dem Update
alle Eingaben speichern und anschließend auch diese Tabs neu laden.

`sw.js` und das Manifest werden ohne dauerhafte HTTP-Zwischenspeicherung
ausgeliefert. Ein hartnäckiger alter Stand lässt sich in den Browser-Entwickler-
tools unter Service Workers und Cache Storage prüfen; dabei nur Vega-Caches
löschen. Die Anmeldung und Datenzugriffe bleiben serverseitig kontrolliert.
Auf Produktiv-HTTPS sind Installation, Upgrade, Offline-Meldung, Abmeldung,
Cache-Inhalt und WordPress-Formular auf den tatsächlich unterstützten Geräten
zusätzlich abzunehmen. Ein lokaler Build ersetzt diese Abnahme nicht.
