// Minimal typings for the Samsung/Tizen TV APIs this app touches.
declare namespace tizen {
  const tvinputdevice: {
    registerKey(name: string): void;
    registerKeyBatch(names: string[]): void;
  } | undefined;
  const application: {
    getCurrentApplication(): { exit(): void };
  };
}

declare namespace webapis {
  const appcommon: {
    AppCommonScreenSaverState: { SCREEN_SAVER_ON: number; SCREEN_SAVER_OFF: number };
    setScreenSaver(state: number): void;
  };
}
