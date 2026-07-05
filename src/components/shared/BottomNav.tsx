import { useLocation, Link } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { normalizeEmployeeRole } from '../../utils/roleNormalization'

const SALES_LIST_ROLES = ['الإدارة العليا', 'مدير بيع', 'مندوب مبيعات']

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

  const userRoles = user?.roles || []
  const normalizedRoles = userRoles.map(normalizeEmployeeRole)
  const showSalesList = SALES_LIST_ROLES.some((r) => normalizedRoles.includes(r))

  const items = [
    { label: 'الرئيسية', path: '/dashboard', icon: 'H' },
    { label: 'المتجر', path: '/storefront', icon: 'S' },
    { label: 'الطلبات', path: '/orders', icon: 'O' },
    { label: 'الزيارات', path: '/visits', icon: 'V' },
  ]

  if (showSalesList) {
    items.push({ label: 'sales-list', path: '/sales-list', icon: 'L' })
  }

  return items
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
              <span className="text-lg">{item.icon}</span>
              <span>{item.label}</span>
              {isActive && <span className="w-4 h-0.5 rounded-full bg-primary" />}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
