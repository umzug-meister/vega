import { useEffect, useState } from "react";
import { Card, CircularProgress, List, ListItem, ListItemText, Stack, Typography } from "@mui/material";
import { AdminAlert as Alert } from "../components/AdminNotifications.js";
import type { AdminOrderJournalEntry } from "@vega/domain";

const ACTION_LABELS: Record<string, string> = {
  CREATED_PUBLIC: "Auftrag über das öffentliche Formular eingegangen",
  CREATED_ADMIN: "Auftrag in der Verwaltung angelegt",
  COPIED: "Angebotskopie erstellt",
  UPDATED: "Auftrag angepasst",
  ARCHIVED: "Auftrag archiviert",
  RESTORED: "Auftrag wiederhergestellt",
  PDF_EXPORTED: "PDF exportiert",
  OFFER_SENT_AS_OPTION: "Als zweites Angebot per E-Mail versendet",
  EMAIL_SENT_INQUIRY_RECEIVED: "Eingangsbestätigung per E-Mail versendet",
  EMAIL_SENT_OFFER: "Angebot per E-Mail versendet",
  EMAIL_SENT_ORDER_MESSAGE: "E-Mail versendet",
  EMAIL_SENT_INQUIRY_DECLINED: "Absage per E-Mail versendet",
  EMAIL_SENT_INVOICE: "Rechnung per E-Mail versendet",
};

export function JournalTab({ orderNumber }: { orderNumber?: number }) {
  const [items, setItems] = useState<AdminOrderJournalEntry[]>([]);
  const [loading, setLoading] = useState(orderNumber !== undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    if (orderNumber === undefined) return;
    let cancelled = false;
    void fetch(`/api/admin/orders/${orderNumber}/journal`, { credentials: "same-origin" })
      .then(async (response) => ({ response, body: await response.json() as { data?: { items?: AdminOrderJournalEntry[] }; error?: { message?: string } } }))
      .then(({ response, body }) => {
        if (cancelled) return;
        if (!response.ok || !body.data?.items) setError(body.error?.message ?? "Journal konnte nicht geladen werden.");
        else setItems(body.data.items);
      })
      .catch(() => { if (!cancelled) setError("Journal konnte nicht geladen werden."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [orderNumber]);

  if (orderNumber === undefined) return <Card><List disablePadding><ListItem sx={{ px: 2, py: 1 }}><ListItemText primary={<Typography color="text.secondary">Das Journal steht nach dem ersten Speichern des Auftrags zur Verfügung.</Typography>} /></ListItem></List></Card>;
  if (loading) return <Stack sx={{ py: 4, alignItems: "center" }}><CircularProgress /></Stack>;
  if (error) return <Alert severity="error">{error}</Alert>;
  return <Stack spacing={2}>
    {items.length > 0 ? items.map((entry) => (
      <Card key={entry.id}>
        <List disablePadding>
          <ListItem sx={{ px: 2, py: 1 }}>
            <ListItemText primary={labelFor(entry.action)} secondary={`${new Date(entry.occurredAt).toLocaleString("de-DE")} · ${entry.actorName}`} />
          </ListItem>
        </List>
      </Card>
    )) : (
      <Card>
        <List disablePadding>
          <ListItem sx={{ px: 2, py: 1 }}>
            <ListItemText primary="Noch keine Ereignisse vorhanden." />
          </ListItem>
        </List>
      </Card>
    )}
  </Stack>;
}

function labelFor(action: string): string {
  const label = ACTION_LABELS[action];
  if (label) return label;
  if (action.startsWith("EMAIL_SENT_")) return `E-Mail versandt (${action.slice("EMAIL_SENT_".length)})`;
  return action;
}
