import { useEffect, useRef, useState } from "react";
import { Button, Grid, InputAdornment, Stack, TextField, Typography } from "@mui/material";
import { AdminAlert as Alert } from "../components/AdminNotifications.js";
import { AdminCard } from "../components/AdminCard.js";
import type { AppSettingsDto } from "@vega/domain";
import { apiRequest } from "../api/api-request.js";
import { PlaceAutocompleteField } from "../places/PlaceAutocompleteField.js";
import type { PlaceAddress } from "../places/usePlaceAutocomplete.js";

type SettingKey = Exclude<keyof AppSettingsDto, "revision">;
type SettingsDraft = Record<SettingKey, string>;
const groups: Array<{ title: string; fields: Array<{ key: SettingKey; label: string; type?: "number" | "url" | "email"; helper?: string }> }> = [
  { title: "Berechnungsoptionen", fields: [
    { key: "boxCbm", label: "Umzugskarton Volumen", type: "number", helper: "Volumen je Karton in m³; für Kundenrechner und serverseitige Auftragsberechnung." },
    { key: "kleiderboxCbm", label: "Kleiderbox Volumen", type: "number", helper: "Volumen je Kleiderbox in m³." },
  ] },
  { title: "Standort und Kundenformular", fields: [
    { key: "origin", label: "Standort", helper: "Betriebsadresse als Start und Ende der Fahrstrecke. Kein API-Host und keine CORS-Origin." },
    { key: "dataPrivacyUrl", label: "Datenschutz URL", type: "url", helper: "Ohne Datenschutzerklärung bleibt das Absenden des Kundenformulars gesperrt." },
    { key: "successUrl", label: "Erfolgs-URL", type: "url", helper: "Optional: Weiterleitung nach erfolgreicher Anfrage. Leer: interne Dankeseite." },
    { key: "boxCalculatorUrl", label: "Kartonrechner URL", type: "url", helper: "Optionaler Link im Möbel-/Volumenrechner." },
  ] },
  { title: "E-Mail", fields: [
    { key: "companyEmail", label: "Firmenempfänger", type: "email", helper: "Empfänger für Benachrichtigungen über neue Kundenanfragen." },
    { key: "emailFromName", label: "Absendername", helper: "Anzeigename beim Versand über die Hostinger-Mailbox." },
    { key: "emailFromAddress", label: "Absenderadresse", type: "email", helper: "Muss zur serverseitig konfigurierten Hostinger-Mailbox passen. Die API erlaubt keine beliebige Absenderadresse." },
  ] },
];
const keys = groups.flatMap((group) => group.fields.map((field) => field.key));
function toDraft(settings: AppSettingsDto): SettingsDraft {
  return Object.fromEntries(keys.map((key) => [key, settings[key] === null ? "" : String(settings[key])])) as SettingsDraft;
}

function formatSingleLineAddress(address: PlaceAddress): string {
  const locality = [address.postalCode, address.city].filter(Boolean).join(" ");
  return [address.street, locality].filter(Boolean).join(", ");
}

function OriginField({ value, disabled, error, helper, onInput, onCommit }: {
  value: string; disabled: boolean; error: string | undefined; helper: string | undefined;
  onInput: (value: string) => void; onCommit: (badInput: boolean) => void;
}) {
  return <PlaceAutocompleteField label="Standort" value={value} maxLength={300} disabled={disabled}
    error={error} helperText={helper} onInput={onInput} onBlur={onCommit}
    onSelect={(address) => {
      onInput(formatSingleLineAddress(address));
      onCommit(false);
    }} />;
}

