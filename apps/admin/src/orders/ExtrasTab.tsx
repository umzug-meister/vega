import { AddOutlined, DeleteOutlined } from "@mui/icons-material";
import {
  Autocomplete,
  Button,
  Grid,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { AdminAlert as Alert } from "../components/AdminNotifications.js";
import type {
  CatalogPackingDto,
  CatalogServiceDto,
  OrderServiceInput,
} from "@vega/domain";
import { useEffect, useState } from "react";
import { apiRequest } from "../api/api-request.js";
import type { OrderFormValue } from "./order-form-types.js";

interface ExtrasTabProps {
  value: OrderFormValue;
  onExtrasChange: (extras: OrderFormValue["details"]["extras"]) => void;
}

export function ExtrasTab({ value, onExtrasChange }: ExtrasTabProps) {
  const [catalog, setCatalog] = useState<
    Array<{
      id: number;
      name: string;
      price: number;
      kind: "packaging" | "service";
    }>
  >([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const extras = value.details.extras;

  useEffect(() => {
    let active = true;
    Promise.all([
      apiRequest<CatalogPackingDto[]>("/api/admin/catalog/packings"),
      apiRequest<CatalogServiceDto[]>("/api/admin/catalog/services"),
    ])
      .then(([packings, services]) => {
        if (active)
          setCatalog([
            ...packings.map((item) => ({
              id: item.id,
              name: item.name,
              price: item.price,
              kind: "packaging" as const,
            })),
            ...services.map((item) => ({
              id: item.id,
              name: item.name,
              price: item.price,
              kind: "service" as const,
            })),
          ]);
      })
      .catch((cause: unknown) => {
        if (active)
          setCatalogError(
            cause instanceof Error
              ? cause.message
              : "Leistungskatalog konnte nicht geladen werden.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  function updateService(
    kind: "packaging" | "service",
    indexInVisibleList: number,
    patch: Partial<OrderServiceInput>,
    clearCatalogSelection = false,
    clearUnitPrice = false,
  ) {
    let visibleIndex = -1;
    const sourceIndex = extras.services.findIndex((service) => {
      if (service.kind !== kind) return false;
      visibleIndex += 1;
      return visibleIndex === indexInVisibleList;
    });
    onExtrasChange({
      ...extras,
      services: extras.services.map((service, index) => {
        if (index !== sourceIndex) return service;
        const updated = { ...service, ...patch };
        if (clearCatalogSelection) {
          delete updated.catalogId;
          delete updated.unitPrice;
        }
        if (clearUnitPrice) delete updated.unitPrice;
        return updated;
      }),
    });
  }

  function addService(kind: "packaging" | "service") {
    onExtrasChange({
      ...extras,
      services: [...extras.services, { kind, name: "", quantity: 1 }],
    });
  }

  function removeService(
    kind: "packaging" | "service",
    indexInVisibleList: number,
  ) {
    const target = extras.services.filter((service) => service.kind === kind)[
      indexInVisibleList
    ];
    onExtrasChange({
      ...extras,
      services: extras.services.filter((service) => service !== target),
    });
  }

  return (
    <Grid container spacing={2} sx={{ alignItems: "stretch" }}>
      {catalogError && (
        <Grid size={12}>
          <Alert severity="error">{catalogError}</Alert>
        </Grid>
      )}
      {(
        [
          {
            kind: "packaging",
            title: "Packmaterial",
            itemLabel: "Packmaterial",
            addLabel: "Packmaterial hinzufügen",
          },
          {
            kind: "service",
            title: "Leistungen",
            itemLabel: "Leistung",
            addLabel: "Leistung hinzufügen",
          },
        ] as const
      ).map(({ kind, title, itemLabel, addLabel }) => {
        const visibleServices = extras.services.filter(
          (service) => service.kind === kind,
        );
        return (
          <Grid size={{ xs: 12, lg: 6 }} key={kind}>
            <Paper variant="outlined" sx={{ p: 2.5, height: "100%" }}>
              <Stack spacing={1.5}>
                <Typography component="h2" variant="h6">
                  {title}
                </Typography>
                {kind === "packaging" && extras.packingRequested && (
                  <Typography variant="body2" color="text.secondary">
                    Kunde möchte Verpackungsmaterial kaufen.
                  </Typography>
                )}
                {visibleServices.map((service, index) => (
                  <Grid
                    container
                    spacing={1}
                    key={`${kind}-${index}`}
                    sx={{ alignItems: "center" }}
                  >
                    <Grid size={{ xs: 12, sm: 7 }}>
                      <Autocomplete
                        freeSolo
                        options={catalog.filter((item) => item.kind === kind)}
                        value={
                          catalog.find(
                            (item) =>
                              item.kind === kind &&
                              item.id === service.catalogId,
                          ) ?? null
                        }
                        inputValue={service.name}
                        getOptionLabel={(option) =>
                          typeof option === "string" ? option : option.name
                        }
                        isOptionEqualToValue={(option, selected) =>
                          typeof selected !== "string" &&
                          option.id === selected.id
                        }
                        onInputChange={(_, inputValue, reason) => {
                          if (reason === "input" || reason === "clear")
                            updateService(
                              kind,
                              index,
                              {
                                name: inputValue,
                              },
                              true,
                            );
                        }}
                        onChange={(_, selected) => {
                          if (typeof selected === "string")
                            updateService(
                              kind,
                              index,
                              {
                                name: selected,
                              },
                              true,
                            );
                          else if (selected)
                            updateService(kind, index, {
                              catalogId: selected.id,
                              name: selected.name,
                              quantity: 1,
                              unitPrice: selected.price,
                            });
                          else updateService(kind, index, {}, true);
                        }}
                        renderInput={(params) => (
                          <TextField {...params} label={itemLabel} />
                        )}
                      />
                    </Grid>
                    <Grid size={{ xs: 3, sm: 2 }}>
                      <TextField
                        type="number"
                        label="Anzahl"
                        value={service.quantity}
                        onChange={(event) =>
                          updateService(kind, index, {
                            quantity: Number(event.target.value),
                          })
                        }
                      />
                    </Grid>
                    <Grid size={{ xs: 6, sm: 2 }}>
                      <TextField
                        type="number"
                        label="Einzelpreis (€)"
                        value={
                          service.unitPrice ??
                          (service.catalogId === undefined
                            ? ""
                            : (catalog.find(
                                (item) =>
                                  item.id === service.catalogId &&
                                  item.kind === kind,
                              )?.price ?? ""))
                        }
                        onChange={(event) => {
                          if (event.target.value === "")
                            updateService(kind, index, {}, false, true);
                          else
                            updateService(kind, index, {
                              unitPrice: Number(event.target.value),
                            });
                        }}
                        slotProps={{
                          htmlInput: { min: 0, max: 1_000_000, step: 0.01 },
                        }}
                      />
                    </Grid>
                    <Grid size={{ xs: 3, sm: 1 }}>
                      <Stack
                        direction="row"
                        sx={{
                          alignItems: "center",
                          justifyContent: "center",
                          minHeight: 40,
                        }}
                      >
                        <IconButton
                          size="small"
                          color="error"
                          aria-label={`${itemLabel} entfernen`}
                          onClick={() => removeService(kind, index)}
                        >
                          <DeleteOutlined />
                        </IconButton>
                      </Stack>
                    </Grid>
                  </Grid>
                ))}
                <Button
                  startIcon={<AddOutlined />}
                  onClick={() => addService(kind)}
                  sx={{ alignSelf: "flex-end" }}
                >
                  {addLabel}
                </Button>
              </Stack>
            </Paper>
          </Grid>
        );
      })}
    </Grid>
  );
}
