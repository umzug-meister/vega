import type { InboxOrderDraft } from "@vega/domain";
import {
  createEmptyAddress,
  createEmptyOrder,
  type OrderFormValue,
} from "../orders/order-form-types.js";

/** Maps the server-validated AI draft onto a new order form; unknown fields keep their defaults. */
export function draftToFormValue(draft: InboxOrderDraft): OrderFormValue {
  const base = createEmptyOrder();
  return {
    ...base,
    customer: {
      ...base.customer,
      firstName: draft.customer.firstName,
      lastName: draft.customer.lastName,
      phone: draft.customer.phone,
      ...(draft.customer.email ? { email: draft.customer.email } : {}),
    },
    from: { ...base.from, ...draft.from },
    to: { ...base.to, ...draft.to },
    ...(draft.movingDate ? { movingDate: draft.movingDate } : {}),
    ...(draft.movingTime ? { movingTime: draft.movingTime } : {}),
    ...(draft.dateFixed !== undefined ? { dateFixed: draft.dateFixed } : {}),
    ...(draft.visitWanted !== undefined
      ? { visitWanted: draft.visitWanted }
      : {}),
    ...(draft.costsAssumption !== undefined
      ? { costsAssumption: draft.costsAssumption }
      : {}),
    ...(draft.dateFrom && draft.dateTo
      ? {
          dateFrom: draft.dateFrom,
          dateTo: draft.dateTo,
          dateFixed: draft.dateFixed ?? false,
        }
      : {}),
    note: draft.note,
    details: {
      ...base.details,
      ...(draft.secondaryFrom
        ? {
            secondaryFrom: { ...createEmptyAddress(), ...draft.secondaryFrom },
            showSecondaryFrom: true,
          }
        : {}),
      ...(draft.secondaryTo
        ? {
            secondaryTo: { ...createEmptyAddress(), ...draft.secondaryTo },
            showSecondaryTo: true,
          }
        : {}),
      furniture: {
        ...base.details.furniture,
        ...draft.furniture,
      },
      extras: { ...base.details.extras, ...draft.extras },
    },
  };
}
