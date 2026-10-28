import { createContext, useContext } from "react";
import type { OrderEmailKind } from "@vega/domain";

export type { OrderEmailKind };

export interface OrderEmailActions {
  /** Opens the shared send dialog for the saved order. */
  open: (kind: OrderEmailKind) => void;
  /** True while the order editor has unsaved changes or a request is running. */
  disabled: boolean;
}

/**
 * Lets order editor tabs (e.g. the customer tab) open the same send dialog the
 * toolbar uses without duplicating dialog state or bypassing its guards.
 */
export const OrderEmailActionsContext =
  createContext<OrderEmailActions | null>(null);

export function useOrderEmailActions(): OrderEmailActions | null {
  return useContext(OrderEmailActionsContext);
}
