/// <reference types="vite/client" />

declare global {
  interface Window {
    homeWorkout: {
      history: {
        list(): Promise<unknown>;
        save(session: unknown): Promise<void>;
        summary(): Promise<unknown>;
      };
      camera: {
        ensurePermission(): Promise<unknown>;
      };
      settings: {
        getStartupEnabled(): Promise<boolean>;
        setStartupEnabled(enabled: boolean): Promise<void>;
      };
      notifications: {
        workoutReminder(body: string): Promise<void>;
      };
      app: {
        exit(): Promise<void>;
      };
    };
  }
}

export {};
