import { describe, expect, it } from 'vitest';

import {
  appNotificationIdForOrigin,
  createAppNotification,
  settingsNotification,
  systemNotification,
} from './app-notifications.js';

describe('app notifications', () => {
  it('uses the same id for the same origin across statuses', () => {
    const pending = createAppNotification(
      settingsNotification('camera', 'pending', 'info', 'Checking camera'),
      100,
    );
    const failed = createAppNotification(
      settingsNotification('camera', 'error', 'error', 'Camera unavailable'),
      200,
    );

    expect(pending.id).toBe(failed.id);
    expect(failed.id).toBe(appNotificationIdForOrigin('settings:camera'));
    expect(failed.status).toBe('error');
    expect(failed.createdAtMs).toBe(200);
  });

  it('uses different ids for unrelated origins', () => {
    expect(
      createAppNotification(settingsNotification('camera', 'success', 'success', 'Saved')).id,
    ).not.toBe(
      createAppNotification(systemNotification('history-export', 'success', 'success', 'Saved')).id,
    );
  });
});
