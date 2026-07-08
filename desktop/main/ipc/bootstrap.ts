import { ipcMain, app, BrowserWindow } from 'electron'
import { registerPrintHandlers } from './handlers/printing'
import { registerFileSystemHandlers } from './handlers/filesystem'
import { registerDatabaseHandlers } from './handlers/database'

export function bootstrapIpc(): void {
  registerPrintHandlers()
  registerFileSystemHandlers()
  registerDatabaseHandlers()

  ipcMain.handle('app:getVersion', () => {
    return app.getVersion()
  })

  ipcMain.handle('app:quit', () => {
    app.quit()
  })

  ipcMain.handle('app:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.minimize()
  })

  ipcMain.handle('app:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.handle('app:getPlatform', () => {
    return process.platform
  })
}
