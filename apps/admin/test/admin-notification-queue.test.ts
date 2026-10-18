import assert from "node:assert/strict";
import test from "node:test";
import {
  adminNotificationAutoHideDuration,
  adminNotificationReducer,
  initialAdminNotificationState,
  type AdminNotification,
} from "../src/components/admin-notification-queue.js";

test("success notifications expire after three seconds, warnings after fifteen seconds, and errors after twenty seconds", () => {
  assert.equal(adminNotificationAutoHideDuration("success"), 3_000);
  assert.equal(adminNotificationAutoHideDuration("warning"), 15_000);
  assert.equal(adminNotificationAutoHideDuration("error"), 20_000);
});

test("notifications stack up to five; further ones wait for a free slot in order", () => {
  const items: AdminNotification[] = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1,
    severity: index % 2 ? "success" : "error",
    message: `m${index + 1}`,
  }));
  const full = items.reduce(
    (state, notification) =>
      adminNotificationReducer(state, { type: "enqueue", notification }),
    initialAdminNotificationState,
  );
  assert.deepEqual(
    full.visible.map((entry) => entry.id),
    [1, 2, 3, 4, 5],
  );
  assert.deepEqual(
    full.queued.map((entry) => entry.id),
    [6, 7],
  );

  const afterDismiss = adminNotificationReducer(full, {
    type: "dismiss",
    id: 2,
  });
  assert.deepEqual(
    afterDismiss.visible.map((entry) => entry.id),
    [1, 3, 4, 5, 6],
  );
  assert.deepEqual(
    afterDismiss.queued.map((entry) => entry.id),
    [7],
  );
  assert.equal(
    adminNotificationReducer(afterDismiss, { type: "dismiss", id: 2 }),
    afterDismiss,
  );
});
