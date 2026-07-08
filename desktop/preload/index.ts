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
  },
})
