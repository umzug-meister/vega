import {
  createContext,
  lazy,
  Suspense,
  useContext,
  useId,
  type PropsWithChildren,
} from "react";
import {
  Alert,
  Box,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  Radio,
  RadioGroup,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
  type TextFieldProps,
} from "@mui/material";
import AddOutlined from "@mui/icons-material/AddOutlined";
import RemoveOutlined from "@mui/icons-material/RemoveOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import type { ReactNode } from "react";

const LazyDateField = lazy(() =>
  import("./DateField.js").then((module) => ({ default: module.DateField })),
);

const ValidationFieldContext = createContext<{
  label: string | null;
  clear: () => void;
}>({ label: null, clear: () => undefined });

export function useFieldValidation(label: ReactNode) {
  const validation = useContext(ValidationFieldContext);
  return {
    error: isValidationError(label, validation.label),
    clear: validation.clear,
  };
}

export function ValidationFieldProvider({
  label,
  clear,
  children,
}: PropsWithChildren<{ label: string | null; clear: () => void }>) {
  return (
    <ValidationFieldContext.Provider value={{ label, clear }}>
      {children}
    </ValidationFieldContext.Provider>
  );
}

function isValidationError(label: ReactNode, validationLabel: string | null) {
  return (
    typeof label === "string" &&
    validationLabel !== null &&
    label.trim().toLocaleLowerCase("de-DE") ===
      validationLabel.trim().toLocaleLowerCase("de-DE")
  );
}

export function Column({
  children,
  gap = 2,
}: PropsWithChildren<{ gap?: number }>) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap, width: "100%" }}>
      {children}
    </Box>
  );
}
export function Section({
  title,
  children,
}: PropsWithChildren<{ title?: string }>) {
  return (
    <Column gap={4}>
      {title && (
        <>
          <Typography variant="h4" color="primary" align="center">
            {title}
          </Typography>
          <Divider />
        </>
      )}
      {children}
    </Column>
  );
}
export function Heading({ children }: PropsWithChildren) {
  return (
    <Typography variant="h5" align="right" color="primary">
      {children}
    </Typography>
  );
}
export function Info({ children }: PropsWithChildren) {
  return (
    <Alert severity="info" icon={<InfoOutlined />}>
      <Typography component="div" variant="subtitle1" sx={{ fontWeight: 700 }}>
        {children}
      </Typography>
    </Alert>
  );
}
export function Field(props: TextFieldProps) {
  const validation = useContext(ValidationFieldContext);
  const validationError = isValidationError(props.label, validation.label);
  return (
    <TextField
      {...props}
      sx={{
        "& input": { border: "none !important", padding: "10px !important" },
        "& input[type=number]": {
          appearance: "textfield",
          MozAppearance: "textfield",
        },
        "& input[type=number]::-webkit-inner-spin-button": { display: "none" },
        ...props.sx,
      }}
      error={props.error || validationError}
      onChange={(event) => {
        props.onChange?.(event);
        if (validationError) validation.clear();
      }}
    />
  );
}
export function SwitchField({
  label,
  value,
  onChange,
  labels,
}: {
  label: ReactNode;
  value: boolean;
  onChange: (value: boolean) => void;
  labels?: { true: string; false: string };
}) {
  const id = useId();
  const narrow = useMediaQuery(useTheme().breakpoints.down("md"));
  return (
    <FormControl
      sx={{
        width: "100%",
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <FormLabel id={id}>{label}</FormLabel>
      <RadioGroup
        aria-labelledby={id}
        row={!narrow}
        sx={{ pl: 3, gap: 2 }}
        value={String(value)}
        onChange={(event) => onChange(event.target.value === "true")}
      >
        <FormControlLabel
          labelPlacement="start"
          value="true"
          control={<Radio />}
          label={labels?.true ?? "Ja"}
        />
        <FormControlLabel
          labelPlacement="start"
          value="false"
          control={<Radio />}
          label={labels?.false ?? "Nein"}
        />
      </RadioGroup>
    </FormControl>
  );
}
export function DateField({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
}) {
  return (
    <Suspense
      fallback={
        <Field
          label={label}
          value={value}
          disabled
          fullWidth
          helperText="Datumsauswahl wird geladen …"
        />
      }
    >
      <LazyDateField
        label={label}
        value={value}
        onChange={onChange}
        {...(min ? { min } : {})}
      />
    </Suspense>
  );
}
export function NumberInput({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
}) {
  const id = useId();
  const set = (next: number) =>
    onChange(Number.isFinite(next) ? Math.max(0, next) : 0);
  return (
    <Box>
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <Field
        id={id}
        value={value || ""}
        type="number"
        onChange={(event) => set(Number(event.target.value))}
        slotProps={{
          htmlInput: { min: 0, step, style: { textAlign: "center" } },
          input: {
            sx: { fontWeight: "bold" },
            startAdornment: (
              <IconButton
                aria-label={`${label} verringern`}
                onClick={() => set(value - step)}
              >
                <RemoveOutlined />
              </IconButton>
            ),
            endAdornment: (
              <IconButton
                aria-label={`${label} erhöhen`}
                onClick={() => set(value + step)}
              >
                <AddOutlined />
              </IconButton>
            ),
          },
        }}
      />
    </Box>
  );
}
