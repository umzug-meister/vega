import {
  AutoAwesomeOutlined,
  AttachFileOutlined,
  ArrowBackOutlined,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import type {
  InboxAnalysisResult,
  InboxMessageDetail,
  InboxMessageList,
} from "@vega/domain";
import { apiRequest } from "../api/api-request.js";
import { OrderCreatePage } from "../orders/OrderCreatePage.js";
import { draftToFormValue } from "./draft-to-form.js";

interface InboxPageProps {
  navigate: (path: string) => void;
}

const DISCARD_PROMPT =
  "Der nicht gespeicherte Auftrag wird verworfen. Fortfahren?";

function errorText(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : "Die Anfrage ist fehlgeschlagen.";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function InboxPage({ navigate }: InboxPageProps) {
  const [list, setList] = useState<InboxMessageList>();
  const [page, setPage] = useState(1);
  const [listError, setListError] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [geminiEnabled, setGeminiEnabled] = useState(false);
  const [selected, setSelected] = useState<number>();
  const [detail, setDetail] = useState<InboxMessageDetail>();
  const [detailError, setDetailError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<InboxAnalysisResult>();
  const [analysisError, setAnalysisError] = useState("");
  const [analysisRun, setAnalysisRun] = useState(0);
  const [orderDirty, setOrderDirty] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);

  useEffect(() => {
    apiRequest<{ geminiEnabled: boolean }>("/api/admin/inbox/status")
      .then((status) => setGeminiEnabled(status.geminiEnabled))
      .catch(() => setGeminiEnabled(false));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingList(true);
    setListError("");
    const query = new URLSearchParams({ page: String(page) });
    apiRequest<InboxMessageList>(
      `/api/admin/inbox/messages?${query}`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then(setList)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setListError(errorText(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingList(false);
      });
    return () => controller.abort();
  }, [page]);

  useEffect(() => {
    if (selected === undefined) return;
    const controller = new AbortController();
    setDetail(undefined);
    setDetailError("");
    setAnalysis(undefined);
    setAnalysisError("");
    apiRequest<InboxMessageDetail>(
      `/api/admin/inbox/messages/${selected}`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then(setDetail)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setDetailError(errorText(reason));
      });
    return () => controller.abort();
  }, [selected]);

  function selectMessage(uid: number | undefined) {
    if (orderDirty && !window.confirm(DISCARD_PROMPT)) return;
    setOrderDirty(false);
    if (uid === undefined) setAnalysis(undefined);
    setSelected(uid);
  }

  async function analyze() {
    if (selected === undefined || analyzing) return;
    setAnalyzing(true);
    setAnalysisError("");
    try {
      const result = await apiRequest<InboxAnalysisResult>(
        `/api/admin/inbox/messages/${selected}/analyze`,
        "POST",
        {},
      );
      setAnalysis(result);
      setAnalysisRun((run) => run + 1);
    } catch (reason) {
      setAnalysisError(errorText(reason));
    } finally {
      setAnalyzing(false);
    }
  }

  const linkOrder = useCallback(
    async (orderNumber: number) => {
      if (selected === undefined) return;
      await apiRequest(
        `/api/admin/inbox/messages/${selected}/link-order`,
        "POST",
        { orderNumber },
      );
    },
    [selected],
  );

  const visibleAttachments =
    detail?.attachments.filter((item) => !item.inline) ?? [];

  const inOrderMode = analysis !== undefined;

  function backToList() {
    if (orderDirty && !window.confirm(DISCARD_PROMPT)) return;
    setOrderDirty(false);
    setAnalysis(undefined);
  }

  const listPanel = (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
      <Stack spacing={1.5}>
        <Typography component="h2" variant="h6">
          Posteingang
        </Typography>
        {listError && <Alert severity="error">{listError}</Alert>}
        {loadingList && <CircularProgress size={24} />}
        {list && !loadingList && list.messages.length === 0 && (
          <Typography color="text.secondary">Keine Nachrichten.</Typography>
        )}
        <List disablePadding>
          {list?.messages.map((message) => (
            <ListItemButton
              key={message.uid}
              onClick={() => selectMessage(message.uid)}
              selected={message.uid === selected}
              aria-pressed={message.uid === selected}
              divider
            >
              <ListItemText
                primary={message.subject || "(ohne Betreff)"}
                secondary={`${message.from?.name || message.from?.address || "Unbekannt"} · ${formatDate(message.date)}${message.attachmentCount ? ` · ${message.attachmentCount} Anhang/Anhänge` : ""}`}
                slotProps={{
                  primary: {
                    sx: { fontWeight: message.unseen ? 700 : 400 },
                    noWrap: true,
                  },
                }}
              />
            </ListItemButton>
          ))}
        </List>
        {list && list.pagination.totalPages > 1 && (
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Zurück
            </Button>
            <Typography variant="body2">
              Seite {list.pagination.page} von {list.pagination.totalPages}
            </Typography>
            <Button
              disabled={page >= list.pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Weiter
            </Button>
          </Stack>
        )}
      </Stack>
    </Paper>
  );

  const previewPanel = (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
      {selected === undefined ? (
        <Typography color="text.secondary">
          Wählen Sie eine Mail aus, um sie anzuzeigen.
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 1 }}>
            {analysis && (
              <Button startIcon={<ArrowBackOutlined />} onClick={backToList}>
                Zur Liste
              </Button>
            )}
            {geminiEnabled && (
              <Button
                variant="contained"
                sx={{ ml: "auto" }}
                startIcon={
                  analyzing ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <AutoAwesomeOutlined />
                  )
                }
                disabled={analyzing || !detail || orderBusy}
                onClick={() => void analyze()}
              >
                {analysis ? "Erneut analysieren" : "Mit KI analysieren"}
              </Button>
            )}
          </Box>
          {!geminiEnabled && (
            <Alert severity="info">Die KI-Analyse ist nicht aktiviert.</Alert>
          )}
          {analysisError && <Alert severity="error">{analysisError}</Alert>}
          {detailError && <Alert severity="error">{detailError}</Alert>}
          {!detail && !detailError && <CircularProgress size={24} />}
          {detail && (
            <>
              <Typography component="h2" variant="h6">
                {detail.subject || "(ohne Betreff)"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {detail.from?.name} &lt;{detail.from?.address}&gt; ·{" "}
                {formatDate(detail.date)}
              </Typography>
              <Divider />
              <Typography
                component="pre"
                sx={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "inherit",
                  m: 0,
                }}
              >
                {detail.text}
              </Typography>
              {visibleAttachments.length > 0 && (
                <>
                  <Divider />
                  <Stack spacing={0.5}>
                    {visibleAttachments.map((attachment) => (
                      <Button
                        key={attachment.id}
                        component="a"
                        href={`/api/admin/inbox/messages/${detail.uid}/attachments/${encodeURIComponent(attachment.id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        startIcon={<AttachFileOutlined />}
                        sx={{ justifyContent: "flex-start" }}
                      >
                        {attachment.filename} (
                        {formatSize(attachment.sizeBytes)})
                      </Button>
                    ))}
                  </Stack>
                </>
              )}
            </>
          )}
        </Stack>
      )}
    </Paper>
  );

  const orderPanel = (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
      <Stack spacing={1.5}>
        <Typography component="h2" variant="h6">
          Auftrag
        </Typography>
        {analysis && (
          <>
            {analysis.skippedAttachments.map((item) => (
              <Alert severity="error" key={`${item.filename}-${item.reason}`}>
                Anhang nicht analysiert: {item.filename}: {item.reason}
              </Alert>
            ))}
            <OrderCreatePage
              key={analysisRun}
              navigate={navigate}
              onDirtyChange={setOrderDirty}
              onBusyChange={setOrderBusy}
              dirty={orderDirty}
              initialValue={draftToFormValue(analysis.draft)}
              onCreated={linkOrder}
            />
          </>
        )}
      </Stack>
    </Paper>
  );

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "1fr 2fr" },
        gap: 2,
        alignItems: "start",
      }}
    >
      {inOrderMode ? (
        <>
          {previewPanel}
          {orderPanel}
        </>
      ) : (
        <>
          {listPanel}
          {previewPanel}
        </>
      )}
    </Box>
  );
}
