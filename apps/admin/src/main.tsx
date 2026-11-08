import React from "react";
import ReactDOM from "react-dom/client";
import { CssBaseline, ThemeProvider } from "@mui/material";
import { App } from "./App.js";
import { AdminNotifications } from "./components/AdminNotifications.js";
import { adminTheme } from "./theme.js";
import { PwaStatus } from "./pwa/PwaStatus.js";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/700.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={adminTheme} defaultMode="system" modeStorageKey="vega-admin-color-mode" disableTransitionOnChange>
      <CssBaseline />
      <AdminNotifications>
        <PwaStatus />
        <App />
      </AdminNotifications>
    </ThemeProvider>
  </React.StrictMode>,
);
