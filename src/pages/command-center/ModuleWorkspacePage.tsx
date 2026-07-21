import { useParams, useNavigate } from 'react-router-dom'

interface KpiCard {
  icon: string
  label: string
  path: string
}

interface ModuleConfig {
  title: string
  icon: string
  operations: KpiCard[]
}

const MODULE_CONFIGS: Record<string, ModuleConfig> = {
  orders: {
    title: 'الطلبات',
    icon: '\u{1F6D2}',
    operations: [
      { icon: '\u{1F4CB}', label: 'كل الطلبات', path: '/orders' },
      { icon: '\u{2795}', label: 'إنشاء طلب', path: '/orders/new' },
      { icon: '\u{1F4C4}', label: 'طلباتي', path: '/orders?my=1' },
      { icon: '\u{1F4C4}', label: 'فواتيري', path: '/orders?my_invoices=1' },
      { icon: '\u{1F50D}', label: 'متابعة الطلبات', path: '/orders/approval-queue' },
      { icon: '\u{1F69A}', label: 'التسليم', path: '/delivery' },
      { icon: '\u{1F504}', label: 'المرتجعات', path: '/returns' },
      { icon: '\u{1F4E6}', label: 'تجهيز المخزن', path: '/warehouse' },
    ],
  },
  customers: {
    title: 'العملاء',
    icon: '\u{1F465}',
    operations: [
      { icon: '\u{1F465}', label: 'كل العملاء', path: '/customers' },
      { icon: '\u{2795}', label: 'عميل جديد', path: '/customers/new' },
      { icon: '\u{1F464}', label: 'عملائي', path: '/customers?my=1' },
      { icon: '\u{1F4CD}', label: 'زيارات العملاء', path: '/visits' },
      { icon: '\u{1F4CA}', label: 'تحليلات العملاء', path: '/analytics/customers' },
      { icon: '\u{1F4B3}', label: 'الائتمان', path: '/credit' },
    ],
  },
  visits: {
    title: 'الزيارات',
    icon: '\u{1F4CD}',
    operations: [
      { icon: '\u{1F4CD}', label: 'كل الزيارات', path: '/visits' },
      { icon: '\u{2795}', label: 'زيارة جديدة', path: '/visits/new' },
      { icon: '\u{25B6}\u{FE0F}', label: 'بدء زيارة', path: '/visits?filter=active' },
    ],
  },
  credit: {
    title: 'الائتمان',
    icon: '\u{1F4B3}',
    operations: [
      { icon: '\u{1F4B3}', label: 'الائتمان', path: '/credit' },
      { icon: '\u{1F4CB}', label: 'طلبات الائتمان', path: '/credit/applications' },
      { icon: '\u{1F4E6}', label: 'برامج الائتمان', path: '/credit/programs' },
      { icon: '\u{2699}\u{FE0F}', label: 'إدارة الائتمان', path: '/credit/manage' },
    ],
  },
  inventory: {
    title: 'المخزون',
    icon: '\u{1F4E6}',
    operations: [
      { icon: '\u{1F4E6}', label: 'المخزون', path: '/warehouse' },
      { icon: '\u{1F50D}', label: 'مراجعة المخزون', path: '/warehouse/review' },
      { icon: '\u{270F}\u{FE0F}', label: 'إدارة المنتجات', path: '/products/manage' },
    ],
  },
  employees: {
    title: 'الموظفون',
    icon: '\u{1F464}',
    operations: [
      { icon: '\u{1F464}', label: 'كل الموظفين', path: '/employees' },
      { icon: '\u{1F465}', label: 'الهيكل البيعي', path: '/hierarchy' },
      { icon: '\u{1F3AD}', label: 'الأدوار', path: '/employees#roles' },
      { icon: '\u{1F510}', label: 'الصلاحيات', path: '/employees#permissions' },
      { icon: '\u{1F464}', label: 'بياناتي', path: '/account/profile' },
      { icon: '\u{1F510}', label: 'صلاحياتي', path: '/account/permissions' },
    ],
  },
  collections: {
    title: 'التحصيلات',
    icon: '\u{1F4B0}',
    operations: [
      { icon: '\u{1F4B0}', label: 'كل التحصيلات', path: '/collections' },
      { icon: '\u{2795}', label: 'تحصيل جديد', path: '/collections/new' },
      { icon: '\u{1F50D}', label: 'متابعة التحصيل', path: '/collections/followup' },
    ],
  },
  returns: {
    title: 'المرتجعات',
    icon: '\u{1F4CB}',
    operations: [
      { icon: '\u{1F4CB}', label: 'كل المرتجعات', path: '/returns' },
      { icon: '\u{2795}', label: 'مرتجع جديد', path: '/returns/new' },
    ],
  },
  delivery: {
    title: 'التسليم',
    icon: '\u{1F69A}',
    operations: [
      { icon: '\u{1F69A}', label: 'كل التوصيلات', path: '/delivery' },
      { icon: '\u{1F4CD}', label: 'متابعة التوصيل', path: '/delivery' },
    ],
  },
  reports: {
    title: 'التقارير',
    icon: '\u{1F4CA}',
    operations: [
      { icon: '\u{1F4CA}', label: 'التقارير', path: '/reports' },
      { icon: '\u{1F4CA}', label: 'تحليل المبيعات', path: '/sales-analytics' },
      { icon: '\u{1F4CA}', label: 'تقارير العملاء', path: '/analytics/customers' },
      { icon: '\u{1F504}', label: 'النشاط الموحد', path: '/activity' },
    ],
  },
  warehouse: {
    title: 'المستودع',
    icon: '\u{1F3D7}\u{FE0F}',
    operations: [
      { icon: '\u{1F4E6}', label: 'المخزون', path: '/warehouse' },
      { icon: '\u{1F50D}', label: 'مراجعة المخزون', path: '/warehouse/review' },
      { icon: '\u{1F4E6}', label: 'تجهيز الطلبات', path: '/warehouse' },
    ],
  },
}

export function ModuleWorkspacePage() {
  const { moduleKey } = useParams<{ moduleKey: string }>()
  const nav = useNavigate()

  const config = moduleKey ? MODULE_CONFIGS[moduleKey] : undefined

  if (!config) {
    return (
      <div className="p-4 space-y-4" dir="rtl">
        <div className="flex items-center gap-3">
          <button onClick={() => nav('/command-center')} className="text-text-secondary text-lg">&larr;</button>
          <h1 className="text-lg font-bold text-text">القسم غير موجود</h1>
        </div>
        <div className="text-center py-12 text-text-secondary text-sm">عذراً، هذا القسم غير متاح</div>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={() => nav('/command-center')} className="text-text-secondary text-lg">&larr;</button>
        <span className="text-2xl">{config.icon}</span>
        <h1 className="text-lg font-bold text-text">{config.title}</h1>
      </div>

      <div className="grid grid-cols-2 min-[420px]:grid-cols-3 gap-3">
        {config.operations.map((card) => (
          <button key={card.path}
            onClick={() => nav(card.path)}
            className="bg-white rounded-xl border border-border p-4 text-center active:scale-[0.97] transition-all hover:shadow-sm hover:border-primary/30">
            <div className="text-2xl mb-1.5">{card.icon}</div>
            <div className="text-xs font-semibold text-text">{card.label}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
