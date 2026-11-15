import { Box, Typography } from "@mui/material";
import { useEffect, useState } from "react";

const clocks = [
  { city: "München", timeZone: "Europe/Berlin" },
  { city: "Minsk", timeZone: "Europe/Minsk" },
  { city: "Kaliningrad", timeZone: "Europe/Kaliningrad" },
  { city: "Warna", timeZone: "Europe/Sofia" },
].map((clock) => ({
  ...clock,
  formatter: new Intl.DateTimeFormat("de-DE", {
    timeZone: clock.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }),
}));

export function WorldClocks() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <Box
      component="section"
      aria-label="Ortszeiten"
      sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", justifyItems: "center", gap: 0.5, px: 1, py: 1 }}
    >
      {clocks.map(({ city, formatter }, index) => (
        <Clock key={city} city={city} formatter={formatter} now={now} featured={index === 0} />
      ))}
    </Box>
  );
}

function Clock({ city, formatter, now, featured }: {
  city: string;
  formatter: Intl.DateTimeFormat;
  now: Date;
  featured: boolean;
}) {
  const parts = formatter.formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const second = Number(parts.find((part) => part.type === "second")?.value);
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  return (
    <Box
      sx={{ gridColumn: featured ? "1 / -1" : undefined, minWidth: 0, textAlign: "center" }}
    >
      <Typography variant="caption" color="text.secondary" component="div" sx={{ fontWeight: 600, fontSize: featured ? "0.75rem" : "0.65rem" }}>
        {city}
      </Typography>
      <Box
        component="svg"
        viewBox="0 0 100 100"
        aria-hidden="true"
        sx={{ display: "block", width: featured ? 76 : 48, height: featured ? 76 : 48, mx: "auto", my: 0.5, color: "text.primary" }}
      >
        <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="2" />
        {Array.from({ length: 12 }, (_, index) => (
          <line
            key={index}
            x1="50" y1="8" x2="50" y2={index % 3 === 0 ? "15" : "12"}
            stroke="currentColor"
            strokeWidth={index % 3 === 0 ? "2.5" : "1.5"}
            transform={`rotate(${index * 30} 50 50)`}
          />
        ))}
        <line x1="50" y1="52" x2="50" y2="27" stroke="currentColor" strokeWidth="4" strokeLinecap="round" transform={`rotate(${(hour % 12) * 30 + minute * 0.5} 50 50)`} />
        <line x1="50" y1="53" x2="50" y2="17" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" transform={`rotate(${minute * 6 + second * 0.1} 50 50)`} />
        <line x1="50" y1="57" x2="50" y2="15" stroke="#c62828" strokeWidth="1.25" transform={`rotate(${second * 6} 50 50)`} />
        <circle cx="50" cy="50" r="2.5" fill="#c62828" />
      </Box>
      <Typography component="time" dateTime={now.toISOString()} sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: featured ? "0.875rem" : "0.75rem" }}>
        {time}
      </Typography>
    </Box>
  );
}
