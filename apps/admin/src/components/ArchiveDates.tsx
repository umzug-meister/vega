import { TableCell, Tooltip } from "@mui/material";

function formatArchiveDate(value: string | null): string {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Ungültiges Datum" : date.toLocaleDateString("de-DE");
}

export function ArchiveDateHeaders() {
  return <>
    <TableCell>Archiviert am</TableCell>
    <TableCell>
      <Tooltip title="Ab diesem Datum kann der Cron-Lauf den Eintrag löschen. Der tatsächliche Zeitpunkt hängt vom Cron-Lauf ab.">
        <span>Löschung frühestens</span>
      </Tooltip>
    </TableCell>
  </>;
}

export function ArchiveDateCells({ archivedAt, purgeAt }: { archivedAt: string | null; purgeAt: string | null }) {
  return <>
    <TableCell sx={{ whiteSpace: "nowrap" }}>{formatArchiveDate(archivedAt)}</TableCell>
    <TableCell sx={{ whiteSpace: "nowrap" }}>{formatArchiveDate(purgeAt)}</TableCell>
  </>;
}
