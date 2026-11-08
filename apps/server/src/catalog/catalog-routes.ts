import { Router, type Request, type Response, type NextFunction } from "express";
import type { createAuth } from "../auth-config.js";
import type { AppConfig } from "../config.js";
import { requireAdmin, requireCompletedStaff } from "../auth-middleware.js";
import { consumePublicApiRateLimit } from "../public-rate-limit.js";
import {
  validateCategoryInput,
  validateFurnitureInput,
  validateOfferInput,
  validatePackingInput,
  validateServiceInput,
  validateServiceRateInput,
} from "./catalog-input.js";
import * as catalog from "./catalog-service.js";

type AuthInstance = ReturnType<typeof createAuth>;
type AsyncWork = (req: Request) => Promise<unknown>;

function sendError(res: Response, status: number, code: string, message: string, issues?: unknown) {
  res.status(status).json({ error: { code, message, ...(issues !== undefined ? { issues } : {}) } });
}

function sendData(res: Response, data: unknown, status = 200) {
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ data });
}

function route(work: AsyncWork, status = 200) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      sendData(res, await work(req), status);
    } catch (error) {
      const errorCode = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (error instanceof Error && error.message === "INVALID_CATEGORY_REFERENCE") {
        sendError(res, 400, "INVALID_CATEGORY_REFERENCE", "Eine oder mehrere Kategorien sind nicht vorhanden.");
        return;
      }
      if (errorCode === "P2025") {
        sendError(res, 404, "NOT_FOUND", "Katalogeintrag nicht gefunden.");
        return;
      }
      if (errorCode === "P2002") {
        sendError(res, 409, "DUPLICATE_CATALOG_VALUE", "Eintrag mit dieser Kombination existiert bereits.");
        return;
      }
      if (errorCode === "P2003") {
        sendError(res, 409, "CATEGORY_IN_USE", "Die Kategorie wird noch von Möbeln verwendet.");
        return;
      }
      next(error);
    }
  };
}

function positiveId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    sendError(res, 400, "INVALID_ID", "Ungültige Katalog-ID.");
    return null;
  }
  return id;
}

