import { TextField } from "@mui/material";
import { useFieldValidation } from "./components.js";
import { localDate } from "./form-model.js";

export function DateField({ label, value, onChange, min }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
}) {
  const validation = useFieldValidation(label);
  const minDate = min && min > localDate() ? min : localDate();
  return (
    <TextField
      label={label}
      type="date"
      value={value}
      onChange={(event) => {
        onChange(event.target.value);
        if (validation.error) validation.clear();
      }}
      required
      fullWidth
      size="small"
      error={validation.error}
      slotProps={{
        inputLabel: { shrink: true },
        htmlInput: { min: minDate },
      }}
      sx={{ "& .MuiInputBase-root": { minHeight: 43 } }}
    />
  );
}
