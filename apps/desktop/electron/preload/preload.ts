import { contextBridge, ipcRenderer } from 'electron';

const api = {
  history: {
    list: (): Promise<unknown> => ipcRenderer.invoke('history:list'),
    save: (session: unknown): Promise<void> => ipcRenderer.invoke('history:save', session),
    summary: (): Promise<unknown> => ipcRenderer.invoke('history:summary'),
    clear: (): Promise<void> => ipcRenderer.invoke('history:clear'),
    replace: (sessions: unknown): Promise<void> => ipcRenderer.invoke('history:replace', sessions),
    storageInfo: (): Promise<unknown> => ipcRenderer.invoke('history:storage-info'),
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

contextBridge.exposeInMainWorld('camChad', api);
