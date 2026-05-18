/// <reference types="vite/client" />

declare global {
  interface Window {
    camChad: {
      history: {
        list(): Promise<unknown>;
        save(session: unknown): Promise<void>;
        summary(): Promise<unknown>;
        clear(): Promise<void>;
        merge(sessions: unknown): Promise<unknown>;
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
      windowControls: {
        getState(): Promise<unknown>;
        minimize(): Promise<void>;
        toggleMaximize(): Promise<void>;
        close(): Promise<void>;
        subscribe(listener: (state: unknown) => void): () => void;
      };
      developerTools: {
        savePoseTrace(trace: unknown): Promise<unknown>;
        saveRuntimeBenchmark(report: unknown): Promise<unknown>;
      };
    };
  }
}

export {};
