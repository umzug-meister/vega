import { MenuItem } from "@mui/material";
import { Field } from "./components.js";

export function SelectField({ label, value, options, onChange, required = true }: {
  label: string;
  value: string | undefined;
  options: readonly string[];
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <Field select required={required} label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
    </Field>
  );
}
