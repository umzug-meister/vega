import { useEffect, useRef, useState } from "react";
import { Box, Button, Chip, CircularProgress, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { ContentCopyOutlined, PlayArrowOutlined } from "@mui/icons-material";
import type { SetupInfoDto, SetupSmokeTestDto } from "@vega/domain";
import { apiRequest } from "../api/api-request.js";
import { AdminAlert, useAdminNotification } from "../components/AdminNotifications.js";

export function MaintenancePage() {
  const [info, setInfo] = useState<SetupInfoDto | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SetupSmokeTestDto | null>(null);
  const request = useRef<AbortController | null>(null);
  const notify = useAdminNotification();

  async function load(signal: AbortSignal) {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<SetupInfoDto>("/api/admin/maintenance", "GET", undefined, { signal });
      if (!signal.aborted) setInfo(data);
    } catch (reason) {
      if (!signal.aborted) setError(reason instanceof Error ? reason.message : "Maintenance konnte nicht geladen werden.");
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => { controller.abort(); request.current?.abort(); };
  }, []);

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      notify("success", "In die Zwischenablage kopiert.");
    } catch {
      setError("Kopieren nicht möglich. Bitte den Code oder die URL im Feld markieren und manuell kopieren.");
    }
  }

  async function smokeTest() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRunning(true);
    setResult(null);
    setError("");
    try {
      const data = await apiRequest<SetupSmokeTestDto>("/api/admin/maintenance/smoke-test", "POST", {}, { signal: controller.signal });
      if (!controller.signal.aborted) setResult(data);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Smoke-Test konnte nicht ausgeführt werden.");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  return (
    <Stack spacing={3}>
      {error && <AdminAlert severity="error">{error}</AdminAlert>}
      {loading && <Box role="status" aria-label="Maintenance wird geladen"><CircularProgress size={24} /></Box>}
      {!loading && !info && <Button onClick={() => { const controller = new AbortController(); void load(controller.signal); }}>Erneut laden</Button>}
      {info && <>
        <Paper sx={{ p: 1 }}>
          <Stack spacing={2}>
            <Typography variant="h3" component="h2">Kundenformular einbinden</Typography>
            <Typography color="text.secondary" sx={{ maxWidth: "75ch" }}>
              Diesen Code in einen „Individuelles HTML“-Block der WordPress-Seite einfügen.
              Das Formular erscheint direkt an dieser Stelle, ohne iframe.
            </Typography>
            <TextField label="Loader-URL" value={info.loaderUrl} fullWidth slotProps={{ input: { readOnly: true } }} />
            <Button startIcon={<ContentCopyOutlined />} onClick={() => void copy(info.loaderUrl)} sx={{ alignSelf: "flex-start" }}>Loader-URL kopieren</Button>
            <TextField label="WordPress-Einbettungscode" value={info.embedCode} multiline minRows={3} fullWidth
              slotProps={{ input: { readOnly: true, sx: { fontFamily: "monospace" } } }} />
            <Button variant="contained" startIcon={<ContentCopyOutlined />} onClick={() => void copy(info.embedCode)} sx={{ alignSelf: "flex-start" }}>Einbettungscode kopieren</Button>
            <Typography variant="body2" color="text.secondary">
              Die URL stammt aus der Server-Runtime (APP_BASE_URL), nicht aus der Browseradresse.
              Den WordPress-Origin in CORS_ALLOWED_ORIGINS freigeben und die Content Security Policy der Website prüfen.
            </Typography>
          </Stack>
        </Paper>
        <Paper sx={{ p: 1 }}>
          <Stack spacing={2}>
            <Typography variant="h3" component="h2">Smoke-Test</Typography>
            <Typography color="text.secondary" sx={{ maxWidth: "75ch" }}>
              Prüft Datenbank, Formular-Build und konfigurierte Provider mit echten Anfragen.
              Keine Testmail und keine Änderungen an Fachdaten. Google-Tests verwenden synthetische Eingaben; der Gemini-Test sendet einen kurzen Testprompt und kann bis zu 90 Sekunden dauern. Quota und Kosten können anfallen.
              Maximal zwei Tests pro Minute.
            </Typography>
            <Button variant="outlined" startIcon={running ? <CircularProgress size={18} /> : <PlayArrowOutlined />}
              disabled={running} onClick={() => void smokeTest()} sx={{ alignSelf: "flex-start" }}>
              {running ? "Prüfung läuft …" : "Smoke-Test starten"}
            </Button>
            <Box aria-live="polite" aria-busy={running}>
              {result && <Stack spacing={1.5}>
                <Typography variant="body2" color="text.secondary">Geprüft am {new Date(result.checkedAt).toLocaleString("de-DE")}</Typography>
                {result.checks.map((check) => <Box key={check.id} sx={{ borderBottom: 1, borderColor: "divider", pb: 1.5 }}>
                  <Stack direction="row" spacing={1} sx={{ mb: 0.5, alignItems: "center" }}>
                    <Chip size="small" variant="outlined" label={check.status === "ok" ? "Erfolgreich" : check.status === "error" ? "Fehlgeschlagen" : "Nicht geprüft"}
                      color={check.status === "ok" ? "success" : check.status === "error" ? "error" : "default"} />
                    <Typography sx={{ fontWeight: 600 }}>{check.label}</Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">{check.message}</Typography>
                </Box>)}
              </Stack>}
            </Box>
          </Stack>
        </Paper>
        <Paper sx={{ p: 1 }}>
          <Typography variant="h3" component="h2" sx={{ mb: 1 }}>Runtime-Konfiguration</Typography>
          <Typography color="text.secondary" sx={{ mb: 2, maxWidth: "75ch" }}>
            Nur der Status wird angezeigt, niemals geheime Werte. „Gesetzt“ bestätigt noch keinen funktionierenden Zugang.
            Optionale Integrationen benötigen ihre Variablen nur bei Nutzung. Nach Änderungen den Server neu starten und diese Seite neu laden.
          </Typography>
          <TableContainer>
            <Table size="small" aria-label="Runtime-Variablen">
              <TableHead><TableRow><TableCell>Variable / Bereich</TableCell><TableCell>Status</TableCell><TableCell>Benötigt für</TableCell></TableRow></TableHead>
              <TableBody>{info.variables.map((variable) => <TableRow key={variable.name}>
                <TableCell sx={{ overflowWrap: "anywhere" }}><Typography variant="body2" sx={{ fontWeight: 600 }}>{variable.name}</Typography><Typography variant="caption" color="text.secondary">{variable.group}</Typography></TableCell>
                <TableCell>
                  <Chip size="small" variant="outlined"
                    color={variable.requirement === "bootstrap" ? variable.status === "set" ? "warning" : "default" : variable.status === "missing" && variable.requirement === "required" ? "error" : variable.status === "set" ? "success" : "default"}
                    label={variable.requirement === "bootstrap" ? variable.status === "set" ? "Nach Seed entfernen" : "Nicht gesetzt" : variable.status === "set" ? "Gesetzt" : variable.status === "default" ? "Standard aktiv" : variable.requirement === "required" ? "Fehlt" : "Optional / nicht gesetzt"} />
                </TableCell>
                <TableCell sx={{ minWidth: 220 }}><Typography variant="body2">{variable.hint}</Typography></TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </>}
    </Stack>
  );
}
