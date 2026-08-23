import { useNavigate } from 'react-router-dom'

interface SahlModule {
  icon: string
  label: string
  desc: string
  path: string
  badge?: string
}

const SAHL_MODULES: SahlModule[] = [
  {
    icon: '🧾',
    label: 'المبيعات (POS)',
    desc: 'فواتير بيع نقدية / بطاقة / آجل وعروض أسعار مع حجز البضاعة',
    path: '/sahl/pos',
    badge: 'جديد',
  },
  {
    icon: '📄',
    label: 'الفواتير والعروض',
    desc: 'سجل الفواتير وعروض الأسعار — طباعة وتحويل وإلغاء',
    path: '/sahl/invoices',
    badge: 'جديد',
  },
  {
    icon: '💰',
    label: 'القبض',
    desc: 'سندات القبض — تحصيل من العملاء وترحيلها للخزينة وكشف الحساب',
    path: '/sahl/receipts',
  },
  {
    icon: '💸',
    label: 'المصروفات',
    desc: 'سندات الصرف — مصروفات تشغيلية وترحيلها للخزينة',
    path: '/sahl/expenses',
  },
  {
    icon: '🏦',
    label: 'الخزينة',
    desc: 'حركة النقدية — الوارد والمنصرف ورصيد الخزينة',
    path: '/sahl/treasury',
  },
  {
    icon: '📊',
    label: 'الحسابات',
    desc: 'أرصدة العملاء وكشوف الحساب والحركات المالية',
    path: '/sahl/accounts',
  },
  {
    icon: '🏭',
    label: 'الموردين',
    desc: 'بيانات الموردين والمستحقات وسندات الصرف للمورد',
    path: '/sahl/suppliers',
  },
  {
    icon: '🛒',
    label: 'المشتريات',
    desc: 'فواتير الشراء — ترحيلها للخزينة والمخزون وحسابات الموردين',
    path: '/sahl/purchases',
  },
  {
    icon: '↩️',
    label: 'المرتجعات',
    desc: 'مرتجع البيع ومرتجع الشراء — الفحص والاعتماد والأثر على المخزون والحسابات',
    path: '/sahl/returns',
  },
  {
    icon: '🧾',
    label: 'سلف الموظفين',
    desc: 'صرف سلف الموظفين من الخزينة وتسويتها',
    path: '/sahl/advances',
  },
  {
    icon: '📦',
    label: 'المخزون والجرد',
    desc: 'تسويات الكميات وجلسات الجرد الفعلي وأثرها على قيمة المخزون',
    path: '/sahl/inventory',
  },
  {
    icon: '🗓️',
    label: 'الأقساط',
    desc: 'خطط سداد مجدولة للعملاء وتحصيل الأقساط وترحيلها للخزينة',
    path: '/sahl/installments',
  },
  {
    icon: '🧾',
    label: 'الشيكات',
    desc: 'شيكات واردة وصادرة — الإيداع والتحصيل والارتداد وأثرها على الحسابات',
    path: '/sahl/cheques',
  },
  {
    icon: '📊',
    label: 'التقارير',
    desc: 'تقارير يومية ومالية وتحليل المبيعات والأصناف والعملاء',
    path: '/sahl/reports',
  },
  {
    icon: '⚙️',
    label: 'الإعدادات',
    desc: 'المخازن والخزائن والتفضيلات العامة لمساحة سهل',
    path: '/sahl/settings',
    badge: 'جديد',
  },
]

const LINKED_AHRAM_MODULES: SahlModule[] = [
  { icon: '👥', label: 'العملاء', desc: 'قاعدة عملاء أهرام', path: '/customers' },
  { icon: '📦', label: 'المنتجات', desc: 'إدارة المنتجات والأسعار', path: '/products/manage' },
  { icon: '🧾', label: 'التحصيلات', desc: 'قائمة التحصيلات الحالية', path: '/collections' },
  { icon: '🏬', label: 'المخزون', desc: 'المخزن والتجهيز', path: '/warehouse' },
]

export default function SahlDashboardPage() {
  const nav = useNavigate()

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header band — distinct SAHL workspace identity */}
      <div className="bg-gradient-to-l from-slate-800 via-slate-700 to-slate-600 rounded-2xl shadow-lg overflow-hidden">
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => nav('/dashboard')} className="text-white/70 hover:text-white text-xl" title="رجوع للإدارة العليا">&rarr;</button>
            <div>
              <h1 className="text-2xl font-bold text-white">سهل</h1>
              <p className="text-xs text-white/70 mt-1">مساحة الأعمال التشغيلية — البيع والتحصيل والمخزون والحسابات</p>
            </div>
          </div>
          <div className="hidden md:block text-left">
            <div className="text-3xl">🧮</div>
          </div>
        </div>
      </div>

      {/* Active SAHL modules */}
      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="bg-gradient-to-l from-emerald-700 to-emerald-600 px-5 py-3.5">
          <h2 className="text-sm font-bold text-white">💼 وحدات سهل</h2>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 min-[430px]:grid-cols-3 lg:grid-cols-4 gap-4 max-w-5xl">
            {SAHL_MODULES.map((m) => (
              <button key={m.path} onClick={() => nav(m.path)}
                className="bg-white rounded-xl border border-border p-4 text-center active:bg-surface transition-all hover:shadow-md hover:border-primary/30 active:scale-95">
                <div className="text-3xl mb-2">{m.icon}</div>
                <div className="text-sm font-bold text-text">{m.label}</div>
                <div className="text-[10px] text-text-secondary mt-1 leading-relaxed">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Linked existing Ahram screens (real destinations) */}
      <div className="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
        <div className="bg-gradient-to-l from-slate-600 to-slate-500 px-5 py-3.5">
          <h2 className="text-sm font-bold text-white">🔗 شاشات أهرام المرتبطة</h2>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 min-[430px]:grid-cols-3 lg:grid-cols-4 gap-4 max-w-5xl">
            {LINKED_AHRAM_MODULES.map((m) => (
              <button key={m.path} onClick={() => nav(m.path)}
                className="bg-white rounded-xl border border-border p-4 text-center active:bg-surface transition-all hover:shadow-md hover:border-primary/30 active:scale-95">
                <div className="text-3xl mb-2">{m.icon}</div>
                <div className="text-xs font-semibold text-text">{m.label}</div>
                <div className="text-[10px] text-text-secondary mt-0.5">{m.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-center text-[10px] text-text-secondary pb-4">
        مساحة سهل تُبنى على البنية الحقيقية لنظام أهرام — تُضاف الوحدات تدريجياً بعد اكتمال دورة كل وظيفة
      </p>
    </div>
  )
}
