import {
  Alert,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import {
  ORDER_ADDRESS_LIFT_TYPES,
  ORDER_ADDRESS_MOVEMENT_OBJECTS,
} from "@vega/domain";
import type { OrderAddressInput } from "@vega/domain";
import { PlaceAutocompleteField } from "../places/PlaceAutocompleteField.js";

const floors = [
  "UG",
  "EG",
  ...Array.from({ length: 8 }, (_, index) => `${index + 1}. Etage`),
  "9+ Etage",
];
const houseFloors = ["UG", "EG", "1.OG", "2.OG"] as const;
const parkingDistances = Array.from(
  { length: 10 },
  (_, index) => `${(index + 1) * 10} m.`,
);
const areas = Array.from({ length: 15 }, (_, index) => `${(index + 1) * 10} m²`);

interface AddressFieldsProps {
  title: string;
  value: OrderAddressInput;
  onChange: (value: Partial<OrderAddressInput>) => void;
  showApartmentDetails?: boolean | undefined;
  /** Fired when a route-relevant field (street, postal code, city) loses focus. */
  onRouteFieldBlur?: (() => void) | undefined;
}

export function AddressFields({
  title,
  value,
  onChange,
  onRouteFieldBlur,
  showApartmentDetails = true,
}: AddressFieldsProps) {
  return (
    <Stack spacing={1.25}>
      {title && (
        <Typography component="h3" variant="h6">
          {title}
        </Typography>
      )}
      <PlaceAutocompleteField
        label="Adresse"
        value={value.street}
        maxLength={160}
        onInput={(street) => onChange({ street })}
        onSelect={onChange}
        onBlur={() => onRouteFieldBlur?.()}
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TextField
          label="PLZ"
          value={value.postalCode}
          onChange={(event) => onChange({ postalCode: event.target.value })}
          onBlur={() => onRouteFieldBlur?.()}
          slotProps={{ htmlInput: { maxLength: 16 } }}
          sx={{ flex: 1 }}
        />
        <TextField
          label="Ort"
          value={value.city}
          onChange={(event) => onChange({ city: event.target.value })}
          onBlur={() => onRouteFieldBlur?.()}
          slotProps={{ htmlInput: { maxLength: 100 } }}
          sx={{ flex: 2 }}
        />
      </Stack>
      <TextField
        select
        label="Entfernung bis zum Parkplatz"
        value={value.runningDistance ?? ""}
        onChange={(event) => onChange({ runningDistance: event.target.value })}
      >
        {parkingDistances.map((distance) => (
          <MenuItem key={distance} value={distance}>
            {distance}
          </MenuItem>
        ))}
      </TextField>
      <FormControlLabel
        control={
          <Switch
            checked={value.parkingSlot ?? false}
            onChange={(event) => onChange({ parkingSlot: event.target.checked })}
          />
        }
        label="Halteverbot"
      />
      {value.parkingSlot &&
        value.city &&
        !["MÜNCHEN", "MUNICH", "MUENCHEN"].some((city) =>
          value.city.toUpperCase().includes(city),
        ) && (
          <Alert severity="warning">Halteverbot liegt außerhalb der Stadt.</Alert>
        )}
      <Typography color="text.secondary" variant="overline" align="center">
        Gebäude
      </Typography>
      <TextField
        select
        label="Objekt"
        value={value.movementObject ?? "Wohnung"}
        onChange={(event) =>
          onChange({
            movementObject: event.target.value as NonNullable<
              OrderAddressInput["movementObject"]
            >,
          })
        }
      >
        {ORDER_ADDRESS_MOVEMENT_OBJECTS.map((building) => (
          <MenuItem key={building} value={building}>
            {building}
          </MenuItem>
        ))}
      </TextField>
      {value.movementObject === "Haus" ? (
        <Stack spacing={1}>
          <Typography color="text.secondary" variant="overline" align="center">
            Stockwerke
          </Typography>
          <ToggleButtonGroup
            fullWidth
            size="small"
            color="primary"
            aria-label="Stockwerke auswählen"
            value={value.stockwerke ?? []}
            onChange={(_, stockwerke: string[]) => onChange({ stockwerke })}
            sx={{
              flexWrap: "wrap",
              "& .MuiToggleButtonGroup-grouped": { flex: "1 1 25%" },
            }}
          >
            {houseFloors.map((floor) => (
              <ToggleButton key={floor} value={floor} aria-label={floor}>
                {floor}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>
      ) : (
        <>
          <TextField
            select
            label="Etage"
            value={value.floor ?? ""}
            onChange={(event) => onChange({ floor: event.target.value })}
          >
            <MenuItem value="">Bitte wählen</MenuItem>
            {floors.map((floor) => (
              <MenuItem key={floor} value={floor}>
                {floor}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Aufzug"
            value={value.liftType ?? "kein Aufzug"}
            onChange={(event) => onChange({ liftType: event.target.value })}
          >
            {ORDER_ADDRESS_LIFT_TYPES.map((lift) => (
              <MenuItem key={lift} value={lift}>
                {lift}
              </MenuItem>
            ))}
          </TextField>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            useFlexGap
            sx={{ flexWrap: "wrap" }}
          >
            <FormControlLabel
              control={
                <Switch
                  checked={value.isAltbau ?? false}
                  onChange={(event) => onChange({ isAltbau: event.target.checked })}
                />
              }
              label="Altbau"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={value.hasLoft ?? false}
                  onChange={(event) => onChange({ hasLoft: event.target.checked })}
                />
              }
              label="Dachboden"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={value.hasBasement ?? false}
                  onChange={(event) => onChange({ hasBasement: event.target.checked })}
                />
              }
              label="Keller"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={value.hasGarage ?? false}
                  onChange={(event) => onChange({ hasGarage: event.target.checked })}
                />
              }
              label="Garage"
            />
          </Stack>
        </>
      )}
      {showApartmentDetails && (
        <>
          <Typography color="text.secondary" variant="overline" align="center">
            Wohnung
          </Typography>
          <TextField
            select
            label="Fläche"
            value={value.area ?? ""}
            onChange={(event) => onChange({ area: event.target.value })}
          >
            <MenuItem value="">Bitte wählen</MenuItem>
            {areas.map((area) => (
              <MenuItem key={area} value={area}>
                {area}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Zimmer"
            type="number"
            value={value.roomsNumber ?? ""}
            onChange={(event) => onChange({ roomsNumber: event.target.value })}
          />
          <TextField
            label="Zimmer zum Umziehen"
            type="number"
            value={value.roomsToRelocate || ""}
            onChange={(event) => onChange({ roomsToRelocate: Number(event.target.value) })}
          />
        </>
      )}
    </Stack>
  );
}
