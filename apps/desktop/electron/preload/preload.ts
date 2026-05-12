import { contextBridge, ipcRenderer } from 'electron';

const api = {
  history: {
    list: (): Promise<unknown> => ipcRenderer.invoke('history:list'),
    save: (session: unknown): Promise<void> => ipcRenderer.invoke('history:save', session),
    summary: (): Promise<unknown> => ipcRenderer.invoke('history:summary'),
  },
  camera: {
    ensurePermission: (): Promise<unknown> => ipcRenderer.invoke('camera:ensure-permission'),
  },
  settings: {
    getStartupEnabled: (): Promise<boolean> => ipcRenderer.invoke('settings:get-startup-enabled'),
    setStartupEnabled: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('settings:set-startup-enabled', enabled),
  },
  notifications: {
    activityReminder: (body: string): Promise<void> =>
      ipcRenderer.invoke('notify:activity-reminder', body),
  },
  app: {
    exit: (): Promise<void> => ipcRenderer.invoke('app:exit'),
  },
};

contextBridge.exposeInMainWorld('homeActivity', api);
