import { useCallback, useEffect, useRef, useState } from 'react'
import { desktopRuntime } from '../../services/desktopRuntime'

type UpdatePhase =
  | 'loading'
  | 'idle'
  | 'checking'
  | 'downloading-renderer'
  | 'downloading-migrations'
  | 'applying-migrations'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'restart-required'
  | 'retrying'
  | 'error'
  | 'unsupported'

export function AppUpdater() {
  const [phase, setPhase] = useState<UpdatePhase>('loading')
  const [version, setVersion] = useState<string | null>(null)
  const [newVersion, setNewVersion] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [detailMessage, setDetailMessage] = useState('')
  const [restarting, setRestarting] = useState(false)

  const initialized = useRef(false)

  useEffect(() => {
    desktopRuntime.getAppVersion().then((v) => {
      setVersion(v)
      if (!v) {
        setPhase('unsupported')
      } else {
        setPhase('idle')
        runFullCycle()
      }
    })

    desktopRuntime.onUpdateStatus((data) => {
      setDetailMessage(data.message || '')
      switch (data.status) {
        case 'checking':
          setPhase('checking')
          setError('')
          break
        case 'current':
          setPhase('idle')
          setNewVersion(null)
          setError('')
          break
        case 'available':
          setNewVersion(data.version ?? null)
          setPhase('available')
          break
        case 'not-available':
          setPhase('idle')
          break
        case 'downloading-renderer':
          setPhase('downloading-renderer')
          setProgress(0)
          break
        case 'downloading-migrations':
          setPhase('downloading-migrations')
          break
        case 'applying-migrations':
          setPhase('applying-migrations')
          break
        case 'restart-required':
          setNewVersion(data.version ?? null)
          setPhase('restart-required')
          setError('')
          break
        case 'retrying':
          setPhase('retrying')
          setError('')
          break
        case 'error':
          setError(data.message ?? '')
          setPhase('error')
          break
        default:
          break
      }
    })

    desktopRuntime.onUpdateProgress((data) => {
      setProgress(data.percent ?? 0)
      setPhase('downloading')
    })

    desktopRuntime.onUpdateDownloaded((data) => {
      setNewVersion(data.version ?? null)
      setPhase('downloaded')
    })
  }, [])

  const runFullCycle = useCallback(async () => {
    if (initialized.current) return
    initialized.current = true
    try {
      await desktopRuntime.runFullUpdateCycle()
    } catch {
      try {
        const result = await desktopRuntime.checkForUpdates()
        if (result?.updateAvailable) {
          setNewVersion(result.version ?? null)
          setPhase('available')
        }
      } catch {
        setPhase('unsupported')
      }
    }
  }, [])

  const handleInstall = useCallback(async () => {
    await desktopRuntime.installUpdate()
  }, [])

  const handleRestart = useCallback(async () => {
    if (restarting) return
    console.log('[AppUpdater] Restart button clicked')
    setRestarting(true)
    try {
      await desktopRuntime.restartApp()
    } catch (e) {
      console.error('[AppUpdater] Restart failed:', e)
      setRestarting(false)
    }
  }, [restarting])

  const handleRetry = useCallback(async () => {
    initialized.current = false
    setPhase('idle')
    setError('')
    runFullCycle()
  }, [runFullCycle])

  if (phase === 'unsupported' || phase === 'loading') {
    return null
  }

  const updateButton = (() => {
    switch (phase) {
      case 'checking':
        return <span className="desktop-runtime-update-progress">جاري التحقق من التحديثات...</span>
      case 'downloading-renderer':
        return (
          <span className="desktop-runtime-update-progress">
            جاري تحميل تحديث الواجهة... {progress > 0 ? `${progress}%` : ''}
          </span>
        )
      case 'downloading-migrations':
        return (
          <span className="desktop-runtime-update-progress">
            جاري تحميل تحديثات قاعدة البيانات...
          </span>
        )
      case 'applying-migrations':
        return (
          <span className="desktop-runtime-update-progress">
            جاري تطبيق تحديثات قاعدة البيانات...
          </span>
        )
      case 'available':
      case 'downloading':
        return (
          <span className="desktop-runtime-update-progress">
            يتم تحميل التحديث تلقائيًا... {phase === 'downloading' ? `${progress}%` : ''}
          </span>
        )
      case 'downloaded':
        return (
          <span className="desktop-runtime-update-ready">
            سيتم تثبيت التحديث عند إغلاق التطبيق
            <button className="desktop-runtime-btn desktop-runtime-btn-update" onClick={handleInstall}>
              إعادة التشغيل والتثبيت الآن
            </button>
          </span>
        )
      case 'restart-required':
        return (
          <span className="desktop-runtime-update-ready">
            {detailMessage || 'تحديث جديد جاهز'}
            <button
              className="desktop-runtime-btn desktop-runtime-btn-update"
              onClick={handleRestart}
              disabled={restarting}
            >
              {restarting ? 'جاري إعادة التشغيل...' : 'إعادة التشغيل الآن'}
            </button>
          </span>
        )
      case 'retrying':
        return (
          <span className="desktop-runtime-update-progress">
            {detailMessage || 'جاري إعادة المحاولة تلقائيًا...'}
          </span>
        )
      case 'error':
        return (
          <button className="desktop-runtime-btn" onClick={handleRetry}>
            إعادة المحاولة
          </button>
        )
      default:
        return null
    }
  })()

  return (
    <div className="desktop-runtime-panel">
      <div className="desktop-runtime-status">
        <span className="desktop-runtime-status-text">الإصدار {version}</span>
      </div>
      <div className="desktop-runtime-actions">
        {error && phase === 'error' && (
          <span className="desktop-runtime-update-error" title={error}>
            فشل التحديث
          </span>
        )}
        {updateButton}
      </div>
    </div>
  )
}
