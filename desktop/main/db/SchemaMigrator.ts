import { Client } from 'pg'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { PgConnection } from './PostgreSQLManager'
import {
  BASELINE_SCHEMA_FILE,
  Migration,
  MigrationManifest,
  requiredSchemaVersion,
} from './schemaManifest'

export type SchemaCompatibilityStatus = 'ok' | 'needs-migration' | 'schema-newer' | 'unknown'

export interface SchemaState {
  migrationsTableExists: boolean
  dbHasData: boolean
  currentVersion: number
  failedMigration: { version: number; name: string; error: string } | null
  pendingMigrations: Migration[]
  manifest: MigrationManifest
  requiredVersion: number
}

export interface SchemaCompatibility {
  status: SchemaCompatibilityStatus
  state: SchemaState | null
  detail?: string
}

export interface MigrateResult {
  success: boolean
  applied: Migration[]
  failed?: Migration
  error?: string
}

const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version integer PRIMARY KEY,
  name varchar(200) NOT NULL,
  description text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  status varchar(20) NOT NULL DEFAULT 'applied',
  error_message text
);
`

function resolveMigrationsDir(): string {
  const envDir = process.env.AHRAM_MIGRATIONS_DIR
  if (envDir && existsSync(join(envDir, 'manifest.json'))) return envDir

  const resDir =
    typeof process.resourcesPath === 'string' && process.resourcesPath
      ? join(process.resourcesPath, 'migrations')
      : ''
  if (resDir && existsSync(join(resDir, 'manifest.json'))) return resDir

  const buildDir = join(__dirname, 'migrations')
  if (existsSync(join(buildDir, 'manifest.json'))) return buildDir

  const srcDir = join(__dirname, '..', '..', '..', 'main', 'db', 'migrations')
  if (existsSync(join(srcDir, 'manifest.json'))) return srcDir

  throw new Error(
    'Migrations manifest not found. Set AHRAM_MIGRATIONS_DIR or ship manifest.json in resources/migrations.'
  )
}

export function resolveBaselineSchemaPath(): string {
  const envPath = process.env.AHRAM_SCHEMA_SQL
  if (envPath && existsSync(envPath)) return envPath

  const resPath =
    typeof process.resourcesPath === 'string' && process.resourcesPath
      ? join(process.resourcesPath, 'schema.sql')
      : ''
  if (resPath && existsSync(resPath)) return resPath

  const buildPath = join(__dirname, 'schema.sql')
  if (existsSync(buildPath)) return buildPath

  const srcPath = join(__dirname, '..', '..', '..', 'main', 'db', 'schema.sql')
  if (existsSync(srcPath)) return srcPath

  throw new Error('Baseline schema.sql not found. Set AHRAM_SCHEMA_SQL or ship schema.sql in resources.')
}

export function loadManifest(): MigrationManifest {
  const dir = resolveMigrationsDir()
  const raw = readFileSync(join(dir, 'manifest.json'), 'utf8')
  const manifest = JSON.parse(raw) as MigrationManifest
  if (!Array.isArray(manifest.migrations)) {
    throw new Error('Migrations manifest is malformed: migrations must be an array')
  }
  manifest.migrations.sort((a, b) => a.version - b.version)
  return manifest
}

function readMigrationSql(dir: string, migration: Migration): string {
  const filePath = join(dir, migration.file)
  if (!existsSync(filePath)) {
    throw new Error(`Migration SQL file not found: ${filePath}`)
  }
  return readFileSync(filePath, 'utf8')
}

async function connect(config: PgConnection): Promise<Client> {
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: 10000,
  })
  await client.connect()
  return client
}

export async function getSchemaState(config: PgConnection): Promise<SchemaState> {
  const manifest = loadManifest()
  const client = await connect(config)
  try {
    const migRes = await client.query(`SELECT to_regclass('public.schema_migrations') AS rel`)
    const migrationsTableExists = migRes.rows[0]?.rel != null

    let currentVersion = 0
    let dbHasData = false
    let failedMigration: SchemaState['failedMigration'] = null

    if (migrationsTableExists) {
      const cur = await client.query(
        `SELECT COALESCE(max(version), 0) AS v FROM public.schema_migrations WHERE status = 'applied'`
      )
      currentVersion = parseInt(cur.rows[0]?.v ?? '0', 10)
      const fail = await client.query(
        `SELECT version, name, error_message FROM public.schema_migrations WHERE status = 'failed' ORDER BY version DESC LIMIT 1`
      )
      if (fail.rows.length > 0) {
        failedMigration = {
          version: parseInt(fail.rows[0].version, 10),
          name: fail.rows[0].name as string,
          error: (fail.rows[0].error_message as string) || '',
        }
      }
    } else {
      const tblRes = await client.query(
        `SELECT count(*) AS cnt FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
      )
      dbHasData = parseInt(tblRes.rows[0]?.cnt ?? '0', 10) > 0
    }

    const pendingMigrations = manifest.migrations.filter((m) => m.version > currentVersion)

    return {
      migrationsTableExists,
      dbHasData,
      currentVersion,
      failedMigration,
      pendingMigrations,
      manifest,
      requiredVersion: requiredSchemaVersion(appVersionOf()),
    }
  } finally {
    await client.end()
  }
}

