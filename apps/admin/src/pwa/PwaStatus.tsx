import { Alert, Box, Button, Stack } from "@mui/material";
import { useEffect, useRef, useState } from "react";

export function PwaStatus({ enabled = import.meta.env?.PROD }: { enabled?: boolean }) {
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);
  const cleanupUpdate = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupUpdate.current?.(), []);

  useEffect(() => {
    const updateConnection = () => setOffline(!navigator.onLine);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  useEffect(() => {
    if (!enabled || !("serviceWorker" in navigator)) return;
    let active = true;
    let current: ServiceWorkerRegistration | undefined;
    const installing = new Set<ServiceWorker>();
    const checkWaiting = () => {
      if (active && current?.waiting && navigator.serviceWorker.controller) setUpdateReady(true);
    };
    const stateChanged = () => checkWaiting();
    const updateFound = () => {
      const worker = current?.installing;
      if (!worker) return;
      installing.add(worker);
      worker.addEventListener("statechange", stateChanged);
    };
    const checkForUpdate = () => {
      if (current && navigator.onLine) {
        void current.update().catch(() => {
          if (active) setError("Die Prüfung auf eine neue App-Version ist fehlgeschlagen.");
        });
      }
    };
    void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((result) => {
        if (!active) return;
        current = result;
        setRegistration(result);
        result.addEventListener("updatefound", updateFound);
        updateFound();
        checkWaiting();
      })
      .catch(() => {
        if (active) setError("Die App konnte den Service Worker nicht registrieren. Die normale Webnutzung bleibt möglich.");
      });
    const timer = window.setInterval(checkForUpdate, 60 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(timer);
      current?.removeEventListener("updatefound", updateFound);
      for (const worker of installing) worker.removeEventListener("statechange", stateChanged);
    };
  }, [enabled]);

  function activateUpdate() {
    const worker = registration?.waiting;
    if (!worker) {
      setError("Die neue Version ist nicht mehr verfügbar. Bitte laden Sie die Seite bei Gelegenheit neu.");
      setUpdateReady(false);
      return;
    }
    if (!window.confirm("Die Seite wird neu geladen. Bitte speichern Sie vorher alle Eingaben, auch in anderen geöffneten Vega-Tabs. Jetzt aktualisieren?")) return;
    setUpdating(true);
    let timer: number;
    const changed = () => {
      cleanupUpdate.current?.();
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", changed, { once: true });
    timer = window.setTimeout(() => {
      cleanupUpdate.current?.();
      setUpdating(false);
      setError("Die neue Version konnte nicht aktiviert werden. Bitte versuchen Sie es erneut.");
    }, 10_000);
    cleanupUpdate.current = () => {
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      cleanupUpdate.current = null;
    };
    worker.postMessage({ type: "ACTIVATE_UPDATE" });
  }

  if (!offline && !updateReady && !error) return null;
  return (
    <Box sx={{ position: "fixed", zIndex: (theme) => theme.zIndex.snackbar + 1, top: 8, right: 8, width: 440, maxWidth: "calc(100vw - 16px)" }}>
      <Stack spacing={1} aria-live="polite">
        {offline && <Alert severity="warning">Keine Internetverbindung. Änderungen können nicht gespeichert werden; es erfolgt kein automatischer Neuversand.</Alert>}
        {updateReady && <Alert severity="info" action={<Button color="inherit" size="small" disabled={updating} onClick={activateUpdate}>Aktualisieren</Button>}>Eine neue Vega-Version ist verfügbar.</Alert>}
        {error && <Alert severity="warning" onClose={() => setError("")}>{error}</Alert>}
      </Stack>
    </Box>
  );
}
