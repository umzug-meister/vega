import { Fragment, type Dispatch, type SetStateAction } from "react";
import {
  Box,
  Button,
  Divider,
  FormLabel,
  Grid,
  IconButton,
  InputAdornment,
  Paper,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import AddOutlined from "@mui/icons-material/AddOutlined";
import DeleteOutline from "@mui/icons-material/DeleteOutlineOutlined";
import type { OrderAddressInput } from "@vega/domain";
import { AddressFields } from "./AddressFields.js";
import { SelectField } from "./SelectField.js";
import {
  Column,
  Field,
  Heading,
  Info,
  Section,
  SwitchField,
} from "./components.js";
import {
  areas,
  euro,
  floors,
  liftTypes,
  movementObjects,
  newSpecialItem,
  parkingDistances,
  suggestVisit,
  type FormDraft,
  type FormResources,
  type SpecialItem,
} from "./form-model.js";

export interface StepProps {
  draft: FormDraft;
  setDraft: Dispatch<SetStateAction<FormDraft>>;
  resources: FormResources;
}

function SpecialItems({
  value,
  onChange,
  dimensions,
  weight,
}: {
  value: SpecialItem[];
  onChange: (items: SpecialItem[]) => void;
  dimensions?: boolean;
  weight?: boolean;
}) {
  const fields: Array<[keyof SpecialItem, string, string?]> = [
    ["name", "Bezeichnung"],
    ...(dimensions
      ? ([
          ["width", "Breite", "cm"],
          ["depth", "Tiefe", "cm"],
          ["height", "Höhe", "cm"],
        ] as Array<[keyof SpecialItem, string, string]>)
      : []),
    ...(weight
      ? ([["weight", "Gewicht", "kg"]] as Array<
          [keyof SpecialItem, string, string]
        >)
      : []),
    ["quantity", "Anzahl"],
  ];
  return (
    <Column>
      {value.map((item) => (
        <Fragment key={item.id}>
          <Grid container spacing={1} sx={{ alignItems: "center" }}>
            <Grid size={{ xs: 2, sm: 1 }}>
              <IconButton
                color="error"
                aria-label="Gegenstand entfernen"
                onClick={() =>
                  onChange(value.filter((entry) => entry.id !== item.id))
                }
              >
                <DeleteOutline />
              </IconButton>
            </Grid>
            {fields.map(([key, label, unit]) => (
              <Grid
                key={key}
                size={
                  key === "name"
                    ? { xs: 10, sm: 5, md: 3 }
                    : { xs: 4, sm: 3, md: 2 }
                }
              >
                <Field
                  label={label}
                  value={item[key]}
                  type={key === "name" ? "text" : "number"}
                  slotProps={{
                    htmlInput: { min: 0 },
                    input: {
                      endAdornment: unit ? (
                        <InputAdornment position="end">{unit}</InputAdornment>
                      ) : undefined,
                    },
                  }}
                  onChange={(event) =>
                    onChange(
                      value.map((entry) =>
                        entry.id === item.id
                          ? { ...entry, [key]: event.target.value }
                          : entry,
                      ),
                    )
                  }
                />
              </Grid>
            ))}
          </Grid>
          <Divider />
        </Fragment>
      ))}
      <Box sx={{ display: "flex", justifyContent: "end" }}>
        <Button
          color="info"
          variant="contained"
          size="small"
          startIcon={<AddOutlined />}
          onClick={() => onChange([...value, newSpecialItem()])}
        >
          Zeile
        </Button>
      </Box>
    </Column>
  );
}

export function MovingStep({
  draft,
  setDraft,
  resources,
  departure,
}: StepProps & { departure: boolean }) {
  const path = departure ? "from" : "to";
  const address = draft[path];
  const update = (patch: Partial<typeof address>) =>
    setDraft((current) => ({
      ...current,
      [path]: { ...current[path], ...patch },
    }));
  const toggle = (
    key:
      | "parkingSlot"
      | "isAltbau"
      | "hasLoft"
      | "hasBasement"
      | "hasGarage"
      | "packservice"
      | "demontage"
      | "montage",
    label: string,
  ) => (
    <SwitchField
      label={label}
      value={Boolean(address[key])}
      onChange={(value) => update({ [key]: value })}
    />
  );
  const number = (
    key: "kitchenWidth" | "wardrobeWidth" | "bedNumber" | "roomsToRelocate",
    label: string,
    unit?: string,
    helperText?: string,
  ) => (
    <Field
      label={label}
      type="number"
      value={address[key]}
      helperText={helperText}
      slotProps={{
        htmlInput: { min: 0 },
        input: {
          endAdornment: unit ? (
            <InputAdornment position="end">{unit}</InputAdornment>
          ) : undefined,
        },
      }}
      onChange={(event) => update({ [key]: event.target.value })}
    />
  );
  const hvz = resources.rates.find((rate) => rate.key === "hvzPrice");
  return (
    <Section title={departure ? "Auszug" : "Einzug"}>
      <AddressFields
        address={address}
        update={update}
        autocomplete={resources.config.placesAvailable}
      />
      <SwitchField
        label="Park und Beladezone"
        value={Boolean(address.parkingSlot)}
        onChange={(parkingSlot) => update({ parkingSlot })}
        labels={{
          true: "Vom Spediteur zu organisieren",
          false: "Wird von Kund:innen sichergestellt",
        }}
      />
      {address.parkingSlot && (
        <Info>
          {hvz
            ? `Die Kosten für die Einrichtung einer Halteverbotszone, einschließlich der Beantragung beim KVR, der Aufstellung sowie dem Abbau der Schilder, belaufen sich derzeit auf ${euro(hvz.price)}.`
            : "Die Kosten für die Halteverbotszone sind noch nicht hinterlegt. Wir informieren Sie im Angebot."}
        </Info>
      )}
      <SelectField
        label="Entfernung vom Parkplatz zur Haustür"
        value={address.runningDistance}
        options={parkingDistances}
        onChange={(runningDistance) => update({ runningDistance })}
      />
      <SelectField
        label={departure ? "Auszug aus" : "Einzug in"}
        value={address.movementObject}
        options={movementObjects}
        onChange={(value) =>
          update({
            movementObject: value as NonNullable<
              OrderAddressInput["movementObject"]
            >,
          })
        }
      />
      {address.movementObject === "Haus" ? (
        <Paper
          elevation={0}
          sx={{
            display: "flex",
            border: (theme) => `1px solid ${theme.palette.grey[400]}`,
            flexWrap: "wrap",
          }}
        >
          <ToggleButtonGroup
            fullWidth
            color="primary"
            value={address.stockwerke ?? []}
            onChange={(_, stockwerke: string[]) => update({ stockwerke })}
            sx={{
              "& .MuiToggleButtonGroup-grouped": {
                m: 0.5,
                border: 0,
                borderRadius: "5px !important",
              },
            }}
          >
            {["UG", "EG", "1.OG", "2.OG"].map((floor) => (
              <ToggleButton key={floor} value={floor}>
                {floor}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Paper>
      ) : (
        <>
          <SelectField
            label="Stockwerk"
            value={address.floor}
            options={floors}
            onChange={(floor) => update({ floor })}
          />
          <SelectField
            label="Aufzug"
            value={address.liftType}
            options={liftTypes}
            onChange={(liftType) => update({ liftType })}
          />
          {toggle("isAltbau", "Altbau")}
          {!departure && toggle("hasLoft", "Dachboden")}
        </>
      )}
      {departure && (
        <>
          <Field
            required
            label="Anzahl der Zimmer"
            type="number"
            value={address.roomsNumber ?? ""}
            slotProps={{ htmlInput: { min: 1, max: 100 } }}
            onChange={(event) => update({ roomsNumber: event.target.value })}
          />
          {suggestVisit(draft) && (
            <>
              <Info>
                Wir empfehlen Ihnen einen kostenlosen Besichtigungstermin vor
                Ort für eine bessere Planung Ihres Umzugs
              </Info>
              <SwitchField
                label="Sollen wir Sie kontaktieren, um einen Besichtigungstermin zu vereinbaren?"
                value={draft.visitWanted}
                onChange={(visitWanted) =>
                  setDraft((current) => ({ ...current, visitWanted }))
                }
              />
            </>
          )}
          {number(
            "roomsToRelocate",
            "Anzahl der Zimmer zum Umziehen",
            undefined,
            "Falls nur ein Teil der Wohnung umgezogen wird",
          )}
          <SelectField
            label="Wohnfläche"
            value={address.area}
            options={areas}
            onChange={(area) => update({ area })}
          />
          <Heading>weitere Räumlichkeiten</Heading>
          {toggle("hasBasement", "Keller")}
          {toggle("hasLoft", "Dachboden")}
          {toggle("hasGarage", "Garage")}
        </>
      )}
      <Heading>gewünschte Leistungen</Heading>
      {toggle(
        "packservice",
        departure
          ? "Einpackservice (Umzugsgut in Kartons einpacken)"
          : "Auspackservice (Umzugsgut auspacken)",
      )}
      {departure ? (
        <>
          {toggle("demontage", "Möbel Abbau")}
          {address.demontage && (
            <Column>
              <Column>
                <Info>
                  Ein abschließender Aufbau der Küche ist zurzeit leider nicht
                  möglich.
                </Info>
                {number(
                  "kitchenWidth",
                  "Küchenbreite",
                  "Meter",
                  "Breite der Küchenzeile zum Abbauen",
                )}
              </Column>
              {number(
                "bedNumber",
                "Betten",
                "Stück",
                "Anzahl der Betten zum Abbauen",
              )}
              {number(
                "wardrobeWidth",
                "Gesamtbreite der Schränke",
                "Meter",
                "Breite aller Schränke zum Abbauen",
              )}
            </Column>
          )}
          <Heading>besondere Gegenstände</Heading>
          {(["bulky", "heavy", "expensive"] as const).map((key, index) => (
            <Fragment key={key}>
              <SwitchField
                label={
                  [
                    "Sperrige und nicht zerlegbare Gegenstände",
                    "Besonders schwere Gegenstände, ab 100kg",
                    "Antike und sehr wertvolle",
                  ][index]
                }
                value={draft[key]}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, [key]: value }))
                }
              />
              {draft[key] && (
                <SpecialItems
                  value={draft[`${key}Items`]}
                  dimensions={key !== "expensive"}
                  weight={key === "heavy"}
                  onChange={(items) =>
                    setDraft((current) => ({
                      ...current,
                      [`${key}Items`]: items,
                    }))
                  }
                />
              )}
            </Fragment>
          ))}
        </>
      ) : (
        <>
          {toggle("montage", "Möbel Aufbau")}
          {address.montage && (
            <Info>
              Wir montieren ausschließlich Möbelstücke, die zuvor von uns
              abgebaut wurden. Bitte beachten Sie, dass der Aufbau keine&nbsp;
              <b>Bohrarbeiten</b> oder das Aufhängen von Elementen umfasst.
              Falls Sie solche <b>Bohrarbeiten</b> wünschen, teilen Sie uns dies
              hier mit.
            </Info>
          )}
          <Heading>gewünschte Bohrarbieten</Heading>
          <Column>
            <Grid container spacing={2} sx={{ alignItems: "center" }}>
              {resources.services.map((service) => (
                <Fragment key={service.id}>
                  <Grid size={{ xs: 12, sm: 8 }}>
                    <FormLabel>{service.name}</FormLabel>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 2 }}>
                    <Typography color="primary.light">
                      {euro(service.price)}
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 6, sm: 2 }}>
                    <Field
                      placeholder="Anzahl"
                      type="number"
                      value={draft.quantities[`service:${service.id}`] || ""}
                      slotProps={{
                        htmlInput: {
                          min: 0,
                          "aria-label": `Anzahl ${service.name}`,
                        },
                      }}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          quantities: {
                            ...current.quantities,
                            [`service:${service.id}`]: Math.max(
                              0,
                              Number(event.target.value),
                            ),
                          },
                        }))
                      }
                    />
                  </Grid>
                  <Grid size={12}>
                    <Divider />
                  </Grid>
                </Fragment>
              ))}
              {!resources.services.length && (
                <Grid size={12}>
                  <Typography color="text.secondary">
                    Derzeit sind keine Bohrarbeiten hinterlegt.
                  </Typography>
                </Grid>
              )}
            </Grid>
          </Column>
        </>
      )}
    </Section>
  );
}
