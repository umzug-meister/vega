import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { ReplyAllOutlined } from "@mui/icons-material";
import type { InboxReplyDraft, StaffEmailSendResult } from "@vega/domain";
import { apiRequest } from "../api/api-request.js";
import { AdminAlert, useAdminNotification } from "../components/AdminNotifications.js";
import { EmailSendAttempt, mailAttemptStorage } from "../email/email-send-attempt.js";

interface InboxReplyDialogProps {
  uid: number;
  onClose: () => void;
  onSent?: () => void;
}

interface ReplySendEnvelope {
  data?: StaffEmailSendResult;
  error?: { code?: string; message?: string; issues?: Array<{ message: string }> };
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Die Antwort konnte nicht vorbereitet werden.";
}

function recipientText(recipient: InboxReplyDraft["to"][number]): string {
  return recipient.name ? `${recipient.name} <${recipient.address}>` : recipient.address;
}

export function InboxReplyDialog({ uid, onClose, onSent }: InboxReplyDialogProps) {
  const notify = useAdminNotification();
  const attempt = useMemo(
    () => new EmailSendAttempt(`vega:inbox-reply:${uid}`, mailAttemptStorage()),
    [uid],
  );
  const [, refreshAttempt] = useState(0);
  const [draft, setDraft] = useState<InboxReplyDraft>();
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<StaffEmailSendResult>();

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<InboxReplyDraft>(
      `/api/admin/inbox/messages/${uid}/reply-draft`,
      "GET",
      undefined,
      { signal: controller.signal },
    )
      .then((replyDraft) => {
        setDraft(replyDraft);
        setSubject(replyDraft.subject);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorText(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [uid]);

  async function send() {
    const checking = attempt.frozen;
    if (sending || (!checking && (!draft || !text.trim()))) return;
    const payload = checking
      ? attempt.beginStatusCheck()
      : attempt.begin({ subject, text });
    if (!payload) return;
    refreshAttempt((value) => value + 1);
    setSending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/inbox/messages/${uid}/reply${checking ? "/status" : ""}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const envelope = (await response.json()) as ReplySendEnvelope;
      if (!envelope.data) {
        if (envelope.error?.code === "INVALID_EMAIL" || envelope.error?.code === "MAIL_NOT_CONFIGURED") {
          const refused = attempt.rejectBeforeQueue(envelope.error.code);
          if (refused) setOutcome(refused);
        }
        setError(
          envelope.error?.issues?.map((issue) => issue.message).join(" · ") ||
            envelope.error?.message ||
            "Die Antwort konnte nicht gesendet werden.",
        );
        return;
      }
      attempt.finish(envelope.data);
      setOutcome(envelope.data);
      if (envelope.data.status === "SENT") {
        attempt.newMessage();
        notify("success", "Antwort gesendet.");
        onSent?.();
        onClose();
      } else if (envelope.data.status === "UNKNOWN") {
        notify("warning", "Der Versand wurde nicht bestätigt. Bitte zuerst den Status prüfen.");
      }
    } catch {
      setError("Der Versandstatus ist unklar. Prüfen Sie den Status, bevor Sie erneut senden.");
    } finally {
      attempt.finish();
      refreshAttempt((value) => value + 1);
      setSending(false);
    }
  }

  function startNewAttempt() {
    attempt.newMessage();
    setOutcome(undefined);
    setError("");
    setText("");
    refreshAttempt((value) => value + 1);
  }

  const terminalFailure = outcome?.status === "FAILED" || outcome?.status === "NOT_QUEUED";
  return (
    <Dialog open onClose={sending ? undefined : onClose} fullWidth maxWidth="sm" aria-labelledby="inbox-reply-title">
      <DialogTitle id="inbox-reply-title">Allen antworten</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          {error && <AdminAlert severity="error">{error}</AdminAlert>}
          {(outcome?.status === "SENDING" || attempt.status === "SENDING") && (
            <AdminAlert severity="info" role="status">Die Antwort wird verarbeitet. Prüfen Sie den Versandstatus, bevor Sie es erneut versuchen.</AdminAlert>
          )}
          {outcome?.status === "RETRY_SCHEDULED" && (
            <AdminAlert severity="warning" role="status">Die Antwort wird sicher erneut versucht. Prüfen Sie den Status, bevor Sie eine neue Antwort senden.</AdminAlert>
          )}
          {outcome?.status === "UNKNOWN" && (
            <AdminAlert severity="warning" role="status">Der Mailanbieter hat den Versand nicht bestätigt. Eine erneute Antwort könnte doppelt ankommen.</AdminAlert>
          )}
          {terminalFailure && (
            <AdminAlert severity="error" role="status">Die Antwort wurde nicht gesendet. Nach einer Korrektur können Sie eine neue Antwort vorbereiten.</AdminAlert>
          )}
          <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
            <strong>An:</strong> {loading ? "Wird ermittelt …" : draft?.to.map(recipientText).join(", ")}
          </Typography>
          {Boolean(draft?.cc.length) && (
            <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
              <strong>Cc:</strong> {draft?.cc.map(recipientText).join(", ")}
            </Typography>
          )}
          <TextField
            label="Betreff"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            disabled={loading || sending || attempt.frozen}
            required
          />
          <TextField
            label="Nachricht"
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={loading || sending || attempt.frozen}
            multiline
            minRows={6}
            maxRows={16}
            placeholder="Nachricht schreiben"
          />
          {draft?.quoteText && (
            <>
              <Divider />
              <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {draft.quoteText}
              </Typography>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {terminalFailure && <Button onClick={startNewAttempt}>Neue Antwort</Button>}
        <Button onClick={onClose} disabled={sending}>Abbrechen</Button>
        <Button
          variant="contained"
          startIcon={sending ? <CircularProgress size={16} color="inherit" /> : <ReplyAllOutlined />}
          onClick={() => void send()}
          disabled={loading || sending || !draft || (!attempt.frozen && (!text.trim() || terminalFailure))}
        >
          {sending ? "Wird gesendet …" : attempt.frozen ? "Versandstatus prüfen" : "Senden"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
