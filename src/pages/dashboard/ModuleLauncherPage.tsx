import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { SubLauncherPage, type LauncherIcon } from './SubLauncherPage'
import { useAuthStore } from '../../store/auth'
import { normalizeEmployeeRole } from '../../utils/roleNormalization'
import { targetService } from '../../services/targets'

const MODULE_HOME_TARGETS = new Set(['الإدارة العليا', 'مدير بيع'])

const MODULE_ICONS: Record<string, { title: string; icons: LauncherIcon[] }> = {
  orders: {
    title: 'الطلبات',
    icons: [
      { icon: '📋', label: 'كل الطلبات', path: '/orders' },
      { icon: '➕', label: 'إنشاء طلب', path: '/orders/new' },
      { icon: '🚚', label: 'التسليم', path: '/delivery' },
      { icon: '🔄', label: 'المرتجعات', path: '/returns' },
      { icon: '🔍', label: 'متابعة الطلبات', path: '/orders/approval-queue' },
      { icon: '📦', label: 'تجهيز المخزن', path: '/warehouse' },
      { icon: '📄', label: 'طلباتي', path: '/orders?my=1' },
      { icon: '📄', label: 'فواتيري', path: '/orders?my_invoices=1' },
    ],
  },
  visits: {
    title: 'الزيارات',
    icons: [
      { icon: '📍', label: 'كل الزيارات', path: '/visits' },
      { icon: '➕', label: 'زيارة جديدة', path: '/visits/new' },
      { icon: '▶️', label: 'بدء زيارة', path: '/visits?filter=active' },
    ],
  },
  customers: {
    title: 'العملاء',
    icons: [
      { icon: '👥', label: 'كل العملاء', path: '/customers' },
      { icon: '➕', label: 'عميل جديد', path: '/customers/new' },
      { icon: '👤', label: 'عملائي', path: '/customers?my=1' },
      { icon: '💳', label: 'الائتمان', path: '/credit' },
      { icon: '📊', label: 'تقارير العملاء', path: '/analytics/customers' },
      { icon: '🧠', label: 'ذكاء العملاء', path: '/analytics/customers/intelligence' },
      { icon: '📍', label: 'زيارات العملاء', path: '/visits' },
    ],
  },
  employees: {
    title: 'الموظفون',
    icons: [
      { icon: '👤', label: 'كل الموظفين', path: '/employees' },
      { icon: '➕', label: 'إضافة موظف', path: '/employees?add=1' },
      { icon: '🔗', label: 'الهيكل البيعي', path: '/hierarchy' },
      { icon: '🎭', label: 'الأدوار', path: '/employees#roles' },
      { icon: '🔐', label: 'الصلاحيات', path: '/employees#permissions' },
      { icon: '🔐', label: 'صلاحياتي', path: '/account/permissions' },
      { icon: '👤', label: 'بياناتي', path: '/account/profile' },
    ],
  },
  inventory: {
    title: 'المخزون والمنتجات',
    icons: [
      { icon: '📦', label: 'المخزون', path: '/warehouse' },
      { icon: '✏️', label: 'إدارة المنتجات', path: '/products/manage' },
      { icon: '✏️', label: 'تعديل شركة', path: '/companies/manage' },
      { icon: '🔍', label: 'مراجعة المخزون', path: '/warehouse/review' },
    ],
  },
  deals: {
    title: 'الأقسام والعروض',
    icons: [
      { icon: '🏷️', label: 'العروض', path: '/deals' },
      { icon: '🏷️', label: 'العروض اليومية', path: '/daily-deals/manage' },
      { icon: '⚡', label: 'عروض الفلاش', path: '/flash-offers/manage' },
      { icon: '🥇', label: 'إدارة الشرائح', path: '/tiers/manage' },
      { icon: '🔨', label: 'إدارة المزادات', path: '/auctions/manage' },
    ],
  },
  attendance: {
    title: 'الحضور والانصراف',
    icons: [
      { icon: '⏱️', label: 'الحضور والانصراف', path: '/attendance' },
    ],
  },
  reports: {
    title: 'التقارير والتحليلات',
    icons: [
      { icon: '📈', label: 'التقارير', path: '/reports' },
      { icon: '📊', label: 'تقارير العملاء', path: '/analytics/customers' },
      { icon: '💳', label: 'إدارة برامج الائتمان', path: '/credit/programs/manage' },
      { icon: '💳', label: 'تقارير الائتمان', path: '/credit/manage' },
      { icon: '🔄', label: 'النشاط الموحد', path: '/activity' },
      { icon: '💪', label: 'مجهود المناديب', path: '/sales-effort' },
    ],
  },
  settings: {
    title: 'الإعدادات',
    icons: [
      { icon: '🏢', label: 'إعدادات الشركة', path: '/settings/company' },
      { icon: '👤', label: 'بيانات المستخدم', path: '/account/profile' },
      { icon: '🔐', label: 'الصلاحيات', path: '/account/permissions' },
    ],
  },
  command_center: {
    title: 'مركز القيادة',
    icons: [
      { icon: '🎯', label: 'مركز قيادة المبيعات', path: '/sales-manager-cc' },
      { icon: '📊', label: 'مركز القيادة', path: '/command-center' },

    ],
  },
}

