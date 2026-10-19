export interface AdminRoute {
  path: string;
  title: string;
  parentTitle?: string;
  adminOnly?: boolean;
  profile?: boolean;
  sourceOrderNumber?: number;
  settingsArea?: "options" | "content" | "users";
  contentSection?:
    "furniture" | "categories" | "offers" | "packings" | "services" | "prices";
}

const fixedAdminRoutes: Record<string, AdminRoute> = {
  "/": { path: "/", title: "Aufträge" },
  "/invoices": {
    path: "/invoices",
    title: "Rechnungen",
    adminOnly: true,
  },
  "/invoices/new": {
    path: "/invoices/new",
    title: "Neue Rechnung",
    adminOnly: true,
  },
  "/invoices/archived": {
    path: "/invoices/archived",
    title: "Rechnungen",
    adminOnly: true,
    parentTitle: "Archiv",
  },
  "/orders/archived": {
    path: "/orders/archived",
    title: "Aufträge",
    parentTitle: "Archiv",
  },
  "/profile": {
    path: "/profile",
    title: "Mein Profil",
    profile: true,
  },
  "/options": {
    path: "/options",
    title: "Optionen",
    adminOnly: true,
    settingsArea: "options",
  },
  "/maintenance": {
    path: "/maintenance",
    title: "Maintenance",
    adminOnly: true,
    parentTitle: "Verwaltung",
  },
  "/users": {
    path: "/users",
    title: "Nutzer",
    adminOnly: true,
    settingsArea: "users",
    parentTitle: "Verwaltung",
  },
  "/offers": {
    path: "/offers",
    title: "Angebote",
    adminOnly: true,
    settingsArea: "content",
    contentSection: "offers",
    parentTitle: "Katalog",
  },
  "/packings": {
    path: "/packings",
    title: "Verpackung",
    adminOnly: true,
    settingsArea: "content",
    contentSection: "packings",
    parentTitle: "Katalog",
  },
  "/services": {
    path: "/services",
    title: "Leistungen",
    adminOnly: true,
    settingsArea: "content",
    contentSection: "services",
    parentTitle: "Katalog",
  },
  "/prices": {
    path: "/prices",
    title: "Preise",
    adminOnly: true,
    settingsArea: "content",
    contentSection: "prices",
    parentTitle: "Katalog",
  },
  "/furniture": {
    path: "/furniture",
    title: "Möbel",
    adminOnly: true,
    settingsArea: "content",
    contentSection: "furniture",
    parentTitle: "Katalog",
  },
  "/categories": {
    path: "/categories",
    title: "Möbel-Kategorien",
    adminOnly: true,
    settingsArea: "content",
    contentSection: "categories",
    parentTitle: "Katalog",
  },
};

export function formatAdminRouteTitle(route: AdminRoute): string {
  return route.parentTitle
    ? `${route.parentTitle} | ${route.title}`
    : route.title;
}

export function resolveAdminRoute(pathname: string): AdminRoute | null {
  const fixed = fixedAdminRoutes[pathname];
  if (fixed) return fixed;

  const invoiceDraft = pathname.match(
    /^\/invoices\/new\/from-order\/([1-9]\d*)$/u,
  );
  if (invoiceDraft) {
    const orderNumber = Number(invoiceDraft[1]);
    if (!Number.isSafeInteger(orderNumber)) return null;
    return {
      path: pathname,
      title: "Neue Rechnung",
      adminOnly: true,
      sourceOrderNumber: orderNumber,
    };
  }

  const editMatch = pathname.match(/^\/edit\/([^/]+)$/u);
  if (editMatch) {
    const id = decodePathSegment(editMatch[1]);
    if (id === null) return null;
    return {
      path: pathname,
      title: id === "-1" ? "Neuer Auftrag" : `Auftrag ${id}`,
    };
  }

  const invoiceMatch = pathname.match(/^\/invoices\/([^/]+)$/u);
  if (invoiceMatch) {
    const id = decodePathSegment(invoiceMatch[1]);
    if (id === null || id === "new" || id === "archived") return null;
    return {
      path: pathname,
      title: "Rechnung",
      adminOnly: true,
    };
  }

  return null;
}

function decodePathSegment(segment: string | undefined): string | null {
  if (segment === undefined) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
