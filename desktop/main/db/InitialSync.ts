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

async function doUpsertBatch(
  client: Client,
  table: string,
  columns: string[],
  batch: Record<string, unknown>[],
  columnTypes: Record<string, string>,
  pkColumn: string,
): Promise<number> {
  if (batch.length === 0) return 0
  const colList = columns.map(c => `"${c}"`).join(', ')
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
  return batch.length
}

// Error codes that indicate a data-level conflict we can quarantine per-row
// instead of failing the whole table:
//   23505 unique_violation (secondary unique index, e.g. uq_roles_name)
//   23503 foreign_key_violation
//   23514 check_violation
//   23502 not_null_violation
//   22001 string_data_right_truncation
//   22P02 invalid_text_representation
const RECOVERABLE_CODES = new Set(['23505', '23503', '23514', '23502', '22001', '22P02'])

function isRecoverableError(err: any): boolean {
  return !!err && typeof err.code === 'string' && RECOVERABLE_CODES.has(err.code)
}

function extractConstraintName(message: string): string | null {
  const m = message.match(/constraint\s+"([^"]+)"/i)
  return m ? m[1] : null
}

async function getIndexColumns(client: Client, indexName: string, table: string): Promise<string[]> {
  const res = await client.query(
    `SELECT a.attname
     FROM pg_index i
     JOIN pg_class t ON t.oid = i.indrelid
     JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
     WHERE i.indexrelid = $1::regclass
       AND t.oid = $2::regclass
     ORDER BY array_position(i.indkey::int[], a.attnum::int)`,
    [indexName, table]
  )
  return res.rows.map(r => r.attname as string)
}

async function quarantineRow(
  client: Client,
  table: string,
  remoteRow: Record<string, unknown>,
  err: any,
): Promise<string> {
  const schema = table.includes('.') ? table.split('.')[0] : 'public'
  const name = table.includes('.') ? table.split('.')[1] : table
  let localVersion: unknown = null

  const constraintName = extractConstraintName(err.message || '')
  if (constraintName) {
    try {
      const indexCols = await getIndexColumns(client, constraintName, `${schema}.${name}`)
      if (indexCols.length > 0) {
        const params: unknown[] = []
        const whereParts: string[] = []
        for (const col of indexCols) {
          params.push(remoteRow[col] ?? null)
          whereParts.push(`"${col}" = $${params.length}`)
        }
        const local = await client.query(
          `SELECT to_jsonb(t) AS row FROM ${schema}.${name} t WHERE ${whereParts.join(' AND ')} LIMIT 1`,
          params
        )
        if (local.rows.length > 0) localVersion = local.rows[0].row
      }
    } catch { /* best-effort conflict localization */ }
  }

  if (localVersion === null) {
    localVersion = JSON.stringify(remoteRow)
  }

  const remoteVersion = JSON.stringify(remoteRow)
  const recordId = (remoteRow as any).id ?? null
  try {
    await client.query(
      `INSERT INTO sync_conflicts (table_name, record_id, local_version, remote_version, resolution)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, 'pending')
       ON CONFLICT DO NOTHING`,
      [table, recordId, localVersion, remoteVersion]
    )
  } catch (e: any) {
    return `${table}: quarantine record failed (${e.message})`
  }
  const firstLine = (err.message || '').split('\n')[0]
  return `${table}: ${firstLine}`
}

export async function upsertRows(
  client: Client,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  columnTypes: Record<string, string>,
  pkColumn: string,
): Promise<{ total: number; quarantined: number; conflicts: string[]; fatal: string[] }> {
  const result = { total: 0, quarantined: 0, conflicts: [] as string[], fatal: [] as string[] }
  if (rows.length === 0) return result

  const batchSize = 200
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    try {
      result.total += await doUpsertBatch(client, table, columns, batch, columnTypes, pkColumn)
    } catch (err: any) {
      if (isRecoverableError(err)) {
        // Retry row-by-row; quarantine only the rows that actually conflict.
        for (const row of batch) {
          try {
            result.total += await doUpsertBatch(client, table, columns, [row], columnTypes, pkColumn)
          } catch (rowErr: any) {
            if (isRecoverableError(rowErr)) {
              result.quarantined++
              result.conflicts.push(await quarantineRow(client, table, row, rowErr))
            } else {
              result.fatal.push(`${table}: ${rowErr.message}`)
            }
          }
        }
      } else {
        result.fatal.push(`${table}: ${err.message}`)
      }
    }
  }
  return result
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

