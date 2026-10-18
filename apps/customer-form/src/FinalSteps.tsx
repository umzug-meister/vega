import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  Grid,
  Typography,
} from "@mui/material";
import CheckOutlined from "@mui/icons-material/CheckOutlined";
import ShoppingCartCheckoutOutlined from "@mui/icons-material/ShoppingCartCheckoutOutlined";
import ExpandMoreOutlined from "@mui/icons-material/ExpandMoreOutlined";
import Send from "@mui/icons-material/Send";
import {
  Column,
  Field,
  Heading,
  Info,
  NumberInput,
  Section,
  SwitchField,
} from "./components.js";
import { calculateVolume, euro } from "./form-model.js";
import type { StepProps } from "./MovingSteps.js";
import type { ReactNode } from "react";

export function Packaging({ draft, setDraft, resources }: StepProps) {
  return (
    <Section title="Verpackung benötigt?">
      <SwitchField
        label="Möchten Sie Verpackung bei uns kaufen?"
        value={draft.packingRequested}
        onChange={(packingRequested) =>
          setDraft((current) => ({ ...current, packingRequested }))
        }
      />
      {draft.packingRequested && (
        <Grid container spacing={4} sx={{ alignItems: "stretch" }}>
          {resources.packings.map((packing) => {
            const key = `packaging:${packing.id}`;
            const quantity = draft.quantities[key] ?? 0;
            return (
              <Grid key={packing.id} size={12}>
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
                          {packing.name}
                        </Typography>
                        <Typography variant="h5" color="primary">
                          {euro(packing.price)}
                        </Typography>
                      </Box>
                    }
                  />
                  <CardContent>
                    <Column>
                      <Typography variant="body2">
                        {packing.description}
                      </Typography>
                      <Box sx={{ display: "flex", justifyContent: "end" }}>
                        <Field
                          label="Anzahl"
                          fullWidth={false}
                          type="number"
                          value={quantity || ""}
                          slotProps={{
                            htmlInput: { min: 0 },
                            input: {
                              endAdornment:
                                quantity > 0 ? (
                                  <CheckOutlined color="primary" />
                                ) : (
                                  <ShoppingCartCheckoutOutlined color="disabled" />
                                ),
                            },
                          }}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              quantities: {
                                ...current.quantities,
                                [key]: Math.max(0, Number(event.target.value)),
                              },
                            }))
                          }
                        />
                      </Box>
                    </Column>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
          {!resources.packings.length && (
            <Grid size={12}>
              <Typography color="text.secondary">
                Derzeit ist kein Verpackungsmaterial hinterlegt.
              </Typography>
            </Grid>
          )}
        </Grid>
      )}
    </Section>
  );
}

