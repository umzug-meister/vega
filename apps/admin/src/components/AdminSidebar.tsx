import * as React from "react";
import {
  AccountCircleOutlined,
  AdminPanelSettingsOutlined,
  ArchiveOutlined,
  BuildOutlined,
  CategoryOutlined,
  ChairOutlined,
  ChevronLeft,
  ChevronRight,
  ExpandLess,
  ExpandMore,
  FormatListNumberedOutlined,
  HandymanOutlined,
  Inventory2Outlined,
  LocalOfferOutlined,
  LogoutOutlined,
  PaymentsOutlined,
  PeopleAltOutlined,
  ReceiptLongOutlined,
  SettingsOutlined,
  ViewModuleOutlined,
} from "@mui/icons-material";
import {
  Box,
  Collapse,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
  type ListItemButtonProps,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import { useEffect, useState } from "react";
import type { AdminRoute } from "../routes.js";

export const EXPANDED_SIDEBAR_WIDTH = 264;
export const COLLAPSED_SIDEBAR_WIDTH = 72;

interface AdminSidebarProps {
  route: AdminRoute;
  pathname: string;
  isAdmin: boolean;
  busy: boolean;
  drawerOpen: boolean;
  sidebarCollapsed: boolean;
  onDrawerOpenChange: (open: boolean) => void;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  onNavigate: (path: string) => void;
  onSignOut: () => void;
}

const contentItems = [
  {
    label: "Angebote",
    path: "/offers",
    section: "offers",
    icon: LocalOfferOutlined,
  },
  {
    label: "Preise",
    path: "/prices",
    section: "prices",
    icon: PaymentsOutlined,
  },
  {
    label: "Verpackung",
    path: "/packings",
    section: "packings",
    icon: Inventory2Outlined,
  },
  {
    label: "Leistungen",
    path: "/services",
    section: "services",
    icon: HandymanOutlined,
  },
  {
    label: "Möbel-Kategorien",
    path: "/categories",
    section: "categories",
    icon: CategoryOutlined,
  },
  {
    label: "Möbel",
    path: "/furniture",
    section: "furniture",
    icon: ChairOutlined,
  },
] as const;

const listItemButtonSx: ListItemButtonProps["sx"] = {
  my: 0.5,
};
export function AdminSidebar({
  route,
  pathname,
  isAdmin,
  busy,
  drawerOpen,
  sidebarCollapsed,
  onDrawerOpenChange,
  onSidebarCollapsedChange,
  onNavigate,
  onSignOut,
}: AdminSidebarProps) {
  const [contentOpen, setContentOpen] = useState(
    route.settingsArea === "content",
  );
  const [managementOpen, setManagementOpen] = useState(
    route.settingsArea === "users" || route.path === "/maintenance",
  );
  const [archiveOpen, setArchiveOpen] = useState(
    pathname === "/orders/archived" || pathname === "/invoices/archived",
  );
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const sidebarWidth = sidebarCollapsed
    ? COLLAPSED_SIDEBAR_WIDTH
    : EXPANDED_SIDEBAR_WIDTH;
  const isContentArea = route.settingsArea === "content";
  const isManagementArea =
    route.settingsArea === "users" || route.path === "/maintenance";
  const isArchivePath =
    pathname === "/orders/archived" || pathname === "/invoices/archived";

  useEffect(() => {
    if (isContentArea) setContentOpen(true);
  }, [isContentArea]);

  useEffect(() => {
    if (isManagementArea) setManagementOpen(true);
  }, [isManagementArea]);

  useEffect(() => {
    if (isArchivePath) setArchiveOpen(true);
  }, [isArchivePath]);

  function navigate(path: string) {
    onDrawerOpenChange(false);
    onNavigate(path);
  }

  return (
    <Drawer
      variant={isMobile ? "temporary" : "permanent"}
      open={isMobile ? drawerOpen : true}
      onClose={() => onDrawerOpenChange(false)}
      sx={{
        width: { md: sidebarWidth },
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: sidebarWidth,
          boxSizing: "border-box",
          overflowX: "hidden",
          transition: reduceMotion ? "none" : theme.transitions.create("width"),
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
                onClick={() => onSidebarCollapsedChange(!sidebarCollapsed)}
              >
                {sidebarCollapsed ? <ChevronRight /> : <ChevronLeft />}
              </IconButton>
            </Tooltip>
          </Box>
          <Divider sx={{ mb: 1 }} />
          <List disablePadding>
            <ListItemButton
              sx={listItemButtonSx}
              title="Aufträge"
              aria-label="Aufträge"
              selected={pathname === "/"}
              onClick={() => navigate("/")}
            >
              <ListItemIcon>
                <FormatListNumberedOutlined />
              </ListItemIcon>
              {!sidebarCollapsed && <ListItemText primary="Aufträge" />}
            </ListItemButton>
            {isAdmin && (
              <ListItemButton
                sx={listItemButtonSx}
                title="Rechnungen"
                aria-label="Rechnungen"
                selected={pathname === "/invoices"}
                onClick={() => navigate("/invoices")}
              >
                <ListItemIcon>
                  <ReceiptLongOutlined />
                </ListItemIcon>
                {!sidebarCollapsed && <ListItemText primary="Rechnungen" />}
              </ListItemButton>
            )}
            <ListItemButton
              sx={listItemButtonSx}

              title="Archiv"
              aria-label="Archiv"
              aria-expanded={!sidebarCollapsed && archiveOpen}
              selected={false}
              onClick={() => {
                if (sidebarCollapsed) {
                  onSidebarCollapsedChange(false);
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
                  title="Aufträge"
                  aria-label="Aufträge"
                  sx={{ pl: 4, ...listItemButtonSx }}
                  selected={pathname === "/orders/archived"}
                  onClick={() => navigate("/orders/archived")}
                >
                  <ListItemIcon>
                    <FormatListNumberedOutlined />
                  </ListItemIcon>
                  {!sidebarCollapsed && <ListItemText primary="Aufträge" />}
                </ListItemButton>
                {isAdmin && (
                  <ListItemButton
                    title="Rechnungen"
                    aria-label="Rechnungen"
                    sx={{ pl: 4, ...listItemButtonSx }}
                    selected={pathname === "/invoices/archived"}
                    onClick={() => navigate("/invoices/archived")}
                  >
                    <ListItemIcon>
                      <ReceiptLongOutlined />
                    </ListItemIcon>
                    {!sidebarCollapsed && <ListItemText primary="Rechnungen" />}
                  </ListItemButton>
                )}
              </List>
            </Collapse>
            {isAdmin && (
              <>
                <ListItemButton
                  sx={listItemButtonSx}
                  title="Optionen"
                  aria-label="Optionen"
                  selected={route.settingsArea === "options"}
                  onClick={() => navigate("/options")}
                >
                  <ListItemIcon>
                    <SettingsOutlined />
                  </ListItemIcon>
                  {!sidebarCollapsed && <ListItemText primary="Optionen" />}
                </ListItemButton>
                <ListItemButton
                  sx={listItemButtonSx}
                  title="Verwaltung"
                  aria-label="Verwaltung"
                  aria-expanded={!sidebarCollapsed && managementOpen}
                  selected={false}
                  onClick={() => {
                    if (sidebarCollapsed) {
                      onSidebarCollapsedChange(false);
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
                      sx={{ pl: 4, ...listItemButtonSx }}
                      selected={route.settingsArea === "users"}
                      onClick={() => navigate("/users")}
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
                      onClick={() => navigate("/maintenance")}
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
                  sx={{ ...listItemButtonSx }}
                  aria-label="Content"
                  aria-expanded={!sidebarCollapsed && contentOpen}
                  selected={isContentArea && !route.contentSection}
                  onClick={() => {
                    if (sidebarCollapsed) {
                      onSidebarCollapsedChange(false);
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
                    {contentItems.map((item) => (
                      <ListItemButton
                        key={item.path}
                        title={item.label}
                        aria-label={item.label}
                        sx={{ pl: 4, ...listItemButtonSx }}
                        selected={route.contentSection === item.section}
                        onClick={() => navigate(item.path)}
                      >
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <item.icon />
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
              onClick={() => navigate("/profile")}
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
              onClick={onSignOut}
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
  );
}
