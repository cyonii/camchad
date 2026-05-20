import { Toaster } from 'sonner';

import type { ReactElement } from 'react';

const defaultNotificationDurationMs = 2600;

export function AppNotificationToaster(): ReactElement {
  return (
    <Toaster
      className="app-notification-region"
      position="top-center"
      expand={false}
      richColors
      duration={defaultNotificationDurationMs}
      containerAriaLabel="App notifications"
      toastOptions={{
        className: 'app-notification-toast',
        classNames: {
          title: 'app-notification-title',
          description: 'app-notification-description',
        },
      }}
    />
  );
}
