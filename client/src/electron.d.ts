export interface ElectronAPI {
  platform: string;
  isElectron: boolean;
  send: (channel: string, data?: any) => void;
  on: (channel: string, func: (...args: any[]) => void) => void;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  toggleFloatingMode?: (enable?: boolean) => Promise<{ isFloating: boolean; isProtected: boolean }>;
  setContentProtection?: (enable: boolean) => Promise<boolean>;
  getStealthStatus?: () => Promise<{ isElectron: boolean; isFloating: boolean; isProtected: boolean; isAlwaysOnTop: boolean }>;
  setWindowOpacity?: (opacity: number) => Promise<number>;
  captureScreenshot?: () => Promise<boolean>;
  setOverlayCollapsed?: (collapsed: boolean) => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
