# GCS-Bucket anlegen (Betriebsanweisung)

Step-by-Step-Anleitung zum Anlegen des privaten Google-Cloud-Storage-Buckets
für Kundenbilder (ADR 0006, Arbeitspaket A8). Die Vorgaben sind bindend:
der Upload-Service in `apps/server/src/uploads/upload-service.ts` prüft die
Bucket-Konfiguration und lehnt den Betrieb sonst mit
`UNSAFE_BUCKET_CONFIGURATION` (503) ab.

## Voraussetzungen

- Google Cloud Account mit aktiviertem Billing.
- Ein GCP-Projekt (für den nichtproduktiven EU-Proof laut A0 zuerst ein
  separates Staging-Projekt, danach ein Produktionsprojekt).

## Schritt 1 – APIs aktivieren

Die `gcloud`-Befehle auf dem lokalen Rechner mit autorisiertem Betreiberkonto
ausführen, nicht in der Hostinger-SSH-Shell:

```sh
gcloud auth list --filter=status:ACTIVE --format='value(account)'
gcloud config get-value project
gcloud services enable storage.googleapis.com iamcredentials.googleapis.com \
  --project=housemoving-1527875558789
```

Bei fehlender Anmeldung zuerst `gcloud auth login` ausführen. Die API-Aktivierung
ist ein Einrichtungsschritt; sie wurde im unten protokollierten Lauf nicht
ausgeführt. IAM Credentials wird für keyless Signierung/Impersonation benötigt,
nicht für das lokale Signieren mit einem vorhandenen JSON-Schlüssel.

## Schritt 2 – Bucket anlegen

Der Produktionsbucket `vega-eu-images` besteht bereits. Zuerst prüfen:

```sh
gcloud storage buckets describe gs://vega-eu-images --format=json
```

Nur für eine neue Installation, wenn der Bucket noch nicht existiert:

```sh
gcloud storage buckets create gs://vega-eu-images \
  --project=housemoving-1527875558789 \
  --location=europe-west3 --default-storage-class=STANDARD \
  --uniform-bucket-level-access --public-access-prevention
```

Ein bestehender Standort lässt sich nicht nachträglich ändern. Zielwerte:

| Feld           | Wert                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------- |
| Name           | global eindeutig, z. B. `vega-eu-images`; wird als `GCS_BUCKET` konfiguriert                  |
| Location type  | **Region** (keine Multi-Region)                                                               |
| Location       | EU-Region, z. B. `europe-west1` oder `europe-west3`; Multi-Region `EU` ist ebenfalls zulässig |
| Storage class  | Standard                                                                                      |
| Public access  | **Enforce public access prevention** (erzwungen)                                              |
| Access control | **Uniform bucket-level access** (keine Objekt-ACLs)                                           |
| CMEK           | aus; Standard-Verschlüsselung genügt                                                          |

Das Backend erwartet eine der folgenden Location-Werte (Groß-/Kleinschreibung
egal): `EU`, `EUR4`, `EUROPE-WEST1`, `EUROPE-WEST3`, `EUROPE-WEST4`,
`EUROPE-WEST8`, `EUROPE-WEST9`, `EUROPE-WEST10`, `EUROPE-WEST12`,
`EUROPE-NORTH1`, `EUROPE-CENTRAL2`, `EUROPE-SOUTHWEST1`.

## Schritt 3 – Lifecycle-Regel (genau eine, unbedingt)

Vorhandene Regeln zuerst mit `buckets describe` prüfen. Die folgende Änderung
ersetzt die gesamte Lifecycle-Konfiguration; beim bestehenden Produktionsbucket
ist die gewünschte Regel bereits vorhanden:

```sh
cat > /tmp/vega-gcs-lifecycle.json <<'EOF'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":180}}]}
EOF
gcloud storage buckets update gs://vega-eu-images \
  --lifecycle-file=/tmp/vega-gcs-lifecycle.json
```

