import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  palette: { primary: { main: "#1774BF" } },
  shape: { borderRadius: 5 },
  typography: {
    fontFamily: '"Montserrat","Arial",sans-serif',
    fontSize: 14,
    fontWeightRegular: 400,
    h4: { fontWeight: 500 },
  },
  components: {
    MuiFormLabel: {
      styleOverrides: { root: { color: "#1a1a1a", fontWeight: 400 } },
    },
    MuiTextField: {
      defaultProps: { size: "small", fullWidth: true, variant: "outlined" },
    },
    MuiOutlinedInput: { styleOverrides: { root: { minHeight: 43 } } },
    MuiGrid: { styleOverrides: { root: { alignItems: "center" } } },
    MuiIconButton: {
      styleOverrides: {
        root: {
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
        },
      },
    },
  },
});
