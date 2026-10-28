import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Box, Container, Paper, Typography } from "@mui/material";
import { authClient } from "../auth-client.js";
import { useAdminNotification } from "./AdminNotifications.js";
import {
  COLLAPSED_SIDEBAR_WIDTH,
  EXPANDED_SIDEBAR_WIDTH,
  AdminSidebar,
} from "./AdminSidebar.js";
import { AdminToolbar } from "./AdminToolbar.js";
import { formatAdminRouteTitle, type AdminRoute } from "../routes.js";
import type { StaffUser } from "../types.js";
import type { OrderEmailKind } from "@vega/domain";
import type { EmailTarget } from "../email/EmailDialog.js";
import { OrderEmailActionsContext } from "../email/order-email-actions.js";
import { apiRequest } from "../api/api-request.js";

// Loaded on demand so the rich-text editor stays out of the initial bundle.
const EmailDialog = lazy(() =>
  import("../email/EmailDialog.js").then((module) => ({
    default: module.EmailDialog,
  })),
);

interface AdminShellProps {
  user: StaffUser;
  route: AdminRoute;
  pathname: string;
  navigate: (path: string) => void;
  confirmLeave?: () => boolean;
  orderDirty?: boolean;
  orderBusy?: boolean;
  orderIsCopy?: boolean;
  invoiceBusy?: boolean;
  invoiceDirty?: boolean;
  invoiceAccountingDirty?: boolean;
  invoiceNumber?: string | undefined;
  children: ReactNode;
}

