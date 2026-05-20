import { toast } from 'sonner';

import type { AppNotification, AppNotificationTone } from './app-notifications.js';

const defaultNotificationDurationMs = 2600;

export const sonnerAppNotificationAdapter = {
  show(notification: AppNotification): void {
    const options = {
      id: notification.id,
      description: notification.message,
      duration: notification.durationMs ?? defaultNotificationDurationMs,
      closeButton: true,
    };

    toastForTone(notification.tone)(notification.title, options);
  },
  dismiss(id: string): void {
    toast.dismiss(id);
  },
};

function toastForTone(tone: AppNotificationTone): typeof toast.info {
  switch (tone) {
    case 'success':
      return toast.success;
    case 'warning':
      return toast.warning;
    case 'error':
      return toast.error;
    case 'info':
      return toast.info;
  }
}
