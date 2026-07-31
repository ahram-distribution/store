import { execSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, appendFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { randomBytes } from 'crypto'

export interface PgConnection {
  host: string
  port: number
  database: string
  user: string
  password: string
}

export interface PgStatus {
  installed: boolean
  serviceRunning: boolean
  serviceName: string | null
  version: string | null
  port: number
  dataDir: string | null
  isBundled: boolean
}

export interface PgHealthCheck {
  healthy: boolean
  databaseExists: boolean
  schemaInitialized: boolean
  tableCount: number
  lastSyncAt: string | null
  offlineReady?: boolean
  error?: string
}

export interface ProvisionProgress {
  stage: string
  message: string
  progress: number
}

type ProgressCallback = (progress: ProvisionProgress) => void

const DB_NAME = 'ahram_local'
const DB_USER = 'ahram_app'
const AH_SERVICE_NAME = 'ahram_pg_16'
const AH_PG_VERSION = '16'
const DB_CONFIG_DIR = join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'ahram-desktop')
const DATA_DIR = join(DB_CONFIG_DIR, 'pgdata')
const BUNDLED_PG_DIR = join(app.getPath('userData'), 'pg-bin')
const CONFIG_FILE = join(DB_CONFIG_DIR, 'db-config.json')
const PWD_FILE = join(DB_CONFIG_DIR, 'db-pwd.enc')
const BACKUP_DIR = join(DB_CONFIG_DIR, 'backups')

function getPGBinDir(): string | null {
  // Check bundled PG first — supports both flat and pgsql-subdir layouts
  const layouts = [
    join(BUNDLED_PG_DIR, 'bin'),
    join(BUNDLED_PG_DIR, 'pgsql', 'bin'),
  ]
  for (const dir of layouts) {
    if (existsSync(join(dir, 'psql.exe'))) return dir
  }
  // Scan BUNDLED_PG_DIR subdirectories for any bin/psql.exe
  if (existsSync(BUNDLED_PG_DIR)) {
    try {
      const entries = readdirSync(BUNDLED_PG_DIR, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const candidate = join(BUNDLED_PG_DIR, entry.name, 'bin', 'psql.exe')
          if (existsSync(candidate)) return join(BUNDLED_PG_DIR, entry.name, 'bin')
        }
      }
    } catch { /* ignore */ }
  }
  // Check system PG next
  const systemPaths = [
    'C:\\Program Files\\PostgreSQL\\16\\bin',
    'C:\\Program Files\\PostgreSQL\\15\\bin',
    'C:\\Program Files\\PostgreSQL\\17\\bin',
  ]
  for (const p of systemPaths) {
    if (existsSync(join(p, 'psql.exe'))) return p
  }
  // Check PATH
  try {
    execSync('psql --version', { encoding: 'utf8', timeout: 3000 })
    return ''
  } catch { /* ignore */ }
  return null
}

