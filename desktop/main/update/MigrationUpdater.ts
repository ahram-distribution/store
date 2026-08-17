import { Client } from 'pg'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { PgConnection } from '../db/PostgreSQLManager'
import { migrationsCacheDir } from './UpdateState'

const GITHUB_API = 'https://api.github.com/repos/ahram-distribution/store/contents/desktop/main/db/migrations'
const DOWNLOAD_TIMEOUT_MS = 15000

export interface MigrationDownload {
  version: number
  file: string
  description: string
}

interface GitHubFile {
  content?: string
  encoding?: string
  download_url?: string
  size?: number
}

async function fetchGitHubFile(path: string): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS)
    const res = await fetch(`${GITHUB_API}/${path}`, {
      signal: ctrl.signal,
      headers: { Accept: 'application/vnd.github.v3+json' },
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const data: GitHubFile = await res.json()
    if (data.encoding === 'base64' && data.content) {
      return Buffer.from(data.content, 'base64').toString('utf8')
    }
    if (data.download_url) {
      const ctrl2 = new AbortController()
      const timer2 = setTimeout(() => ctrl2.abort(), DOWNLOAD_TIMEOUT_MS * 2)
      const dlRes = await fetch(data.download_url, { signal: ctrl2.signal })
      clearTimeout(timer2)
      if (!dlRes.ok) return null
      return await dlRes.text()
    }
    return null
  } catch {
    return null
  }
}

export async function fetchRemoteMigrationsManifest(): Promise<MigrationDownload[] | null> {
  const raw = await fetchGitHubFile('manifest.json')
  if (!raw) return null
  try {
    const data = JSON.parse(raw)
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
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  const needed = migrations.filter(m => m.version > localSchemaVersion)
  const downloaded: MigrationDownload[] = []

  for (const mig of needed) {
    const filePath = join(cacheDir, mig.file)
    if (existsSync(filePath)) {
      downloaded.push(mig)
      continue
    }

    const sql = await fetchGitHubFile(mig.file)
    if (sql) {
      writeFileSync(filePath, sql, 'utf8')
      downloaded.push(mig)
    } else {
      console.warn(`[MigrationUpdater] Failed to download ${mig.file}`)
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
