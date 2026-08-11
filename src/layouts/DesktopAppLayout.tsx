import { type ReactNode } from 'react'
import { useAuthStore } from '../store/auth'
import { useVisitsStore } from '../store/visits'
import { useCartStore } from '../store/cart'
import { ErrorBoundary } from '../components/shared/ErrorBoundary'
import { useLocation, useNavigate, Link } from 'react-router-dom'
import { NotificationBell } from '../components/notifications/NotificationBell'
import { normalizeEmployeeRole, isDeliveryStaffUser, isUpperManagement } from '../utils/roleNormalization'
import { SyncStatusPanel } from '../desktop/components/SyncStatusPanel'
import { AppUpdater } from '../desktop/components/AppUpdater'

interface DesktopAppLayoutProps {
  children: ReactNode
}

const SALES_LIST_ROLES = ['الإدارة العليا', 'مدير بيع', 'مندوب مبيعات']

function useDesktopNavItems() {
  const { user } = useAuthStore()
  const isCustomer = user?.identity_type === 'customer'

  if (isCustomer) {
    return [
      { label: 'المتجر', path: '/storefront' },
      { label: 'الطلبات', path: '/orders' },
      { label: 'حسابي', path: '/account' },
    ]
  }

  if (user && isDeliveryStaffUser(user)) {
    return [
      { label: 'الرئيسية', path: '/my-deliveries' },
      { label: 'مهماتي', path: '/my-deliveries/tasks' },
      { label: 'الحضور والانصراف', path: '/attendance' },
    ]
  }

  const userRoles = user?.roles || []
  const normalizedRoles = userRoles.map(normalizeEmployeeRole)
  const showSalesList = SALES_LIST_ROLES.some((r) => normalizedRoles.includes(r))
  const showShipping = userRoles.some(isUpperManagement)

  const items = [
    { label: 'الرئيسية', path: '/dashboard' },
    { label: 'المتجر', path: '/storefront' },
    { label: 'الطلبات', path: '/orders' },
    { label: 'الزيارات', path: '/visits' },
  ]

  if (showShipping) {
    items.push({ label: 'رحلات التوصيل', path: '/shipping/journeys' })
  }

  if (showSalesList) {
    items.push({ label: 'قائمة المبيعات', path: '/sales-list' })
  }

  return items
}

export function DesktopAppLayout({ children }: DesktopAppLayoutProps) {
  const { user, logout } = useAuthStore()
  const { activeVisit } = useVisitsStore()
  const items = useCartStore((s) => s.items)
  const location = useLocation()
  const navigate = useNavigate()
  const navItems = useDesktopNavItems()
  const displayName = user?.full_name || 'الأهرام'
  const isDeliveryStaff = user && isDeliveryStaffUser(user)
  const homePath = isDeliveryStaff ? '/my-deliveries' : '/dashboard'

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  if (location.pathname === '/login' || location.pathname === '/register') {
    return <ErrorBoundary><>{children}</></ErrorBoundary>
  }

  if (!useAuthStore.getState().token) {
    return (
      <div className="desktop-shell">
        <main className="desktop-content">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    )
  }

  return (
    <div className="desktop-shell">
      <header className="desktop-topbar">
        <div className="desktop-topbar-inner">
          <div className="desktop-topbar-left">
            <Link to={homePath} className="desktop-brand">
              <span className="desktop-brand-icon">A</span>
              <span className="desktop-brand-text">الأهرام</span>
            </Link>
            <nav className="desktop-nav">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/')
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`desktop-nav-item ${isActive ? 'active' : ''}`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </div>
          <div className="desktop-topbar-right">
            {activeVisit && !location.pathname.startsWith('/visits') && (
              <button
                onClick={() => navigate('/visits/screen')}
                className="desktop-topbar-btn desktop-topbar-btn-success"
                title="الرجوع للزيارة النشطة"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            )}
            {!isDeliveryStaff && items.length > 0 && (
              <button
                onClick={() => navigate('/cart')}
                className="desktop-topbar-btn"
                title={`السلة (${items.length})`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
                </svg>
                <span className="desktop-topbar-badge">{items.length}</span>
              </button>
            )}
            <NotificationBell />
            <span className="desktop-topbar-user">{displayName}</span>
            <span className="desktop-topbar-role">
              {user?.identity_type === 'employee' ? 'موظف' : 'عميل'}
            </span>
            <button onClick={handleLogout} className="desktop-topbar-logout">
              خروج
            </button>
          </div>
        </div>
      </header>
      <main className="desktop-content">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
      <SyncStatusPanel />
      <AppUpdater />
    </div>
  )
}
