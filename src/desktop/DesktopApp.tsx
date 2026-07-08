import { Toaster } from 'react-hot-toast'
import { BrowserRouter } from 'react-router-dom'
import { DesktopLayout } from './layout/DesktopLayout'
import { ThemeProvider } from '../context/ThemeContext'
import { BootstrapProvider } from './context/BootstrapProvider'
import { LoginScreen } from './pages/LoginScreen'
import { useAuthStore } from '../store/auth'
import { useEffect, useRef, useState } from 'react'
import { OfflinePage } from '../components/splash/OfflinePage'

export function DesktopShell() {
  const { loading, token, restoreSession } = useAuthStore()
  const [ready, setReady] = useState(false)
  const restored = useRef(false)

  useEffect(() => {
    if (!restored.current) {
      restored.current = true
      restoreSession()
    }
  }, [restoreSession])

  useEffect(() => {
    if (!loading) setReady(true)
  }, [loading])

  if (!ready) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0B3D91',
      }}>
        <div style={{
          width: 40,
          height: 40,
          border: '3px solid rgba(255,255,255,0.2)',
          borderTopColor: '#C9A227',
          borderRadius: '50%',
          animation: 'dt-spin 0.8s linear infinite',
          marginBottom: 16,
        }} />
        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>جاري التحميل...</p>
      </div>
    )
  }

  if (!token) return <LoginScreen />

  return (
    <BrowserRouter>
      <ThemeProvider>
        <BootstrapProvider>
          <DesktopLayout />
          <OfflinePage />
          <Toaster
            position="top-center"
            toastOptions={{
              duration: 3000,
              style: {
                background: 'rgba(11, 61, 145, 0.9)',
                color: '#fff',
                fontSize: 13,
                borderRadius: 8,
                border: '1px solid rgba(201, 162, 39, 0.15)',
              },
            }}
          />
          <style>{`
            @keyframes dt-spin { to { transform: rotate(360deg); } }
            @keyframes dt-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
          `}</style>
        </BootstrapProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
