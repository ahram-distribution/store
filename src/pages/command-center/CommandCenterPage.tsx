import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

interface SystemModule {
  id: string
  module_key: string
  display_name: Record<string, string>
  status: string
  health_status: string
  readiness_score: number
  owner_approved: boolean
  business_priority: string
}

interface RequiredAction {
  label: string
  count: number
  link: string
}

interface ModuleCounts {
  orders_new: number
  customers_active: number
  visits_active: number
  credit_due: number
  employees_active: number
}

interface Summary {
  total_modules: number
  healthy: number
  degraded: number
  down: number
  broken: number
  production_ready: number
  decisions_pct: number
}

interface CommandCenterData {
  modules: SystemModule[]
  summary: Summary
  required_actions: RequiredAction[]
  module_counts: ModuleCounts
}

const MODULE_ROUTES: Record<string, string> = {
  orders: '/command-center/modules/orders',
  customers: '/command-center/modules/customers',
  visits: '/command-center/modules/visits',
  credit: '/command-center/modules/credit',
  inventory: '/command-center/modules/inventory',
  employees: '/command-center/modules/employees',
  returns: '/command-center/modules/returns',
  collections: '/command-center/modules/collections',
  delivery: '/command-center/modules/delivery',
  reports: '/command-center/modules/reports',
  warehouse: '/command-center/modules/warehouse',
  targets: '/dashboard/company-targets',
  permissions: '/account/permissions',
  auctions: '/auctions',
  'daily-deals': '/daily-deals',
  'flash-offers': '/flash-offers',
  tiers: '/tiers',
  companies: '/companies',
  deals: '/deals',
  products: '/products',
  attendance: '/attendance/live',
}

const MODULE_EMOJI: Record<string, string> = {
  orders: '🛒',
  customers: '👥',
  visits: '📍',
  credit: '💳',
  inventory: '📦',
  employees: '👤',
  returns: '📋',
  collections: '💰',
  delivery: '🚚',
  reports: '📊',
  targets: '🎯',
  permissions: '🔐',
  auctions: '🔨',
  'daily-deals': '⚡',
  'flash-offers': '⏰',
  tiers: '📈',
  companies: '🏢',
  warehouse: '🏗️',
  deals: '🏷️',
  products: '📦',
  attendance: '📅',
}

const MODULE_TIERS = {
  primary: ['orders', 'customers', 'visits', 'credit', 'inventory', 'employees', 'attendance'],
  secondary: ['returns', 'collections', 'delivery', 'reports', 'warehouse'],
  technical: ['targets', 'permissions', 'auctions', 'daily-deals', 'flash-offers', 'tiers', 'companies', 'deals', 'products'],
}

const HEALTH_COLOR: Record<string, string> = {
  healthy: 'bg-green-500',
  degraded: 'bg-yellow-500',
  down: 'bg-red-500',
  unknown: 'bg-gray-300',
}

const STATUS_LABEL: Record<string, string> = {
  validated: 'مكتمل',
  implemented: 'منفذ',
  partial: 'جزئي',
  planned: 'مخطط',
  broken: 'معطل',
  deprecated: 'ملغي',
}

const STATUS_BADGE: Record<string, string> = {
  validated: 'bg-green-100 text-green-800',
  implemented: 'bg-blue-100 text-blue-800',
  partial: 'bg-yellow-100 text-yellow-800',
  planned: 'bg-gray-100 text-gray-800',
  broken: 'bg-red-100 text-red-800',
  deprecated: 'bg-gray-200 text-gray-500',
}

