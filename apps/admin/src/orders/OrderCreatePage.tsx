import { useEffect, useRef, useState, type FormEvent } from "react";
import { Stack } from "@mui/material";
import type {
  AdminOrderDetail,
  CreateOrderInput,
  CreateOrderResult,
  OrderDetailsInput,
  OrderPricingPreview,
  OrderRouteSnapshotInput,
} from "@vega/domain";
import { AdminAlert as Alert } from "../components/AdminNotifications.js";
import { useAdminNotification } from "../components/AdminNotifications.js";
import { SectionTabs } from "../components/SectionTabs.js";
import { AddressesTab } from "./AddressesTab.js";
import { BasisTab } from "./BasisTab.js";
import { ConditionsTab, hasPricingInputsChanged } from "./ConditionsTab.js";
import { CustomerTab } from "./CustomerTab.js";
import { ExtrasTab } from "./ExtrasTab.js";
import { FurnitureTab } from "./FurnitureTab.js";
import { JournalTab } from "./JournalTab.js";
import { OrderFamilyLinks } from "./OrderFamilyLinks.js";
import { createEmptyOrder, type OrderFormValue } from "./order-form-types.js";
import {
  downloadOrderPdf,
  saveAndFetchOrderPdf,
} from "./order-pdf-download.js";

const tabNames = [
  "Kunde",
  "Adressen",
  "Umzugsgut",
  "Leistungen & Packmaterial",
  "Basis",
  "Positionen",
  "Journal",
];

function toFormValue(data: CreateOrderInput): OrderFormValue {
  const base = createEmptyOrder();
  return {
    ...base,
    ...data,
    customer: { ...base.customer, ...data.customer },
    from: { ...base.from, ...data.from },
    to: { ...base.to, ...data.to },
    details: data.details ?? base.details,
  };
}

export function orderForSave(value: OrderFormValue): OrderFormValue {
  return {
    ...value,
    details: {
      ...value.details,
      furniture: {
        ...value.details.furniture,
        items: value.details.furniture.items.filter(
          (item) => item.name.trim().length > 0,
        ),
      },
      extras: {
        ...value.details.extras,
        services: value.details.extras.services.filter(
          (service) =>
            service.name.trim().length > 0 &&
            (service.catalogId !== undefined ||
              (typeof service.unitPrice === "number" &&
                Number.isFinite(service.unitPrice))),
        ),
      },
    },
  };
}

