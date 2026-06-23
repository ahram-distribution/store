import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { targetService } from '../../services/targets'
import { attendanceService } from '../../services/attendance'
import { useAuthStore } from '../../store/auth'
import { formatCurrencyShort } from '../../utils/format'

interface TrackingSessionStat {
  employee_code: string
  employee_name: string
  start_time: string
  end_time: string
  duration_minutes: number
  expected_points: number
  captured_points: number
  capture_rate: number
}

interface DashboardData {
  new_orders: number; pending_orders: number; active_visits: number; today_visits: number
  new_customers: number; stagnant_customers: number; daily_sales: number; monthly_sales: number
  total_customers: number; total_reps: number
}

interface DashMgmt {
  total_orders: number; pending_orders: number; approved_orders: number
  total_customers: number; active_visits: number; pending_collections: number
  pending_returns: number; today_orders: number; today_visits: number
}

interface AttendanceOverview {
  active_count: number
  on_break_count: number
  on_visit_count: number
  connection_loss_count: number
  no_start_count: number
  ended_count: number
  employees?: unknown[]
  no_start_employees?: unknown[]
  ended_employees?: unknown[]
}

interface AutoClosedSession {
  employee_name: string
  employee_code: string
  close_reason: string
  last_seen_at: string
  auto_closed_at: string
  start_time: string
  date: string
}

