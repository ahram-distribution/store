import { app, BrowserWindow } from 'electron'
import * as path from 'path'
import { WINDOW_CONFIG, DEV_SERVER_URL } from '../window/index'
import { SECURITY_CONFIG } from './SecurityConfig'
import { getAppURL } from './ProtocolHandler'

export function createMainWindow(): BrowserWindow {
  const isDev = !app.isPackaged
  const preloadPath = path.join(__dirname, '..', 'preload', 'index.js')

  const win = new BrowserWindow({
    ...WINDOW_CONFIG,
    webPreferences: {
      ...SECURITY_CONFIG,
      preload: preloadPath,
      devTools: isDev,
    },
  })

  if (isDev) {
    win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadURL(getAppURL())
  }

  win.once('ready-to-show', () => {
    win.show()
  })

  return win
}
