import { Toaster } from 'sonner';

import type { ReactElement } from 'react';

const defaultNotificationDurationMs = 2600;

export function AppNotificationToaster(): ReactElement {
  return (
    <Toaster
      position="top-center"
      expand={false}
      closeButton
      richColors
      duration={defaultNotificationDurationMs}
      containerAriaLabel="App notifications"
      toastOptions={{
        className: 'app-notification-toast',
        classNames: {
          title: 'app-notification-title',
          description: 'app-notification-description',
          closeButton: 'app-notification-close',
        },
      }}
    />
  );
}