function TargetSummaryCard() {
  const nav = useNavigate()
  const now = new Date()
  const [achievement, setAchievement] = useState<number | null>(null)
  const [lateCount, setLateCount] = useState(0)
  const [noTargetCount, setNoTargetCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    targetService.getPerformance(now.getMonth() + 1, now.getFullYear()).then((res) => {
      if (res.error || !res.data) return
      const d = res.data as any
      const emps = d.employees || []
      const withTarget = emps.filter((e: any) => e.has_target)
      const scores = withTarget.map((e: any) => e.overall_achievement_score).filter((s: any) => s != null)
      const avg = scores.length > 0 ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0
      setAchievement(Math.round(avg * 100) / 100)
      setLateCount(emps.filter((e: any) => {
        const sc = e.overall_achievement_score
        if (!e.has_target && !e.has_activity) return false
        if (sc == null) return false
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
        const daysPassed = Math.min(now.getDate(), daysInMonth)
        const timeRatio = daysPassed / daysInMonth
        if (sc >= timeRatio) return false
        if (timeRatio > 0.8 && sc < 0.5) return true
        if (sc < timeRatio * 0.5) return true
        return false
      }).length)
      setNoTargetCount(emps.filter((e: any) => !e.has_target).length)
    }).finally(() => setLoading(false))
  }, [])

  const color = achievement != null
    ? achievement >= 80 ? 'text-green-600' : achievement >= 50 ? 'text-yellow-600' : 'text-red-600'
    : 'text-text'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">الأهداف</h1>
      </div>

      <button onClick={() => nav('/runtime/achievement')}
        className="w-full bg-white rounded-2xl border border-border p-5 text-right hover:shadow-md hover:border-primary/30 transition-all active:scale-[0.98]">
        <div className="flex items-center justify-between mb-4">
          <span className="text-3xl">🎯</span>
          <span className="text-lg font-bold text-text">التارجت</span>
        </div>

        {loading ? (
          <div className="flex gap-2 text-xs text-text-secondary">
            <div className="animate-pulse w-16 h-4 bg-gray-200 rounded" />
            <div className="animate-pulse w-16 h-4 bg-gray-200 rounded" />
            <div className="animate-pulse w-16 h-4 bg-gray-200 rounded" />
          </div>
        ) : achievement != null ? (
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className={`text-xl font-bold ${color}`}>{achievement}%</div>
              <div className="text-[10px] text-text-secondary">نسبة الإنجاز</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-red-500">{lateCount}</div>
              <div className="text-[10px] text-text-secondary">متأخر</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-gray-400">{noTargetCount}</div>
              <div className="text-[10px] text-text-secondary">بدون هدف</div>
            </div>
          </div>
        ) : (
          <div className="text-center text-sm text-text-secondary">اضغط للدخول</div>
        )}
      </button>
    </div>
  )
}

export function ModuleLauncherPage() {
  const { module } = useParams<{ module: string }>()
  const nav = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isMgmt = user?.roles?.some((r) => MODULE_HOME_TARGETS.has(normalizeEmployeeRole(r))) ?? false
  const icons = module === 'attendance' && !isMgmt ? [] : MODULE_ICONS[module]?.icons

  if (!module || !MODULE_ICONS[module] || (module === 'attendance' && !isMgmt)) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
          <h1 className="text-lg font-bold text-text">القسم غير موجود</h1>
        </div>
        <div className="text-center py-12 text-text-secondary text-sm">عذراً، هذا القسم غير متاح</div>
      </div>
    )
  }

  if (module === 'targets') {
    return <TargetSummaryCard />
  }

  const config = MODULE_ICONS[module]
  return <SubLauncherPage title={config.title} icons={icons ?? config.icons} />
}