function appVersionOf(): string {
  return process.env.AHRAM_APP_VERSION || process.env.npm_package_version || '1.3.0'
}

export async function resolveSchemaCompatibility(
  config: PgConnection,
  appVersion?: string
): Promise<SchemaCompatibility> {
  let state: SchemaState
  try {
    state = await getSchemaState(config)
  } catch (err: any) {
    return {
      status: 'unknown',
      state: null,
      detail: `Schema inspection failed: ${err.message}`,
    }
  }

  const required = appVersion ? requiredSchemaVersion(appVersion) : state.requiredVersion

  if (state.currentVersion > state.manifest.schemaVersion) {
    return {
      status: 'schema-newer',
      state,
      detail:
        `Local database schema version ${state.currentVersion} is newer than this app supports ` +
        `(max ${state.manifest.schemaVersion}). A newer version of Ahram ERP upgraded this database. ` +
        `Install the matching app version before continuing.`,
    }
  }

  if (state.currentVersion < required) {
    return {
      status: 'needs-migration',
      state,
      detail:
        `Local database schema version ${state.currentVersion} is below the required version ${required}. ` +
        `${state.pendingMigrations.length} migration(s) pending.`,
    }
  }

  return { status: 'ok', state }
}

export async function migrateSchema(
  config: PgConnection,
  appVersion?: string
): Promise<MigrateResult> {
  const manifest = loadManifest()
  const dir = resolveMigrationsDir()
  const state = await getSchemaState(config)
  const client = await connect(config)
  const applied: Migration[] = []

  try {
    // 1. Ensure the schema_migrations table exists (and adopt/apply the baseline)
    if (!state.migrationsTableExists) {
      await client.query('CREATE SCHEMA IF NOT EXISTS public')
      await client.query(SCHEMA_MIGRATIONS_DDL)

      if (state.dbHasData) {
        // Existing install (provisioned by installer or an older build): the
        // baseline schema is already present — record it without re-running.
        await client.query(
          `INSERT INTO public.schema_migrations (version, name, description, status)
           VALUES ($1, $2, $3, 'applied') ON CONFLICT (version) DO NOTHING`,
          [
            manifest.baselineVersion,
            'baseline',
            'Adopted: database already contained the baseline schema',
          ]
        )
      } else {
        // Truly fresh database — apply the baseline schema.sql first
        const baselineSql = readFileSync(resolveBaselineSchemaPath(), 'utf8')
        await client.query(baselineSql)
        await client.query(
          `INSERT INTO public.schema_migrations (version, name, description, status)
           VALUES ($1, $2, $3, 'applied') ON CONFLICT (version) DO NOTHING`,
          [
            manifest.baselineVersion,
            'baseline',
            'Applied from bundled schema.sql (production snapshot 2026-07-27)',
          ]
        )
      }
    }

    // 2. Apply pending migrations, one transaction each
    const pending = manifest.migrations
      .filter((m) => m.version > state.currentVersion)
      .sort((a, b) => a.version - b.version)

    for (const migration of pending) {
      let sql: string
      try {
        sql = readMigrationSql(dir, migration)
      } catch (err: any) {
        return { success: false, applied, failed: migration, error: err.message }
      }

      try {
        await client.query('BEGIN')
        await client.query(
          `INSERT INTO public.schema_migrations (version, name, description, status)
           VALUES ($1, $2, $3, 'applied')`,
          [migration.version, migration.file, migration.description]
        )
        await client.query(sql)
        await client.query('COMMIT')
        applied.push(migration)
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {})
        try {
          await client.query(
            `INSERT INTO public.schema_migrations (version, name, description, status, error_message)
             VALUES ($1, $2, $3, 'failed', $4)
             ON CONFLICT (version) DO UPDATE SET status = 'failed', error_message = $4, applied_at = now()`,
            [migration.version, migration.file, migration.description, err.message]
          )
        } catch { /* record best-effort */ }
        return { success: false, applied, failed: migration, error: err.message }
      }
    }

    return { success: true, applied }
  } finally {
    await client.end()
  }
}