export function FurnitureCalculator({ draft, setDraft, resources }: StepProps) {
  const categories =
    draft.from.movementObject === "Büro"
      ? resources.categories.filter(
          (category) => category.name.toLocaleLowerCase("de") === "büro",
        )
      : resources.categories;
  const boxCalculatorUrl = resources.config.boxCalculatorUrl?.trim();
  const volume = calculateVolume(draft, resources);
  return (
    <Column gap={4}>
      <Column>
        <Heading>Kartons</Heading>
        <Grid container spacing={4} sx={{ alignItems: "flex-end" }}>
          <Grid size={12}>
            <Info>
              {boxCalculatorUrl && (
                <>
                  Nutzen sie unseren{" "}
                  <a
                    href={boxCalculatorUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Kartonrechner
                  </a>
                  , um die Anzahl der benötigten Kartons zu ermitteln.
                </>
              )}
              <p>
                Möchten Sie sicherstellen, dass Ihre Kleidung knitterfrei
                transportiert wird? Dann benötigen Sie pro 50 cm
                Kleiderstangenbreite eine Kleiderbox.
              </p>
            </Info>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <NumberInput
              label="Umzugskartons"
              value={draft.boxes}
              onChange={(boxes) =>
                setDraft((current) => ({ ...current, boxes }))
              }
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <NumberInput
              label="Kleiderboxen"
              value={draft.wardrobeBoxes}
              onChange={(wardrobeBoxes) =>
                setDraft((current) => ({ ...current, wardrobeBoxes }))
              }
            />
          </Grid>
        </Grid>
      </Column>
      {categories.map((category) => {
        const furniture = resources.furniture.filter((item) =>
          item.categoryIds.includes(category.id),
        );
        if (!furniture.length) return null;
        return (
          <Column key={category.id}>
            <Heading>{category.name}</Heading>
            <Grid container spacing={4} sx={{ alignItems: "flex-end" }}>
              {furniture.map((item) => {
                const key = `${item.id}:${category.id}`;
                return (
                  <Grid size={{ xs: 12, sm: 6 }} key={item.id}>
                    <NumberInput
                      label={item.name}
                      value={draft.furniture[key] ?? 0}
                      step={item.step}
                      onChange={(quantity) =>
                        setDraft((current) => ({
                          ...current,
                          furniture: { ...current.furniture, [key]: quantity },
                        }))
                      }
                    />
                  </Grid>
                );
              })}
            </Grid>
          </Column>
        );
      })}
      {!resources.furniture.length && (
        <Alert severity="info">
          Der Möbelkatalog ist noch nicht eingerichtet. Bitte hängen Sie Bilder
          an oder beschreiben Sie Ihr Umzugsgut in der Nachricht.
        </Alert>
      )}
      {volume === null ? (
        <Alert severity="warning">
          Das Kartonvolumen ist noch nicht konfiguriert. Die Kartonanzahl wird
          übermittelt; das Gesamtvolumen wird im Angebot ergänzt.
        </Alert>
      ) : (
        <Alert>
          Umzugsvolumen: {new Intl.NumberFormat("de-DE").format(volume)} m³
        </Alert>
      )}
    </Column>
  );
}

export function RequestStep({
  draft,
  setDraft,
  resources,
  uploader,
  submitting,
  onSubmit,
  imagesBusy,
}: StepProps & {
  uploader: ReactNode;
  submitting: boolean;
  onSubmit: () => void;
  imagesBusy: boolean;
}) {
  return (
    <Section title="Auftrag absenden">
      <Column>
        <Info>
          Damit wir Ihnen ein passendes Angebot machen können, brauchen wir noch
          ein paar Informationen zu Ihren Möbeln. Laden Sie Bilder hoch oder
          berechnen Sie Ihr Umzugsvolumen.
        </Info>
      </Column>
      <Box>
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
            <Typography variant="h6" color="primary">
              Bilder anhängen
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Laden Sie bitte hier Ihre Bilder hoch. So können wir uns ein
              besseres Bild von Ihrem Umzugsvolumen machen und Ihnen optimal
              weiterhelfen.
            </Typography>
            {uploader}
          </AccordionDetails>
        </Accordion>
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
            <Typography variant="h6" color="primary">
              Umzugsvolumen berechnen
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" sx={{ mb: 2 }}>
              Nutzen Sie doch einfach unseren praktischen Rechner, um Ihre
              Umzugsliste zu erstellen und das Umzugsvolumen zu berechnen.
            </Typography>
            <FurnitureCalculator
              draft={draft}
              setDraft={setDraft}
              resources={resources}
            />
          </AccordionDetails>
        </Accordion>
      </Box>
      <Field
        label="Nachricht an uns"
        multiline
        minRows={5}
        placeholder="sollten wir noch etwas wissen..."
        value={draft.note}
        onChange={(event) =>
          setDraft((current) => ({ ...current, note: event.target.value }))
        }
        slotProps={{ htmlInput: { maxLength: 5000 } }}
      />
      {!resources.config.privacyUrl && (
        <Alert severity="error">
          Die Datenschutzerklärung ist noch nicht konfiguriert. Das Formular
          kann derzeit nicht abgesendet werden.
        </Alert>
      )}
      <Box
        sx={{
          display: "flex",
          gap: 2,
          flexDirection: { xs: "column", sm: "row" },
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <FormControlLabel
          control={
            <Checkbox
              checked={draft.privacyAccepted}
              disabled={!resources.config.privacyUrl || submitting}
              onChange={(_, privacyAccepted) =>
                setDraft((current) => ({ ...current, privacyAccepted }))
              }
            />
          }
          label={
            <Typography>
              Ich bin mit der{" "}
              <a
                href={resources.config.privacyUrl ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
              >
                Datenschutzerklärung
              </a>{" "}
              einverstanden.
            </Typography>
          }
        />
        <Button
          size="large"
          variant="contained"
          disabled={
            !draft.privacyAccepted ||
            submitting ||
            imagesBusy ||
            !resources.config.privacyUrl
          }
          onClick={onSubmit}
          endIcon={
            submitting ? (
              <CircularProgress size={20} color="inherit" />
            ) : (
              <Send />
            )
          }
        >
          Absenden
        </Button>
      </Box>
    </Section>
  );
}

export function Success() {
  const paragraphs = [
    "Wir haben Ihre Anfrage zum Umzugsservice erfolgreich erhalten und freuen uns darauf, Sie bei Ihrem Umzugsprojekt zu unterstützen.",
    "Jemand von uns wird sich in Kürze mit Ihnen in Verbindung setzen, um alle notwendigen Details zu besprechen und Ihre Fragen zu beantworten.",
    "Wir verstehen, dass ein Umzug eine wichtige Angelegenheit ist, und versprechen Ihnen eine schnelle, effiziente und professionelle Abwicklung.",
    "Bei weiteren Fragen oder Anliegen erreichen Sie uns jederzeit unter:",
  ];
  return (
    <Section title="Herzlichen Dank für Ihre Kontaktaufnahme!">
      {paragraphs.map((text) => (
        <Typography key={text} align="center">
          {text}
        </Typography>
      ))}
      <Box sx={{ textAlign: "center" }}>
        <Typography>
          Tel.: 089 306 42 972
          <br />
          Tel.: 0176 101 71 990
          <br />
          <Typography
            component="a"
            href="mailto:info@umzugruckzuck24.de"
            color="primary"
          >
            info@umzugruckzuck24.de
          </Typography>
        </Typography>
      </Box>
      <Typography align="center">
        Wir freuen uns darauf, Ihnen einen exzellenten Service zu bieten.
      </Typography>
      <Typography align="center">
        Mit freundlichen Grüßen,
        <br />
        Ihr <strong>Umzug Ruckzuck Team</strong>
      </Typography>
    </Section>
  );
}