async function runPowershell(script: string): Promise<string> {
  const oneliner = script.replace(/\s*\n\s*/g, '; ').replace(/\s{2,}/g, ' ').trim()
  return execSync(`powershell -NoProfile -NonInteractive -Command "${oneliner.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
    timeout: 30000,
  }).trim()
}

export async function encryptWithDPAPI(plaintext: string): Promise<string> {
  const script = `
    Add-Type -AssemblyName System.Security
    $scope = [System.Security.Cryptography.DataProtectionScope]::LocalMachine
    $bytes = [System.Text.Encoding]::UTF8.GetBytes(${JSON.stringify(plaintext)})
    $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
    [Convert]::ToBase64String($encrypted)
  `
  return runPowershell(script)
}

export async function decryptWithDPAPI(ciphertext: string): Promise<string> {
  const script = `
    Add-Type -AssemblyName System.Security
    $scope = [System.Security.Cryptography.DataProtectionScope]::LocalMachine
    $bytes = [Convert]::FromBase64String(${JSON.stringify(ciphertext)})
    $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
    [System.Text.Encoding]::UTF8.GetString($decrypted)
  `
  return runPowershell(script)
}

export function generatePassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*'
  let pwd = ''
  const bytes = randomBytes(24)
  for (let i = 0; i < 24; i++) {
    pwd += chars[bytes[i] % chars.length]
  }
  return pwd
}

const LOG_FILE = join(app.getPath('userData'), 'logs', 'provision.log')

export function logProvision(level: string, message: string, error?: unknown): void {
  try {
    const timestamp = new Date().toISOString()
    const errStr = error instanceof Error ? `\n  Stack: ${error.stack}` : error ? `\n  Detail: ${String(error)}` : ''
    const line = `[${timestamp}] [${level}] ${message}${errStr}\n`
    appendFileSync(LOG_FILE, line, 'utf8')
    if (level === 'ERROR') console.error(line.trim())
    else if (level === 'WARN') console.warn(line.trim())
    else console.log(line.trim())
  } catch { /* best-effort */ }
}

export function ensureDirectories(): void {
  const dirs = [DB_CONFIG_DIR, DATA_DIR, BUNDLED_PG_DIR, BACKUP_DIR, join(DB_CONFIG_DIR, 'logs')]
  for (const d of dirs) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
  }
  logProvision('INFO', `Working directories ensured. configDir=${DB_CONFIG_DIR} DATA_DIR=${DATA_DIR} BUNDLED_PG_DIR=${BUNDLED_PG_DIR}`)
}

export function saveDbConfig(config: PgConnection): void {
  const publicConfig = { host: config.host, port: config.port, database: config.database, user: config.user }
  writeFileSync(CONFIG_FILE, JSON.stringify(publicConfig, null, 2), 'utf8')
}

export async function savePassword(password: string): Promise<void> {
  const encrypted = await encryptWithDPAPI(password)
  writeFileSync(PWD_FILE, encrypted, 'utf8')
}

export async function loadPassword(): Promise<string | null> {
  if (!existsSync(PWD_FILE)) return null
  try {
    const encrypted = readFileSync(PWD_FILE, 'utf8').trim()
    return await decryptWithDPAPI(encrypted)
  } catch {
    return null
  }
}

export function loadDbConfig(): Promise<PgConnection | null> {
  if (!existsSync(CONFIG_FILE)) return Promise.resolve(null)
  try {
    const data = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    return loadPassword().then(pwd => {
      if (!pwd) return null
      return { ...data, password: pwd } as PgConnection
    })
  } catch {
    return Promise.resolve(null)
  }
}

export function detectPostgreSQL(): PgStatus {
  logProvision('DEBUG', 'detectPostgreSQL() called')
  const status: PgStatus = {
    installed: false,
    serviceRunning: false,
    serviceName: null,
    version: null,
    port: 5432,
    dataDir: null,
    isBundled: false,
  }

  // Check Ahram's service first
  try {
    const svcOut = execSync(`sc query "${AH_SERVICE_NAME}"`, { encoding: 'utf8', timeout: 5000 })
    if (svcOut.includes('RUNNING')) {
      logProvision('INFO', `Service ${AH_SERVICE_NAME} is RUNNING`)
      status.installed = true
      status.serviceRunning = true
      status.serviceName = AH_SERVICE_NAME
      status.dataDir = DATA_DIR
      status.version = AH_PG_VERSION
      status.isBundled = true
      return status
    }
    if (svcOut.includes('STOPPED')) {
      logProvision('INFO', `Service ${AH_SERVICE_NAME} exists but is STOPPED`)
      status.installed = true
      status.serviceName = AH_SERVICE_NAME
      status.dataDir = DATA_DIR
      status.version = AH_PG_VERSION
      status.isBundled = true
    }
  } catch { /* ignore */ }

  // Check if bundled PG was extracted (binaries exist, but service may NOT be registered)
  const bundledBin = join(BUNDLED_PG_DIR, 'bin', 'psql.exe')
  const bundledPgsqlBin = join(BUNDLED_PG_DIR, 'pgsql', 'bin', 'psql.exe')
  if (existsSync(bundledBin) || existsSync(bundledPgsqlBin)) {
    logProvision('INFO', 'Bundled PostgreSQL binaries found')
    status.installed = true
    status.version = AH_PG_VERSION
    status.isBundled = true
    status.dataDir = DATA_DIR
    // Do NOT set status.serviceName here — service registration is a separate step
  }

  // Fall back to system PG detection
  if (!status.installed) {
    try {
      const out = execSync('psql --version', { encoding: 'utf8', timeout: 3000 }).trim()
      status.installed = true
      const m = out.match(/(\d+\.\d+)/)
      if (m) status.version = m[1]
    } catch {
      const pf = 'C:\\Program Files\\PostgreSQL'
      const pf86 = 'C:\\Program Files (x86)\\PostgreSQL'
      for (const base of [pf, pf86]) {
        if (existsSync(base)) {
          try {
            const entries = require('fs').readdirSync(base)
            for (const e of entries) {
              if (existsSync(join(base, e, 'bin', 'psql.exe'))) {
                status.installed = true
                status.version = e.replace('PostgreSQL ', '')
              }
            }
          } catch { /* ignore */ }
        }
      }
    }

    if (status.installed) {
      try {
        const svcOut = execSync('sc query type= service state= all 2>nul', { encoding: 'utf8', timeout: 5000 })
        const svcMatch = svcOut.match(/SERVICE_NAME:\s*(postgresql[^\s]*)/i)
        if (svcMatch) {
          status.serviceName = svcMatch[1]
          status.serviceRunning = svcOut.includes('RUNNING')
        }
      } catch { /* ignore */ }
    }
  }

  return status
}

export function findAvailablePort(startPort: number): number {
  for (let port = startPort; port < startPort + 100; port++) {
    try {
      const out = execSync(`netstat -an | findstr :${port}`, { encoding: 'utf8', timeout: 3000 })
      if (!out.includes('LISTENING')) return port
    } catch {
      return port
    }
  }
  return startPort
}

export async function tryConnect(config: PgConnection): Promise<boolean> {
  try {
    const { Client } = require('pg')
    const client = new Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      connectionTimeoutMillis: 5000,
    })
    await client.connect()
    await client.query('SELECT 1')
    await client.end()
    return true
  } catch {
    return false
  }
}

export async function createDatabase(config: PgConnection): Promise<boolean> {
  try {
    const { Client } = require('pg')
    // Connect as postgres superuser (trust auth — no password needed)
    const adminClient = new Client({
      host: config.host,
      port: config.port,
      database: 'postgres',
      user: 'postgres',
      password: '',
      connectionTimeoutMillis: 10000,
    })
    logProvision('INFO', `createDatabase: connecting as postgres to host=${config.host} port=${config.port}`)
    await adminClient.connect()
    logProvision('INFO', 'createDatabase: connected as postgres')

    // Create user
    logProvision('INFO', `createDatabase: creating user ${config.user}`)
    await adminClient.query(
      `DO $$ BEGIN
        CREATE USER ${config.user} WITH PASSWORD '${config.password}';
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;`
    )
    await adminClient.query(`ALTER USER ${config.user} WITH SUPERUSER`)
    logProvision('INFO', 'createDatabase: user created/updated')

    // Create database
    const check = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [config.database]
    )
    if (check.rows.length === 0) {
      logProvision('INFO', `createDatabase: creating database ${config.database}`)
      await adminClient.query(`CREATE DATABASE ${config.database} OWNER ${config.user}`)
    } else {
      logProvision('INFO', `createDatabase: database ${config.database} already exists`)
    }

    // Grant privileges
    await adminClient.query(`GRANT ALL PRIVILEGES ON DATABASE ${config.database} TO ${config.user}`)
    logProvision('INFO', 'createDatabase: privileges granted')

    // Connect to the new database and grant schema permissions
    const dbClient = new Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: 'postgres',
      password: '',
      connectionTimeoutMillis: 10000,
    })
    await dbClient.connect()
    await dbClient.query(`GRANT ALL ON SCHEMA public TO ${config.user}`)
    logProvision('INFO', 'createDatabase: schema permissions granted')
    await dbClient.end()

    await adminClient.end()
    logProvision('INFO', 'createDatabase: done')
    return true
  } catch (err) {
    logProvision('ERROR', 'createDatabase failed', err)
    return false
  }
}

export async function checkHealth(config: PgConnection): Promise<PgHealthCheck> {
  const result: PgHealthCheck = {
    healthy: false,
    databaseExists: false,
    schemaInitialized: false,
    tableCount: 0,
    lastSyncAt: null,
  }

  try {
    const { Client } = require('pg')
    const client = new Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      connectionTimeoutMillis: 5000,
    })
    await client.connect()

    result.healthy = true

    const tableRes = await client.query(
      `SELECT count(*) as cnt FROM information_schema.tables 
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    )
    result.tableCount = parseInt(tableRes.rows[0].cnt)
    result.databaseExists = result.tableCount > 0
    result.schemaInitialized = result.tableCount >= 10

    try {
      const syncRes = await client.query(
        `SELECT last_sync_at FROM sync_metadata ORDER BY last_sync_at DESC LIMIT 1`
      )
      if (syncRes.rows.length > 0) {
        result.lastSyncAt = syncRes.rows[0].last_sync_at
      }
    } catch { /* sync_metadata may not exist yet */ }

    await client.end()
  } catch (err: any) {
    result.error = err.message
  }

  return result
}

