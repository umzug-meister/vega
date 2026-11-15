import { createTheme } from "@mui/material/styles";

const palette = {
  ink: "#20242C",
  blue: "#2458D3",
  canvas: "#F3F5F8",
  paper: "#FFFFFF",
  line: "#E1E6EE",
  muted: "#697384",
};

export const adminTheme = createTheme({
  cssVariables: { colorSchemeSelector: "class" },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: palette.blue, dark: "#1743AD", light: "#E8EFFD" },
        text: { primary: palette.ink, secondary: palette.muted },
        divider: palette.line,
        background: { default: palette.canvas, paper: palette.paper },
      },
    },
    dark: {
      palette: {
        primary: {
          main: "#91B4FF",
          dark: "#668EE0",
          light: "#BCD1FF",
          contrastText: "#14213B",
        },
        text: { primary: "#EDF0F6", secondary: "#ADB7C7" },
        divider: "#384354",
        background: { default: "#171D27", paper: "#232C3A" },
      },
    },
  },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif',
    h1: {
      fontSize: "1.75rem",
      lineHeight: 1.2,
      fontWeight: 600,
    },
    h2: {
      fontSize: "1.5rem",
      lineHeight: 1.3,
      fontWeight: 600,
    },
    h3: {
      fontSize: "1.25rem",
      lineHeight: 1.35,
      fontWeight: 600,
    },
    h4: { fontSize: "1.125rem", lineHeight: 1.4, fontWeight: 500 },
    h5: { fontSize: "1rem", lineHeight: 1.45, fontWeight: 600 },
    h6: { fontSize: "0.9375rem", lineHeight: 1.45, fontWeight: 600 },
    body1: { fontSize: "0.9375rem", lineHeight: 1.55 },
    body2: { fontSize: "0.875rem", lineHeight: 1.5 },
    button: { fontWeight: 600, textTransform: "none" },
  },
  shape: { borderRadius: 4 },
  components: {
    MuiAlert: {
      styleOverrides: {
        root: ({ theme }) =>
          theme.applyStyles("dark", {
            "&.MuiAlert-filled": {
              border: "1px solid",
              "&.MuiAlert-colorError": {
                backgroundColor: "#402830",
                borderColor: "#75424D",
                color: "#FFDADF",
              },
              "&.MuiAlert-colorWarning": {
                backgroundColor: "#3E3222",
                borderColor: "#756039",
                color: "#F5DDA9",
              },
              "&.MuiAlert-colorSuccess": {
                backgroundColor: "#233B32",
                borderColor: "#3E6A57",
                color: "#C4EAD6",
              },
              "&.MuiAlert-colorInfo": {
                backgroundColor: "#25364D",
                borderColor: "#425E86",
                color: "#D0E1FF",
              },
            },
          }),
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          textRendering: "optimizeLegibility",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        },
        "@media (prefers-reduced-motion: reduce)": {
          ".MuiListItemButton-root": { transition: "none !important" },
        },
        "::selection": {
          backgroundColor:
            "rgba(var(--mui-palette-primary-mainChannel) / 0.25)",
        },
        ":focus-visible": {
          outline: "3px solid var(--mui-palette-primary-main)",
          outlineOffset: 2,
        },
      },
    },
    MuiMenu: {
      defaultProps: { slotProps: { paper: { elevation: 3 } } },
    },
    MuiTypography: {
      styleOverrides: {
        root: ({ ownerState }) =>
          ownerState.component !== "h1" &&
          /^h[2-6]$/u.test(ownerState.variant ?? "") &&
          !ownerState.color
            ? { color: "var(--mui-palette-text-primary)" }
            : {},
      },
    },
    MuiCardHeader: {
      styleOverrides: { title: { color: "var(--mui-palette-text-primary)" } },
    },
    MuiTabs: {
      styleOverrides: { root: { backgroundColor: "transparent" } },
    },
    MuiTab: {
      styleOverrides: {
        root: { minWidth: 64, paddingInline: 8, whiteSpace: "nowrap" },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: 38, paddingInline: 14 },
      },
    },
    MuiGrid: {
      styleOverrides: {
        root: { alignItems: "stretch" },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 4,
          width: 40,
          height: 40,
          minWidth: 40,
          minHeight: 40,
          padding: 8,
          boxSizing: "border-box",
          verticalAlign: "middle",
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          "& .MuiSvgIcon-root": { fontSize: 20 },
          "&:hover": {
            backgroundColor: "var(--mui-palette-action-hover)",
          },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: "var(--mui-palette-background-paper)",
          color: "var(--mui-palette-text-primary)",
          border: 0,
          borderBottom: "1px solid var(--mui-palette-divider)",
          boxShadow: "none",
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: "var(--mui-palette-background-paper)",
          borderColor: "var(--mui-palette-divider)",
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          minHeight: 40,
          marginInline: 8,
          width: "calc(100% - 16px)",
          "&.Mui-selected": {
            backgroundColor:
              "rgba(var(--mui-palette-primary-mainChannel) / 0.12)",
            color: "var(--mui-palette-primary-main)",
            borderColor: "rgba(var(--mui-palette-primary-mainChannel) / 0.2)",
            boxShadow:
              "inset 0 1px 0 rgba(var(--mui-palette-text-primaryChannel) / 0.06)",
            "&:hover": {
              backgroundColor:
                "rgba(var(--mui-palette-primary-mainChannel) / 0.18)",
            },
          },
          border: "1px solid transparent",
          transition:
            "background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease",
          "&:hover": { backgroundColor: "var(--mui-palette-action-hover)" },
        },
      },
    },
    MuiListItemIcon: {
      styleOverrides: {
        root: {
          color: "inherit",
          minWidth: 32,
          "& .MuiSvgIcon-root": { fontSize: 20 },
        },
      },
    },
    MuiTextField: {
      defaultProps: { margin: "dense", size: "small" },
    },
    MuiFormControl: {
      defaultProps: { margin: "dense" },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: "var(--mui-palette-background-paper)",
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: "var(--mui-palette-background-paper)",
          backgroundImage: "none",
          "&.MuiPaper-outlined": {
            borderColor: "var(--mui-palette-divider)",
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: "var(--mui-palette-background-paper)",
          border: "1px solid var(--mui-palette-divider)",
          boxShadow: "none",
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          color: "var(--mui-palette-text-secondary)",
          fontWeight: 600,
          whiteSpace: "nowrap",
        },
        root: { borderColor: "var(--mui-palette-divider)" },
      },
    },
    MuiTableRow: {
      styleOverrides: { root: { "&:last-child td": { borderBottom: 0 } } },
    },
  },
});
