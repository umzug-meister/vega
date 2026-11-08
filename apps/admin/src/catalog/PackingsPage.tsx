import type { CatalogPackingDto } from "@vega/domain";
import { Stack, Typography } from "@mui/material";
import { CatalogCrudPage, type CatalogField } from "./CatalogCrudPage.js";
import { PackingPreview } from "./PackingPreview.js";

const fields: CatalogField[] = [
  { name: "name", label: "Name", type: "text" },
  { name: "price", label: "Preis (€)", type: "money", min: 0 },
  { name: "description", label: "Beschreibung", type: "richtext" },
  { name: "media", label: "Medien-Link (HTTP(S))", type: "text" },
  { name: "sort", label: "Sortierung", type: "number", min: 0, step: 1 },
  { name: "show", label: "Im Formular anzeigen", type: "boolean" },
];

export function PackingsPage() {
  return (
    <CatalogCrudPage<CatalogPackingDto>
      resource="packings"
      title="Verpackung"
      fields={fields}
      columns={[]}
      renderItems={(items, renderAction) => {
        const sorted = items.toSorted((a, b) => a.sort - b.sort || a.id - b.id);
        const visible = sorted.filter((item) => item.show);
        const hidden = sorted.filter((item) => !item.show);
        const cards = (entries: CatalogPackingDto[]) => entries.map((item) => (
          <PackingPreview key={item.id} {...item} action={renderAction(item)} />
        ));
        return (
          <Stack spacing={4}>
            <Stack spacing={4} role="region" aria-label="Im Kundenformular sichtbar">
              {visible.length ? cards(visible) : <Typography color="text.secondary">Im Kundenformular ist kein Verpackungsmaterial sichtbar.</Typography>}
            </Stack>
            {hidden.length > 0 && (
              <Stack spacing={4} role="region" aria-label="Im Kundenformular ausgeblendet">
                <Typography variant="h6">Im Kundenformular ausgeblendet</Typography>
                {cards(hidden)}
              </Stack>
            )}
          </Stack>
        );
      }}
      previewPanel={(form) => (
        <PackingPreview
          name={typeof form.name === "string" ? form.name : ""}
          price={typeof form.price === "number" ? form.price : 0}
          description={
            typeof form.description === "string" ? form.description : ""
          }
          media={typeof form.media === "string" ? form.media : ""}
        />
      )}
      defaults={{ name: "", price: 0, description: "", media: "", sort: 0, show: true }}
    />
  );
}
