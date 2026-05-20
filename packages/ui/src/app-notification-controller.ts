import { createAppNotification } from './app-notifications.js';

import type { AppNotification, AppNotificationInput } from './app-notifications.js';

export interface AppNotificationAdapter {
  readonly show: (notification: AppNotification) => void;
  readonly dismiss: (id: string) => void;
}

export interface AppNotificationController {
  readonly notify: (input: AppNotificationInput) => AppNotification;
  readonly dismiss: (id?: string) => void;
  readonly current: () => AppNotification | undefined;
}

export function createAppNotificationController(
  adapter: AppNotificationAdapter,
  now: () => number = Date.now,
): AppNotificationController {
  const activeNotifications = new Map<string, AppNotification>();
  let latestNotificationId: string | undefined;

  return {
    notify(input) {
      const nextNotification = createAppNotification(input, now());
      activeNotifications.set(nextNotification.id, nextNotification);
      latestNotificationId = nextNotification.id;
      adapter.show(nextNotification);

      return nextNotification;
    },
    dismiss(id) {
      const idToDismiss = id ?? latestNotificationId;

      if (!idToDismiss) {
        return;
      }

      adapter.dismiss(idToDismiss);
      activeNotifications.delete(idToDismiss);

      if (latestNotificationId === idToDismiss) {
        latestNotificationId = Array.from(activeNotifications.keys()).at(-1);
      }
    },
    current() {
      return latestNotificationId ? activeNotifications.get(latestNotificationId) : undefined;
    },
  };
}
