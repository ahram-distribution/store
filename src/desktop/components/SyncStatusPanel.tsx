import { useState, useEffect, useCallback, useRef } from 'react'
import { desktopRuntime } from '../../services/desktopRuntime'

type SyncState = 'idle' | 'syncing' | 'completed' | 'failed'
type BackupState = 'idle' | 'selecting' | 'backing_up' | 'completed' | 'failed'

export function SyncStatusPanel() {
  const [online, setOnline] = useState(false)
  const [supabaseReachable, setSupabaseReachable] = useState(false)
  const [dbHealthy, setDbHealthy] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [syncError, setSyncError] = useState('')
  const [backupState, setBackupState] = useState<BackupState>('idle')
  const [backupError, setBackupError] = useState('')
  const [backupResult, setBackupResult] = useState('')

  const mountedRef = useRef(true)

  const checkConnectivity = useCallback(async () => {
    try {
      const status = await desktopRuntime.checkConnectivity()
      if (!mountedRef.current) return
      setOnline(status.networkAvailable && status.supabaseReachable)
      setSupabaseReachable(status.supabaseReachable)
      setDbHealthy(status.localDbAvailable)
      if (status.lastSyncAt) {
        setLastSyncAt(status.lastSyncAt)
      }
    } catch {
      if (!mountedRef.current) return
    }
  }, [])

  useEffect(() => {
    checkConnectivity()
    const interval = setInterval(checkConnectivity, 30000)
    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [checkConnectivity])

  const handleSync = useCallback(async () => {
    setSyncState('syncing')
    setSyncError('')
    try {
      const result = await desktopRuntime.triggerIncrementalSync()
      if (!mountedRef.current) return
      if (result.success) {
        setSyncState('completed')
        await checkConnectivity()
        setTimeout(() => {
          if (mountedRef.current) setSyncState('idle')
        }, 4000)
      } else {
        setSyncState('failed')
        setSyncError(result.message)
      }
    } catch (err: any) {
      if (!mountedRef.current) return
      setSyncState('failed')
      setSyncError(err.message || 'Sync failed')
    }
  }, [checkConnectivity])

  const handleBackup = useCallback(async () => {
    setBackupState('selecting')
    setBackupError('')
    setBackupResult('')
    try {
      const dest = await desktopRuntime.selectBackupDestination()
      if (!mountedRef.current) return
      if (dest.canceled || !dest.filePath) {
        setBackupState('idle')
        return
      }
      setBackupState('backing_up')
      const result = await desktopRuntime.triggerBackup(dest.filePath)
      if (!mountedRef.current) return
      if (result.success) {
        setBackupState('completed')
        setBackupResult(result.message)
        setTimeout(() => {
          if (mountedRef.current) setBackupState('idle')
        }, 6000)
      } else {
        setBackupState('failed')
        setBackupError(result.message)
      }
    } catch (err: any) {
      if (!mountedRef.current) return
      setBackupState('failed')
      setBackupError(err.message || 'Backup failed')
    }
  }, [])

  const formatDateTime = (isoStr: string | null) => {
    if (!isoStr) return '—'
    try {
      const d = new Date(isoStr)
      const day = String(d.getDate()).padStart(2, '0')
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const year = d.getFullYear()
      const hours = d.getHours()
      const minutes = String(d.getMinutes()).padStart(2, '0')
      const amPm = hours >= 12 ? 'م' : 'ص'
      const h12 = hours % 12 || 12
      return `${day}/${month}/${year} - ${h12}:${minutes} ${amPm}`
    } catch {
      return isoStr
    }
  }

  const statusIcon = online ? '🟢' : '⚪'
  const statusText = online ? 'متصل' : 'غير متصل'
  const dbStatusText = dbHealthy ? 'قاعدة البيانات المحلية: جاهزة' : 'قاعدة البيانات المحلية: غير متوفرة'
  const statusTooltip = supabaseReachable
    ? 'الخادم البعيد متاح'
    : online ? 'الخادم البعيد غير متاح' : 'لا يوجد اتصال بالإنترنت'

  const syncText = (() => {
    switch (syncState) {
      case 'syncing': return 'جاري المزامنة...'
      case 'completed': return 'اكتملت المزامنة'
      case 'failed': return `فشلت المزامنة: ${syncError}`
      default: return 'مزامنة الآن'
    }
  })()

  const backupText = (() => {
    switch (backupState) {
      case 'selecting': return 'اختيار الوجهة...'
      case 'backing_up': return 'جاري إنشاء النسخة الاحتياطية...'
      case 'completed': return `تم إنشاء النسخة الاحتياطية`
      case 'failed': return `فشلت النسخة الاحتياطية: ${backupError}`
      default: return 'نسخة احتياطية'
    }
  })()

  const syncDisabled = syncState === 'syncing'
  const backupDisabled = backupState === 'selecting' || backupState === 'backing_up'

  return (
    <div className="desktop-runtime-panel">
      <div className="desktop-runtime-status">
        <span className="desktop-runtime-indicator" title={statusTooltip}>
          {statusIcon}
        </span>
        <span className="desktop-runtime-status-text">{statusText}</span>
        <span className="desktop-runtime-db-status"> ({dbStatusText})</span>
      </div>
      <div className="desktop-runtime-last-sync">
        آخر مزامنة ناجحة: {formatDateTime(lastSyncAt)}
      </div>
      <div className="desktop-runtime-actions">
        <button
          className="desktop-runtime-btn"
          onClick={handleSync}
          disabled={syncDisabled}
          title={syncDisabled ? 'المزامنة قيد التنفيذ' : 'بدء المزامنة'}
        >
          {syncText}
        </button>
        <button
          className="desktop-runtime-btn desktop-runtime-btn-backup"
          onClick={handleBackup}
          disabled={backupDisabled}
          title={backupDisabled ? 'النسخة الاحتياطية قيد التنفيذ' : 'إنشاء نسخة احتياطية'}
        >
          {backupText}
        </button>
        {backupResult && (
          <span className="desktop-runtime-backup-result">{backupResult}</span>
        )}
      </div>
    </div>
  )
}
