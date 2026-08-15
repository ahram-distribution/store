import { ipcMain, app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

let initialized = false
let checking = false
let downloading = false

function notifyWindows(channel: string, data: Record<string, unknown>): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  })
}

function ensureAutoUpdater(): void {
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.allowDowngrade = false

  autoUpdater.on('checking-for-update', () => {
    notifyWindows('update:status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    notifyWindows('update:status', {
      status: 'available',
      version: info.version,
      currentVersion: app.getVersion(),
    })
  })

  autoUpdater.on('update-not-available', () => {
    notifyWindows('update:status', {
      status: 'not-available',
      currentVersion: app.getVersion(),
    })
  })

  autoUpdater.on('error', (err) => {
    checking = false
    downloading = false
    notifyWindows('update:status', {
      status: 'error',
      message: err.message,
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    notifyWindows('update:progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    checking = false
    downloading = false
    notifyWindows('update:downloaded', {
      version: info.version,
      currentVersion: app.getVersion(),
    })
  })
}

export function registerUpdaterHandlers(): void {
  ensureAutoUpdater()

  ipcMain.handle('update:get-state', () => {
    return {
      isPackaged: app.isPackaged,
      version: app.getVersion(),
      checking,
      downloading,
    }
  })

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      return {
        success: false,
        message: 'Update checks are only available in the packaged application.',
      }
    }
    if (checking || downloading) {
      return {
        success: false,
        message: checking ? 'An update check is already in progress.' : 'An update download is already in progress.',
      }
    }
    checking = true
    try {
      const result = await autoUpdater.checkForUpdates()
      checking = false
      if (!result || !result.updateInfo) {
        return { success: true, updateAvailable: false, currentVersion: app.getVersion() }
      }
      return {
        success: true,
        updateAvailable: result.isUpdateAvailable ?? false,
        version: result.updateInfo.version,
        currentVersion: app.getVersion(),
      }
    } catch (err: any) {
      checking = false
      return {
        success: false,
        message: err?.message ?? 'Failed to check for updates.',
      }
    }
  })

  ipcMain.handle('update:download', async () => {
    if (!app.isPackaged) {
      return { success: false, message: 'Updates are only available in the packaged application.' }
    }
    if (downloading) {
      return { success: false, message: 'An update download is already in progress.' }
    }
    downloading = true
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err: any) {
      downloading = false
      return { success: false, message: err?.message ?? 'Failed to download the update.' }
    }
  })

  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall(false, true)
    return { success: true }
  })
}
