import { useEffect, useState } from 'react'

export function OfflinePage() {
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (online) return null

  return (
    <div className="fixed inset-0 z-[9998] flex flex-col items-center justify-center" style={{ background: '#071B4D' }}>
      <div className="text-center px-8">
        {/* Logo */}
        <div
          className="w-24 h-24 mx-auto mb-6 rounded-3xl flex items-center justify-center shadow-2xl"
          style={{
            background: 'linear-gradient(135deg, rgba(201, 162, 39, 0.1) 0%, rgba(201, 162, 39, 0.03) 100%)',
            border: '1px solid rgba(201, 162, 39, 0.15)',
          }}
        >
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <rect width="48" height="48" rx="8" fill="#C9A227" />
            <text x="24" y="34" textAnchor="middle" fill="#071B4D" fontSize="24" fontWeight="bold" fontFamily="system-ui">أ</text>
          </svg>
        </div>

        <h2 className="text-xl font-bold text-white mb-3">أنت غير متصل بالإنترنت</h2>
        <p className="text-sm leading-relaxed" style={{ color: 'rgba(255, 255, 255, 0.5)' }}>سيتم استعادة الاتصال تلقائياً</p>

        {/* Gold progress */}
        <div className="gold-progress mt-8 mx-auto" />
      </div>
    </div>
  )
}