export function CommandCenterPage() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [data, setData] = useState<CommandCenterData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [technicalExpanded, setTechnicalExpanded] = useState(false)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_command_center', { p_token: token })
      .then(({ data: result, error: err }) => {
        if (err) { setError(err.message); return }
        if (result?.error) { setError(result.error); return }
        setData(result as CommandCenterData)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const moduleMap = new Map<string, SystemModule>()
  for (const m of data?.modules || []) {
    moduleMap.set(m.module_key, m)
  }

  const summary = data?.summary || { total_modules: 0, healthy: 0, degraded: 0, down: 0, broken: 0, production_ready: 0, decisions_pct: 0 }
  const actions = data?.required_actions || []
  const counts = data?.module_counts || { orders_new: 0, customers_active: 0, visits_active: 0, credit_due: 0, employees_active: 0 }

  if (loading) {
    return <div className="text-center py-12 text-text-secondary text-sm">جاري تحميل مركز القيادة...</div>
  }

  if (error) {
    return (
      <div className="p-4 text-center" dir="rtl">
        <div className="text-danger text-lg font-bold mb-2">خطأ في التحميل</div>
        <div className="text-text-secondary text-sm mb-4">{error}</div>
        <button onClick={() => window.location.reload()} className="text-primary text-sm underline">إعادة المحاولة</button>
      </div>
    )
  }

  function renderModuleCard(key: string, sublabel?: string) {
    const m = moduleMap.get(key)
    const route = MODULE_ROUTES[key] || `/${key}`
    const emoji = MODULE_EMOJI[key] || '📦'
    const name = m?.display_name?.ar || key
    const statusCls = m ? STATUS_BADGE[m.status] || 'bg-gray-100 text-gray-800' : 'bg-gray-100 text-gray-800'
    const statusLabel = m ? STATUS_LABEL[m.status] || m.status : '—'
    const healthDot = m ? HEALTH_COLOR[m.health_status] || 'bg-gray-300' : 'bg-gray-300'

    return (
      <button key={key} onClick={() => nav(route)}
        className="bg-white rounded-xl border border-border p-3 text-right active:scale-[0.98] transition-all hover:shadow-sm hover:border-primary/30 w-full text-right">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xl">{emoji}</span>
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${statusCls}`}>{statusLabel}</span>
        </div>
        <div className="text-sm font-bold text-text">{name}</div>
        {sublabel && <div className="text-[10px] text-text-secondary mt-0.5">{sublabel}</div>}
        {m && (
          <div className="flex items-center gap-1 mt-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${healthDot}`} />
            <span className="text-[9px] text-text-secondary">{m.readiness_score}% جاهزية</span>
          </div>
        )}
      </button>
    )
  }

  return (
    <div className="p-4 space-y-4" dir="rtl">
      {/* Header + Status Bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text">مركز القيادة</h1>
          <div className="flex items-center gap-2 text-[10px] text-text-secondary mt-0.5">
            <span>{summary.total_modules} وحدة</span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> {summary.healthy}
            </span>
            {summary.degraded > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 inline-block" /> {summary.degraded}
              </span>
            )}
            {summary.down > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" /> {summary.down}
              </span>
            )}
            {summary.broken > 0 && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" /> {summary.broken}
              </span>
            )}
          </div>
        </div>
        <button onClick={() => window.location.reload()}
          className="text-xs text-primary border border-primary/30 rounded-lg px-3 py-1.5 hover:bg-primary/5">
          تحديث
        </button>
      </div>

      {/* الإجراءات المطلوبة */}
      {actions.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-text mb-2">الإجراءات المطلوبة</h2>
          <div className="bg-white rounded-xl border border-border divide-y divide-border/50">
            {actions.filter(a => a.count > 0).map((a, i) => (
              <button key={i} onClick={() => nav(a.link)}
                className="w-full text-right px-3 py-2.5 flex items-center justify-between active:bg-surface/50 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-red-500 text-sm">⚡</span>
                  <span className="text-xs font-semibold text-text">{a.label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-red-600 ltr">{a.count}</span>
                  <span className="text-text-secondary text-[10px]">←</span>
                </div>
              </button>
            ))}
            {actions.filter(a => a.count > 0).length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-green-600">
                ✅ لا توجد إجراءات مطلوبة حالياً
              </div>
            )}
          </div>
        </div>
      )}

      {/* العمليات الأساسية */}
      <div>
        <h2 className="text-sm font-bold text-text mb-2">العمليات الأساسية</h2>
        <div className="grid grid-cols-2 min-[420px]:grid-cols-3 gap-3">
          {MODULE_TIERS.primary.map((key) => {
            const m = moduleMap.get(key)
            const sublabel = !m ? '—' :
              key === 'orders' && counts.orders_new > 0 ? `${counts.orders_new} جديدة` :
              key === 'customers' && counts.customers_active > 0 ? `${counts.customers_active} نشط` :
              key === 'visits' && counts.visits_active > 0 ? `${counts.visits_active} نشطة` :
              key === 'credit' && counts.credit_due > 0 ? `${counts.credit_due} مستحق` :
              key === 'employees' && counts.employees_active > 0 ? `${counts.employees_active} نشط` :
              undefined
            return renderModuleCard(key, sublabel)
          })}
        </div>
      </div>

      {/* العمليات */}
      <div>
        <h2 className="text-sm font-bold text-text mb-2">العمليات</h2>
        <div className="grid grid-cols-2 min-[420px]:grid-cols-3 gap-3">
          {MODULE_TIERS.secondary.map((key) => {
            const m = moduleMap.get(key)
            const route = MODULE_ROUTES[key] || `/${key}`
            const emoji = MODULE_EMOJI[key] || '\u{1F4E6}'
            const name = m?.display_name?.ar || key
            const statusCls = m ? STATUS_BADGE[m.status] || 'bg-gray-100 text-gray-800' : 'bg-gray-100 text-gray-800'
            const statusLabel = m ? STATUS_LABEL[m.status] || m.status : '\u2014'
            const healthDot = m ? HEALTH_COLOR[m.health_status] || 'bg-gray-300' : 'bg-gray-300'

            return (
              <button key={key} onClick={() => nav(route)}
                className="bg-white rounded-xl border border-border p-3 text-right active:scale-[0.98] transition-all hover:shadow-sm hover:border-primary/30 w-full text-right">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xl">{emoji}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${statusCls}`}>{statusLabel}</span>
                </div>
                <div className="text-sm font-bold text-text">{name}</div>
                {m && (
                  <div className="flex items-center gap-1 mt-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${healthDot}`} />
                    <span className="text-[9px] text-text-secondary">{m.readiness_score}% جاهزية</span>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Technical Section */}
      <div>
        <button onClick={() => setTechnicalExpanded(!technicalExpanded)}
          className="w-full text-right flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-text">تقني</h2>
          <span className="text-text-secondary text-xs">{technicalExpanded ? '\u25B2' : '\u25BC'}</span>
        </button>
        {technicalExpanded && (
          <div className="space-y-3">
            <div className="bg-white rounded-xl border border-border divide-y divide-border/50">
              {MODULE_TIERS.technical.map((key) => {
                const m = moduleMap.get(key)
                const route = MODULE_ROUTES[key] || `/${key}`
                const emoji = MODULE_EMOJI[key] || '\u{1F4E6}'
                const name = m?.display_name?.ar || key
                return (
                  <button key={key} onClick={() => nav(route)}
                    className="w-full text-right px-3 py-2.5 flex items-center justify-between active:bg-surface/50 transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{emoji}</span>
                      <span className="text-xs font-semibold text-text">{name}</span>
                    </div>
                    <span className="text-text-secondary text-[10px]">\u2190</span>
                  </button>
                )
              })}
            </div>
            <div className="bg-white rounded-xl border border-border p-3">
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => nav('/dashboard/legacy')}
                  className="bg-surface rounded-xl p-3 text-center active:scale-95 transition-transform hover:shadow-sm">
                  <div className="text-xl mb-1">{'\u{1F4CA}'}</div>
                  <div className="text-[10px] font-semibold text-text">لوحة القيادة</div>
                  <div className="text-[8px] text-text-secondary">القديمة</div>
                </button>
                <button onClick={() => nav('/launcher/orders')}
                  className="bg-surface rounded-xl p-3 text-center active:scale-95 transition-transform hover:shadow-sm">
                  <div className="text-xl mb-1">{'\u{1F4CB}'}</div>
                  <div className="text-[10px] font-semibold text-text">مشغل الطلبات</div>
                  <div className="text-[8px] text-text-secondary">Launcher</div>
                </button>
                <button onClick={() => nav('/launcher/customers')}
                  className="bg-surface rounded-xl p-3 text-center active:scale-95 transition-transform hover:shadow-sm">
                  <div className="text-xl mb-1">{'\u{1F465}'}</div>
                  <div className="text-[10px] font-semibold text-text">مشغل العملاء</div>
                  <div className="text-[8px] text-text-secondary">Launcher</div>
                </button>
                <button onClick={() => nav('/launcher/visits')}
                  className="bg-surface rounded-xl p-3 text-center active:scale-95 transition-transform hover:shadow-sm">
                  <div className="text-xl mb-1">{'\u{1F4CD}'}</div>
                  <div className="text-[10px] font-semibold text-text">مشغل الزيارات</div>
                  <div className="text-[8px] text-text-secondary">Launcher</div>
                </button>
                <button onClick={() => nav('/launcher/employees')}
                  className="bg-surface rounded-xl p-3 text-center active:scale-95 transition-transform hover:shadow-sm">
                  <div className="text-xl mb-1">{'\u{1F464}'}</div>
                  <div className="text-[10px] font-semibold text-text">مشغل الموظفين</div>
                  <div className="text-[8px] text-text-secondary">Launcher</div>
                </button>
                <button onClick={() => nav('/launcher/reports')}
                  className="bg-surface rounded-xl p-3 text-center active:scale-95 transition-transform hover:shadow-sm">
                  <div className="text-xl mb-1">{'\u{1F4C8}'}</div>
                  <div className="text-[10px] font-semibold text-text">مشغل التقارير</div>
                  <div className="text-[8px] text-text-secondary">Launcher</div>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
