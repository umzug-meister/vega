import { AddOutlined, DeleteOutlined } from "@mui/icons-material";
import {
  GroupsOutlined,
  LocalShippingOutlined,
  ScheduleOutlined,
} from "@mui/icons-material";
import {
  Autocomplete,
  Alert,
  Box,
  Button,
  Grid,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import {
  addInvoiceAmounts,
  roundAmountToCents,
  type CatalogPackingDto,
  type CatalogServiceDto,
  type OrderConditionInput,
  type OrderDetailsInput,
} from "@vega/domain";
import { useEffect, useState } from "react";
import { apiRequest } from "../api/api-request.js";
import type { OrderFormValue } from "./order-form-types.js";

interface ConditionCatalogChoice {
  id: number;
  name: string;
  price: number;
  kind: "service" | "packaging";
}

interface ConditionsTabProps {
  value: OrderFormValue;
  onConditionsChange: (conditions: OrderDetailsInput["conditions"]) => void;
  onCalculate: () => void;
}

type ConditionEditPatch = Omit<
  Partial<OrderConditionInput>,
  "quantity" | "unitPrice"
> & {
  quantity?: number | undefined;
  unitPrice?: number | undefined;
};

export function hasPricingInputsChanged(value: OrderFormValue): boolean {
  const snapshot = value.pricingSnapshot;
  if (!snapshot) return false;
  const { basis, extras } = value.details;
  const currentSource = {
    offerId: basis.offerId ?? null,
    workers: basis.workers,
    trucks: basis.trucks,
    hours: basis.hours,
    basePrice: basis.basePrice,
    extraHourPrice: basis.extraHourPrice,
    discountPercent: basis.discountPercent,
    distanceKm: value.details.distanceKm,
    ...(value.details.distanceSource
      ? { distanceSource: value.details.distanceSource }
      : {}),
    addresses: [
      value.from,
      value.to,
      ...(value.details.showSecondaryFrom && value.details.secondaryFrom
        ? [value.details.secondaryFrom]
        : []),
      ...(value.details.showSecondaryTo && value.details.secondaryTo
        ? [value.details.secondaryTo]
        : []),
    ].map(({ city, parkingSlot }) => ({
      city,
      parkingSlot: parkingSlot === true,
    })),
    services: extras.services.map(
      ({ kind, catalogId, quantity, unitPrice }, index) => ({
        kind,
        catalogId: catalogId ?? null,
        quantity,
        ...(unitPrice !== undefined ||
        snapshot.source.services[index]?.unitPrice !== undefined
          ? { unitPrice: unitPrice ?? null }
          : {}),
      }),
    ),
  };
  return JSON.stringify(snapshot.source) !== JSON.stringify(currentSource);
}

export function calculateConditionAmount(
  quantity: number | undefined,
  unitPrice: number | undefined,
): number | undefined {
  return quantity === undefined || unitPrice === undefined
    ? undefined
    : roundAmountToCents(quantity * unitPrice);
}

export function mergeCalculatedConditions(
  calculated: OrderConditionInput[],
  existing: OrderConditionInput[],
): OrderConditionInput[] {
  return [
    ...calculated,
    ...existing.filter((condition) => condition.kind === "manual"),
  ];
}

export function ConditionsTab({
  value,
  onConditionsChange,
  onCalculate,
}: ConditionsTabProps) {
  const [catalogChoices, setCatalogChoices] = useState<
    ConditionCatalogChoice[]
  >([]);
  const [catalogError, setCatalogError] = useState(false);
  const { basis, conditions } = value.details;
  const grossTotal = roundAmountToCents(
    addInvoiceAmounts(conditions.map((item) => item.amount)),
  );
  const netTotal = roundAmountToCents(grossTotal / 1.19);
  const vatTotal = roundAmountToCents(grossTotal - netTotal);

  useEffect(() => {
    let active = true;
    void Promise.all([
      apiRequest<CatalogPackingDto[]>("/api/admin/catalog/packings"),
      apiRequest<CatalogServiceDto[]>("/api/admin/catalog/services"),
    ])
      .then(([packings, services]) => {
        if (active)
          setCatalogChoices([
            ...packings.map(({ id, name, price }) => ({
              id,
              name,
              price,
              kind: "packaging" as const,
            })),
            ...services.map(({ id, name, price }) => ({
              id,
              name,
              price,
              kind: "service" as const,
            })),
          ]);
      })
      .catch(() => {
        if (active) setCatalogError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  function updateEntry(index: number, patch: ConditionEditPatch) {
    onConditionsChange(
      conditions.map((entry, entryIndex) => {
        if (entryIndex !== index) return entry;
        const next = { ...entry, ...patch };
        if ("quantity" in patch && patch.quantity === undefined)
          delete next.quantity;
        if ("unitPrice" in patch && patch.unitPrice === undefined)
          delete next.unitPrice;
        return next as OrderConditionInput;
      }),
    );
  }

  function updateQuantity(index: number, raw: string) {
    const entry = conditions[index]!;
    const quantity = raw === "" ? undefined : Number(raw);
    const amount =
      calculateConditionAmount(quantity, entry.unitPrice) ?? entry.amount;
    updateEntry(index, { quantity, amount });
  }

  function updateUnitPrice(index: number, raw: string) {
    const entry = conditions[index]!;
    const unitPrice = raw === "" ? undefined : Number(raw);
    const amount =
      calculateConditionAmount(entry.quantity, unitPrice) ?? entry.amount;
    updateEntry(index, { unitPrice, amount });
  }

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "minmax(0, 1fr)",
          md: "minmax(0, 1.3fr) minmax(0, 4.7fr)",
        },
        gap: 2,
        alignItems: "start",
      }}
    >
      <Paper variant="outlined" sx={{ p: 2.5, minWidth: 0 }}>
        <Stack spacing={1.5}>
          <Typography component="h2" variant="h6">
            Angebotsbasis
          </Typography>
          <Table size="small" aria-label="Angebotsbasis">
            <TableBody>
              <TableRow>
                <TableCell
                  align="center"
                  sx={{ width: 40, py: 0.75, pl: 0, verticalAlign: "middle" }}
                >
                  <GroupsOutlined
                    fontSize="small"
                    color="action"
                    aria-hidden="true"
                  />
                </TableCell>
                <TableCell
                  component="th"
                  scope="row"
                  sx={{ py: 0.75, pl: 0.5 }}
                >
                  Träger
                </TableCell>
                <TableCell align="right" sx={{ py: 0.75, pr: 0 }}>
                  {basis.workers}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell
                  align="center"
                  sx={{ width: 40, py: 0.75, pl: 0, verticalAlign: "middle" }}
                >
                  <LocalShippingOutlined
                    fontSize="small"
                    color="action"
                    aria-hidden="true"
                  />
                </TableCell>
                <TableCell
                  component="th"
                  scope="row"
                  sx={{ py: 0.75, pl: 0.5 }}
                >
                  LKW 3,5t
                </TableCell>
                <TableCell align="right" sx={{ py: 0.75, pr: 0 }}>
                  {basis.trucks}
                </TableCell>
              </TableRow>
              <TableRow
                sx={{ "&:last-child td, &:last-child th": { borderBottom: 0 } }}
              >
                <TableCell
                  align="center"
                  sx={{ width: 40, py: 0.75, pl: 0, verticalAlign: "middle" }}
                >
                  <ScheduleOutlined
                    fontSize="small"
                    color="action"
                    aria-hidden="true"
                  />
                </TableCell>
                <TableCell
                  component="th"
                  scope="row"
                  sx={{ py: 0.75, pl: 0.5 }}
                >
                  Stunden
                </TableCell>
                <TableCell align="right" sx={{ py: 0.75, pr: 0 }}>
                  {basis.hours}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <Button variant="contained" onClick={onCalculate}>
            Positionen berechnen
          </Button>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2.5, minWidth: 0 }}>
        <Stack spacing={1.5}>
          <Typography component="h2" variant="h6">
            Positionen aus dem Auftrag
          </Typography>
          {catalogError && (
            <Alert severity="warning">
              Katalogvorschläge konnten nicht geladen werden. Positionen können
              weiterhin manuell eingegeben werden.
            </Alert>
          )}
          {basis.trucks > 4 && (
            <Alert severity="info">
              Für mehr als 4 LKW gibt es keinen automatischen Anfahrtstarif.
              Bitte pflegen Sie die An-/Abfahrtskosten als manuelle Position.
            </Alert>
          )}
          {conditions.map((entry, index) =>
            entry.kind === "manual" ? null : (
              <ConditionRow
                key={`order-condition-${index}`}
                entry={entry}
                index={index}
                catalogChoices={catalogChoices}
                updateEntry={updateEntry}
                updateQuantity={updateQuantity}
                updateUnitPrice={updateUnitPrice}
                onRemove={() =>
                  onConditionsChange(
                    conditions.filter((_, entryIndex) => entryIndex !== index),
                  )
                }
              />
            ),
          )}
          <Box sx={{ borderTop: 1, borderColor: "divider", pt: 1.5 }}>
            <Typography component="h3" variant="h6">
              Manuell hinzugefügt
            </Typography>
          </Box>
          {conditions.map((entry, index) =>
            entry.kind !== "manual" ? null : (
              <ConditionRow
                key={`manual-condition-${index}`}
                entry={entry}
                index={index}
                catalogChoices={catalogChoices}
                updateEntry={updateEntry}
                updateQuantity={updateQuantity}
                updateUnitPrice={updateUnitPrice}
                onRemove={() =>
                  onConditionsChange(
                    conditions.filter((_, entryIndex) => entryIndex !== index),
                  )
                }
              />
            ),
          )}
          <Button
            startIcon={<AddOutlined />}
            onClick={() =>
              onConditionsChange([
                ...conditions,
                { description: "", amount: 0, kind: "manual" },
              ])
            }
            sx={{ alignSelf: "flex-end" }}
          >
            Position hinzufügen
          </Button>
          <Stack spacing={0.25} sx={{ alignItems: "flex-end" }}>
            <Typography variant="body2" color="text.secondary">
              Netto:{" "}
              {netTotal.toLocaleString("de-DE", {
                style: "currency",
                currency: "EUR",
              })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              MwSt. (19 %):{" "}
              {vatTotal.toLocaleString("de-DE", {
                style: "currency",
                currency: "EUR",
              })}
            </Typography>
            <Typography variant="h6">
              Summe:{" "}
              {grossTotal.toLocaleString("de-DE", {
                style: "currency",
                currency: "EUR",
              })}
            </Typography>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}

function ConditionRow({
  entry,
  index,
  catalogChoices,
  updateEntry,
  updateQuantity,
  updateUnitPrice,
  onRemove,
}: {
  entry: OrderConditionInput;
  index: number;
  catalogChoices: ConditionCatalogChoice[];
  updateEntry: (index: number, patch: ConditionEditPatch) => void;
  updateQuantity: (index: number, raw: string) => void;
  updateUnitPrice: (index: number, raw: string) => void;
  onRemove: () => void;
}) {
  return (
    <Grid container spacing={1} sx={{ alignItems: "flex-start" }}>
      <Grid size={{ xs: 12, sm: 5 }}>
        <Autocomplete<ConditionCatalogChoice, false, false, true>
          freeSolo
          fullWidth
          options={catalogChoices}
          value={entry.description}
          inputValue={entry.description}
          getOptionLabel={(option) =>
            typeof option === "string" ? option : option.name
          }
          getOptionKey={(option) =>
            typeof option === "string" ? option : `${option.kind}-${option.id}`
          }
          isOptionEqualToValue={(option, selected) =>
            typeof selected !== "string" && option.id === selected.id
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
                quantity: 1,
                unitPrice: selected.price,
                amount: roundAmountToCents(selected.price),
              });
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              sx={{ width: "100%" }}
              label="Beschreibung"
              multiline
              minRows={index === 0 ? 2 : 1}
            />
          )}
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 1.5 }}>
        <TextField
          sx={{ width: "100%" }}
          type="number"
          label="Menge"
          value={entry.quantity ?? ""}
          onChange={(event) => updateQuantity(index, event.target.value)}
          slotProps={{ htmlInput: { min: 0, step: "any" } }}
        />
      </Grid>
      <Grid size={{ xs: 6, sm: 2 }}>
        <TextField
          sx={{ width: "100%" }}
          type="number"
          label="Einzelpreis (€)"
          value={entry.unitPrice ?? ""}
          onChange={(event) => updateUnitPrice(index, event.target.value)}
          slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
        />
      </Grid>
      <Grid size={{ xs: 8, sm: 2.5 }}>
        <TextField
          sx={{ width: "100%" }}
          type="number"
          label="Betrag (€)"
          value={entry.amount === 0 ? "" : entry.amount}
          disabled={
            entry.quantity !== undefined && entry.unitPrice !== undefined
          }
          onChange={(event) =>
            updateEntry(index, { amount: Number(event.target.value) })
          }
        />
      </Grid>
      <Grid size={{ xs: 4, sm: 1 }}>
        <IconButton
          color="default"
          aria-label="Position entfernen"
          sx={{ mt: 1, alignSelf: "flex-start" }}
          onClick={onRemove}
        >
          <DeleteOutlined />
        </IconButton>
      </Grid>
    </Grid>
  );
}
