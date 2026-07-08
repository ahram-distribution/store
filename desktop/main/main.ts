import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './WindowManager'
import { registerLifecycle } from './AppLifecycle'
import { bootstrapIpc } from './ipc/bootstrap'
import { registerPrivilegedSchemes, registerProtocolHandler } from './ProtocolHandler'

let mainWindow: BrowserWindow | null = null

registerPrivilegedSchemes()

app.whenReady().then(() => {
  registerProtocolHandler()
  bootstrapIpc()
  mainWindow = createMainWindow()
  registerLifecycle(() => mainWindow)
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.requestSingleInstanceLock()
