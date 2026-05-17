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
  windowControls: {
    getState: (): Promise<unknown> => ipcRenderer.invoke('window:get-state'),
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<void> => ipcRenderer.invoke('window:toggle-maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    subscribe: (listener: (state: unknown) => void): (() => void) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown): void => {
        listener(state);
      };

      ipcRenderer.on('window:state-changed', wrappedListener);

      return () => ipcRenderer.removeListener('window:state-changed', wrappedListener);
    },
  },
  developerTools: {
    savePoseTrace: (trace: unknown): Promise<unknown> =>
      ipcRenderer.invoke('developer:save-pose-trace', trace),
  },
};

contextBridge.exposeInMainWorld('camChad', api);
