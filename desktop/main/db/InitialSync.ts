import { Client } from 'pg'
import { PgConnection } from './PostgreSQLManager'
import { getSupabaseConfig } from '../config/supabase'

let _supabaseUrl = ''
let _supabaseKey = ''

function ensureSupabaseConfig(serviceRoleKey?: string): void {
  if (!_supabaseUrl && !_supabaseKey) {
    const cfg = getSupabaseConfig()
    if (cfg) {
      _supabaseUrl = cfg.url
      _supabaseKey = cfg.anonKey
    }
  }
  if (!_supabaseUrl || !_supabaseKey) {
    throw new Error(
      'Supabase is not configured. The application will operate using local data only. ' +
      'To enable synchronization, set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
      'in .env.local or as environment variables, or place supabase.json in resources/.'
    )
  }
}

interface SyncProgress {
  table: string
  totalRows: number
  syncedRows: number
  status: 'syncing' | 'done' | 'error'
  error?: string
}

type ProgressCallback = (progress: SyncProgress) => void

const SYNC_TABLES: Array<{
  name: string
  schema: string
}> = [
  { name: 'identities', schema: 'public' },
  { name: 'employees', schema: 'public' },
  { name: 'roles', schema: 'public' },
  { name: 'capabilities', schema: 'public' },
  { name: 'employee_roles', schema: 'public' },
  { name: 'role_capabilities', schema: 'public' },
  { name: 'employee_capabilities', schema: 'public' },
  { name: 'code_sequences', schema: 'public' },
  { name: 'customers', schema: 'public' },
  { name: 'customer_addresses', schema: 'public' },
  { name: 'customer_contacts', schema: 'public' },
  { name: 'customer_credit_accounts', schema: 'public' },
  { name: 'customer_ownership_history', schema: 'public' },
  { name: 'products', schema: 'public' },
  { name: 'product_units', schema: 'public' },
  { name: 'companies', schema: 'public' },
  { name: 'orders', schema: 'public' },
  { name: 'order_items', schema: 'public' },
  { name: 'order_status_history', schema: 'public' },
  { name: 'order_modification_history', schema: 'public' },
  { name: 'order_daily_deals', schema: 'public' },
  { name: 'order_flash_offers', schema: 'public' },
  { name: 'visits', schema: 'public' },
  { name: 'visit_links', schema: 'public' },
  { name: 'unified_locations', schema: 'public' },
  { name: 'location_overrides', schema: 'public' },
  { name: 'collections', schema: 'public' },
  { name: 'returns', schema: 'public' },
  { name: 'return_items', schema: 'public' },
  { name: 'return_inspection', schema: 'public' },
  { name: 'return_status_history', schema: 'public' },
  { name: 'inventory', schema: 'public' },
  { name: 'workday_sessions', schema: 'public' },
  { name: 'workday_breaks', schema: 'public' },
  { name: 'workday_settings', schema: 'public' },
  { name: 'attendance_audit_log', schema: 'public' },
  { name: 'employee_work_policies', schema: 'public' },
  { name: 'notifications', schema: 'public' },
  { name: 'push_subscriptions', schema: 'public' },
  { name: 'employee_entity_views', schema: 'public' },
  { name: 'employee_baselines', schema: 'public' },
  { name: 'employee_weight_overrides', schema: 'public' },
  { name: 'employee_advances', schema: 'public' },
  { name: 'employee_monthly_targets', schema: 'public' },
  { name: 'company_monthly_targets', schema: 'public' },
  { name: 'performance_weights_config', schema: 'public' },
  { name: 'credit_invoices', schema: 'public' },
  { name: 'credit_invoice_cheques', schema: 'public' },
  { name: 'credit_applications', schema: 'public' },
  { name: 'credit_programs', schema: 'public' },
  { name: 'credit_contracts', schema: 'public' },
  { name: 'credit_contract_templates', schema: 'public' },
  { name: 'customer_credit_ledger', schema: 'public' },
  { name: 'treasury_transactions', schema: 'public' },
  { name: 'reference_governorates', schema: 'public' },
  { name: 'reference_cities', schema: 'public' },
  { name: 'expenses', schema: 'public' },
  { name: 'external_carriers', schema: 'public' },
  { name: 'system_modules', schema: 'public' },
  { name: 'owner_decisions', schema: 'public' },
  { name: 'daily_deals', schema: 'public' },
  { name: 'daily_deal_items', schema: 'public' },
  { name: 'flash_offers', schema: 'public' },
  { name: 'flash_offer_items', schema: 'public' },
  { name: 'tiers', schema: 'public' },
  { name: 'tier_company_exceptions', schema: 'public' },
  { name: 'tier_product_exceptions', schema: 'public' },
  { name: 'tier_exceptions', schema: 'public' },
  { name: 'auctions', schema: 'public' },
  { name: 'auction_items', schema: 'public' },
  { name: 'auction_bids', schema: 'public' },
  { name: 'preparation_records', schema: 'public' },
  { name: 'preparation_exceptions', schema: 'public' },
  { name: 'delivery_tracking', schema: 'public' },
  { name: 'tracking_points', schema: 'public' },
  { name: 'tracking_cleanup_log', schema: 'public' },
  { name: 'session_recovery_log', schema: 'public' },
  { name: 'deletion_audit_log', schema: 'public' },
  { name: 'gps_test_points', schema: 'public' },
]

