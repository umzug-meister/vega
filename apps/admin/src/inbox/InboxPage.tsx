import {
  ArrowBackOutlined,
  AutoAwesomeOutlined,
  AttachFileOutlined,
  ContentCopyOutlined,
  EmailOutlined,
  FileDownloadOutlined,
  ReplyAllOutlined,
  SaveOutlined,
  SearchOutlined,
} from "@mui/icons-material";
import {
  Alert,
  Badge,
  Box,
  Button,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import type {
  InboxAnalysisResult,
  InboxMessageDetail,
  InboxMessageList,
} from "@vega/domain";
import { apiRequest } from "../api/api-request.js";
import { AdminCard } from "../components/AdminCard.js";
import { useOrderEmailActions } from "../email/order-email-actions.js";
import { OrderCreatePage } from "../orders/OrderCreatePage.js";
import { draftToFormValue } from "./draft-to-form.js";
import { InboxReplyDialog } from "./InboxReplyDialog.js";

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
  const [replyOpen, setReplyOpen] = useState(false);
  const [createdOrderNumber, setCreatedOrderNumber] = useState<number>();
  const [linkedOrderNumber, setLinkedOrderNumber] = useState<number>();
  const [orderNumberInput, setOrderNumberInput] = useState("");
  const [linkingOrder, setLinkingOrder] = useState(false);
  const [linkOrderError, setLinkOrderError] = useState("");
  const [detail, setDetail] = useState<InboxMessageDetail>();
  const [detailError, setDetailError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<InboxAnalysisResult>();
  const [analysisError, setAnalysisError] = useState("");
  const [analysisRun, setAnalysisRun] = useState(0);
  const [orderDirty, setOrderDirty] = useState(false);
  const [orderBusy, setOrderBusy] = useState(false);
  const orderEmailActions = useOrderEmailActions();

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
    setReplyOpen(false);
    setOrderDirty(false);
    if (uid !== selected) {
      setAnalysis(undefined);
      setCreatedOrderNumber(undefined);
      setLinkedOrderNumber(undefined);
      setOrderNumberInput("");
      setLinkOrderError("");
    }
    setSelected(uid);
  }

  async function analyze() {
    if (selected === undefined || analyzing || orderBusy || (analysis && orderDirty)) return;
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
      setLinkedOrderNumber(orderNumber);
      setCreatedOrderNumber(orderNumber);
      setLinkOrderError("");
    },
    [selected],
  );

  async function loadExistingOrder() {
    const orderNumber = Number(orderNumberInput.trim());
    if (
      selected === undefined ||
      linkingOrder ||
      orderBusy ||
      !Number.isSafeInteger(orderNumber) ||
      orderNumber <= 0
    )
      return;
    setLinkingOrder(true);
    setLinkOrderError("");
    try {
      await linkOrder(orderNumber);
    } catch (reason) {
      setLinkOrderError(errorText(reason));
    } finally {
      setLinkingOrder(false);
    }
  }

  async function copyOrder() {
    if (
      createdOrderNumber === undefined ||
      selected === undefined ||
      orderDirty ||
      orderBusy
    )
      return;
    setOrderBusy(true);
    setLinkOrderError("");
    try {
      const result = await apiRequest<{ orderNumber: number }>(
        `/api/admin/orders/${createdOrderNumber}/copy`,
        "POST",
      );
      if (!Number.isSafeInteger(result.orderNumber) || result.orderNumber <= 0)
        throw new Error("Die Angebotskopie konnte nicht geöffnet werden.");
      await linkOrder(result.orderNumber);
    } catch (reason) {
      setLinkOrderError(errorText(reason));
    } finally {
      setOrderBusy(false);
    }
  }

  const navigateOrder = useCallback((path: string) => {
    const savedOrder = path.match(/^\/edit\/(\d+)$/u);
    if (savedOrder) {
      setCreatedOrderNumber(Number(savedOrder[1]));
      return;
    }
    navigate(path);
  }, [navigate]);

  const visibleAttachments =
    detail?.attachments.filter((item) => !item.inline) ?? [];

  const inOrderMode =
    analysis !== undefined || createdOrderNumber !== undefined;

  function backToList() {
    selectMessage(undefined);
  }

  const listPanel = (
    <AdminCard variant="outlined" sx={{ minWidth: 0 }}>
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
    </AdminCard>
  );

  const previewPanel = (
    <AdminCard
      variant="outlined"
      sx={{
        minWidth: 0,
        height:
          selected === undefined
            ? "auto"
            : { xs: "calc(100dvh - 90px)", md: "calc(100dvh - 100px)" },
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        "& .MuiCardContent-root": {
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        },
      }}
    >
      {selected === undefined ? (
        <Typography color="text.secondary">
          Wählen Sie eine Mail aus, um sie anzuzeigen.
        </Typography>
      ) : (
        <Stack spacing={1.5} sx={{ flex: 1, minHeight: 0 }}>
          <Box sx={{ display: "flex", flexWrap: "nowrap", alignItems: "center", gap: 1, overflowX: "auto" }}>
            {inOrderMode && selected !== undefined && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<ArrowBackOutlined />}
                onClick={backToList}
                sx={{ flexShrink: 0 }}
              >
                Zurück
              </Button>
            )}
            {detail && !analysis && createdOrderNumber === undefined && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<ReplyAllOutlined />}
                disabled={analyzing || orderBusy}
                onClick={() => setReplyOpen(true)}
                sx={{ flexShrink: 0 }}
              >
                Antwort
              </Button>
            )}
            {detail && !analysis && createdOrderNumber === undefined && (
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "1 0 220px",
                }}
              >
                <TextField
                  label="Auftragsnummer"
                  type="text"
                  value={orderNumberInput}
                  onChange={(event) => {
                    setOrderNumberInput(event.target.value);
                    setLinkOrderError("");
                  }}
                  disabled={linkingOrder || orderBusy}
                  size="small"
                  sx={{ width: 220, maxWidth: "100%" }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void loadExistingOrder();
                    }
                  }}
                  slotProps={{
                    htmlInput: { inputMode: "numeric" },
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            type="button"
                            aria-label="Auftrag laden"
                            title="Auftrag laden"
                            edge="end"
                            size="small"
                            disabled={
                              linkingOrder ||
                              orderBusy ||
                              !orderNumberInput.trim()
                            }
                            onClick={() => void loadExistingOrder()}
                          >
                            {linkingOrder ? (
                              <CircularProgress size={16} />
                            ) : (
                              <SearchOutlined />
                            )}
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
              </Stack>
            )}
            {geminiEnabled && !analysis && createdOrderNumber === undefined && (
              <Button
                variant="contained"
                size="small"
                startIcon={
                  analyzing ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <AutoAwesomeOutlined />
                  )
                }
                disabled={analyzing || !detail || orderBusy}
                onClick={() => void analyze()}
                sx={{ flexShrink: 0 }}
              >
                {analyzing ? "Wird generiert …" : "Generieren"}
              </Button>
            )}
          </Box>
          {!geminiEnabled && (
            <Alert severity="info">Die KI-Analyse ist nicht aktiviert.</Alert>
          )}
          {linkOrderError && <Alert severity="error">{linkOrderError}</Alert>}
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
              <Box
                component="section"
                aria-label="E-Mail-Inhalt"
                sx={{
                  minHeight: 0,
                  flex: 1,
                  overflow: "auto",
                  overflowWrap: "anywhere",
                  "& table": { maxWidth: "100%" },
                }}
              >
                {detail.html ? (
                  <Box
                    component="div"
                    sx={{ maxWidth: "100%", overflowWrap: "anywhere" }}
                    dangerouslySetInnerHTML={{ __html: detail.html }}
                  />
                ) : (
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
                )}
                {visibleAttachments.length > 0 && (
                  <>
                    <Divider sx={{ my: 1.5 }} />
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
              </Box>
            </>
          )}
        </Stack>
      )}
    </AdminCard>
  );

  const orderPanel = (
    <AdminCard variant="outlined" sx={{ minWidth: 0 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <Typography component="h2" variant="h6">
            {createdOrderNumber === undefined
              ? "Auftrag"
              : `Auftrag | ${createdOrderNumber}`}
          </Typography>
          {(analysis || createdOrderNumber !== undefined) && (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
              <Tooltip title="Speichern">
                <span>
                  <IconButton
                    color="inherit"
                    type="submit"
                    form="order-create-form"
                    disabled={orderBusy}
                    aria-label="Auftrag speichern"
                  >
                    <Badge color="error" variant="dot" invisible={!orderDirty}>
                      <SaveOutlined />
                    </Badge>
                  </IconButton>
                </span>
              </Tooltip>
              {createdOrderNumber !== undefined && (
                <Tooltip title="Angebotskopie anlegen">
                  <span>
                    <IconButton
                      color="inherit"
                      disabled={orderDirty || orderBusy}
                      onClick={() => void copyOrder()}
                      aria-label="Angebotskopie anlegen"
                    >
                      <ContentCopyOutlined />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              {createdOrderNumber !== undefined && (
                <Tooltip title="Als PDF speichern">
                  <span>
                    <IconButton
                      color="inherit"
                      type="submit"
                      form="order-create-form"
                      name="action"
                      value="pdf"
                      disabled={orderDirty || orderBusy}
                      aria-label="PDF erzeugen"
                    >
                      <FileDownloadOutlined />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
              <Tooltip title="Angebot versenden">
                <span>
                  <IconButton
                    color="inherit"
                    disabled={createdOrderNumber === undefined || orderDirty || orderBusy || !orderEmailActions || linkedOrderNumber !== createdOrderNumber}
                    onClick={() => {
                      if (createdOrderNumber !== undefined) {
                        orderEmailActions?.openForOrder(createdOrderNumber, "offer", true, true);
                      }
                    }}
                    aria-label="Angebot versenden"
                  >
                    <EmailOutlined />
                  </IconButton>
                </span>
              </Tooltip>
            </Stack>
          )}
        </Stack>
        {(analysis || createdOrderNumber !== undefined) && (
          <>
            {analysis?.skippedAttachments.map((item) => (
              <Alert severity="error" key={`${item.filename}-${item.reason}`}>
                Anhang nicht analysiert: {item.filename}: {item.reason}
              </Alert>
            ))}
            <OrderCreatePage
              key={createdOrderNumber === undefined ? `draft-${analysisRun}` : `saved-${createdOrderNumber}`}
              {...(createdOrderNumber !== undefined ? { orderNumber: createdOrderNumber } : {})}
              navigate={navigateOrder}
              onDirtyChange={setOrderDirty}
              onBusyChange={setOrderBusy}
              dirty={orderDirty}
              {...(analysis ? { initialValue: draftToFormValue(analysis.draft) } : {})}
              {...(analysis && createdOrderNumber === undefined ? { onCreated: linkOrder } : {})}
            />
          </>
        )}
      </Stack>
    </AdminCard>
  );

  return (
    <>
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
      {replyOpen && selected !== undefined && (
        <InboxReplyDialog
          key={selected}
          uid={selected}
          onClose={() => setReplyOpen(false)}
          onSent={() => setReplyOpen(false)}
        />
      )}
    </>
  );
}
