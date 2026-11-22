import { useEffect, useRef, useState, type ReactNode } from "react";
import { TextField } from "@mui/material";

export function NonNegativeNumberField({
  label,
  value,
  step,
  min = 0,
  max,
  fullWidth,
  endAdornment,
  onChange,
}: {
  label: string;
  value: number;
  step: number | "any";
  min?: number;
  max?: number;
  fullWidth?: boolean;
  endAdornment?: ReactNode;
  onChange: (value: number) => void;
}) {
  const [inputValue, setInputValue] = useState(() =>
    value === 0 ? "" : String(value),
  );
  const lastValue = useRef(value);

  useEffect(() => {
    if (value === lastValue.current) return;
    lastValue.current = value;
    setInputValue(value === 0 ? "" : String(value));
  }, [value]);

  return (
    <TextField
      type="number"
      fullWidth={fullWidth}
      label={label}
      value={inputValue}
      onChange={(event) => {
        const rawValue = event.target.value;
        const nextValue = rawValue === "" ? 0 : Number(rawValue);
        lastValue.current = nextValue;
        setInputValue(rawValue);
        onChange(nextValue);
      }}
      slotProps={{
        htmlInput: { min, max, step },
        input: endAdornment ? { endAdornment } : {},
      }}
    />
  );
}
