import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AddOutlined,
  CalculateOutlined,
  DeleteOutlined,
} from "@mui/icons-material";
import {
  Autocomplete,
  Box,
  Button,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Switch,
  Tabs,
  Tab,
  TextField,
  Typography,
} from "@mui/material";
import { AdminAlert as Alert } from "../components/AdminNotifications.js";
import type {
  CatalogFurnitureDto,
  CustomerFormConfig,
  OrderFurnitureInput,
} from "@vega/domain";
import { apiRequest } from "../api/api-request.js";
import type { OrderFormValue } from "./order-form-types.js";
import { OrderImages } from "./OrderImages.js";

interface FurnitureTabProps {
  value: OrderFormValue;
  update: (patch: Partial<OrderFormValue>) => void;
  onFurnitureChange: (
    furniture: OrderFormValue["details"]["furniture"],
  ) => void;
  orderNumber?: number;
}

function NonNegativeNumberField({
  label,
  value,
  step,
  endAdornment,
  onChange,
}: {
  label: string;
  value: number;
  step: number | "any";
  endAdornment?: ReactNode;
  onChange: (value: number) => void;
}) {
  const [inputValue, setInputValue] = useState(() =>
    value === 0 ? "" : String(value),
  );
  const lastValue = useRef(value);

  useEffect(() => {
    if (value === lastValue.current) return;
    lastValue.current = value;
    setInputValue(value === 0 ? "" : String(value));
  }, [value]);

  return (
    <TextField
      type="number"
      label={label}
      value={inputValue}
      onChange={(event) => {
        const rawValue = event.target.value;
        const nextValue = rawValue === "" ? 0 : Number(rawValue);
        lastValue.current = nextValue;
        setInputValue(rawValue);
        onChange(nextValue);
      }}
      slotProps={{
        htmlInput: { min: 0, step },
        input: endAdornment ? { endAdornment } : {},
      }}
    />
  );
}

export function calculateFurnitureVolume(
  furniture: OrderFormValue["details"]["furniture"],
  config: Pick<CustomerFormConfig, "boxVolume" | "wardrobeBoxVolume">,
) {
  return {
    volume:
      furniture.items.reduce(
        (total, item) => total + item.quantity * (item.volume ?? 0),
        0,
      ) +
      furniture.boxes * (config.boxVolume ?? 0) +
      furniture.wardrobeBoxes * (config.wardrobeBoxVolume ?? 0),
    volumeComplete:
      !(furniture.boxes > 0 && config.boxVolume === null) &&
      !(furniture.wardrobeBoxes > 0 && config.wardrobeBoxVolume === null),
  };
}

