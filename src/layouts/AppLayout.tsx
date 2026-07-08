import { type ReactNode } from 'react'
import { useAuthStore } from '../store/auth'
import { useVisitsStore } from '../store/visits'
import { useCartStore } from '../store/cart'
import { BottomNav } from '../components/shared/BottomNav'
import { TopBar } from '../components/shared/TopBar'
import { ErrorBoundary } from '../components/shared/ErrorBoundary'
import { useLocation, useNavigate } from 'react-router-dom'

interface AppLayoutProps {
  children: ReactNode
}

export function AppLayout({ children }: AppLayoutProps) {
  const { token } = useAuthStore()
  const { activeVisit } = useVisitsStore()
  const items = useCartStore((s) => s.items)
  const location = useLocation()
  const navigate = useNavigate()

  const cartCount = items.length

  if (location.pathname === '/login' || location.pathname === '/register') {
    return <ErrorBoundary><>{children}</></ErrorBoundary>
  }

  if (!token) {
    return (
      <div className="mobile-container safe-top">
        <main className="px-4 pb-8 pt-4 min-h-screen">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    )
  }

  return (
    <div className="mobile-container safe-top">
      <TopBar />
      <main className="px-4 pb-24 pt-4 min-h-screen">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>

      {/* Floating Cart FAB — shown whenever cart has items */}
      {cartCount > 0 && (
        <button
          onClick={() => navigate('/cart')}
          className="fixed bottom-28 right-4 z-50 flex items-center justify-center active:opacity-90 transition-opacity shadow-xl bg-primary text-white"
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '28px',
          }}
          title="فتح السلة"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
          </svg>
          {cartCount > 0 && (
            <span className="absolute -top-1 -right-1 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center bg-danger shadow">
              {cartCount}
            </span>
          )}
        </button>
      )}

      {/* Active Visit FAB */}
      {activeVisit && !location.pathname.startsWith('/visits') && (
        <button
          onClick={() => navigate('/visits/screen')}
          className="fixed bottom-28 left-4 z-50 flex items-center justify-center active:opacity-90 transition-opacity shadow-xl bg-success text-white"
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '28px',
          }}
          title="الرجوع للزيارة النشطة"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      )}

      <BottomNav />
    </div>
  )
}