function buildHeaders(): Record<string, string> {
  return {
    apikey: _supabaseKey,
    Authorization: `Bearer ${_supabaseKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

async function rpcCall(name: string, params: Record<string, unknown>): Promise<any> {
  const url = `${_supabaseUrl}/rest/v1/rpc/${name}`
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(params),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`RPC ${name} failed (HTTP ${res.status}): ${text}`)
  }
  return res.json()
}

async function verifySupabaseAccess(): Promise<void> {
  const result = await rpcCall('sync_get_table_allowlist', {})
  if (!Array.isArray(result) || result.length < 10) {
    throw new Error(`Supabase sync gateway unavailable: expected table allowlist, got ${JSON.stringify(result).slice(0, 200)}`)
  }
}

function escapeValue(val: unknown, columnType?: string): unknown {
  if (val === null || val === undefined) return null
  if (typeof val === 'boolean') return val
  if (typeof val === 'number') return val
  if (typeof val === 'string') return val
  if (val instanceof Buffer) return val
  if (columnType === 'json' || columnType === 'jsonb') {
    return JSON.stringify(val)
  }
  if (Array.isArray(val)) return val
  if (typeof val === 'object') return val
  return String(val)
}

function getColumnTypeMap(cols: { column_name: string; data_type: string }[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const c of cols) map[c.column_name] = c.data_type
  return map
}

async function insertBatch(
  client: Client,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  columnTypes: Record<string, string>,
): Promise<number> {
  if (rows.length === 0) return 0
  const colList = columns.map(c => `"${c}"`).join(', ')
  const batchSize = 200
  let total = 0

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const placeholders: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    for (const row of batch) {
      const vals = columns.map(c => {
        values.push(escapeValue(row[c], columnTypes[c]))
        return `$${paramIdx++}`
      })
      placeholders.push(`(${vals.join(', ')})`)
    }

    await client.query(
      `INSERT INTO ${table} (${colList}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`,
      values
    )
    total += batch.length
  }
  return total
}

async function upsertBatch(
  client: Client,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  columnTypes: Record<string, string>,
  pkColumn: string,
): Promise<number> {
  if (rows.length === 0) return 0
  const colList = columns.map(c => `"${c}"`).join(', ')
  const batchSize = 200
  let total = 0

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const placeholders: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    for (const row of batch) {
      const vals = columns.map(c => {
        values.push(escapeValue(row[c], columnTypes[c]))
        return `$${paramIdx++}`
      })
      placeholders.push(`(${vals.join(', ')})`)
    }

    const updateCols = columns.filter(c => c !== pkColumn && c !== 'created_at')
    const updateClause = updateCols.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ')

    await client.query(
      `INSERT INTO ${table} (${colList}) VALUES ${placeholders.join(', ')}
       ON CONFLICT ("${pkColumn}") DO UPDATE SET ${updateClause}`,
      values
    )
    total += batch.length
  }
  return total
}

async function getPrimaryKeyColumn(client: Client, schema: string, table: string): Promise<string> {
  const res = await client.query(
    `SELECT a.attname
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary`,
    [`${schema}.${table}`]
  )
  if (res.rows.length > 0) return res.rows[0].attname
  const colRes = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position LIMIT 1`,
    [schema, table]
  )
  return colRes.rows[0]?.column_name || 'id'
}

async function getLocalTableColumns(client: Client, schema: string, table: string):
  Promise<{ column_name: string; data_type: string }[]> {
  const res = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    [schema, table]
  )
  return res.rows
}

