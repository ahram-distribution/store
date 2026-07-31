import { execSync } from 'child_process'
import { existsSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { PgConnection, BACKUP_DIR } from './PostgreSQLManager'

const MAX_BACKUPS = 7
const BACKUP_PREFIX = 'ahram_backup_'

export interface BackupResult {
  success: boolean
  filePath?: string
  size?: number
  error?: string
}

export async function createBackup(config: PgConnection, customPath?: string): Promise<BackupResult> {
  try {
    let filePath: string
    if (customPath) {
      filePath = customPath
      // Ensure parent dir exists
      const { dirname } = require('path')
      const parentDir = dirname(customPath)
      if (!existsSync(parentDir)) {
        require('fs').mkdirSync(parentDir, { recursive: true })
      }
    } else {
      if (!existsSync(BACKUP_DIR)) {
        require('fs').mkdirSync(BACKUP_DIR, { recursive: true })
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fileName = `${BACKUP_PREFIX}${timestamp}.sql`
      filePath = join(BACKUP_DIR, fileName)
    }

    // Locate pg_dump — prefer bundled Ahram PostgreSQL, then system, then PATH
    let pgDumpCmd: string | null = null

    // 1. Check bundled PostgreSQL (deployed alongside the app)
    //    Expected layout: <app-install-dir>\pg-bin\pgsql\bin\pg_dump.exe
    const bundledCandidates: string[] = []

    // 1a. Electron production: process.resourcesPath = <app>/resources/
    //     Bundled PG is at <app>/pg-bin/pgsql/bin/
    if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
      bundledCandidates.push(
        join(process.resourcesPath, '..', 'pg-bin', 'pgsql', 'bin', 'pg_dump.exe')
      )
    }

    // 1b. Dev/embedded: installed in LOCALAPPDATA
    const localAppData = process.env.LOCALAPPDATA || ''
    if (localAppData) {
      bundledCandidates.push(
        join(localAppData, 'Programs', 'Ahram ERP', 'pg-bin', 'pgsql', 'bin', 'pg_dump.exe')
      )
    }

    // 1c. Also check ProgramData ahram-desktop layout
    const progData = process.env.PROGRAMDATA || 'C:\\ProgramData'
    bundledCandidates.push(
      join(progData, 'ahram-desktop', 'pg-bin', 'pgsql', 'bin', 'pg_dump.exe')
    )

    for (const candidate of bundledCandidates) {
      if (existsSync(candidate)) {
        try {
          execSync(`"${candidate}" --version`, { encoding: 'utf8', timeout: 3000 })
          pgDumpCmd = candidate
          break
        } catch { /* continue */ }
      }
    }

    // 2. Fallback: hardcoded system PostgreSQL install locations
    if (!pgDumpCmd) {
      const fallbackPaths = [
        'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
        'C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe',
        'pg_dump',
      ]
      for (const p of fallbackPaths) {
        try {
          execSync(`"${p}" --version`, { encoding: 'utf8', timeout: 3000 })
          pgDumpCmd = p
          break
        } catch { /* continue */ }
      }
    }

    if (!pgDumpCmd) {
      return { success: false, error: 'pg_dump not found. PostgreSQL may not be installed.' }
    }

    // Set password for pg_dump
    const env = { ...process.env, PGPASSWORD: config.password }

    execSync(
      `"${pgDumpCmd}" -h ${config.host} -p ${config.port} -U ${config.user} -d ${config.database} --no-owner --no-privileges -f "${filePath}"`,
      { encoding: 'utf8', timeout: 120000, env }
    )

    if (!existsSync(filePath)) {
      return { success: false, error: 'Backup file was not created' }
    }

    const stat = statSync(filePath)

    // Clean old backups
    cleanOldBackups()

    return { success: true, filePath, size: stat.size }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

export async function restoreBackup(config: PgConnection, backupPath: string): Promise<BackupResult> {
  if (!existsSync(backupPath)) {
    return { success: false, error: 'Backup file not found' }
  }

  try {
    const psqlPaths = [
      'psql',
      'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
      'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
      'C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe',
    ]

    let psqlCmd: string | null = null
    for (const p of psqlPaths) {
      try {
        execSync(`"${p}" --version`, { encoding: 'utf8', timeout: 3000 })
        psqlCmd = p
        break
      } catch { /* continue */ }
    }

    if (!psqlCmd) {
      return { success: false, error: 'psql not found' }
    }

    const env = { ...process.env, PGPASSWORD: config.password }
    execSync(
      `"${psqlCmd}" -h ${config.host} -p ${config.port} -U ${config.user} -d ${config.database} -f "${backupPath}"`,
      { encoding: 'utf8', timeout: 120000, env }
    )

    return { success: true, filePath: backupPath }
  } catch (err: any) {
    return { success: false, error: err.message }
  }
}

function cleanOldBackups(): void {
  if (!existsSync(BACKUP_DIR)) return

  const files = readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith(BACKUP_PREFIX) && f.endsWith('.sql'))
    .map(f => ({
      name: f,
      path: join(BACKUP_DIR, f),
      time: statSync(join(BACKUP_DIR, f)).mtimeMs,
    }))
    .sort((a, b) => b.time - a.time)

  // Keep only MAX_BACKUPS
  for (let i = MAX_BACKUPS; i < files.length; i++) {
    try {
      unlinkSync(files[i].path)
    } catch { /* ignore */ }
  }
}

export function listBackups(): Array<{ name: string; path: string; size: number; date: string }> {
  if (!existsSync(BACKUP_DIR)) return []

  return readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith(BACKUP_PREFIX) && f.endsWith('.sql'))
    .map(f => {
      const fullPath = join(BACKUP_DIR, f)
      const stat = statSync(fullPath)
      return {
        name: f,
        path: fullPath,
        size: stat.size,
        date: new Date(stat.mtimeMs).toISOString(),
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
}

export function shouldBackup(config: PgConnection): boolean {
  const backups = listBackups()
  if (backups.length === 0) return true

  const lastBackup = new Date(backups[0].date)
  const hoursSinceBackup = (Date.now() - lastBackup.getTime()) / (1000 * 60 * 60)
  return hoursSinceBackup >= 24
}
