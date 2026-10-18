import { Fragment, useEffect, useMemo, useState } from "react";
import { AddOutlined, DeleteOutlined } from "@mui/icons-material";
import {
  Box,
  Button,
  Divider,
  Grid,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { AdminAlert as Alert } from "../components/AdminNotifications.js";
import type {
  CatalogOfferDto,
  CatalogServiceRateDto,
  ServiceRateKey,
} from "@vega/domain";
import { apiRequest } from "../api/api-request.js";
import { useCatalogCollection } from "./useCatalogCollection.js";

const offerGroups = [
  { trucks: 1, workers: [2, 3, 4] },
  { trucks: 2, workers: [3, 4, 5, 6, 7, 8] },
  { trucks: 3, workers: [5, 6, 7, 8] },
  { trucks: 4, workers: [7, 8, 9, 10] },
] as const;
const truckCounts = [1, 2, 3, 4] as const;
const defaultHours = [8, 7, 6, 5, 4, 3, 2] as const;
const allHours = Array.from({ length: 24 }, (_, index) => 24 - index);

function truckRateKey(trucks: number): ServiceRateKey {
  return `ridingCostsTruck${trucks}` as ServiceRateKey;
}

export function validPrice(value: string): number | null {
  const price = Number(value);
  return value.trim() &&
    Number.isFinite(price) &&
    price >= 0 &&
    Math.abs(Math.round(price * 100) - price * 100) < 0.00001
    ? price
    : null;
}

export function shouldDeleteOfferValue(value: string): boolean {
  return !value.trim() || Number(value.trim().replace(",", ".")) === 0;
}

interface WorkerRowDraft {
  trucks: number;
  workers: number;
  hourPrice: string;
  newWorker: boolean;
}

export function OffersPage() {
  const catalog = useCatalogCollection<CatalogOfferDto>("offers");
  const [truckRates, setTruckRates] = useState<
    Partial<Record<ServiceRateKey, string>>
  >({});
  const [savedTruckRates, setSavedTruckRates] = useState<
    Partial<Record<ServiceRateKey, string>>
  >({});
  const [truckRatesLoading, setTruckRatesLoading] = useState(true);
  const [savingTruckRate, setSavingTruckRate] = useState<number | null>(null);
  const [truckRateError, setTruckRateError] = useState<string | null>(null);
  const [truckRateMessage, setTruckRateMessage] = useState<string | null>(null);
  const [workerRowDrafts, setWorkerRowDrafts] = useState<WorkerRowDraft[]>([]);
  const [hourPriceDrafts, setHourPriceDrafts] = useState<
    Record<string, string>
  >({});
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({});
  const [offerError, setOfferError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    apiRequest<CatalogServiceRateDto[]>("/api/admin/catalog/service-rates")
      .then((rates) => {
        if (!active) return;
        const values = Object.fromEntries(
          rates.map(({ key, price }) => [key, String(price)]),
        ) as Partial<Record<ServiceRateKey, string>>;
        for (const trucks of truckCounts) values[truckRateKey(trucks)] ??= "0";
        setTruckRates(values);
        setSavedTruckRates(values);
      })
      .catch((cause: unknown) => {
        if (active)
          setTruckRateError(
            cause instanceof Error
              ? cause.message
              : "LKW-Anfahrtskosten konnten nicht geladen werden.",
          );
      })
      .finally(() => {
        if (active) setTruckRatesLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const hours = useMemo(
    () =>
      Array.from(
        new Set([
          ...defaultHours,
          ...catalog.items.map((offer) => offer.includedHours),
        ]),
      ).sort((left, right) => right - left),
    [catalog.items],
  );

  async function update(
    offer: CatalogOfferDto,
    patch: Partial<CatalogOfferDto>,
  ) {
    const { id, ...current } = offer;
    await catalog.update(id, { ...current, ...patch });
  }

  async function recover(cause: unknown) {
    await catalog.reload();
    catalog.setError(
      cause instanceof Error
        ? cause.message
        : "Das Angebot konnte nicht gespeichert werden.",
    );
  }

  async function saveTruckRate(trucks: number) {
    const key = truckRateKey(trucks);
    const value = truckRates[key] ?? "0";
    if (value === savedTruckRates[key]) return;
    const price = validPrice(value);
    if (price === null) {
      setTruckRateError(
        "Bitte geben Sie einen gültigen Preis mit höchstens zwei Nachkommastellen ein.",
      );
      return;
    }
    setSavingTruckRate(trucks);
    setTruckRateError(null);
    setTruckRateMessage(null);
    try {
      const saved = await apiRequest<CatalogServiceRateDto>(
        `/api/admin/catalog/service-rates/${key}`,
        "PUT",
        { price },
      );
      setTruckRates((current) => ({ ...current, [key]: String(saved.price) }));
      setSavedTruckRates((current) => ({
        ...current,
        [key]: String(saved.price),
      }));
      setTruckRateMessage("LKW-Anfahrtskosten gespeichert.");
    } catch (cause) {
      setTruckRateError(
        cause instanceof Error
          ? cause.message
          : "LKW-Anfahrtskosten konnten nicht gespeichert werden.",
      );
    } finally {
      setSavingTruckRate(null);
    }
  }

  function rowKey(trucks: number, workers: number) {
    return `${trucks}:${workers}`;
  }

  function cellKey(trucks: number, workers: number, hours: number) {
    return `${trucks}:${workers}:${hours}`;
  }

  function addWorkerRow(trucks: number) {
    const existing = new Set([
      ...(offerGroups.find((group) => group.trucks === trucks)?.workers ?? []),
      ...catalog.items
        .filter((offer) => offer.trucks === trucks)
        .map((offer) => offer.workers),
      ...workerRowDrafts
        .filter((row) => row.trucks === trucks)
        .map((row) => row.workers),
    ]);
    const workers = Array.from({ length: 100 }, (_, index) => index + 1).find(
      (count) => !existing.has(count),
    );
    if (workers === undefined) {
      setOfferError(
        "Für diese LKW-Anzahl sind bereits alle Trägerzeilen angelegt.",
      );
      return;
    }
    setOfferError(null);
    setWorkerRowDrafts((current) => [
      ...current,
      {
        trucks,
        workers,
        hourPrice: "0",
        newWorker: true,
      },
    ]);
  }

  function startAddingOffer(
    trucks: number,
    workers: number,
    rowOffers: CatalogOfferDto[],
  ) {
    const key = rowKey(trucks, workers);
    if (workerRowDrafts.some((row) => rowKey(row.trucks, row.workers) === key))
      return;
    setOfferError(null);
    setWorkerRowDrafts((current) => [
      ...current,
      {
        trucks,
        workers,
        hourPrice: hourPriceDrafts[key] ?? String(rowOffers[0]?.hourPrice ?? 0),
        newWorker: false,
      },
    ]);
  }

  function cancelWorkerRow(trucks: number, workers: number) {
    const key = rowKey(trucks, workers);
    setWorkerRowDrafts((current) =>
      current.filter((row) => rowKey(row.trucks, row.workers) !== key),
    );
    setCellDrafts((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([cell]) => !cell.startsWith(`${key}:`)),
      ),
    );
  }

  async function saveWorkerHourPrice(
    trucks: number,
    workers: number,
    value: string,
  ) {
    const price = validPrice(value);
    if (price === null) {
      setOfferError(
        "Bitte geben Sie einen gültigen Einzelpreis mit höchstens zwei Nachkommastellen ein.",
      );
      return;
    }
    const key = rowKey(trucks, workers);
    const entries = catalog.items.filter(
      (offer) => offer.trucks === trucks && offer.workers === workers,
    );
    setHourPriceDrafts((current) => ({ ...current, [key]: String(price) }));
    if (entries.length === 0) {
      setWorkerRowDrafts((current) =>
        current.map((row) =>
          rowKey(row.trucks, row.workers) === key
            ? { ...row, hourPrice: String(price) }
            : row,
        ),
      );
      return;
    }
    if (entries.every((offer) => offer.hourPrice === price)) return;
    setOfferError(null);
    try {
      await Promise.all(
        entries.map((offer) => update(offer, { hourPrice: price })),
      );
    } catch (cause) {
      setOfferError(
        cause instanceof Error
          ? cause.message
          : "Einzelpreis konnte nicht gespeichert werden.",
      );
      await catalog.reload();
    }
  }

  async function saveOfferCell(
    trucks: number,
    workers: number,
    includedHours: number,
    value: string,
  ) {
    const key = cellKey(trucks, workers, includedHours);
    const existing = catalog.items.find(
      (offer) =>
        offer.trucks === trucks &&
        offer.workers === workers &&
        offer.includedHours === includedHours,
    );
    if (shouldDeleteOfferValue(value)) {
      setCellDrafts((current) => {
        const { [key]: _cleared, ...rest } = current;
        return rest;
      });
      if (existing) {
        try {
          await catalog.remove(existing.id);
        } catch (cause) {
          await recover(cause);
        }
      }
      return;
    }
    const sum = validPrice(value);
    if (sum === null) {
      setOfferError(
        "Bitte geben Sie einen gültigen Gesamtpreis mit höchstens zwei Nachkommastellen ein.",
      );
      return;
    }
    const keyForRow = rowKey(trucks, workers);
    const rowDraft = workerRowDrafts.find(
      (row) => rowKey(row.trucks, row.workers) === keyForRow,
    );
    const rowOffers = catalog.items.filter(
      (offer) => offer.trucks === trucks && offer.workers === workers,
    );
    const hourPrice = validPrice(
      rowDraft?.hourPrice ??
        hourPriceDrafts[keyForRow] ??
        String(rowOffers[0]?.hourPrice ?? 0),
    );
    if (hourPrice === null) {
      setOfferError("Bitte geben Sie zuerst einen gültigen Einzelpreis ein.");
      return;
    }
    const ridingCosts = Number(truckRates[truckRateKey(trucks)] ?? 0);
    const existingAtHours = rowOffers.find(
      (offer) => offer.includedHours === includedHours,
    );
    setOfferError(null);
    try {
      if (existingAtHours) {
        await update(existingAtHours, { sum, hourPrice, ridingCosts });
      } else {
        await catalog.create({
          name: `${workers} Träger · ${trucks} LKW`,
          workers,
          trucks,
          includedHours,
          sum,
          hourPrice,
          ridingCosts,
          sort: Math.max(0, ...catalog.items.map((offer) => offer.sort)) + 1,
        });
      }
      setCellDrafts((current) => {
        const { [cellKey(trucks, workers, includedHours)]: _saved, ...rest } =
          current;
        return rest;
      });
      cancelWorkerRow(trucks, workers);
    } catch (cause) {
      setOfferError(
        cause instanceof Error
          ? cause.message
          : "Das Angebot konnte nicht gespeichert werden.",
      );
      await catalog.reload();
    }
  }

  const rateError = truckRateError;
  const disabled =
    catalog.loading ||
    Boolean(catalog.error) ||
    truckRatesLoading ||
    Boolean(rateError);
  const columnCount = 5 + hours.length;

  return (
    <Stack spacing={2}>
      {catalog.error && <Alert severity="error">{catalog.error}</Alert>}
      {rateError && <Alert severity="error">{rateError}</Alert>}
      {truckRateMessage && <Alert severity="success">{truckRateMessage}</Alert>}
      {offerError && <Alert severity="error">{offerError}</Alert>}
      <Paper variant="outlined">
        <Box sx={{ overflowX: { xs: "auto", md: "visible" } }}>
          <Table
            size="small"
            sx={{
              minWidth: 1200,
              "& thead th": {
                position: "sticky",
                top: { xs: "58px", md: "68px" },
                zIndex: 3,
                bgcolor: "background.paper",
                fontWeight: 700,
              },
              "& th:not(:last-child), & td:not(:last-child)": {
                borderRight: "1px solid",
                borderRightColor: "divider",
              },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell>LKW</TableCell>
                <TableCell>Anfahrt</TableCell>
                <TableCell
                  align="right"
                  sx={{ fontWeight: 700, color: "text.primary" }}
                >
                  Träger
                </TableCell>
                <TableCell align="right">Einzelpreis</TableCell>
                {hours.map((hour) => (
                  <TableCell key={hour} align="right">
                    {hour}
                  </TableCell>
                ))}
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {offerGroups.map(({ trucks, workers: predefinedWorkers }) => {
                const groupOffers = catalog.items.filter(
                  (offer) => offer.trucks === trucks,
                );
                const workerCounts = Array.from(
                  new Set([
                    ...predefinedWorkers,
                    ...groupOffers.map((offer) => offer.workers),
                    ...workerRowDrafts
                      .filter((row) => row.trucks === trucks)
                      .map((row) => row.workers),
                  ]),
                ).sort((left, right) => left - right);
                const rateKey = truckRateKey(trucks);
                return (
                  <Fragment key={trucks}>
                    {workerCounts.map((workers, index) => {
                      const rowOffers = groupOffers.filter(
                        (offer) => offer.workers === workers,
                      );
                      const workerKey = rowKey(trucks, workers);
                      const rowDraft = workerRowDrafts.find(
                        (row) => rowKey(row.trucks, row.workers) === workerKey,
                      );
                      return (
                        <TableRow key={`${trucks}-${workers}`}>
                          {index === 0 && (
                            <>
                              <TableCell
                                rowSpan={workerCounts.length}
                                sx={{ fontWeight: 700 }}
                              >
                                {trucks}
                              </TableCell>
                              <TableCell
                                rowSpan={workerCounts.length}
                                sx={{ minWidth: 140 }}
                              >
                                <TextField
                                  fullWidth
                                  size="small"
                                  type="number"
                                  label="Anfahrtskosten"
                                  value={truckRates[rateKey] ?? "0"}
                                  disabled={
                                    truckRatesLoading ||
                                    savingTruckRate === trucks
                                  }
                                  onChange={(event) =>
                                    setTruckRates((current) => ({
                                      ...current,
                                      [rateKey]: event.target.value,
                                    }))
                                  }
                                  onBlur={() => void saveTruckRate(trucks)}
                                  slotProps={{
                                    htmlInput: { min: 0, step: "0.01" },
                                    input: { endAdornment: "€" },
                                  }}
                                />
                              </TableCell>
                            </>
                          )}
                          <TableCell align="right" sx={{ minWidth: 90 }}>
                            <Typography sx={{ fontWeight: 700 }}>
                              {workers}
                            </Typography>
                          </TableCell>
                          <TableCell align="right" sx={{ minWidth: 135 }}>
                            <TextField
                              fullWidth
                              size="small"
                              type="number"
                              aria-label={`Einzelpreis ${workers} Träger, ${trucks} LKW`}
                              value={
                                hourPriceDrafts[workerKey] ??
                                rowDraft?.hourPrice ??
                                String(rowOffers[0]?.hourPrice ?? "")
                              }
                              disabled={
                                disabled ||
                                (rowOffers.length === 0 && !rowDraft)
                              }
                              onChange={(event) =>
                                setHourPriceDrafts((current) => ({
                                  ...current,
                                  [workerKey]: event.target.value,
                                }))
                              }
                              onBlur={(event) =>
                                void saveWorkerHourPrice(
                                  trucks,
                                  workers,
                                  event.target.value,
                                )
                              }
                              slotProps={{
                                htmlInput: { min: 0, step: "0.01" },
                                input: { endAdornment: "€" },
                              }}
                            />
                          </TableCell>
                          {hours.map((hour) => {
                            const offer = rowOffers.find(
                              (entry) => entry.includedHours === hour,
                            );
                            const hasOffer =
                              offer !== undefined &&
                              !(offer.sum === 0 && offer.hourPrice === 0);
                            if (!hasOffer && !rowDraft)
                              return <TableCell key={hour} />;
                            if (!hasOffer) {
                              const key = cellKey(trucks, workers, hour);
                              return (
                                <TableCell
                                  key={hour}
                                  align="right"
                                  sx={{ minWidth: 110 }}
                                >
                                  <TextField
                                    size="small"
                                    type="number"
                                    aria-label={`Neuer Gesamtpreis ${workers} Träger, ${trucks} LKW, ${hour} Stunden`}
                                    value={cellDrafts[key] ?? ""}
                                    disabled={disabled}
                                    onChange={(event) =>
                                      setCellDrafts((current) => ({
                                        ...current,
                                        [key]: event.target.value,
                                      }))
                                    }
                                    onBlur={(event) =>
                                      void saveOfferCell(
                                        trucks,
                                        workers,
                                        hour,
                                        event.target.value,
                                      )
                                    }
                                    slotProps={{
                                      htmlInput: { min: 0, step: "0.01" },
                                    }}
                                  />
                                </TableCell>
                              );
                            }
                            return (
                              <OfferCell
                                key={hour}
                                offer={offer}
                                disabled={disabled}
                                save={(next) =>
                                  saveOfferCell(trucks, workers, hour, next)
                                }
                              />
                            );
                          })}
                          <TableCell align="right">
                            {rowDraft ? (
                              <IconButton
                                size="small"
                                aria-label={`Trägerzeile ${workers} für ${trucks} LKW abbrechen`}
                                disabled={disabled}
                                onClick={() => cancelWorkerRow(trucks, workers)}
                              >
                                <DeleteOutlined fontSize="small" />
                              </IconButton>
                            ) : (
                              <IconButton
                                size="small"
                                aria-label={`Angebot hinzufügen (${trucks} LKW, ${workers} Träger)`}
                                disabled={
                                  disabled ||
                                  allHours.every((hour) =>
                                    rowOffers.some(
                                      (offer) => offer.includedHours === hour,
                                    ),
                                  )
                                }
                                onClick={() =>
                                  startAddingOffer(trucks, workers, rowOffers)
                                }
                              >
                                <AddOutlined fontSize="small" />
                              </IconButton>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow>
                      <TableCell colSpan={columnCount}>
                        <Button
                          size="small"
                          startIcon={<AddOutlined />}
                          disabled={disabled}
                          onClick={() => addWorkerRow(trucks)}
                        >
                          Trägerzeile hinzufügen ({trucks} LKW)
                        </Button>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      </Paper>
    </Stack>
  );
}

function OfferCell({
  offer,
  disabled,
  save,
}: {
  offer: CatalogOfferDto;
  disabled: boolean;
  save: (value: string) => void;
}) {
  const [sum, setSum] = useState(String(offer.sum));
  useEffect(() => setSum(String(offer.sum)), [offer.sum]);

  return (
    <TableCell align="right" sx={{ minWidth: 110 }}>
      <TextField
        size="small"
        type="number"
        aria-label={`Gesamtpreis ${offer.workers} Träger, ${offer.trucks} LKW, ${offer.includedHours} Stunden`}
        value={sum}
        disabled={disabled}
        onChange={(event) => setSum(event.target.value)}
        onBlur={() => save(sum)}
        slotProps={{ htmlInput: { min: 0, step: "0.01" } }}
        sx={{ width: 92 }}
      />
    </TableCell>
  );
}