function sync_metadata_update(
  client: Client,
  tableName: string,
  rowCount: number,
  status: string,
  errorMessage?: string,
): Promise<any> {
  if (status === 'error') {
    return client.query(
      `INSERT INTO sync_metadata (table_name, last_sync_at, row_count, sync_status, error_message)
       VALUES ($1, now(), 0, 'error', $2)
       ON CONFLICT (table_name) DO UPDATE SET row_count = 0, sync_status = 'error', error_message = $2`,
      [tableName, errorMessage || '']
    )
  }
  return client.query(
    `INSERT INTO sync_metadata (table_name, last_sync_at, row_count, sync_status)
     VALUES ($1, now(), $2, 'done')
     ON CONFLICT (table_name) DO UPDATE SET last_sync_at = now(), row_count = $2, sync_status = 'done', error_message = NULL`,
    [tableName, rowCount]
  )
}

export async function processSyncOutbox(
  config: PgConnection,
  onProgress?: (table: string, count: number, total: number) => void
): Promise<{ success: boolean; processed: number; errors: string[] }> {
  ensureSupabaseConfig()

  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: 10000,
  })
  await client.connect()

  const errors: string[] = []
  let processed = 0

  try {
    // Resolve current employee_id from active local session
    let sessionEmployeeId: string | null = null
    try {
      const sessRes = await client.query(
        `SELECT employee_id FROM app.sessions WHERE expires_at > now()
         AND employee_id IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`
      )
      if (sessRes.rows.length > 0) {
        sessionEmployeeId = sessRes.rows[0].employee_id as string
      }
    } catch { /* session lookup is best-effort */ }

    const res = await client.query(
      `SELECT id, table_name, operation, record_id, payload, employee_id
       FROM sync_outbox
       WHERE synced = false
         AND retry_count < 3
       ORDER BY created_at
       LIMIT 500`
    )

    for (const row of res.rows) {
      const outboxId: string = row.id
      const tableName: string = row.table_name
      const localTableName: string = tableName.includes('.') ? tableName.split('.')[1] : tableName
      const operation: string = row.operation
      const recordId: string = row.record_id
      const payload: any = row.payload
      const employeeId: string | null = row.employee_id || sessionEmployeeId

      try {
        let rpcName: string
        const rpcParams: Record<string, unknown> = { p_table_name: localTableName }

        if (operation === 'INSERT') {
          rpcName = 'sync_push_insert'
          rpcParams.p_payload = payload
          rpcParams.p_employee_id = employeeId
        } else if (operation === 'UPDATE') {
          rpcName = 'sync_push_update'
          rpcParams.p_record_id = recordId
          rpcParams.p_payload = payload
          rpcParams.p_employee_id = employeeId
        } else if (operation === 'DELETE') {
          rpcName = 'sync_push_delete'
          rpcParams.p_record_id = recordId
          rpcParams.p_employee_id = employeeId
        } else {
          await client.query(
            `UPDATE sync_outbox SET synced = true, synced_at = now(), last_error = $1 WHERE id = $2`,
            [`Unknown operation: ${operation}`, outboxId]
          )
          continue
        }

        const result = await rpcCall(rpcName, rpcParams)
        if (result.success) {
          await client.query(
            `UPDATE sync_outbox SET synced = true, synced_at = now(), last_error = NULL WHERE id = $1`,
            [outboxId]
          )
          processed++
          onProgress?.(tableName, processed, res.rows.length)
        } else {
          const errMsg = result.error || 'Unknown error'
          await client.query(
            `UPDATE sync_outbox SET retry_count = retry_count + 1, last_error = $1 WHERE id = $2`,
            [errMsg, outboxId]
          )
          errors.push(`${tableName}/${operation}/${recordId}: ${errMsg}`)
        }
      } catch (err: any) {
        const errMsg = err.message
        await client.query(
          `UPDATE sync_outbox SET retry_count = retry_count + 1, last_error = $1 WHERE id = $2`,
          [errMsg, outboxId]
        )
        errors.push(`${tableName}/${operation}/${recordId}: ${errMsg}`)
      }
    }

    await client.end()
    return { success: errors.length === 0, processed, errors }
  } catch (err: any) {
    await client.end()
    return { success: false, processed, errors: [...errors, `Fatal: ${err.message}`] }
  }
}

