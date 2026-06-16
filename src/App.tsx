import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AppRoutes } from './routes'
import { AppLayout } from './layouts/AppLayout'
import { useAuthStore } from './store/auth'
import { SplashScreen } from './components/splash/SplashScreen'
import { InstallBanner } from './components/splash/InstallBanner'
import { OfflinePage } from './components/splash/OfflinePage'
import { ThemeProvider } from './context/ThemeContext'
import { notificationService } from './services/notificationService'
import { healthMonitor } from './utils/pageHealthCheck'

const isNative = typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.()
const Router = isNative ? HashRouter : BrowserRouter
export function App() {
  const [splashDone, setSplashDone] = useState(false)
  const { loading, restoreSession } = useAuthStore()
  const restored = useRef(false)

  useEffect(() => {
    healthMonitor.start()
  }, [])

  useEffect(() => {
    if (!restored.current) {
      restored.current = true
      restoreSession()
    }
  }, [restoreSession])

  useEffect(() => {
    if (!loading) {
      notificationService.register().then(() => notificationService.addListeners())
    }
    return () => { notificationService.removeAllListeners() }
  }, [loading])

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
    <Router basename={isNative ? undefined : '/store/'}>
      {loading ? (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center" style={{ background: '#071B4D' }}>
          {/* Logo */}
          <img src={`${import.meta.env.BASE_URL}pwa/branding/logo.png`} alt="الأهرام"
            className="w-20 h-20 mx-auto mb-5 object-contain" />
          <div className="gold-spinner mb-4" />
          <p className="text-sm font-medium" style={{ color: 'rgba(255, 255, 255, 0.7)' }}>جاري التحقق من المستخدم</p>
          <p className="text-xs mt-1.5" style={{ color: 'rgba(255, 255, 255, 0.35)' }}>يرجى الانتظار...</p>
        </div>
      ) : (
        <ThemeProvider>
          <AppLayout>
            <AppRoutes />
          </AppLayout>
        </ThemeProvider>
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
    </Router>
  )
}
