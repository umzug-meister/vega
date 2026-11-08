import { useMemo, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  ListItemIcon,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { AdminAlert as Alert } from "../components/AdminNotifications.js";
import { RichTextEditor } from "../components/RichTextEditor.js";
import { AddOutlined, DeleteOutlined, EditOutlined, MoreVert } from "@mui/icons-material";
import { useCatalogCollection, type IdentifiedCatalogRecord } from "./useCatalogCollection.js";

export interface CatalogChoice {
  label: string;
  value: string | number;
}

export interface CatalogField {
  name: string;
  label: string;
  type: "text" | "number" | "money" | "multiline" | "richtext" | "boolean" | "multiple" | "checkboxes";
  options?: CatalogChoice[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}

export interface CatalogColumn<T> {
  label: string;
  render: (item: T) => ReactNode;
}

interface CatalogCrudPageProps<T extends IdentifiedCatalogRecord> {
  resource: string;
  title: string;
  fields: CatalogField[];
  columns: CatalogColumn<T>[];
  defaults: Record<string, unknown>;
  previewPanel?: (form: Record<string, unknown>) => ReactNode;
  toolbarContent?: ReactNode;
  filterPanel?: ReactNode;
  filterItem?: (item: T) => boolean;
  renderItems?: (items: T[], renderAction: (item: T) => ReactNode) => ReactNode;
}

export function CatalogCrudPage<T extends IdentifiedCatalogRecord>({
  resource,
  title,
  fields,
  columns,
  defaults,
  previewPanel,
  toolbarContent,
  filterPanel,
  filterItem,
  renderItems,
}: CatalogCrudPageProps<T>) {
  const catalog = useCatalogCollection<T>(resource);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [form, setForm] = useState<Record<string, unknown>>(defaults);
  const [saving, setSaving] = useState(false);
  const [actionMenu, setActionMenu] = useState<{ anchor: HTMLElement; item: T } | null>(null);

  const dialogTitle = useMemo(() => editing ? `Eintrag bearbeiten · ${title}` : `Eintrag anlegen · ${title}`, [editing, title]);
  const visibleItems = useMemo(() => filterItem ? catalog.items.filter(filterItem) : catalog.items, [catalog.items, filterItem]);

  function openCreate() {
    setEditing(null);
    setForm({ ...defaults });
    catalog.setError(null);
    setDialogOpen(true);
  }

  function openEdit(item: T) {
    setEditing(item);
    setForm(Object.fromEntries(fields.map((field) => [field.name, (item as Record<string, unknown>)[field.name] ?? defaults[field.name] ?? (field.type === "multiple" || field.type === "checkboxes" ? [] : "")])));
    catalog.setError(null);
    setDialogOpen(true);
  }

  async function save() {
    setSaving(true);
    catalog.setError(null);
    try {
      if (editing) await catalog.update(editing.id, form);
      else await catalog.create(form);
      setDialogOpen(false);
    } catch (cause) {
      catalog.setError(cause instanceof Error ? cause.message : "Der Eintrag konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: T) {
    if (!window.confirm(`„${String((item as Record<string, unknown>).name ?? item.id)}“ wirklich löschen?`)) return;
    catalog.setError(null);
    try {
      await catalog.remove(item.id);
    } catch (cause) {
      catalog.setError(cause instanceof Error ? cause.message : "Der Eintrag konnte nicht gelöscht werden.");
    }
  }

  function renderAction(item: T) {
    return (
      <Tooltip title="Eintragsaktionen">
        <IconButton size="small" id={`catalog-actions-${item.id}`} aria-label={`Aktionen für Eintrag ${item.id}`} aria-haspopup="menu" aria-controls={actionMenu?.item.id === item.id ? "catalog-actions-menu" : undefined} aria-expanded={actionMenu?.item.id === item.id ? true : undefined} onClick={(event) => setActionMenu({ anchor: event.currentTarget, item })}>
          <MoreVert />
        </IconButton>
      </Tooltip>
    );
  }

  function renderField(field: CatalogField) {
    const value = form[field.name];
    if (field.type === "checkboxes") {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <FormControl key={field.name} component="fieldset" fullWidth margin="dense">
          <FormLabel component="legend">{field.label}</FormLabel>
          <FormGroup>
            {(field.options ?? []).map((option) => (
              <FormControlLabel key={String(option.value)} label={option.label} control={
                <Checkbox checked={selected.includes(String(option.value))} onChange={(event) => setForm((current) => {
                  const previous = Array.isArray(current[field.name]) ? current[field.name] as Array<string | number> : [];
                  return { ...current, [field.name]: event.target.checked ? [...previous, option.value] : previous.filter((entry) => String(entry) !== String(option.value)) };
                })} />
              } />
            ))}
          </FormGroup>
        </FormControl>
      );
    }
    if (field.type === "boolean") {
      return (
        <FormControlLabel
          key={field.name}
          control={<Checkbox checked={value === true} onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.checked }))} />}
          label={field.label}
        />
      );
    }
    if (field.type === "multiple") {
      const selected = Array.isArray(value) ? value.map((entry) => String(entry)) : [];
      return (
        <FormControl key={field.name} fullWidth size="small" margin="dense">
          <InputLabel>{field.label}</InputLabel>
          <Select
            multiple
            label={field.label}
            value={selected}
            onChange={(event) => {
              const selectedValues = event.target.value;
              setForm((current) => ({ ...current, [field.name]: (typeof selectedValues === "string" ? selectedValues.split(",") : selectedValues).map(Number) }));
            }}
            renderValue={(picked) => (picked as string[]).map((pickedValue) => field.options?.find((option) => String(option.value) === pickedValue)?.label ?? pickedValue).join(", ")}
          >
            {(field.options ?? []).map((option) => (
              <MenuItem key={String(option.value)} value={String(option.value)}>
                <Checkbox checked={selected.includes(String(option.value))} />{option.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      );
    }
    if (field.type === "richtext") {
      return (
        <Stack
          key={`${field.name}-${dialogOpen ? "open" : "closed"}-${editing?.id ?? "new"}`}
          spacing={0.75}
        >
          <FormLabel>{field.label}</FormLabel>
          <RichTextEditor
            ariaLabel={field.label}
            initialHtml={typeof value === "string" ? value : ""}
            disabled={saving}
            onChange={(html) =>
              setForm((current) =>
                current[field.name] === html
                  ? current
                  : { ...current, [field.name]: html },
              )
            }
          />
        </Stack>
      );
    }
    return (
      <TextField
        key={field.name}
        fullWidth
        label={field.type === "money" ? field.label.replace(/\s*\(€\)$/u, "") : field.label}
        type={field.type === "money" || field.type === "number" ? "number" : "text"}
        multiline={field.type === "multiline"}
        minRows={field.type === "multiline" ? 3 : undefined}
        value={value ?? ""}
        onChange={(event) => setForm((current) => ({
          ...current,
          [field.name]: field.type === "money" || field.type === "number" ? (event.target.value === "" ? 0 : Number(event.target.value)) : event.target.value,
        }))}
        slotProps={{
          ...(field.type === "money" || field.unit ? { input: { endAdornment: <InputAdornment position="end">{field.type === "money" ? "€" : field.unit}</InputAdornment> } } : {}),
          htmlInput: {
            ...(field.min !== undefined ? { min: field.min } : {}),
            ...(field.max !== undefined ? { max: field.max } : {}),
            ...(field.step !== undefined ? { step: field.step } : field.type === "money" ? { step: "0.01" } : {}),
          },
        }}
      />
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} useFlexGap sx={{ justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap" }}>
        {toolbarContent && <Stack direction="row" sx={{ flexGrow: 1, alignItems: "center" }}>{toolbarContent}</Stack>}
        <Button variant="contained" startIcon={<AddOutlined />} onClick={openCreate}>Eintrag anlegen</Button>
      </Stack>
      {filterPanel}
      {catalog.error && !dialogOpen && <Alert severity="error">{catalog.error}</Alert>}
      {catalog.loading ? <Typography color="text.secondary">Wird geladen …</Typography> : renderItems ? renderItems(visibleItems, renderAction) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label={title}>
            <TableHead>
              <TableRow>
                {columns.map((column) => <TableCell key={column.label}>{column.label}</TableCell>)}
                <TableCell align="right">Aktionen</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleItems.map((item) => (
                <TableRow key={item.id} hover>
                  {columns.map((column) => <TableCell key={column.label}>{column.render(item)}</TableCell>)}
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    {renderAction(item)}
                  </TableCell>
                </TableRow>
              ))}
              {visibleItems.length === 0 && <TableRow><TableCell colSpan={columns.length + 1} align="center">Noch keine Einträge für diesen Filter.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <Menu id="catalog-actions-menu" anchorEl={actionMenu?.anchor ?? null} open={actionMenu !== null} onClose={() => setActionMenu(null)} slotProps={{ list: { "aria-labelledby": actionMenu ? `catalog-actions-${actionMenu.item.id}` : undefined } }}>
        <MenuItem onClick={() => { if (!actionMenu) return; const item = actionMenu.item; setActionMenu(null); openEdit(item); }}>
          <ListItemIcon><EditOutlined fontSize="small" /></ListItemIcon>Bearbeiten
        </MenuItem>
        <MenuItem sx={{ color: "error.main" }} onClick={() => { if (!actionMenu) return; const item = actionMenu.item; setActionMenu(null); void remove(item); }}>
          <ListItemIcon sx={{ color: "inherit" }}><DeleteOutlined fontSize="small" /></ListItemIcon>Löschen
        </MenuItem>
      </Menu>
      <Dialog
        open={dialogOpen}
        onClose={() => !saving && setDialogOpen(false)}
        fullWidth
        maxWidth={previewPanel ? "lg" : "sm"}
      >
        <DialogTitle>{dialogTitle}</DialogTitle>
        <DialogContent>
          {previewPanel ? (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "minmax(0, 1fr)",
                  md: "minmax(280px, 0.9fr) minmax(0, 1.1fr)",
                },
                gap: 3,
                alignItems: "start",
              }}
            >
              <Stack spacing={1.25} role="region" aria-label="Vorschau im Kundenformular">
                <Typography component="h3" variant="h6">
                  Vorschau
                </Typography>
                {previewPanel(form)}
              </Stack>
              <Stack spacing={1.25} sx={{ pt: 1 }}>
                {catalog.error && <Alert severity="error">{catalog.error}</Alert>}
                {fields.map(renderField)}
              </Stack>
            </Box>
          ) : (
            <Stack spacing={1.25} sx={{ pt: 1 }}>
              {catalog.error && <Alert severity="error">{catalog.error}</Alert>}
              {fields.map(renderField)}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>Abbrechen</Button>
          <Button variant="contained" onClick={() => void save()} disabled={saving}>{saving ? "Speichert …" : "Speichern"}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
