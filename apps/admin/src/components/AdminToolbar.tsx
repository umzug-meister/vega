import * as React from "react";
import { useEffect, useState } from "react";
import {
  ArchiveOutlined,
  CloseOutlined,
  ContentCopyOutlined,
  EmailOutlined,
  FileDownloadOutlined,
  MenuOutlined,
  MoreVert,
  ReceiptLongOutlined,
  SaveOutlined,
} from "@mui/icons-material";
import {
  AppBar,
  Badge,
  Divider,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";

interface AdminToolbarProps {
  title: string;
  pathname: string;
  sidebarWidth: number;
  isOrderEditor: boolean;
  editedOrderNumber?: string | undefined;
  orderBusy: boolean;
  actionBusy: boolean;
  orderActionsDisabled: boolean;
  orderHasChanges: boolean;
  orderIsCopy: boolean;
  orderHasSourceMail: boolean;
  isAdmin: boolean;
  isInvoiceEditor: boolean;
  editedInvoiceId?: string | undefined;
  invoiceBusy: boolean;
  invoiceAccountingDirty: boolean;
  invoiceActionsDisabled: boolean;
  invoiceHasChanges: boolean;
  onOpenDrawer: () => void;
  onCopyOrder: () => void;
  onArchiveOrder: () => void;
  onOrderEmail: (
    kind: "offer" | "offer-pair" | "decline",
    replyToSourceMail?: boolean,
  ) => void;
  onInvoiceEmail: () => void;
  onArchiveInvoice: () => void;
}

export function AdminToolbar({
  title,
  pathname,
  sidebarWidth,
  isOrderEditor,
  editedOrderNumber,
  orderBusy,
  actionBusy,
  orderActionsDisabled,
  orderHasChanges,
  orderIsCopy,
  orderHasSourceMail,
  isAdmin,
  isInvoiceEditor,
  editedInvoiceId,
  invoiceBusy,
  invoiceAccountingDirty,
  invoiceActionsDisabled,
  invoiceHasChanges,
  onOpenDrawer,
  onCopyOrder,
  onArchiveOrder,
  onOrderEmail,
  onInvoiceEmail,
  onArchiveInvoice,
}: AdminToolbarProps) {
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("md"));
  const [actionsMenuAnchor, setActionsMenuAnchor] = useState<HTMLElement | null>(
    null,
  );
  const [emailMenuAnchor, setEmailMenuAnchor] = useState<HTMLElement | null>(
    null,
  );

  useEffect(() => {
    setActionsMenuAnchor(null);
    setEmailMenuAnchor(null);
  }, [isSmallScreen, pathname]);

  function closeActionsMenu() {
    setActionsMenuAnchor(null);
  }

  function selectOrderEmail(
    kind: "offer" | "offer-pair" | "decline",
    replyToSourceMail = false,
  ) {
    setActionsMenuAnchor(null);
    setEmailMenuAnchor(null);
    onOrderEmail(kind, replyToSourceMail);
  }

  return (
    <AppBar
      position="fixed"
      color="inherit"
      elevation={0}
      sx={{
        width: { md: `calc(100% - ${sidebarWidth}px)` },
        ml: { md: `${sidebarWidth}px` },
      }}
    >
      <Toolbar sx={{ minHeight: { xs: 58, md: 68 }, px: { xs: 1.5, sm: 2.5 } }}>
        <IconButton
          color="inherit"
          onClick={onOpenDrawer}
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
          {title}
        </Typography>
        {isOrderEditor && (
          <>
            {!isSmallScreen ? (
              <>
                <Tooltip title="Speichern">
                  <span>
                    <IconButton
                      color="inherit"
                      type="submit"
                      form="order-create-form"
                      disabled={actionBusy || orderBusy}
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
                          onClick={onCopyOrder}
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
                      <MenuItem onClick={() => selectOrderEmail("offer")}>
                        Angebot versenden
                      </MenuItem>
                      {orderHasSourceMail && (
                        <MenuItem
                          onClick={() => selectOrderEmail("offer", true)}
                        >
                          Als Antwort auf Mail senden
                        </MenuItem>
                      )}
                      {orderIsCopy && (
                        <MenuItem
                          onClick={() => selectOrderEmail("offer-pair")}
                        >
                          2 Angebote versenden
                        </MenuItem>
                      )}
                      <MenuItem onClick={() => selectOrderEmail("decline")}>
                        <ListItemIcon>
                          <CloseOutlined fontSize="small" />
                        </ListItemIcon>
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
                          onClick={onArchiveOrder}
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
                        <Tooltip title="Rechnung zum Auftrag">
                          <span>
                            <IconButton
                              color="inherit"
                              type="submit"
                              form="order-create-form"
                              name="action"
                              value="invoice"
                              disabled={orderActionsDisabled}
                              aria-label="Rechnung zum Auftrag"
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
            ) : (
              <>
                <IconButton
                  color="inherit"
                  onClick={(event) => setActionsMenuAnchor(event.currentTarget)}
                  aria-label="Weitere Aktionen öffnen"
                  aria-haspopup="menu"
                  aria-expanded={actionsMenuAnchor !== null}
                >
                  <MoreVert />
                </IconButton>
                <Menu
                  anchorEl={actionsMenuAnchor}
                  open={actionsMenuAnchor !== null}
                  onClose={closeActionsMenu}
                >
                  <MenuItem
                    component="button"
                    type="submit"
                    form="order-create-form"
                    disabled={actionBusy || orderBusy}
                    onClick={closeActionsMenu}
                  >
                    <ListItemIcon>
                      <Badge
                        color="error"
                        variant="dot"
                        invisible={!orderHasChanges}
                      >
                        <SaveOutlined fontSize="small" />
                      </Badge>
                    </ListItemIcon>
                    Speichern
                  </MenuItem>
                  {editedOrderNumber && (
                    <>
                      <Divider />
                      <MenuItem
                        disabled={orderActionsDisabled}
                        onClick={() => {
                          closeActionsMenu();
                          onCopyOrder();
                        }}
                      >
                        <ListItemIcon>
                          <ContentCopyOutlined fontSize="small" />
                        </ListItemIcon>
                        Angebotskopie anlegen
                      </MenuItem>
                      <MenuItem
                        component="button"
                        type="submit"
                        form="order-create-form"
                        name="action"
                        value="pdf"
                        disabled={orderActionsDisabled}
                        onClick={closeActionsMenu}
                      >
                        <ListItemIcon>
                          <FileDownloadOutlined fontSize="small" />
                        </ListItemIcon>
                        PDF speichern
                      </MenuItem>
                      <Divider />
                      <MenuItem
                        disabled={orderActionsDisabled}
                        onClick={() => selectOrderEmail("offer")}
                      >
                        <ListItemIcon>
                          <EmailOutlined fontSize="small" />
                        </ListItemIcon>
                        Angebot versenden
                      </MenuItem>
                      {orderHasSourceMail && (
                        <MenuItem
                          disabled={orderActionsDisabled}
                          onClick={() => selectOrderEmail("offer", true)}
                        >
                          Als Antwort auf Mail senden
                        </MenuItem>
                      )}
                      {orderIsCopy && (
                        <MenuItem
                          disabled={orderActionsDisabled}
                          onClick={() => selectOrderEmail("offer-pair")}
                        >
                          2 Angebote versenden
                        </MenuItem>
                      )}
                      <MenuItem
                        disabled={orderActionsDisabled}
                        onClick={() => selectOrderEmail("decline")}
                      >
                        <ListItemIcon>
                          <CloseOutlined fontSize="small" />
                        </ListItemIcon>
                        Absage versenden
                      </MenuItem>
                      <Divider />
                      <MenuItem
                        disabled={orderActionsDisabled}
                        onClick={() => {
                          closeActionsMenu();
                          onArchiveOrder();
                        }}
                      >
                        <ListItemIcon>
                          <ArchiveOutlined fontSize="small" />
                        </ListItemIcon>
                        Archivieren
                      </MenuItem>
                      {isAdmin && (
                        <MenuItem
                          component="button"
                          type="submit"
                          form="order-create-form"
                          name="action"
                          value="invoice"
                          disabled={orderActionsDisabled}
                          onClick={closeActionsMenu}
                        >
                          <ListItemIcon>
                            <ReceiptLongOutlined fontSize="small" />
                          </ListItemIcon>
                          Rechnung zum Auftrag
                        </MenuItem>
                      )}
                    </>
                  )}
                </Menu>
              </>
            )}
          </>
        )}
        {isInvoiceEditor && (
          <>
            {!isSmallScreen ? (
              <>
                <Tooltip title="Speichern">
                  <span>
                    <IconButton
                      color="inherit"
                      type="submit"
                      form="invoice-editor-form"
                      disabled={
                        actionBusy ||
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
                      onClick={onInvoiceEmail}
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
                      onClick={onArchiveInvoice}
                      aria-label="Rechnung archivieren"
                    >
                      <ArchiveOutlined />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            ) : (
              <>
                <IconButton
                  color="inherit"
                  onClick={(event) => setActionsMenuAnchor(event.currentTarget)}
                  aria-label="Weitere Aktionen öffnen"
                  aria-haspopup="menu"
                  aria-expanded={actionsMenuAnchor !== null}
                >
                  <MoreVert />
                </IconButton>
                <Menu
                  anchorEl={actionsMenuAnchor}
                  open={actionsMenuAnchor !== null}
                  onClose={closeActionsMenu}
                >
                  <MenuItem
                    component="button"
                    type="submit"
                    form="invoice-editor-form"
                    disabled={
                      actionBusy ||
                      invoiceBusy ||
                      (invoiceAccountingDirty && !invoiceHasChanges)
                    }
                    onClick={closeActionsMenu}
                  >
                    <ListItemIcon>
                      <Badge
                        color="error"
                        variant="dot"
                        invisible={!invoiceHasChanges}
                      >
                        <SaveOutlined fontSize="small" />
                      </Badge>
                    </ListItemIcon>
                    Speichern
                  </MenuItem>
                  <MenuItem
                    component="a"
                    href={
                      !invoiceActionsDisabled && editedInvoiceId
                        ? `/api/admin/invoices/${editedInvoiceId}/pdf`
                        : undefined
                    }
                    disabled={invoiceActionsDisabled || !editedInvoiceId}
                    onClick={closeActionsMenu}
                  >
                    <ListItemIcon>
                      <FileDownloadOutlined fontSize="small" />
                    </ListItemIcon>
                    PDF speichern
                  </MenuItem>
                  <MenuItem
                    disabled={invoiceActionsDisabled || !editedInvoiceId}
                    onClick={() => {
                      closeActionsMenu();
                      onInvoiceEmail();
                    }}
                  >
                    <ListItemIcon>
                      <EmailOutlined fontSize="small" />
                    </ListItemIcon>
                    Rechnung per E-Mail versenden
                  </MenuItem>
                  <Divider />
                  <MenuItem
                    disabled={invoiceActionsDisabled}
                    onClick={() => {
                      closeActionsMenu();
                      onArchiveInvoice();
                    }}
                  >
                    <ListItemIcon>
                      <ArchiveOutlined fontSize="small" />
                    </ListItemIcon>
                    Archivieren
                  </MenuItem>
                </Menu>
              </>
            )}
          </>
        )}
      </Toolbar>
    </AppBar>
  );
}
