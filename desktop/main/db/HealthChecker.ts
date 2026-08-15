import {
  detectPostgreSQL,
  PgStatus,
  PgConnection,
  PgHealthCheck,
  checkHealth,
  loadDbConfig,
  ensureDirectories,
  startAhramService,
  ensureSyncMetadataSchema,
} from './PostgreSQLManager.js'
import { initialSync, incrementalSync, processSyncOutbox, getSyncQuarantineStatus } from './InitialSync.js'
import { createBackup, shouldBackup } from './BackupManager.js'
import { resolveSchemaCompatibility } from './SchemaMigrator.js'

export interface DesktopHealthReport {
  postgres: PgStatus
  config: PgConnection | null
  health: PgHealthCheck | null
  ready: boolean
  message: string
  schema?: {
    currentVersion: number
    requiredVersion: number
    status: string
  } | null
  pendingConflicts?: number
  quarantinedTables?: string[]
  quarantinedOutbox?: number
}

export type StatusCallback = (message: string) => void

async function attachRuntimeStatus(config: PgConnection, report: DesktopHealthReport): Promise<void> {
  try {
    await ensureSyncMetadataSchema(config)
  } catch (err: any) {
    console.warn('[Health] ensureSyncMetadataSchema failed:', err.message)
  }
  try {
    const q = await getSyncQuarantineStatus(config)
    report.pendingConflicts = q.pendingConflicts
    report.quarantinedTables = q.quarantinedTables
    report.quarantinedOutbox = q.quarantinedOutbox
  } catch { /* ignore */ }
  try {
    const compat = await resolveSchemaCompatibility(config)
    report.schema = {
      currentVersion: compat.state?.currentVersion ?? 0,
      requiredVersion: compat.state?.requiredVersion ?? 0,
      status: compat.status,
    }
  } catch { /* ignore */ }
}

export async function bootstrapLocalDatabase(onStatus?: StatusCallback): Promise<DesktopHealthReport> {
  ensureDirectories()
  onStatus?.('Checking local database status...')

  const postgres = detectPostgreSQL()

  // Try to load existing config
  let config = await loadDbConfig()
  if (config) {
    onStatus?.('Connecting to local database...')
    const { tryConnect } = await import('./PostgreSQLManager.js')
    const connected = await tryConnect(config)
    if (connected) {
      const health = await checkHealth(config)
      const report: DesktopHealthReport = {
        postgres,
        config,
        health,
        ready: true,
        message: `Local database ready. ${health.tableCount} tables, last sync: ${health.lastSyncAt || 'never'}`,
      }
      await attachRuntimeStatus(config, report)
      return report
    }

    // Config exists but can't connect — try to start service
    if (postgres.serviceName) {
      onStatus?.('Attempting to start PostgreSQL service...')
      const started = await startAhramService()
      if (started) {
        const { tryConnect } = await import('./PostgreSQLManager.js')
        const connected = await tryConnect(config)
        if (connected) {
          const health = await checkHealth(config)
          const report: DesktopHealthReport = {
            postgres,
            config,
            health,
            ready: true,
            message: `Local database ready. ${health.tableCount} tables, last sync: ${health.lastSyncAt || 'never'}`,
          }
          await attachRuntimeStatus(config, report)
          return report
        }
      }
    }

    // Can't connect even after trying to start service
    return {
      postgres,
      config,
      health: null,
      ready: false,
      message: 'Database config exists but PostgreSQL is not responding. Please restart the application or reinstall.',
    }
  }

  // No config found — database was never provisioned
  return {
    postgres,
    config: null,
    health: null,
    ready: false,
    message: 'Database not configured. Please reinstall Ahram ERP to set up the local database.',
  }
}

export async function performInitialSync(
  config: PgConnection,
  onStatus?: StatusCallback
): Promise<{ success: boolean; message: string }> {
  onStatus?.('Starting initial data sync from cloud...')
  const result = await initialSync(config, (progress) => {
    onStatus?.(`Syncing ${progress.table}: ${progress.syncedRows}/${progress.totalRows}`)
  })

  if (result.success) {
    return {
      success: true,
      message: `Sync complete: ${result.tablesSynced} tables, ${result.totalRows} total rows.`,
    }
  }

  return {
    success: false,
    message: `Sync completed with ${result.errors.length} errors. Tables: ${result.tablesSynced}, Rows: ${result.totalRows}. First error: ${result.errors[0]}`,
  }
}

export async function performIncrementalSync(
  config: PgConnection,
  onStatus?: StatusCallback
): Promise<{ success: boolean; message: string }> {
  onStatus?.('Running incremental sync...')
  const result = await incrementalSync(config, (progress) => {
    onStatus?.(`Updated ${progress.table}: ${progress.syncedRows} rows`)
  })

  onStatus?.('Processing offline writes...')
  const outboxResult = await processSyncOutbox(config, (table, count, total) => {
    onStatus?.(`Pushed ${count}/${total}: ${table}`)
  })

  const parts: string[] = []
  if (result.tablesUpdated > 0) parts.push(`${result.tablesUpdated} tables updated`)
  if (outboxResult.processed > 0) parts.push(`${outboxResult.processed} offline writes pushed`)

  const success = result.success && outboxResult.success
  const msg = parts.length > 0 ? parts.join(', ') : 'No changes'

  return {
    success,
    message: success
      ? `Incremental sync complete: ${msg}.`
      : `Sync completed with errors: ${result.errors.length + outboxResult.errors.length} total.`,
  }
}

export async function performBackup(
  config: PgConnection,
  onStatus?: StatusCallback,
  customPath?: string
): Promise<{ success: boolean; message: string }> {
  if (!customPath && !shouldBackup(config)) {
    return { success: true, message: 'Backup not needed yet (less than 24h since last backup).' }
  }

  onStatus?.('Creating automatic backup...')
  const result = await createBackup(config, customPath)

  if (result.success) {
    return {
      success: true,
      message: `Backup created: ${result.filePath} (${(result.size || 0 / 1024).toFixed(1)} KB)`,
    }
  }

  return {
    success: false,
    message: `Backup failed: ${result.error}`,
  }
}
