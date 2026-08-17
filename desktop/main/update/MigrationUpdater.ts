import { Client } from 'pg'
import { writeFileSync, readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import type { PgConnection } from '../db/PostgreSQLManager'
import { migrationsCacheDir } from './UpdateState'

const MIGRATIONS_BASE_URL = 'https://raw.githubusercontent.com/ahram-distribution/store/main/desktop/main/db/migrations/'
const MIGRATIONS_MANIFEST_URL = `${MIGRATIONS_BASE_URL}manifest.json`
const DOWNLOAD_TIMEOUT_MS = 10000

export interface MigrationDownload {
  version: number
  file: string
  description: string
}

export async function fetchRemoteMigrationsManifest(): Promise<MigrationDownload[] | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS)
    const res = await fetch(MIGRATIONS_MANIFEST_URL, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const data = await res.json()
    if (!data || !Array.isArray(data.migrations)) return null
    return data.migrations.sort((a: any, b: any) => a.version - b.version)
  } catch {
    return null
  }
}

export async function downloadMigrationFiles(
  migrations: MigrationDownload[],
  localSchemaVersion: number,
): Promise<MigrationDownload[]> {
  const cacheDir = migrationsCacheDir()
  const needed = migrations.filter(m => m.version > localSchemaVersion)
  const downloaded: MigrationDownload[] = []

  for (const mig of needed) {
    const filePath = join(cacheDir, mig.file)
    if (existsSync(filePath)) {
      downloaded.push(mig)
      continue
    }

    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS)
      const res = await fetch(`${MIGRATIONS_BASE_URL}${mig.file}`, { signal: ctrl.signal })
      clearTimeout(timer)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const sql = await res.text()
      writeFileSync(filePath, sql, 'utf8')
      downloaded.push(mig)
    } catch (err) {
      console.warn(`[MigrationUpdater] Failed to download ${mig.file}:`, (err as Error).message)
    }
  }

  return downloaded
}

export async function applyRemoteMigrations(
  config: PgConnection,
  remoteMigrations: MigrationDownload[],
): Promise<{ applied: number; failed: string | null }> {
  const cacheDir = migrationsCacheDir()
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: 10000,
  })

  try {
    await client.connect()

    const cur = await client.query(
      `SELECT COALESCE(max(version), 0) AS v FROM public.schema_migrations WHERE status = 'applied'`
    )
    const currentVersion = parseInt(cur.rows[0]?.v ?? '0', 10)

    const pending = remoteMigrations
      .filter(m => m.version > currentVersion)
      .sort((a, b) => a.version - b.version)

    if (pending.length === 0) return { applied: 0, failed: null }

    let applied = 0
    for (const mig of pending) {
      const filePath = join(cacheDir, mig.file)
      if (!existsSync(filePath)) {
        return { applied, failed: `Migration file not found: ${mig.file}` }
      }

      const sql = readFileSync(filePath, 'utf8')

      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO public.schema_migrations (version, name, description, status)
           VALUES ($1, $2, $3, 'applied')`,
          [mig.version, mig.file, mig.description]
        )
        await client.query(sql)
        await client.query('COMMIT')
        applied++
        console.log(`[MigrationUpdater] Applied remote migration v${mig.version}: ${mig.file}`)
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {})
        try {
          await client.query(
            `INSERT INTO public.schema_migrations (version, name, description, status, error_message)
             VALUES ($1, $2, $3, 'failed', $4)
             ON CONFLICT (version) DO UPDATE SET status = 'failed', error_message = $4, applied_at = now()`,
            [mig.version, mig.file, mig.description, err.message]
          )
        } catch { /* best-effort */ }
        return { applied, failed: `Migration v${mig.version} (${mig.file}) failed: ${err.message}` }
      }
    }

    return { applied, failed: null }
  } finally {
    await client.end()
  }
}
