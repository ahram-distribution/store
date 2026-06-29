import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { targetService } from '../../services/targets'
import { useAuthStore } from '../../store/auth'
import { formatCurrencyShort } from '../../utils/format'

interface DashMgmt {
  total_orders: number; pending_orders: number; approved_orders: number
  total_customers: number; active_visits: number; pending_collections: number
  pending_returns: number; today_orders: number; today_visits: number
}

interface LauncherGroup {
  icon: string
  label: string
  path: string
  isSubLauncher?: boolean
  badge?: string | number
}

const now = new Date()
const CUR_MONTH = now.getMonth() + 1
const CUR_YEAR = now.getFullYear()
const MONTHS = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

function monthRange(month: number, year: number) {
  return {
    from: new Date(year, month - 1, 1).toISOString().slice(0, 10),
    to: new Date(year, month, 1).toISOString().slice(0, 10),
  }
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export default function UpperManagementDashboard() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [kpiData, setKpiData] = useState<{ sales: number; orders: number; new_customers: number } | null>(null)
  const [achievementPct, setAchievementPct] = useState(0)
  const [dashMgmt, setDashMgmt] = useState<DashMgmt | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const token = getToken()
    if (!token) return

    const { from, to } = monthRange(CUR_MONTH, CUR_YEAR)

    supabase.rpc('get_runtime_team_activity', {
      p_manager_employee_id: null,
      p_date_from: from,
      p_date_to: to,
    }).then(({ data, error: err }) => {
      if (!err && data) {
        const members = data as any[]
        let sales = 0, orders = 0, new_customers = 0
        members.forEach((m: any) => {
          sales += m.sales || 0
          orders += m.orders || 0
          new_customers += m.registered_customers || 0
        })
        setKpiData({ sales, orders, new_customers })
      }
    })

    targetService.getPerformance(CUR_MONTH, CUR_YEAR, token).then((result) => {
      if (!result.error && result.data) {
        const p = result.data as any
        if (p.company) {
          setAchievementPct(p.company.overall_achievement_pct || 0)
        }
      }
    })

    supabase.rpc('get_dashboard_management', { p_token: token }).then((mgmtResult) => {
      if (!mgmtResult.error && mgmtResult.data) setDashMgmt(mgmtResult.data as DashMgmt)
    })
  }, [])

  const achievementValue = achievementPct

  const statItems = [
    { label: 'مبيعات الشهر', value: kpiData?.sales != null ? formatCurrencyShort(kpiData.sales) : '0', color: 'text-success' },
    { label: 'الطلبات', value: String(kpiData?.orders ?? 0), color: 'text-primary' },
    { label: 'الإنجاز', value: achievementValue.toFixed(1) + '%', color: achievementValue >= 50 ? 'text-success' : 'text-warning' },
    { label: 'عملاء جدد', value: String(kpiData?.new_customers ?? 0), color: 'text-accent' },
  ]

  const groups: LauncherGroup[] = [
    { icon: '📊', label: 'النشاط والتارجت', path: '/dashboard/activity-target' },
    { icon: '📋', label: 'الطلبات', path: '/launcher/orders', isSubLauncher: true, badge: dashMgmt?.pending_orders },
    { icon: '📍', label: 'الانتشار', path: '/coverage-map' },
    { icon: '⚡', label: 'مركز النشاط اللحظي', path: '/command-center/live' },
    { icon: '📍', label: 'الزيارات', path: '/launcher/visits', isSubLauncher: true, badge: dashMgmt?.active_visits },
    { icon: '👥', label: 'العملاء', path: '/launcher/customers', isSubLauncher: true, badge: dashMgmt?.total_customers },
    { icon: '👤', label: 'الموظفون', path: '/launcher/employees', isSubLauncher: true },
    { icon: '⏱️', label: 'الحضور والانصراف', path: '/attendance' },
    { icon: '📦', label: 'المخزون', path: '/launcher/inventory', isSubLauncher: true },
    { icon: '🏷️', label: 'الأقسام', path: '/launcher/deals', isSubLauncher: true },
    { icon: '📈', label: 'التقارير', path: '/launcher/reports', isSubLauncher: true },
    { icon: '⚙️', label: 'الإعدادات', path: '/launcher/settings', isSubLauncher: true },
    { icon: '📡', label: 'اختبار GPS والموقع', path: '/ops/gps-test' },
    { icon: '🗑️', label: 'مركز الحذف', path: '/data-center' },
  ]

  const quickIcons: LauncherGroup[] = [
    { icon: '🎭', label: 'الأدوار', path: '/employees#roles' },
    { icon: '🔐', label: 'الصلاحيات', path: '/employees#permissions' },
    { icon: '📋', label: 'سياسات العمل', path: '/attendance/settings#work-policies' },
    { icon: '🔄', label: 'النشاط الموحد', path: '/activity' },
    { icon: '📄', label: 'طلبي', path: '/orders?my=1' },
    { icon: '👤', label: 'عملائي', path: '/customers?my=1' },
    { icon: '📊', label: 'تحليلات العملاء', path: '/analytics/customers/intelligence' },
  ]

  const curMonthLabel = MONTHS[CUR_MONTH - 1] + ' ' + CUR_YEAR

  const adminPaths = ['/launcher/settings', '/ops/gps-test', '/data-center']
  const operationalGroups = groups.filter(g => !adminPaths.includes(g.path))
  const adminGroups = groups.filter(g => adminPaths.includes(g.path))

  const operationalFiltered = operationalGroups.filter((g) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.trim().toLowerCase()
    return g.label.toLowerCase().includes(q)
  })

  const adminFiltered = adminGroups.filter((g) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.trim().toLowerCase()
    return g.label.toLowerCase().includes(q)
  })

  const quickFiltered = quickIcons.filter((g) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.trim().toLowerCase()
    return g.label.toLowerCase().includes(q)
  })

  return (
    <div className="p-4 space-y-6" dir="rtl">
      {/* ===== 1. HEADER ===== */}
      <div className="bg-gradient-to-br from-primary to-primary-dark rounded-2xl shadow-lg overflow-hidden">
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-white">مرحباً</h1>
              <p className="text-sm text-white/70 mt-0.5">{user?.full_name || ''}</p>
            </div>
            <div className="text-left">
              <div className="text-xs text-white/60">{curMonthLabel}</div>
              <div className="text-xl font-bold text-gold-light mt-0.5">{achievementValue.toFixed(1)}%</div>
            </div>
          </div>
          <div className="mt-4 relative">
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍  ابحث عن شاشة..."
              className="w-full border border-white/20 rounded-xl px-4 py-3 pr-10 text-sm bg-white/15 text-white placeholder:text-white/40 outline-none focus:border-white/40 focus:bg-white/20 transition-all" />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 text-xs hover:text-white">✕</button>
            )}
          </div>
        </div>
      </div>

      {/* ===== 2. COMPANY KPIs ===== */}
      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="bg-gradient-to-l from-primary to-primary-dark px-5 py-3.5">
          <h2 className="text-sm font-bold text-white">📊 مؤشرات الشركة</h2>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {statItems.map((s, idx) => (
              <div key={s.label} className={
                `rounded-xl p-4 text-center border shadow-sm ` +
                (idx === 0 ? 'bg-gradient-to-br from-emerald-50 to-green-100/60 border-emerald-200/50' :
                 idx === 1 ? 'bg-gradient-to-br from-blue-50 to-blue-100/60 border-blue-200/50' :
                 idx === 2 ? 'bg-gradient-to-br from-amber-50 to-yellow-100/60 border-amber-200/50' :
                 'bg-gradient-to-br from-violet-50 to-purple-100/60 border-violet-200/50')
              }>
                <div className={`text-2xl sm:text-3xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-[11px] text-text-secondary mt-1.5 font-medium">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ===== 3. OPERATIONAL MODULES ===== */}
      {operationalFiltered.length > 0 && (
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-l from-secondary to-blue-900 px-5 py-3.5">
            <h2 className="text-sm font-bold text-white">⚙️ الوحدات التشغيلية</h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-4 min-[430px]:grid-cols-4">
              {operationalFiltered.map((g) => (
                <button key={g.path} onClick={() => nav(g.path)}
                  className="bg-white rounded-xl border border-border p-4 text-center active:bg-surface transition-all hover:shadow-md hover:border-primary/30 active:scale-95 relative">
                  <div className="text-3xl mb-2">{g.icon}</div>
                  <div className="text-xs font-semibold text-text leading-tight">{g.label}</div>
                  {g.badge !== undefined && Number(g.badge) > 0 && (
                    <div className="absolute -top-1.5 -left-1.5 bg-danger text-white text-[9px] min-w-[18px] h-[18px] rounded-full flex items-center justify-center font-bold px-1">
                      {g.badge}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== 4. ADMIN MODULES ===== */}
      {adminFiltered.length > 0 && (
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-l from-amber-600 to-amber-700 px-5 py-3.5">
            <h2 className="text-sm font-bold text-white">🛠️ الوحدات الإدارية</h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-4 min-[430px]:grid-cols-4">
              {adminFiltered.map((g) => (
                <button key={g.path} onClick={() => nav(g.path)}
                  className="bg-white rounded-xl border border-border p-4 text-center active:bg-surface transition-all hover:shadow-md hover:border-primary/30 active:scale-95 relative">
                  <div className="text-3xl mb-2">{g.icon}</div>
                  <div className="text-xs font-semibold text-text leading-tight">{g.label}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===== 5. QUICK ACCESS ===== */}
      {quickFiltered.length > 0 && (
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-l from-accent to-amber-500 px-5 py-3.5">
            <h2 className="text-sm font-bold text-white">⚡ الوصول السريع</h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-4 min-[430px]:grid-cols-4">
              {quickFiltered.map((q) => (
                <button key={q.path} onClick={() => nav(q.path)}
                  className="bg-white rounded-xl border border-border p-3.5 text-center active:bg-surface transition-all hover:shadow-md hover:border-primary/30 active:scale-95">
                  <div className="text-2xl mb-1.5">{q.icon}</div>
                  <div className="text-[10px] font-semibold text-text leading-tight">{q.label}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {searchQuery && operationalFiltered.length === 0 && adminFiltered.length === 0 && quickFiltered.length === 0 && (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد نتائج لـ "{searchQuery}"</div>
      )}
    </div>
  )
}
