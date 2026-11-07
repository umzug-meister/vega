import ShoppingCartCheckoutOutlined from "@mui/icons-material/ShoppingCartCheckoutOutlined";
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  CardMedia,
  Stack,
  TextField,
  Typography,
} from "@mui/material";

export function PackingPreview({
  name,
  price,
  description,
  media,
}: {
  name: string;
  price: number;
  description: string;
  media: string;
}) {
  const formattedPrice = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(price);

  return (
    <Card elevation={2} sx={{ bgcolor: "background.paper" }}>
      <CardHeader
        title={
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Typography variant="h5" color="primary">
              {name || "Verpackungsmaterial"}
            </Typography>
            <Typography variant="h5" color="primary">
              {formattedPrice}
            </Typography>
          </Box>
        }
      />
      {media && (
        <CardMedia
          component="img"
          image={media}
          alt={name}
          loading="lazy"
          referrerPolicy="no-referrer"
          sx={{ height: 240, objectFit: "contain", px: 2 }}
        />
      )}
      <CardContent>
        <Stack spacing={2}>
          <Typography
            component="div"
            variant="body2"
            dangerouslySetInnerHTML={{ __html: description }}
          />
          <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
            <TextField
              label="Anzahl"
              fullWidth={false}
              type="number"
              value=""
              slotProps={{
                htmlInput: { min: 0 },
                input: {
                  readOnly: true,
                  endAdornment: (
                    <ShoppingCartCheckoutOutlined color="disabled" />
                  ),
                },
              }}
              sx={{
                width: 180,
                "& input": {
                  border: "none !important",
                  padding: "10px !important",
                },
              }}
            />
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
