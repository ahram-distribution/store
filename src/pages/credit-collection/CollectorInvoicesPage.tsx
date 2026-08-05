import { useState, useEffect } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { isUpperManagement } from '../../utils/roleNormalization'
import { creditCollectionService, type CreditCollectionInvoice } from '../../services/creditCollection'
import { formatCurrency } from '../../utils/format'
import { CreditFilterBar, applyCreditFilters, type CreditFilters } from './CreditFilterBar'

const creditStatusMeta: Record<string, { label: string; cls: string }> = {
  uncollected: { label: 'غير محصلة', cls: 'text-red-700 bg-red-50' },
  partially_collected: { label: 'محصلة جزئياً', cls: 'text-amber-700 bg-amber-50' },
  fully_collected: { label: 'محصلة بالكامل', cls: 'text-green-700 bg-green-50' },
}

export function CollectorInvoicesPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isCollector = user?.roles?.includes('معتمد ائتماني') ?? false
  const isUpper = user?.roles?.some(isUpperManagement) ?? false

  const [invoices, setInvoices] = useState<CreditCollectionInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<CreditFilters>({ datePreset: 'all', dateFrom: '', dateTo: '', status: '', search: '' })

  async function refresh() {
    setInvoices(await creditCollectionService.listCollectorInvoices())
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  if (!isCollector && !isUpper) return <Navigate to="/dashboard" replace />

  const filtered = applyCreditFilters(invoices, filters)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isUpper && (
            <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
          )}
          <div>
            <h1 className="text-lg font-bold text-text">فواتير الائتمان</h1>
            <p className="text-xs text-text-secondary">فواتير ائتمان (ittiman) مسلّمة</p>
          </div>
        </div>
        <button onClick={refresh} className="bg-surface text-text text-xs px-3 py-2 rounded-lg border border-border">تحديث</button>
      </div>

      <CreditFilterBar
        filters={filters}
        onChange={setFilters}
        searchPlaceholder="بحث برقم الفاتورة، المرجع، اسم العميل، الهاتف، رقم الشيك، صاحب الشيك"
      />

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">
          {invoices.length === 0 ? 'لا توجد فواتير ائتمان مسلّمة' : 'لا توجد نتائج مطابقة للفلاتر'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((inv) => <InvoiceCard key={inv.order_id} invoice={inv} />)}
        </div>
      )}
    </div>
  )
}

function Field({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="text-sm font-semibold text-text mt-0.5 break-words">{value}</p>
    </div>
  )
}

function InvoiceCard({ invoice }: { invoice: CreditCollectionInvoice }) {
  const navigate = useNavigate()
  const badge = creditStatusMeta[invoice.credit_status] ?? creditStatusMeta.uncollected
  const mapsUrl = invoice.location_latitude != null && invoice.location_longitude != null
    ? `https://www.google.com/maps?q=${invoice.location_latitude},${invoice.location_longitude}`
    : null

  return (
    <div
      onClick={() => navigate(`/credit/invoices/${invoice.order_id}`)}
      className="bg-white rounded-xl border border-border p-4 space-y-3 cursor-pointer active:bg-surface"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-text">{invoice.customer_name}</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="رقم الفاتورة" value={invoice.order_number} />
        <Field label="الرقم المرجعى" value={invoice.reference_number || '--'} />
        <Field label="الهاتف" value={invoice.phone || '--'} />
        <div>
          <p className="text-[11px] text-text-secondary">رابط الموقع</p>
          {mapsUrl ? (
            <a href={mapsUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-sm font-semibold text-primary mt-0.5 block">فتح الموقع على الخريطة</a>
          ) : (
            <p className="text-sm font-semibold text-text mt-0.5">--</p>
          )}
        </div>
        <Field label="العنوان" value={invoice.address || '--'} full />
        <Field label="إجمالي الفاتورة" value={formatCurrency(invoice.invoice_amount)} />
        <Field label="المتبقي" value={formatCurrency(invoice.balance)} />
      </div>

      <p className="text-xs text-primary font-semibold border-t border-border pt-2">فتح الفاتورة</p>
    </div>
  )
}