import { useState, useEffect } from 'react'
import { creditService } from '../../services/credit'
import type { CreditDashboardStats } from '../../types/storefront'

export function CreditManagementPage() {
  const [tab, setTab] = useState<'dashboard' | 'programs' | 'invoices'>('dashboard')
  const [stats, setStats] = useState<CreditDashboardStats | null>(null)
  const [programs, setPrograms] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [newProgram, setNewProgram] = useState({ name: '', creditLimit: '', creditDays: '', terms: '' })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    const [s, p, i] = await Promise.all([
      creditService.getDashboard(),
      creditService.getPrograms(),
      creditService.getInvoices(),
    ])
    setStats(s)
    setPrograms(p)
    setInvoices(i)
    setLoading(false)
  }

  const handleCreateProgram = async () => {
    if (!newProgram.name || !newProgram.creditLimit || !newProgram.creditDays) return
    setCreating(true)
    const result = await creditService.createProgram(
      newProgram.name, Number(newProgram.creditLimit), Number(newProgram.creditDays), newProgram.terms,
    )
    setCreating(false)
    if (result.success) {
      setNewProgram({ name: '', creditLimit: '', creditDays: '', terms: '' })
      const p = await creditService.getPrograms()
      setPrograms(p)
    }
  }

  const handleToggleProgram = async (id: string) => {
    await creditService.toggleProgram(id)
    const p = await creditService.getPrograms()
    setPrograms(p)
  }

  const handleRecordPayment = async (invoiceId: string) => {
    const result = await creditService.recordPayment(invoiceId)
    if (result.success) {
      const [s, i] = await Promise.all([creditService.getDashboard(), creditService.getInvoices()])
      setStats(s)
      setInvoices(i)
    }
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-primary to-primary-dark text-white rounded-xl p-5">
        <p className="text-sm opacity-90">الإدارة المالية</p>
        <h2 className="text-xl font-bold mt-1">إدارة الائتمان</h2>
      </div>

      <div className="flex gap-1 bg-surface rounded-xl p-1">
        {([
          { key: 'dashboard', label: 'الإحصائيات' },
          { key: 'programs', label: 'البرامج' },
          { key: 'invoices', label: 'الفواتير' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 text-xs font-semibold py-2 rounded-lg transition-colors ${
              tab === t.key ? 'bg-white text-primary shadow-sm' : 'text-text-secondary'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && stats && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-xl border border-border p-4">
              <p className="text-[10px] text-text-secondary">إجمالي الحسابات</p>
              <p className="text-2xl font-bold text-text">{stats.total_accounts}</p>
              <div className="flex gap-2 mt-1 text-[10px]">
                <span className="text-emerald-600">{stats.active_accounts} نشط</span>
                <span className="text-red-600">{stats.suspended_accounts} موقوف</span>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-border p-4">
              <p className="text-[10px] text-text-secondary">الحد الائتماني الإجمالي</p>
              <p className="text-2xl font-bold text-text">{(stats.total_credit_limit / 1000).toFixed(0)}k</p>
              <p className="text-[10px] text-text-secondary mt-1">
                {(stats.total_outstanding / 1000).toFixed(0)}k مستحق · {(stats.total_reserved / 1000).toFixed(0)}k محجوز
              </p>
            </div>
            <div className="bg-white rounded-xl border border-border p-4">
              <p className="text-[10px] text-text-secondary">الفواتير</p>
              <p className="text-2xl font-bold text-text">{stats.open_invoices + stats.overdue_invoices}</p>
              <div className="flex gap-2 mt-1 text-[10px]">
                <span className="text-amber-600">{stats.open_invoices} مفتوحة</span>
                <span className="text-red-600">{stats.overdue_invoices} متأخرة</span>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-border p-4">
              <p className="text-[10px] text-text-secondary">الطلبات المعلقة</p>
              <p className="text-2xl font-bold text-text">{stats.pending_applications}</p>
            </div>
          </div>
        </div>
      )}

      {tab === 'programs' && (
        <div className="space-y-3">
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold text-text">برنامج جديد</h3>
            <input value={newProgram.name} onChange={e => setNewProgram(p => ({ ...p, name: e.target.value }))}
              placeholder="اسم البرنامج" className="w-full border border-border rounded-lg p-2 text-sm text-right" />
            <div className="grid grid-cols-2 gap-2">
              <input value={newProgram.creditLimit} onChange={e => setNewProgram(p => ({ ...p, creditLimit: e.target.value }))}
                type="number" placeholder="الحد الائتماني" className="w-full border border-border rounded-lg p-2 text-sm text-right" />
              <input value={newProgram.creditDays} onChange={e => setNewProgram(p => ({ ...p, creditDays: e.target.value }))}
                type="number" placeholder="مدة السداد (أيام)" className="w-full border border-border rounded-lg p-2 text-sm text-right" />
            </div>
            <textarea value={newProgram.terms} onChange={e => setNewProgram(p => ({ ...p, terms: e.target.value }))}
              placeholder="الشروط" rows={3} className="w-full border border-border rounded-lg p-2 text-sm text-right resize-none" />
            <button onClick={handleCreateProgram} disabled={creating}
              className="w-full bg-primary text-white rounded-xl p-3 text-sm font-semibold disabled:opacity-50">
              {creating ? 'جاري الإنشاء...' : 'إضافة برنامج'}
            </button>
          </div>

          {programs.map(p => (
            <div key={p.id} className="bg-white rounded-xl border border-border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-text">{p.name}</p>
                  <p className="text-xs text-text-secondary">{p.credit_limit?.toLocaleString()} ج.م / {p.credit_days} يوم</p>
                </div>
                <button onClick={() => handleToggleProgram(p.id)}
                  className={`text-xs px-2 py-1 rounded-md ${
                    p.is_active ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                  }`}>
                  {p.is_active ? 'نشط' : 'موقوف'}
                </button>
              </div>
              {p.terms && <p className="text-[10px] text-text-secondary mt-2 leading-relaxed">{p.terms}</p>}
            </div>
          ))}
        </div>
      )}

      {tab === 'invoices' && (
        <div className="space-y-2">
          {invoices.length === 0 && (
            <p className="text-xs text-text-secondary text-center py-8">لا توجد فواتير</p>
          )}
          {invoices.map(inv => (
            <div key={inv.id} className="bg-white rounded-xl border border-border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-text">{inv.invoice_number}</p>
                  <p className="text-[10px] text-text-secondary">{inv.order_number}</p>
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold text-text">{inv.invoice_amount.toLocaleString()} ج.م</p>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    inv.status === 'paid' ? 'bg-emerald-50 text-emerald-600' :
                    inv.status === 'overdue' ? 'bg-red-50 text-red-600' :
                    'bg-amber-50 text-amber-600'
                  }`}>
                    {inv.status === 'open' ? 'مفتوحة' : inv.status === 'paid' ? 'مدفوعة' : 'متأخرة'}
                  </span>
                </div>
              </div>
              <div className="flex justify-between items-center mt-2">
                <div className="text-[10px] text-text-secondary">
                  <span>استحقاق: {new Date(inv.due_date).toLocaleDateString('ar-EG')}</span>
                  {inv.days_overdue > 0 && <span className="text-red-500 mr-2">متأخر {inv.days_overdue} يوم</span>}
                </div>
                {inv.status !== 'paid' && (
                  <button onClick={() => handleRecordPayment(inv.id)}
                    className="text-xs bg-emerald-50 text-emerald-600 px-2 py-1 rounded-md">
                    تسجيل الدفع
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