export function FurnitureTab({
  value,
  update,
  onFurnitureChange,
  orderNumber,
}: FurnitureTabProps) {
  const [listTab, setListTab] = useState(0);
  const [catalogFurniture, setCatalogFurniture] = useState<
    CatalogFurnitureDto[]
  >([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [volumeConfig, setVolumeConfig] = useState<CustomerFormConfig | null>(
    null,
  );
  const [volumeConfigError, setVolumeConfigError] = useState<string | null>(
    null,
  );
  const furniture = value.details.furniture;

  useEffect(() => {
    let active = true;
    apiRequest<CatalogFurnitureDto[]>("/api/catalog/furniture")
      .then((entries) => {
        if (active) setCatalogFurniture(entries);
      })
      .catch((cause: unknown) => {
        if (active)
          setCatalogError(
            cause instanceof Error
              ? cause.message
              : "Möbelkatalog konnte nicht geladen werden.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    apiRequest<CustomerFormConfig>("/api/customer-form/config")
      .then((config) => {
        if (active) setVolumeConfig(config);
      })
      .catch((cause: unknown) => {
        if (active)
          setVolumeConfigError(
            cause instanceof Error
              ? cause.message
              : "Volumenkonfiguration konnte nicht geladen werden.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  function updateFurniture(patch: Partial<typeof furniture>) {
    onFurnitureChange({ ...furniture, ...patch });
  }

  function recalculateVolume() {
    if (!volumeConfig) return;
    updateFurniture(calculateFurnitureVolume(furniture, volumeConfig));
  }

  function addItem() {
    updateFurniture({
      items: [...furniture.items, { name: "", quantity: 1, volume: 0 }],
    });
  }

  function updateItem(
    index: number,
    patch: Partial<OrderFurnitureInput>,
    clearCatalogSelection = false,
  ) {
    updateFurniture({
      items: furniture.items.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const updated = { ...item, ...patch };
        if (clearCatalogSelection) delete updated.catalogId;
        return updated;
      }),
    });
  }

  return (
    <Stack spacing={2}>
      {orderNumber !== undefined && <OrderImages orderNumber={orderNumber} />}
      <Grid container spacing={2} sx={{ alignItems: "stretch" }}>
        <Grid
          size={{ xs: 12, sm: 6, lg: 4 }}
          sx={{ display: "flex", alignItems: "stretch" }}
        >
          <Paper variant="outlined" sx={{ p: 2.5, flex: 1 }}>
            <Stack spacing={1.5}>
              <Typography component="h2" variant="h6">
                Auszug
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={value.from.packservice ?? false}
                    onChange={(event) =>
                      update({
                        from: {
                          ...value.from,
                          packservice: event.target.checked,
                        },
                      })
                    }
                  />
                }
                label="Einpacken erwünscht?"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={value.from.demontage ?? false}
                    onChange={(event) =>
                      update({
                        from: {
                          ...value.from,
                          demontage: event.target.checked,
                        },
                      })
                    }
                  />
                }
                label="Abbau erwünscht?"
              />
              <NonNegativeNumberField
                label="Betten"
                value={value.from.bedNumber ?? 0}
                step={1}
                onChange={(bedNumber) =>
                  update({ from: { ...value.from, bedNumber } })
                }
              />
              <NonNegativeNumberField
                label="Schränke-Gesamtbreite"
                value={value.from.wardrobeWidth ?? 0}
                step="any"
                endAdornment={<InputAdornment position="end">m</InputAdornment>}
                onChange={(wardrobeWidth) =>
                  update({ from: { ...value.from, wardrobeWidth } })
                }
              />
              <NonNegativeNumberField
                label="Küche-Gesamtbreite"
                value={value.from.kitchenWidth ?? 0}
                step="any"
                endAdornment={<InputAdornment position="end">m</InputAdornment>}
                onChange={(kitchenWidth) =>
                  update({ from: { ...value.from, kitchenWidth } })
                }
              />
            </Stack>
          </Paper>
        </Grid>
        <Grid
          size={{ xs: 12, sm: 6, lg: 4 }}
          sx={{ display: "flex", alignItems: "stretch" }}
        >
          <Paper variant="outlined" sx={{ p: 2.5, flex: 1 }}>
            <Stack spacing={1.5}>
              <Typography component="h2" variant="h6">
                Einzug
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={value.to.packservice ?? false}
                    onChange={(event) =>
                      update({
                        to: { ...value.to, packservice: event.target.checked },
                      })
                    }
                  />
                }
                label="Auspacken erwünscht?"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={value.to.montage ?? false}
                    onChange={(event) =>
                      update({
                        to: { ...value.to, montage: event.target.checked },
                      })
                    }
                  />
                }
                label="Aufbau erwünscht?"
              />
            </Stack>
          </Paper>
        </Grid>
        <Grid
          size={{ xs: 12, sm: 12, lg: 4 }}
          sx={{ display: "flex", alignItems: "stretch" }}
        >
          <Paper variant="outlined" sx={{ p: 2.5, flex: 1 }}>
            <Stack spacing={1.5}>
              <Typography component="h2" variant="h6">
                Kartons
              </Typography>
              <NonNegativeNumberField
                label="Kartons"
                value={furniture.boxes}
                step={1}
                onChange={(boxes) => updateFurniture({ boxes })}
              />
              <NonNegativeNumberField
                label="Kleiderboxen"
                value={furniture.wardrobeBoxes}
                step={1}
                onChange={(wardrobeBoxes) => updateFurniture({ wardrobeBoxes })}
              />
            </Stack>
          </Paper>
        </Grid>
      </Grid>

      <Grid container spacing={2} sx={{ alignItems: "start" }}>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
            <Stack spacing={1.5}>
              <Typography component="h2" variant="h6">
                Besondere Gegenstände
              </Typography>
              <Alert severity="info">
                Das berechnete Umzugsvolumen beinhaltet keine besonderen
                Gegenstände.
              </Alert>
              <FormControlLabel
                control={
                  <Switch
                    checked={furniture.expensive}
                    onChange={(event) =>
                      updateFurniture({ expensive: event.target.checked })
                    }
                  />
                }
                label="Antik/Wertvoll angegeben?"
              />
              {furniture.expensive && (
                <TextField
                  multiline
                  minRows={2}
                  label="Besonders wertvolle Gegenstände"
                  value={furniture.expensiveText}
                  onChange={(event) =>
                    updateFurniture({ expensiveText: event.target.value })
                  }
                />
              )}
              <FormControlLabel
                control={
                  <Switch
                    checked={furniture.heavy}
                    onChange={(event) =>
                      updateFurniture({ heavy: event.target.checked })
                    }
                  />
                }
                label="Besonders schwer angegeben?"
              />
              {furniture.heavy && (
                <TextField
                  multiline
                  minRows={2}
                  label="Besonders schwere Gegenstände"
                  value={furniture.heavyText}
                  onChange={(event) =>
                    updateFurniture({ heavyText: event.target.value })
                  }
                />
              )}
              <FormControlLabel
                control={
                  <Switch
                    checked={furniture.bulky}
                    onChange={(event) =>
                      updateFurniture({ bulky: event.target.checked })
                    }
                  />
                }
                label="Sperrige Gegenstände angegeben?"
              />
              {furniture.bulky && (
                <TextField
                  multiline
                  minRows={2}
                  label="Sperrige Gegenstände"
                  value={furniture.bulkyText}
                  onChange={(event) =>
                    updateFurniture({ bulkyText: event.target.value })
                  }
                />
              )}
            </Stack>
          </Paper>
        </Grid>

        <Grid size={{ xs: 12, lg: 8 }}>
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, minWidth: 0 }}>
            <Stack spacing={1.5}>
              <Typography component="h2" variant="h6">
                Möbelliste
              </Typography>
              {furniture.volumeComplete === false && (
                <Alert severity="warning">
                  Das übertragene Volumen ist unvollständig: Die Kartonanzahl
                  wurde erfasst, aber die Kartonvolumina waren noch nicht
                  konfiguriert.
                </Alert>
              )}
              {volumeConfigError && (
                <Alert severity="error">{volumeConfigError}</Alert>
              )}
              <Grid container spacing={1} sx={{ alignItems: "center" }}>
                <Grid size={{ xs: 12, sm: 7, md: 7 }}>
                  <TextField
                    fullWidth
                    type="number"
                    label="Berechnetes Umzugsvolumen (m³)"
                    value={furniture.volume}
                    onChange={(event) =>
                      updateFurniture({
                        volume: Number(event.target.value),
                        volumeComplete: true,
                      })
                    }
                  />
                </Grid>
                <Grid
                  size={{ xs: 12, sm: 5, md: 5 }}
                  sx={{ display: "flex", justifyContent: "flex-end" }}
                >
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<CalculateOutlined />}
                    disabled={!volumeConfig}
                    onClick={recalculateVolume}
                    sx={{ whiteSpace: "nowrap" }}
                  >
                    Volumen neu berechnen
                  </Button>
                </Grid>
              </Grid>
              <Tabs
                value={listTab}
                onChange={(_, next: number) => setListTab(next)}
                variant="scrollable"
                allowScrollButtonsMobile
              >
                <Tab label="Übertragene Liste" />
                <Tab label="Manuelle Liste" />
              </Tabs>
              {listTab === 0 ? (
                <Stack spacing={1.5}>
                  {catalogError && (
                    <Alert severity="error">{catalogError}</Alert>
                  )}
                  {furniture.items.map((item, index) => (
                    <Grid
                      container
                      spacing={1}
                      key={`item-${index}`}
                      sx={{ alignItems: "center" }}
                    >
                      <Grid size={{ xs: 12, sm: 7 }}>
                        <Autocomplete
                          freeSolo
                          options={catalogFurniture}
                          value={
                            catalogFurniture.find(
                              (entry) => entry.id === item.catalogId,
                            ) ?? null
                          }
                          inputValue={item.name}
                          getOptionLabel={(option) =>
                            typeof option === "string" ? option : option.name
                          }
                          isOptionEqualToValue={(option, selected) =>
                            typeof selected !== "string" &&
                            option.id === selected.id
                          }
                          onInputChange={(_, inputValue, reason) => {
                            if (reason === "input" || reason === "clear")
                              updateItem(index, { name: inputValue }, true);
                          }}
                          onChange={(_, selected) => {
                            if (typeof selected === "string")
                              updateItem(index, { name: selected }, true);
                            else if (selected)
                              updateItem(index, {
                                catalogId: selected.id,
                                name: selected.name,
                                volume: selected.volume,
                                ...(selected.categoryRefs[0]
                                  ? { category: selected.categoryRefs[0].name }
                                  : {}),
                              });
                            else updateItem(index, {}, true);
                          }}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              label="Möbel / Beschreibung"
                            />
                          )}
                        />
                      </Grid>
                      <Grid size={{ xs: 5, sm: 2 }}>
                        <TextField
                          type="number"
                          label="Anzahl"
                          value={item.quantity}
                          onChange={(event) =>
                            updateItem(index, {
                              quantity: Number(event.target.value),
                            })
                          }
                        />
                      </Grid>
                      <Grid size={{ xs: 5, sm: 2 }}>
                        <TextField
                          type="number"
                          label="m³"
                          value={item.volume ?? 0}
                          onChange={(event) =>
                            updateItem(index, {
                              volume: Number(event.target.value),
                            })
                          }
                        />
                      </Grid>
                      <Grid size={{ xs: 2, sm: 1 }}>
                        <IconButton
                          size="small"
                          aria-label="Möbelposition löschen"
                          onClick={() =>
                            updateFurniture({
                              items: furniture.items.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            })
                          }
                        >
                          <DeleteOutlined />
                        </IconButton>
                      </Grid>
                    </Grid>
                  ))}
                  <Button
                    startIcon={<AddOutlined />}
                    onClick={addItem}
                    sx={{ alignSelf: "flex-end" }}
                  >
                    Möbel hinzufügen
                  </Button>
                </Stack>
              ) : (
                <TextField
                  multiline
                  minRows={8}
                  label="Manuelle Möbelliste"
                  value={furniture.ownItems}
                  onChange={(event) =>
                    updateFurniture({ ownItems: event.target.value })
                  }
                />
              )}
            </Stack>
          </Paper>
        </Grid>
      </Grid>
    </Stack>
  );
}
