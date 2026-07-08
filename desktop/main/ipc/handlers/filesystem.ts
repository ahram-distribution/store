import { ipcMain, dialog } from 'electron'

export interface FileSelectOptions {
  title?: string
  defaultPath?: string
  filters?: Array<{ name: string; extensions: string[] }>
  multiSelections?: boolean
}

export function registerFileSystemHandlers(): void {
  ipcMain.handle('fs:readFile', async (_event, _path: string): Promise<Uint8Array | null> => {
    return null
  })

  ipcMain.handle('fs:writeFile', async (_event, _path: string, _data: Uint8Array): Promise<boolean> => {
    return false
  })

  ipcMain.handle('fs:selectFile', async (_event, options?: FileSelectOptions): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: options?.title ?? 'Select File',
      defaultPath: options?.defaultPath,
      filters: options?.filters,
      properties: options?.multiSelections ? ['multiSelections', 'openFile'] : ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })
}
