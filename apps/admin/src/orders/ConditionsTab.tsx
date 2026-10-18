import { AddOutlined, DeleteOutlined } from "@mui/icons-material";
import {
  GroupsOutlined,
  LocalShippingOutlined,
  ScheduleOutlined,
} from "@mui/icons-material";
import {
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
  type OrderConditionInput,
  type OrderDetailsInput,
} from "@vega/domain";
import type { OrderFormValue } from "./order-form-types.js";

interface ConditionsTabProps {
  value: OrderFormValue;
  onConditionsChange: (conditions: OrderDetailsInput["conditions"]) => void;
  onCalculate: () => void;
}

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

export function ConditionsTab({
  value,
  onConditionsChange,
  onCalculate,
}: ConditionsTabProps) {
  const { basis, conditions } = value.details;
  const grossTotal = roundAmountToCents(
    addInvoiceAmounts(conditions.map((item) => item.amount)),
  );
  const netTotal = roundAmountToCents(grossTotal / 1.19);
  const vatTotal = roundAmountToCents(grossTotal - netTotal);
  const pricingChanged = hasPricingInputsChanged(value);

  function updateEntry(index: number, patch: Partial<OrderConditionInput>) {
    onConditionsChange(
      conditions.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry,
      ),
    );
  }

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "minmax(0, 1fr)",
          md: "minmax(0, 1fr) minmax(0, 2fr)",
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
          {pricingChanged && (
            <Alert severity="warning">
              Preisrelevante Angaben wurden geändert. Die gespeicherten
              Positionen bleiben unverändert, bis Sie neu kalkulieren.
            </Alert>
          )}
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2.5, minWidth: 0 }}>
        <Stack spacing={1.5}>
          <Typography component="h2" variant="h6">
            Positionen im Auftrag
          </Typography>
          {conditions.map((entry, index) => (
            <Grid
              container
              spacing={1}
              key={`condition-${index}`}
              sx={{ alignItems: "center" }}
            >
              <Grid size={{ xs: 12, sm: 7 }}>
                <TextField
                  label="Beschreibung"
                  value={entry.description}
                  onChange={(event) =>
                    updateEntry(index, { description: event.target.value })
                  }
                />
              </Grid>
              <Grid size={{ xs: 8, sm: 3 }}>
                <TextField
                  type="number"
                  label="Betrag (€)"
                  value={entry.amount}
                  onChange={(event) =>
                    updateEntry(index, { amount: Number(event.target.value) })
                  }
                />
              </Grid>
              <Grid size={{ xs: 4, sm: 2 }}>
                <IconButton
                  color="error"
                  aria-label="Position entfernen"
                  onClick={() =>
                    onConditionsChange(
                      conditions.filter(
                        (_, entryIndex) => entryIndex !== index,
                      ),
                    )
                  }
                >
                  <DeleteOutlined />
                </IconButton>
              </Grid>
            </Grid>
          ))}
          <Button
            startIcon={<AddOutlined />}
            onClick={() =>
              onConditionsChange([
                ...conditions,
                { description: "", amount: 0 },
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
