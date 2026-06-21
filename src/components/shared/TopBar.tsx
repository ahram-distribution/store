import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { GlobalSearch } from './GlobalSearch'

export function TopBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuthStore()
  const displayName = user?.full_name || 'الأهرام'
  const isStorefront = location.pathname.startsWith('/storefront')
  const isDashboard = location.pathname === '/dashboard'
  const isEmployee = user?.identity_type === 'employee'

  const handleLogout = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-border">
      <div className="mobile-container flex items-center justify-between h-14 ds-p-lg">
        <div className="flex items-center ds-gap-sm min-w-0">
          <span className="ds-small font-semibold">{displayName}</span>
        </div>
        <div className="flex items-center ds-gap-sm shrink-0">
          {isEmployee && <GlobalSearch />}
          {!isStorefront && (
            <button onClick={() => navigate('/storefront')}
              className="ds-badge border border-border text-text-secondary cursor-pointer">
              المتجر
            </button>
          )}
          {!isDashboard && (
            <button onClick={() => navigate('/dashboard')}
              className="ds-badge border border-border text-text-secondary cursor-pointer">
              لوحة التحكم
            </button>
          )}
          <span className="ds-badge bg-surface text-text-secondary">
            {isEmployee ? 'موظف' : 'عميل'}
          </span>
          <button onClick={handleLogout} className="ds-small px-2 text-text-secondary cursor-pointer">
            خروج
          </button>
        </div>
      </div>
    </header>
  )
}
