import type { ReactNode } from "react";
import { Container, Paper, Stack } from "@mui/material";

const cardSx = { p: 1, width: "100%" };

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 5, sm: 10 } }}>
      <Paper variant="outlined" sx={cardSx}>
        <Stack spacing={2.5}>{children}</Stack>
      </Paper>
    </Container>
  );
}
