import { BrowserWindow } from 'electron'
import { loadDbConfig, PgConnection } from './PostgreSQLManager'
import { getSupabaseConfig } from '../config/supabase'
import { performIncrementalSync, performInitialSync } from './HealthChecker'

let monitorInterval: ReturnType<typeof setInterval> | null = null
let wasOnline = false

async function checkSupabaseConnectivity(): Promise<boolean> {
  try {
    const cfg = getSupabaseConfig()
    if (!cfg) return false
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10000)
    const res = await fetch(`${cfg.url}/rest/v1/rpc/sync_get_table_allowlist`, {
      signal: ctrl.signal,
      method: 'POST',
      headers: {
        apikey: cfg.anonKey,
        Authorization: `Bearer ${cfg.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

function notifyWindows(channel: string, data: Record<string, unknown>): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  })
}

async function runAutoSync(): Promise<void> {
  try {
    const config: PgConnection | null = await loadDbConfig()
    if (!config) return

    const { checkHealth, executeQuery } = await import('./PostgreSQLManager.js')
    const health = await checkHealth(config)
    if (!health.healthy) return

    const syncRes = await executeQuery(config,
      `SELECT COUNT(*) AS cnt FROM sync_metadata WHERE sync_status = $1`, ['done']
    )
    const hasDoneTables = parseInt(syncRes.rows[0]?.cnt as string || '0') > 0

    if (hasDoneTables) {
      await performIncrementalSync(config)
    } else {
      await performInitialSync(config)
    }
  } catch {
    // Auto-sync errors are non-fatal
  }
}

// True when a previously failed table is past its backoff window and is
// therefore eligible for an automatic retry while the app is online.
async function hasPendingSyncErrors(): Promise<boolean> {
  try {
    const config: PgConnection | null = await loadDbConfig()
    if (!config) return false
    const { executeQuery } = await import('./PostgreSQLManager.js')
    const res = await executeQuery(config,
      `SELECT 1 FROM sync_metadata
       WHERE sync_status = 'error' AND quarantined = false
         AND (next_retry_at IS NULL OR next_retry_at <= now())
       LIMIT 1`
    )
    return (res.rows?.length ?? 0) > 0
  } catch {
    return false
  }
}

export function startConnectivityMonitor(): void {
  if (monitorInterval) return

  // Initial check
  checkSupabaseConnectivity().then(online => {
    wasOnline = online
    notifyWindows('connectivity:changed', { online })
  })

  monitorInterval = setInterval(async () => {
    const online = await checkSupabaseConnectivity()
    if (online !== wasOnline) {
      wasOnline = online
      notifyWindows('connectivity:changed', { online })

      if (online) {
        await runAutoSync()
      }
    } else if (online && await hasPendingSyncErrors()) {
      // A failed table is past its backoff window: retry automatically so a
      // sync interrupted by an outage recovers without user intervention.
      await runAutoSync()
    }
  }, 30000)
}

export function stopConnectivityMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval)
    monitorInterval = null
  }
}
