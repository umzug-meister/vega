import {
  Autocomplete,
  Grid,
  IconButton,
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

interface CatalogItem {
  id: number;
  name: string;
  price: number;
  kind: "packaging" | "service";
}

interface ServiceRow {
  key: string;
  service: OrderServiceInput;
  catalogItem: CatalogItem | null;
  index: number | null;
}

export function ExtrasTab({ value, onExtrasChange }: ExtrasTabProps) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
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

  function updateCatalogService(
    item: CatalogItem,
    index: number | null,
    patch: Partial<OrderServiceInput>,
    clearUnitPrice = false,
  ) {
    if (index !== null) {
      updateService(item.kind, index, patch, false, clearUnitPrice);
      return;
    }
    const service: OrderServiceInput = {
      kind: item.kind,
      catalogId: item.id,
      name: item.name,
      quantity: 0,
      unitPrice: item.price,
      ...patch,
    };
    if (clearUnitPrice) delete service.unitPrice;
    onExtrasChange({ ...extras, services: [...extras.services, service] });
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
          },
          {
            kind: "service",
            title: "Leistungen",
            itemLabel: "Leistung",
          },
        ] as const
      ).map(({ kind, title, itemLabel }) => {
        const visibleServices = extras.services.filter(
          (service) => service.kind === kind,
        );
        const catalogItems = catalog.filter((item) => item.kind === kind);
        const usedServiceIndexes = new Set<number>();
        const rows: ServiceRow[] = catalogItems.map((item) => {
          const index = visibleServices.findIndex(
            (service, serviceIndex) =>
              !usedServiceIndexes.has(serviceIndex) &&
              service.catalogId === item.id,
          );
          if (index >= 0) usedServiceIndexes.add(index);
          return {
            key: `catalog-${item.id}`,
            service:
              index >= 0
                ? visibleServices[index]!
                : {
                    catalogId: item.id,
                    name: item.name,
                    kind,
                    quantity: 0,
                    unitPrice: item.price,
                  },
            catalogItem: item,
            index: index >= 0 ? index : null,
          };
        });
        visibleServices.forEach((service, index) => {
          if (!usedServiceIndexes.has(index))
            rows.push({
              key: `saved-${index}`,
              service,
              catalogItem: null,
              index,
            });
        });
        return (
          <Grid size={{ xs: 12, lg: 6 }} key={kind}>
            <Paper variant="outlined" sx={{ p: 1, height: "100%" }}>
              <Stack spacing={1.5}>
                <Typography component="h2" variant="h6">
                  {title}
                </Typography>
                {kind === "packaging" && extras.packingRequested && (
                  <Typography variant="body2" color="text.secondary">
                    Kunde möchte Verpackungsmaterial kaufen.
                  </Typography>
                )}
                <TableContainer
                  sx={{ width: "100%", maxWidth: "100%", overflowX: "auto" }}
                >
                  <Table
                    size="small"
                    aria-label={title}
                    sx={{
                      minWidth: 480,
                      "& .MuiTableCell-root": { py: 0.5 },
                      "& .MuiOutlinedInput-root": { minHeight: 38 },
                    }}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell>{itemLabel}</TableCell>
                        <TableCell>Anzahl</TableCell>
                        <TableCell>Einzelpreis (€)</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                    {rows.map(({ key, service, catalogItem, index }) => {
                  const updateRow = (
                    patch: Partial<OrderServiceInput>,
                    clearCatalogSelection = false,
                    clearUnitPrice = false,
                  ) => {
                    if (catalogItem) {
                      updateCatalogService(
                        catalogItem,
                        index,
                        patch,
                        clearUnitPrice,
                      );
                    } else if (index !== null) {
                      updateService(
                        kind,
                        index,
                        patch,
                        clearCatalogSelection,
                        clearUnitPrice,
                      );
                    }
                  };
                  const isSelected = service.quantity > 0;
                  return (
                    <TableRow
                      key={key}
                      sx={{ "& td": { fontWeight: isSelected ? 700 : 400 } }}
                    >
                      <TableCell sx={{ minWidth: 180 }}>
                        {catalogItem ? (
                          <Typography
                            sx={{ fontWeight: isSelected ? 700 : 400 }}
                          >
                            {catalogItem.name}
                          </Typography>
                        ) : (
                          <Autocomplete
                            freeSolo
                            options={catalogItems}
                            value={
                              catalogItems.find(
                                (item) => item.id === service.catalogId,
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
                                updateRow({ name: inputValue }, true);
                            }}
                            onChange={(_, selected) => {
                              if (typeof selected === "string")
                                updateRow({ name: selected }, true);
                              else if (selected)
                                updateRow({
                                  catalogId: selected.id,
                                  name: selected.name,
                                  quantity: 1,
                                  unitPrice: selected.price,
                                });
                              else updateRow({}, true);
                            }}
                            renderInput={(params) => (
                              <TextField
                                {...params}
                                aria-label={itemLabel}
                                sx={{
                                  "& .MuiInputBase-input": {
                                    fontWeight: isSelected ? 700 : 400,
                                  },
                                }}
                              />
                            )}
                          />
                        )}
                      </TableCell>
                      <TableCell sx={{ width: 110 }}>
                        <TextField
                          type="number"
                          value={service.quantity || ""}
                          onChange={(event) =>
                            updateRow({
                              quantity:
                                event.target.value === ""
                                  ? 0
                                  : Number(event.target.value),
                            })
                          }
                          slotProps={{
                            htmlInput: {
                              min: 0,
                              "aria-label": `Anzahl ${service.name}`,
                            },
                          }}
                          sx={{
                            "& .MuiInputBase-input": {
                              fontWeight: isSelected ? 700 : 400,
                            },
                          }}
                        />
                      </TableCell>
                      <TableCell sx={{ width: 150 }}>
                        <TextField
                          type="number"
                          value={
                            service.unitPrice ??
                            (service.catalogId === undefined
                              ? ""
                              : (catalogItems.find(
                                  (item) => item.id === service.catalogId,
                                )?.price ?? ""))
                          }
                          onChange={(event) => {
                            if (event.target.value === "")
                              updateRow({}, false, true);
                            else
                              updateRow({
                                unitPrice: Number(event.target.value),
                              });
                          }}
                          slotProps={{
                            htmlInput: {
                              min: 0,
                              max: 1_000_000,
                              step: 0.01,
                              "aria-label": `Einzelpreis für ${service.name}`,
                            },
                          }}
                          sx={{
                            "& .MuiInputBase-input": {
                              fontWeight: isSelected ? 700 : 400,
                            },
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                    })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Stack>
            </Paper>
          </Grid>
        );
      })}
    </Grid>
  );
}
