import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface UpdateState {
  lastCheckedBuildId: string | null
  lastCheckedAt: string | null
  appliedBuildId: string | null
  appliedAt: string | null
  pendingRendererBuildId: string | null
  lastError: string | null
}

const STATE_FILE = 'update-state.json'

function stateDir(): string {
  const dir = app.isPackaged
    ? join(app.getPath('userData'), 'ahram-desktop')
    : join(app.getPath('userData'), 'ahram-desktop-dev')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function statePath(): string {
  return join(stateDir(), STATE_FILE)
}

export function loadUpdateState(): UpdateState {
  try {
    if (existsSync(statePath())) {
      return JSON.parse(readFileSync(statePath(), 'utf8')) as UpdateState
    }
  } catch { /* ignore corrupt state */ }
  return {
    lastCheckedBuildId: null,
    lastCheckedAt: null,
    appliedBuildId: null,
    appliedAt: null,
    pendingRendererBuildId: null,
    lastError: null,
  }
}

export function saveUpdateState(state: UpdateState): void {
  try {
    writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf8')
  } catch (err) {
    console.warn('[UpdateState] Failed to save:', (err as Error).message)
  }
}

export function rendererCacheDir(buildId?: string): string {
  const id = buildId || loadUpdateState().appliedBuildId
  if (!id) return ''
  const dir = join(stateDir(), 'renderer-cache', id)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function pendingRendererDir(): string {
  const dir = join(stateDir(), 'renderer-pending')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function migrationsCacheDir(): string {
  const dir = join(stateDir(), 'remote-migrations')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function currentRendererDir(): string {
  return join(stateDir(), 'renderer-current')
}

export function isRendererCached(buildId: string): boolean {
  const dir = join(stateDir(), 'renderer-cache', buildId)
  return existsSync(dir) && existsSync(join(dir, 'index.html'))
}

export function getActiveRendererPath(): string | null {
  const markerPath = join(stateDir(), 'renderer-active-build')
  try {
    if (existsSync(markerPath)) {
      const buildId = readFileSync(markerPath, 'utf8').trim()
      if (buildId && isRendererCached(buildId)) {
        return join(stateDir(), 'renderer-cache', buildId)
      }
    }
  } catch { /* ignore */ }
  return null
}

export function setActiveRendererBuild(buildId: string): void {
  try {
    writeFileSync(join(stateDir(), 'renderer-active-build'), buildId, 'utf8')
  } catch { /* ignore */ }
}
