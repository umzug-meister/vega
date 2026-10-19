import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert, CircularProgress, Container } from "@mui/material";
import { authClient } from "./auth-client.js";
import { AuthCard } from "./auth/AuthCard.js";
import { InitialPasswordChangePage } from "./auth/InitialPasswordChangePage.js";
import { SignInPage } from "./auth/SignInPage.js";
import { ForgotPasswordPage } from "./auth/ForgotPasswordPage.js";
import { ResetPasswordPage } from "./auth/ResetPasswordPage.js";
import { TotpSetupPage } from "./auth/TotpSetupPage.js";
import { AdminShell } from "./components/AdminShell.js";
import { NotFoundPage } from "./components/NotFoundPage.js";
import { resolveAdminRoute } from "./routes.js";
import type { PendingInitialPassword, StaffUser } from "./types.js";
import { isTotpRequired, needsTotpSetup } from "@vega/domain";
import { useLocalNavigation } from "./use-local-navigation.js";

const ProfilePage = lazy(() =>
  import("./profile/ProfilePage.js").then((module) => ({
    default: module.ProfilePage,
  })),
);
const OptionsPage = lazy(() =>
  import("./settings/OptionsPage.js").then((module) => ({
    default: module.OptionsPage,
  })),
);
const MaintenancePage = lazy(() =>
  import("./maintenance/MaintenancePage.js").then((module) => ({
    default: module.MaintenancePage,
  })),
);
const UserManagementPage = lazy(() =>
  import("./settings/UserManagementPage.js").then((module) => ({
    default: module.UserManagementPage,
  })),
);
const OrdersPage = lazy(() =>
  import("./orders/OrdersPage.js").then((module) => ({
    default: module.OrdersPage,
  })),
);
const InvoicesPage = lazy(() =>
  import("./invoices/InvoicesPage.js").then((module) => ({
    default: module.InvoicesPage,
  })),
);
const InvoiceEditorPage = lazy(() =>
  import("./invoices/InvoiceEditorPage.js").then((module) => ({
    default: module.InvoiceEditorPage,
  })),
);
const OrderCreatePage = lazy(() =>
  import("./orders/OrderCreatePage.js").then((module) => ({
    default: module.OrderCreatePage,
  })),
);
const ContentManagementPage = lazy(() =>
  import("./settings/ContentManagementPage.js").then((module) => ({
    default: module.ContentManagementPage,
  })),
);

