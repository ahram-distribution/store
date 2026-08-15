import { app, BrowserWindow, dialog } from 'electron'
import { createMainWindow } from './WindowManager'
import { registerLifecycle } from './AppLifecycle'
import { bootstrapIpc } from './ipc/bootstrap'
import { registerPrivilegedSchemes, registerProtocolHandler } from './ProtocolHandler'
import { bootstrapLocalDatabase, performInitialSync, performIncrementalSync, performBackup } from './db/HealthChecker.js'
import { resolveSchemaCompatibility, migrateSchema } from './db/SchemaMigrator.js'
import { executeQuery } from './db/index.js'

let mainWindow: BrowserWindow | null = null

registerPrivilegedSchemes()

app.whenReady().then(async () => {
  registerProtocolHandler()
  bootstrapIpc()

  // Initialize local database (auto-provisions bundled PG if needed)
  const result = await bootstrapLocalDatabase()
  console.log('[Main] Local DB result:', JSON.stringify(result))

  if (result.ready && result.config) {
    // --- Schema compatibility gate: must pass before any sync runs ---
    const appVersion = app.getVersion()
    const compat = await resolveSchemaCompatibility(result.config, appVersion)
    console.log('[Main] Schema compatibility:', JSON.stringify(compat))

    if (compat.status === 'schema-newer') {
      console.error('[Main] BLOCKED: local schema is newer than this app supports.')
      await dialog.showMessageBox({
        type: 'error',
        title: 'Schema Incompatible',
        message: 'تحديث قاعدة البيانات لا يتوافق مع هذا الإصدار من التطبيق.',
        detail:
          `Local database schema version ${compat.state?.currentVersion} is newer than what this app version supports ` +
          `(max ${compat.state?.manifest.schemaVersion}). Install the matching version of Ahram ERP before continuing.\n\n` +
          (compat.detail || ''),
      })
      app.quit()
      return
    }

    if (compat.status === 'needs-migration') {
      console.log('[Main] Schema migration required. Creating safety backup first...')
      try {
        const backup = await performBackup(result.config)
        console.log('[Main] Pre-migration backup:', backup.message)
      } catch (e: any) {
        console.warn('[Main] Pre-migration backup failed (continuing):', e.message)
      }

      const migrateRes = await migrateSchema(result.config, appVersion)
      if (!migrateRes.success) {
        console.error('[Main] BLOCKED: schema migration failed.', migrateRes.error)
        await dialog.showMessageBox({
          type: 'error',
          title: 'Schema Migration Failed',
          message: 'فشل تحديث قاعدة البيانات المحلية.',
          detail:
            `Migration ${migrateRes.failed?.version} (${migrateRes.failed?.file}) failed and was rolled back.\n\n` +
            `${migrateRes.error}\n\n` +
            `The application will not start to protect your data. Restart the app to retry.`,
        })
        app.quit()
        return
      }
      console.log('[Main] Schema migration applied:', migrateRes.applied.map(m => `v${m.version}`).join(', ') || '(none)')
    }

    // Check if sync has ever run
    let needsInitialSync = true
    try {
      const syncRes = await executeQuery(result.config,
        'SELECT COUNT(*) AS cnt FROM sync_metadata WHERE sync_status = $1', ['done']
      )
      needsInitialSync = parseInt(syncRes.rows[0]?.cnt as string || '0') === 0
    } catch { /* sync_metadata may not exist yet; fresh install */ }

    let syncOk = false
    if (needsInitialSync) {
      console.log('[Main] Running initial sync (fresh database)...')
      const syncResult = await performInitialSync(result.config)
      syncOk = syncResult.success
      if (syncOk) {
        console.log('[Main] Initial sync complete:', syncResult.message)
        // Mark OFFLINE_READY
        try {
          await executeQuery(result.config,
            `INSERT INTO app.app_settings (key, value, description, created_at, updated_at)
             VALUES ($1, $2::jsonb, $3, now(), now())
             ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
            ['offline_ready', JSON.stringify(true), 'Desktop is fully synced and ready for offline operation']
          )
        } catch (e: any) {
          console.warn('[Main] Failed to set OFFLINE_READY flag:', e.message)
        }
      } else {
        console.warn('[Main] Initial sync had errors:', syncResult.message)
      }
    } else {
      console.log('[Main] Running incremental sync...')
      const syncResult = await performIncrementalSync(result.config)
      syncOk = syncResult.success
      if (syncOk) {
        console.log('[Main] Incremental sync complete:', syncResult.message)
      } else {
        console.warn('[Main] Incremental sync had errors:', syncResult.message)
      }
    }

    console.log('[Main] Local database ready, sync OK:', syncOk)

    // Start connectivity monitor for auto-sync
    try {
      const { startConnectivityMonitor } = await import('./db/ConnectivityMonitor.js')
      startConnectivityMonitor()
      console.log('[Main] Connectivity monitor started')
    } catch (e: any) {
      console.warn('[Main] Failed to start connectivity monitor:', e.message)
    }
  } else if (result.ready && !result.config) {
    console.warn('[Main] DB ready but no config — will try again at runtime')
  } else {
    console.warn('[Main] Local database not available:', result.message)
    await dialog.showMessageBox({
      type: 'error',
      title: 'Local Database Setup Failed',
      message: 'The local database could not be set up.',
      detail: `${result.message}\n\nCheck %ProgramData%\\ahram-desktop\\logs\\provision.log for details.\n\nThe application will continue without offline database support.`,
    })
  }

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
