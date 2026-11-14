import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import AddOutlined from "@mui/icons-material/AddOutlined";
import FileDownloadOutlined from "@mui/icons-material/FileDownloadOutlined";
import RestoreOutlined from "@mui/icons-material/RestoreOutlined";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, CircularProgress, IconButton, InputAdornment, Paper, Stack, Table, TableBody, TableCell, TableHead, TablePagination, TableRow, TextField, Tooltip, useMediaQuery, useTheme } from "@mui/material";
import { AdminAlert as Alert } from "../components/AdminNotifications.js";
import type { AdminOrderListItem } from "@vega/domain";
import { apiRequest } from "../api/api-request.js";
import { ArchiveDateCells, ArchiveDateHeaders } from "../components/ArchiveDates.js";

const PAGE_SIZE = 10;

export function OrdersPage({ archived = false, navigate }: { archived?: boolean; navigate: (path: string) => void }) {
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [items, setItems] = useState<AdminOrderListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [page, setPage] = useState(() => pageFromUrl());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const archiveLock = useRef(false);
  const [archiveBusy, setArchiveBusy] = useState(false);

  const loadOrders = useCallback(async (nextPage: number, searchValue = "") => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ archived: String(archived), page: String(nextPage), pageSize: String(PAGE_SIZE) });
      if (searchValue.trim()) query.set("search", searchValue.trim());
      const response = await fetch(`/api/admin/orders?${query}`, { credentials: "same-origin" });
      const body = await response.json() as { data?: { items?: AdminOrderListItem[]; total?: number }; error?: { message?: string } };
      if (!response.ok || !body.data?.items || typeof body.data.total !== "number") {
        setError(body.error?.message ?? "Aufträge konnten nicht geladen werden.");
        return;
      }
      setItems(body.data.items); setTotal(body.data.total);
    } catch { setError("Aufträge konnten nicht geladen werden."); }
    finally { setLoading(false); }
  }, [archived]);

  useEffect(() => { void loadOrders(page, activeSearch); }, [activeSearch, loadOrders, page]);

  function setCurrentPage(nextPage: number) {
    const safePage = Math.max(1, nextPage);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?page=${safePage}`);
    setPage(safePage);
  }

  async function onSearch() {
    const value = search.trim();
    if (!value) { onClear(); return; }
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ archived: String(archived), page: "1", pageSize: String(PAGE_SIZE), search: value });
      const response = await fetch(`/api/admin/orders?${query}`, { credentials: "same-origin" });
      const body = await response.json() as { data?: { items?: AdminOrderListItem[]; total?: number }; error?: { message?: string } };
      if (!response.ok || !body.data?.items || typeof body.data.total !== "number") { setError(body.error?.message ?? "Aufträge konnten nicht geladen werden."); return; }
      if (!archived && /^\d+$/u.test(value) && body.data.items.length === 1) { navigate(`/edit/${body.data.items[0]!.orderNumber}`); return; }
      setItems(body.data.items); setTotal(body.data.total); setActiveSearch(value); setCurrentPage(1);
    } catch { setError("Aufträge konnten nicht geladen werden."); }
    finally { setLoading(false); }
  }

  function onClear() { setSearch(""); setActiveSearch(""); setCurrentPage(1); }
  async function changeArchive(orderNumber: number) {
    if (archiveLock.current) return;
    archiveLock.current = true;
    setArchiveBusy(true);
    setError("");
    try {
      await apiRequest(`/api/admin/orders/${orderNumber}/${archived ? "restore" : "archive"}`, "POST");
      await loadOrders(page, activeSearch);
    } catch (reason) {
      setError(reason instanceof Error && !(reason instanceof TypeError) ? reason.message : "Aktion konnte nicht ausgeführt werden.");
    } finally {
      archiveLock.current = false;
      setArchiveBusy(false);
    }
  }

  return <Stack spacing={2}>
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        flexWrap: "nowrap",
      }}
    >
      <Box sx={{ flex: "1 1 420px", maxWidth: 420, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <TextField
            size="small"
            label="Auftrag suchen"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void onSearch(); } }}
            fullWidth
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="Suche leeren"
                      title="Suche leeren"
                      onClick={onClear}
                      disabled={loading || !search}
                      size="small"
                    >
                      <CloseIcon />
                    </IconButton>
                    <IconButton
                      aria-label="Aufträge suchen"
                      title="Aufträge suchen"
                      onClick={() => void onSearch()}
                      disabled={loading}
                      size="small"
                      edge="end"
                    >
                      <SearchIcon />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        </Stack>
      </Box>
      {!archived &&
        (isSmallScreen ? (
          <IconButton
            color="primary"
            aria-label="Auftrag anlegen"
            title="Auftrag anlegen"
            sx={{ mb: 1 }}
            onClick={() => navigate("/edit/-1")}
          >
            <AddOutlined />
          </IconButton>
        ) : (
          <Button
            variant="contained"
            startIcon={<AddOutlined />}
            sx={{ mb: 1 }}
            onClick={() => navigate("/edit/-1")}
          >
            Auftrag anlegen
          </Button>
        ))}
    </Stack>
    {error && <Alert severity="error">{error}</Alert>}
    <Paper variant="outlined" sx={{ overflowX: "auto" }}>
      {loading && <Stack sx={{ height: 420, alignItems: "center", justifyContent: "center" }}><CircularProgress /></Stack>}
      {!loading && (
        <Table size="small" sx={{ minWidth: archived ? 1350 : 1100 }}>
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Kunde</TableCell>
              <TableCell>Datum</TableCell>
              <TableCell sx={{ width: 240, maxWidth: 240 }}>Auszugsadresse</TableCell>
              {!archived && <TableCell padding="checkbox">HVZ</TableCell>}
              <TableCell sx={{ width: 240, maxWidth: 240 }}>Einzugsadresse</TableCell>
              {!archived && <TableCell padding="checkbox">HVZ</TableCell>}
              <TableCell>Mann</TableCell>
              <TableCell>LKW</TableCell>
              <TableCell>Std.</TableCell>
              {archived && <ArchiveDateHeaders />}
              <TableCell align="right">Summe</TableCell>
              {archived && <TableCell>Aktionen</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((order) => (
              <TableRow
                key={order.orderNumber}
                hover
                sx={{ "& td": { fontWeight: order.editedAt ? "normal" : 700 } }}
              >
                <TableCell>
                  {archived ? (
                    order.orderNumber
                  ) : (
                    <Button
                      size="small"
                      onClick={() => navigate(`/edit/${order.orderNumber}`)}
                    >
                      {order.orderNumber}
                    </Button>
                  )}
                </TableCell>
                <TableCell sx={{ whiteSpace: "nowrap" }}>{[order.customerCompany?.trim(), order.customerName].filter(Boolean).join(" - ")}</TableCell>
                <TableCell>{formatDate(order.movingDate)}</TableCell>
                <AddressCell address={order.fromAddress} />
                {!archived && <TableCell padding="checkbox">
                  {order.fromParkingSlot && (
                    <CheckCircleIcon color="success" fontSize="small" />
                  )}
                </TableCell>}
                <AddressCell address={order.toAddress} />
                {!archived && <TableCell padding="checkbox">
                  {order.toParkingSlot && (
                    <CheckCircleIcon color="success" fontSize="small" />
                  )}
                </TableCell>}
                <TableCell>{order.workers ?? ""}</TableCell>
                <TableCell>{order.trucks ?? ""}</TableCell>
                <TableCell>{order.hours ?? ""}</TableCell>
                {archived && <ArchiveDateCells archivedAt={order.archivedAt} purgeAt={order.purgeAt} />}
                <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                  {formatCurrency(order.grossTotal)}
                </TableCell>
                {archived && (
                  <TableCell sx={{ whiteSpace: "nowrap" }}>
                    <Tooltip title="PDF herunterladen">
                      <IconButton
                        component="a"
                        href={`/api/admin/orders/${order.orderNumber}/pdf`}
                        aria-label="Auftrags-PDF herunterladen"
                      >
                        <FileDownloadOutlined />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Wiederherstellen">
                      <IconButton
                        disabled={archiveBusy}
                        onClick={() => void changeArchive(order.orderNumber)}
                        aria-label="Auftrag wiederherstellen"
                      >
                        <RestoreOutlined />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={archived ? 12 : 11} align="center">
                  Keine Aufträge gefunden.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
      <TablePagination component="div" count={total} page={page - 1} onPageChange={(_, next) => setCurrentPage(next + 1)} rowsPerPage={PAGE_SIZE} rowsPerPageOptions={[PAGE_SIZE]} labelDisplayedRows={({ from, to, count }) => `${from}–${to} von ${count}`} />
    </Paper>
  </Stack>;
}

function pageFromUrl(): number { const value = Number(new URLSearchParams(window.location.search).get("page")); return Number.isInteger(value) && value > 0 ? value : 1; }
function formatDate(value: string): string { return value ? new Date(`${value}T00:00:00`).toLocaleDateString("de-DE") : ""; }
function formatCurrency(value: number): string { return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value); }

function AddressCell({ address }: { address: string }) {
  return (
    <TableCell sx={{ width: 240, maxWidth: 240 }}>
      <Box
        component="span"
        title={address}
        sx={{
          display: "block",
          width: 240,
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {address}
      </Box>
    </TableCell>
  );
}
