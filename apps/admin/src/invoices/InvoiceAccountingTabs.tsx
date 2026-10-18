import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Box,
  Button,
  Chip,
  IconButton,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import {
  formatGermanDate,
  MAX_REMINDER_LEVEL,
  type AdminCreditNoteDto,
  type AdminReminderDto,
  type CreditNoteInput,
  type ReminderInput,
} from "@vega/domain";
import { apiRequest } from "../api/api-request.js";
import { useAdminNotification } from "../components/AdminNotifications.js";
import type { EmailTarget } from "../email/EmailDialog.js";

const EmailDialog = lazy(() =>
  import("../email/EmailDialog.js").then((module) => ({
    default: module.EmailDialog,
  })),
);
type AccountingTab = "invoice" | "credit" | number;

export function InvoiceAccountingTabs({
  invoiceId,
  disabled,
  invoiceDirty = false,
  invoiceForm,
  onDirtyChange,
  onBusyChange,
}: {
  invoiceId: string;
  disabled: boolean;
  invoiceDirty?: boolean;
  invoiceForm: ReactNode;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const notify = useAdminNotification();
  const [tab, setTab] = useState<AccountingTab>("invoice");
  const [emailTarget, setEmailTarget] = useState<EmailTarget | null>(null);
  const [reminders, setReminders] = useState<AdminReminderDto[]>();
  const [remindersLoading, setRemindersLoading] = useState(true);
  const [remindersError, setRemindersError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ReminderInput>>({});
  const [creditDirty, setCreditDirty] = useState(false);
  const [creditBusy, setCreditBusy] = useState(true);
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const dirty = creditDirty || Object.keys(drafts).length > 0;
  const anyDirty = invoiceDirty || dirty;
  const locked =
    disabled ||
    busy ||
    creditBusy ||
    remindersLoading ||
    reminders === undefined;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange?.(busy || creditBusy || remindersLoading);
  }, [busy, creditBusy, remindersLoading, onBusyChange]);
  const load = useCallback(async () => {
    setRemindersLoading(true);
    setRemindersError("");
    try {
      const { items } = await apiRequest<{ items: AdminReminderDto[] }>(
        `/api/admin/reminders?invoiceId=${encodeURIComponent(invoiceId)}`,
      );
      setReminders(items.filter((item) => !item.archivedAt));
    } catch (error) {
      const message =
        error instanceof Error && !(error instanceof TypeError)
          ? error.message
          : "Mahnungen konnten nicht geladen werden.";
      setRemindersError(message);
      notify("error", message);
    } finally {
      setRemindersLoading(false);
    }
  }, [invoiceId, notify]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>, message: string) {
    if (actionLock.current || locked) return;
    actionLock.current = true;
    setBusy(true);
    try {
      await action();
      notify("success", message);
    } catch (error) {
      notify("error", (error as Error).message);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  function applyReminder(saved: AdminReminderDto) {
    setReminders((current) =>
      [...(current ?? []).filter((item) => item.id !== saved.id), saved].sort(
        (a, b) => a.level - b.level,
      ),
    );
    setDrafts((current) => {
      const next = { ...current };
      delete next[saved.id];
      return next;
    });
  }
  const highest = reminders?.at(-1)?.level ?? 0;
  const nextLevel = highest + 1;
  const levels = reminders
    ? [
        ...reminders.map((reminder) => reminder.level),
        ...(nextLevel <= MAX_REMINDER_LEVEL ? [nextLevel] : []),
      ]
    : [];
  return (
    <Stack spacing={2}>
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={tab}
          onChange={(_, next: AccountingTab) => {
            if (!disabled && !busy && !creditBusy && !remindersLoading)
              setTab(next);
          }}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          <Tab value="invoice" label="Rechnung" />
          {levels.map((level) => (
            <Tab
              key={level}
              value={level}
              label={
                level === nextLevel
                  ? `+ ${level}. Mahnung`
                  : `${level}. Mahnung`
              }
            />
          ))}
          <Tab value="credit" label="Gutschrift" />
        </Tabs>
      </Box>
      {remindersError && (
        <Panel>
          <Typography role="alert" color="error">
            {remindersError}
          </Typography>
          <Button
            sx={{ alignSelf: "flex-start" }}
            disabled={disabled || busy || remindersLoading}
            onClick={() => void load()}
          >
            Erneut versuchen
          </Button>
        </Panel>
      )}
      {/* Keep every draft mounted; refreshing saved records must not replace another document's draft. */}
      <Box hidden={tab !== "invoice"}>{invoiceForm}</Box>
      {reminders?.map((reminder) => (
        <Box key={reminder.id} hidden={tab !== reminder.level}>
          <ReminderCard
            reminder={reminder}
            value={drafts[reminder.id] ?? reminder}
            dirty={!!drafts[reminder.id]}
            disabled={locked}
            actionsBlocked={anyDirty}
            onChange={(value) =>
              setDrafts((current) => ({ ...current, [reminder.id]: value }))
            }
            onDelete={
              reminder.level === highest
                ? () => {
                    if (
                      anyDirty ||
                      !window.confirm(
                        `${reminder.level}. Mahnung endgültig löschen?`,
                      )
                    )
                      return;
                    void run(async () => {
                      await apiRequest(
                        `/api/admin/reminders/${reminder.id}`,
                        "DELETE",
                      );
                      setReminders((current) =>
                        current?.filter((item) => item.id !== reminder.id),
                      );
                      setTab(
                        reminder.level > 1 ? reminder.level - 1 : "invoice",
                      );
                    }, "Mahnung gelöscht.");
                  }
                : undefined
            }
            onSave={() =>
              void run(
                async () =>
                  applyReminder(
                    await apiRequest<AdminReminderDto>(
                      `/api/admin/reminders/${reminder.id}`,
                      "PUT",
                      drafts[reminder.id],
                    ),
                  ),
                "Mahnung gespeichert.",
              )
            }
            onEmail={() =>
              setEmailTarget({
                type: "reminder",
                id: reminder.id,
                level: reminder.level,
              })
            }
          />
        </Box>
      ))}
      {tab === nextLevel && nextLevel <= MAX_REMINDER_LEVEL && (
        <Panel>
          <Typography variant="body2" color="text.secondary">
            Die {nextLevel}. Mahnung ist noch nicht angelegt. Fälligkeit,
            Gebühr, Betrag und Text werden vorbelegt und können danach angepasst
            werden.
          </Typography>
          <Button
            variant="contained"
            sx={{ alignSelf: "flex-start" }}
            disabled={locked || anyDirty}
            onClick={() =>
              void run(async () => {
                applyReminder(
                  await apiRequest<AdminReminderDto>(
                    "/api/admin/reminders",
                    "POST",
                    { invoiceId, level: nextLevel },
                  ),
                );
              }, `${nextLevel}. Mahnung angelegt.`)
            }
          >
            {nextLevel}. Mahnung anlegen
          </Button>
        </Panel>
      )}
      <Box hidden={tab !== "credit"}>
        <CreditNoteSection
          invoiceId={invoiceId}
          disabled={disabled || busy || remindersLoading}
          actionsBlocked={anyDirty}
          onDirtyChange={setCreditDirty}
          onBusyChange={setCreditBusy}
          onEmail={setEmailTarget}
        />
      </Box>
      {emailTarget && (
        <Suspense fallback={null}>
          <EmailDialog
            target={emailTarget}
            onClose={() => setEmailTarget(null)}
            onSent={() => void load()}
          />
        </Suspense>
      )}
    </Stack>
  );
}

export function previousDueLabel(
  level: number,
  previousDueDate: string,
): string {
  return `${level === 1 ? "Rechnung" : `${level - 1}. Mahnung`} ist fällig am ${formatGermanDate(previousDueDate)}`;
}

function ReminderCard({
  reminder,
  value,
  dirty,
  disabled,
  actionsBlocked,
  onChange,
  onSave,
  onEmail,
  onDelete,
}: {
  reminder: AdminReminderDto;
  value: ReminderInput;
  dirty: boolean;
  disabled: boolean;
  actionsBlocked: boolean;
  onChange: (value: ReminderInput) => void;
  onSave: () => void;
  onEmail: () => void;
  onDelete?: (() => void) | undefined;
}) {
  function change<K extends keyof ReminderInput>(
    key: K,
    next: ReminderInput[K],
  ) {
    onChange({ ...value, [key]: next });
  }
  const overdue =
    reminder.previousDueDate < new Date().toISOString().slice(0, 10);
  return (
    <Panel>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {reminder.level}. Mahnung
        </Typography>
        {reminder.sentAt && (
          <Chip
            size="small"
            color="success"
            label={`Versendet am ${formatGermanDate(reminder.sentAt)}`}
          />
        )}
      </Stack>
      <Typography
        variant="body2"
        sx={{ color: overdue ? "error.main" : "success.main" }}
      >
        {previousDueLabel(reminder.level, reminder.previousDueDate)}
      </Typography>
      <fieldset disabled={disabled} style={fieldsetStyle}>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <TextField
              label="Fälligkeitsdatum der Mahnung"
              type="date"
              value={value.dueDate}
              onChange={(e) => change("dueDate", e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Mahngebühr"
              type="number"
              value={value.fee}
              onChange={(e) => change("fee", Number(e.target.value))}
            />
            <TextField
              label="Offener Betrag aus der Rechnung"
              type="number"
              value={value.outstandingAmount}
              onChange={(e) =>
                change("outstandingAmount", Number(e.target.value))
              }
            />
          </Stack>
          <TextField
            label="Text"
            helperText="Fälligkeitsdatum auch im Text anpassen."
            multiline
            minRows={6}
            value={value.text}
            onChange={(e) => change("text", e.target.value)}
          />
        </Stack>
      </fieldset>
      <DocumentActions
        disabled={disabled}
        dirty={dirty}
        actionsBlocked={actionsBlocked}
        pdfHref={`/api/admin/reminders/${reminder.id}/pdf`}
        onSave={onSave}
        onEmail={onEmail}
        onDelete={onDelete}
      />
    </Panel>
  );
}

const emptyCredit = (): CreditNoteInput => ({
  creditNumber: "",
  creditDate: new Date().toISOString().slice(0, 10),
  text: "",
  entries: [],
});
const fieldsetStyle = { border: 0, padding: 0, margin: 0, minWidth: 0 };

function CreditNoteSection({
  invoiceId,
  disabled,
  actionsBlocked,
  onDirtyChange,
  onBusyChange,
  onEmail,
}: {
  invoiceId: string;
  disabled: boolean;
  actionsBlocked: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onEmail: (target: EmailTarget) => void;
}) {
  const notify = useAdminNotification();
  const [credit, setCredit] = useState<AdminCreditNoteDto | null>();
  const [draft, setDraft] = useState<CreditNoteInput>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const actionLock = useRef(false);
  const apply = useCallback((loaded: AdminCreditNoteDto | null) => {
    setCredit(loaded);
    setDraft(loaded ?? undefined);
    setDirty(false);
  }, []);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    onBusyChange(busy || loading);
  }, [busy, loading, onBusyChange]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    void apiRequest<{ items: AdminCreditNoteDto[] }>(
      `/api/admin/credits?invoiceId=${encodeURIComponent(invoiceId)}`,
    )
      .then(({ items }) => {
        if (!cancelled) apply(items[0] ?? null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error && !(error instanceof TypeError)
            ? error.message
            : "Gutschrift konnte nicht geladen werden.";
        setLoadError(message);
        notify("error", message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apply, invoiceId, loadAttempt, notify]);
  async function run(
    action: () => Promise<AdminCreditNoteDto>,
    message: string,
  ) {
    if (actionLock.current || disabled || busy) return;
    actionLock.current = true;
    setBusy(true);
    try {
      apply(await action());
      notify("success", message);
    } catch (error) {
      notify("error", (error as Error).message);
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }
  function change<K extends keyof CreditNoteInput>(
    key: K,
    next: CreditNoteInput[K],
  ) {
    setDraft((current) => current && { ...current, [key]: next });
    setDirty(true);
  }
  function save() {
    if (!draft) return;
    void run(
      () =>
        credit
          ? apiRequest(`/api/admin/credits/${credit.id}`, "PUT", draft)
          : apiRequest("/api/admin/credits", "POST", { ...draft, invoiceId }),
      "Gutschrift gespeichert.",
    );
  }
  const locked = disabled || busy || loading;
  if (credit === undefined)
    return (
      <Panel>
        {loadError ? (
          <>
            <Typography role="alert" color="error">
              {loadError}
            </Typography>
            <Button
              sx={{ alignSelf: "flex-start" }}
              disabled={locked}
              onClick={() => setLoadAttempt((current) => current + 1)}
            >
              Erneut versuchen
            </Button>
          </>
        ) : (
          <Typography>Lade Gutschrift …</Typography>
        )}
      </Panel>
    );
  if (credit?.archivedAt) {
    return (
      <Panel>
        <ArchivedRow
          label={`Gutschrift ${credit.creditNumber} (archiviert)`}
          disabled={locked || actionsBlocked}
          onRestore={() =>
            void run(
              () =>
                apiRequest(`/api/admin/credits/${credit.id}/restore`, "POST"),
              "Gutschrift wiederhergestellt.",
            )
          }
        />
      </Panel>
    );
  }
  if (!draft)
    return (
      <Panel>
        <Button
          sx={{ alignSelf: "flex-start" }}
          disabled={locked || actionsBlocked}
          onClick={() => {
            setDraft(emptyCredit());
            setDirty(true);
          }}
        >
          Gutschrift anlegen
        </Button>
      </Panel>
    );
  return (
    <Panel>
      <fieldset disabled={locked} style={fieldsetStyle}>
        <Stack spacing={2}>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1}>
            <TextField
              label="Gutschriftnummer"
              required
              value={draft.creditNumber}
              onChange={(e) => change("creditNumber", e.target.value)}
            />
            <TextField
              label="Gutschriftdatum"
              type="date"
              required
              value={draft.creditDate}
              onChange={(e) => change("creditDate", e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
          {draft.entries.map((entry, index) => (
            <Stack
              key={index}
              direction={{ xs: "column", md: "row" }}
              spacing={1}
            >
              <TextField
                label="Beschreibung"
                value={entry.description}
                onChange={(e) =>
                  change(
                    "entries",
                    draft.entries.map((item, i) =>
                      i === index
                        ? { ...item, description: e.target.value }
                        : item,
                    ),
                  )
                }
                fullWidth
              />
              <TextField
                label="Menge"
                type="number"
                value={entry.quantity}
                onChange={(e) =>
                  change(
                    "entries",
                    draft.entries.map((item, i) =>
                      i === index
                        ? { ...item, quantity: Number(e.target.value) }
                        : item,
                    ),
                  )
                }
              />
              <TextField
                label="Einzelpreis"
                type="number"
                value={entry.unitPrice}
                onChange={(e) =>
                  change(
                    "entries",
                    draft.entries.map((item, i) =>
                      i === index
                        ? { ...item, unitPrice: Number(e.target.value) }
                        : item,
                    ),
                  )
                }
              />
              <IconButton
                aria-label="Position entfernen"
                onClick={() =>
                  change(
                    "entries",
                    draft.entries.filter((_, i) => i !== index),
                  )
                }
              >
                <DeleteOutlined />
              </IconButton>
            </Stack>
          ))}
          <Button
            sx={{ alignSelf: "flex-end" }}
            onClick={() =>
              change("entries", [
                ...draft.entries,
                { description: "", quantity: 1, unitPrice: 0 },
              ])
            }
          >
            Position hinzufügen
          </Button>
          <TextField
            label="Text"
            multiline
            minRows={3}
            value={draft.text}
            onChange={(e) => change("text", e.target.value)}
          />
        </Stack>
      </fieldset>
      <DocumentActions
        disabled={locked}
        dirty={dirty}
        actionsBlocked={actionsBlocked}
        saveDisabled={!draft.creditNumber.trim()}
        pdfHref={credit ? `/api/admin/credits/${credit.id}/pdf` : undefined}
        onSave={save}
        onEmail={
          credit ? () => onEmail({ type: "credit", id: credit.id }) : undefined
        }
        onArchive={
          credit
            ? () =>
                void run(
                  () =>
                    apiRequest(
                      `/api/admin/credits/${credit.id}/archive`,
                      "POST",
                    ),
                  "Gutschrift archiviert.",
                )
            : undefined
        }
        onCancel={
          credit
            ? undefined
            : () => {
                if (
                  !dirty ||
                  window.confirm("Ungespeicherte Gutschrift verwerfen?")
                ) {
                  setDraft(undefined);
                  setDirty(false);
                }
              }
        }
      />
    </Panel>
  );
}

function DocumentActions({
  disabled,
  dirty,
  actionsBlocked,
  saveDisabled,
  pdfHref,
  onSave,
  onEmail,
  onArchive,
  onDelete,
  onCancel,
}: {
  disabled: boolean;
  dirty: boolean;
  actionsBlocked: boolean;
  saveDisabled?: boolean;
  pdfHref?: string | undefined;
  onSave: () => void;
  onEmail?: (() => void) | undefined;
  onArchive?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onCancel?: (() => void) | undefined;
}) {
  const documentDisabled = disabled || actionsBlocked;
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ justifyContent: "flex-end", flexWrap: "wrap" }}
    >
      {onCancel && (
        <Button disabled={disabled} onClick={onCancel}>
          Abbrechen
        </Button>
      )}
      {onArchive && (
        <Button color="warning" disabled={documentDisabled} onClick={onArchive}>
          Archivieren
        </Button>
      )}
      {onDelete && (
        <Button color="error" disabled={documentDisabled} onClick={onDelete}>
          Löschen
        </Button>
      )}
      {pdfHref && (
        <Tooltip
          title={
            actionsBlocked ? "Bitte zuerst alle Änderungen speichern." : ""
          }
        >
          <span>
            <Button
              component="a"
              href={documentDisabled ? undefined : pdfHref}
              disabled={documentDisabled}
            >
              PDF
            </Button>
          </span>
        </Tooltip>
      )}
      {onEmail && (
        <Tooltip
          title={
            actionsBlocked ? "Bitte zuerst alle Änderungen speichern." : ""
          }
        >
          <span>
            <Button disabled={documentDisabled} onClick={onEmail}>
              E-Mail
            </Button>
          </span>
        </Tooltip>
      )}
      <Button
        variant="contained"
        disabled={disabled || !dirty || saveDisabled}
        onClick={onSave}
      >
        Speichern
      </Button>
    </Stack>
  );
}

function ArchivedRow({
  label,
  disabled,
  onRestore,
}: {
  label: string;
  disabled: boolean;
  onRestore: () => void;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", justifyContent: "space-between" }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Button size="small" disabled={disabled} onClick={onRestore}>
        Wiederherstellen
      </Button>
    </Stack>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <Paper component="section" variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>{children}</Stack>
    </Paper>
  );
}
