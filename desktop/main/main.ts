import { app, BrowserWindow, dialog } from 'electron'
import { createMainWindow } from './WindowManager'
import { registerLifecycle } from './AppLifecycle'
import { bootstrapIpc } from './ipc/bootstrap'
import { registerPrivilegedSchemes, registerProtocolHandler } from './ProtocolHandler'
import { bootstrapLocalDatabase, performInitialSync, performIncrementalSync, performBackup } from './db/HealthChecker.js'
import { resolveSchemaCompatibility, migrateSchema, verifyCriticalFunctions } from './db/SchemaMigrator.js'
import { requiredCriticalFunctions } from './db/schemaManifest.js'
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

      // --- Post-migration READY gate ---
      // The existing offline_ready flag was computed against the OLD schema.
      // Invalidate it and mark the local sync state as requiring a fresh full
      // synchronization, so previously-'done' sync_metadata rows can never
      // satisfy the READY gate across a schema migration.
      try {
        await executeQuery(result.config,
          `DELETE FROM app.app_settings WHERE key = $1`,
          ['offline_ready']
        )
        await executeQuery(result.config,
          `INSERT INTO app.app_settings (key, value, description, created_at, updated_at)
           VALUES ($1, $2::jsonb, $3, now(), now())
           ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
          ['sync_requires_full_refresh', JSON.stringify(true), 'Schema migration applied — full sync required before offline READY']
        )
        console.log('[Main] Post-migration READY gate: offline_ready invalidated, full sync required')
      } catch (e: any) {
        console.warn('[Main] Failed to set post-migration sync gate:', e.message)
      }
    }

    // --- Critical RPC verification: the local schema must expose the RPC
    // surface the renderer calls, otherwise screens break even though the
    // schema version number is sufficient. Runs after migration AND on every
    // subsequent startup; blocks READY until the DB satisfies it. ---
    const criticalVerification = await verifyCriticalFunctions(
      result.config,
      requiredCriticalFunctions(appVersion)
    )
    if (!criticalVerification.ok) {
      console.error('[Main] BLOCKED: critical RPC verification failed.',
        JSON.stringify(criticalVerification.missing))
      await dialog.showMessageBox({
        type: 'error',
        title: 'Critical RPC Missing',
        message: 'وظائف أساسية مفقودة في قاعدة البيانات المحلية.',
        detail:
          `The local database is missing functions the app requires:\n\n` +
          criticalVerification.missing
            .map(m => `- ${m.name}(${m.expectedArgs.join(', ')})`)
            .join('\n') +
          `\n\nRestart the app to re-verify.`,
      })
      app.quit()
      return
    }
    console.log('[Main] Critical RPC verification: OK',
      `(${requiredCriticalFunctions(appVersion).length} functions checked)`)

    // Check if sync has ever run. A pending post-migration refresh marker
    // (set in the migration-success path above) forces a fresh full sync
    // regardless of any previously-'done' sync_metadata rows: after a schema
    // migration the old sync state must not be trusted as proof of data parity.
    let needsInitialSync = true
    try {
      const [syncRes, gateRes] = await Promise.all([
        executeQuery(result.config,
          'SELECT COUNT(*) AS cnt FROM sync_metadata WHERE sync_status = $1', ['done']
        ),
        executeQuery(result.config,
          'SELECT 1 FROM app.app_settings WHERE key = $1', ['sync_requires_full_refresh']
        ),
      ])
      const refreshPending = (gateRes.rows?.length ?? 0) > 0
      const doneCount = parseInt(syncRes.rows[0]?.cnt as string || '0')
      needsInitialSync = refreshPending || doneCount === 0
    } catch { /* sync_metadata may not exist yet; fresh install */ }

    let syncOk = false
    if (needsInitialSync) {
      console.log('[Main] Running initial sync (fresh database)...')
      const syncResult = await performInitialSync(result.config)
      syncOk = syncResult.success
      if (syncOk) {
        console.log('[Main] Initial sync complete:', syncResult.message)
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

    // --- Parity gate ---
    // OFFLINE_READY is only granted once synchronization has actually
    // converged: no pending conflicts, no quarantined outbox records, no
    // quarantined tables. Anything outstanding means local != remote and the
    // app stays out of READY until a later sync reconciles it.
    let cleanParity = false
    try {
      const { getSyncQuarantineStatus } = await import('./db/InitialSync.js')
      const q = await getSyncQuarantineStatus(result.config)
      cleanParity = q.pendingConflicts === 0 && q.quarantinedTables.length === 0 && q.quarantinedOutbox === 0
      if (!cleanParity) {
        console.warn(`[Main] Parity gate: ${q.pendingConflicts} conflict(s), ${q.quarantinedOutbox} quarantined record(s), ${q.quarantinedTables.length} quarantined table(s) — offline READY withheld`)
      }
    } catch (e: any) {
      console.warn('[Main] Parity gate check failed:', e.message)
    }

    if (syncOk && cleanParity) {
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
      // Clear the post-migration refresh marker now that data parity is
      // restored. Harmless no-op when no migration ran.
      try {
        await executeQuery(result.config,
          `DELETE FROM app.app_settings WHERE key = $1`,
          ['sync_requires_full_refresh']
        )
      } catch (e: any) {
        console.warn('[Main] Failed to clear post-migration sync gate:', e.message)
      }
    } else if (syncOk && !cleanParity) {
      console.warn('[Main] Sync succeeded but local/remote parity is not yet converged — offline READY withheld')
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
