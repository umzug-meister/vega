export type AdminNotificationSeverity = "error" | "success" | "warning";

export interface AdminNotification {
  id: number;
  severity: AdminNotificationSeverity;
  message: string;
}

export interface AdminNotificationState {
  visible: AdminNotification[];
  queued: AdminNotification[];
}

export type AdminNotificationAction =
  | { type: "enqueue"; notification: AdminNotification }
  | { type: "dismiss"; id: number };

export const maxVisibleAdminNotifications = 5;

export const initialAdminNotificationState: AdminNotificationState = {
  visible: [],
  queued: [],
};

/** Up to five toasts are stacked; further ones wait until a slot is free. */
export function adminNotificationReducer(
  state: AdminNotificationState,
  action: AdminNotificationAction,
): AdminNotificationState {
  if (action.type === "enqueue") {
    return state.visible.length < maxVisibleAdminNotifications
      ? { ...state, visible: [...state.visible, action.notification] }
      : { ...state, queued: [...state.queued, action.notification] };
  }

  if (!state.visible.some((entry) => entry.id === action.id)) return state;
  const [next, ...queued] = state.queued;
  const visible = state.visible.filter((entry) => entry.id !== action.id);
  return { visible: next ? [...visible, next] : visible, queued };
}

export function adminNotificationAutoHideDuration(
  severity: AdminNotificationSeverity,
) {
  if (severity === "error") return 20_000;
  if (severity === "warning") return 15_000;
  return 3_000;
}