export function App() {
  const { data: session, isPending } = authClient.useSession();
  const dirty = useRef({ order: false, invoice: false });
  const hasUnsavedChanges = useCallback(
    () => dirty.current.order || dirty.current.invoice,
    [],
  );
  const [initialPassword, setInitialPassword] =
    useState<PendingInitialPassword | null>(null);
  const [orderDirty, setOrderDirty] = useState(false);
  const [orderBusy, setOrderBusy] = useState(true);
  const [orderIsCopy, setOrderIsCopy] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState(true);
  const [invoiceDirty, setInvoiceDirty] = useState(false);
  const [accountingDirty, setAccountingDirty] = useState(false);
  const onOrderDirtyChange = useCallback((value: boolean) => {
    dirty.current.order = value;
    setOrderDirty(value);
  }, []);
  const onInvoiceUnsavedChange = useCallback((value: boolean) => {
    dirty.current.invoice = value;
  }, []);
  const clearDocumentState = useCallback(() => {
    onOrderDirtyChange(false);
    onInvoiceUnsavedChange(false);
    setInvoiceDirty(false);
    setAccountingDirty(false);
    setOrderIsCopy(false);
  }, [onInvoiceUnsavedChange, onOrderDirtyChange]);
  const { pathname, replacePath, navigatePath, confirmLeave } =
    useLocalNavigation(hasUnsavedChanges, clearDocumentState);
  const [invoiceNumber, setInvoiceNumber] = useState<string>();
  const [totpPassword, setTotpPassword] = useState<string | undefined>();
  const [voluntaryTotpSetup, setVoluntaryTotpSetup] = useState(false);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const route = resolveAdminRoute(pathname);
  const isAuthPath = pathname === "/login" || pathname === "/two-factor";
  const isPasswordResetPath =
    pathname === "/forgot-password" || pathname === "/reset-password";
  const isKnownPath = route !== null || isAuthPath || isPasswordResetPath;

  useEffect(() => {
    setInvoiceNumber(undefined);
  }, [pathname]);

  const onTwoFactorRequired = useCallback(() => {
    setTwoFactorRequired(true);
    replacePath("/two-factor");
  }, [replacePath]);

  const onCancelTwoFactor = useCallback(() => {
    setTwoFactorRequired(false);
    replacePath("/login");
  }, [replacePath]);

  useEffect(() => {
    if (isPending || !isKnownPath) return;
    if (!session && route) replacePath("/login");
    if (!session && pathname === "/two-factor" && !twoFactorRequired)
      replacePath("/login");
    if (session && isAuthPath) replacePath("/");
    if (session && route && pathname !== route.path) replacePath(route.path);
  }, [
    isAuthPath,
    isKnownPath,
    isPending,
    pathname,
    replacePath,
    route,
    session,
    twoFactorRequired,
  ]);

  if (!isKnownPath) return <NotFoundPage onHome={() => replacePath("/")} />;

  if (
    isPending ||
    (!session && route !== null) ||
    (session && isAuthPath) ||
    (!session && pathname === "/two-factor" && !twoFactorRequired)
  ) {
    return (
      <Container sx={{ py: 10, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Container>
    );
  }

  if (initialPassword) {
    return (
      <InitialPasswordChangePage
        currentPassword={initialPassword.currentPassword}
        onChanged={(password) => {
          setInitialPassword(null);
          if (initialPassword.totpRequired) setTotpPassword(password);
          else window.location.reload();
        }}
      />
    );
  }

  if (totpPassword !== undefined) {
    return (
      <TotpSetupPage
        initialPassword={totpPassword}
        onComplete={() => window.location.reload()}
      />
    );
  }

  if (pathname === "/forgot-password")
    return <ForgotPasswordPage onBack={() => replacePath("/login")} />;
  if (pathname === "/reset-password")
    return <ResetPasswordPage onComplete={() => replacePath("/login")} />;

  if (!session) {
    return (
      <SignInPage
        onInitialPassword={setInitialPassword}
        onTotpSetup={setTotpPassword}
        twoFactorRequired={twoFactorRequired}
        onTwoFactorRequired={onTwoFactorRequired}
        onCancelTwoFactor={onCancelTwoFactor}
        onForgotPassword={() => replacePath("/forgot-password")}
      />
    );
  }

  const user = session.user;
  if (user.blocked) {
    return (
      <AuthCard>
        <Alert severity="error">Dieses Konto ist gesperrt.</Alert>
      </AuthCard>
    );
  }
  if (user.mustChangePassword) {
    return (
      <InitialPasswordChangePage
        onChanged={(password) =>
          isTotpRequired(user.role)
            ? setTotpPassword(password)
            : window.location.reload()
        }
      />
    );
  }
  if (needsTotpSetup(user)) {
    return <TotpSetupPage onComplete={() => window.location.reload()} />;
  }
  if (voluntaryTotpSetup) {
    return (
      <TotpSetupPage
        optional
        onCancel={() => setVoluntaryTotpSetup(false)}
        onComplete={() => window.location.reload()}
      />
    );
  }
  if (user.role !== "Admin" && user.role !== "Kundenberater") {
    return (
      <AuthCard>
        <Alert severity="error">
          Dieses Konto ist für die Vega-Verwaltung nicht freigeschaltet.
        </Alert>
      </AuthCard>
    );
  }
  const staffUser: StaffUser = {
    ...user,
    twoFactorEnabled: user.twoFactorEnabled === true,
  };
  if (!route) return <NotFoundPage onHome={() => replacePath("/")} />;
  const activeRoute = route;

  const invoiceEditorProps = {
    navigate: navigatePath,
    onBusyChange: setInvoiceBusy,
    onDirtyChange: onInvoiceUnsavedChange,
    onInvoiceDirtyChange: setInvoiceDirty,
    onAccountingDirtyChange: setAccountingDirty,
    onInvoiceNumberChange: setInvoiceNumber,
  };
  function renderPage(): ReactNode {
    if (activeRoute.adminOnly && user.role !== "Admin") {
      return (
        <Alert severity="error">
          Diese Route ist nur für Admins freigeschaltet.
        </Alert>
      );
    }

    if (activeRoute.profile) {
      return (
        <ProfilePage
          user={staffUser}
          onSetupTotp={() => setVoluntaryTotpSetup(true)}
        />
      );
    }

    if (activeRoute.path === "/") return <OrdersPage navigate={navigatePath} />;
    if (activeRoute.path === "/orders/archived") {
      return <OrdersPage archived navigate={navigatePath} />;
    }
    if (activeRoute.path === "/invoices") {
      return <InvoicesPage navigate={navigatePath} />;
    }
    if (activeRoute.path === "/invoices/archived") {
      return <InvoicesPage archived navigate={navigatePath} />;
    }

    if (activeRoute.sourceOrderNumber !== undefined) {
      return (
        <InvoiceEditorPage
          key={activeRoute.path}
          {...invoiceEditorProps}
          orderNumber={activeRoute.sourceOrderNumber}
        />
      );
    }
    if (activeRoute.path === "/invoices/new") {
      return (
        <InvoiceEditorPage key={activeRoute.path} {...invoiceEditorProps} />
      );
    }
    if (activeRoute.path.startsWith("/invoices/")) {
      return (
        <InvoiceEditorPage
          key={activeRoute.path}
          {...invoiceEditorProps}
          id={activeRoute.path.slice("/invoices/".length)}
        />
      );
    }
    if (activeRoute.path.startsWith("/edit/")) {
      return (
        <OrderCreatePage
          key={activeRoute.path}
          navigate={navigatePath}
          onDirtyChange={onOrderDirtyChange}
          onBusyChange={setOrderBusy}
          onCopyChange={setOrderIsCopy}
          dirty={orderDirty}
          {...(activeRoute.path === "/edit/-1"
            ? {}
            : { orderNumber: Number(activeRoute.path.slice("/edit/".length)) })}
        />
      );
    }

    if (activeRoute.settingsArea === "options") return <OptionsPage />;
    if (activeRoute.path === "/maintenance") return <MaintenancePage />;
    if (activeRoute.settingsArea === "content") {
      return <ContentManagementPage route={activeRoute} />;
    }
    if (activeRoute.settingsArea === "users") {
      return <UserManagementPage currentUserId={user.id} />;
    }

    return <NotFoundPage onHome={() => replacePath("/")} />;
  }

  const page = renderPage();

  return (
    <AdminShell
      user={staffUser}
      route={route}
      pathname={pathname}
      navigate={navigatePath}
      confirmLeave={confirmLeave}
      orderDirty={orderDirty || pathname === "/edit/-1"}
      orderBusy={orderBusy}
      orderIsCopy={orderIsCopy}
      invoiceBusy={invoiceBusy}
      invoiceDirty={
        invoiceDirty ||
        pathname === "/invoices/new" ||
        route.sourceOrderNumber !== undefined
      }
      invoiceAccountingDirty={accountingDirty}
      invoiceNumber={invoiceNumber}
    >
      <Suspense
        fallback={
          <Container sx={{ py: 8, display: "flex", justifyContent: "center" }}>
            <CircularProgress />
          </Container>
        }
      >
        {page}
      </Suspense>
    </AdminShell>
  );
}
