import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, TextField } from "@mui/material";
import type { AdminOrderDetail } from "@vega/domain";
import { apiRequest } from "../api/api-request.js";

interface FilenameRequest {
  orderNumber: number;
  revision: number;
  filename: string;
  previousFilename: string | null;
}

export function useOrderPdfFilename(
  scope?: string | number,
  onFilenameChange?: (orderNumber: number, filename: string) => void,
) {
  const titleId = useId();
  const [request, setRequest] = useState<FilenameRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const resolve = useRef<((confirmed: boolean) => void) | null>(null);
  const lock = useRef(false);
  const lifetime = useRef(new AbortController());

  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setRequest(null);
    return () => {
      controller.abort();
      resolve.current?.(false);
      resolve.current = null;
    };
  }, [scope]);

  function finish(confirmed: boolean) {
    resolve.current?.(confirmed);
    resolve.current = null;
    setRequest(null);
  }

  const requestPdfFilename = useCallback(async (orderNumber: number, edit: boolean) => {
    if (lock.current) return false;
    lock.current = true;
    const { signal } = lifetime.current;
    try {
      const order = await apiRequest<AdminOrderDetail>(`/api/admin/orders/${orderNumber}`, "GET", undefined, { signal });
      if (signal.aborted) return false;
      if (order.pdfFilename) {
        onFilenameChange?.(orderNumber, order.pdfFilename);
        if (!edit) return true;
      }
      setError("");
      setRequest({
        orderNumber,
        revision: order.revision,
        filename: (order.pdfFilename ?? order.defaultPdfFilename).replace(/\.pdf$/iu, ""),
        previousFilename: order.pdfFilename ?? null,
      });
      return await new Promise<boolean>((done) => { resolve.current = done; });
    } catch (reason) {
      if (signal.aborted) return false;
      throw reason;
    } finally {
      lock.current = false;
    }
  }, [onFilenameChange]);

  function ensurePdfFilename(orderNumber: number) {
    return requestPdfFilename(orderNumber, false);
  }

  function editPdfFilename(orderNumber: number) {
    return requestPdfFilename(orderNumber, true);
  }

  async function confirm() {
    if (!request || busy) return;
    setBusy(true);
    setError("");
    const { signal } = lifetime.current;
    try {
      const saved = await apiRequest<{ pdfFilename: string }>(`/api/admin/orders/${request.orderNumber}/pdf-filename`, "PUT", {
        filename: request.filename,
        revision: request.revision,
        ...(request.previousFilename ? { previousFilename: request.previousFilename } : {}),
      }, { signal });
      if (signal.aborted) return;
      onFilenameChange?.(request.orderNumber, saved.pdfFilename);
      finish(true);
    } catch (reason) {
      if (signal.aborted) return;
      setError(reason instanceof Error && !(reason instanceof TypeError)
        ? reason.message
        : "Der Dateiname konnte nicht gespeichert werden. Bitte versuchen Sie es erneut.");
    } finally {
      setBusy(false);
    }
  }

  const filenameDialog = (
    <Dialog
      open={request !== null}
      onClose={() => { if (!busy) finish(false); }}
      maxWidth="xs"
      fullWidth
      aria-labelledby={titleId}
    >
      <DialogTitle id={titleId}>Angebotsdatei benennen</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          label="Dateiname"
          value={request?.filename ?? ""}
          disabled={busy}
          error={Boolean(error)}
          helperText={error || "Dieser Name wird am Auftrag gespeichert. Die Endung .pdf wird automatisch ergänzt."}
          onChange={(event) => {
            setRequest((current) => current ? { ...current, filename: event.target.value } : null);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (request?.filename.trim()) void confirm();
            }
          }}
          slotProps={{
            htmlInput: { maxLength: 255 },
            input: {
              endAdornment: <InputAdornment position="end">.pdf</InputAdornment>,
            },
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={() => finish(false)}>Abbrechen</Button>
        <Button variant="contained" disabled={busy || !request?.filename.trim()} onClick={() => void confirm()}>OK</Button>
      </DialogActions>
    </Dialog>
  );
  return { ensurePdfFilename, editPdfFilename, filenameDialog };
}