interface OrderCreatePageProps {
  navigate: (path: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onCopyChange?: (isCopy: boolean) => void;
  dirty: boolean;
  orderNumber?: number;
}

interface ApiErrorResponse {
  error?: {
    code?: string;
    message?: string;
    issues?: Array<{ field: string; message: string }>;
    changedFields?: string[];
  };
}

export function OrderCreatePage({
  navigate,
  onDirtyChange,
  onBusyChange,
  onCopyChange,
  dirty,
  orderNumber,
}: OrderCreatePageProps) {
  const [value, setValue] = useState(createEmptyOrder);
  const valueRef = useRef(value);
  const [activeTab, setActiveTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notify = useAdminNotification();
  const [loading, setLoading] = useState(orderNumber !== undefined);
  const [loadFailed, setLoadFailed] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const revisionRef = useRef<number | null>(null);
  const routeSaveInFlight = useRef(false);

  useEffect(() => {
    onBusyChange(loading || busy || loadFailed);
  }, [loading, busy, loadFailed, onBusyChange]);

  useEffect(() => {
    if (orderNumber === undefined) return;
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setRevision(null);
    revisionRef.current = null;
    setError(null);
    void fetch(`/api/admin/orders/${orderNumber}`, {
      credentials: "same-origin",
    })
      .then(async (response) => ({
        response,
        body: (await response.json()) as {
          data?: AdminOrderDetail;
          error?: { message?: string };
        },
      }))
      .then(({ response, body }) => {
        if (cancelled) return;
        if (!response.ok || !body.data) {
          setError(
            body.error?.message ?? "Auftrag konnte nicht geladen werden.",
          );
          setLoadFailed(true);
          return;
        }
        if (body.data.archivedAt) {
          navigate("/orders/archived");
          return;
        }
        setRevision(body.data.revision);
        revisionRef.current = body.data.revision;
        const loaded = toFormValue(body.data.data);
        valueRef.current = loaded;
        setValue(loaded);
        onCopyChange?.(body.data.isCopy);
        onDirtyChange(false);
      })
      .catch(() => {
        if (!cancelled) {
          setError("Auftrag konnte nicht geladen werden.");
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, onCopyChange, onDirtyChange, orderNumber]);

  function update(patch: Partial<OrderFormValue>) {
    const next = { ...valueRef.current, ...patch };
    valueRef.current = next;
    setValue(next);
    onDirtyChange(true);
  }

  function updateDetails(details: OrderDetailsInput) {
    const next = { ...valueRef.current, details };
    valueRef.current = next;
    setValue(next);
    onDirtyChange(true);
  }

  async function persistRouteSnapshot(snapshot: OrderRouteSnapshotInput) {
    const current = valueRef.current;
    const next: OrderFormValue = {
      ...current,
      details: {
        ...current.details,
        distanceKm: snapshot.distanceKm,
        distanceSource: "route",
        routeSnapshot: snapshot,
      },
    };
    valueRef.current = next;
    setValue(next);
    onDirtyChange(true);

    // New orders have no server record yet; their route snapshot is included in
    // the initial order save. Existing orders persist every recalculated route.
    const expectedRevision = revisionRef.current;
    if (orderNumber === undefined || expectedRevision === null) return;
    if (routeSaveInFlight.current) return;

    routeSaveInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/orders/${orderNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ ...next, revision: expectedRevision }),
      });
      const body = (await response.json()) as {
        data?: AdminOrderDetail;
        error?: {
          message?: string;
          issues?: Array<{ field: string; message: string }>;
        };
      };
      if (!response.ok || !body.data) {
        const message =
          body.error?.issues?.map((issue) => issue.message).join(" · ") ||
          body.error?.message ||
          "Die berechnete Fahrstrecke konnte nicht gespeichert werden.";
        setError(message);
        return;
      }
      revisionRef.current = body.data.revision;
      setRevision(body.data.revision);
      if (valueRef.current === next) {
        const saved = toFormValue(body.data.data);
        valueRef.current = saved;
        setValue(saved);
        onDirtyChange(false);
      }
      notify("success", "Fahrstrecke und Fahrzeiten wurden gespeichert.");
    } catch (reason) {
      setError(
        reason instanceof Error && !(reason instanceof TypeError)
          ? reason.message
          : "Die berechnete Fahrstrecke konnte nicht gespeichert werden. Bitte speichern Sie den Auftrag erneut.",
      );
    } finally {
      routeSaveInFlight.current = false;
      setBusy(false);
    }
  }

  async function save(): Promise<boolean> {
    const saveValue = orderForSave(valueRef.current);
    const pricingNeedsReview = hasPricingInputsChanged(saveValue);
    const response = await fetch(
      orderNumber === undefined
        ? "/api/orders"
        : `/api/admin/orders/${orderNumber}`,
      {
        method: orderNumber === undefined ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(
          orderNumber === undefined ? saveValue : { ...saveValue, revision },
        ),
      },
    );
    const body = (await response.json()) as {
      data?: CreateOrderResult | AdminOrderDetail;
    } & ApiErrorResponse;
    if (!response.ok || !body.data) {
      if (body.error?.code === "PRICE_PREVIEW_STALE")
        console.error("[Vega] Preisvorschau ist veraltet.", {
          code: body.error.code,
          changedFields: body.error.changedFields ?? [],
        });
      const issues = body.error?.issues ?? [];
      const fieldErrors = issues.map((issue) => issue.message);
      const firstField = issues[0]?.field ?? "";
      if (firstField.startsWith("customer")) setActiveTab(0);
      else if (
        firstField === "from" ||
        firstField === "to" ||
        firstField.startsWith("details.secondaryFrom") ||
        firstField.startsWith("details.secondaryTo")
      )
        setActiveTab(1);
      else if (firstField.startsWith("details.furniture")) setActiveTab(2);
      else if (firstField.startsWith("details.extras")) setActiveTab(3);
      else if (
        firstField === "movingDate" ||
        firstField === "movingTime" ||
        firstField.startsWith("date") ||
        firstField.startsWith("details.basis")
      )
        setActiveTab(4);
      else if (firstField.startsWith("details.conditions")) setActiveTab(5);
      setError(
        fieldErrors.length > 0
          ? fieldErrors.join(" · ")
          : (body.error?.message ??
              "Der Auftrag konnte nicht gespeichert werden."),
      );
      return false;
    }
    if (orderNumber === undefined) {
      onDirtyChange(false);
      navigate(`/edit/${body.data.orderNumber}`);
      notify("success", "Auftrag angelegt.");
    } else {
      const saved = body.data as AdminOrderDetail;
      setRevision(saved.revision);
      revisionRef.current = saved.revision;
      const savedValue = toFormValue(saved.data);
      valueRef.current = savedValue;
      setValue(savedValue);
      onDirtyChange(false);
      notify(
        pricingNeedsReview ? "warning" : "success",
        pricingNeedsReview
          ? "Auftrag gespeichert. Preisrelevante Angaben wurden geändert. Bitte prüfen und berechnen Sie die Positionen gegebenenfalls neu."
          : "Auftrag gespeichert.",
      );
    }
    return true;
  }

  async function previewPricing() {
    if (busy || loading || loadFailed) return;
    setBusy(true);
    setPricingBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/orders/pricing-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(value),
      });
      const body = (await response.json()) as {
        data?: OrderPricingPreview;
        error?: { message?: string; issues?: Array<{ message: string }> };
      };
      const preview = body.data;
      if (!response.ok || !preview) {
        setError(
          body.error?.issues?.map((issue) => issue.message).join(" · ") ||
            body.error?.message ||
            "Das Angebot konnte nicht berechnet werden.",
        );
        return;
      }
      const next = {
        ...valueRef.current,
        pricingSnapshot: preview.pricingSnapshot,
        details: {
          ...valueRef.current.details,
          conditions: preview.conditions,
        },
      };
      valueRef.current = next;
      setValue(next);
      onDirtyChange(true);
      notify(
        "success",
        "Kalkulation übernommen. Bitte speichern Sie den Auftrag.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error && !(reason instanceof TypeError)
          ? reason.message
          : "Der Server ist derzeit nicht erreichbar. Bitte versuchen Sie es erneut.",
      );
    } finally {
      setPricingBusy(false);
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || loading || loadFailed) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const exportPdf =
      submitter instanceof HTMLButtonElement && submitter.value === "pdf";
    const createInvoice =
      submitter instanceof HTMLButtonElement && submitter.value === "invoice";
    if ((exportPdf || createInvoice) && (dirty || orderNumber === undefined)) {
      setError("Bitte speichern Sie den Auftrag zuerst.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (exportPdf && orderNumber !== undefined) {
        if (
          (value.from.parkingSlot || value.to.parkingSlot) &&
          !value.details.conditions.some((condition) =>
            condition.description.toUpperCase().includes("HALTEVERBOT"),
          )
        ) {
          notify(
            "warning",
            "Halteverbotzone(n) wurde(n) ausgewählt! Bitte entweder die HVZ entfernen oder als Position aufnehmen.",
          );
        }
        const file = await saveAndFetchOrderPdf(orderNumber, () =>
          Promise.resolve(true),
        );
        if (file) downloadOrderPdf(file);
      } else if (createInvoice && orderNumber !== undefined) {
        navigate(`/invoices/new/from-order/${orderNumber}`);
      } else {
        await save();
      }
    } catch (error) {
      setError(
        error instanceof Error && !(error instanceof TypeError)
          ? error.message
          : "Der Server ist derzeit nicht erreichbar. Bitte versuchen Sie es erneut.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack
      component="form"
      id="order-create-form"
      spacing={2}
      onSubmit={submit}
      noValidate
      sx={{
        mt: { xs: -1.5, md: -2.5 },
        "& .MuiTextField-root": { minWidth: 0, maxWidth: "100%" },
        "& .MuiGrid-root > .MuiTextField-root": { width: "100%" },
        "& .MuiFormControlLabel-root": { maxWidth: "100%" },
        "& .MuiFormControlLabel-label": { overflowWrap: "anywhere" },
      }}
    >
      {loading && <Alert severity="info">Auftrag wird geladen …</Alert>}
      {error && (
        <Alert severity="error" role="alert">
          {error}
        </Alert>
      )}
      {orderNumber !== undefined && (
        <OrderFamilyLinks
          orderNumber={orderNumber}
          dirty={dirty}
          navigate={navigate}
        />
      )}
      <SectionTabs
        label="Auftragsschritte"
        value={activeTab}
        onChange={(next) => setActiveTab(Number(next))}
        sticky
        tabs={tabNames.map((label, index) => ({
          label,
          value: index,
          id: `order-tab-${index}`,
          ariaControls: `order-tabpanel-${index}`,
        }))}
      />
      <fieldset
        disabled={busy || loading}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        <div
          role="tabpanel"
          id="order-tabpanel-0"
          aria-labelledby="order-tab-0"
          hidden={activeTab !== 0}
        >
          <CustomerTab value={value} update={update} />
        </div>
        <div
          role="tabpanel"
          id="order-tabpanel-1"
          aria-labelledby="order-tab-1"
          hidden={activeTab !== 1}
        >
          <AddressesTab
            value={value}
            ready={!loading}
            update={update}
            onDetailsChange={updateDetails}
            onRouteCalculated={persistRouteSnapshot}
          />
        </div>
        <div
          role="tabpanel"
          id="order-tabpanel-2"
          aria-labelledby="order-tab-2"
          hidden={activeTab !== 2}
        >
          <FurnitureTab
            value={value}
            update={update}
            onFurnitureChange={(furniture) =>
              updateDetails({ ...value.details, furniture })
            }
            {...(orderNumber === undefined ? {} : { orderNumber })}
          />
        </div>
        <div
          role="tabpanel"
          id="order-tabpanel-3"
          aria-labelledby="order-tab-3"
          hidden={activeTab !== 3}
        >
          <ExtrasTab
            value={value}
            onExtrasChange={(extras) =>
              updateDetails({ ...value.details, extras })
            }
          />
        </div>
        <div
          role="tabpanel"
          id="order-tabpanel-4"
          aria-labelledby="order-tab-4"
          hidden={activeTab !== 4}
        >
          <BasisTab
            value={value}
            update={update}
            onBasisChange={(basis) =>
              updateDetails({ ...value.details, basis })
            }
          />
        </div>
        <div
          role="tabpanel"
          id="order-tabpanel-5"
          aria-labelledby="order-tab-5"
          hidden={activeTab !== 5}
        >
          <ConditionsTab
            value={value}
            onConditionsChange={(conditions) =>
              updateDetails({ ...value.details, conditions })
            }
            onCalculate={() => void previewPricing()}
          />
        </div>
        <div
          role="tabpanel"
          id="order-tabpanel-6"
          aria-labelledby="order-tab-6"
          hidden={activeTab !== 6}
        >
          {activeTab === 6 && (
            <JournalTab
              {...(orderNumber === undefined ? {} : { orderNumber })}
            />
          )}
        </div>
      </fieldset>
      {busy && (
        <Alert severity="info" role="status">
          {pricingBusy
            ? "Kalkulation wird erstellt …"
            : "Auftrag wird gespeichert …"}
        </Alert>
      )}
    </Stack>
  );
}