export async function runSchemaBootstrap(config: PgConnection): Promise<boolean> {
  try {
    const { Client } = require('pg')
    const client = new Client({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      connectionTimeoutMillis: 10000,
    })
    await client.connect()

    // Check in resources path first (packaged app), fall back to __dirname (dev)
    const resSchema = join(process.resourcesPath || '', 'schema.sql')
    const devSchema = join(__dirname, 'schema.sql')
    const schemaPath = existsSync(resSchema) ? resSchema : devSchema
    logProvision('INFO', `runSchemaBootstrap: schemaPath=${schemaPath}`)
    if (!existsSync(schemaPath)) {
      logProvision('ERROR', `Schema file not found at: ${schemaPath} (resourcesPath=${process.resourcesPath} __dirname=${__dirname})`)
      await client.end()
      return false
    }

    const schema = readFileSync(schemaPath, 'utf8')
    logProvision('INFO', `runSchemaBootstrap: schema size=${schema.length} chars, executing...`)
    await client.query(schema)
    logProvision('INFO', 'runSchemaBootstrap: schema executed, applying sync_metadata DDL')
    await client.query(SYNC_METADATA_DDL)

    logProvision('INFO', 'runSchemaBootstrap: done')
    await client.end()
    return true
  } catch (err) {
    logProvision('ERROR', 'runSchemaBootstrap failed', err)
    return false
  }
}



