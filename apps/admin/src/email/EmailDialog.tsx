import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import type {
  AdminOrderFamilyMember,
  EmailDraft,
  OrderEmailKind,
  StaffEmailSendResult,
} from "@vega/domain";
import { apiRequest, type ApiEnvelope } from "../api/api-request.js";
import {
  AdminAlert as Alert,
  useAdminNotification,
} from "../components/AdminNotifications.js";
import { RichTextEditor } from "../components/RichTextEditor.js";
import { familyLabel } from "./family-label.js";
import { EmailSendAttempt, mailAttemptStorage } from "./email-send-attempt.js";

export type EmailTarget =
  | {
      type: "order";
      orderNumber: number;
      kind: OrderEmailKind;
      replyToSourceMail?: boolean;
      simpleSignature?: boolean;
    }
  | { type: "invoice"; id: string }
  | { type: "credit"; id: string }
  | { type: "reminder"; id: string; level: number };

const TITLES: Record<OrderEmailKind | "invoice" | "credit", string> = {
  offer: "Angebot versenden",
  "offer-pair": "2 Angebote versenden",
  decline: "Absage versenden",
  message: "E-Mail versenden",
  invoice: "Rechnung versenden",
  credit: "Gutschrift versenden",
};

const DOCUMENT_PATHS = {
  invoice: "/api/admin/invoices",
  credit: "/api/admin/credits",
  reminder: "/api/admin/reminders",
} as const;
const EMAIL_DIALOG_TIMEOUT_MS = 30_000;

interface EmailDialogProps {
  target: EmailTarget;
  onClose: () => void;
  timeoutMs?: number;
  /** Called after the mail was accepted (sent or queued for retry). */
  onSent?: () => void;
}

/**
 * Shared send dialog. The server builds the draft from the saved document,
 * renders the PDF attachments at send time and is authoritative for recipient,
 * family and role checks; the dialog only edits recipient, subject and text.
 */