export function AdminShell({
  user,
  route,
  pathname,
  navigate,
  confirmLeave,
  children,
  orderDirty = false,
  orderBusy = false,
  orderIsCopy = false,
  invoiceBusy = false,
  invoiceDirty = false,
  invoiceAccountingDirty = false,
  invoiceNumber,
}: AdminShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailTarget, setEmailTarget] = useState<EmailTarget | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const actionLock = useRef(false);
  const sidebarWidth = sidebarCollapsed
    ? COLLAPSED_SIDEBAR_WIDTH
    : EXPANDED_SIDEBAR_WIDTH;
  const notify = useAdminNotification();
  const isAdmin = user.role === "Admin";
  const editedOrderNumber = pathname.match(/^\/edit\/(-?\d+)$/u)?.[1];
  const editedInvoiceId =
    pathname === "/invoices/new" || pathname === "/invoices/archived"
      ? undefined
      : pathname.match(/^\/invoices\/([^/]+)$/u)?.[1];
  const isInvoiceEditor =
    editedInvoiceId !== undefined ||
    pathname === "/invoices/new" ||
    route.sourceOrderNumber !== undefined;
  const orderHasChanges = orderDirty || editedOrderNumber === "-1";
  const invoiceHasChanges =
    invoiceDirty || (isInvoiceEditor && !editedInvoiceId);
  const orderActionsDisabled = busy || orderBusy || orderHasChanges;
  const invoiceActionsDisabled =
    busy || invoiceBusy || invoiceHasChanges || invoiceAccountingDirty;
  const headerTitle = editedOrderNumber
    ? `Auftrag | ${editedOrderNumber === "-1" ? "Neu" : editedOrderNumber}`
    : isInvoiceEditor
      ? editedInvoiceId
        ? invoiceNumber
          ? `Rechnung | ${invoiceNumber}`
          : "Rechnung"
        : "Rechnung | Neu"
      : formatAdminRouteTitle(route);

  useEffect(() => {
    document.title = `Vega | ${headerTitle}`;
  }, [headerTitle]);

  useEffect(() => {
    setEmailTarget(null);
  }, [pathname]);

  async function runAction(action: () => Promise<void>, message: string) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      notify(
        "error",
        error instanceof Error && !(error instanceof TypeError)
          ? error.message
          : message,
      );
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  async function signOut() {
    if (confirmLeave && !confirmLeave()) return;
    await runAction(async () => {
      const result = await authClient.signOut();
      if (result.error)
        throw new Error(result.error.message ?? "Abmelden ist fehlgeschlagen.");
      window.location.assign("/login");
    }, "Abmelden ist fehlgeschlagen.");
  }

  async function copyOrder() {
    if (!editedOrderNumber || orderActionsDisabled) return;
    await runAction(async () => {
      const result = await apiRequest<{ orderNumber: number }>(
        `/api/admin/orders/${editedOrderNumber}/copy`,
        "POST",
      );
      if (!Number.isInteger(result.orderNumber))
        throw new Error("Die Angebotskopie konnte nicht geöffnet werden.");
      navigate(`/edit/${result.orderNumber}`);
    }, "Angebotskopie konnte nicht angelegt werden.");
  }

  async function archiveOrder() {
    if (
      !editedOrderNumber ||
      orderActionsDisabled ||
      !window.confirm("Auftrag wirklich archivieren?")
    )
      return;
    await runAction(async () => {
      await apiRequest(
        `/api/admin/orders/${editedOrderNumber}/archive`,
        "POST",
      );
      navigate("/");
    }, "Auftrag konnte nicht archiviert werden.");
  }

  function openOrderEmail(kind: OrderEmailKind) {
    if (editedOrderNumber && !orderActionsDisabled)
      setEmailTarget({
        type: "order",
        orderNumber: Number(editedOrderNumber),
        kind,
      });
  }

  function openInvoiceEmail() {
    if (editedInvoiceId)
      setEmailTarget({ type: "invoice", id: editedInvoiceId });
  }

  async function archiveInvoice() {
    if (
      !editedInvoiceId ||
      invoiceActionsDisabled ||
      !window.confirm(
        "Rechnung vor dem Archivieren extern sichern. Rechnung wirklich archivieren?",
      )
    )
      return;
    await runAction(async () => {
      await apiRequest(
        `/api/admin/invoices/${editedInvoiceId}/archive`,
        "POST",
      );
      navigate("/invoices");
    }, "Rechnung konnte nicht archiviert werden.");
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "background.default",
        backgroundImage:
          "radial-gradient(ellipse at 82% -12%, rgba(36, 88, 211, 0.07), transparent 34%)",
      }}
    >
      <AdminToolbar
        title={headerTitle}
        pathname={pathname}
        sidebarWidth={sidebarWidth}
        isOrderEditor={pathname.startsWith("/edit/")}
        editedOrderNumber={editedOrderNumber}
        actionBusy={busy}
        orderBusy={orderBusy}
        orderActionsDisabled={orderActionsDisabled}
        orderHasChanges={orderHasChanges}
        orderIsCopy={orderIsCopy}
        isAdmin={isAdmin}
        isInvoiceEditor={isInvoiceEditor}
        editedInvoiceId={editedInvoiceId}
        invoiceBusy={invoiceBusy}
        invoiceAccountingDirty={invoiceAccountingDirty}
        invoiceActionsDisabled={invoiceActionsDisabled}
        invoiceHasChanges={invoiceHasChanges}
        onOpenDrawer={() => setDrawerOpen(true)}
        onCopyOrder={() => void copyOrder()}
        onArchiveOrder={() => void archiveOrder()}
        onOrderEmail={openOrderEmail}
        onInvoiceEmail={openInvoiceEmail}
        onArchiveInvoice={() => void archiveInvoice()}
      />
      {emailTarget && (
        <Suspense fallback={null}>
          <EmailDialog
            target={emailTarget}
            onClose={() => setEmailTarget(null)}
          />
        </Suspense>
      )}
      <AdminSidebar
        route={route}
        pathname={pathname}
        isAdmin={isAdmin}
        busy={busy}
        drawerOpen={drawerOpen}
        sidebarCollapsed={sidebarCollapsed}
        onDrawerOpenChange={setDrawerOpen}
        onSidebarCollapsedChange={setSidebarCollapsed}
        onNavigate={navigate}
        onSignOut={() => void signOut()}
      />
      <Box
        component="main"
        sx={{
          ml: { md: `${sidebarWidth}px` },
          pt: { xs: "58px", md: "68px" },
          minHeight: "100vh",
        }}
      >
        <OrderEmailActionsContext.Provider
          value={{ open: openOrderEmail, disabled: orderActionsDisabled }}
        >
          <Container
            maxWidth="xl"
            sx={{
              maxWidth: "1800px !important",
              py: { xs: 2.5, md: 3.5 },
              px: { xs: 2, sm: 3, lg: 4 },
            }}
          >
            {route.adminOnly && !isAdmin ? (
              <Paper variant="outlined" sx={{ p: 3 }}>
                <Typography color="error">
                  Diese Route ist nur für Admins freigeschaltet.
                </Typography>
              </Paper>
            ) : (
              children
            )}
          </Container>
        </OrderEmailActionsContext.Provider>
      </Box>
    </Box>
  );
}
