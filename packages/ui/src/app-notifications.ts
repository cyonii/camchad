export type AppNotificationTone = 'info' | 'success' | 'warning' | 'error';

export type AppNotificationStatus = 'pending' | 'success' | 'warning' | 'error' | 'info';

// Notifications are reserved for direct user-facing operations. Do not use them for
// frame-level movement telemetry, pose confidence changes, or repeated guidance loops.
export type AppNotificationOrigin = `command:${string}` | `settings:${string}` | `system:${string}`;

export interface AppNotificationInput {
  readonly origin: AppNotificationOrigin;
  readonly status: AppNotificationStatus;
  readonly tone: AppNotificationTone;
  readonly title: string;
  readonly message?: string;
  readonly durationMs?: number;
}

export interface AppNotification extends AppNotificationInput {
  readonly id: string;
  readonly createdAtMs: number;
}

const notificationIdPrefix = 'camchad-notification';

export function appNotificationIdForOrigin(origin: AppNotificationOrigin): string {
  return `${notificationIdPrefix}:${origin}`;
}

export function createAppNotification(
  input: AppNotificationInput,
  createdAtMs = Date.now(),
): AppNotification {
  return {
    ...input,
    id: appNotificationIdForOrigin(input.origin),
    createdAtMs,
  };
}

export function settingsNotification(
  setting: string,
  status: AppNotificationStatus,
  tone: AppNotificationTone,
  title: string,
  message?: string,
): AppNotificationInput {
  return notificationInput({
    origin: `settings:${setting}`,
    status,
    tone,
    title,
    message,
  });
}

export function systemNotification(
  operation: string,
  status: AppNotificationStatus,
  tone: AppNotificationTone,
  title: string,
  message?: string,
): AppNotificationInput {
  return notificationInput({
    origin: `system:${operation}`,
    status,
    tone,
    title,
    message,
  });
}

function notificationInput(input: AppNotificationInput): AppNotificationInput {
  return input;
}