export function createCatalogRouter(auth: AuthInstance, config: AppConfig) {
  const router = Router();
  const publicRouter = Router();
  const adminRouter = Router();

  publicRouter.use(async (req, res, next) => {
    try {
      const allowed = await consumePublicApiRateLimit(
        req.ip ?? req.socket.remoteAddress ?? "unknown",
        config.betterAuthSecret,
        "catalog-get",
        120,
      );
      if (!allowed) {
        res.setHeader("Retry-After", String(60 - Math.floor(Date.now() / 1000) % 60));
        sendError(res, 429, "RATE_LIMITED", "Zu viele Kataloganfragen. Bitte versuchen Sie es später erneut.");
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  });
  publicRouter.get("/categories", route(() => catalog.listCategories()));
  publicRouter.get("/furniture", route(() => catalog.listFurniture()));
  publicRouter.get("/offers", route(() => catalog.listOffers()));
  publicRouter.get("/packings", route(() => catalog.listPackings(true)));
  publicRouter.get("/services", route(() => catalog.listServices(true)));
  publicRouter.get("/service-rates", route(() => catalog.listServiceRates()));

  // Kundenberater dürfen den Katalog lesen (Auftragseditor); Änderungen bleiben Admin-only.
  const requireStaff = requireCompletedStaff(auth);
  const requireAdminOnly = requireAdmin(auth);
  adminRouter.use((req, res, next) =>
    req.method === "GET" || req.method === "HEAD" ? requireStaff(req, res, next) : requireAdminOnly(req, res, next),
  );
  adminRouter.get("/categories", route(() => catalog.listCategories()));
  adminRouter.post("/categories", (req, res, next) => {
    const result = validateCategoryInput(req.body);
    if (!result.ok) return sendError(res, 400, "INVALID_CATALOG_ENTRY", "Bitte prüfen Sie die Kategorie.", result.issues);
    return route(() => catalog.createCategory(result.value), 201)(req, res, next);
  });
  adminRouter.put("/categories/:id", (req, res, next) => {
    const id = positiveId(req, res);
    if (id === null) return;
    const result = validateCategoryInput(req.body);
    if (!result.ok) return sendError(res, 400, "INVALID_CATALOG_ENTRY", "Bitte prüfen Sie die Kategorie.", result.issues);
    return route(() => catalog.updateCategory(id, result.value))(req, res, next);
  });
  adminRouter.delete("/categories/:id", (req, res, next) => {
    const id = positiveId(req, res);
    if (id === null) return;
    return route(async () => { await catalog.deleteCategory(id); return { deleted: true }; })(req, res, next);
  });

  adminRouter.get("/furniture", route(() => catalog.listFurniture()));
  adminRouter.post("/furniture", (req, res, next) => {
    const result = validateFurnitureInput(req.body);
    if (!result.ok) return sendError(res, 400, "INVALID_CATALOG_ENTRY", "Bitte prüfen Sie das Möbelstück.", result.issues);
    return route(() => catalog.createFurniture(result.value), 201)(req, res, next);
  });
  adminRouter.put("/furniture/:id", (req, res, next) => {
    const id = positiveId(req, res);
    if (id === null) return;
    const result = validateFurnitureInput(req.body);
    if (!result.ok) return sendError(res, 400, "INVALID_CATALOG_ENTRY", "Bitte prüfen Sie das Möbelstück.", result.issues);
    return route(() => catalog.updateFurniture(id, result.value))(req, res, next);
  });
  adminRouter.delete("/furniture/:id", (req, res, next) => {
    const id = positiveId(req, res);
    if (id === null) return;
    return route(async () => { await catalog.deleteFurniture(id); return { deleted: true }; })(req, res, next);
  });

  adminRouter.get("/offers", route(() => catalog.listOffers()));
  adminRouter.post("/offers", (req, res, next) => {
    const result = validateOfferInput(req.body);
    if (!result.ok) return sendError(res, 400, "INVALID_CATALOG_ENTRY", "Bitte prüfen Sie das Angebot.", result.issues);
    return route(() => catalog.createOffer(result.value), 201)(req, res, next);
  });
  adminRouter.put("/offers/:id", (req, res, next) => {
    const id = positiveId(req, res);
    if (id === null) return;
    const result = validateOfferInput(req.body);
    if (!result.ok) return sendError(res, 400, "INVALID_CATALOG_ENTRY", "Bitte prüfen Sie das Angebot.", result.issues);
    return route(() => catalog.updateOffer(id, result.value))(req, res, next);
  });
  adminRouter.delete("/offers/:id", (req, res, next) => {
    const id = positiveId(req, res);
    if (id === null) return;
    return route(async () => { await catalog.deleteOffer(id); return { deleted: true }; })(req, res, next);
  });

  adminRouter.get("/packings", route(() => catalog.listPackings()));
  adminRouter.post("/packings", (req, res, next) => {
    const result = validatePackingInput(req.body);
    if (!result.ok) return sendError(res, 400, "INVALID_CATALOG_ENTRY", "Bitte prüfen Sie das Verpackungsmaterial.", result.issues);
    return route(() => catalog.createPacking(result.value), 201)(req, res, next);
  });
  adminRouter.put("/packings/:id", (req, res, next) => {
    const id = positiveId(req, res);
    if (id === null) return;
    const result = validatePackingInput(req.body);
    if (!result.ok) return sendError(res, 400, "INVALID_CATALOG_ENTRY", "Bitte prüfen Sie das Verpackungsmaterial.", result.issues);
    return route(() => catalog.updatePacking(id, result.value))(req, res, next);
  });
  adminRouter.delete("/packings/:id", (req, res, next) => {
    const id = positiveId(req, res);
    if (id === null) return;
    return route(async () => { await catalog.deletePacking(id); return { deleted: true }; })(req, res, next);
  });

  adminRouter.get("/services", route(() => catalog.listServices()));
  adminRouter.post("/services", (req, res, next) => {
    const result = validateServiceInput(req.body);
    if (!result.ok) return sendError(res, 400, "INVALID_CATALOG_ENTRY", "Bitte prüfen Sie die Leistung.", result.issues);
    return route(() => catalog.createService(result.value), 201)(req, res, next);
  });
  adminRouter.put("/services/:id", (req, res, next) => {
    const id = positiveId(req, res);
    if (id === null) return;
    const result = validateServiceInput(req.body);
    if (!result.ok) return sendError(res, 400, "INVALID_CATALOG_ENTRY", "Bitte prüfen Sie die Leistung.", result.issues);
    return route(() => catalog.updateService(id, result.value))(req, res, next);
  });
  adminRouter.delete("/services/:id", (req, res, next) => {
    const id = positiveId(req, res);
    if (id === null) return;
    return route(async () => { await catalog.deleteService(id); return { deleted: true }; })(req, res, next);
  });

  adminRouter.get("/service-rates", route(() => catalog.listServiceRates()));
  adminRouter.put("/service-rates/:key", (req, res, next) => {
    const key = req.params.key ?? "";
    const result = validateServiceRateInput(key, req.body);
    if (!result.ok) return sendError(res, 400, "INVALID_CATALOG_ENTRY", "Bitte prüfen Sie den Preisparameter.", result.issues);
    return route(() => catalog.updateServiceRate(result.value.key, result.value.price))(req, res, next);
  });

  router.use("/api/catalog", publicRouter);
  router.use("/api/admin/catalog", adminRouter);
  return router;
}
