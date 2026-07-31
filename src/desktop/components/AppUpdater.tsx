import { useCallback, useEffect, useRef, useState } from 'react'
import { desktopRuntime } from '../../services/desktopRuntime'

type UpdatePhase =
  | 'loading'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported'

export function AppUpdater() {
  const [phase, setPhase] = useState<UpdatePhase>('loading')
  const [version, setVersion] = useState<string | null>(null)
  const [newVersion, setNewVersion] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  const initialized = useRef(false)

  useEffect(() => {
    desktopRuntime.getAppVersion().then((v) => {
      setVersion(v)
      if (!v) {
        setPhase('unsupported')
      } else {
        setPhase('idle')
        checkForUpdates()
      }
    })

    desktopRuntime.onUpdateStatus((data) => {
      switch (data.status) {
        case 'checking':
          setPhase('checking')
          break
        case 'available':
          setNewVersion(data.version ?? null)
          setPhase('available')
          break
        case 'not-available':
          setPhase('idle')
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

  const checkForUpdates = useCallback(async () => {
    if (initialized.current) return
    initialized.current = true
    try {
      const result = await desktopRuntime.checkForUpdates()
      if (result?.updateAvailable) {
        setNewVersion(result.version ?? null)
        setPhase('available')
      } else if (result?.success === false && result.message) {
        setPhase('unsupported')
      }
    } catch {
      setPhase('unsupported')
    }
  }, [])

  const handleDownload = useCallback(async () => {
    setPhase('downloading')
    setError('')
    const result = await desktopRuntime.downloadUpdate()
    if (result?.success === false) {
      setError(result.message ?? '')
      setPhase('error')
    }
  }, [])

  const handleInstall = useCallback(async () => {
    await desktopRuntime.installUpdate()
  }, [])

  if (phase === 'unsupported' || phase === 'loading') {
    return null
  }

  const updateButton = (() => {
    switch (phase) {
      case 'checking':
        return <button className="desktop-runtime-btn" disabled>جاري التحقق من التحديثات...</button>
      case 'available':
        return (
          <button className="desktop-runtime-btn desktop-runtime-btn-update" onClick={handleDownload}>
            تثبيت الإصدار {newVersion}
          </button>
        )
      case 'downloading':
        return (
          <span className="desktop-runtime-update-progress">
            جاري التحميل... {progress}%
          </span>
        )
      case 'downloaded':
        return (
          <button className="desktop-runtime-btn desktop-runtime-btn-update" onClick={handleInstall}>
            إعادة التشغيل والتثبيت
          </button>
        )
      case 'error':
        return (
          <button className="desktop-runtime-btn" onClick={() => desktopRuntime.checkForUpdates()}>
            إعادة المحاولة
          </button>
        )
      default:
        return (
          <button
            className="desktop-runtime-btn"
            onClick={() => { initialized.current = false; checkForUpdates() }}
          >
            التحقق من التحديثات
          </button>
        )
    }
  })()

  return (
    <div className="desktop-runtime-panel">
      <div className="desktop-runtime-status">
        <span className="desktop-runtime-status-text">الإصدار {version}</span>
      </div>
      <div className="desktop-runtime-actions">
        {error && (
          <span className="desktop-runtime-update-error" title={error}>
            فشل التحديث
          </span>
        )}
        {updateButton}
      </div>
    </div>
  )
}
