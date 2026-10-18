import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccountCircleOutlined,
  AdminPanelSettingsOutlined,
  CategoryOutlined,
  ChairOutlined,
  ChevronLeft,
  ChevronRight,
  HandymanOutlined,
  ViewModuleOutlined,
  LocalOfferOutlined,
  PaymentsOutlined,
  ArchiveOutlined,
  ContentCopyOutlined,
  ExpandLess,
  ExpandMore,
  FileDownloadOutlined,
  FormatListNumberedOutlined,
  Inventory2Outlined,
  LogoutOutlined,
  MenuOutlined,
  EmailOutlined,
  PeopleAltOutlined,
  ReceiptLongOutlined,
  SaveOutlined,
  SettingsOutlined,
  BuildOutlined,
} from "@mui/icons-material";
import {
  AppBar,
  Badge,
  Box,
  Collapse,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { authClient } from "../auth-client.js";
import { useAdminNotification } from "./AdminNotifications.js";
import type { AdminRoute } from "../routes.js";
import type { StaffUser } from "../types.js";
import type { EmailTarget } from "../email/EmailDialog.js";
import { apiRequest } from "../api/api-request.js";

// Loaded on demand so the rich-text editor stays out of the initial bundle.
const EmailDialog = lazy(() =>
  import("../email/EmailDialog.js").then((module) => ({
    default: module.EmailDialog,
  })),
);

const EXPANDED_SIDEBAR_WIDTH = 264;
const COLLAPSED_SIDEBAR_WIDTH = 72;

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
  const [contentOpen, setContentOpen] = useState(
    route.settingsArea === "content",
  );
  const [managementOpen, setManagementOpen] = useState(
    route.settingsArea === "users" || route.path === "/maintenance",
  );
  const [archiveOpen, setArchiveOpen] = useState(
    pathname === "/orders/archived" || pathname === "/invoices/archived",
  );
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const [emailMenuAnchor, setEmailMenuAnchor] = useState<HTMLElement | null>(
    null,
  );
  const [emailTarget, setEmailTarget] = useState<EmailTarget | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const sidebarWidth = sidebarCollapsed
    ? COLLAPSED_SIDEBAR_WIDTH
    : EXPANDED_SIDEBAR_WIDTH;
  const notify = useAdminNotification();
  const isAdmin = user.role === "Admin";
  const isContentArea = route.settingsArea === "content";
  const isManagementArea =
    route.settingsArea === "users" || route.path === "/maintenance";
  const isArchivePath =
    pathname === "/orders/archived" || pathname === "/invoices/archived";
  const editedOrderNumber = pathname.match(/^\/edit\/(-?\d+)$/u)?.[1];
  const editedInvoiceId =
    pathname === "/invoices/new" || pathname === "/invoices/archived"
      ? undefined
      : pathname.match(/^\/invoices\/([^/]+)$/u)?.[1];
  const isInvoiceEditor =
    editedInvoiceId !== undefined ||
    pathname === "/invoices/new" ||
    pathname === "/blanco" ||
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
      : route.title;

  useEffect(() => {
    if (isContentArea) setContentOpen(true);
  }, [isContentArea]);

  useEffect(() => {
    if (isManagementArea) setManagementOpen(true);
  }, [isManagementArea]);

  useEffect(() => {
    if (isArchivePath) setArchiveOpen(true);
  }, [isArchivePath]);

  useEffect(() => {
    document.title = `Vega | ${headerTitle}`;
  }, [headerTitle]);

  useEffect(() => {
    setEmailMenuAnchor(null);
    setEmailTarget(null);
  }, [pathname]);

  async function signOut() {
    if (confirmLeave && !confirmLeave()) return;
    await runAction(async () => {
      const result = await authClient.signOut();
      if (result.error)
        throw new Error(result.error.message ?? "Abmelden ist fehlgeschlagen.");
      window.location.assign("/login");
    }, "Abmelden ist fehlgeschlagen.");
  }

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

  function openOrderEmail(kind: "offer" | "offer-pair" | "decline") {
    setEmailMenuAnchor(null);
    if (editedOrderNumber && !orderActionsDisabled)
      setEmailTarget({
        type: "order",
        orderNumber: Number(editedOrderNumber),
        kind,
      });
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
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          width: { md: `calc(100% - ${sidebarWidth}px)` },
          ml: { md: `${sidebarWidth}px` },
        }}
      >
        <Toolbar
          sx={{ minHeight: { xs: 58, md: 68 }, px: { xs: 1.5, sm: 2.5 } }}
        >
          <IconButton
            color="inherit"
            onClick={() => setDrawerOpen(true)}
            aria-label="Menü öffnen"
            sx={{ display: { md: "none" } }}
          >
            <MenuOutlined />
          </IconButton>
          <Typography
            component="h1"
            variant="h6"
            sx={{ flexGrow: 1, ml: { xs: 1, md: 0 } }}
          >
            {headerTitle}
          </Typography>
          {pathname.startsWith("/edit/") && (
            <>
              <Tooltip title="Speichern">
                <span>
                  <IconButton
                    color="inherit"
                    type="submit"
                    form="order-create-form"
                    disabled={busy || orderBusy}
                    aria-label="Auftrag speichern"
                  >
                    <Badge
                      color="error"
                      variant="dot"
                      invisible={!orderHasChanges}
                    >
                      <SaveOutlined />
                    </Badge>
                  </IconButton>
                </span>
              </Tooltip>
              {editedOrderNumber && (
                <>
                  <Tooltip title="Angebotskopie anlegen">
                    <span>
                      <IconButton
                        color="inherit"
                        disabled={orderActionsDisabled}
                        onClick={() => void copyOrder()}
                        aria-label="Angebotskopie anlegen"
                      >
                        <ContentCopyOutlined />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Als PDF speichern">
                    <span>
                      <IconButton
                        color="inherit"
                        type="submit"
                        form="order-create-form"
                        name="action"
                        value="pdf"
                        disabled={orderActionsDisabled}
                        aria-label="PDF erzeugen"
                      >
                        <FileDownloadOutlined />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="E-Mail versenden">
                    <span>
                      <IconButton
                        color="inherit"
                        disabled={orderActionsDisabled}
                        onClick={(event) =>
                          setEmailMenuAnchor(event.currentTarget)
                        }
                        aria-label="E-Mail versenden"
                        aria-haspopup="menu"
                      >
                        <EmailOutlined />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Menu
                    anchorEl={emailMenuAnchor}
                    open={emailMenuAnchor !== null}
                    onClose={() => setEmailMenuAnchor(null)}
                  >
                    <MenuItem onClick={() => openOrderEmail("offer")}>
                      Angebot versenden
                    </MenuItem>
                    {orderIsCopy && (
                      <MenuItem onClick={() => openOrderEmail("offer-pair")}>
                        2 Angebote versenden
                      </MenuItem>
                    )}
                    <MenuItem onClick={() => openOrderEmail("decline")}>
                      Absage versenden
                    </MenuItem>
                  </Menu>
                  <Divider
                    orientation="vertical"
                    flexItem
                    sx={{ mx: 1.5, my: 1 }}
                  />
                  <Tooltip title="Archivieren">
                    <span>
                      <IconButton
                        color="warning"
                        disabled={orderActionsDisabled}
                        onClick={() => void archiveOrder()}
                        aria-label="Auftrag archivieren"
                      >
                        <ArchiveOutlined />
                      </IconButton>
                    </span>
                  </Tooltip>
                  {isAdmin && (
                    <>
                      <Divider
                        orientation="vertical"
                        flexItem
                        sx={{ mx: 1.5, my: 1 }}
                      />
                      <Tooltip title="Rechnung aus Auftrag anlegen">
                        <span>
                          <IconButton
                            color="inherit"
                            type="submit"
                            form="order-create-form"
                            name="action"
                            value="invoice"
                            disabled={orderActionsDisabled}
                            aria-label="Rechnung aus Auftrag anlegen"
                          >
                            <ReceiptLongOutlined />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </>
                  )}
                </>
              )}
            </>
          )}
          {isInvoiceEditor && (
            <>
              <Tooltip title="Speichern">
                <span>
                  <IconButton
                    color="inherit"
                    type="submit"
                    form="invoice-editor-form"
                    disabled={
                      busy ||
                      invoiceBusy ||
                      (invoiceAccountingDirty && !invoiceHasChanges)
                    }
                    aria-label="Rechnung speichern"
                  >
                    <Badge
                      color="error"
                      variant="dot"
                      invisible={!invoiceHasChanges}
                    >
                      <SaveOutlined />
                    </Badge>
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="PDF speichern">
                <span>
                  <IconButton
                    color="inherit"
                    component="a"
                    href={
                      !invoiceActionsDisabled && editedInvoiceId
                        ? `/api/admin/invoices/${editedInvoiceId}/pdf`
                        : undefined
                    }
                    disabled={invoiceActionsDisabled}
                    aria-label="Rechnungs-PDF speichern"
                  >
                    <FileDownloadOutlined />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="Rechnung per E-Mail versenden">
                <span>
                  <IconButton
                    color="inherit"
                    disabled={invoiceActionsDisabled || !editedInvoiceId}
                    onClick={() => {
                      if (editedInvoiceId)
                        setEmailTarget({
                          type: "invoice",
                          id: editedInvoiceId,
                        });
                    }}
                    aria-label="Rechnung per E-Mail versenden"
                  >
                    <EmailOutlined />
                  </IconButton>
                </span>
              </Tooltip>
              <Divider
                orientation="vertical"
                flexItem
                sx={{ mx: 1.5, my: 1 }}
              />
              <Tooltip title="Archivieren">
                <span>
                  <IconButton
                    color="warning"
                    disabled={invoiceActionsDisabled}
                    onClick={() => void archiveInvoice()}
                    aria-label="Rechnung archivieren"
                  >
                    <ArchiveOutlined />
                  </IconButton>
                </span>
              </Tooltip>
            </>
          )}
        </Toolbar>
      </AppBar>
      {emailTarget && (
        <Suspense fallback={null}>
          <EmailDialog
            target={emailTarget}
            onClose={() => setEmailTarget(null)}
          />
        </Suspense>
      )}
      <Drawer
        variant={isMobile ? "temporary" : "permanent"}
        open={isMobile ? drawerOpen : true}
        onClose={() => setDrawerOpen(false)}
        sx={{
          width: { md: sidebarWidth },
          flexShrink: 0,
          "& .MuiDrawer-paper": {
            width: sidebarWidth,
            boxSizing: "border-box",
            overflowX: "hidden",
            transition: reduceMotion
              ? "none"
              : theme.transitions.create("width"),
          },
          "& .MuiDivider-root": { mx: 2 },
        }}
      >
        <Box
          sx={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            position: "relative",
            "& .MuiListItemButton-root": {
              justifyContent: sidebarCollapsed ? "center" : "flex-start",
              px: sidebarCollapsed ? 0 : undefined,
            },
            "& .MuiListItemIcon-root": {
              minWidth: sidebarCollapsed ? 0 : undefined,
              justifyContent: "center",
            },
          }}
          role="navigation"
          aria-label="Hauptmenü"
        >
          <Box>
            <Box
              sx={{
                px: sidebarCollapsed ? 1 : 2.5,
                height: { xs: 58, md: 68 },
                minHeight: { xs: 58, md: 68 },
                boxSizing: "border-box",
                display: "flex",
                alignItems: "center",
                justifyContent: sidebarCollapsed ? "center" : "space-between",
              }}
            >
              {!sidebarCollapsed && (
                <Box>
                  <Typography
                    variant="h6"
                    color="primary"
                    sx={{
                      fontSize: "1.25rem",
                      fontWeight: 750,
                      letterSpacing: "-0.06em",
                      lineHeight: 1.2,
                    }}
                  >
                    VEGA
                  </Typography>
                </Box>
              )}
              <Tooltip
                title={
                  sidebarCollapsed
                    ? "Seitenleiste ausklappen"
                    : "Seitenleiste einklappen"
                }
                placement="right"
              >
                <IconButton
                  size="small"
                  aria-label={
                    sidebarCollapsed
                      ? "Seitenleiste ausklappen"
                      : "Seitenleiste einklappen"
                  }
                  aria-expanded={!sidebarCollapsed}
                  onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
                >
                  {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
                </IconButton>
              </Tooltip>
            </Box>
            <Divider sx={{ mb: 1 }} />
            <List disablePadding>
              <ListItemButton
                title="Aufträge"
                aria-label="Aufträge"
                selected={pathname === "/"}
                onClick={() => {
                  setDrawerOpen(false);
                  navigate("/");
                }}
              >
                <ListItemIcon>
                  <FormatListNumberedOutlined />
                </ListItemIcon>
                {!sidebarCollapsed && <ListItemText primary="Aufträge" />}
              </ListItemButton>
              {isAdmin && (
                <>
                  <ListItemButton
                    title="Rechnungen"
                    aria-label="Rechnungen"
                    selected={pathname === "/invoices"}
                    onClick={() => {
                      setDrawerOpen(false);
                      navigate("/invoices");
                    }}
                  >
                    <ListItemIcon>
                      <ReceiptLongOutlined />
                    </ListItemIcon>
                    {!sidebarCollapsed && <ListItemText primary="Rechnungen" />}
                  </ListItemButton>
                </>
              )}
              <ListItemButton
                title="Archiv"
                aria-label="Archiv"
                aria-expanded={!sidebarCollapsed && archiveOpen}
                selected={isArchivePath}
                onClick={() => {
                  if (sidebarCollapsed) {
                    setSidebarCollapsed(false);
                    setArchiveOpen(true);
                  } else {
                    setArchiveOpen((open) => !open);
                  }
                }}
              >
                <ListItemIcon>
                  <ArchiveOutlined />
                </ListItemIcon>
                {!sidebarCollapsed && <ListItemText primary="Archiv" />}
                {!sidebarCollapsed &&
                  (archiveOpen ? <ExpandLess /> : <ExpandMore />)}
              </ListItemButton>
              <Collapse
                in={archiveOpen && !sidebarCollapsed}
                timeout="auto"
                unmountOnExit
              >
                <List component="div" disablePadding>
                  <ListItemButton
                    title="Archivierte Aufträge"
                    aria-label="Archivierte Aufträge"
                    sx={{ pl: 4 }}
                    selected={pathname === "/orders/archived"}
                    onClick={() => {
                      setDrawerOpen(false);
                      navigate("/orders/archived");
                    }}
                  >
                    <ListItemIcon>
                      <FormatListNumberedOutlined />
                    </ListItemIcon>
                    {!sidebarCollapsed && (
                      <ListItemText primary="Archivierte Aufträge" />
                    )}
                  </ListItemButton>
                  {isAdmin && (
                    <ListItemButton
                      title="Archivierte Rechnungen"
                      aria-label="Archivierte Rechnungen"
                      sx={{ pl: 4 }}
                      selected={pathname === "/invoices/archived"}
                      onClick={() => {
                        setDrawerOpen(false);
                        navigate("/invoices/archived");
                      }}
                    >
                      <ListItemIcon>
                        <ReceiptLongOutlined />
                      </ListItemIcon>
                      {!sidebarCollapsed && (
                        <ListItemText primary="Archivierte Rechnungen" />
                      )}
                    </ListItemButton>
                  )}
                </List>
              </Collapse>
              {isAdmin && (
                <>
                  <ListItemButton
                    title="Optionen"
                    aria-label="Optionen"
                    selected={route.settingsArea === "options"}
                    onClick={() => {
                      setDrawerOpen(false);
                      navigate("/settings");
                    }}
                  >
                    <ListItemIcon>
                      <SettingsOutlined />
                    </ListItemIcon>
                    {!sidebarCollapsed && <ListItemText primary="Optionen" />}
                  </ListItemButton>
                  <ListItemButton
                    title="Verwaltung"
                    aria-label="Verwaltung"
                    aria-expanded={!sidebarCollapsed && managementOpen}
                    selected={false}
                    onClick={() => {
                      if (sidebarCollapsed) {
                        setSidebarCollapsed(false);
                        setManagementOpen(true);
                      } else {
                        setManagementOpen((open) => !open);
                      }
                    }}
                  >
                    <ListItemIcon>
                      <AdminPanelSettingsOutlined />
                    </ListItemIcon>
                    {!sidebarCollapsed && <ListItemText primary="Verwaltung" />}
                    {!sidebarCollapsed &&
                      (managementOpen ? <ExpandLess /> : <ExpandMore />)}
                  </ListItemButton>
                  <Collapse
                    in={managementOpen && !sidebarCollapsed}
                    timeout="auto"
                    unmountOnExit
                  >
                    <List component="div" disablePadding>
                      <ListItemButton
                        title="Nutzer"
                        aria-label="Nutzer"
                        sx={{ pl: 4 }}
                        selected={route.settingsArea === "users"}
                        onClick={() => {
                          setDrawerOpen(false);
                          navigate("/settings/users");
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <PeopleAltOutlined />
                        </ListItemIcon>
                        {!sidebarCollapsed && <ListItemText primary="Nutzer" />}
                      </ListItemButton>
                      <ListItemButton
                        title="Maintenance"
                        aria-label="Maintenance"
                        sx={{ pl: 4 }}
                        selected={route.path === "/maintenance"}
                        onClick={() => {
                          setDrawerOpen(false);
                          navigate("/maintenance");
                        }}
                      >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <BuildOutlined />
                        </ListItemIcon>
                        {!sidebarCollapsed && (
                          <ListItemText primary="Maintenance" />
                        )}
                      </ListItemButton>
                    </List>
                  </Collapse>
                  <ListItemButton
                    title="Content"
                    aria-label="Content"
                    aria-expanded={!sidebarCollapsed && contentOpen}
                    selected={isContentArea && !route.contentSection}
                    onClick={() => {
                      if (sidebarCollapsed) {
                        setSidebarCollapsed(false);
                        setContentOpen(true);
                      } else {
                        setContentOpen((open) => !open);
                      }
                    }}
                  >
                    <ListItemIcon>
                      <ViewModuleOutlined />
                    </ListItemIcon>
                    {!sidebarCollapsed && <ListItemText primary="Katalog" />}
                    {!sidebarCollapsed &&
                      (contentOpen ? <ExpandLess /> : <ExpandMore />)}
                  </ListItemButton>
                  <Collapse
                    in={contentOpen && !sidebarCollapsed}
                    timeout="auto"
                    unmountOnExit
                  >
                    <List component="div" disablePadding>
                      {[
                        {
                          label: "Angebote",
                          path: "/settings/offers",
                          section: "offers",
                          icon: <LocalOfferOutlined />,
                        },
                        {
                          label: "Preise",
                          path: "/settings/prices",
                          section: "prices",
                          icon: <PaymentsOutlined />,
                        },
                        {
                          label: "Verpackung",
                          path: "/settings/packings",
                          section: "packings",
                          icon: <Inventory2Outlined />,
                        },
                        {
                          label: "Leistungen",
                          path: "/settings/services",
                          section: "services",
                          icon: <HandymanOutlined />,
                        },
                        {
                          label: "Möbel-Kategorien",
                          path: "/settings/categories",
                          section: "categories",
                          icon: <CategoryOutlined />,
                        },
                        {
                          label: "Möbel",
                          path: "/settings/furniture",
                          section: "furniture",
                          icon: <ChairOutlined />,
                        },
                      ].map((item) => (
                        <ListItemButton
                          key={item.path}
                          title={item.label}
                          aria-label={item.label}
                          sx={{ pl: 4 }}
                          selected={route.contentSection === item.section}
                          onClick={() => {
                            setDrawerOpen(false);
                            navigate(item.path);
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 36 }}>
                            {item.icon}
                          </ListItemIcon>
                          {!sidebarCollapsed && (
                            <ListItemText primary={item.label} />
                          )}
                        </ListItemButton>
                      ))}
                    </List>
                  </Collapse>
                </>
              )}
              {!sidebarCollapsed && <Divider sx={{ my: 1 }} />}
              <ListItemButton
                title="Mein Profil"
                aria-label="Mein Profil"
                selected={pathname === "/profile"}
                onClick={() => {
                  setDrawerOpen(false);
                  navigate("/profile");
                }}
              >
                <ListItemIcon>
                  <AccountCircleOutlined />
                </ListItemIcon>
                {!sidebarCollapsed && <ListItemText primary="Mein Profil" />}
              </ListItemButton>
            </List>
          </Box>
          <Box sx={{ mt: "auto" }}>
            <Divider />
            <List>
              <ListItemButton
                title="Abmelden"
                aria-label="Abmelden"
                onClick={signOut}
                disabled={busy}
              >
                <ListItemIcon>
                  <LogoutOutlined />
                </ListItemIcon>
                {!sidebarCollapsed && <ListItemText primary="Abmelden" />}
              </ListItemButton>
            </List>
          </Box>
        </Box>
      </Drawer>
      <Box
        component="main"
        sx={{
          ml: { md: `${sidebarWidth}px` },
          pt: { xs: "58px", md: "68px" },
          minHeight: "100vh",
        }}
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
      </Box>
    </Box>
  );
}
