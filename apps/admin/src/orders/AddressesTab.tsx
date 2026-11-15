import { useCallback, useState, type ReactNode } from "react";
import {
  AddOutlined,
  CompareArrowsOutlined,
  RemoveOutlined,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Grid,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { AdminCard } from "../components/AdminCard.js";
import type { OrderDetailsInput, OrderRouteSnapshotInput } from "@vega/domain";
import { AddressFields } from "./AddressFields.js";
import { createEmptyAddress, type OrderFormValue } from "./order-form-types.js";
import { RouteDistance } from "./RouteDistance.js";

function AddressCard({
  title,
  color,
  actions,
  value,
  onChange,
  onRouteFieldBlur,
  xlSize,
  showApartmentDetails = true,
}: {
  title: string;
  color: "error.main" | "primary.main";
  actions: ReactNode;
  value: NonNullable<OrderFormValue["to"]>;
  onChange: (address: Partial<NonNullable<OrderFormValue["to"]>>) => void;
  onRouteFieldBlur: () => void;
  xlSize: number;
  showApartmentDetails?: boolean;
}) {
  return (
    <Grid size={{ xs: 12, md: 6, xl: xlSize }}>
      <AdminCard variant="outlined" sx={{ height: "100%" }}>
        <Stack spacing={2}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Typography component="h2" variant="h6" color={color}>
              {title}
            </Typography>
            {actions}
          </Box>
          <AddressFields
            title=""
            value={value}
            showApartmentDetails={showApartmentDetails}
            onRouteFieldBlur={onRouteFieldBlur}
            onChange={onChange}
          />
        </Stack>
      </AdminCard>
    </Grid>
  );
}

interface AddressesTabProps {
  value: OrderFormValue;
  update: (patch: Partial<OrderFormValue>) => void;
  onDetailsChange: (details: OrderDetailsInput) => void;
  onRouteCalculated?: (snapshot: OrderRouteSnapshotInput) => void;
  ready?: boolean;
}

export function AddressesTab({
  value,
  update,
  onDetailsChange,
  onRouteCalculated,
  ready = true,
}: AddressesTabProps) {
  const { details } = value;
  const [routeBlurToken, setRouteBlurToken] = useState(0);
  const signalRouteBlur = useCallback(
    () => setRouteBlurToken((token) => token + 1),
    [],
  );

  function toggleSecondary(kind: "from" | "to") {
    if (kind === "from") {
      if (details.showSecondaryFrom) {
        const { secondaryFrom: _removed, ...rest } = details;
        onDetailsChange({ ...rest, showSecondaryFrom: false });
      } else {
        onDetailsChange({
          ...details,
          secondaryFrom: createEmptyAddress(),
          showSecondaryFrom: true,
        });
      }
    } else if (details.showSecondaryTo) {
      const { secondaryTo: _removed, ...rest } = details;
      onDetailsChange({ ...rest, showSecondaryTo: false });
    } else {
      onDetailsChange({
        ...details,
        secondaryTo: createEmptyAddress(),
        showSecondaryTo: true,
      });
    }
    signalRouteBlur();
  }

  function exchange(kind: "from" | "to") {
    if (kind === "from" && details.secondaryFrom) {
      onDetailsChange({ ...details, secondaryFrom: value.from });
      update({ from: details.secondaryFrom });
      signalRouteBlur();
    } else if (kind === "to" && details.secondaryTo && value.to) {
      onDetailsChange({ ...details, secondaryTo: value.to });
      update({ to: details.secondaryTo });
      signalRouteBlur();
    }
  }

  function removeDestination() {
    const { secondaryTo: _removed, ...rest } = details;
    onDetailsChange({ ...rest, showSecondaryTo: false });
    update({ to: undefined });
    signalRouteBlur();
  }

  const activeAddressCount =
    1 +
    Number(value.to !== undefined) +
    Number(details.showSecondaryFrom) +
    Number(details.showSecondaryTo);
  const wideColumns = Math.max(3, Math.floor(12 / activeAddressCount));

  return (
    <Stack spacing={2}>
      <AdminCard variant="outlined">
        <Stack spacing={1.5}>
          <Typography component="h2" variant="h6">
            Fahrstrecke
          </Typography>
          <RouteDistance
            value={value}
            blurToken={routeBlurToken}
            ready={ready}
            onRoute={(routeSnapshot) => {
              onDetailsChange({
                ...details,
                distanceKm: routeSnapshot.distanceKm,
                distanceSource: "route",
                routeSnapshot,
              });
              onRouteCalculated?.(routeSnapshot);
            }}
          />
        </Stack>
      </AdminCard>

      <Grid container spacing={2} sx={{ alignItems: "stretch" }}>
        <AddressCard
          title={details.showSecondaryFrom ? "1. Beladestelle" : "Beladestelle"}
          color="error.main"
          value={value.from}
          onRouteFieldBlur={signalRouteBlur}
          xlSize={wideColumns}
          onChange={(from) => update({ from: { ...value.from, ...from } })}
          actions={
            <Tooltip title="Beladestelle hinzufügen">
              <IconButton
                onClick={() => toggleSecondary("from")}
                aria-label="Weitere Beladestelle umschalten"
              >
                <AddOutlined />
              </IconButton>
            </Tooltip>
          }
        />
        {details.showSecondaryFrom && details.secondaryFrom && (
          <AddressCard
            title="2. Beladestelle"
            color="error.main"
            value={details.secondaryFrom}
            onRouteFieldBlur={signalRouteBlur}
            xlSize={wideColumns}
            onChange={(secondaryFrom) => {
              const current = details.secondaryFrom;
              if (current)
                onDetailsChange({
                  ...details,
                  secondaryFrom: { ...current, ...secondaryFrom },
                });
            }}
            actions={
              <Stack direction="row" spacing={0.5}>
                <Tooltip title="1. und 2. Beladestelle tauschen">
                  <IconButton
                    onClick={() => exchange("from")}
                    aria-label="Beladestellen tauschen"
                  >
                    <CompareArrowsOutlined />
                  </IconButton>
                </Tooltip>
                <Tooltip title="2. Beladestelle entfernen">
                  <IconButton
                    onClick={() => toggleSecondary("from")}
                    aria-label="Zweite Beladestelle entfernen"
                  >
                    <RemoveOutlined />
                  </IconButton>
                </Tooltip>
              </Stack>
            }
          />
        )}
        {value.to ? (
          <AddressCard
            title={details.showSecondaryTo ? "1. Entladestelle" : "Entladestelle"}
            color="primary.main"
            value={value.to}
            showApartmentDetails={false}
            onRouteFieldBlur={signalRouteBlur}
            xlSize={wideColumns}
            onChange={(to) => update({ to: { ...value.to!, ...to } })}
            actions={
              <Stack direction="row" spacing={0.5}>
                <Tooltip title="Entladestelle entfernen">
                  <IconButton
                    onClick={removeDestination}
                    aria-label="Entladestelle entfernen"
                  >
                    <RemoveOutlined />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Entladestelle hinzufügen">
                  <IconButton
                    onClick={() => toggleSecondary("to")}
                    aria-label="Weitere Entladestelle umschalten"
                  >
                    <AddOutlined />
                  </IconButton>
                </Tooltip>
              </Stack>
            }
          />
        ) : (
          <Grid size={{ xs: 12, md: 6, xl: wideColumns }}>
            <Button
              variant="outlined"
              startIcon={<AddOutlined />}
              onClick={() => update({ to: { ...createEmptyAddress(), montage: false } })}
            >
              Entladestelle hinzufügen
            </Button>
          </Grid>
        )}
        {value.to && details.showSecondaryTo && details.secondaryTo && (
          <AddressCard
            title="2. Entladestelle"
            color="primary.main"
            value={details.secondaryTo}
            showApartmentDetails={false}
            onRouteFieldBlur={signalRouteBlur}
            xlSize={wideColumns}
            onChange={(secondaryTo) => {
              const current = details.secondaryTo;
              if (current)
                onDetailsChange({
                  ...details,
                  secondaryTo: { ...current, ...secondaryTo },
                });
            }}
            actions={
              <Stack direction="row" spacing={0.5}>
                <Tooltip title="1. und 2. Entladestellen tauschen">
                  <IconButton
                    onClick={() => exchange("to")}
                    aria-label="Entladestellen tauschen"
                  >
                    <CompareArrowsOutlined />
                  </IconButton>
                </Tooltip>
                <Tooltip title="2. Entladestelle entfernen">
                  <IconButton
                    onClick={() => toggleSecondary("to")}
                    aria-label="Zweite Entladestelle entfernen"
                  >
                    <RemoveOutlined />
                  </IconButton>
                </Tooltip>
              </Stack>
            }
          />
        )}
      </Grid>
    </Stack>
  );
}