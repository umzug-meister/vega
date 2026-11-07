import type { CatalogPackingDto } from "@vega/domain";
import { Typography } from "@mui/material";
import { CatalogCrudPage, type CatalogColumn, type CatalogField } from "./CatalogCrudPage.js";
import { PackingPreview } from "./PackingPreview.js";

const money = (value: number) => value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const fields: CatalogField[] = [
  { name: "name", label: "Name", type: "text" },
  { name: "price", label: "Preis (€)", type: "money", min: 0 },
  { name: "description", label: "Beschreibung", type: "richtext" },
  { name: "media", label: "Medien-Link (HTTP(S))", type: "text" },
  { name: "sort", label: "Sortierung", type: "number", min: 0, step: 1 },
  { name: "show", label: "Im Formular anzeigen", type: "boolean" },
];

const columns: CatalogColumn<CatalogPackingDto>[] = [
  { label: "ID", render: (item) => item.id },
  { label: "Name", render: (item) => item.name },
  { label: "Preis", render: (item) => money(item.price) },
  {
    label: "Beschreibung",
    render: (item) => (
      <Typography
        component="div"
        variant="body2"
        dangerouslySetInnerHTML={{ __html: item.description }}
      />
    ),
  },
  { label: "Im Formular", render: (item) => item.show ? "Ja" : "Nein" },
  { label: "Sortierung", render: (item) => item.sort },
];

export function PackingsPage() {
  return (
    <CatalogCrudPage<CatalogPackingDto>
      resource="packings"
      title="Verpackung"
      fields={fields}
      columns={columns}
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