export function OptionsPage() {
  const [saved, setSaved] = useState<AppSettingsDto | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [invoiceNext, setInvoiceNext] = useState<number | null>(null);
  const [invoiceDraft, setInvoiceDraft] = useState("");
  const [invoiceError, setInvoiceError] = useState("");
  const [invoiceMessage, setInvoiceMessage] = useState("");
  const settingsSaveInFlight = useRef(false);
  const settingsSavePending = useRef(false);
  const settingsBadInputPending = useRef(false);
  const savedRef = useRef(saved);
  const draftRef = useRef(draft);
  const invoiceNextRef = useRef(invoiceNext);
  const invoiceDraftRef = useRef(invoiceDraft);
  const invoiceSaveInFlight = useRef(false);
  const invoiceSavePending = useRef(false);
  savedRef.current = saved;
  draftRef.current = draft;
  invoiceNextRef.current = invoiceNext;
  invoiceDraftRef.current = invoiceDraft;
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    void apiRequest<AppSettingsDto>("/api/admin/settings").then((settings) => {
      if (active) {
        const nextDraft = toDraft(settings);
        savedRef.current = settings;
        draftRef.current = nextDraft;
        setSaved(settings); setDraft(nextDraft); setIssues({}); setMessage("");
      }
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "Einstellungen konnten nicht geladen werden."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    void apiRequest<{ nextValue: number }>("/api/admin/settings/invoice-number").then((sequence) => {
      if (active) {
        invoiceNextRef.current = sequence.nextValue;
        invoiceDraftRef.current = String(sequence.nextValue);
        setInvoiceNext(sequence.nextValue); setInvoiceDraft(String(sequence.nextValue)); setInvoiceError("");
      }
    }).catch((reason: unknown) => { if (active) setInvoiceError(reason instanceof Error ? reason.message : "Nummernkreis konnte nicht geladen werden."); });
    return () => { active = false; };
  }, []);
  function updateDraft(key: SettingKey, nextValue: string) {
    const current = draftRef.current;
    if (!current) return;
    const next = { ...current, [key]: nextValue };
    draftRef.current = next;
    setDraft(next);
    setError("");
  }
  async function saveOnBlur(hasBadInput = false) {
    settingsBadInputPending.current ||= hasBadInput;
    if (settingsSaveInFlight.current) {
      settingsSavePending.current = true;
      return;
    }
    settingsSaveInFlight.current = true;
    try {
      do {
        settingsSavePending.current = false;
        const hasPendingBadInput = settingsBadInputPending.current;
        settingsBadInputPending.current = false;
        const currentSaved = savedRef.current;
        const currentDraft = draftRef.current;
        if (!currentSaved || !currentDraft || keys.every((key) => currentDraft[key] === toDraft(currentSaved)[key])) continue;
        if (hasPendingBadInput) {
          setError("Bitte prüfen Sie die Zahlenfelder. Ungültige Zahlen werden nicht als leere Werte gespeichert.");
          continue;
        }
        if ((["boxCbm", "kleiderboxCbm"] as const).some((key) => currentDraft[key].trim() && !Number.isFinite(Number(currentDraft[key])))) {
          setError("Bitte geben Sie gültige Kartonvolumina ein.");
          continue;
        }
        const snapshot = { ...currentDraft };
        const payload = {
          revision: currentSaved.revision,
          ...Object.fromEntries(keys.map((key) => [key, snapshot[key].trim() === "" ? null
            : key === "boxCbm" || key === "kleiderboxCbm" ? Number(snapshot[key]) : snapshot[key].trim()])),
        };
        setError(""); setMessage(""); setIssues({});
        try {
          const response = await fetch("/api/admin/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(payload) });
          const result = await response.json() as { data?: AppSettingsDto; error?: { message?: string; issues?: Array<{ field: string; message: string }> } };
          if (!response.ok || !result.data) {
            setIssues(Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.field, issue.message])));
            throw new Error(result.error?.message ?? "Einstellungen konnten nicht gespeichert werden.");
          }
          savedRef.current = result.data;
          setSaved(result.data);
          if (keys.every((key) => draftRef.current?.[key] === snapshot[key])) {
            const nextDraft = toDraft(result.data);
            draftRef.current = nextDraft;
            setDraft(nextDraft);
          }
          setMessage("Einstellungen gespeichert.");
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "Der Server ist nicht erreichbar. Ihre Eingaben bleiben erhalten.");
        }
      } while (settingsSavePending.current);
    } finally {
      settingsSaveInFlight.current = false;
    }
  }
  async function saveInvoice() {
    if (invoiceSaveInFlight.current) {
      invoiceSavePending.current = true;
      return;
    }
    invoiceSaveInFlight.current = true;
    try {
      do {
        invoiceSavePending.current = false;
        const currentNext = invoiceNextRef.current;
        const snapshot = invoiceDraftRef.current;
        if (currentNext === null) continue;
        const nextValue = Number(snapshot);
        if (!Number.isSafeInteger(nextValue) || nextValue < 1) {
          setInvoiceError("Bitte geben Sie eine positive ganze Rechnungsnummer ein.");
          continue;
        }
        if (nextValue === currentNext) continue;
        setInvoiceError(""); setInvoiceMessage("");
        try {
          const sequence = await apiRequest<{ nextValue: number }>("/api/admin/settings/invoice-number", "PUT", { nextValue, expectedNextValue: currentNext });
          invoiceNextRef.current = sequence.nextValue;
          setInvoiceNext(sequence.nextValue);
          if (invoiceDraftRef.current === snapshot) {
            invoiceDraftRef.current = String(sequence.nextValue);
            setInvoiceDraft(String(sequence.nextValue));
          }
          setInvoiceMessage("Nummernkreis gespeichert.");
        } catch (reason) {
          setInvoiceError(reason instanceof Error ? reason.message : "Nummernkreis konnte nicht gespeichert werden.");
        }
      } while (invoiceSavePending.current);
    } finally {
      invoiceSaveInFlight.current = false;
    }
  }
  return <Stack spacing={3}>
    {error && <Alert severity="error">{error}</Alert>}
    {message && <Alert severity="success">{message}</Alert>}
    {loading && <Alert severity="info">Einstellungen werden geladen …</Alert>}
    <Stack spacing={2}>
      <Grid container spacing={2}>{groups.map((group) => <Grid key={group.title} size={{ xs: 12, lg: 6 }}>
        <AdminCard variant="outlined" sx={{ height: "100%" }}><Stack spacing={1.5}>
          <Typography component="h2" variant="h6">{group.title}</Typography>
          {group.fields.map((field) => field.key === "origin"
            ? <OriginField key={field.key} value={draft?.[field.key] ?? ""} disabled={loading || draft === null}
              error={issues[field.key]} helper={field.helper}
              onInput={(nextValue) => updateDraft(field.key, nextValue)}
              onCommit={(badInput) => void saveOnBlur(badInput)} />
            : <TextField key={field.key} label={field.label} type={field.type ?? "text"} fullWidth
            value={draft?.[field.key] ?? ""} disabled={loading || draft === null}
            error={Boolean(issues[field.key])} helperText={issues[field.key] ?? field.helper}
            onChange={(event) => updateDraft(field.key, event.target.value)}
            onBlur={(event) => void saveOnBlur(event.currentTarget.validity.badInput)}
            slotProps={field.type === "number" ? { htmlInput: { min: 0.0001, max: 10, step: 0.0001 }, input: { endAdornment: <InputAdornment position="end">m³</InputAdornment> } } : { htmlInput: { maxLength: field.type === "url" ? 2048 : field.key === "emailFromName" ? 191 : 254 } }}
          />)}
        </Stack></AdminCard>
      </Grid>)}
        <Grid size={{ xs: 12, lg: 6 }}>
          <AdminCard variant="outlined" sx={{ height: "100%" }}><Stack spacing={2}>
            <Typography component="h2" variant="h6">Rechnungsnummernkreis</Typography>
            <Typography color="text.secondary">Nächste automatisch vergebene Rechnungsnummer: {invoiceNext === null ? "noch nicht geladen" : `R-${invoiceNext}`}. Bestehende Rechnungen werden nicht umnummeriert.</Typography>
            {invoiceError && <Alert severity="error">{invoiceError}</Alert>}{invoiceMessage && <Alert severity="success">{invoiceMessage}</Alert>}
            <TextField label="Nächste Rechnungsnummer" type="number" value={invoiceDraft} disabled={invoiceNext === null}
              onChange={(event) => {
                invoiceDraftRef.current = event.target.value;
                setInvoiceDraft(event.target.value);
                setInvoiceError("");
              }}
              onBlur={() => void saveInvoice()}
              slotProps={{ htmlInput: { min: 1, step: 1 }, input: { startAdornment: <InputAdornment position="start">R-</InputAdornment> } }} />
            <Typography variant="body2" color="text.secondary">Ein eigener Gutschriftennummernkreis wird erst mit dem freigegebenen Gutschriftenmodul angebunden.</Typography>
          </Stack></AdminCard>
        </Grid>
      </Grid>
    </Stack>
  </Stack>;
}
