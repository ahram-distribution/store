import { useState, useEffect } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { isUpperManagement } from '../../utils/roleNormalization'
import { getCurrentLocation } from '../../services/gpsService'
import { creditCollectionService, type CreditCollectionInvoice } from '../../services/creditCollection'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format'
import { MobileDialog } from '../../components/shared/MobileDialog'
import { CreditFilterBar, applyCreditFilters, type CreditFilters } from './CreditFilterBar'
import toast from 'react-hot-toast'

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
          {filtered.map((inv) => <InvoiceCard key={inv.order_id} invoice={inv} onChanged={refresh} />)}
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

function InvoiceCard({ invoice, onChanged }: { invoice: CreditCollectionInvoice; onChanged: () => void }) {
  const badge = creditStatusMeta[invoice.credit_status] ?? creditStatusMeta.uncollected
  const mapsUrl = invoice.location_latitude != null && invoice.location_longitude != null
    ? `https://www.google.com/maps?q=${invoice.location_latitude},${invoice.location_longitude}`
    : null

  const [infoOpen, setInfoOpen] = useState(false)
  const [collectOpen, setCollectOpen] = useState(false)

  function openCollect() {
    if (!invoice.invoice_id) {
      toast.error('أدخل بيانات الائتمان أولاً')
      return
    }
    setCollectOpen(true)
  }

  return (
    <div className="bg-white rounded-xl border border-border p-4 space-y-3">
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
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary mt-0.5 block">فتح الموقع على الخريطة</a>
          ) : (
            <p className="text-sm font-semibold text-text mt-0.5">--</p>
          )}
        </div>
        <Field label="العنوان" value={invoice.address || '--'} full />
        <Field label="إجمالي الفاتورة" value={formatCurrency(invoice.invoice_amount)} />
        <Field label="المتبقي" value={formatCurrency(invoice.balance)} />
      </div>

      <div className="flex gap-2">
        <button onClick={() => setInfoOpen(true)}
          className="flex-1 bg-primary text-white text-xs py-2.5 rounded-lg">بيانات الائتمان</button>
        <button onClick={openCollect}
          className="flex-1 bg-accent text-white text-xs py-2.5 rounded-lg">تحصيل</button>
      </div>

      {infoOpen && (
        <CreditInfoDialog invoice={invoice} onClose={() => setInfoOpen(false)} onChanged={() => { setInfoOpen(false); onChanged() }} />
      )}

      {collectOpen && (
        <CollectionDialog
          invoice={invoice}
          onClose={() => setCollectOpen(false)}
          onDone={() => { setCollectOpen(false); onChanged() }}
        />
      )}
    </div>
  )
}

function CreditInfoDialog({ invoice, onClose, onChanged }: { invoice: CreditCollectionInvoice; onClose: () => void; onChanged: () => void }) {
  return (
    <MobileDialog open onClose={onClose} title="بيانات الائتمان">
      {invoice.invoice_id && invoice.info_locked ? (
        <LockedCreditInfo invoice={invoice} />
      ) : (
        <CreditInfoForm invoice={invoice} onChanged={onChanged} />
      )}
    </MobileDialog>
  )
}

function LockedCreditInfo({ invoice }: { invoice: CreditCollectionInvoice }) {
  return (
    <div className="bg-surface rounded-lg p-3 text-xs space-y-1.5">
      <p className="text-text"><span className="text-text-secondary">تاريخ الاستحقاق: </span>{formatDate(invoice.due_date!)}</p>
      <p className="text-text"><span className="text-text-secondary">رقم الشيك: </span>{invoice.check_number || '--'}</p>
      <p className="text-text"><span className="text-text-secondary">البنك: </span>{invoice.bank_name || '--'}</p>
      <p className="text-text"><span className="text-text-secondary">صاحب الشيك: </span>{invoice.check_holder || '--'}</p>
      {invoice.notes && <p className="text-text"><span className="text-text-secondary">ملاحظات: </span>{invoice.notes}</p>}
      <p className="text-[10px] text-text-secondary pt-1">بيانات مقفلة — لا يعدلها إلا الإدارة العليا</p>
    </div>
  )
}

