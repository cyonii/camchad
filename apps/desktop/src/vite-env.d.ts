/// <reference types="vite/client" />

declare global {
  interface Window {
    camChad: {
      history: {
        list(): Promise<unknown>;
        save(session: unknown): Promise<void>;
        summary(): Promise<unknown>;
        clear(): Promise<void>;
        replace(sessions: unknown): Promise<void>;
        storageInfo(): Promise<unknown>;
      };
      camera: {
        ensurePermission(): Promise<unknown>;
      };
      settings: {
        getStartupEnabled(): Promise<boolean>;
        setStartupEnabled(enabled: boolean): Promise<void>;
      };
      notifications: {
        activityReminder(body: string): Promise<void>;
      };
      app: {
        exit(): Promise<void>;
      };
    };
  }
}

export {};