Das Backend verlangt **genau eine** unbedingte Delete-Regel mit
`age: 180`. Jede zusätzliche Lifecycle-Regel (auch eine Staging-
Bereinigungsregel) führt zu `UNSAFE_BUCKET_CONFIGURATION`. Verwaiste
Staging-Objekte werden daher nicht vorzeitig gelöscht; ihre Bereinigung
erfolgt ausschließlich über die 180-Tage-Regel.

## Schritt 4 – CORS für Signed-POST-Uploads

`gcloud storage buckets
update` erwartet eine JSON-Datei über `--cors-file`; `--cors=...` ist kein
gültiges Flag. Die CORS-Datei muss ein JSON-Array mit einem Eintrag pro Regel
sein:

```bash
cat > /tmp/vega-prod-gcs-cors-20261018.json <<'EOF'
[
  {
    "origin": [
      "https://vega.umzugruckzuck24.de",
      "https://umzugruckzuck24.de"
    ],
    "method": ["GET", "POST", "HEAD"],
    "responseHeader": ["Content-Type", "x-goog-*"],
    "maxAgeSeconds": 3600
  }
]
EOF

gcloud storage buckets update gs://vega-eu-images \
  --cors-file=/tmp/vega-prod-gcs-cors-20261018.json
```

- Für lokale Entwicklung die exakten Origins verwenden, einschließlich Scheme
  und Port. `localhost` und `127.0.0.1` sind verschiedene Origins; letzteres
  muss zusätzlich eingetragen werden, wenn der Browser damit geöffnet wird.
- Die obigen HTTPS-Origins gelten für die Vega-App und die WordPress-Website.
  Lokale Origins ausschließlich in einem separaten Dev-/Staging-Bucket
  freigeben; keine Wildcard-Origin verwenden.
- Die CORS-Konfiguration anschließend prüfen, z. B. mit
  `gcloud storage buckets describe gs://vega-eu-images`.
- Der tatsächliche CORS-Proof mit echtem Provider ist Teil von A0 und in
  `proof-01-integration-compatibility.md` als offen dokumentiert.

## Schritt 5 – Service Account für den Server

Für Dev/Staging und Produktion jeweils einen **eigenen** Service Account
verwenden, z. B. `vega-server-gcs-dev` im Dev-Projekt und
`vega-server-gcs-prod` im Produktionsprojekt. So erhält der Dev-Server keinen
Zugriff auf Produktionsbilder.

Der Produktions-Service-Account besteht bereits. Prüfen und die beiden
Bucket-Rollen zuweisen (diese Rollenbindungen wurden am 2026-10-18 ausgeführt):

```sh
gcloud iam service-accounts describe \
  vega-server-gcs-prod@housemoving-1527875558789.iam.gserviceaccount.com \
  --project=housemoving-1527875558789 --format='yaml(email,disabled)'

gcloud storage buckets add-iam-policy-binding gs://vega-eu-images \
  --member=serviceAccount:vega-server-gcs-prod@housemoving-1527875558789.iam.gserviceaccount.com \
  --role=roles/storage.objectAdmin --format=json

gcloud storage buckets add-iam-policy-binding gs://vega-eu-images \
  --member=serviceAccount:vega-server-gcs-prod@housemoving-1527875558789.iam.gserviceaccount.com \
  --role=roles/storage.legacyBucketReader --format=json

gcloud storage buckets get-iam-policy gs://vega-eu-images --format=json
```

Keine zusätzlichen Projektrollen vergeben. `Storage Object Admin` erlaubt
Objektzugriffe; `Storage Legacy Bucket Reader` ergänzt die für die
Bucket-Sicherheitsprüfung benötigte Berechtigung `storage.buckets.get`.

Nur falls ein neuer Service Account benötigt wird:

```sh
gcloud iam service-accounts create vega-server-gcs-prod \
  --project=housemoving-1527875558789 --display-name='Vega GCS Produktion'
```

Keyless ADC bevorzugen, sofern Hostinger es unterstützt. Wenn stattdessen ein
JSON-Schlüssel benötigt wird, einen vorhandenen Schlüssel sicher verwenden oder
gezielt einen neuen erzeugen. Folgende Befehle wurden noch nicht ausgeführt;
sie erzeugen einen echten langlebigen Schlüssel. Vorhandene Datei nicht
überschreiben und nicht bei jedem Deployment neue Schlüssel erzeugen:

