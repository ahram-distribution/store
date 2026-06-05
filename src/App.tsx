import { useEffect, useRef, useState } from 'react'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AppRoutes } from './routes'
import { AppLayout } from './layouts/AppLayout'
import { useAuthStore } from './store/auth'
import { SplashScreen } from './components/splash/SplashScreen'
import { InstallBanner } from './components/splash/InstallBanner'
import { OfflinePage } from './components/splash/OfflinePage'

export function App() {
  const [splashDone, setSplashDone] = useState(false)
  const { loading, restoreSession } = useAuthStore()
  const restored = useRef(false)

  useEffect(() => {
    if (!restored.current) {
      restored.current = true
      restoreSession()
    }
  }, [restoreSession])

  if (!splashDone) {
    return (
      <>
        <SplashScreen
          onFinish={() => setSplashDone(true)}
          message={loading ? 'جاري التحقق من المستخدم' : undefined}
        />
        <OfflinePage />
      </>
    )
  }

  return (
    <BrowserRouter>
      {loading ? (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center" style={{ background: '#071B4D' }}>
          {/* Logo */}
          <div
            className="w-20 h-20 mx-auto mb-5 rounded-3xl flex items-center justify-center shadow-2xl"
            style={{
              background: 'linear-gradient(135deg, rgba(201, 162, 39, 0.1) 0%, rgba(201, 162, 39, 0.03) 100%)',
              border: '1px solid rgba(201, 162, 39, 0.12)',
            }}
          >
            <svg width="44" height="44" viewBox="0 0 48 48" fill="none">
              <rect width="48" height="48" rx="8" fill="#C9A227" />
              <text x="24" y="34" textAnchor="middle" fill="#071B4D" fontSize="24" fontWeight="bold" fontFamily="system-ui">أ</text>
            </svg>
          </div>
          <div className="gold-spinner mb-4" />
          <p className="text-sm font-medium" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>جاري التحقق من المستخدم</p>
          <p className="text-xs mt-1.5" style={{ color: 'rgba(255, 255, 255, 0.35)' }}>يرجى الانتظار...</p>
        </div>
      ) : (
        <AppLayout>
          <AppRoutes />
        </AppLayout>
      )}
      <InstallBanner />
      <OfflinePage />
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: {
            background: 'rgba(11, 61, 145, 0.9)',
            color: '#fff',
            fontSize: '14px',
            borderRadius: '16px',
            border: '1px solid rgba(201, 162, 39, 0.15)',
            backdropFilter: 'blur(12px)',
          },
        }}
      />
    </BrowserRouter>
  )
}
