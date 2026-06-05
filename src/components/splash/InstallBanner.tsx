import { useEffect, useState } from 'react'

export function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [show, setShow] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const result = await deferredPrompt.userChoice
    if (result.outcome === 'accepted') {
      setShow(false)
    }
    setDeferredPrompt(null)
  }

  const handleDismiss = () => {
    setShow(false)
    setDismissed(true)
  }

  if (!show || dismissed) return null

  return (
    <div className="fixed bottom-24 left-4 right-4 z-50 animate-slide-up">
      <div
        className="rounded-3xl p-5 shadow-2xl"
        style={{
          background: 'linear-gradient(135deg, rgba(11, 61, 145, 0.85) 0%, rgba(7, 27, 77, 0.95) 100%)',
          backdropFilter: 'blur(16px)',
          border: '1px solid rgba(201, 162, 39, 0.15)',
          boxShadow: '0 12px 48px rgba(0, 0, 0, 0.4)',
        }}
      >
        <div className="flex items-start gap-4">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0"
            style={{
              background: 'linear-gradient(135deg, rgba(201, 162, 39, 0.15) 0%, rgba(201, 162, 39, 0.05) 100%)',
              border: '1px solid rgba(201, 162, 39, 0.15)',
            }}
          >
            <svg width="28" height="28" viewBox="0 0 48 48" fill="none">
              <rect width="48" height="48" rx="8" fill="#C9A227" />
              <text x="24" y="34" textAnchor="middle" fill="#071B4D" fontSize="24" fontWeight="bold" fontFamily="system-ui">أ</text>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-white">تثبيت تطبيق الأهرام</h3>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgba(255, 255, 255, 0.55)' }}>احصل على تجربة أسرع وأكثر استقراراً</p>
            <div className="flex gap-3 mt-4">
              <button
                onClick={handleInstall}
                className="flex-1 py-3 rounded-2xl text-sm font-bold"
                style={{
                  background: 'linear-gradient(135deg, #C9A227 0%, #E0B85A 100%)',
                  color: '#071B4D',
                }}
              >
                تثبيت الآن
              </button>
              <button
                onClick={handleDismiss}
                className="px-5 py-3 rounded-2xl text-xs font-medium transition-colors"
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'rgba(255, 255, 255, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                لاحقاً
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