function CreditInfoForm({ invoice, onChanged }: { invoice: CreditCollectionInvoice; onChanged: () => void }) {
  const [form, setForm] = useState({
    due_date: invoice.due_date ?? '',
    check_number: invoice.check_number ?? '',
    bank_name: invoice.bank_name ?? '',
    check_holder: invoice.check_holder ?? '',
    notes: invoice.notes ?? '',
  })
  const [saving, setSaving] = useState(false)

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function save() {
    if (!form.due_date) { toast.error('تاريخ الاستحقاق مطلوب'); return }
    if (!form.check_number.trim()) { toast.error('رقم الشيك مطلوب'); return }
    if (!form.bank_name.trim()) { toast.error('اسم البنك مطلوب'); return }
    if (!form.check_holder.trim()) { toast.error('اسم صاحب الشيك مطلوب'); return }
    setSaving(true)
    const res = await creditCollectionService.saveInvoiceInfo({
      orderId: invoice.order_id,
      dueDate: form.due_date,
      checkNumber: form.check_number.trim(),
      bankName: form.bank_name.trim(),
      checkHolder: form.check_holder.trim(),
      notes: form.notes.trim() || undefined,
    })
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    toast.success('تم حفظ بيانات الائتمان')
    onChanged()
  }

  return (
    <div>
      <h3 className="text-xs font-semibold text-text mb-2">إدخال بيانات الائتمان</h3>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-text-secondary">تاريخ الاستحقاق *</span>
          <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm mt-1" />
        </label>
        <label className="block">
          <span className="text-xs text-text-secondary">رقم الشيك *</span>
          <input type="text" value={form.check_number} onChange={(e) => set('check_number', e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm mt-1" />
        </label>
        <label className="block">
          <span className="text-xs text-text-secondary">اسم البنك *</span>
          <input type="text" value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm mt-1" />
        </label>
        <label className="block">
          <span className="text-xs text-text-secondary">صاحب الشيك *</span>
          <input type="text" value={form.check_holder} onChange={(e) => set('check_holder', e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm mt-1" />
        </label>
        <label className="block col-span-2">
          <span className="text-xs text-text-secondary">ملاحظات</span>
          <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm mt-1" />
        </label>
      </div>
      <button onClick={save} disabled={saving}
        className="w-full bg-primary text-white text-xs py-2.5 rounded-lg mt-3 disabled:opacity-50">
        {saving ? 'جاري الحفظ...' : 'حفظ البيانات (تُقفل بعد الحفظ)'}
      </button>
    </div>
  )
}

function CollectionDialog({ invoice, onClose, onDone }: { invoice: CreditCollectionInvoice; onClose: () => void; onDone: () => void }) {
  const user = useAuthStore((s) => s.user)
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [capturing, setCapturing] = useState(false)
  const [gps, setGps] = useState<{ latitude: number; longitude: number } | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [openedAt] = useState(() => new Date())

  async function captureGps() {
    setCapturing(true)
    setGpsError(null)
    const res = await getCurrentLocation({ maxWaitMs: 15000, maxAccuracy: 100 })
    setCapturing(false)
    if (!res.success || !res.location) {
      setGpsError(res.error?.message ?? 'تعذر الحصول على الموقع')
      return
    }
    setGps({ latitude: res.location.latitude, longitude: res.location.longitude })
  }

  useEffect(() => {
    captureGps()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit() {
    const amt = Number(amount)
    if (!amt || amt <= 0) { toast.error('أدخل مبلغاً صحيحاً'); return }
    if (amt > invoice.balance) { toast.error('المبلغ أكبر من المتبقي'); return }
    if (!gps) { toast.error('التقط موقعك أولاً'); return }
    setSubmitting(true)
    const res = await creditCollectionService.submitRequest({
      invoiceId: invoice.invoice_id!,
      amount: amt,
      latitude: gps.latitude,
      longitude: gps.longitude,
      notes: notes.trim() || undefined,
    })
    setSubmitting(false)
    if (res.error) { toast.error(res.error); return }
    toast.success('تم تسجيل طلب التحصيل — بانتظار اعتماد الإدارة العليا')
    onDone()
  }

  return (
    <MobileDialog
      open
      onClose={onClose}
      title="تحصيل"
      footer={
        <button onClick={submit} disabled={submitting || capturing}
          className="w-full bg-accent text-white text-xs py-2.5 rounded-lg disabled:opacity-50">
          {submitting ? 'جاري الإرسال...' : 'إرسال الطلب'}
        </button>
      }
    >
      <label className="block">
        <span className="text-xs text-text-secondary">المبلغ * (المتبقي: {formatCurrency(invoice.balance)})</span>
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min={0} step="0.01"
          className="w-full border border-border rounded-lg px-3 py-2 text-sm mt-1" />
      </label>

      <div className="bg-surface rounded-lg p-3 text-xs space-y-1.5">
        <p className="text-text"><span className="text-text-secondary">التاريخ والوقت: </span>{formatDateTime(openedAt)}</p>
        <p className="text-text"><span className="text-text-secondary">المحصل: </span>{user?.full_name || '--'}</p>
        <p className="text-text"><span className="text-text-secondary">الحالة: </span><span className="text-amber-600 font-semibold">قيد الانتظار</span></p>
      </div>

      <div>
        <p className="text-xs text-text-secondary mb-1">الموقع (GPS) *</p>
        {capturing && <p className="text-xs text-text-secondary">جاري التقاط موقعك...</p>}
        {gpsError && <p className="text-xs text-red-600">{gpsError}</p>}
        {gps && <p className="text-xs text-success">تم التقاط الموقع: {gps.latitude.toFixed(6)}, {gps.longitude.toFixed(6)}</p>}
        {!capturing && (
          <button onClick={captureGps}
            className="bg-surface text-text text-xs px-3 py-2 rounded-lg border border-border mt-1">
            {gps ? 'إعادة التقاط الموقع' : 'التقاط الموقع'}
          </button>
        )}
      </div>

      <label className="block">
        <span className="text-xs text-text-secondary">ملاحظات</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm mt-1" />
      </label>
    </MobileDialog>
  )
}
