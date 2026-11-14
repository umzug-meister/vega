import { useCallback, useMemo, useState } from "react";
import { FilterList, FilterListOff } from "@mui/icons-material";
import { Card, CardContent, Checkbox, FormControlLabel, FormGroup, IconButton, Stack, Typography } from "@mui/material";
import { AdminAlert } from "../components/AdminNotifications.js";
import type { CatalogCategoryDto, CatalogFurnitureDto } from "@vega/domain";
import { CatalogCrudPage, type CatalogColumn, type CatalogField } from "./CatalogCrudPage.js";
import { useCatalogCollection } from "./useCatalogCollection.js";

export function furnitureCategoryChoices(categories: CatalogCategoryDto[]) {
  return [...categories].sort((first, second) => first.sort - second.sort || first.id - second.id).map(({ id, name }) => ({ value: id, label: name }));
}

export const furnitureDefaults = { name: "", categoryIds: [], volume: 0, step: 1, sortOrder: 0 };

export function FurniturePage() {
  const categories = useCatalogCollection<CatalogCategoryDto>("categories");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([]);
  const [showWithoutCategory, setShowWithoutCategory] = useState(false);
  const [filterBarVisible, setFilterBarVisible] = useState(false);
  const categoryChoices = useMemo(() => furnitureCategoryChoices(categories.items), [categories.items]);
  const filterItem = useCallback((item: CatalogFurnitureDto) => {
    if (selectedCategoryIds.length === 0 && !showWithoutCategory) return true;
    if (showWithoutCategory && item.categoryIds.length === 0) return true;
    return item.categoryIds.some((categoryId) => selectedCategoryIds.includes(categoryId));
  }, [selectedCategoryIds, showWithoutCategory]);
  const fields: CatalogField[] = [
    { name: "name", label: "Name", type: "text" },
    { name: "volume", label: "Volumen", type: "number", min: 0, step: 0.01, unit: "m³" },
    { name: "step", label: "Schrittgröße", type: "number", min: 0.5, step: 0.5 },
    { name: "sortOrder", label: "Sortierung", type: "number", min: 0, step: 1 },
    { name: "categoryIds", label: "Kategorien", type: "checkboxes", options: categoryChoices },
  ];
  const columns: CatalogColumn<CatalogFurnitureDto>[] = [
    { label: "ID", render: (item) => item.id },
    { label: "Name", render: (item) => item.name },
    { label: "Kategorien", render: (item) => item.categoryRefs.map(({ name }) => name).join(", ") || "Ohne Kategorie" },
    { label: "Volumen", render: (item) => `${item.volume} m³` },
    { label: "Schritt", render: (item) => item.step },
    { label: "Sortierung", render: (item) => item.sortOrder },
  ];
  const toolbarContent = (
    <IconButton
      color={filterBarVisible ? "primary" : "default"}
      aria-label={filterBarVisible ? "Filter schließen" : "Nach Kategorien filtern"}
      onClick={() => {
        setFilterBarVisible((visible) => {
          if (visible) {
            setSelectedCategoryIds([]);
            setShowWithoutCategory(false);
          }
          return !visible;
        });
      }}
    >
      {filterBarVisible ? <FilterListOff /> : <FilterList />}
    </IconButton>
  );
  const filterPanel = filterBarVisible ? (
    <Card variant="outlined">
      <CardContent>
        <FormGroup row>
        <Typography variant="subtitle2" color="primary" sx={{ mr: 1, alignSelf: "center", fontWeight: "bold" }}>Kategorie:</Typography>
        <FormControlLabel label="Ohne Kategorie" control={<Checkbox checked={showWithoutCategory} onChange={(event) => setShowWithoutCategory(event.target.checked)} />} />
        {categories.items.map((category) => (
          <FormControlLabel
            key={category.id}
            label={category.name}
            control={<Checkbox checked={selectedCategoryIds.includes(category.id)} onChange={(event) => setSelectedCategoryIds((current) => event.target.checked ? [...current, category.id] : current.filter((id) => id !== category.id))} />}
          />
        ))}
        </FormGroup>
      </CardContent>
    </Card>
  ) : null;

  return (
    <Stack spacing={1.5}>
      {categories.error && <AdminAlert severity="error">{`Kategorien konnten nicht geladen werden: ${categories.error}`}</AdminAlert>}
      <CatalogCrudPage<CatalogFurnitureDto>
        resource="furniture"
        title="Möbel"
        fields={fields}
        columns={columns}
        toolbarContent={toolbarContent}
        filterPanel={filterPanel}
        filterItem={filterItem}
        defaults={furnitureDefaults}
      />
    </Stack>
  );
}
