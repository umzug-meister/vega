import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "@mui/icons-material";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";

export interface OrderGalleryImage {
  id: string;
  url: string;
}

interface OrderImageGalleryProps {
  images: OrderGalleryImage[];
  index: number;
  onChange: (index: number) => void;
  onClose: () => void;
}

/**
 * Full-screen image browser for the customer photos of one order. The gallery
 * wraps around: after the last image the next button continues at the first
 * one, and the previous button from the first image jumps to the last. The
 * parent owns the index so closing and reopening keeps the last position out
 * of the way of the grid state.
 */
export function OrderImageGallery({
  images,
  index,
  onChange,
  onClose,
}: OrderImageGalleryProps) {
  const total = images.length;
  const current = images[index];

  useEffect(() => {
    if (total === 0) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        onChange((index - 1 + total) % total);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onChange((index + 1) % total);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [index, onChange, total]);

  if (!current) return null;

  const previous = () => onChange((index - 1 + total) % total);
  const next = () => onChange((index + 1) % total);

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      aria-labelledby="order-gallery-title"
    >
      <DialogTitle id="order-gallery-title">Kundenbilder</DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Stack direction="row" sx={{ height: { xs: "60vh", md: "72vh" } }}>
          <Stack
            component="nav"
            aria-label="Bildübersicht"
            spacing={1}
            sx={{
              width: 120,
              flexShrink: 0,
              overflowY: "auto",
              p: 1,
              borderRight: 1,
              borderColor: "divider",
            }}
          >
            {images.map((image, position) => (
              <Box
                key={image.id}
                component="button"
                type="button"
                aria-label={`Bild ${position + 1} von ${total}`}
                aria-current={position === index ? "true" : undefined}
                onClick={() => onChange(position)}
                sx={{
                  p: 0,
                  border: 2,
                  borderColor:
                    position === index ? "primary.main" : "transparent",
                  bgcolor: "transparent",
                  borderRadius: 1,
                  overflow: "hidden",
                  cursor: "pointer",
                  "& img": {
                    display: "block",
                    width: "100%",
                    height: 64,
                    objectFit: "cover",
                  },
                }}
              >
                <img src={image.url} alt="" />
              </Box>
            ))}
          </Stack>
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              bgcolor: "grey.100",
            }}
          >
            <Box
              sx={{
                position: "relative",
                flex: 1,
                minHeight: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                p: { xs: 1, sm: 2 },
              }}
            >
              <IconButton
                aria-label="Vorheriges Bild"
                onClick={previous}
                sx={{
                  position: "absolute",
                  left: 8,
                  bgcolor: "background.paper",
                  boxShadow: 1,
                  "&:hover": { bgcolor: "background.paper" },
                }}
              >
                <ChevronLeft />
              </IconButton>
              <Box
                component="img"
                src={current.url}
                alt={`Kundenbild ${index + 1} von ${total}`}
                sx={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                }}
              />
              <IconButton
                aria-label="Nächstes Bild"
                onClick={next}
                sx={{
                  position: "absolute",
                  right: 8,
                  bgcolor: "background.paper",
                  boxShadow: 1,
                  "&:hover": { bgcolor: "background.paper" },
                }}
              >
                <ChevronRight />
              </IconButton>
            </Box>
            <Typography
              align="center"
              aria-live="polite"
              sx={{ py: 1, fontVariantNumeric: "tabular-nums" }}
            >
              {index + 1} / {total}
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          href={current.url}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ mr: "auto" }}
        >
          Original öffnen
        </Button>
        <Button onClick={onClose}>Schließen</Button>
      </DialogActions>
    </Dialog>
  );
}