export async function initialSync(
  config: PgConnection,
  onProgress?: ProgressCallback
): Promise<{ success: boolean; tablesSynced: number; totalRows: number; errors: string[] }> {
  ensureSupabaseConfig()

  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: 10000,
  })
  await client.connect()

  const errors: string[] = []
  let tablesSynced = 0
  let totalRows = 0
  const BATCH_SIZE = 500

  try {
    await verifySupabaseAccess()

    for (const tableDef of SYNC_TABLES) {
      const { name, schema } = tableDef
      const fullName = `${schema}.${name}`

      const progress: SyncProgress = { table: fullName, totalRows: 0, syncedRows: 0, status: 'syncing' }

      try {
        const countResult = await rpcCall('sync_get_row_count', { p_table_name: name })
        if (!countResult.success) {
          throw new Error(`Row count RPC failed: ${JSON.stringify(countResult)}`)
        }
        const rowCount = countResult.count as number
        progress.totalRows = rowCount

        if (rowCount === 0) {
          progress.status = 'done'
          onProgress?.(progress)
          await sync_metadata_update(client, fullName, 0, 'done')
          tablesSynced++
          continue
        }

        const localCols = await getLocalTableColumns(client, schema, name)
        if (localCols.length === 0) {
          progress.status = 'done'
          onProgress?.(progress)
          continue
        }
        const columns = localCols.map(r => r.column_name)
        const columnTypes = getColumnTypeMap(localCols)
        const pkColumn = await getPrimaryKeyColumn(client, schema, name)

        await client.query(`SET app.sync_in_progress = 'true'`)
        await client.query(`ALTER TABLE ${fullName} DISABLE TRIGGER ALL`)

        let offset = 0
        let inserted = 0
        let hasMore = true

        while (hasMore) {
          const result = await rpcCall('sync_pull_full_table', {
            p_table_name: name,
            p_limit: BATCH_SIZE,
            p_offset: offset,
          })
          if (!result.success) {
            throw new Error(`Full pull failed for ${name}: ${JSON.stringify(result)}`)
          }
          const rows = result.rows as Record<string, unknown>[]
          if (rows.length === 0) break

          await insertBatch(client, fullName, columns, rows, columnTypes)
          inserted += rows.length
          offset += BATCH_SIZE
          hasMore = result.has_more === true

          progress.syncedRows = inserted
          onProgress?.(progress)
        }

        await client.query(`ALTER TABLE ${fullName} ENABLE TRIGGER ALL`)
        await client.query(`SET app.sync_in_progress = 'false'`)

        await sync_metadata_update(client, fullName, inserted, 'done')
        progress.status = 'done'
        onProgress?.(progress)
        tablesSynced++
        totalRows += inserted
      } catch (err: any) {
        const errMsg = err.message
        // Abort entire sync on auth or connectivity failures
        if (errMsg.includes('HTTP 401') || errMsg.includes('HTTP 403') ||
            errMsg.includes('fetch failed') ||
            errMsg.includes('ENOTFOUND') || errMsg.includes('ECONNREFUSED') || errMsg.includes('ETIMEDOUT') ||
            errMsg.includes('unauthorized') || errMsg.includes('UNAUTHORIZED') ||
            errMsg.includes('Invalid API key')) {
          try { await sync_metadata_update(client, fullName, 0, 'error', errMsg); await client.query(`SET app.sync_in_progress = 'false'`) } catch { }
          throw new Error(`ABORT: ${errMsg}`)
        }
        progress.status = 'error'
        progress.error = errMsg
        onProgress?.(progress)
        errors.push(`${fullName}: ${errMsg}`)
        try { await sync_metadata_update(client, fullName, 0, 'error', errMsg) } catch { /* ignore */ }
      }
    }

    await client.end()
    return { success: errors.length === 0, tablesSynced, totalRows, errors }
  } catch (err: any) {
    await client.end()
    return { success: false, tablesSynced, totalRows, errors: [...errors, `Fatal: ${err.message}`] }
  }
}

