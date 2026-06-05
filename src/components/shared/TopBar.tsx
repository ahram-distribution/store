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
      <div className="mobile-container flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-sm truncate text-text">{displayName}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isEmployee && <GlobalSearch />}
          {!isStorefront && (
            <button onClick={() => navigate('/storefront')}
              className="text-[10px] px-2.5 py-1 rounded-full transition-colors shrink-0 text-text-secondary border border-border">
              المتجر
            </button>
          )}
          {!isDashboard && (
            <button onClick={() => navigate('/dashboard')}
              className="text-[10px] px-2.5 py-1 rounded-full transition-colors shrink-0 text-text-secondary border border-border">
              لوحة التحكم
            </button>
          )}
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-surface text-text-secondary">
            {isEmployee ? 'موظف' : 'عميل'}
          </span>
          <button onClick={handleLogout} className="text-xs px-2 py-1 text-text-secondary transition-colors">
            خروج
          </button>
        </div>
      </div>
    </header>
  )
}
