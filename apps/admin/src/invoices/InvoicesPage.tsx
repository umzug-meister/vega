import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import AddOutlined from "@mui/icons-material/AddOutlined";
import FileDownloadOutlined from "@mui/icons-material/FileDownloadOutlined";
import RestoreOutlined from "@mui/icons-material/RestoreOutlined";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, CircularProgress, IconButton, InputAdornment, Paper, Stack, Table, TableBody, TableCell, TableHead, TablePagination, TableRow, TextField, Tooltip, useMediaQuery, useTheme } from "@mui/material";
import { AdminAlert as Alert } from "../components/AdminNotifications.js";
import { calculateInvoiceTotals, type AdminInvoiceDto, type AdminInvoiceListDto } from "@vega/domain";
import { apiRequest } from "../api/api-request.js";
import { ArchiveDateCells, ArchiveDateHeaders } from "../components/ArchiveDates.js";

const currencyFormatter = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const PAGE_SIZE = 25;

export function invoiceTotal(invoice: Pick<AdminInvoiceDto, "entries" | "taxPercent">): number {
  return calculateInvoiceTotals(invoice.entries, invoice.taxPercent).total;
}

export function InvoicesPage({ archived = false, navigate }: { archived?: boolean; navigate: (path: string) => void }) {
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [items, setItems] = useState<AdminInvoiceDto[]>([]);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const actionLock = useRef(false);
  const requestId = useRef(0);
  const locked = loading || acting;

  const load = useCallback(async (nextPage: number, searchValue: string) => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ archived: String(archived), page: String(nextPage), pageSize: String(PAGE_SIZE) });
      if (searchValue) query.set("search", searchValue);
      const data = await apiRequest<AdminInvoiceListDto>(`/api/admin/invoices?${query}`);
      if (currentRequest !== requestId.current) return;
      const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
      if (nextPage > lastPage) {
        setPage(lastPage);
      } else {
        setItems(data.items);
        setTotal(data.total);
      }
    } catch (failure) {
      if (currentRequest === requestId.current) {
        setItems([]);
        setError(failure instanceof Error ? failure.message : "Rechnungen konnten nicht geladen werden.");
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [archived]);

  useEffect(() => {
    void load(page, activeSearch);
    return () => { requestId.current += 1; };
  }, [activeSearch, load, page]);
  useEffect(() => { setPage(1); }, [archived]);

  function onSearch() {
    const value = search.trim();
    setActiveSearch(value);
    setPage(1);
    if (value === activeSearch && page === 1) void load(1, value);
    if (!value) setSearch("");
  }

  function onClear() {
    setSearch("");
    setActiveSearch("");
    setPage(1);
    if (!activeSearch && page === 1) void load(1, "");
  }

  async function archive(id: string) {
    if (actionLock.current || locked) return;
    actionLock.current = true;
    setActing(true);
    setError("");
    try {
      await apiRequest(`/api/admin/invoices/${id}/${archived ? "restore" : "archive"}`, "POST");
      await load(page, activeSearch);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Aktion konnte nicht ausgeführt werden.");
    } finally {
      actionLock.current = false;
      setActing(false);
    }
  }

  return <Stack spacing={2}>
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between", width: "100%", flexWrap: "nowrap" }}>
      <Box sx={{ flex: "1 1 420px", maxWidth: 420, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <TextField
            size="small"
            label="Rechnung suchen"
            value={search}
            disabled={locked}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onSearch(); } }}
            fullWidth
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton aria-label="Suche leeren" onClick={onClear} disabled={locked || !search}>
                      <CloseIcon />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <IconButton aria-label="Rechnungen suchen" onClick={onSearch} disabled={locked}>
            <SearchIcon />
          </IconButton>
        </Stack>
      </Box>
      {!archived && (isSmallScreen ? (
        <IconButton color="primary" aria-label="Rechnung anlegen" title="Rechnung anlegen" disabled={locked} onClick={() => navigate("/invoices/new")}>
          <AddOutlined />
        </IconButton>
      ) : (
        <Button variant="contained" disabled={locked} startIcon={<AddOutlined />} onClick={() => navigate("/invoices/new")}>
          Rechnung anlegen
        </Button>
      ))}
    </Stack>
    {error && <Alert severity="error">{error}</Alert>}
    <Paper variant="outlined" sx={{ overflowX: "auto" }}>
      {loading && <Stack sx={{ p: 3, alignItems: "center" }}><CircularProgress /></Stack>}
      {!loading && <Table size="small" sx={{ minWidth: archived ? 1100 : 750 }}>
        <TableHead><TableRow>
          <TableCell>Nummer</TableCell><TableCell>Kunde</TableCell><TableCell>Auftragsnummer</TableCell>
          <TableCell>Datum</TableCell><TableCell>Rechnungssumme</TableCell>{archived && <ArchiveDateHeaders />}{archived && <TableCell>Aktionen</TableCell>}
        </TableRow></TableHead>
        <TableBody>
          {items.map((invoice) => (
            <TableRow key={invoice.id}>
              <TableCell>{archived ? invoice.invoiceNumber : <Button disabled={locked} onClick={() => navigate(`/invoices/${invoice.id}`)}>{invoice.invoiceNumber}</Button>}</TableCell>
              <TableCell>{invoice.customerName}</TableCell>
              <TableCell>{invoice.orderNumber ?? "–"}</TableCell>
              <TableCell>{new Date(`${invoice.invoiceDate}T00:00:00`).toLocaleDateString("de-DE")}</TableCell>
              <TableCell>{currencyFormatter.format(invoiceTotal(invoice))}</TableCell>
              {archived && <ArchiveDateCells archivedAt={invoice.archivedAt} purgeAt={invoice.purgeAt} />}
              {archived && <TableCell sx={{ whiteSpace: "nowrap" }}>
                <Tooltip title="PDF herunterladen"><span>
                  <IconButton component="a" disabled={locked}
                    href={locked ? undefined : `/api/admin/invoices/${invoice.id}/pdf`}
                    aria-label="Rechnungs-PDF herunterladen"><FileDownloadOutlined />
                  </IconButton>
                </span></Tooltip>
                <Tooltip title="Wiederherstellen"><span><IconButton disabled={locked} onClick={() => void archive(invoice.id)} aria-label="Rechnung wiederherstellen"><RestoreOutlined /></IconButton></span></Tooltip>
              </TableCell>}
            </TableRow>
          ))}
          {items.length === 0 && <TableRow><TableCell colSpan={archived ? 8 : 5} align="center">Keine Rechnungen vorhanden.</TableCell></TableRow>}
        </TableBody>
      </Table>}
      <TablePagination
        component="div" count={total} page={page - 1}
        onPageChange={(_, next) => { if (!locked) setPage(next + 1); }}
        rowsPerPage={PAGE_SIZE} rowsPerPageOptions={[PAGE_SIZE]}
        slotProps={{ actions: { nextButton: { disabled: locked || page * PAGE_SIZE >= total }, previousButton: { disabled: locked || page === 1 } } }}
        labelDisplayedRows={({ from, to, count }) => `${from}–${to} von ${count}`}
      />
    </Paper>
  </Stack>;
}
