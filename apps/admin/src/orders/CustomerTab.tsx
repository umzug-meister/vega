import {
  Alert,
  Box,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { CustomerFields } from "./CustomerFields.js";
import type { OrderFormValue } from "./order-form-types.js";

interface CustomerTabProps {
  value: OrderFormValue;
  update: (patch: Partial<OrderFormValue>) => void;
}

export function CustomerTab({ value, update }: CustomerTabProps) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "minmax(0, 1fr)",
          md: "repeat(2, minmax(0, 1fr))",
        },
        columnGap: 2,
        rowGap: 4,
      }}
    >
      <Paper variant="outlined" sx={{ p: 1, minWidth: 0 }}>
        <CustomerFields
          value={value.customer}
          onChange={(customer) =>
            update({ customer: { ...value.customer, ...customer } })
          }
        />
      </Paper>
      <Paper variant="outlined" sx={{ p: 1, minWidth: 0 }}>
        <Stack spacing={3}>
          <Stack spacing={1.5}>
            <Typography component="h2" variant="h6">
              Notiz
            </Typography>
            <TextField
              multiline
              minRows={7}
              value={value.note ?? ""}
              onChange={(event) => update({ note: event.target.value })}
              slotProps={{ htmlInput: { maxLength: 5000 } }}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={value.costsAssumption ?? false}
                  onChange={(event) =>
                    update({ costsAssumption: event.target.checked })
                  }
                />
              }
              label="Kostenübernahme durch Arbeitsamt"
            />
            {value.costsAssumption && (
              <Alert severity="info">
                Für die Kostenübernahme wird meist ein Festpreisangebot
                benötigt.
              </Alert>
            )}
            {value.visitWanted && (
              <Alert severity="info">
                Der Kunde möchte wegen eines kostenlosen Besichtigungstermins
                kontaktiert werden.
              </Alert>
            )}
          </Stack>
          <Stack spacing={1.5}>
            <Typography component="h2" variant="h6">
              Auftrag
            </Typography>
            <TextField
              select
              label="Quelle"
              value={value.orderSource ?? "individuelle"}
              onChange={(event) =>
                update({
                  orderSource: event.target.value as NonNullable<
                    OrderFormValue["orderSource"]
                  >,
                })
              }
            >
              <MenuItem value="individuelle">individuelle</MenuItem>
              <MenuItem value="check24">CHECK24</MenuItem>
              <MenuItem value="umzugruckzuck.de">umzugruckzuck.de</MenuItem>
              {value.orderSource === "umzugruckzuck24.de" && (
                <MenuItem value="umzugruckzuck24.de">umzugruckzuck24.de</MenuItem>
              )}
            </TextField>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
