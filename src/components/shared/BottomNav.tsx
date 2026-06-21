import { useLocation, Link } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'

function useNavItems() {
  const { user } = useAuthStore()
  const isCustomer = user?.identity_type === 'customer'

  if (isCustomer) {
    return [
      { label: 'المتجر', path: '/storefront', icon: 'S' },
      { label: 'الطلبات', path: '/orders', icon: 'O' },
      { label: 'حسابي', path: '/account', icon: 'A' },
    ]
  }

  return [
    { label: 'الرئيسية', path: '/dashboard', icon: 'H' },
    { label: 'المتجر', path: '/storefront', icon: 'S' },
    { label: 'الطلبات', path: '/orders', icon: 'O' },
    { label: 'الزيارات', path: '/visits', icon: 'V' },
    { label: 'المزيد', path: '/products', icon: 'M' },
  ]
}

export function BottomNav() {
  const location = useLocation()
  const navItems = useNavItems()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 safe-bottom bg-white border-t border-border">
      <div className="mobile-container flex justify-around items-center h-16">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/')
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center gap-1 text-xs transition-colors ${
                isActive ? 'text-primary font-semibold' : 'text-text-secondary'
              }`}
            >
              <span className="text-2xl leading-none">{item.icon}</span>
              <span className="ds-xs">{item.label}</span>
              {isActive && <span className="w-1 h-1 rounded-full bg-primary" />}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