export async function incrementalSync(
  config: PgConnection,
  onProgress?: ProgressCallback
): Promise<{ success: boolean; tablesUpdated: number; errors: string[] }> {
  ensureSupabaseConfig()

  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: 10000,
  })
  await client.connect()

  const errors: string[] = []
  let tablesUpdated = 0

  try {
    const metaRes = await client.query(
      `SELECT table_name, last_sync_at FROM sync_metadata WHERE sync_status IN ('done','error')`
    )

    for (const meta of metaRes.rows) {
      const tableName = meta.table_name as string
      const lastSync = meta.last_sync_at as string
      const [schema, name] = tableName.split('.')

      const progress: SyncProgress = { table: tableName, totalRows: 0, syncedRows: 0, status: 'syncing' }

      try {
        const localCols = await getLocalTableColumns(client, schema, name)
        if (localCols.length === 0) continue
        const columns = localCols.map(r => r.column_name)
        const columnTypes = getColumnTypeMap(localCols)
        const pkColumn = await getPrimaryKeyColumn(client, schema, name)

        let offset = 0
        let hasMore = true
        const allRows: Record<string, unknown>[] = []

        while (hasMore) {
          const result = await rpcCall('sync_pull_changes', {
            p_table_name: name,
            p_since: lastSync,
            p_limit: 1000,
            p_offset: offset,
          })
          if (!result.success) {
            throw new Error(`Incremental pull failed for ${name}: ${JSON.stringify(result)}`)
          }
          const rows = result.rows as Record<string, unknown>[]
          allRows.push(...rows)
          hasMore = result.has_more === true
          offset += rows.length
        }

        if (allRows.length === 0) continue

        await client.query(`SET app.sync_in_progress = 'true'`)
        await client.query(`ALTER TABLE ${tableName} DISABLE TRIGGER ALL`)
        await upsertBatch(client, tableName, columns, allRows, columnTypes, pkColumn)
        await client.query(`ALTER TABLE ${tableName} ENABLE TRIGGER ALL`)
        await client.query(`SET app.sync_in_progress = 'false'`)

        const countResult = await rpcCall('sync_get_row_count', { p_table_name: name })
        const actualCount = countResult.success ? (countResult.count as number) : 0

        await sync_metadata_update(client, tableName, actualCount, 'done')

        tablesUpdated++
        progress.totalRows = allRows.length
        progress.syncedRows = allRows.length
        progress.status = 'done'
        onProgress?.(progress)
      } catch (err: any) {
        errors.push(`${tableName}: ${err.message}`)
        progress.status = 'error'
        progress.error = err.message
        onProgress?.(progress)
        try { await sync_metadata_update(client, tableName, 0, 'error', err.message) } catch { /* ignore */ }
      }
    }

    await client.end()
    return { success: errors.length === 0, tablesUpdated, errors }
  } catch (err: any) {
    await client.end()
    return { success: false, tablesUpdated, errors: [...errors, `Fatal: ${err.message}`] }
  }
}
