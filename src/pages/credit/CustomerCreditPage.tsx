import { useState, useEffect } from 'react'
import { creditService } from '../../services/credit'
import { useAuthStore } from '../../store/auth'
import { formatCurrencyShort } from '../../utils/format'
import type { CreditAccountRecord, CreditInvoiceRecord } from '../../types/storefront'

const statusTitles: Record<string, string> = {
  active: 'نشط', suspended: 'موقوف', closed: 'مغلق',
  open: 'مفتوحة', paid: 'مدفوعة', overdue: 'متأخرة',
  received: 'مستلم', deposited: 'مودع', collected: 'محصل',
  cancelled: 'ملغي', returned: 'مرتجع', paid_directly: 'مدفوع مباشرة',
}

export function CustomerCreditPage() {
  const user = useAuthStore(s => s.user)
  const [account, setAccount] = useState<CreditAccountRecord | null>(null)
  const [invoices, setInvoices] = useState<CreditInvoiceRecord[]>([])
  const [programs, setPrograms] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProgram, setSelectedProgram] = useState('')
  const [applying, setApplying] = useState(false)
  const [invoiceFilter, setInvoiceFilter] = useState<'open' | 'all'>('open')

  useEffect(() => {
    Promise.all([
      creditService.getCustomerAccount(),
      creditService.getInvoices(),
      creditService.getPrograms(),
    ]).then(([acct, invs, progs]) => {
      setAccount(acct)
      setInvoices(invs)
      setPrograms(progs)
      setLoading(false)
    })
  }, [])

  const handleApply = async () => {
    if (!selectedProgram) return
    setApplying(true)
    const result = await creditService.createApplication(selectedProgram)
    setApplying(false)
    if (result.success) {
      setSelectedProgram('')
      const apps = await creditService.getApplications()
      setPrograms(prev => prev)
    }
  }

  const filteredInvoices = invoiceFilter === 'open'
    ? invoices.filter(i => i.status === 'open' || i.status === 'overdue')
    : invoices

  const usagePercent = account ? ((account.outstanding_credit + account.reserved_credit) / account.credit_limit * 100) : 0

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-br from-primary to-primary-dark text-white rounded-xl p-5">
        <p className="text-sm opacity-90">الخدمات المالية</p>
        <h2 className="text-xl font-bold mt-1">الائتمان</h2>
      </div>

      {account && (
        <>
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-text">حسابك الائتماني</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                account.credit_status === 'active' ? 'bg-emerald-50 text-emerald-600' :
                account.credit_status === 'suspended' ? 'bg-red-50 text-red-600' :
                'bg-gray-100 text-gray-600'
              }`}>
                {statusTitles[account.credit_status]}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-surface rounded-lg p-3">
                <p className="text-[10px] text-text-secondary">الحد الائتماني</p>
                <p className="text-lg font-bold text-text">{formatCurrencyShort(account.credit_limit)}</p>
              </div>
              <div className="bg-surface rounded-lg p-3">
                <p className="text-[10px] text-text-secondary">المتاح</p>
                <p className="text-lg font-bold text-emerald-600">{formatCurrencyShort(account.available_credit)}</p>
              </div>
              <div className="bg-surface rounded-lg p-3">
                <p className="text-[10px] text-text-secondary">مستحق</p>
                <p className="text-sm font-bold text-amber-600">{formatCurrencyShort(account.outstanding_credit)}</p>
              </div>
              <div className="bg-surface rounded-lg p-3">
                <p className="text-[10px] text-text-secondary">محجوز</p>
                <p className="text-sm font-bold text-blue-600">{formatCurrencyShort(account.reserved_credit)}</p>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-text-secondary">
                <span>استخدام {usagePercent.toFixed(0)}%</span>
                <span>{account.program_name} | {account.payment_term_days} يوم</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-500" style={{
                  width: `${Math.min(usagePercent, 100)}%`,
                  background: usagePercent > 90 ? '#EF4444' : usagePercent > 70 ? '#F59E0B' : '#10B981',
                }} />
              </div>
            </div>
          </div>

          {invoices.length > 0 && (
            <div className="bg-white rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text">الفواتير</h3>
                <div className="flex gap-1">
                  <button onClick={() => setInvoiceFilter('open')}
                    className={`text-xs px-2 py-1 rounded-md ${invoiceFilter === 'open' ? 'bg-primary text-white' : 'bg-surface text-text-secondary'}`}>
                    المفتوحة
                  </button>
                  <button onClick={() => setInvoiceFilter('all')}
                    className={`text-xs px-2 py-1 rounded-md ${invoiceFilter === 'all' ? 'bg-primary text-white' : 'bg-surface text-text-secondary'}`}>
                    الكل
                  </button>
                </div>
              </div>
              {filteredInvoices.map(inv => (
                <div key={inv.id} className="border-b border-border pb-2 last:border-0">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-text">{inv.invoice_number}</p>
                      <p className="text-[10px] text-text-secondary">{inv.order_number}</p>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-bold text-text">{formatCurrencyShort(inv.invoice_amount)}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        inv.status === 'paid' ? 'bg-emerald-50 text-emerald-600' :
                        inv.status === 'overdue' ? 'bg-red-50 text-red-600' :
                        'bg-amber-50 text-amber-600'
                      }`}>{statusTitles[inv.status]}</span>
                    </div>
                  </div>
                  <div className="flex justify-between text-[10px] text-text-secondary mt-1">
                    <span>استحقاق: {new Date(inv.due_date).toLocaleDateString('ar-EG-u-nu-latn')}</span>
                    {inv.days_overdue > 0 && <span className="text-red-500">متأخر {inv.days_overdue} يوم</span>}
                  </div>
                </div>
              ))}
              {filteredInvoices.length === 0 && (
                <p className="text-xs text-text-secondary text-center py-4">لا توجد فواتير</p>
              )}
            </div>
          )}
        </>
      )}

      {!account && (
        <>
          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold text-text">طلب ائتمان جديد</h3>
            {programs.length === 0 ? (
              <p className="text-xs text-text-secondary">لا توجد برامج ائتمانية متاحة حالياً</p>
            ) : (
              <>
                <select value={selectedProgram} onChange={e => setSelectedProgram(e.target.value)}
                  className="w-full border border-border rounded-lg p-2 text-sm text-right">
                  <option value="">اختر البرنامج...</option>
                  {programs.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} - {formatCurrencyShort(p.credit_limit)} / {p.credit_days} يوم
                    </option>
                  ))}
                </select>
                {selectedProgram && (
                  <div className="bg-surface rounded-lg p-3 text-xs text-text-secondary leading-relaxed">
                    {programs.find(p => p.id === selectedProgram)?.terms}
                  </div>
                )}
                <button onClick={handleApply} disabled={!selectedProgram || applying}
                  className="w-full bg-primary text-white rounded-xl p-3 text-sm font-semibold disabled:opacity-50">
                  {applying ? 'جاري التقديم...' : 'تقديم الطلب'}
                </button>
              </>
            )}
          </div>

          {user?.identity_type === 'employee' && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-xs text-amber-700">أنت مسجل كموظف. يمكن للعملاء فقط التقديم على الائتمان من هنا.</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
