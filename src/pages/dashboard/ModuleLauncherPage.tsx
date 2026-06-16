import { useParams, useNavigate } from 'react-router-dom'
import { SubLauncherPage, type LauncherIcon } from './SubLauncherPage'
import { useAuthStore } from '../../store/auth'
import { normalizeEmployeeRole } from '../../utils/roleNormalization'

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
      { icon: '📊', label: 'تحليل الزيارات', path: '/dashboard/employee-analysis' },
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
      { icon: '🧑‍💼', label: 'المناديب', path: '/employees?role=مندوب' },
      { icon: '👔', label: 'المشرفين', path: '/employees?role=مشرف' },
      { icon: '🔗', label: 'الهيكل البيعي', path: '/hierarchy' },
      { icon: '🎭', label: 'الأدوار', path: '/employees#roles' },
      { icon: '🔐', label: 'الصلاحيات', path: '/employees#permissions' },
      { icon: '🎯', label: 'الأهداف والأوزان', path: '/employees#targets' },
      { icon: '🔐', label: 'صلاحياتي', path: '/account/permissions' },
      { icon: '👤', label: 'بياناتي', path: '/account/profile' },
    ],
  },
  inventory: {
    title: 'المخزون والمنتجات',
    icons: [
      { icon: '📦', label: 'المخزون', path: '/warehouse' },
      { icon: '🛍️', label: 'المنتجات', path: '/products' },
      { icon: '➕', label: 'إضافة منتج', path: '/products?add=1' },
      { icon: '✏️', label: 'تعديل منتج', path: '/products/manage' },
      { icon: '🏭', label: 'الشركات', path: '/companies' },
      { icon: '➕', label: 'إضافة شركة', path: '/companies?add=1' },
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
      { icon: '📊', label: 'تحليل الأداء', path: '/dashboard/performance' },
      { icon: '🔍', label: 'تحليل الموظفين', path: '/dashboard/employee-analysis' },
      { icon: '📊', label: 'تقارير العملاء', path: '/analytics/customers' },
      { icon: '💳', label: 'إدارة برامج الائتمان', path: '/credit/programs/manage' },
      { icon: '💳', label: 'تقارير الائتمان', path: '/credit/manage' },
      { icon: '🔄', label: 'النشاط الموحد', path: '/activity' },
      { icon: '🎯', label: 'أهداف الشركة', path: '/dashboard/company-targets' },
      { icon: '🎯', label: 'أهداف الموظفين', path: '/dashboard/employee-targets' },
      { icon: '💪', label: 'مجهود المناديب', path: '/sales-effort' },
    ],
  },
  targets: {
    title: 'الأهداف',
    icons: [
      { icon: '🎯', label: 'أهداف الشركة', path: '/dashboard/company-targets' },
      { icon: '🎯', label: 'أهداف الموظفين', path: '/dashboard/employee-targets' },
      { icon: '📊', label: 'تحليل الأداء', path: '/dashboard/performance' },
      { icon: '🔍', label: 'تحليل الموظفين', path: '/dashboard/employee-analysis' },
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

  const config = MODULE_ICONS[module]
  return <SubLauncherPage title={config.title} icons={icons ?? config.icons} />
}
