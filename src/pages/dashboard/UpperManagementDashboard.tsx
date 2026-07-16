import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { targetService } from '../../services/targets'
import { useAuthStore } from '../../store/auth'
import { MonthlyActivity } from '../../components/activity/MonthlyActivity'

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


function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export default function UpperManagementDashboard() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [achievementPct, setAchievementPct] = useState(0)
  const [dashMgmt, setDashMgmt] = useState<DashMgmt | null>(null)
  const [showReportsCenter, setShowReportsCenter] = useState(false)

  useEffect(() => {
    const token = getToken()
    if (!token) return

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
    { icon: '📑', label: 'مركز التقارير', path: '__reports_center__' },
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
        </div>
      </div>

      <MonthlyActivity scope="company" />

      {/* ===== 3. OPERATIONAL MODULES ===== */}
      {operationalGroups.length > 0 && (
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-l from-secondary to-blue-900 px-5 py-3.5">
            <h2 className="text-sm font-bold text-white">⚙️ الوحدات التشغيلية</h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-4 min-[430px]:grid-cols-4">
              {operationalGroups.map((g) => (
                <button key={g.path} onClick={() => g.path === '__reports_center__' ? setShowReportsCenter(true) : nav(g.path)}
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
      {adminGroups.length > 0 && (
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-l from-amber-600 to-amber-700 px-5 py-3.5">
            <h2 className="text-sm font-bold text-white">🛠️ الوحدات الإدارية</h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-4 min-[430px]:grid-cols-4">
              {adminGroups.map((g) => (
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
      {quickIcons.length > 0 && (
        <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="bg-gradient-to-l from-accent to-amber-500 px-5 py-3.5">
            <h2 className="text-sm font-bold text-white">⚡ الوصول السريع</h2>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-4 min-[430px]:grid-cols-4">
              {quickIcons.map((q) => (
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

      {showReportsCenter && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowReportsCenter(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-bold text-text text-center">📑 مركز التقارير</h3>
            <button onClick={() => { setShowReportsCenter(false); nav('/reports/activity', { state: { scope: 'company' } }) }}
              className="w-full bg-gradient-to-l from-blue-600 to-indigo-700 text-white rounded-xl py-3.5 text-center active:opacity-80 transition-opacity">
              <div className="text-sm font-bold">تقارير النشاط</div>
              <div className="text-[10px] opacity-80 mt-0.5">تقرير شامل لكل الموظفين</div>
            </button>
            <button disabled
              className="w-full bg-gray-200 text-gray-400 rounded-xl py-3.5 text-center cursor-not-allowed">
              <div className="text-sm font-bold">تقارير التارجت</div>
              <div className="text-[10px] opacity-80 mt-0.5">قريباً</div>
            </button>
            <button onClick={() => setShowReportsCenter(false)}
              className="w-full text-text-secondary text-xs py-2">إغلاق</button>
          </div>
        </div>
      )}

    </div>
  )
}