function serviceExists(): boolean {
  try {
    const out = execSync(`sc query "${AH_SERVICE_NAME}"`, { encoding: 'utf8', timeout: 5000 })
    return out.includes('SERVICE_NAME')
  } catch {
    return false
  }
}

function serviceIsRunning(): boolean {
  try {
    const out = execSync(`sc query "${AH_SERVICE_NAME}"`, { encoding: 'utf8', timeout: 5000 })
    return out.includes('RUNNING')
  } catch {
    return false
  }
}

export async function startAhramService(): Promise<boolean> {
  logProvision('INFO', 'startAhramService: checking service status')

  if (!serviceExists()) {
    logProvision('ERROR', 'startAhramService: service does not exist')
    return false
  }

  if (serviceIsRunning()) {
    logProvision('INFO', 'startAhramService: service already running')
    return true
  }

  logProvision('INFO', 'startAhramService: starting service via sc start')
  try {
    execSync(`sc start "${AH_SERVICE_NAME}"`, { encoding: 'utf8', timeout: 30000 })
    logProvision('INFO', 'startAhramService: sc start command sent')
  } catch (err: any) {
    logProvision('ERROR', 'startAhramService: sc start failed', err)
    return false
  }

  // Poll for running state (up to 30 seconds)
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000))
    if (serviceIsRunning()) {
      logProvision('INFO', `startAhramService: service is RUNNING (after ${(i + 1) * 2}s)`)
      return true
    }
    logProvision('DEBUG', `startAhramService: waiting... attempt ${i + 1}/15`)
  }

  logProvision('ERROR', 'startAhramService: service did not reach RUNNING state within 30s')
  return false
}