interface AutoClosedMonth {
  total_count: number
  by_reason: Record<string, number>
  details: Array<Record<string, unknown>>
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const now = new Date()
const CUR_MONTH = now.getMonth() + 1
const CUR_YEAR = now.getFullYear()
const MONTHS = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

const REASON_LABELS: Record<string, string> = {
  no_activity_timeout: 'انتهت المهلة',
  day_rollover: 'تجاوز منتصف الليل',
}

interface LauncherGroup {
  icon: string
  label: string
  path: string
  isSubLauncher?: boolean
  badge?: string | number
}

export default function UpperManagementDashboard() {
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [data, setData] = useState<DashboardData | null>(null)
  const [dashMgmt, setDashMgmt] = useState<DashMgmt | null>(null)
  const [companyPerf, setCompanyPerf] = useState<{ sales_target: number; overall_achievement_pct: number } | null>(null)
  const [attendance, setAttendance] = useState<AttendanceOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [autoClosedToday, setAutoClosedToday] = useState<AutoClosedSession[]>([])
  const [autoClosedMonth, setAutoClosedMonth] = useState<AutoClosedMonth | null>(null)
  const [showAutoClosedModal, setShowAutoClosedModal] = useState(false)
  const [healthData, setHealthData] = useState<any>(null)
  const [trackingStats, setTrackingStats] = useState<TrackingSessionStat[]>([])

  function getToken(): string | null {
    try { return localStorage.getItem('session_token') } catch { return null }
  }

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_upper_management_dashboard', { p_token: token }),
      supabase.rpc('get_dashboard_management', { p_token: token }),
      targetService.getPerformance(CUR_MONTH, CUR_YEAR, token),
      supabase.rpc('get_live_workday_overview', { p_token: token }),
      attendanceService.getAutoClosedToday().catch(() => []),
      attendanceService.getAutoClosedMonth().catch(() => null),
      supabase.rpc('get_attendance_health', { p_token: token }).then(r => r, () => null),
      supabase.rpc('get_tracking_session_stats', { p_token: token, p_employee_id: null, p_date: new Date().toISOString().slice(0,10) }).then(r => r, () => null),
    ]).then(([umd, mgmt, perfResult, attResult, autoToday, autoMonth, health, tracking]) => {
      if (!umd.error && umd.data) setData(umd.data as DashboardData)
      if (!mgmt.error && mgmt.data) setDashMgmt(mgmt.data as DashMgmt)
      if (!perfResult.error && perfResult.data) {
        const p = perfResult.data as any
        if (p.company) setCompanyPerf({
          sales_target: p.company.sales_target || 0,
          overall_achievement_pct: p.company.overall_achievement_pct || 0,
        })
      }
      if (!attResult.error && attResult.data) setAttendance(attResult.data as AttendanceOverview)
      if (autoToday) setAutoClosedToday(autoToday as AutoClosedSession[])
      if (autoMonth) setAutoClosedMonth(autoMonth as AutoClosedMonth)
      if (health?.data && !health.error) setHealthData(health.data)
      if (tracking?.data && !tracking.error) setTrackingStats(tracking.data as TrackingSessionStat[])
      setLoading(false)
    })
  }, [])

  const totalOrders = dashMgmt?.total_orders ?? 0
  const pendingOrders = (data?.pending_orders ?? 0) + (dashMgmt?.pending_orders ?? 0)
  const achievementPct = companyPerf?.overall_achievement_pct ?? 0

  const statItems = [
    { label: 'مبيعات الشهر', value: data?.monthly_sales != null ? formatCurrencyShort(data.monthly_sales) : '0', color: 'text-success' },
    { label: 'الطلبات', value: String(totalOrders), color: 'text-primary' },
    { label: 'الإنجاز', value: achievementPct.toFixed(1) + '%', color: achievementPct >= 50 ? 'text-success' : 'text-warning' },
    { label: 'عملاء جدد', value: String(data?.new_customers ?? 0), color: 'text-accent' },
  ]

  const groups: LauncherGroup[] = [
    { icon: '📋', label: 'الطلبات', path: '/launcher/orders', isSubLauncher: true, badge: pendingOrders },
    { icon: '📍', label: 'الانتشار', path: '/coverage-map' },
    { icon: '⚡', label: 'مركز النشاط اللحظي', path: '/command-center/live' },
    { icon: '📍', label: 'الزيارات', path: '/launcher/visits', isSubLauncher: true, badge: data?.active_visits },
    { icon: '👥', label: 'العملاء', path: '/launcher/customers', isSubLauncher: true, badge: data?.total_customers },
    { icon: '👤', label: 'الموظفون', path: '/launcher/employees', isSubLauncher: true },
    { icon: '⏱️', label: 'الحضور والانصراف', path: '/attendance' },
    { icon: '📦', label: 'المخزون', path: '/launcher/inventory', isSubLauncher: true },
    { icon: '🏷️', label: 'الأقسام', path: '/launcher/deals', isSubLauncher: true },
    { icon: '📈', label: 'التقارير', path: '/launcher/reports', isSubLauncher: true },
    { icon: '🎯', label: 'الأهداف', path: '/launcher/targets', isSubLauncher: true },
    { icon: '⚙️', label: 'الإعدادات', path: '/launcher/settings', isSubLauncher: true },
    { icon: '📡', label: 'اختبار GPS والموقع', path: '/ops/gps-test' },
    { icon: '🗑️', label: 'مركز الحذف', path: '/data-center' },
  ]

  const quickIcons: LauncherGroup[] = [

    { icon: '🧑‍💼', label: 'المناديب', path: '/employees?role=مندوب' },
    { icon: '👔', label: 'المشرفين', path: '/employees?role=مشرف' },
    { icon: '🎭', label: 'الأدوار', path: '/employees#roles' },
    { icon: '🔐', label: 'الصلاحيات', path: '/employees#permissions' },
    { icon: '📋', label: 'سياسات العمل', path: '/attendance/settings#work-policies' },
    { icon: '🎯', label: 'الأهداف', path: '/employees#targets' },
    { icon: '🎯', label: 'التارجت', path: '/target-runtime' },
    { icon: '🔄', label: 'النشاط الموحد', path: '/activity' },
    { icon: '📄', label: 'طلبي', path: '/orders?my=1' },
    { icon: '👤', label: 'عملائي', path: '/customers?my=1' },
    { icon: '📊', label: 'تحليلات العملاء', path: '/analytics/customers/intelligence' },
  ]

  const curMonthLabel = MONTHS[CUR_MONTH - 1] + ' ' + CUR_YEAR

  const filteredGroups = groups.filter((g) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.trim().toLowerCase()
    return g.label.toLowerCase().includes(q)
  })

  const filteredQuick = quickIcons.filter((g) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.trim().toLowerCase()
    return g.label.toLowerCase().includes(q)
  })

  if (loading) {
    return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  }

  return (
    <div className="p-4 space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text">مرحباً</h1>
          <p className="text-xs text-text-secondary">{user?.full_name || ''}</p>
        </div>
        <div className="text-xs text-text-secondary text-left">
          <div>{curMonthLabel}</div>
          <div className="text-primary font-semibold">{achievementPct.toFixed(1)}%</div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="🔍  ابحث عن شاشة..." className="w-full border border-border rounded-xl px-4 py-3 text-sm bg-white pr-10" />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-xs">✕</button>
        )}
      </div>

      {/* Stats Line — clean, no cards */}
      <div className="flex items-center justify-between px-1">
        {statItems.map((s) => (
          <div key={s.label} className="text-center">
            <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[9px] text-text-secondary leading-tight">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Attendance Overview */}
      {attendance && (
        <div className="bg-white rounded-xl border border-border p-3" dir="rtl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-semibold text-text">الحضور والانصراف</span>
            <span className="text-[10px] text-text-secondary">
              {((attendance.employees ?? []).length > 0 ? (attendance.employees as unknown[]).length + ' موظف' : 'غير متوفر')}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="bg-blue-50 rounded-lg py-2">
              <div className="text-lg font-bold text-blue-700">{attendance.active_count}</div>
              <div className="text-[9px] text-text-secondary">يعمل الآن</div>
            </div>
            <div className="bg-amber-50 rounded-lg py-2">
              <div className="text-lg font-bold text-amber-700">{attendance.on_break_count}</div>
              <div className="text-[9px] text-text-secondary">في استراحة</div>
            </div>
            <div className="bg-green-50 rounded-lg py-2">
              <div className="text-lg font-bold text-green-700">{attendance.ended_count}</div>
              <div className="text-[9px] text-text-secondary">أنهوا اليوم</div>
            </div>
            <div className="bg-gray-50 rounded-lg py-2">
              <div className="text-lg font-bold text-gray-500">{attendance.no_start_count}</div>
              <div className="text-[9px] text-text-secondary">لم يبدأوا</div>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Closed Sessions */}
      {(autoClosedToday.length > 0 || (autoClosedMonth?.total_count ?? 0) > 0) && (
        <div className="bg-white rounded-xl border border-border p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-semibold text-text">جلسات الإنهاء التلقائي</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => setShowAutoClosedModal(true)}
              className="bg-red-50 rounded-xl py-3 text-center active:bg-red-100 transition-colors">
              <div className="text-lg font-bold text-red-700">{autoClosedToday.length}</div>
              <div className="text-[9px] text-text-secondary">اليوم</div>
            </button>
            <div className="bg-orange-50 rounded-xl py-3 text-center">
              <div className="text-lg font-bold text-orange-700">{autoClosedMonth?.total_count ?? 0}</div>
              <div className="text-[9px] text-text-secondary">هذا الشهر</div>
            </div>
          </div>
        </div>
      )}

      {/* Attendance Health Card */}
      {healthData && (
        <div className="bg-white rounded-xl border border-border p-3" dir="rtl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-semibold text-text">صحة الحضور</span>
            <span className="text-[9px] text-text-secondary">اليوم</span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center mb-2">
            <div className="bg-blue-50 rounded-lg py-2">
              <div className="text-lg font-bold text-blue-700">{healthData.today?.active_sessions ?? 0}</div>
              <div className="text-[9px] text-text-secondary">نشط</div>
            </div>
            <div className="bg-green-50 rounded-lg py-2">
              <div className="text-lg font-bold text-green-700">{healthData.today?.completed_sessions ?? 0}</div>
              <div className="text-[9px] text-text-secondary">منتهي</div>
            </div>
            <div className="bg-red-50 rounded-lg py-2">
              <div className="text-lg font-bold text-red-700">{healthData.today?.auto_closed_sessions ?? 0}</div>
              <div className="text-[9px] text-text-secondary">تلقائي</div>
            </div>
            <div className="bg-amber-50 rounded-lg py-2">
              <div className="text-lg font-bold text-amber-700">{healthData.today?.recovery_events ?? 0}</div>
              <div className="text-[9px] text-text-secondary">استرجاع</div>
            </div>
          </div>
          <div className="border-t border-border pt-2 text-[10px] text-text-secondary flex justify-between">
            <span>آخر 30 يوم — تلقائي: {healthData.month?.auto_closed_count ?? 0}</span>
            <span>استرجاع: {healthData.month?.recovery_count ?? 0}</span>
            <span>متوسط ساعات: {healthData.month?.avg_work_hours ?? 0}</span>
          </div>
        </div>
      )}

      {/* Tracking Reliability Report */}
      {trackingStats.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-3" dir="rtl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-semibold text-text">موثوقية التتبع GPS</span>
            <span className="text-[9px] text-text-secondary">اليوم</span>
          </div>
          <div className="space-y-1.5">
            {trackingStats.map((s, i) => (
              <div key={i} className="flex items-center justify-between bg-surface rounded-lg px-2.5 py-1.5 border border-border/50">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] font-semibold text-text truncate">{s.employee_name}</span>
                  <span className="text-[9px] text-text-secondary">{s.employee_code}</span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-text-secondary shrink-0">
                  <span>{s.captured_points}/{s.expected_points}</span>
                  <span className={`font-bold ${s.capture_rate >= 80 ? 'text-green-600' : s.capture_rate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                    {s.capture_rate}%
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-1.5 mt-1.5 text-[9px] text-text-secondary flex justify-between">
            <span>
              الإجمالي: {trackingStats.reduce((a, s) => a + s.captured_points, 0)} / {trackingStats.reduce((a, s) => a + s.expected_points, 0)} نقطة
            </span>
            <span>
              {trackingStats.length > 0
                ? Math.round(trackingStats.reduce((a, s) => a + s.captured_points, 0) / Math.max(trackingStats.reduce((a, s) => a + s.expected_points, 0), 1) * 100) + '%'
                : '0%'}
            </span>
          </div>
        </div>
      )}

      {/* Main Icon Grid — modules that open sub-launchers */}
      {filteredGroups.length > 0 && (
        <>
          <div className="grid grid-cols-4 gap-3 min-[430px]:grid-cols-5">
            {filteredGroups.map((g) => (
              <button key={g.path} onClick={() => nav(g.path)}
                className="bg-white rounded-xl border border-border p-3 text-center active:bg-surface transition-colors hover:shadow-sm hover:border-primary/30 active:scale-95 relative">
                <div className="text-2xl mb-1">{g.icon}</div>
                <div className="text-[10px] font-semibold text-text leading-tight">{g.label}</div>
                {g.badge !== undefined && Number(g.badge) > 0 && (
                  <div className="absolute -top-1.5 -left-1.5 bg-danger text-white text-[9px] min-w-[18px] h-[18px] rounded-full flex items-center justify-center font-bold px-1">
                    {g.badge}
                  </div>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Quick Access Icons */}
      <div>
        <h3 className="text-xs font-semibold text-text-secondary mb-2 px-1">وصول سريع</h3>
        <div className="grid grid-cols-4 gap-3 min-[430px]:grid-cols-5">
          {filteredQuick.map((q) => (
            <button key={q.path} onClick={() => nav(q.path)}
              className="bg-white rounded-xl border border-border p-3 text-center active:bg-surface transition-colors hover:shadow-sm hover:border-primary/30 active:scale-95">
              <div className="text-xl mb-1">{q.icon}</div>
              <div className="text-[9px] font-semibold text-text leading-tight">{q.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Empty search state */}
      {searchQuery && filteredGroups.length === 0 && filteredQuick.length === 0 && (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد نتائج لـ "{searchQuery}"</div>
      )}

      {/* Auto-Closed Today Modal */}
      {showAutoClosedModal && (
        <div className="fixed inset-0 z-20 flex items-end sm:items-center justify-center bg-black/30">
          <div className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-4 max-h-[70vh] overflow-y-auto space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text">جلسات الإنهاء التلقائي اليوم</h3>
              <button type="button" onClick={() => setShowAutoClosedModal(false)} className="text-xs text-text-secondary">إغلاق</button>
            </div>
            {autoClosedToday.length === 0 ? (
              <p className="text-center text-xs text-text-secondary py-6">لا توجد جلسات</p>
            ) : (
              <div className="space-y-2">
                {autoClosedToday.map((s, i) => (
                  <div key={i} className="bg-surface rounded-lg p-3 border border-border/50">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-text">{s.employee_name}</span>
                      <span className="text-[10px] text-text-secondary">{s.employee_code}</span>
                    </div>
                    <div className="text-[11px] text-text-secondary mt-1">
                      السبب: {REASON_LABELS[s.close_reason] || s.close_reason}
                    </div>
                    <div className="text-[10px] text-text-secondary">
                      {s.start_time ? 'البداية: ' + s.start_time : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
