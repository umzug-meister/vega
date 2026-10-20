import { useEffect, useState } from "react";
import {
  Button,
  Grid,
  InputAdornment,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { AdminAlert as Alert } from "../components/AdminNotifications.js";
import type { CatalogOfferDto, OrderDetailsInput } from "@vega/domain";
import { AppointmentFields } from "./AppointmentFields.js";
import { suggestDiscountPercent } from "./discount-recommendation.js";
import { apiRequest } from "../api/api-request.js";
import type { OrderFormValue } from "./order-form-types.js";

interface BasisTabProps {
  value: OrderFormValue;
  update: (patch: Partial<OrderFormValue>) => void;
  onBasisChange: (basis: OrderDetailsInput["basis"]) => void;
}

export function filterOffersByBasis(
  offers: CatalogOfferDto[],
  basis: OrderDetailsInput["basis"],
): CatalogOfferDto[] {
  return offers.filter(
    (offer) =>
      (basis.workers <= 0 || offer.workers === basis.workers) &&
      (basis.trucks <= 0 || offer.trucks === basis.trucks) &&
      (basis.hours <= 0 || offer.includedHours === basis.hours),
  );
}

export function BasisTab({ value, update, onBasisChange }: BasisTabProps) {
  const basis = value.details.basis;
  const discountRecommendation = suggestDiscountPercent(value.movingDate);
  const [offers, setOffers] = useState<CatalogOfferDto[]>([]);
  const [offersLoading, setOffersLoading] = useState(true);
  const [offersError, setOffersError] = useState<string | null>(null);
  const matchingOffers = filterOffersByBasis(offers, basis);

  function selectOffer(offer: CatalogOfferDto) {
    onBasisChange({
      offerId: offer.id,
      workers: offer.workers,
      trucks: offer.trucks,
      hours: offer.includedHours,
      basePrice: offer.sum,
      extraHourPrice: offer.hourPrice,
      discountPercent: basis.discountPercent,
    });
  }
  const setBasis = (patch: Partial<typeof basis>) => {
    const next = { ...basis, ...patch };
    if (["workers", "trucks", "hours"].some((key) => key in patch))
      delete next.offerId;
    onBasisChange(next);
  };

  useEffect(() => {
    let active = true;
    apiRequest<CatalogOfferDto[]>("/api/catalog/offers")
      .then((items) => {
        if (active) setOffers(items);
      })
      .catch((cause: unknown) => {
        if (active)
          setOffersError(
            cause instanceof Error
              ? cause.message
              : "Angebote konnten nicht geladen werden.",
          );
      })
      .finally(() => {
        if (active) setOffersLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <Stack spacing={2}>
      <Grid container spacing={2} sx={{ alignItems: "stretch" }}>
        <Grid
          size={{ xs: 12, md: 12, lg: 4 }}
          sx={{ display: "flex", alignItems: "stretch" }}
        >
          <Paper variant="outlined" sx={{ p: 2.5, flex: 1 }}>
            <AppointmentFields
              value={{
                movingDate: value.movingDate,
                movingTime: value.movingTime ?? "",
                dateFrom: value.dateFrom ?? "",
                dateTo: value.dateTo ?? "",
                dateFixed: value.dateFixed ?? false,
              }}
              onChange={update}
            />
          </Paper>
        </Grid>
        <Grid
          size={{ xs: 12, md: 6, lg: 4 }}
          sx={{ display: "flex", alignItems: "stretch" }}
        >
          <Paper variant="outlined" sx={{ p: 2.5, flex: 1 }}>
            <Stack spacing={1.5}>
              <Typography component="h2" variant="h6">
                Träger und LKW
              </Typography>
              <TextField
                type="number"
                label="Träger"
                value={basis.workers || ""}
                onChange={(event) =>
                  setBasis({ workers: Number(event.target.value) })
                }
              />
              <TextField
                type="number"
                label="LKW 3,5"
                value={basis.trucks || ""}
                onChange={(event) =>
                  setBasis({ trucks: Number(event.target.value) })
                }
                slotProps={{ htmlInput: { min: 0 } }}
              />
              <TextField
                type="number"
                label="Stunden"
                value={basis.hours || ""}
                onChange={(event) =>
                  setBasis({ hours: Number(event.target.value) })
                }
              />
              {!offersLoading && matchingOffers.length === 1 && (
                <Button
                  variant="text"
                  onClick={() => selectOffer(matchingOffers[0]!)}
                  aria-label={`Einziges passendes Angebot auswählen: ${matchingOffers[0]!.workers} Träger, ${matchingOffers[0]!.trucks} LKW, ${matchingOffers[0]!.includedHours} Stunden`}
                  sx={{ alignSelf: "flex-start" }}
                >
                  Vorschlag übernehmen
                </Button>
              )}
            </Stack>
          </Paper>
        </Grid>
        <Grid
          size={{ xs: 12, md: 6, lg: 4 }}
          sx={{ display: "flex", alignItems: "stretch" }}
        >
          <Paper variant="outlined" sx={{ p: 2.5, flex: 1 }}>
            <Stack spacing={1.5}>
              <Typography component="h2" variant="h6">
                Preis
              </Typography>
              <TextField
                type="number"
                label="Betrag"
                value={basis.basePrice || ""}
                onChange={(event) =>
                  setBasis({ basePrice: Number(event.target.value) })
                }
                slotProps={{
                  htmlInput: { min: 0, step: "0.01" },
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">€</InputAdornment>
                    ),
                  },
                }}
              />
              <TextField
                type="number"
                label="Stundenpreis"
                value={basis.extraHourPrice || ""}
                onChange={(event) =>
                  setBasis({ extraHourPrice: Number(event.target.value) })
                }
                slotProps={{
                  htmlInput: { min: 0, step: "0.01" },
                  input: {
                    endAdornment: <InputAdornment position="end">€</InputAdornment>,
                  },
                }}
              />
              <TextField
                type="number"
                label="Rabatt"
                value={basis.discountPercent || ""}
                onChange={(event) =>
                  setBasis({ discountPercent: Number(event.target.value) })
                }
                slotProps={{
                  htmlInput: { min: 0, max: 100, step: "0.01" },
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">%</InputAdornment>
                    ),
                  },
                }}
              />
              <Stack direction="row" spacing={1}>
                {discountRecommendation !== null && (
                  <Button
                    variant="text"
                    sx={{ alignSelf: "flex-start" }}
                    onClick={() => {
                      if (basis.discountPercent !== discountRecommendation)
                        setBasis({ discountPercent: discountRecommendation });
                    }}
                  >
                    {discountRecommendation} % übernehmen
                  </Button>
                )}
              </Stack>
            </Stack>
          </Paper>
        </Grid>
      </Grid>
      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Stack spacing={1.5}>
          <Typography component="h2" variant="h6">
            Aktuelle Angebote
          </Typography>
          {offersError && <Alert severity="error">{offersError}</Alert>}
          {offersLoading ? (
            <Typography color="text.secondary">
              Angebote werden geladen …
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Träger</TableCell>
                    <TableCell>LKW 3,5</TableCell>
                    <TableCell>Stunden</TableCell>
                    <TableCell>Einzelpreis</TableCell>
                    <TableCell>Anfahrt</TableCell>
                    <TableCell>Gesamt</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {matchingOffers.map((offer) => (
                    <TableRow key={offer.id}>
                      <TableCell>{offer.workers}</TableCell>
                      <TableCell>{offer.trucks}</TableCell>
                      <TableCell>{offer.includedHours}</TableCell>
                      <TableCell>
                        {offer.hourPrice.toLocaleString("de-DE", {
                          style: "currency",
                          currency: "EUR",
                        })}
                      </TableCell>
                      <TableCell>
                        {offer.ridingCosts.toLocaleString("de-DE", {
                          style: "currency",
                          currency: "EUR",
                        })}
                      </TableCell>
                      <TableCell>
                        {offer.sum.toLocaleString("de-DE", {
                          style: "currency",
                          currency: "EUR",
                        })}
                      </TableCell>
                      <TableCell>
                        <Button size="small" onClick={() => selectOffer(offer)}>
                          Auswählen
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {matchingOffers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} align="center">
                        Keine passenden Angebote gefunden.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}
