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
        <img src={`${import.meta.env.BASE_URL}pwa/branding/logo.png`} alt="الأهرام"
          className="w-24 h-24 mx-auto mb-6 object-contain" />

        <h2 className="text-xl font-bold text-white mb-3">أنت غير متصل بالإنترنت</h2>
        <p className="text-sm leading-relaxed" style={{ color: 'rgba(255, 255, 255, 0.5)' }}>سيتم استعادة الاتصال تلقائياً</p>

        {/* Gold progress */}
        <div className="gold-progress mt-8 mx-auto" />
      </div>
    </div>
  )
}
