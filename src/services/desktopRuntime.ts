interface ConnectivityResult {
  networkAvailable: boolean
  supabaseReachable: boolean
  localDbAvailable: boolean
  lastSyncAt: string | null
  error?: string
}

interface HealthResult {
  healthy: boolean
  lastSyncAt?: string | null
  offlineReady?: boolean
  pendingConflicts?: number
  quarantinedTables?: string[]
  quarantinedOutbox?: number
  error?: string
}

interface BackupDestinationResult {
  canceled: boolean
  filePath: string | null
}

interface SyncResult {
  success: boolean
  message: string
}

interface BackupResult {
  success: boolean
  message: string
}

interface UpdateState {
  isPackaged: boolean
  version: string
  checking: boolean
  downloading: boolean
}

interface UpdateCheckResult {
  success: boolean
  message?: string
  updateAvailable?: boolean
  version?: string
  currentVersion?: string
}

interface UpdateProgress {
  percent: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
}

function getDbApi() {
  const api = (window as any).api?.db
  if (!api) return null
  return api
}

function getUpdateApi() {
  const api = (window as any).api?.update
  if (!api) return null
  return api
}

export const desktopRuntime = {
  async checkConnectivity(): Promise<ConnectivityResult> {
    const api = getDbApi()
    if (!api) return { networkAvailable: false, supabaseReachable: false, localDbAvailable: false, lastSyncAt: null }
    return api.checkConnectivity()
  },

  async triggerIncrementalSync(): Promise<SyncResult> {
    const api = getDbApi()
    if (!api) return { success: false, message: 'Desktop API not available' }
    return api.incrementalSync()
  },

  async triggerBackup(destinationPath?: string): Promise<BackupResult> {
    const api = getDbApi()
    if (!api) return { success: false, message: 'Desktop API not available' }
    return api.backup(destinationPath)
  },

  async selectBackupDestination(): Promise<BackupDestinationResult> {
    const api = getDbApi()
    if (!api) return { canceled: true, filePath: null }
    return api.selectBackupDestination()
  },

  getHealth(): Promise<HealthResult | null> {
    const api = getDbApi()
    if (!api) return Promise.resolve(null)
    return api.health()
  },

  async getAppVersion(): Promise<string | null> {
    const api = getUpdateApi()
    if (!api) return null
    const state = await api.getState()
    return state?.version ?? null
  },

  async checkForUpdates(): Promise<UpdateCheckResult> {
    const api = getUpdateApi()
    if (!api) return { success: false, message: 'Desktop API not available' }
    return api.check()
  },

  async downloadUpdate(): Promise<UpdateCheckResult> {
    const api = getUpdateApi()
    if (!api) return { success: false, message: 'Desktop API not available' }
    return api.download()
  },

  async installUpdate(): Promise<UpdateCheckResult> {
    const api = getUpdateApi()
    if (!api) return { success: false, message: 'Desktop API not available' }
    return api.install()
  },

  onUpdateStatus(callback: (data: { status: string; version?: string; currentVersion?: string; message?: string }) => void): (() => void) | null {
    const api = getUpdateApi()
    if (!api) return null
    api.onStatus(callback)
    return () => { /* preload listeners persist for app lifetime */ }
  },

  onUpdateProgress(callback: (data: UpdateProgress) => void): (() => void) | null {
    const api = getUpdateApi()
    if (!api) return null
    api.onProgress(callback)
    return () => { /* preload listeners persist for app lifetime */ }
  },

  onUpdateDownloaded(callback: (data: { version: string; currentVersion: string }) => void): (() => void) | null {
    const api = getUpdateApi()
    if (!api) return null
    api.onDownloaded(callback)
    return () => { /* preload listeners persist for app lifetime */ }
  },

  async runFullUpdateCycle(): Promise<{ success: boolean; status?: string; message?: string; version?: string; buildId?: string }> {
    const api = getUpdateApi()
    if (!api) return { success: false, message: 'Desktop API not available' }
    return api.fullCycle()
  },

  async restartApp(): Promise<void> {
    const api = getUpdateApi()
    if (!api) return
    await api.restart()
  },
}
