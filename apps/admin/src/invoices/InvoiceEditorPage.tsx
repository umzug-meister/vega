import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Autocomplete,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { AdminAlert as Alert } from "../components/AdminNotifications.js";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import {
  addInvoiceAmounts,
  calculateInvoiceTotals,
  formatGermanDate,
  manualInvoiceNextValue,
  MAX_INVOICE_SEQUENCE_VALUE,
  roundAmountToCents,
  type CatalogPackingDto,
  type CatalogServiceDto,
  type AdminInvoiceDto,
  type AdminInvoiceOrderOverview,
  type InvoiceInput,
} from "@vega/domain";
import { PlaceAutocompleteField } from "../places/PlaceAutocompleteField.js";
import { InvoiceAccountingTabs } from "./InvoiceAccountingTabs.js";
import { apiRequest } from "../api/api-request.js";

const emptyInvoice = (): InvoiceInput => ({
  invoiceDate: new Date().toISOString().slice(0, 10),
  company: "",
  customerName: "",
  customerStreet: "",
  customerPostalCity: "",
  taxPercent: 19,
  text: "",
  entries: [],
  dueDates: [],
});
const invoiceCurrency = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});
const invoiceTextTemplates = {
  Bar: "Der Rechnungsbetrag in Höhe von {{sum}} wurde am {{paymentDate}} in Bar bezahlt.",
  Bank: "Der Rechnungsbetrag in Höhe von {{sum}} wurde am ?? per Überweisung bezahlt.",
  "Sofort fällig": "Die Zahlung ist sofort ohne Abzüge fällig.",
  "Bitte überweisen":
    "Bitte überweisen Sie den offenen Gesamtbetrag in Höhe von {{sum}} unter Angabe Ihrer Rechnungsnummer bis zum {{date}} (Zahlungseingang) auf unser Konto.",
  "Teil-Teil":
    "Der Teilbetrag in Höhe von ?? € wurde per Überweisung bezahlt.\nDer Teilbetrag in Höhe von ?? € wurde in Bar bezahlt.",
} as const;

interface InvoiceCatalogChoice {
  id: number;
  name: string;
  price: number;
  kind: "service" | "packaging";
}

export function invoiceEntriesFromOrder(
  overview: AdminInvoiceOrderOverview,
): InvoiceInput["entries"] {
  return overview.conditions.map((condition, index) => ({
    description:
      index === 0 && condition.description.includes("Träger")
        ? `Umzug am ${formatGermanDate(overview.movingDate)}`
        : condition.description,
    quantity: 1,
    unitPrice: condition.amount,
  }));
}

export function initializeInvoiceNumber(
  input: InvoiceInput,
  invoiceNumber: string | undefined,
): InvoiceInput {
  return input.invoiceNumber?.trim() || !invoiceNumber
    ? input
    : { ...input, invoiceNumber };
}

