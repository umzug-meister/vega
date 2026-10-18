import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import ArrowRightAltOutlined from "@mui/icons-material/ArrowRightAltOutlined";
import { Box, Stack, Typography } from "@mui/material";
import { AdminAlert as Alert } from "../components/AdminNotifications.js";
import { apiRequest } from "../api/api-request.js";
import type { OrderFormValue } from "./order-form-types.js";
import type { OrderRouteSnapshotInput } from "@vega/domain";

export interface RouteLeg {
  distanceKm: number;
  durationMinutes: number;
}

export interface RouteResult {
  distanceKm: number;
  durationMinutes: number;
  legs: RouteLeg[];
}

export interface RouteConfig {
  origin: string | null;
  available: boolean;
}

interface RouteDistanceProps {
  value: OrderFormValue;
  onRoute: (snapshot: OrderRouteSnapshotInput) => void;
  /** Bumped by the address tab whenever a route-relevant field loses focus. */
  blurToken?: number;
  /** False while the order is still loading; suppresses automatic calculation. */
  ready?: boolean;
}

export function formatDurationMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return "–";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} Min.`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours} Std.` : `${hours} Std. ${rest} Min.`;
}

function splitAddress(address: string): { street: string; city: string } {
  const separator = address.indexOf(", ");
  if (separator < 0) return { street: address, city: "" };
  return {
    street: address.slice(0, separator),
    city: address.slice(separator + 2),
  };
}