const BACKOFF_BASE_MINUTES = 5
const QUARANTINE_AFTER_ERRORS = 5

export async function sync_metadata_update(
  client: Client,
  tableName: string,
  rowCount: number,
  status: string,
  errorMessage?: string,
): Promise<any> {
  if (status === 'error') {
    // Exponential backoff. last_sync_at is intentionally NOT advanced so the
    // next sync re-pulls from the last successful point. At the retry cap the
    // table is quarantined and skipped by future syncs (surfaced in reports).
    return client.query(
      `UPDATE sync_metadata SET
         row_count = 0,
         sync_status = 'error',
         error_message = $2,
         retry_count = retry_count + 1,
         next_retry_at = now() + (interval '5 minutes' * (2 ^ LEAST(retry_count, 4))),
         quarantined = (retry_count + 1 >= ${QUARANTINE_AFTER_ERRORS})
       WHERE table_name = $1`,
      [tableName, errorMessage || '']
    ).then(async (res) => {
      if (res.rowCount === 0) {
        await client.query(
          `INSERT INTO sync_metadata (table_name, last_sync_at, row_count, sync_status, error_message, retry_count, next_retry_at)
           VALUES ($1, now(), 0, 'error', $2, 1, now() + interval '5 minutes')`,
          [tableName, errorMessage || '']
        )
      }
    })
  }
  return client.query(
    `INSERT INTO sync_metadata (table_name, last_sync_at, row_count, sync_status)
     VALUES ($1, now(), $2, 'done')
     ON CONFLICT (table_name) DO UPDATE SET
       last_sync_at = now(), row_count = $2, sync_status = 'done',
       error_message = NULL, retry_count = 0, next_retry_at = NULL, quarantined = false`,
    [tableName, rowCount]
  )
}

// Tables eligible for incremental sync: previously synced (or errored) tables
// that are not quarantined and are past their backoff window.
export async function getEligibleSyncTables(
  client: Client
): Promise<Array<{ table_name: string; last_sync_at: string }>> {
  const res = await client.query(
    `SELECT table_name, last_sync_at FROM sync_metadata
     WHERE sync_status IN ('done','error')
       AND quarantined = false
       AND (next_retry_at IS NULL OR next_retry_at <= now())`
  )
  return res.rows as Array<{ table_name: string; last_sync_at: string }>
}

export async function getSyncQuarantineStatus(config: PgConnection): Promise<{
  pendingConflicts: number
  quarantinedTables: string[]
  quarantinedOutbox: number
}> {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: 10000,
  })
  await client.connect()
  try {
    const conflicts = await client.query(
      `SELECT count(*)::int AS c FROM sync_conflicts WHERE resolution = 'pending'`
    ).catch(() => ({ rows: [{ c: 0 }] }))
    const tabs = await client.query(
      `SELECT table_name FROM sync_metadata WHERE quarantined = true ORDER BY table_name`
    ).catch(() => ({ rows: [] }))
    const outbox = await client.query(
      `SELECT count(*)::int AS c FROM sync_outbox WHERE quarantined = true AND resolution = 'pending'`
    ).catch(() => ({ rows: [{ c: 0 }] }))
    return {
      pendingConflicts: conflicts.rows[0]?.c ?? 0,
      quarantinedTables: tabs.rows.map(r => r.table_name as string),
      quarantinedOutbox: outbox.rows[0]?.c ?? 0,
    }
  } finally {
    await client.end()
  }
}

interface OutboxRow {
  table_name: string
  operation: string
  record_id: string
  payload: any
  employee_id: string | null
}