export function InvoiceNumberField({
  invoiceNumber,
  nextValue,
  editing,
  onChange,
}: {
  invoiceNumber?: string | undefined;
  nextValue?: number | undefined;
  editing: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const manualNumber = invoiceNumber?.trim().slice(0, 64);
  const manualNext = manualInvoiceNextValue(manualNumber);
  const invalid =
    !editing &&
    manualNext !== undefined &&
    (!Number.isSafeInteger(manualNext) ||
      manualNext > MAX_INVOICE_SEQUENCE_VALUE);
  return (
    <TextField
      label="Rechnungsnummer"
      value={invoiceNumber ?? ""}
      placeholder={
        !editing && nextValue !== undefined ? `R-${nextValue}` : undefined
      }
      onChange={(e) => onChange(e.target.value || undefined)}
      error={invalid}
    />
  );
}

export function InvoiceTaxField({
  taxPercent,
  onChange,
}: {
  taxPercent: number;
  onChange: (value: number) => void;
}) {
  const valid = taxPercent === 19 || taxPercent === 0;
  return (
    <TextField
      label="Umsatzsteuer (%)"
      select
      required
      error={!valid}
      value={valid ? taxPercent : ""}
      onChange={(e) => onChange(Number(e.target.value))}
      slotProps={{ select: { native: true } }}
    >
      {!valid && (
        <option value="" disabled>
          Bitte wählen
        </option>
      )}
      <option value={19}>19 %</option>
      <option value={0}>0 %</option>
    </TextField>
  );
}

export function InvoiceStreetField({
  street,
  onStreet,
  onSelect,
}: {
  street: string;
  onStreet: (value: string) => void;
  onSelect: (street: string, postalCity: string) => void;
}) {
  return (
    <PlaceAutocompleteField
      label="Straße, Nr."
      value={street}
      maxLength={191}
      onInput={onStreet}
      onSelect={(address) =>
        onSelect(
          address.street,
          [address.postalCode, address.city].filter(Boolean).join(" "),
        )
      }
    />
  );
}

export function InvoiceEditorPage({
  id,
  orderNumber,
  navigate,
  onBusyChange,
  onDirtyChange,
  onInvoiceDirtyChange,
  onAccountingDirtyChange,
  onInvoiceNumberChange,
}: {
  id?: string;
  orderNumber?: number;
  navigate: (path: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onInvoiceDirtyChange?: (dirty: boolean) => void;
  onAccountingDirtyChange?: (dirty: boolean) => void;
  onInvoiceNumberChange?: (invoiceNumber: string | undefined) => void;
}) {
  const [value, setValue] = useState<InvoiceInput>(emptyInvoice);
  const [busy, setBusy] = useState(
    id !== undefined || orderNumber !== undefined,
  );
  const [dirty, setDirty] = useState(!id);
  const [accountingDirty, setAccountingDirty] = useState(false);
  const [accountingBusy, setAccountingBusy] = useState(false);
  const [revision, setRevision] = useState<number>();
  const saving = useRef(false);
  const [loading, setLoading] = useState(
    id !== undefined || orderNumber !== undefined,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [nextValue, setNextValue] = useState<number>();
  const [orderOverview, setOrderOverview] =
    useState<AdminInvoiceOrderOverview>();
  const [catalogChoices, setCatalogChoices] = useState<InvoiceCatalogChoice[]>(
    [],
  );
  const [catalogError, setCatalogError] = useState("");
  const [numberLoading, setNumberLoading] = useState(!id);
  useEffect(() => {
    onBusyChange?.(
      busy || loading || numberLoading || loadFailed || accountingBusy,
    );
  }, [busy, loading, numberLoading, loadFailed, accountingBusy, onBusyChange]);
  useEffect(() => {
    onDirtyChange?.(dirty || accountingDirty);
  }, [dirty, accountingDirty, onDirtyChange]);
  useEffect(() => {
    onInvoiceDirtyChange?.(dirty);
  }, [dirty, onInvoiceDirtyChange]);
  useEffect(() => {
    onAccountingDirtyChange?.(accountingDirty);
  }, [accountingDirty, onAccountingDirtyChange]);
  useEffect(() => {
    onInvoiceNumberChange?.(value.invoiceNumber);
  }, [onInvoiceNumberChange, value.invoiceNumber]);
  useEffect(() => {
    if (id) return;
    let cancelled = false;
    setNumberLoading(true);
    setNextValue(undefined);
    void fetch("/api/admin/invoices/next-number", {
      credentials: "same-origin",
    })
      .then(async (response) => ({
        response,
        body: (await response.json()) as {
          data?: { nextValue?: number };
          error?: { message?: string };
        },
      }))
      .then(({ response, body }) => {
        if (cancelled) return;
        const number = body.data?.nextValue;
        if (
          !response.ok ||
          typeof number !== "number" ||
          !Number.isSafeInteger(number) ||
          number < 1 ||
          number > MAX_INVOICE_SEQUENCE_VALUE
        ) {
          setError(
            body.error?.message ??
              "Rechnungsnummer konnte nicht geladen werden.",
          );
          setLoadFailed(true);
        } else {
          setNextValue(number);
          setValue((current) =>
            initializeInvoiceNumber(current, `R-${number}`),
          );
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Rechnungsnummer konnte nicht geladen werden.");
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setNumberLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, orderNumber]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiRequest<CatalogPackingDto[]>("/api/admin/catalog/packings"),
      apiRequest<CatalogServiceDto[]>("/api/admin/catalog/services"),
    ])
      .then(([packings, services]) => {
        if (!cancelled) {
          setCatalogChoices([
            ...packings.map(({ id: itemId, name, price }) => ({
              id: itemId,
              name,
              price,
              kind: "packaging" as const,
            })),
            ...services.map(({ id: itemId, name, price }) => ({
              id: itemId,
              name,
              price,
              kind: "service" as const,
            })),
          ]);
        }
      })
      .catch(() => {
        if (!cancelled)
          setCatalogError("Katalogvorschläge konnten nicht geladen werden.");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!id && orderNumber === undefined) return;
    let cancelled = false;
    const path = id
      ? `/api/admin/invoices/${id}`
      : `/api/admin/invoices/from-order/${orderNumber}`;
    void fetch(path, { credentials: "same-origin" })
      .then(async (response) => ({
        response,
        body: (await response.json()) as {
          data?: InvoiceInput & {
            revision?: number;
            archivedAt?: string | null;
            orderOverview?: AdminInvoiceOrderOverview;
          };
          error?: { message?: string };
        },
      }))
      .then(({ response, body }) => {
        if (cancelled) return;
        if (!response.ok || !body.data) {
          setError(
            body.error?.message ?? "Rechnung konnte nicht geladen werden.",
          );
          setLoadFailed(true);
        } else {
          const { orderOverview: loadedOverview, ...loaded } = body.data;
          if (loaded.archivedAt) {
            navigate("/invoices/archived");
            return;
          }
          setOrderOverview(loadedOverview);
          setValue((current) => {
            if (id) return loaded;
            const initialized = initializeInvoiceNumber(
              loaded,
              current.invoiceNumber,
            );
            return loadedOverview && initialized.entries.length === 0
              ? {
                  ...initialized,
                  entries: invoiceEntriesFromOrder(loadedOverview),
                }
              : initialized;
          });
          if (id) setRevision(loaded.revision);
          if (id) setDirty(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Rechnung konnte nicht geladen werden.");
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, navigate, orderNumber]);
  function change<K extends keyof InvoiceInput>(key: K, next: InvoiceInput[K]) {
    setValue((current) => ({ ...current, [key]: next }));
    setDirty(true);
    setSuccess("");
  }
  function updateEntry(
    index: number,
    patch: Partial<InvoiceInput["entries"][number]>,
  ) {
    change(
      "entries",
      value.entries.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry,
      ),
    );
  }
  function removeEntry(index: number) {
    change(
      "entries",
      value.entries.filter((_, entryIndex) => entryIndex !== index),
    );
  }
  function addEntry() {
    change("entries", [
      ...value.entries,
      { description: "", quantity: 1, unitPrice: 0 },
    ]);
  }
  function applyInvoiceTextTemplate(template: string) {
    const sum = calculateInvoiceTotals(value.entries, value.taxPercent).total;
    const paymentDate = orderOverview?.movingDate
      ? formatMovingDate(orderOverview.movingDate)
      : "??";
    const dueDate = value.dueDates[0]?.date
      ? formatMovingDate(value.dueDates[0].date)
      : "??";
    const text = template
      .replaceAll("{{sum}}", invoiceCurrency.format(sum))
      .replaceAll("{{paymentDate}}", paymentDate)
      .replaceAll("{{date}}", dueDate);
    change("text", text);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      saving.current ||
      busy ||
      accountingBusy ||
      loading ||
      numberLoading ||
      loadFailed ||
      (id ? !dirty : nextValue === undefined)
    )
      return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const path = id
        ? `/api/admin/invoices/${id}`
        : orderNumber !== undefined
          ? `/api/admin/invoices/from-order/${orderNumber}`
          : "/api/admin/invoices";
      const response = await fetch(path, {
        method: id ? "PUT" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { ...value, revision } : value),
      });
      const body = (await response.json()) as {
        data?: AdminInvoiceDto;
        error?: { message?: string };
      };
      if (!response.ok || !body.data) {
        setError(
          body.error?.message ?? "Rechnung konnte nicht gespeichert werden.",
        );
        return;
      }
      setValue(body.data);
      setRevision(body.data.revision);
      setDirty(false);
      onInvoiceDirtyChange?.(false);
      onDirtyChange?.(accountingDirty);
      if (!id) navigate(`/invoices/${body.data.id}`);
      else setSuccess("Rechnung gespeichert.");
    } catch {
      setError("Rechnung konnte nicht gespeichert werden.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function renderCustomerFields() {
    return (
      <Stack spacing={1.5}>
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={1.5}>
            <Typography component="h2" variant="h6">
              Rechnungsdaten
            </Typography>
            <TextField
              label="Firma"
              value={value.company}
              onChange={(e) => change("company", e.target.value)}
            />
            <TextField
              label="Kunde"
              required
              value={value.customerName}
              onChange={(e) => change("customerName", e.target.value)}
            />
            <InvoiceStreetField
              street={value.customerStreet}
              onStreet={(customerStreet) =>
                change("customerStreet", customerStreet)
              }
              onSelect={(customerStreet, customerPostalCity) => {
                change("customerStreet", customerStreet);
                change("customerPostalCity", customerPostalCity);
              }}
            />
            <TextField
              label="PLZ, Ort"
              value={value.customerPostalCity}
              onChange={(e) => change("customerPostalCity", e.target.value)}
            />
            <TextField
              label="Rechnungsdatum"
              type="date"
              required
              value={value.invoiceDate}
              onChange={(e) => change("invoiceDate", e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <InvoiceNumberField
              invoiceNumber={value.invoiceNumber}
              nextValue={nextValue}
              editing={!!id}
              onChange={(number) => change("invoiceNumber", number)}
            />
            <InvoiceTaxField
              taxPercent={value.taxPercent}
              onChange={(percent) => change("taxPercent", percent)}
            />
          </Stack>
        </Paper>
      </Stack>
    );
  }
  function renderEntries() {
    const totals = calculateInvoiceTotals(value.entries, value.taxPercent);
    return (
      <>
        <Typography variant="h6">Positionen</Typography>
        {catalogError && <Alert severity="warning">{catalogError}</Alert>}
        {value.entries.map((entry, index) => (
          <Stack
            key={index}
            direction={{ xs: "column", md: "row" }}
            spacing={1}
            sx={{ alignItems: { xs: "stretch", md: "center" } }}
          >
            <Autocomplete<InvoiceCatalogChoice, false, false, true>
              freeSolo
              fullWidth
              sx={{ flex: 2, minWidth: 0 }}
              options={catalogChoices}
              value={entry.description}
              inputValue={entry.description}
              getOptionLabel={(option) =>
                typeof option === "string" ? option : option.name
              }
              isOptionEqualToValue={(option, selected) =>
                typeof selected !== "string" && option.id === selected.id
              }
              getOptionKey={(option) =>
                typeof option === "string"
                  ? option
                  : `${option.kind}-${option.id}`
              }
              onInputChange={(_, input, reason) => {
                if (reason === "input" || reason === "clear")
                  updateEntry(index, { description: input });
              }}
              onChange={(_, selected) => {
                if (typeof selected === "string")
                  updateEntry(index, { description: selected });
                else if (selected)
                  updateEntry(index, {
                    description: selected.name,
                    unitPrice: selected.price,
                  });
              }}
              renderInput={(params) => (
                <TextField {...params} label="Beschreibung" fullWidth />
              )}
            />
            <TextField
              label="Menge"
              fullWidth
              sx={{
                width: { xs: "100%", md: "6rem" },
                flex: { md: "0 0 6rem" },
                minWidth: 0,
              }}
              type="number"
              value={entry.quantity}
              onChange={(e) =>
                updateEntry(index, { quantity: Number(e.target.value) })
              }
            />
            <TextField
              label="Einzelpreis"
              fullWidth
              sx={{
                width: { xs: "100%", md: "9rem" },
                flex: { md: "0 0 9rem" },
                minWidth: 0,
              }}
              type="number"
              value={entry.unitPrice}
              onChange={(e) =>
                updateEntry(index, { unitPrice: Number(e.target.value) })
              }
            />
            <IconButton
              aria-label="Position entfernen"
              onClick={() => removeEntry(index)}
            >
              <DeleteOutlined />
            </IconButton>
          </Stack>
        ))}
        <Button onClick={addEntry} sx={{ alignSelf: "flex-end" }}>
          Position hinzufügen
        </Button>
        <Stack
          spacing={0.25}
          sx={{ alignSelf: "flex-end", alignItems: "flex-end" }}
          aria-label="Rechnungssumme"
        >
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            Gesamtbetrag (Brutto): {invoiceCurrency.format(totals.total)}
          </Typography>
          <Typography variant="body2">
            Umsatzsteuer ({value.taxPercent}%):{" "}
            {invoiceCurrency.format(totals.tax)}
          </Typography>
          <Typography variant="body2">
            Nettobetrag: {invoiceCurrency.format(totals.net)}
          </Typography>
        </Stack>
      </>
    );
  }
  function renderFormFields() {
    return (
      <>
        {renderCustomerFields()}
        {renderEntries()}
        <Stack spacing={1}>
          <Typography variant="h6">Rechnungstext</Typography>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: "wrap" }}
          >
            {Object.entries(invoiceTextTemplates).map(([label, template]) => (
              <Chip
                key={label}
                label={label}
                onClick={() => applyInvoiceTextTemplate(template)}
              />
            ))}
          </Stack>
          <TextField
            label="Rechnungstext"
            multiline
            minRows={4}
            value={value.text}
            onChange={(e) => change("text", e.target.value)}
          />
        </Stack>
      </>
    );
  }
  const form = (
    <Paper
      id="invoice-editor-form"
      component="form"
      onSubmit={submit}
      variant="outlined"
      sx={{
        width:
          orderNumber === undefined ? { xs: "100%", lg: "66.6667%" } : "100%",
        mx: orderNumber === undefined ? "auto" : 0,
        p: { xs: 2, sm: 3 },
      }}
    >
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        {success && <Alert severity="success">{success}</Alert>}
        {loading || numberLoading ? (
          <CircularProgress />
        ) : (
          <fieldset
            disabled={busy || accountingBusy || loadFailed}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <Stack spacing={2}>{renderFormFields()}</Stack>
          </fieldset>
        )}
      </Stack>
    </Paper>
  );
  if (!id && orderNumber !== undefined) {
    const total = orderOverview
      ? roundAmountToCents(
          addInvoiceAmounts(
            orderOverview.conditions.map(({ amount }) => amount),
          ),
        )
      : 0;
    return (
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            lg: "minmax(0, 2fr) minmax(280px, 1fr)",
          },
          gap: 2,
          alignItems: "start",
        }}
      >
        {form}
        <Paper
          component="aside"
          variant="outlined"
          aria-label={`Übersicht Auftrag ${orderNumber}`}
          sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}
        >
          <Stack spacing={1.5}>
            <Typography component="h2" variant="h6">
              Auftrag {orderNumber}
            </Typography>
            {loading ? (
              <CircularProgress size={24} />
            ) : orderOverview ? (
              <>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    Umzugsdatum
                  </Typography>
                  <Typography>
                    {formatMovingDate(orderOverview.movingDate)}
                  </Typography>
                </Box>
                <Divider />
                <Typography variant="subtitle2">Positionen</Typography>
                {orderOverview.conditions.length > 0 ? (
                  orderOverview.conditions.map((condition, index) => (
                    <Stack
                      key={`${condition.description}-${index}`}
                      direction="row"
                      spacing={1}
                      sx={{ justifyContent: "space-between" }}
                    >
                      <Typography
                        variant="body2"
                        sx={{ minWidth: 0, overflowWrap: "anywhere" }}
                      >
                        {condition.description}
                      </Typography>
                      <Typography variant="body2" sx={{ whiteSpace: "nowrap" }}>
                        {invoiceCurrency.format(condition.amount)}
                      </Typography>
                    </Stack>
                  ))
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Keine Positionen hinterlegt.
                  </Typography>
                )}
                <Divider />
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ justifyContent: "space-between" }}
                >
                  <Typography sx={{ fontWeight: 600 }}>Gesamt</Typography>
                  <Typography sx={{ fontWeight: 600 }}>
                    {invoiceCurrency.format(total)}
                  </Typography>
                </Stack>
              </>
            ) : (
              <Typography color="text.secondary">
                Auftragsübersicht nicht verfügbar.
              </Typography>
            )}
          </Stack>
        </Paper>
      </Box>
    );
  }
  if (!id || loading || loadFailed) return form;
  return (
    <InvoiceAccountingTabs
      key={id}
      invoiceId={id}
      disabled={busy}
      invoiceDirty={dirty}
      invoiceForm={form}
      onDirtyChange={setAccountingDirty}
      onBusyChange={setAccountingBusy}
    />
  );
}

function formatMovingDate(value: string): string {
  return value
    ? new Date(`${value}T00:00:00`).toLocaleDateString("de-DE")
    : "—";
}
