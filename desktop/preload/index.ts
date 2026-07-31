import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  platform: 'desktop',

  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    quit: () => ipcRenderer.invoke('app:quit'),
    minimize: () => ipcRenderer.invoke('app:minimize'),
    maximize: () => ipcRenderer.invoke('app:maximize'),
  },

  print: {
    printDocument: (options: unknown) => ipcRenderer.invoke('print:printDocument', options),
    getPrinters: () => ipcRenderer.invoke('print:getPrinters'),
  },

  fs: {
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
    writeFile: (path: string, data: Uint8Array) => ipcRenderer.invoke('fs:writeFile', path, data),
    selectFile: (options?: unknown) => ipcRenderer.invoke('fs:selectFile', options ?? undefined),
  },

  db: {
    query: (sql: string, params?: unknown[]) => ipcRenderer.invoke('db:query', sql, params),
    connect: () => ipcRenderer.invoke('db:connect'),
    disconnect: () => ipcRenderer.invoke('db:disconnect'),
    health: () => ipcRenderer.invoke('db:health'),
    bootstrap: () => ipcRenderer.invoke('db:bootstrap'),
    initialSync: () => ipcRenderer.invoke('db:initial-sync'),
    incrementalSync: () => ipcRenderer.invoke('db:incremental-sync'),
    backup: (destinationPath?: string) => ipcRenderer.invoke('db:backup', destinationPath),
    selectBackupDestination: () => ipcRenderer.invoke('db:select-backup-destination'),
    checkConnectivity: () => ipcRenderer.invoke('db:check-connectivity'),
    listBackups: () => ipcRenderer.invoke('db:list-backups'),
    detect: () => ipcRenderer.invoke('db:detect'),
  },

  auth: {
    localLogin: (phone: string, password: string) => ipcRenderer.invoke('auth:local-login', phone, password),
    offlineStatus: () => ipcRenderer.invoke('auth:offline-status'),
    validateSession: (token: string) => ipcRenderer.invoke('auth:validate-local-session', token),
    createSession: (params: { token: string; identity_id: string; employee_id?: string | null; customer_id?: string | null; identity_type: string; phone: string; password: string; full_name?: string; code?: string }) => ipcRenderer.invoke('auth:create-local-session', params),
    deleteSession: (token: string) => ipcRenderer.invoke('auth:delete-local-session', token),
  },

  connectivity: {
    onChanged: (callback: (online: boolean) => void) => {
      ipcRenderer.on('connectivity:changed', (_event, data) => callback(data.online))
    },
    startMonitor: () => ipcRenderer.invoke('connectivity:start-monitor'),
    stopMonitor: () => ipcRenderer.invoke('connectivity:stop-monitor'),
  },

  update: {
    getState: () => ipcRenderer.invoke('update:get-state'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (callback: (data: {
      status: string
      version?: string
      currentVersion?: string
      message?: string
    }) => void) => {
      ipcRenderer.on('update:status', (_event, data) => callback(data))
    },
    onProgress: (callback: (data: {
      percent: number
      transferred?: number
      total?: number
      bytesPerSecond?: number
    }) => void) => {
      ipcRenderer.on('update:progress', (_event, data) => callback(data))
    },
    onDownloaded: (callback: (data: { version: string; currentVersion: string }) => void) => {
      ipcRenderer.on('update:downloaded', (_event, data) => callback(data))
    },
  },
})
