import { Card, CardContent, type CardProps } from "@mui/material";
import type { ReactNode } from "react";

type AdminCardProps = CardProps & { children: ReactNode };

export function AdminCard({ children, ...cardProps }: AdminCardProps) {
  return (
    <Card {...cardProps}>
      <CardContent>{children}</CardContent>
    </Card>
  );
}