```sh
mkdir -p "$HOME/.config/vega"
chmod 700 "$HOME/.config/vega"
(
  umask 077
  gcloud iam service-accounts keys create \
    "$HOME/.config/vega/gcs-prod-service-account.json" \
    --iam-account=vega-server-gcs-prod@housemoving-1527875558789.iam.gserviceaccount.com \
    --project=housemoving-1527875558789
)
chmod 600 "$HOME/.config/vega/gcs-prod-service-account.json"
```

Organisationsrichtlinien nicht umgehen. Bei gesperrter Schlüsselerstellung
einen genehmigten Authentifizierungsweg mit dem Projektadministrator klären.

Für Produktion dieselben Schritte mit eigenem Produktions-Service-Account und
Produktionsbucket wiederholen. Niemals den Dev-Schlüssel für Produktion nutzen.
Keine Schlüsseldateien oder Zugangsdaten in das Repository, in Vite-Builds,
Tests, Logs oder Beispiele legen und Schlüssel weder in Chat noch Tickets
kopieren.

## Schritt 6 – Schlüssel per SSH/SCP auf Hostinger ablegen

Auf dem lokalen Rechner ausführen. SSH-Passwörter ausschließlich interaktiv im
Terminal eingeben. Host-Key-Fingerprint beim ersten Kontakt unabhängig prüfen;
keine Host-Key-Prüfung abschalten. Der Zielpfad liegt außerhalb von Repository,
`public_html`, `nodejs` und `hbuilds` und wird nicht mit dem Deployment ersetzt.

```sh
ssh -p 65002 u959171828@82.25.96.74 \
  'umask 077; mkdir -p "$HOME/.config/vega" && chmod 700 "$HOME/.config/vega"'

scp -P 65002 "$HOME/.config/vega/gcs-prod-service-account.json" \
  u959171828@82.25.96.74:.config/vega/gcs-prod-service-account.json

ssh -p 65002 u959171828@82.25.96.74 \
  'chmod 600 "$HOME/.config/vega/gcs-prod-service-account.json" && test -s "$HOME/.config/vega/gcs-prod-service-account.json" && printf "Credential-Datei vorhanden: %s/.config/vega/gcs-prod-service-account.json\n" "$HOME"'
```

Vor einem erneuten Upload prüfen, ob am Ziel bereits ein produktiver Schlüssel
liegt; eine Rotation ausdrücklich planen. Kein `cat` oder Kopieren des
Schlüsselinhalts in Chat/Logs. Diese Übertragung ist noch nicht nachgewiesen.
Die SSH-Prüfung bestätigt nur Dateiexistenz, nicht den Zugriff des Managed-App-
Prozesses. Bei isoliertem App-Dateisystem einen unterstützten Secret-Mount mit
Hostinger klären, nicht in den Webroot ausweichen.

## Schritt 7 – Runtime-Konfiguration des Servers

In Hostingers serverseitiger App-Konfiguration hinterlegen (kein SSH-`export`:
SSH-Variablen werden nicht automatisch vom verwalteten App-Prozess übernommen):

```text
GCS_BUCKET=vega-eu-images
GOOGLE_CLOUD_PROJECT=housemoving-1527875558789
GOOGLE_APPLICATION_CREDENTIALS=/home/u959171828/.config/vega/gcs-prod-service-account.json
```

Den absoluten Pfad anhand der obigen SSH-Ausgabe bestätigen. App anschließend
über Hostinger neu starten; keinen zweiten Server in der SSH-Shell starten.
Für das Setzen von Managed-App-Variablen/Neustart liegt hier kein verifizierter
SSH-CLI-Befehl vor, daher bleiben diese Schritte in hPanel.

Die Konfiguration in `apps/server/src/config.ts` erwartet:

