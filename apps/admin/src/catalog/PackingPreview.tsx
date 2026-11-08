import ShoppingCartCheckoutOutlined from "@mui/icons-material/ShoppingCartCheckoutOutlined";
import { TextField, ThemeProvider } from "@mui/material";
import type { ReactNode } from "react";
import { PackingCard } from "../../../customer-form/src/PackingCard.js";
import { theme } from "../../../customer-form/src/theme.js";

export function PackingPreview({
  name,
  price,
  description,
  media,
  action,
}: {
  name: string;
  price: number;
  description: string;
  media: string | null;
  action?: ReactNode;
}) {
  return (
    <ThemeProvider theme={theme}>
      <PackingCard
        name={name || "Verpackungsmaterial"}
        price={price}
        description={description}
        media={media}
        action={action}
        quantity={
          <TextField
            label="Anzahl"
            fullWidth={false}
            type="number"
            value=""
            slotProps={{
              htmlInput: { min: 0 },
              input: {
                readOnly: true,
                endAdornment: <ShoppingCartCheckoutOutlined color="disabled" />,
              },
            }}
            sx={{
              "& input": { border: "none !important", padding: "10px !important" },
              "& input[type=number]": { appearance: "textfield", MozAppearance: "textfield" },
              "& input[type=number]::-webkit-inner-spin-button": { display: "none" },
            }}
          />
        }
      />
    </ThemeProvider>
  );
}