export function EmailDialog({
  target,
  onClose,
  onSent,
  timeoutMs = EMAIL_DIALOG_TIMEOUT_MS,
}: EmailDialogProps) {
  const notify = useAdminNotification();
  const isPair = target.type === "order" && target.kind === "offer-pair";
  const [partners, setPartners] = useState<AdminOrderFamilyMember[]>();
  const [partner, setPartner] = useState<number>();
  const [draft, setDraft] = useState<EmailDraft>();
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [outcome, setOutcome] = useState<StaffEmailSendResult>();
  const [, updateAttempt] = useState(0);
  const requestTimer = useRef<number | undefined>(undefined);
  const basePath =
    target.type === "order"
      ? `/api/admin/orders/${target.orderNumber}`
      : `${DOCUMENT_PATHS[target.type]}/${encodeURIComponent(target.id)}`;
  const ownOrderNumber =
    target.type === "order" ? target.orderNumber : undefined;
  const query =
    target.type === "order"
      ? `?kind=${target.kind}${isPair ? `&partner=${partner ?? ""}` : ""}${target.replyToSourceMail ? "&reply=1" : ""}`
      : "";
  const attempt = useMemo(
    () => new EmailSendAttempt(
      `vega:mail:${basePath}${target.type === "order" && target.simpleSignature ? ":simple-signature" : ""}`,
      mailAttemptStorage(),
    ),
    [basePath, target],
  );
  const frozen = sending || attempt.frozen;
  const completed =
    attempt.status === "FAILED" ||
    attempt.status === "SENT" ||
    attempt.status === "NOT_QUEUED";

  useEffect(
    () => () => {
      if (requestTimer.current !== undefined)
        window.clearTimeout(requestTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!isPair) return;
    const controller = new AbortController();
    apiRequest<{ items: AdminOrderFamilyMember[] }>(
      `${basePath}/family`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then(({ items }) => {
        const options = items.filter(
          (item) => item.orderNumber !== ownOrderNumber && !item.archived,
        );
        setPartners(options);
        setPartner(
          options.find((item) => item.isOrigin)?.orderNumber ??
            options[0]?.orderNumber,
        );
        if (!options.length)
          setError(
            "In dieser Auftragsfamilie gibt es keinen weiteren, nicht archivierten Auftrag.",
          );
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorText(reason));
      });
    return () => controller.abort();
  }, [basePath, isPair, ownOrderNumber]);

  useEffect(() => {
    if (isPair && partner === undefined) return;
    const controller = new AbortController();
    setDraft(undefined);
    setError("");
    apiRequest<EmailDraft>(
      `${basePath}/email-draft${query}`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((loaded) => {
        setDraft(loaded);
        setTo(loaded.to);
        setSubject(loaded.subject);
        setHtml(loaded.contentHtml);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorText(reason));
      });
    return () => controller.abort();
  }, [basePath, isPair, partner, query]);

  async function send() {
    const checking = attempt.frozen;
    if (sending || (!checking && !draft)) return;
    const body = checking
      ? attempt.beginStatusCheck()
      : attempt.begin({
          to,
          subject,
          contentHtml: html,
          ...(target.type === "order"
            ? {
                kind: target.kind,
                ...(target.simpleSignature ? { simpleSignature: true } : {}),
                ...(target.replyToSourceMail
                  ? { replyToSourceMail: true }
                  : {}),
                ...(isPair && partner !== undefined
                  ? { partnerOrderNumber: partner }
                  : {}),
              }
            : {}),
        });
    if (!body) return;
    setCheckingStatus(checking);
    setSending(true);
    setError("");
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      requestTimer.current = undefined;
      timedOut = true;
      attempt.finish({ status: "UNKNOWN", errorCode: "MAIL_TIMEOUT" });
      setSending(false);
      setCheckingStatus(false);
      notify(
        "warning",
        checking
          ? "Der Versandstatus konnte nach 30 Sekunden nicht geprüft werden. Bitte später erneut prüfen."
          : "Der Versand dauert länger als 30 Sekunden. Das Ergebnis sollte gegebenenfalls geprüft werden. Der Dialog wurde geschlossen.",
      );
      onClose();
    }, timeoutMs);
    requestTimer.current = timeout;
    try {
      const response = await fetch(
        `${basePath}/emails${checking ? "/status" : ""}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const result =
        (await response.json()) as ApiEnvelope<StaffEmailSendResult>;
      if (!result.data) {
        if (
          result.error?.code === "INVALID_EMAIL" ||
          result.error?.code === "MAIL_NOT_CONFIGURED"
        ) {
          const refused = attempt.rejectBeforeQueue(result.error.code);
          if (refused) setOutcome(refused);
        }
        setError(
          result.error?.issues?.map((issue) => issue.message).join(" · ") ||
            result.error?.message ||
            "Die E-Mail konnte nicht versendet werden.",
        );
        return;
      }
      attempt.finish(result.data);
      setOutcome(result.data);
      if (result.data.status === "SENT") {
        notify("success", "E-Mail versendet.");
        attempt.newMessage();
        onSent?.();
        if (!timedOut) onClose();
      } else if (result.data.status === "RETRY_SCHEDULED") {
        onSent?.();
      } else if (result.data.status === "UNKNOWN" && !timedOut) {
        notify(
          "warning",
          "Der Versand wurde nicht bestätigt. Bitte vor einem erneuten Versand den Status prüfen.",
        );
        onClose();
      }
    } catch {
      if (!timedOut) {
        setError(
          `${checking ? "Die Statusantwort" : "Die Versandantwort"} fehlt. Bitte Status prüfen; dieselbe Versandkennung wird wiederverwendet. Es wird keine neue E-Mail angelegt.`,
        );
      }
    } finally {
      window.clearTimeout(timeout);
      if (requestTimer.current === timeout) requestTimer.current = undefined;
      attempt.finish();
      setSending(false);
    }
  }

  const title =
    target.type === "reminder"
      ? `${target.level}. Mahnung versenden`
      : TITLES[target.type === "order" ? target.kind : target.type];
  return (
    <Dialog
      open
      onClose={sending ? undefined : onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="email-dialog-title"
    >
      <DialogTitle id="email-dialog-title">{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1}>
          {error && (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          )}
          {(outcome?.status === "SENDING" || attempt.status === "SENDING") && (
            <Alert severity="info" role="status">
              Der Versand läuft bereits. Bitte den Status prüfen; es wird keine
              weitere E-Mail angelegt.
            </Alert>
          )}
          {(outcome?.status === "RETRY_SCHEDULED" ||
            attempt.status === "RETRY_SCHEDULED") && (
            <Alert severity="warning" role="status">
              Die E-Mail wurde noch nicht gesendet. Ein sicher wiederholbarer
              Fehler wird automatisch erneut versucht.
            </Alert>
          )}
          {(outcome?.status === "FAILED" || attempt.status === "FAILED") && (
            <Alert severity="error" role="status">
              Die E-Mail wurde nicht gesendet
              {outcome?.status === "FAILED" ? ` (${outcome.errorCode})` : ""}.
              Nach Korrektur können Sie ausdrücklich eine neue E-Mail
              vorbereiten.
            </Alert>
          )}
          {(outcome?.status === "NOT_QUEUED" ||
            attempt.status === "NOT_QUEUED") && (
            <Alert severity="info" role="status">
              Die ursprüngliche E-Mail wurde nicht eingereiht. Ihre alte
              Versandkennung ist sicher gesperrt. Sie können jetzt ausdrücklich
              eine neue E-Mail mit dem angezeigten Entwurf vorbereiten.
            </Alert>
          )}
          {isPair && partners && partners.length > 0 && (
            <TextField
              select
              label="Zweites Angebot"
              value={partner ?? ""}
              disabled={frozen}
              onChange={(event) => setPartner(Number(event.target.value))}
              helperText="Ein Wechsel lädt den Entwurf neu; eigene Textänderungen gehen dabei verloren."
            >
              {partners.map((item) => (
                <MenuItem key={item.orderNumber} value={item.orderNumber}>
                  {familyLabel(item)}
                </MenuItem>
              ))}
            </TextField>
          )}
          {!draft && !error && (
            <Stack sx={{ py: 4, alignItems: "center" }}>
              <CircularProgress aria-label="Entwurf wird geladen" />
            </Stack>
          )}
          {draft && (
            <>
              <TextField
                label="Empfänger"
                type="email"
                required
                value={to}
                disabled={frozen}
                onChange={(event) => setTo(event.target.value)}
              />
              <TextField
                label="Betreff"
                required
                value={subject}
                disabled={frozen}
                onChange={(event) => setSubject(event.target.value)}
              />
              {draft.attachmentNames.length > 0 && (
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ flexWrap: "wrap" }}
                  aria-label="Anhänge"
                >
                  {draft.attachmentNames.map((name) => (
                    <Chip
                      key={name}
                      label={name}
                      size="small"
                      variant="outlined"
                    />
                  ))}
                </Stack>
              )}
              <RichTextEditor
                key={draft.subject + draft.contentHtml}
                initialHtml={draft.contentHtml}
                disabled={frozen}
                onChange={setHtml}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={sending}>
          {attempt.frozen ? "Schließen" : "Abbrechen"}
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            if (completed) {
              attempt.newMessage();
              setOutcome(undefined);
              setError("");
              updateAttempt((value) => value + 1);
            } else void send();
          }}
          disabled={
            sending ||
            (!attempt.frozen && (!draft || !to.trim() || !subject.trim()))
          }
        >
          {sending
            ? checkingStatus
              ? "Status wird geprüft …"
              : "Wird gesendet …"
            : completed
              ? "Neue E-Mail vorbereiten"
              : attempt.frozen
                ? "Status prüfen"
                : "Senden"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function errorText(reason: unknown): string {
  return reason instanceof Error && !(reason instanceof TypeError)
    ? reason.message
    : "Der Server ist derzeit nicht erreichbar. Bitte versuchen Sie es erneut.";
}
