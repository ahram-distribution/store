import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fetchReleaseManifest, compareManifests, type ManifestComparison, type ReleaseManifest } from './ReleaseManifest'
import { downloadRendererAssets } from './RendererUpdater'
import { fetchRemoteMigrationsManifest, downloadMigrationFiles, applyRemoteMigrations } from './MigrationUpdater'
import {
  loadUpdateState, saveUpdateState, pendingRendererDir,
  setActiveRendererBuild, isRendererCached, rendererCacheDir,
  clearRetryState, incrementRetryState, isRetryBlocked,
  type UpdateState,
} from './UpdateState'
import type { PgConnection } from '../db/PostgreSQLManager'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'downloading-renderer'
  | 'downloading-migrations'
  | 'applying-migrations'
  | 'applying-renderer'
  | 'restart-required'
  | 'retrying'
  | 'error'
  | 'current'

export interface UpdateInfo {
  status: UpdateStatus
  version?: string
  currentVersion?: string
  buildId?: string
  message?: string
  progress?: number
  comparison?: ManifestComparison
}

// D22: Single-writer mutex — only one update cycle may execute at a time.
// Concurrent requests coalesce onto the same running Promise.
let activeCyclePromise: Promise<UpdateInfo> | null = null
let activationInProgress = false
let rollbackInProgress = false

function notifyWindows(channel: string, data: Record<string, unknown>): void {
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data)
    }
  })
}

function notifyUpdate(info: UpdateInfo): void {
  notifyWindows('update:status', {
    status: info.status,
    version: info.version,
    currentVersion: info.currentVersion,
    message: info.message,
    buildId: info.buildId,
    progress: info.progress,
  })
}

function getLocalSchemaVersion(): number {
  try {
    const migrationsDir = resolveLocalMigrationsDir()
    const manifest = JSON.parse(readFileSync(join(migrationsDir, 'manifest.json'), 'utf8'))
    return manifest.schemaVersion || 1
  } catch {
    return 1
  }
}

function resolveLocalMigrationsDir(): string {
  const candidates = [
    typeof process.resourcesPath === 'string' ? join(process.resourcesPath, 'migrations') : '',
    join(__dirname, 'migrations'),
    join(__dirname, '..', '..', '..', 'main', 'db', 'migrations'),
  ]
  for (const dir of candidates) {
    if (dir && require('fs').existsSync(join(dir, 'manifest.json'))) return dir
  }
  return join(__dirname, 'migrations')
}

export async function checkForUpdates(dbConfig?: PgConnection | null): Promise<UpdateInfo> {
  const state = loadUpdateState()
  const localBuildId = state.appliedBuildId
  const localSchemaVersion = getLocalSchemaVersion()
  const localAppVersion = app.getVersion()

  notifyUpdate({ status: 'checking', currentVersion: localAppVersion })

  const manifest = await fetchReleaseManifest()
  if (!manifest) {
    const info: UpdateInfo = {
      status: 'current',
      currentVersion: localAppVersion,
      message: 'Unable to check for updates (offline or server unavailable).',
    }
    notifyUpdate(info)
    return info
  }

  const comparison = compareManifests(manifest, localBuildId, localSchemaVersion, localAppVersion)
  const somethingChanged = comparison.rendererChanged || comparison.schemaNeedsUpgrade

  state.lastCheckedBuildId = manifest.build_id
  state.lastCheckedAt = new Date().toISOString()

  if (comparison.isCurrent) {
    clearRetryState(state)
    state.lastSuccessfulCheckAt = new Date().toISOString()
    saveUpdateState(state)
    const info: UpdateInfo = {
      status: 'current',
      currentVersion: localAppVersion,
      buildId: manifest.build_id,
      message: 'Application is up to date.',
      comparison,
    }
    notifyUpdate(info)
    return info
  }

  if (comparison.appNeedsUpgrade) {
    saveUpdateState(state)
    const info: UpdateInfo = {
      status: 'restart-required',
      version: manifest.app_version,
      currentVersion: localAppVersion,
      buildId: manifest.build_id,
      message: `New application version ${manifest.app_version} is available. Restart to update.`,
      comparison,
    }
    notifyUpdate(info)
    return info
  }

  if (isRetryBlocked(state)) {
    saveUpdateState(state)
    const info: UpdateInfo = {
      status: 'retrying',
      currentVersion: localAppVersion,
      buildId: manifest.build_id,
      message: `Update temporarily delayed. Will retry automatically.`,
      comparison,
    }
    notifyUpdate(info)
    return info
  }

  let rendererOk = !comparison.rendererChanged
  let migrationsOk = !comparison.schemaNeedsUpgrade

  if (comparison.rendererChanged) {
    rendererOk = await downloadNewRenderer(manifest, localBuildId)
  }

  if (comparison.schemaNeedsUpgrade && dbConfig) {
    migrationsOk = await downloadAndApplyMigrations(dbConfig, manifest.required_schema_version)
  }

  if (rendererOk && migrationsOk && somethingChanged) {
    const finalState = loadUpdateState()
    clearRetryState(finalState)
    finalState.lastSuccessfulCheckAt = new Date().toISOString()
    saveUpdateState(finalState)
    const info: UpdateInfo = {
      status: 'restart-required',
      version: manifest.app_version,
      currentVersion: localAppVersion,
      buildId: manifest.build_id,
      message: 'Updates applied. Restart to activate.',
      comparison,
    }
    notifyUpdate(info)
    return info
  }

  const retryState = loadUpdateState()
  incrementRetryState(retryState)
  saveUpdateState(retryState)

  const reasons: string[] = []
  if (comparison.rendererChanged && !rendererOk) reasons.push('renderer')
  if (comparison.schemaNeedsUpgrade && !migrationsOk) reasons.push('migrations')

  const retryInfo: UpdateInfo = {
    status: 'retrying',
    currentVersion: localAppVersion,
    buildId: manifest.build_id,
    message: `Update partially failed (${reasons.join(', ')}). Will retry automatically.`,
    comparison,
  }
  notifyUpdate(retryInfo)
  return retryInfo
}

