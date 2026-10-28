import { useEffect, useState } from "react";
import { Box, Button, CardMedia, Grid, Paper, Stack, Typography } from "@mui/material";
import { AdminAlert as Alert } from "../components/AdminNotifications.js";
import { OrderImageGallery, type OrderGalleryImage } from "./OrderImageGallery.js";

export function OrderImages({ orderNumber }: { orderNumber: number }) {
  const [images, setImages] = useState<OrderGalleryImage[]>([]);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [galleryIndex, setGalleryIndex] = useState<number>();
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void fetch(`/api/admin/orders/${orderNumber}/images`, { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { data?: OrderGalleryImage[]; error?: { code: string; message: string } };
        if (!response.ok) {
          throw new Error(result.error?.message ?? "Die Bilder konnten nicht geladen werden.");
        }
        if (!result.data) throw new Error("Die Bildantwort ist unvollständig.");
        return result.data;
      })
      .then((data) => { if (!controller.signal.aborted) setImages(data); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Die Bilder konnten nicht geladen werden."); });
    return () => controller.abort();
  }, [orderNumber, refresh]);
  return <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}><Stack spacing={2}>
    <Stack direction="row" sx={{ justifyContent: "space-between" }}><Typography variant="h6">Kundenbilder</Typography><Button onClick={() => setRefresh((value) => value + 1)}>Bildlinks erneuern</Button></Stack>
    {error && <Alert severity="error">{error}</Alert>}
    {!images.length && !error && <Typography color="text.secondary">Keine verfügbaren Bilder.</Typography>}
    <Grid container spacing={2}>{images.map((image, index) => <Grid key={image.id} size={{ xs: 12, sm: 6, md: 4 }}>
      <Box
        component="button"
        type="button"
        aria-label={`Kundenbild ${index + 1} von ${images.length} öffnen`}
        onClick={() => setGalleryIndex(index)}
        sx={{ display: "block", width: "100%", p: 0, border: 0, bgcolor: "transparent", cursor: "pointer" }}
      >
        <CardMedia component="img" src={image.url} alt={`Kundenbild ${index + 1}`} sx={{ height: 200, objectFit: "cover" }}
          onError={() => setError("Ein Bildlink ist abgelaufen oder das Bild wurde gemäß Aufbewahrungsfrist gelöscht. Erneuern Sie die Bildlinks.")} />
      </Box>
    </Grid>)}</Grid>
    {galleryIndex !== undefined && images[galleryIndex] && (
      <OrderImageGallery
        images={images}
        index={galleryIndex}
        onChange={setGalleryIndex}
        onClose={() => setGalleryIndex(undefined)}
      />
    )}
  </Stack></Paper>;
}