function Place({ address, label }: { address: string; label: string }) {
  const { street, city } = splitAddress(address);
  return (
    <Stack
      spacing={0.25}
      sx={{
        width: { xs: 144, sm: 176 },
        minWidth: { xs: 144, sm: 176 },
        height: 88,
        flex: "0 0 auto",
        boxSizing: "border-box",
        overflow: "hidden",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1.5,
        bgcolor: "background.paper",
      }}
    >
      <Box
        sx={{
          px: 1.25,
          py: 0.6,
          bgcolor: "rgba(var(--mui-palette-primary-mainChannel) / 0.10)",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Typography
          variant="caption"
          color="primary.main"
          noWrap
          sx={{ display: "block", fontWeight: 700, lineHeight: 1.4 }}
        >
          {label}
        </Typography>
      </Box>
      <Stack
        spacing={0.1}
        sx={{
          px: 1.25,
          py: 0.5,
          flex: 1,
          justifyContent: "center",
          minHeight: 0,
        }}
      >
        <Typography
          variant="body2"
          title={street}
          sx={{
            fontWeight: 650,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {street}
        </Typography>
        {city && (
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            title={city}
          >
            {city}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

function Connector({ leg }: { leg: RouteLeg }) {
  return (
    <Stack
      sx={{
        width: 64,
        minWidth: 64,
        px: 1,
        boxSizing: "border-box",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Typography color="primary" variant="caption">
        {leg.distanceKm} km
      </Typography>
      <ArrowRightAltOutlined color="primary" fontSize="large" />
      <Typography color="primary" variant="caption">
        {formatDurationMinutes(leg.durationMinutes)}
      </Typography>
    </Stack>
  );
}

export function RouteDistance({
  value,
  onRoute,
  blurToken = 0,
  ready = true,
}: RouteDistanceProps) {
  const [config, setConfig] = useState<RouteConfig | null>(null);
  const [result, setResult] = useState<RouteResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const calculation = useRef<AbortController | null>(null);
  // Route key of the last requested calculation, used to skip unchanged blurs.
  const requestedKey = useRef<string | null>(null);
  // The initial calculation runs at most once, after the configuration is known.
  const initialised = useRef(false);
  const addresses = [
    value.from,
    ...(value.details.showSecondaryFrom && value.details.secondaryFrom
      ? [value.details.secondaryFrom]
      : []),
    value.to,
    ...(value.details.showSecondaryTo && value.details.secondaryTo
      ? [value.details.secondaryTo]
      : []),
  ];
  const complete = addresses.every(
    (address) =>
      address.street.trim() && address.postalCode.trim() && address.city.trim(),
  );
  const texts = addresses.map(
    (address) => `${address.street}, ${address.postalCode} ${address.city}`,
  );
  const routeKey = texts.join("\n");
  // A stored manual or calculated distance must not be overwritten by the initial calculation.
  const storedRoute = value.details.routeSnapshot;
  const storedRouteMatches = Boolean(
    storedRoute &&
    routeAddressesMatch(storedRoute.addresses, texts) &&
    (!config?.origin || sameAddress(storedRoute.origin, config.origin)),
  );
  // Effects only observe blur tokens and config; the latest draft is read from this ref.
  const latest = useRef({
    texts,
    complete,
    routeKey,
    config,
    storedRoute,
    storedRouteMatches,
    onRoute,
    ready,
  });
  latest.current = {
    texts,
    complete,
    routeKey,
    config,
    storedRoute,
    storedRouteMatches,
    onRoute,
    ready,
  };

  const calculate = useCallback(async () => {
    const current = latest.current;
    if (
      !current.ready ||
      !current.config?.origin ||
      !current.config.available ||
      !current.complete
    )
      return;
    requestedKey.current = current.routeKey;
    calculation.current?.abort();
    const controller = new AbortController();
    calculation.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest<RouteResult>(
        "/api/admin/routes/distance",
        "POST",
        { addresses: current.texts },
        { signal: controller.signal },
      );
      if (controller.signal.aborted || calculation.current !== controller)
        return;
      const snapshot: OrderRouteSnapshotInput = {
        ...response,
        calculatedAt: new Date().toISOString(),
        origin: current.config.origin!,
        addresses: current.texts,
      };
      setResult(response);
      current.onRoute(snapshot);
    } catch (reason) {
      if (controller.signal.aborted || calculation.current !== controller)
        return;
      setError(
        reason instanceof Error
          ? reason.message
          : "Die Fahrstrecke konnte nicht berechnet werden.",
      );
    } finally {
      if (calculation.current === controller && !controller.signal.aborted)
        setBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void apiRequest<RouteConfig>("/api/admin/routes/config")
      .then((next) => {
        if (active) setConfig(next);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Routenkonfiguration konnte nicht geladen werden.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => () => calculation.current?.abort(), []);
  // A previously calculated route no longer matches edited addresses; cancel any running calculation
  // and forget the requested key so returning to a previous route recalculates on the next blur.
  useEffect(() => {
    calculation.current?.abort();
    calculation.current = null;
    requestedKey.current = null;
    setBusy(false);
  }, [routeKey]);
  useEffect(() => {
    if (!storedRoute) return;
    setResult({
      distanceKm: storedRoute.distanceKm,
      durationMinutes: storedRoute.durationMinutes,
      legs: storedRoute.legs,
    });
  }, [storedRoute, storedRouteMatches]);
  // Restore saved routes on open. If addresses or depot changed, calculate and replace the snapshot.
  useEffect(() => {
    if (!config || !ready || initialised.current) return;
    initialised.current = true;
    const current = latest.current;
    if (
      !config.available ||
      !config.origin ||
      !current.complete ||
      current.storedRouteMatches
    )
      return;
    void calculate();
  }, [config, ready, calculate]);
  // Recalculate after a route-relevant field lost focus, but only for a changed, complete address.
  useEffect(() => {
    if (blurToken === 0) return;
    const current = latest.current;
    if (
      !current.ready ||
      !current.config?.origin ||
      !current.config.available ||
      !current.complete
    )
      return;
    if (requestedKey.current === current.routeKey) return;
    void calculate();
  }, [blurToken, calculate]);
  const snapshot = value.details.routeSnapshot;
  const itinerary = result && snapshot ? snapshot : null;
  const stops = itinerary
    ? [itinerary.origin, ...itinerary.addresses, itinerary.origin]
    : [];
  const stopLabels = itinerary
    ? [
        "Start",
        ...itinerary.addresses.map((_, index) => {
          const loadingCount = value.details.showSecondaryFrom ? 2 : 1;
          const isLoadingAddress = index < loadingCount;
          const number = isLoadingAddress
            ? index + 1
            : index - loadingCount + 1;
          return `${isLoadingAddress ? "Beladestelle" : "Entladestelle"} ${number}`;
        }),
        "Ende",
      ]
    : [];
  return (
    <Stack spacing={1.5} aria-busy={busy}>
      {error && <Alert severity="error">{error}</Alert>}
      {config && (!config.origin || !config.available) && (
        <Alert severity="info">
          Für die Kartenberechnung müssen der Standort unter Optionen und der
          Google-Maps-Zugang in der Server-Runtime eingerichtet sein.
        </Alert>
      )}
      {result && itinerary && stops.length === result.legs.length + 1 ? (
        <Stack spacing={1}>
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 2 }}
          >
            {stops.map((address, index) => (
              <Fragment key={`${address}-${index}`}>
                <Place address={address} label={stopLabels[index]!} />
                {index < result.legs.length && (
                  <Connector leg={result.legs[index]!} />
                )}
              </Fragment>
            ))}
          </Stack>
          <Typography
            variant="h6"
            color="primary"
            sx={{ alignSelf: "flex-start" }}
          >
            Gesamt: {result.distanceKm} km ·{" "}
            {formatDurationMinutes(result.durationMinutes)}
          </Typography>
        </Stack>
      ) : (
        <Typography variant="h6" color="primary" aria-live="polite">
          {busy
            ? "Fahrstrecke wird berechnet …"
            : "Fahrstrecke noch nicht berechnet"}
        </Typography>
      )}
    </Stack>
  );
}

function routeAddressesMatch(saved: string[], current: string[]): boolean {
  return (
    saved.length === current.length &&
    saved.every((address, index) => sameAddress(address, current[index]!))
  );
}

function sameAddress(left: string, right: string): boolean {
  return (
    left.trim().replace(/\s+/gu, " ").toLocaleLowerCase("de-DE") ===
    right.trim().replace(/\s+/gu, " ").toLocaleLowerCase("de-DE")
  );
}
