import type { ReactNode } from "react";
import { Container, Stack } from "@mui/material";
import { AdminCard } from "../components/AdminCard.js";

const cardSx = { width: "100%" };

export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <Container maxWidth="sm" sx={{ py: { xs: 5, sm: 10 } }}>
      <AdminCard variant="outlined" sx={cardSx}>
        <Stack spacing={2.5}>{children}</Stack>
      </AdminCard>
    </Container>
  );
}
