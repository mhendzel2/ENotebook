export {};

declare global {
  interface Window {
    eln?: {
      version?: string;
      saveZip?: (defaultPath: string, data: ArrayBuffer) => Promise<{ canceled: true } | { canceled: false; filePath: string }>;
      openZip?: () => Promise<{ canceled: true } | { canceled: false; filePath: string; data: ArrayBuffer }>;
    };
  }
}
