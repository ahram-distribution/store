/// <reference types="vite/client" />

declare const __BUILD_ID__: string
declare const __COMMIT_HASH__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_APP_NAME: string
  readonly VITE_APP_VERSION: string
  readonly VITE_WHATSAPP_NUMBER: string
  readonly VITE_WHATSAPP_NUMBER_2?: string
  readonly VITE_SALES_PHONE_1?: string
  readonly VITE_SALES_PHONE_2?: string
  readonly VITE_SUPPORT_PHONE?: string
  readonly VITE_FACEBOOK_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  api?: {
    platform?: string
    app?: {
      getVersion: () => Promise<string>
      quit: () => Promise<void>
      minimize: () => Promise<void>
      maximize: () => Promise<void>
    }
    db?: {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>
      connect: () => Promise<unknown>
      disconnect: () => Promise<unknown>
      health: () => Promise<unknown>
      bootstrap: () => Promise<unknown>
      initialSync: () => Promise<unknown>
      incrementalSync: () => Promise<unknown>
      backup: (destinationPath?: string) => Promise<unknown>
      selectBackupDestination: () => Promise<unknown>
      checkConnectivity: () => Promise<unknown>
      listBackups: () => Promise<unknown>
      detect: () => Promise<unknown>
    }
    update?: {
      getState: () => Promise<{ isPackaged: boolean; version: string; checking: boolean; downloading: boolean }>
      check: () => Promise<{ success: boolean; message?: string; updateAvailable?: boolean; version?: string; currentVersion?: string }>
      download: () => Promise<{ success: boolean; message?: string }>
      install: () => Promise<{ success: boolean }>
      onStatus: (callback: (data: { status: string; version?: string; currentVersion?: string; message?: string }) => void) => void
      onProgress: (callback: (data: { percent: number; transferred?: number; total?: number; bytesPerSecond?: number }) => void) => void
      onDownloaded: (callback: (data: { version: string; currentVersion: string }) => void) => void
    }
  }
}