async function downloadNewRenderer(
  manifest: ReleaseManifest,
  _localBuildId: string | null,
): Promise<boolean> {
  if (isRendererCached(manifest.build_id)) {
    console.log(`[Update] Renderer ${manifest.build_id} already cached`)
    return true
  }

  notifyUpdate({ status: 'downloading-renderer', buildId: manifest.build_id })

  const targetDir = rendererCacheDir(manifest.build_id)

  const result = await downloadRendererAssets(manifest, targetDir, (done, total) => {
    notifyUpdate({
      status: 'downloading-renderer',
      buildId: manifest.build_id,
      progress: total > 0 ? Math.round((done / total) * 100) : 0,
    })
  })

  if (!result.success) {
    const errMsg = result.errors[0] || 'unknown error'
    console.error(`[Update] Renderer download failed: ${result.errors.join(', ')}`)
    return false
  }

  const state = loadUpdateState()
  state.pendingRendererBuildId = manifest.build_id
  saveUpdateState(state)

  console.log(`[Update] Renderer ${manifest.build_id} downloaded to pending cache`)
  return true
}

async function downloadAndApplyMigrations(
  config: PgConnection,
  requiredSchemaVersion: number,
): Promise<boolean> {
  notifyUpdate({ status: 'downloading-migrations' })

  const remoteManifest = await fetchRemoteMigrationsManifest()
  if (!remoteManifest) {
    console.warn('[Update] Could not fetch remote migrations manifest')
    return false
  }

  const localSchemaVersion = getLocalSchemaVersion()
  if (requiredSchemaVersion <= localSchemaVersion) {
    console.log(`[Update] Local schema v${localSchemaVersion} meets required v${requiredSchemaVersion}`)
    return true
  }

  const downloaded = await downloadMigrationFiles(remoteManifest, localSchemaVersion)
  if (downloaded.length === 0) {
    console.log('[Update] No new migrations to download')
    return true
  }

  notifyUpdate({ status: 'applying-migrations' })

  const result = await applyRemoteMigrations(config, downloaded)
  if (result.failed) {
    console.error(`[Update] Migration failed: ${result.failed}`)
    return false
  }

  console.log(`[Update] Applied ${result.applied} remote migration(s)`)
  return true
}

export async function activatePendingRenderer(): Promise<boolean> {
  // D22: Reject concurrent activation attempts
  if (activationInProgress) {
    console.warn('[Update] Activation already in progress — rejecting duplicate request')
    return false
  }
  activationInProgress = true
  try {
    return await doActivatePendingRenderer()
  } finally {
    activationInProgress = false
  }
}

async function doActivatePendingRenderer(): Promise<boolean> {
  const state = loadUpdateState()
  if (!state.pendingRendererBuildId) return false

  const buildId = state.pendingRendererBuildId
  if (!isRendererCached(buildId)) {
    console.warn(`[Update] Pending renderer ${buildId} not found in cache`)
    return false
  }

  state.previousAppliedBuildId = state.appliedBuildId

  setActiveRendererBuild(buildId)

  state.appliedBuildId = buildId
  state.appliedAt = new Date().toISOString()
  state.pendingRendererBuildId = null
  clearRetryState(state)
  saveUpdateState(state)

  console.log(`[Update] Renderer ${buildId} activated (previous: ${state.previousAppliedBuildId || 'none'})`)
  return true
}

export async function performFullUpdateCycle(dbConfig?: PgConnection | null): Promise<UpdateInfo> {
  // D22: Coalesce concurrent requests — return the existing promise if a cycle is active
  if (activeCyclePromise) {
    return activeCyclePromise
  }

  activeCyclePromise = executeCycle(dbConfig).finally(() => {
    activeCyclePromise = null
  })

  return activeCyclePromise
}

async function executeCycle(dbConfig?: PgConnection | null): Promise<UpdateInfo> {
  try {
    const result = await checkForUpdates(dbConfig)
    return result
  } catch (err: any) {
    const state = loadUpdateState()
    state.lastError = err.message
    incrementRetryState(state)
    saveUpdateState(state)

    const info: UpdateInfo = {
      status: 'retrying',
      message: `Update check failed: ${err.message}. Will retry.`,
    }
    notifyUpdate(info)
    return info
  }
}

export function rollbackToPreviousRenderer(): boolean {
  // D22: Reject concurrent rollback attempts
  if (rollbackInProgress) {
    console.warn('[Update] Rollback already in progress — rejecting duplicate request')
    return false
  }
  rollbackInProgress = true
  try {
    const state = loadUpdateState()
    if (!state.previousAppliedBuildId) {
      console.warn('[Update] No previous renderer to rollback to')
      return false
    }
    if (!isRendererCached(state.previousAppliedBuildId)) {
      console.warn(`[Update] Previous renderer ${state.previousAppliedBuildId} not in cache`)
      return false
    }

    setActiveRendererBuild(state.previousAppliedBuildId)
    state.appliedBuildId = state.previousAppliedBuildId
    state.previousAppliedBuildId = null
    state.pendingRendererBuildId = null
    clearRetryState(state)
    saveUpdateState(state)

    console.log(`[Update] Rolled back to renderer ${state.appliedBuildId}`)
    return true
  } finally {
    rollbackInProgress = false
  }
}

export { loadUpdateState, getActiveRendererPath } from './UpdateState'
