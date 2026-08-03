import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AppRoutes } from './routes'
import { AppLayout } from './layouts/AppLayout'
import { DesktopAppLayout } from './layouts/DesktopAppLayout'
import { useAuthStore } from './store/auth'
import { useNotificationStore } from './store/notifications'
import { useEntityViewsStore } from './store/entityViews'
import { notificationInboxService } from './services/notifications'
import { SplashScreen } from './components/splash/SplashScreen'
import { NotificationToast } from './components/notifications/NotificationToast'

import { OfflinePage } from './components/splash/OfflinePage'
import { ThemeProvider } from './context/ThemeContext'
import { notificationService } from './services/notificationService'
import { healthMonitor } from './utils/pageHealthCheck'
import { lifeSignalService } from './services/lifeSignalService'
import { useSWUpdate } from './hooks/useSWUpdate'

const isDesktop = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')

const Router = HashRouter
export function App() {
  useSWUpdate()
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
      lifeSignalService.handleAppOpen()

      // Notification system: fetch initial unread + subscribe to realtime
      const { user } = useAuthStore.getState()
      if (user?.identity_type === 'employee') {
        useNotificationStore.getState().fetchInitial()
        const tok = localStorage.getItem('session_token')
        if (tok) useEntityViewsStore.getState().fetchUnseenCounts(tok)
        const unsub = notificationInboxService.subscribeToNotifications((n) => {
          useNotificationStore.getState().prependNotification(n)
          useNotificationStore.getState().showToast(n)
        })
        return () => {
          notificationService.removeAllListeners()
          unsub()
        }
      }
    }
    return () => { notificationService.removeAllListeners() }
  }, [loading])

  useEffect(() => {
    const unsub = useAuthStore.subscribe((state, prev) => {
      if (prev.token && !state.token) {
        useNotificationStore.getState().reset()
        useEntityViewsStore.getState().reset()
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        lifeSignalService.handleAppResume()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  if (!splashDone) {
    return (
      <>
        <SplashScreen
          onFinish={() => setSplashDone(true)}
          message={loading ? 'جاري التحقق من المستخدم' : undefined}
        />
        {!isDesktop && <OfflinePage />}
      </>
    )
  }

  return (
    <Router>
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
          {isDesktop ? (
            <DesktopAppLayout>
              <AppRoutes />
            </DesktopAppLayout>
          ) : (
            <AppLayout>
              <AppRoutes />
            </AppLayout>
          )}
        </ThemeProvider>
      )}
      {!isDesktop && <OfflinePage />}
      <NotificationToast />
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
