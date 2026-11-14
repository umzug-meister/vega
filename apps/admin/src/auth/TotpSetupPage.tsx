import { useState, type FormEvent } from "react";
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { AdminAlert } from "../components/AdminNotifications.js";
import { QRCodeSVG } from "qrcode.react";
import { authClient } from "../auth-client.js";
import { AuthCard } from "./AuthCard.js";
import { downloadBackupCodesFile } from "./backup-codes-file.js";
import { PasswordField } from "./PasswordField.js";

interface TotpSetupPageProps {
  initialPassword?: string;
  /** Voluntary enrollment from the profile (Kundenberater); can be cancelled. */
  optional?: boolean;
  onCancel?: () => void;
  onComplete: () => void;
}

export function TotpSetupPage({ initialPassword, optional = false, onCancel, onComplete }: TotpSetupPageProps) {
  const [password, setPassword] = useState(initialPassword ?? "");
  const [totpURI, setTotpURI] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function beginSetup() {
    setError("");
    setBusy(true);
    try {
      const result = await authClient.twoFactor.enable({ password, method: "totp", issuer: "Vega" });
      if (result.error || !result.data || result.data.method !== "totp") {
        setError("Die TOTP-Einrichtung konnte nicht gestartet werden.");
        return;
      }
      setTotpURI(result.data.totpURI);
      setBackupCodes(result.data.backupCodes);
    } catch {
      setError("Die TOTP-Einrichtung konnte nicht gestartet werden.");
    } finally {
      setBusy(false);
    }
  }

  async function verifySetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = await authClient.twoFactor.verifyTotp({ code: code.trim(), trustDevice: false });
      if (result.error) {
        setError("Der Code ist ungültig oder abgelaufen. Prüfen Sie die Uhrzeit Ihres Geräts.");
        return;
      }
      if (backupCodes.length === 0) {
        setError("Die Wiederherstellungscodes konnten nicht geladen werden. Starten Sie die Einrichtung erneut.");
        return;
      }
      setCode("verified");
    } catch {
      setError("Die TOTP-Verifizierung ist fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  if (code === "verified") {
    return (
      <AuthCard>
        <Typography variant="overline" color="primary">{optional ? "Vega · Profil" : "Vega · Ersteinrichtung"}</Typography>
        <Typography component="h1" variant="h4">Wiederherstellungscodes sichern</Typography>
        <Alert severity="warning">Diese Codes werden nur einmal angezeigt. Bewahren Sie sie sicher und getrennt vom Gerät auf.</Alert>
        <Paper variant="outlined" sx={{ p: 1 }}>
          <Stack spacing={1}>
            {backupCodes.map((backupCode) => (
              <Typography key={backupCode} component="code" align="center">{backupCode}</Typography>
            ))}
          </Stack>
        </Paper>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => downloadBackupCodesFile(backupCodes)}>
          Als Textdatei herunterladen
        </Button>
        <Button variant="contained" size="large" onClick={onComplete}>{optional ? "Zurück zum Profil" : "Weiter zur Verwaltung"}</Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard>
      <Typography variant="overline" color="primary">{optional ? "Vega · Profil" : "Vega · Ersteinrichtung"}</Typography>
      <Typography component="h1" variant="h4">Authenticator einrichten</Typography>
      <Typography color="text.secondary">
        {optional
          ? "TOTP ist für Ihr Konto optional. Nach der Verifizierung wird bei jeder Anmeldung ein Code abgefragt."
          : "TOTP ist für Admin-Konten verpflichtend. Der normale Zugriff bleibt bis zur erfolgreichen Verifizierung gesperrt."}
      </Typography>
        {error && <AdminAlert severity="error">{error}</AdminAlert>}
      {!totpURI ? (
        <Stack spacing={2}>
          {!initialPassword && (
            <PasswordField
              autoComplete="current-password"
              label="Aktuelles Passwort"
              value={password}
              onChange={setPassword}
            />
          )}
          <Button variant="contained" size="large" onClick={beginSetup} disabled={busy || !password}>
            {busy ? <CircularProgress size={24} color="inherit" /> : "TOTP-Einrichtung starten"}
          </Button>
        </Stack>
      ) : (
        <Box component="form" onSubmit={verifySetup}>
          <Stack spacing={2} sx={{ alignItems: "center" }}>
            <Typography color="text.secondary" align="center">
              Scannen Sie den QR-Code mit Ihrer Authenticator-App. Er wird lokal im Browser erzeugt.
            </Typography>
            <Paper variant="outlined" sx={{ p: 1 }}>
              <QRCodeSVG value={totpURI} size={192} aria-label="TOTP-Einrichtungs-QR-Code" />
            </Paper>
            <TextField
              fullWidth
              autoFocus
              autoComplete="one-time-code"
              label="6-stelliger Bestätigungscode"
              inputMode="numeric"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              required
            />
            <Button type="submit" variant="contained" size="large" disabled={busy || code.length !== 6}>
              {busy ? <CircularProgress size={24} color="inherit" /> : "Authenticator verifizieren"}
            </Button>
          </Stack>
        </Box>
      )}
      {optional && onCancel && <Button onClick={onCancel} disabled={busy}>Abbrechen</Button>}
    </AuthCard>
  );
}
