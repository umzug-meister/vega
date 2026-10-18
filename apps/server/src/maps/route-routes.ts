import { Router } from "express";
import type { AppConfig } from "../config.js";
import { getAppSettings } from "../settings/settings-service.js";
import { consumePublicApiRateLimit } from "../public-rate-limit.js";
import {
  clientAbortSignal,
  isClientAbort,
  ProviderUnreachableError,
  providerFetch,
} from "./provider-request.js";

export function routeAddresses(body: unknown): string[] | null {
  if (
    typeof body !== "object" ||
    body === null ||
    !("addresses" in body) ||
    !Array.isArray(body.addresses) ||
    body.addresses.length < 2 ||
    body.addresses.length > 4 ||
    body.addresses.some(
      (address) =>
        typeof address !== "string" || !address.trim() || address.length > 400,
    )
  )
    return null;
  return body.addresses.map((address: string) => address.trim());
}

export function routeDistanceKm(distanceMeters: unknown): number | null {
  if (
    typeof distanceMeters !== "number" ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters < 0 ||
    distanceMeters > 10_000_000
  )
    return null;
  return Math.round(distanceMeters / 1000);
}

export function routeDurationMinutes(duration: unknown): number | null {
  if (typeof duration !== "string") return null;
  const match = /^(\d+)s$/.exec(duration);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 10_000_000)
    return null;
  return Math.round(seconds / 60);
}

export interface RouteLeg {
  distanceKm: number;
  durationMinutes: number;
}

export function routeLegs(
  legs: unknown,
  expectedCount: number,
): RouteLeg[] | null {
  if (!Array.isArray(legs) || legs.length !== expectedCount) return null;
  const projected: RouteLeg[] = [];
  for (const leg of legs) {
    if (typeof leg !== "object" || leg === null) return null;
    const record = leg as { distanceMeters?: unknown; duration?: unknown };
    const distanceKm = routeDistanceKm(record.distanceMeters);
    const durationMinutes = routeDurationMinutes(record.duration);
    if (distanceKm === null || durationMinutes === null) return null;
    projected.push({ distanceKm, durationMinutes });
  }
  return projected;
}

function addressKey(address: string): string {
  return address.trim().replace(/\s+/gu, " ").toLocaleLowerCase("de-DE");
}

function collapseAdjacentStops(stops: string[]): string[] {
  return stops.filter(
    (stop, index) =>
      index === 0 || addressKey(stop) !== addressKey(stops[index - 1]!),
  );
}

function restoreDuplicateStopLegs(
  stops: string[],
  calculatedLegs: RouteLeg[],
): RouteLeg[] | null {
  const expanded: RouteLeg[] = [];
  let calculatedIndex = 0;
  for (let index = 1; index < stops.length; index++) {
    if (addressKey(stops[index - 1]!) === addressKey(stops[index]!)) {
      expanded.push({ distanceKm: 0, durationMinutes: 0 });
      continue;
    }
    const leg = calculatedLegs[calculatedIndex++];
    if (!leg) return null;
    expanded.push(leg);
  }
  return calculatedIndex === calculatedLegs.length ? expanded : null;
}

export function createRouteRouter(config: AppConfig) {
  const router = Router();
  router.get("/config", async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({
        data: {
          origin: (await getAppSettings()).origin,
          available: Boolean(config.googleMapsKey),
        },
      });
    } catch (error) {
      next(error);
    }
  });
  router.post("/distance", async (req, res, next) => {
    try {
      const settings = await getAppSettings();
      if (!settings.origin || !config.googleMapsKey) {
        res
          .status(503)
          .json({
            error: {
              code: "ROUTES_UNAVAILABLE",
              message:
                "Für die Routenberechnung müssen Standort und Google-Routes-Zugang eingerichtet sein.",
            },
          });
        return;
      }
      const addresses = routeAddresses(req.body);
      if (!addresses)
        return res
          .status(400)
          .json({
            error: {
              code: "INVALID_ROUTE",
              message:
                "Bitte geben Sie zwei bis vier vollständige Be-/Entladeadressen ein.",
            },
          });
      if (
        !(await consumePublicApiRateLimit(
          String(res.locals.staffUser.id),
          config.betterAuthSecret,
          "admin-route",
          30,
        ))
      ) {
        res.setHeader("Retry-After", "60");
        return res
          .status(429)
          .json({
            error: {
              code: "RATE_LIMITED",
              message:
                "Zu viele Routenberechnungen. Bitte warten Sie eine Minute.",
            },
          });
      }
      const stops = [settings.origin, ...addresses, settings.origin];
      const uniqueStops = collapseAdjacentStops(stops);
      if (uniqueStops.length === 1) {
        const zeroLegs = Array.from({ length: stops.length - 1 }, () => ({
          distanceKm: 0,
          durationMinutes: 0,
        }));
        res.setHeader("Cache-Control", "no-store");
        return res.json({
          data: { distanceKm: 0, durationMinutes: 0, legs: zeroLegs },
        });
      }
      const response = await providerFetch(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": config.googleMapsKey,
            "X-Goog-FieldMask":
              "routes.distanceMeters,routes.duration,routes.legs.distanceMeters,routes.legs.duration",
          },
          body: JSON.stringify({
            origin: { address: uniqueStops[0] },
            destination: { address: uniqueStops.at(-1) },
            ...(uniqueStops.length > 2
              ? {
                  intermediates: uniqueStops
                    .slice(1, -1)
                    .map((address) => ({ address })),
                }
              : {}),
            travelMode: "DRIVE",
            languageCode: "de-DE",
          }),
        },
        clientAbortSignal(res),
      );
      if (!response.ok) {
        req.log.warn(
          { code: "ROUTES_PROVIDER_FAILED", status: response.status },
          "route calculation failed",
        );
        return res
          .status(502)
          .json({
            error: {
              code: "ROUTES_PROVIDER_FAILED",
              message: "Google konnte die Fahrstrecke nicht berechnen.",
            },
          });
      }
      const result = (await response.json()) as {
        routes?: Array<{
          distanceMeters?: unknown;
          duration?: unknown;
          legs?: unknown;
        }>;
      };
      const route = result.routes?.[0];
      const distanceKm = routeDistanceKm(route?.distanceMeters);
      const durationMinutes = routeDurationMinutes(route?.duration);
      // Legs drive the per-stop display (origin → stops → origin), so a route
      // without exactly one leg per segment is not usable for the UI.
      const calculatedLegs = routeLegs(route?.legs, uniqueStops.length - 1);
      const legs = calculatedLegs
        ? restoreDuplicateStopLegs(stops, calculatedLegs)
        : null;
      if (distanceKm === null || durationMinutes === null || legs === null) {
        return res
          .status(502)
          .json({
            error: {
              code: "INVALID_ROUTE_RESPONSE",
              message: "Google hat keine verwendbare Fahrstrecke geliefert.",
            },
          });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.json({ data: { distanceKm, durationMinutes, legs } });
    } catch (error) {
      if (isClientAbort(error)) return;
      if (error instanceof ProviderUnreachableError) {
        req.log.warn(
          { code: "ROUTES_NETWORK_FAILED" },
          "route provider unavailable",
        );
        res
          .status(502)
          .json({
            error: {
              code: "ROUTES_NETWORK_FAILED",
              message: "Der Kartendienst ist derzeit nicht erreichbar.",
            },
          });
      } else next(error);
      return;
    }
  });
  return router;
}
