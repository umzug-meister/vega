import { useEffect, useState } from "react";
import { Grid, Stack, TextField, Typography } from "@mui/material";
import { AdminAlert as Alert } from "../components/AdminNotifications.js";
import { AdminCard } from "../components/AdminCard.js";
import type { CatalogServiceRateDto, ServiceRateKey } from "@vega/domain";
import { apiRequest } from "../api/api-request.js";

const rateGroups: Array<{ title: string; fields: Array<{ key: ServiceRateKey; label: string }> }> = [
  {
    title: "AGB",
    fields: [
      { key: "aBettDeMon", label: "Bett Abbau" },
      { key: "aBoxPack", label: "Karton zusätzlich ein-/auspacken" },
      { key: "acbm", label: "Je zusätzliche m³" },
      { key: "aetage", label: "Je zusätzliche Etage" },
      { key: "akitmon", label: "Küche Abbau je Meter" },
      { key: "ameter", label: "Je zusätzliche 10 Meter Laufweg" },
      { key: "awardmon", label: "Schrank Ab- und Aufbau je Meter" },
      { key: "disposalBasicPrice", label: "Abfallabfuhr-Pauschale" },
      { key: "disposalCbmPrice", label: "Preis je m³ Abfall" },
    ],
  },
  {
    title: "Konfigurator",
    fields: [
      { key: "kmPrice", label: "Kilometerpreis" },
      { key: "hvzPrice", label: "Halteverbotszone" },
    ],
  },
];

export function ServiceRatesEditor() {
  const [values, setValues] = useState<Partial<Record<ServiceRateKey, string>>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<ServiceRateKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savedValues, setSavedValues] = useState<Partial<Record<ServiceRateKey, string>>>({});

  useEffect(() => {
    let active = true;
    apiRequest<CatalogServiceRateDto[]>("/api/admin/catalog/service-rates")
      .then((rates) => {
        if (active) {
          const next = Object.fromEntries(rates.map((rate) => [rate.key, String(rate.price)]));
          setValues(next); setSavedValues(next);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Preise konnten nicht geladen werden.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save(key: ServiceRateKey) {
    if (values[key] === savedValues[key]) return;
    if (!values[key]?.trim()) { setError("Ein leerer Preis wird nicht als 0 gespeichert. Bitte geben Sie den Preis ausdrücklich ein."); return; }
    const price = Number(values[key]);
    setSavingKey(key);
    setError(null);
    setMessage(null);
    try {
      const saved = await apiRequest<CatalogServiceRateDto>(`/api/admin/catalog/service-rates/${key}`, "PUT", { price });
      setValues((current) => ({ ...current, [key]: String(saved.price) }));
      setSavedValues((current) => ({ ...current, [key]: String(saved.price) }));
      setMessage("Preis gespeichert.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Der Preis konnte nicht gespeichert werden.");
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <Stack spacing={2}>
      {error && <Alert severity="error">{error}</Alert>}
      {message && <Alert severity="success">{message}</Alert>}
      {rateGroups.map((group) => (
        <AdminCard key={group.title} variant="outlined">
          <Stack spacing={1.5}>
            <Typography component="h3" variant="h6">{group.title}</Typography>
            <Grid container spacing={1.5}>
              {group.fields.map(({ key, label }) => (
                <Grid key={key} size={{ xs: 12, md: 6, xl: 4 }}>
                  <TextField
                    fullWidth
                    type="number"
                    label={label}
                    value={values[key] ?? ""}
                    disabled={loading || savingKey === key}
                    onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
                    onBlur={() => void save(key)}
                    slotProps={{ htmlInput: { min: 0, step: "0.01" }, input: { endAdornment: "€" } }}
                  />
                </Grid>
              ))}
            </Grid>
          </Stack>
        </AdminCard>
      ))}
    </Stack>
  );
}