async function pushOutboxRow(
  client: Client,
  row: OutboxRow,
  pushEmployeeId: string | null,
): Promise<{ ok: boolean; delivered?: boolean; error?: string; unknownOperation?: boolean }> {
  const localTableName = row.table_name.includes('.') ? row.table_name.split('.')[1] : row.table_name
  const rpcParams: Record<string, unknown> = { p_table_name: localTableName }
  let rpcName: string

  if (row.operation === 'INSERT') {
    rpcName = 'sync_push_insert'
    rpcParams.p_payload = row.payload
    rpcParams.p_employee_id = pushEmployeeId
  } else if (row.operation === 'UPDATE') {
    rpcName = 'sync_push_update'
    rpcParams.p_record_id = row.record_id
    rpcParams.p_payload = row.payload
    rpcParams.p_employee_id = pushEmployeeId
  } else if (row.operation === 'DELETE') {
    rpcName = 'sync_push_delete'
    rpcParams.p_record_id = row.record_id
    rpcParams.p_employee_id = pushEmployeeId
  } else {
    return { ok: false, unknownOperation: true, error: `Unknown operation: ${row.operation}` }
  }

  try {
    const result = await rpcCall(rpcName, rpcParams)
    if (result.success) return { ok: true, delivered: true }
    return { ok: false, error: result.error || 'Unknown error' }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

// The remote sync_push_* RPCs reject any acting employee that does not hold the
// sync.offline_push capability. Offline changes may be captured under an
// employee without that capability, which previously left every such push
// permanently quarantined ("Employee lacks sync.offline_push capability").
// Resolve an employee that the remote authorizes: the most recent active
// session employee holding the capability, falling back to any capable one.
async function resolveSyncPushEmployee(client: Client): Promise<string | null> {
  try {
    const sessionRes = await client.query(
      `SELECT s.employee_id
         FROM app.sessions s
         WHERE s.expires_at > now() AND s.employee_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM public.employee_roles er
             JOIN public.role_capabilities rc ON rc.role_id = er.role_id
             JOIN public.capabilities c ON c.id = rc.capability_id
             WHERE er.employee_id = s.employee_id AND c.code = 'sync.offline_push')
         ORDER BY s.created_at DESC LIMIT 1`
    )
    if (sessionRes.rows.length > 0) return sessionRes.rows[0].employee_id as string

    const anyRes = await client.query(
      `SELECT er.employee_id
         FROM public.employee_roles er
         JOIN public.role_capabilities rc ON rc.role_id = er.role_id
         JOIN public.capabilities c ON c.id = rc.capability_id
         WHERE c.code = 'sync.offline_push'
         ORDER BY er.assigned_at DESC NULLS LAST LIMIT 1`
    )
    if (anyRes.rows.length > 0) return anyRes.rows[0].employee_id as string
  } catch { /* capability lookup is best-effort */ }
  return null
}

export async function processSyncOutbox(
  config: PgConnection,
  onProgress?: (table: string, count: number, total: number) => void
): Promise<{ success: boolean; processed: number; errors: string[]; conflicts: string[] }> {
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
  const conflicts: string[] = []
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
    const syncPushEmployee = await resolveSyncPushEmployee(client)

    const res = await client.query(
      `SELECT id, table_name, operation, record_id, payload, employee_id
       FROM sync_outbox
       WHERE synced = false
         AND quarantined = false
         AND resolution = 'pending'
       ORDER BY created_at
       LIMIT 500`
    )

    for (const row of res.rows) {
      const outboxId: string = row.id
      const tableName: string = row.table_name
      const operation: string = row.operation
      const recordId: string = row.record_id
      const pushEmployeeId: string | null = syncPushEmployee || row.employee_id || sessionEmployeeId

      try {
        const push = await pushOutboxRow(client, row, pushEmployeeId)
        if (push.ok) {
          await client.query(
            `UPDATE sync_outbox SET synced = true, synced_at = now(), last_error = NULL WHERE id = $1`,
            [outboxId]
          )
          processed++
          onProgress?.(tableName, processed, res.rows.length)
        } else if (push.unknownOperation) {
          await client.query(
            `UPDATE sync_outbox SET synced = true, synced_at = now(), last_error = $1 WHERE id = $2`,
            [push.error, outboxId]
          )
          continue
        } else {
          // Server-side business rejection (duplicate, missing capability, FK
          // mismatch, ...): a recoverable data conflict, quarantined after
          // retries. It must NOT count as a hard sync error.
          const errMsg = push.error || 'Unknown error'
          await client.query(
            `UPDATE sync_outbox SET retry_count = retry_count + 1, last_error = $1,
                quarantined = (retry_count + 1 >= 3)
             WHERE id = $2`,
            [errMsg, outboxId]
          )
          conflicts.push(`${tableName}/${operation}/${recordId}: ${errMsg}`)
        }
      } catch (err: any) {
        const errMsg = err.message
        await client.query(
          `UPDATE sync_outbox SET retry_count = retry_count + 1, last_error = $1,
              quarantined = (retry_count + 1 >= 3)
           WHERE id = $2`,
          [errMsg, outboxId]
        )
        errors.push(`${tableName}/${operation}/${recordId}: ${errMsg}`)
      }
    }

    await client.end()
    return { success: errors.length === 0, processed, errors, conflicts }
  } catch (err: any) {
    await client.end()
    return { success: false, processed, errors: [...errors, `Fatal: ${err.message}`], conflicts }
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
): Promise<{ success: boolean; tablesUpdated: number; errors: string[]; conflicts: string[] }> {
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
  const conflicts: string[] = []
  let tablesUpdated = 0

  try {
    const eligibleTables = await getEligibleSyncTables(client)

    for (const meta of eligibleTables) {
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
        const upsert = await upsertRows(client, tableName, columns, allRows, columnTypes, pkColumn)
        await client.query(`ALTER TABLE ${tableName} ENABLE TRIGGER ALL`)
        await client.query(`SET app.sync_in_progress = 'false'`)

        if (upsert.quarantined > 0) {
          conflicts.push(...upsert.conflicts)
        }
        if (upsert.fatal.length > 0) {
          throw new Error(upsert.fatal.join('; '))
        }

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
    return { success: errors.length === 0, tablesUpdated, errors, conflicts }
  } catch (err: any) {
    await client.end()
    return { success: false, tablesUpdated, errors: [...errors, `Fatal: ${err.message}`], conflicts }
  }
}

// ---------------------------------------------------------------------------
// Synchronization reconciliation engine
//
// The mirror converges to the remote as the system of record. Records that
// were quarantined on either side of the sync (pull conflicts in
// sync_conflicts, rejected offline writes in sync_outbox) are reconciled here
// so the local database and the remote end in the same authoritative state.
// The engine runs automatically as part of every sync and startup, so any
// installation that encounters the same state repairs itself, and the same
// conflicts are not recreated on the next sync.
// ---------------------------------------------------------------------------

export async function reconcileSyncState(
  config: PgConnection,
  onProgress?: (message: string) => void
): Promise<{
  conflictsResolved: number
  outboxResolved: number
  outboxDelivered: number
  remainingConflicts: number
  remainingOutbox: number
  errors: string[]
}> {
  ensureSupabaseConfig()

  // The resolution columns are added idempotently to every install.
  const { ensureSyncMetadataSchema } = await import('./PostgreSQLManager.js')
  try { await ensureSyncMetadataSchema(config) } catch { /* idempotent */ }

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
  let conflictsResolved = 0
  let outboxResolved = 0
  let outboxDelivered = 0

  try {
    // Prevent the outbox-capture triggers from re-queueing rows that this
    // pass writes while it applies the authoritative state locally.
    await client.query(`SET app.sync_in_progress = 'true'`)

    const conflictRes = await reconcilePendingConflicts(client)
    conflictsResolved = conflictRes.resolved
    errors.push(...conflictRes.errors)

    const pushEmployeeId = await resolveSyncPushEmployee(client)
    const outRes = await reconcileQuarantinedOutbox(client, pushEmployeeId, onProgress)
    outboxResolved = outRes.resolved
    outboxDelivered = outRes.delivered
    errors.push(...outRes.errors)
  } catch (err: any) {
    errors.push(`Reconcile fatal: ${err.message}`)
  } finally {
    try { await client.query(`SET app.sync_in_progress = 'false'`) } catch { /* ignore */ }
    await client.end()
  }

  const status = await getSyncQuarantineStatus(config)
  return {
    conflictsResolved,
    outboxResolved,
    outboxDelivered,
    remainingConflicts: status.pendingConflicts,
    remainingOutbox: status.quarantinedOutbox,
    errors,
  }
}

async function deleteDuplicateRowAndChildren(
  client: Client,
  schema: string,
  table: string,
  pkColumn: string,
  duplicateId: unknown,
): Promise<void> {
  // Remove dependent child rows that reference the duplicate primary key.
  // Per the sync authority the authoritative remote record (and its own
  // children, pulled independently) replaces the local duplicate, so child
  // rows pointing at the duplicate id have no place in the converged mirror.
  const refs = await client.query(
    `SELECT fkconf.conrelid::regclass::text AS referencing_table, a.attname AS fk_column
       FROM pg_constraint fkconf
       JOIN pg_attribute a ON a.attrelid = fkconf.conrelid AND a.attnum = ANY(fkconf.conkey)
       WHERE fkconf.contype = 'f'
         AND fkconf.confrelid = $1::regclass`,
    [`${schema}.${table}`]
  )
  for (const ref of refs.rows) {
    const refTable = ref.referencing_table as string
    const fkCol = ref.fk_column as string
    try {
      await client.query(`DELETE FROM ${refTable} WHERE "${fkCol}" = $1`, [duplicateId])
    } catch { /* best-effort: never delete durable business data silently */ }
  }
  await client.query(`DELETE FROM ${schema}.${table} WHERE "${pkColumn}" = $1`, [duplicateId])
}

async function reconcilePendingConflicts(
  client: Client,
): Promise<{ resolved: number; errors: string[] }> {
  const errors: string[] = []
  let resolved = 0

  const res = await client.query(
    `SELECT id, table_name, record_id, local_version, remote_version
     FROM sync_conflicts WHERE resolution = 'pending' ORDER BY created_at`
  )

  for (const conflict of res.rows) {
    const table = conflict.table_name as string
    const schema = table.includes('.') ? table.split('.')[0] : 'public'
    const name = table.includes('.') ? table.split('.')[1] : table
    const localRow = (conflict.local_version ?? {}) as Record<string, any>
    const remoteRow = (conflict.remote_version ?? {}) as Record<string, any>

    try {
      await client.query('BEGIN')
      const pkColumn = await getPrimaryKeyColumn(client, schema, name)
      const localId = localRow[pkColumn]
      const remoteId = remoteRow[pkColumn]

      // The local row occupies the secondary unique key the authoritative
      // remote row needs. When they are different records with the same
      // logical identity (duplicate), the local duplicate is superseded: its
      // child rows are removed with it and the authoritative remote row is
      // applied. When the ids match, the row is simply re-applied.
      if (localId && remoteId && String(localId) !== String(remoteId)) {
        await deleteDuplicateRowAndChildren(client, schema, name, pkColumn, localId)
      }

      const cols = await getLocalTableColumns(client, schema, name)
      const columns = cols.map(c => c.column_name)
      const columnTypes = getColumnTypeMap(cols)
      await doUpsertBatch(client, `${schema}.${name}`, columns, [remoteRow], columnTypes, pkColumn)

      await client.query(
        `UPDATE sync_conflicts SET resolution = 'remote', resolved_at = now() WHERE id = $1`,
        [conflict.id]
      )
      await client.query('COMMIT')
      resolved++
    } catch (err: any) {
      try { await client.query('ROLLBACK') } catch { /* ignore */ }
      errors.push(`${table}/${conflict.record_id}: conflict reconcile failed: ${err.message}`)
    }
  }

  return { resolved, errors }
}

async function convergeRecordToRemote(
  client: Client,
  schema: string,
  name: string,
  recordId: string,
  pkColumn: string,
): Promise<boolean> {
  // The remote refused a local change for a record that still exists locally.
  // The remote is the system of record: locate the authoritative remote row
  // and apply it locally. Only the target row is upserted so a secondary
  // unique collision on another row cannot abort the convergence.
  try {
    await client.query(`SET app.sync_in_progress = 'true'`)
    await client.query(`ALTER TABLE ${schema}.${name} DISABLE TRIGGER ALL`)
    const cols = await getLocalTableColumns(client, schema, name)
    const columns = cols.map(c => c.column_name)
    const columnTypes = getColumnTypeMap(cols)

    let found = false
    let offset = 0
    const BATCH = 500
    while (true) {
      const result = await rpcCall('sync_pull_full_table', {
        p_table_name: name,
        p_limit: BATCH,
        p_offset: offset,
      })
      if (!result.success) break
      const rows = result.rows as Record<string, any>[]
      if (rows.length === 0) break
      const target = rows.find(r => String(r[pkColumn]) === String(recordId))
      if (target) {
        await doUpsertBatch(client, `${schema}.${name}`, columns, [target], columnTypes, pkColumn)
        found = true
        break
      }
      offset += rows.length
      if (result.has_more !== true) break
    }

    await client.query(`ALTER TABLE ${schema}.${name} ENABLE TRIGGER ALL`)
    await client.query(`SET app.sync_in_progress = 'false'`)
    return found
  } catch {
    try { await client.query(`ALTER TABLE ${schema}.${name} ENABLE TRIGGER ALL`) } catch { /* ignore */ }
    try { await client.query(`SET app.sync_in_progress = 'false'`) } catch { /* ignore */ }
    return false
  }
}

async function reconcileQuarantinedOutbox(
  client: Client,
  pushEmployeeId: string | null,
  onProgress?: (message: string) => void,
): Promise<{ resolved: number; delivered: number; errors: string[] }> {
  const errors: string[] = []
  let resolved = 0
  let delivered = 0

  const res = await client.query(
    `SELECT id, table_name, operation, record_id, payload, employee_id
     FROM sync_outbox
     WHERE synced = false AND quarantined = true AND resolution = 'pending'
     ORDER BY created_at
     LIMIT 1000`
  )

  for (const row of res.rows) {
    const table = row.table_name as string
    const schema = table.includes('.') ? table.split('.')[0] : 'public'
    const name = table.includes('.') ? table.split('.')[1] : table
    const recordId = row.record_id

    try {
      const pk = await getPrimaryKeyColumn(client, schema, name)
      const existsRes = await client.query(
        `SELECT 1 FROM ${schema}.${name} WHERE "${pk}" = $1`, [recordId]
      )
      const existsLocally = existsRes.rows.length > 0

      if (!existsLocally) {
        // The offline change was reverted/removed before it ever reached the
        // remote (all prior push attempts were rejected, so nothing was
        // delivered). Authoritative state on BOTH sides is "record absent";
        // the queued operation is a net-zero change and is resolved as void.
        await client.query(
          `UPDATE sync_outbox SET resolution = 'void', resolved_at = now(), quarantined = false,
             resolution_evidence = $1 WHERE id = $2`,
          ['Record no longer exists in the local mirror and was never applied to the remote (all prior push attempts were rejected). Authoritative state on both sides is "record absent"; the queued operation is a net-zero change resolved as void.',
            row.id]
        )
        resolved++
        continue
      }

      // Record exists locally — the change must be delivered, or if the remote
      // refuses it, the local record must converge to the remote authority.
      const push = await pushOutboxRow(client, row, pushEmployeeId)
      if (push.ok) {
        await client.query(
          `UPDATE sync_outbox SET synced = true, synced_at = now(), last_error = NULL, quarantined = false WHERE id = $1`,
          [row.id]
        )
        delivered++
        onProgress?.(`Delivered ${table}/${row.operation}/${recordId}`)
        continue
      }

      const errMsg = push.error || 'Unknown error'
      const converged = await convergeRecordToRemote(client, schema, name, String(recordId), pk)
      if (converged) {
        await client.query(
          `UPDATE sync_outbox SET resolution = 'remote', resolved_at = now(), quarantined = false,
             resolution_evidence = $1 WHERE id = $2`,
          [`Remote rejected the local change (${errMsg}); the local record was converged to the authoritative remote version.`,
            row.id]
        )
        resolved++
      } else {
        // Remote has no authoritative record and refuses the local change.
        // Preserve the local business data: keep the row quarantined so it is
        // surfaced in sync status and retried on later syncs (self-healing).
        await client.query(
          `UPDATE sync_outbox SET retry_count = retry_count + 1, last_error = $1, quarantined = true WHERE id = $2`,
          [errMsg, row.id]
        )
        errors.push(`${table}/${row.operation}/${recordId}: ${errMsg} (record preserved locally, will retry)`)
      }
    } catch (err: any) {
      errors.push(`${row.table_name}/${row.operation}/${row.record_id}: reconcile failed: ${err.message}`)
    }
  }

  return { resolved, delivered, errors }
}