export async function stopAhramService(): Promise<boolean> {
  try {
    execSync(`sc stop "${AH_SERVICE_NAME}"`, { encoding: 'utf8', timeout: 30000 })
    return true
  } catch {
    return false
  }
}


const SYNC_METADATA_DDL = `
CREATE TABLE IF NOT EXISTS sync_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name varchar(100) NOT NULL,
  last_sync_at timestamptz NOT NULL DEFAULT now(),
  last_sync_cursor varchar(255),
  row_count integer DEFAULT 0,
  sync_status varchar(20) DEFAULT 'idle',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(table_name)
);
CREATE TABLE IF NOT EXISTS sync_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name varchar(100) NOT NULL,
  operation varchar(10) NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  record_id uuid NOT NULL,
  payload jsonb NOT NULL,
  employee_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  synced boolean DEFAULT false,
  synced_at timestamptz,
  retry_count integer DEFAULT 0,
  last_error text
);
CREATE TABLE IF NOT EXISTS sync_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name varchar(100) NOT NULL,
  record_id uuid NOT NULL,
  local_version jsonb NOT NULL,
  remote_version jsonb NOT NULL,
  resolution varchar(20) DEFAULT 'pending' CHECK (resolution IN ('pending', 'local', 'remote', 'merged')),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sync_outbox ADD COLUMN IF NOT EXISTS employee_id uuid;
CREATE INDEX IF NOT EXISTS idx_sync_outbox_unsynced ON sync_outbox (created_at) WHERE synced = false;
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_pending ON sync_conflicts (created_at) WHERE resolution = 'pending';
CREATE INDEX IF NOT EXISTS idx_sync_metadata_table ON sync_metadata (table_name);
`;

export async function getPool(config: PgConnection): Promise<any> {
  const { Pool } = require('pg')
  return new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  })
}

export async function executeQuery(
  config: PgConnection,
  sql: string,
  params?: unknown[]
): Promise<{ rows: Record<string, unknown>[]; rowCount: number; fields: Array<{ name: string; dataType: string }> }> {
  const { Client } = require('pg')
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectionTimeoutMillis: 5000,
  })
  await client.connect()
  try {
    const result = await client.query(sql, params)
    return {
      rows: result.rows,
      rowCount: result.rowCount,
      fields: (result.fields || []).map((f: any) => ({
        name: f.name,
        dataType: f.dataTypeID?.toString() || 'unknown',
      })),
    }
  } finally {
    await client.end()
  }
}

export async function startService(serviceName: string): Promise<boolean> {
  try {
    execSync(`sc start "${serviceName}"`, { encoding: 'utf8', timeout: 15000 })
    return true
  } catch {
    return false
  }
}

export async function stopService(serviceName: string): Promise<boolean> {
  try {
    execSync(`sc stop "${serviceName}"`, { encoding: 'utf8', timeout: 15000 })
    return true
  } catch {
    return false
  }
}

export {
  DB_NAME,
  DB_USER,
  DATA_DIR,
  AH_SERVICE_NAME,
  BACKUP_DIR,
  AH_PG_VERSION,
  BUNDLED_PG_DIR,
  getPGBinDir,
}
