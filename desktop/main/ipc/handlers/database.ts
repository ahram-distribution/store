import { ipcMain, dialog } from 'electron'
import { Client } from 'pg'
import {
  executeQuery,
  loadDbConfig,
  PgConnection,
} from '../../db/index.js'
import { getSupabaseConfig } from '../../config/supabase.js'

export interface QueryResult {
  rows: Record<string, unknown>[]
  rowCount: number
  fields: Array<{ name: string; dataType: string }>
}

let activeConnection: PgConnection | null = null
let configPromise: Promise<PgConnection | null> | null = null
let syncInProgress = false

async function getConfig(): Promise<PgConnection | null> {
  if (activeConnection) return activeConnection
  if (!configPromise) {
    configPromise = loadDbConfig().then(config => {
      activeConnection = config
      return config
    })
  }
  return configPromise
}

export function registerDatabaseHandlers(): void {
  ipcMain.handle('db:query', async (_event, sql: string, params?: unknown[]): Promise<QueryResult> => {
    const config = await getConfig()
    if (!config) {
      return { rows: [], rowCount: 0, fields: [] }
    }

    try {
      return await executeQuery(config, sql, params)
    } catch (err: any) {
      console.error('db:query error:', err.message)
      return { rows: [], rowCount: 0, fields: [] }
    }
  })

  ipcMain.handle('db:connect', async (): Promise<boolean> => {
    const config = await getConfig()
    if (!config) return false

    try {
      const { tryConnect } = await import('../../db/index.js')
      return await tryConnect(config)
    } catch {
      return false
    }
  })

  ipcMain.handle('db:disconnect', async (): Promise<boolean> => {
    activeConnection = null
    return true
  })

  ipcMain.handle('db:health', async () => {
    const config = await getConfig()
    if (!config) return { healthy: false, error: 'No config' }

    try {
      const { checkHealth } = await import('../../db/index.js')
      const health = await checkHealth(config)

      // Enrich with offline_ready flag
      try {
        const ar = await executeQuery(config,
          `SELECT value FROM app.app_settings WHERE key = 'offline_ready'`
        )
        const raw = ar.rows[0]?.value
        health.offlineReady = raw === true || raw === 'true' || JSON.stringify(raw) === 'true'
      } catch {
        health.offlineReady = false
      }

      return health
    } catch (err: any) {
      return { healthy: false, error: err.message }
    }
  })

  ipcMain.handle('auth:offline-status', async (): Promise<{
    healthy: boolean
    offlineReady: boolean
    lastSyncAt: string | null
    syncing: boolean
    error?: string
  }> => {
    const config = await getConfig()
    if (!config) return { healthy: false, offlineReady: false, lastSyncAt: null, syncing: false, error: 'No database config' }

    try {
      const { checkHealth } = await import('../../db/index.js')
      const health = await checkHealth(config)

      let offlineReady = false
      try {
        const ar = await executeQuery(config,
          `SELECT value FROM app.app_settings WHERE key = 'offline_ready'`
        )
        const raw = ar.rows[0]?.value
        offlineReady = raw === true || raw === 'true' || JSON.stringify(raw) === 'true'
      } catch { /* app_settings may not exist */ }

      // Check if initial sync is still running
      let syncing = false
      try {
        const sr = await executeQuery(config,
          `SELECT COUNT(*) AS cnt FROM sync_metadata WHERE sync_status = 'syncing'`
        )
        syncing = parseInt(sr.rows[0]?.cnt as string || '0') > 0
      } catch { /* sync_metadata may not exist */ }

      return {
        healthy: health.healthy,
        offlineReady,
        lastSyncAt: health.lastSyncAt,
        syncing,
      }
    } catch (err: any) {
      return { healthy: false, offlineReady: false, lastSyncAt: null, syncing: false, error: err.message }
    }
  })

  ipcMain.handle('db:bootstrap', async () => {
    const { bootstrapLocalDatabase } = await import('../../db/index.js')
    return await bootstrapLocalDatabase()
  })

  ipcMain.handle('db:initial-sync', async () => {
    const config = await getConfig()
    if (!config) return { success: false, message: 'No database config' }

    const { performInitialSync } = await import('../../db/index.js')
    return await performInitialSync(config)
  })

  ipcMain.handle('db:incremental-sync', async () => {
    const config = await getConfig()
    if (!config) return { success: false, message: 'No database config' }

    // Prevent concurrent sync operations
    if (syncInProgress) {
      return { success: false, message: 'Sync already in progress' }
    }
    syncInProgress = true
    try {
      const { performIncrementalSync } = await import('../../db/index.js')
      return await performIncrementalSync(config)
    } finally {
      syncInProgress = false
    }
  })

  ipcMain.handle('connectivity:start-monitor', async () => {
    const { startConnectivityMonitor, stopConnectivityMonitor } = await import('../../db/ConnectivityMonitor.js')
    startConnectivityMonitor()
    return { started: true }
  })

  ipcMain.handle('connectivity:stop-monitor', async () => {
    const { stopConnectivityMonitor } = await import('../../db/ConnectivityMonitor.js')
    stopConnectivityMonitor()
    return { stopped: true }
  })

  ipcMain.handle('db:backup', async (_event, destinationPath?: string) => {
    const config = await getConfig()
    if (!config) return { success: false, message: 'No database config' }

    const { performBackup } = await import('../../db/index.js')
    const result = await performBackup(config, undefined, destinationPath)

    // Verify the backup file exists and is non-empty on success
    if (result.success && destinationPath) {
      const { existsSync, statSync } = await import('fs')
      if (!existsSync(destinationPath) || statSync(destinationPath).size === 0) {
        return { success: false, message: 'Backup file was not created or is empty' }
      }
    }

    return result
  })

  ipcMain.handle('db:select-backup-destination', async () => {
    const result = await dialog.showSaveDialog({
      title: 'اختر موقع النسخة الاحتياطية',
      defaultPath: `AhramERP_Backup_${new Date().toISOString().slice(0, 10)}.backup`,
      filters: [
        { name: 'PostgreSQL Backup', extensions: ['backup', 'sql', 'dump'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['createDirectory'],
    })
    if (result.canceled || !result.filePath) {
      return { canceled: true, filePath: null }
    }
    return { canceled: false, filePath: result.filePath }
  })

  ipcMain.handle('db:check-connectivity', async (): Promise<{
    networkAvailable: boolean
    supabaseReachable: boolean
    localDbAvailable: boolean
    lastSyncAt: string | null
    error?: string
  }> => {
    const result = {
      networkAvailable: false,
      supabaseReachable: false,
      localDbAvailable: false,
      lastSyncAt: null as string | null,
    }

    // 1. Check network interface and basic connectivity
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 3000)
      const netResp = await fetch('https://clients3.google.com/generate_204', {
        signal: ctrl.signal,
        mode: 'no-cors',
      })
      clearTimeout(timer)
      result.networkAvailable = true
    } catch {
      result.networkAvailable = false
    }

    // 2. Check Supabase reachability via sync gateway RPC
    try {
      const { url: supabaseUrl, anonKey } = getSupabaseConfig()
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 5000)
      const supRes = await fetch(`${supabaseUrl}/rest/v1/rpc/sync_get_table_allowlist`, {
        signal: ctrl.signal,
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      clearTimeout(timer)
      result.supabaseReachable = supRes.ok
    } catch {
      result.supabaseReachable = false
    }

    // 3. Check Local PostgreSQL
    try {
      const config = await getConfig()
      if (config) {
        const client = new Client({
          host: config.host,
          port: config.port,
          database: config.database,
          user: config.user,
          password: config.password,
          connectionTimeoutMillis: 3000,
        })
        await client.connect()
        const healthRes = await client.query('SELECT 1 AS ok')
        result.localDbAvailable = healthRes.rows[0]?.ok === 1

        // Also fetch last sync time
        try {
          const syncRes = await client.query(
            'SELECT last_sync_at FROM sync_metadata ORDER BY last_sync_at DESC LIMIT 1'
          )
          if (syncRes.rows.length > 0) {
            result.lastSyncAt = syncRes.rows[0].last_sync_at
          }
        } catch { /* sync_metadata may not exist */ }

        await client.end()
      }
    } catch {
      result.localDbAvailable = false
    }

    return result
  })

  ipcMain.handle('db:list-backups', async () => {
    try {
      const { listBackups } = await import('../../db/index.js')
      return listBackups()
    } catch {
      return []
    }
  })

  ipcMain.handle('db:detect', async () => {
    try {
      const { detectPostgreSQL } = await import('../../db/index.js')
      return detectPostgreSQL()
    } catch {
      return { installed: false, serviceRunning: false, serviceName: null, version: null, port: 5432, dataDir: null }
    }
  })

  ipcMain.handle('auth:local-login', async (_event, phone: string, password: string): Promise<{
    success: boolean
    token?: string
    identity_id?: string
    identity_type?: 'employee' | 'customer'
    employee?: { id: string; full_name: string; code: string; manager_id: string | null }
    customer?: { id: string; company_name: string; code: string }
    roles?: string[]
    expires_at?: string
    error?: string
  }> => {
    const config = await getConfig()
    if (!config) return { success: false, error: 'No database config' }

    try {
      const result = await executeQuery(config, 'SELECT public.login($1, $2) AS r', [phone, password])
      const row = result.rows[0]
      if (!row) return { success: false, error: 'INVALID_CREDENTIALS' }

      const loginResult = typeof row.r === 'string' ? JSON.parse(row.r) : row.r
      if (!loginResult || loginResult.error) {
        return { success: false, error: loginResult?.error || 'INVALID_CREDENTIALS' }
      }

      const token = loginResult.token
      const identityId = loginResult.identity_id
      const employeeId = loginResult.employee_id

      // Enrich with employee details
      let employee: { id: string; full_name: string; code: string; manager_id: string | null } | undefined
      let roles: string[] = []

      if (employeeId) {
        const empRes = await executeQuery(config,
          'SELECT id, full_name, code, manager_id FROM public.employees WHERE id = $1::uuid', [employeeId]
        )
        if (empRes.rows.length > 0) {
          const e = empRes.rows[0]
          employee = { id: e.id as string, full_name: e.full_name as string, code: e.code as string, manager_id: e.manager_id as string | null }
        }
        const roleRes = await executeQuery(config,
          `SELECT r.name FROM public.roles r
           JOIN public.employee_roles er ON er.role_id = r.id
           WHERE er.employee_id = $1::uuid`, [employeeId]
        )
        roles = roleRes.rows.map((r: any) => r.name as string)
      }

      return {
        success: true,
        token,
        identity_id: identityId,
        identity_type: employeeId ? 'employee' : 'customer',
        employee,
        roles,
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('auth:validate-local-session', async (_event, token: string): Promise<{
    valid: boolean
    identity_id?: string
    identity_type?: string
    employee_id?: string
    customer_id?: string
    full_name?: string
    code?: string
    roles?: string[]
    expires_at?: string
    error?: string
  }> => {
    const config = await getConfig()
    if (!config) return { valid: false, error: 'No database config' }

    try {
      const result = await executeQuery(config, 'SELECT validate_session($1::uuid)', [token])
      const row = result.rows[0]
      if (!row) return { valid: false }

      const sessionData = typeof row.validate_session === 'string'
        ? JSON.parse(row.validate_session)
        : row.validate_session

      if (sessionData.error) return { valid: false }

      // Enrich with roles
      let roles: string[] = []
      if (sessionData.session?.employee_id) {
        try {
          const roleRes = await executeQuery(config,
            `SELECT r.name FROM public.roles r
             JOIN public.employee_roles er ON er.role_id = r.id
             WHERE er.employee_id = $1::uuid`, [sessionData.session.employee_id]
          )
          roles = roleRes.rows.map((r: any) => r.name as string)
        } catch { /* roles are optional */ }
      }

      return {
        valid: true,
        identity_id: sessionData.session?.identity_id,
        identity_type: sessionData.session?.identity_type,
        employee_id: sessionData.session?.employee_id,
        full_name: sessionData.employee?.full_name,
        roles,
        code: sessionData.employee?.code || '',
      }
    } catch (err: any) {
      return { valid: false, error: err.message }
    }
  })

  ipcMain.handle('auth:create-local-session', async (_event, params: {
    token: string
    identity_id: string
    employee_id?: string | null
    customer_id?: string | null
    identity_type: string
    phone: string
    password: string
    full_name?: string
    code?: string
  }): Promise<{ success: boolean; error?: string }> => {
    const config = await getConfig()
    if (!config) return { success: false, error: 'No database config' }

    const { Client } = require('pg')
    const client = new Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      connectionTimeoutMillis: 5000,
    })

    try {
      await client.connect()
      await client.query('BEGIN')

      // 1. Bootstrap identity with password_hash for offline auth
      await client.query(
        `INSERT INTO public.identities (id, phone, identity_type, is_active, password_hash)
         VALUES ($1::uuid, $2, $3::text::identity_type, true, crypt($4, gen_salt('bf')))
         ON CONFLICT (id) DO UPDATE SET
           phone = EXCLUDED.phone,
           identity_type = EXCLUDED.identity_type,
           is_active = true,
           password_hash = COALESCE(public.identities.password_hash, crypt($4, gen_salt('bf')))`,
        [params.identity_id, params.phone, params.identity_type, params.password]
      )

      // 2. Bootstrap employee (if employee login)
      if (params.identity_type === 'employee' && params.employee_id) {
        await client.query(
          `INSERT INTO public.employees (id, identity_id, full_name, code, manager_id, is_active)
           VALUES ($1::uuid, $2::uuid, $3, $4, NULL, true)
           ON CONFLICT (id) DO UPDATE SET
             identity_id = EXCLUDED.identity_id,
             full_name = EXCLUDED.full_name,
             code = EXCLUDED.code,
             is_active = true`,
          [params.employee_id, params.identity_id, params.full_name || null, params.code || null]
        )
      }

      // 3. Bootstrap customer (if customer login)
      if (params.identity_type === 'customer' && params.customer_id) {
        await client.query(
          `INSERT INTO public.customers (id, identity_id, company_name, code, is_active)
           VALUES ($1::uuid, $2::uuid, $3, $4, true)
           ON CONFLICT (id) DO UPDATE SET
             identity_id = EXCLUDED.identity_id,
             company_name = EXCLUDED.company_name,
             code = EXCLUDED.code,
             is_active = true`,
          [params.customer_id, params.identity_id, params.full_name || null, params.code || null]
        )
      }

      // 4. Create local session
      await client.query(
        `INSERT INTO app.sessions (token, identity_id, employee_id, customer_id, identity_type, created_at, expires_at, last_active_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text::identity_type, now(), now() + interval '30 days', now())
         ON CONFLICT (token) DO UPDATE SET
           identity_id = EXCLUDED.identity_id,
           employee_id = EXCLUDED.employee_id,
           customer_id = EXCLUDED.customer_id,
           identity_type = EXCLUDED.identity_type,
           expires_at = now() + interval '30 days',
           last_active_at = now()`,
        [params.token, params.identity_id, params.employee_id || null, params.customer_id || null, params.identity_type]
      )

      await client.query('COMMIT')
      return { success: true }
    } catch (err: any) {
      try { await client.query('ROLLBACK') } catch { /* best-effort rollback on failed BEGIN */ }
      const stage = (err.message || '').includes('identity') ? 'identity'
        : (err.message || '').includes('employee') ? 'employee'
        : (err.message || '').includes('customer') ? 'customer'
        : (err.message || '').includes('sessions') ? 'session' : 'unknown'
      console.error(`[bootstrap] Stage ${stage} failed: ${err.message}`)
      return { success: false, error: `Bootstrap failed at ${stage} stage` }
    } finally {
      try { await client.end() } catch { /* ignore */ }
    }
  })

  ipcMain.handle('auth:delete-local-session', async (_event, token: string): Promise<{ success: boolean; error?: string }> => {
    const config = await getConfig()
    if (!config) return { success: false, error: 'No database config' }

    try {
      await executeQuery(config, 'DELETE FROM app.sessions WHERE token = $1::uuid', [token])
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })
}