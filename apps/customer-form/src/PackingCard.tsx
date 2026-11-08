import { Box, Card, CardContent, CardHeader, CardMedia, Typography } from "@mui/material";
import type { ReactNode } from "react";

export function PackingCard({
  name,
  price,
  description,
  media,
  quantity,
  action,
}: {
  name: string;
  price: number;
  description: string;
  media: string | null;
  quantity: ReactNode;
  action?: ReactNode;
}) {
  const formattedPrice = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(price);
  const hasTable = /<table(?:\s|>)/i.test(description);

  return (
    <Card
      elevation={2}
      sx={{ bgcolor: "background.paper", containerType: "inline-size", width: "100%", maxWidth: 900, mx: "auto", alignSelf: "center" }}
    >
      <CardHeader
        sx={{ "& .MuiCardHeader-content": { minWidth: 0 } }}
        title={
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
            <Typography variant="h5" color="primary" sx={{ minWidth: 0, overflowWrap: "anywhere" }}>{name}</Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
              <Typography variant="h5" color="primary" sx={{ whiteSpace: "nowrap" }}>{formattedPrice}</Typography>
              {action}
            </Box>
          </Box>
        }
      />
      <CardContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
              gap: 2,
              ...(media && {
                "@container (min-width: 600px)": {
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                },
              }),
            }}
          >
            {media && (
              <CardMedia
                component="img"
                image={media}
                alt={name}
                loading="lazy"
                referrerPolicy="no-referrer"
                sx={{ width: "100%", height: "auto", maxHeight: 360, objectFit: "contain" }}
              />
            )}
            <Typography
              component="div"
              variant="body2"
              role={hasTable ? "region" : undefined}
              aria-label={hasTable ? `Beschreibung: ${name}` : undefined}
              tabIndex={hasTable ? 0 : undefined}
              sx={{ minWidth: 0, overflowWrap: "anywhere", overflowX: "auto" }}
              dangerouslySetInnerHTML={{ __html: description }}
            />
          </Box>
          <Box sx={{ display: "flex", justifyContent: "end" }}>{quantity}</Box>
        </Box>
      </CardContent>
    </Card>
  );
}
