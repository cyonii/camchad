import { describe, expect, it } from 'vitest';

import { createAppNotificationController } from './app-notification-controller.js';
import { settingsNotification, systemNotification } from './app-notifications.js';

import type { AppNotification } from './app-notifications.js';

describe('createAppNotificationController', () => {
  it('updates same-origin notifications without dismissing them', () => {
    const shown: AppNotification[] = [];
    const dismissed: string[] = [];
    let now = 100;
    const controller = createAppNotificationController(
      {
        show: (notification) => shown.push(notification),
        dismiss: (id) => dismissed.push(id),
      },
      () => now,
    );

    const first = controller.notify(settingsNotification('camera', 'pending', 'info', 'Checking'));
    now = 200;
    const second = controller.notify(settingsNotification('camera', 'success', 'success', 'Ready'));

    expect(second.id).toBe(first.id);
    expect(dismissed).toEqual([]);
    expect(shown).toHaveLength(2);
    expect(controller.current()).toMatchObject({ title: 'Ready', createdAtMs: 200 });
  });

  it('allows unrelated notifications to stack', () => {
    const shown: AppNotification[] = [];
    const dismissed: string[] = [];
    const controller = createAppNotificationController({
      show: (notification) => shown.push(notification),
      dismiss: (id) => dismissed.push(id),
    });

    const first = controller.notify(settingsNotification('camera', 'success', 'success', 'Ready'));
    const second = controller.notify(
      systemNotification('history-export', 'success', 'success', 'Exported'),
    );

    expect(first.id).not.toBe(second.id);
    expect(dismissed).toEqual([]);
    expect(shown).toEqual([first, second]);
    expect(controller.current()).toBe(second);
  });

  it('clears the current notification when dismissed', () => {
    const dismissed: string[] = [];
    const controller = createAppNotificationController({
      show: () => undefined,
      dismiss: (id) => dismissed.push(id),
    });

    const notification = controller.notify(
      systemNotification('history-import', 'warning', 'warning', 'No sessions'),
    );

    controller.dismiss();

    expect(dismissed).toEqual([notification.id]);
    expect(controller.current()).toBeUndefined();
  });
});
