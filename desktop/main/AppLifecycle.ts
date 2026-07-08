import { app, BrowserWindow } from 'electron'

export function registerLifecycle(win: () => BrowserWindow | null): void {
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      win()
    }
  })

  app.on('before-quit', () => {
    const w = win()
    if (w && !w.isDestroyed()) {
      w.destroy()
    }
  })
}