| Variabale                        | Wert                                              |
| -------------------------------- | ------------------------------------------------- |
| `GCS_BUCKET`                     | Bucket-Name aus Schritt 2, z. B. `vega-eu-images` |
| `GOOGLE_CLOUD_PROJECT`           | Projekt-ID (optional, empfohlen)                  |
| `GOOGLE_APPLICATION_CREDENTIALS` | Pfad zum Schlüssel, sofern verwendet              |

Für den lokalen Dev-Server müssen diese Werte in dessen Prozessumgebung
gesetzt sein. Bei Verwendung des JSON-Schlüssels zeigt
`GOOGLE_APPLICATION_CREDENTIALS` auf die außerhalb des Repositories liegende
Datei; die Variable enthält **nicht** den JSON-Inhalt. Zum Beispiel:

```sh
export GCS_BUCKET=vega-eu-images-dev
export GOOGLE_CLOUD_PROJECT=DEINE_DEV_PROJEKT_ID
export GOOGLE_APPLICATION_CREDENTIALS="$HOME/.config/vega/gcs-dev-service-account.json"
npm run dev
```

`DEINE_DEV_PROJEKT_ID` durch die tatsächliche Dev-Projekt-ID ersetzen. Ein bereits
laufender Server übernimmt geänderte Variablen nicht; nach der Konfiguration
den Serverprozess neu starten. Für Hostinger dieselben Variablen in der
serverseitigen Runtime-Konfiguration setzen und den Produktions-Schlüssel
sicher bereitstellen, falls keyless ADC nicht unterstützt wird. Keine dieser
Variablen gehört in `VITE_*`-Konfigurationen oder Client-Bundles.

Ohne `GCS_BUCKET` bleibt der Upload-Service bewusst deaktiviert (siehe
Implementierungsplan, A8). Die Bucket-Prüfung läuft alle 5 Minuten erneut
beim ersten Upload.

## Schritt 8 – Verifikation (Abnahme-Check)

Am 2026-10-18 ausgeführt und nachgelesen: Produktions-CORS und beide
Bucket-Rollenbindungen. Bereits vorhanden: `EUROPE-WEST3`, Public Access
Prevention `enforced`, Uniform Bucket-Level Access und genau eine
180-Tage-Delete-Regel. Soft Delete war mit sieben Tagen aktiv und wurde nicht
geändert; gelöschte Objekte bleiben währenddessen wiederherstellbar.

Die tatsächlich ausgeführte abschließende Konfigurationsprüfung:

```sh
gcloud storage buckets describe gs://vega-eu-images \
  --format='yaml(name,location,cors_config,lifecycle_config,public_access_prevention,uniform_bucket_level_access,soft_delete_policy)'
```

Noch offen sind Credential-Bereitstellung, Zugriff aus dem Hostinger-App-Prozess
und vollständiger Browser-/Upload-Proof:

1. Server starten und Upload-Sitzung anfordern: keine
   503-Antwort `UNSAFE_BUCKET_CONFIGURATION`.
2. Kleines Test-JPEG (längste Kante ≤ 2000 px, ≤ 10 MB) über die
   Signed-POST-URL hochladen: Antwort `201`.
3. Objekt in der Konsole: liegt unter `customer-images/staging/` und ist
   **nicht öffentlich lesbar**.
4. Nach erfolgter Order-Zuordnung: Objekt wurde vom Server in den privaten
   finalen Pfad unter `customer-images/...` kopiert.
5. Lifecycle prüfen (Console oder `gsutil lifecycle`): genau eine
   Delete-Regel mit Age 180, keine weiteren Regeln.
6. Anonymen Zugriff testen: Download ohne Signatur muss fehlschlagen.
7. Werte des Checks in `proof-01-integration-compatibility.md`
   nachtragen (EU-GCS-Proof).

## Bezug zu anderen Dokumenten

- ADR 0006 (`adr/0006-gcs-und-bildlebenszyklus.md`): fachliche Entscheidung
  zu Speicherort, Lifecycle und Signed-URLs.
- `implementation-plan.md` § 4.7 und A8: Anforderungen an Bilder und
  Uploadanbahnung.
- `proof-01-integration-compatibility.md`: offener Provider-Proof
  (EU-GCS, CORS, Signed-URL-Verhalten).
