import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { isUpperManagement } from '../../utils/roleNormalization'
import { getCurrentLocation } from '../../services/gpsService'
import { creditCollectionService, type CreditCollectionInvoice, type CollectionHistoryItem } from '../../services/creditCollection'
import { formatCurrency, formatDate, formatDateTime, formatTime } from '../../utils/format'
import { MobileDialog } from '../../components/shared/MobileDialog'
import { ResolvedAddress } from '../../components/shared/ResolvedAddress'
import toast from 'react-hot-toast'

const creditStatusMeta: Record<string, { label: string; cls: string }> = {
  uncollected: { label: 'غير محصلة', cls: 'text-red-700 bg-red-50' },
  partially_collected: { label: 'محصلة جزئياً', cls: 'text-amber-700 bg-amber-50' },
  fully_collected: { label: 'محصلة بالكامل', cls: 'text-green-700 bg-green-50' },
}

export function CreditInvoiceDetailsPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isCollector = user?.roles?.includes('معتمد ائتماني') ?? false
  const isUpper = user?.roles?.some(isUpperManagement) ?? false

  const [invoice, setInvoice] = useState<CreditCollectionInvoice | null>(null)
  const [history, setHistory] = useState<CollectionHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [collectOpen, setCollectOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function refresh() {
    if (!orderId) return
    const [rows, hist] = await Promise.all([
      creditCollectionService.listCollectorInvoices(),
      creditCollectionService.getInvoiceHistory(orderId),
    ])
    setInvoice(rows.find((r) => r.order_id === orderId) ?? null)
    setHistory(hist)
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId])

  if (!isCollector && !isUpper) return <Navigate to="/dashboard" replace />

  async function decide(requestId: string, decision: 'approve' | 'reject') {
    let reason: string | undefined
    if (decision === 'reject') {
      reason = window.prompt('سبب الرفض (اختياري):') ?? undefined
      if (reason === null) return
    }
    setBusyId(requestId)
    const res = await creditCollectionService.decideRequest({ requestId, decision, notes: reason })
    setBusyId(null)
    if (res.error) { toast.error(res.error); return }
    toast.success(decision === 'approve' ? 'تم اعتماد التحصيل وتخفيض الرصيد' : 'تم رفض الطلب')
    await refresh()
  }

  const badge = creditStatusMeta[invoice?.credit_status ?? ''] ?? creditStatusMeta.uncollected
  const mapsUrl = invoice && invoice.location_latitude != null && invoice.location_longitude != null
    ? `https://www.google.com/maps?q=${invoice.location_latitude},${invoice.location_longitude}`
    : null
  const canEditCreditInfo = invoice ? !(invoice.invoice_id && invoice.info_locked) || isUpper : false
  const canCollect = !!invoice?.invoice_id
  const pendingRequests = history.filter((h) => h.status === 'pending')
  const decidedHistory = history.filter((h) => h.status !== 'pending')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(isUpper ? '/credit/invoices' : '/credit/collector')} className="text-text-secondary text-lg">&larr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">تفاصيل فاتورة الائتمان</h1>
            <p className="text-xs text-text-secondary">{invoice?.order_number || 'جاري التحميل...'}</p>
          </div>
        </div>
        <button onClick={refresh} className="bg-surface text-text text-xs px-3 py-2 rounded-lg border border-border">تحديث</button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : !invoice ? (
        <div className="text-center py-12 text-text-secondary text-sm">لم يتم العثور على الفاتورة</div>
      ) : (
        <>
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
          </div>

          {isUpper ? (
            <>
              <CreditInfoCollapsible
                invoice={invoice}
                canEditCreditInfo={canEditCreditInfo}
                locked={!!(invoice.invoice_id && invoice.info_locked)}
                onChanged={refresh}
              />

              <div className="bg-white rounded-xl border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-text">سجل التحصيل</h2>
                  {pendingRequests.length > 0 && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium text-amber-700 bg-amber-50">{pendingRequests.length} بانتظار</span>
                  )}
                </div>
                {history.length === 0 ? (
                  <p className="text-xs text-text-secondary">لا توجد طلبات تحصيل لهذه الفاتورة</p>
                ) : (
                  <div className="space-y-3">
                    {[...pendingRequests, ...decidedHistory].map((item, i) => (
                      <CollectionRequestCard
                        key={item.request_id}
                        item={item}
                        tone={cardTones[i % cardTones.length]}
                        address={invoice.address}
                        canDecide={item.status === 'pending'}
                        busy={busyId === item.request_id}
                        onDecide={(d) => decide(item.request_id, d)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="bg-white rounded-xl border border-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-text">بيانات الائتمان</h2>
                  {invoice.invoice_id && invoice.info_locked && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium text-text-secondary bg-surface">مقفلة</span>
                  )}
                </div>
                {canEditCreditInfo ? (
                  <CreditInfoForm invoice={invoice} onChanged={refresh} />
                ) : (
                  <LockedCreditInfo invoice={invoice} />
                )}
              </div>

              <div className="bg-white rounded-xl border border-border p-4 space-y-3">
                <h2 className="text-sm font-bold text-text">سجل التحصيلات</h2>
                {history.length === 0 ? (
                  <p className="text-xs text-text-secondary">لا توجد تحصيلات لهذه الفاتورة</p>
                ) : (
                  <div className="space-y-2">
                    {history.map((item, i) => (
                      <HistoryRow
                        key={item.request_id}
                        item={item}
                        tone={cardTones[i % cardTones.length]}
                        canDecide={false}
                        busy={false}
                        onDecide={() => {}}
                      />
                    ))}
                  </div>
                )}
              </div>

              {isCollector && (
                <>
                  <button
                    onClick={() => setCollectOpen(true)}
                    disabled={!canCollect}
                    className="w-full bg-accent text-white text-xs py-2.5 rounded-lg disabled:opacity-40"
                  >
                    تحصيل
                  </button>
                  {!canCollect && (
                    <p className="text-[11px] text-text-secondary text-center">أدخل بيانات الائتمان أولاً لتفعيل التحصيل</p>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {collectOpen && invoice && (
        <CollectionDialog
          invoice={invoice}
          onClose={() => setCollectOpen(false)}
          onDone={() => { setCollectOpen(false); refresh() }}
        />
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

const historyStatusMeta: Record<string, { label: string; cls: string }> = {
  pending: { label: 'قيد الانتظار', cls: 'text-amber-700 bg-amber-50' },
  approved: { label: 'معتمد', cls: 'text-green-700 bg-green-50' },
  rejected: { label: 'مرفوض', cls: 'text-red-700 bg-red-50' },
}

const cardTones = [
  'border-blue-200 bg-blue-50/60',
  'border-emerald-200 bg-emerald-50/60',
  'border-violet-200 bg-violet-50/60',
  'border-orange-200 bg-orange-50/60',
  'border-teal-200 bg-teal-50/60',
  'border-pink-200 bg-pink-50/60',
  'border-cyan-200 bg-cyan-50/60',
  'border-lime-200 bg-lime-50/60',
]

function HistoryRow({
  item,
  tone,
  canDecide,
  busy,
  onDecide,
}: {
  item: CollectionHistoryItem
  tone: string
  canDecide: boolean
  busy: boolean
  onDecide: (decision: 'approve' | 'reject') => void
}) {
  const meta = historyStatusMeta[item.status] ?? { label: item.status, cls: 'text-text-secondary bg-surface' }
  return (
    <div className={`${tone} rounded-lg border p-3 text-xs space-y-1`}>
      <div className="flex items-center justify-between">
        <p className="font-bold text-text">{formatCurrency(item.amount)}</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${meta.cls}`}>{meta.label}</span>
      </div>
      <p className="text-text"><span className="text-text-secondary">تاريخ التحصيل: </span>{formatDateTime(item.collected_at)}</p>
      {item.decided_at && (
        <p className="text-text"><span className="text-text-secondary">تاريخ الاعتماد: </span>{formatDateTime(item.decided_at)}</p>
      )}
      <p className="text-text"><span className="text-text-secondary">المحصل: </span>{item.collector_name || '--'}</p>
      {item.decided_by_name && (
        <p className="text-text"><span className="text-text-secondary">المعتمد من: </span>{item.decided_by_name}</p>
      )}
      {item.notes && <p className="text-text"><span className="text-text-secondary">ملاحظات: </span>{item.notes}</p>}
      {canDecide && (
        <div className="flex gap-2 pt-1">
          <button onClick={() => onDecide('approve')} disabled={busy}
            className="flex-1 bg-success text-white text-[11px] py-2 rounded-lg disabled:opacity-50">
            {busy ? 'جاري...' : 'اعتماد وتخفيض الرصيد'}
          </button>
          <button onClick={() => onDecide('reject')} disabled={busy}
            className="flex-1 bg-red-500 text-white text-[11px] py-2 rounded-lg disabled:opacity-50">
            رفض
          </button>
        </div>
      )}
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
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [gps, setGps] = useState<{ latitude: number; longitude: number } | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const gpsPromiseRef = useRef<Promise<{ latitude: number; longitude: number } | null> | null>(null)
  const gpsErrorRef = useRef<string | null>(null)

  function startCapture() {
    const p = (async () => {
      const res = await getCurrentLocation({ maxWaitMs: 15000, maxAccuracy: 100 })
      if (!res.success || !res.location) {
        const msg = res.error?.message ?? 'تعذر الحصول على الموقع'
        gpsErrorRef.current = msg
        setGpsError(msg)
        return null
      }
      const loc = { latitude: res.location.latitude, longitude: res.location.longitude }
      gpsErrorRef.current = null
      setGps(loc)
      return loc
    })()
    gpsPromiseRef.current = p
    return p
  }

  useEffect(() => {
    startCapture()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const amountEntered = Number(amount) > 0

  async function submit() {
    const amt = Number(amount)
    if (!amt || amt <= 0) { toast.error('أدخل مبلغاً صحيحاً'); return }
    if (amt > invoice.balance) { toast.error('المبلغ أكبر من المتبقي'); return }
    setSubmitting(true)
    const loc = gps ?? (await (gpsPromiseRef.current ?? startCapture()))
    if (!loc) {
      setSubmitting(false)
      toast.error(gpsErrorRef.current ?? 'تعذر التقاط الموقع — أغلق النافذة وأعد فتحها للمحاولة')
      return
    }
    const res = await creditCollectionService.submitRequest({
      invoiceId: invoice.invoice_id!,
      amount: amt,
      latitude: loc.latitude,
      longitude: loc.longitude,
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
        amountEntered ? (
          <button onClick={submit} disabled={submitting}
            className="w-full bg-accent text-white text-xs py-2.5 rounded-lg disabled:opacity-50">
            {submitting ? 'جاري إرسال الطلب...' : 'إرسال الطلب'}
          </button>
        ) : undefined
      }
    >
      <label className="block">
        <span className="text-xs text-text-secondary">المبلغ * (المتبقي: {formatCurrency(invoice.balance)})</span>
        <input type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm mt-1" />
      </label>
      <label className="block">
        <span className="text-xs text-text-secondary">ملاحظة</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
          className="w-full border border-border rounded-lg px-3 py-2 text-sm mt-1" />
      </label>
    </MobileDialog>
  )
}

function CreditInfoCollapsible({ invoice, canEditCreditInfo, locked, onChanged }: {
  invoice: CreditCollectionInvoice
  canEditCreditInfo: boolean
  locked: boolean
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-white rounded-xl border border-border">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between p-4 text-right">
        <span className="text-sm font-bold text-text">
          <span className="inline-block w-4">{open ? '▼' : '▶'}</span> بيانات الاعتماد
        </span>
        {locked && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium text-text-secondary bg-surface">مقفلة</span>
        )}
      </button>
      {open && (
        <div className="px-4 pb-4">
          {canEditCreditInfo ? (
            <CreditInfoForm invoice={invoice} onChanged={onChanged} />
          ) : (
            <LockedCreditInfo invoice={invoice} />
          )}
        </div>
      )}
    </div>
  )
}

function CollectionRequestCard({ item, tone, address, canDecide, busy, onDecide }: {
  item: CollectionHistoryItem
  tone: string
  address: string | null
  canDecide: boolean
  busy: boolean
  onDecide: (decision: 'approve' | 'reject') => void
}) {
  const meta = historyStatusMeta[item.status] ?? { label: item.status, cls: 'text-text-secondary bg-surface' }
  const mapsUrl = item.latitude != null && item.longitude != null
    ? `https://www.google.com/maps?q=${item.latitude},${item.longitude}`
    : null
  return (
    <div className={`${tone} rounded-xl border shadow-sm p-4 space-y-3`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text">طلب تحصيل</h3>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${meta.cls}`}>{meta.label}</span>
      </div>

      <div className="space-y-1 text-xs text-text">
        <p><span className="text-text-secondary">المبلغ: </span><span className="font-bold text-accent">{formatCurrency(item.amount)}</span></p>
        <p><span className="text-text-secondary">المرسل: </span><span className="font-semibold">{item.collector_name || '--'}</span></p>
        <p><span className="text-text-secondary">التاريخ: </span>{formatDate(item.collected_at)}</p>
        <p><span className="text-text-secondary">الوقت: </span>{formatTime(item.collected_at)}</p>
        <p>
          <span className="text-text-secondary">الموقع: </span>
          {item.latitude != null && item.longitude != null ? (
            <ResolvedAddress lat={item.latitude} lng={item.longitude} size="md" />
          ) : (
            address || '--'
          )}
        </p>
        {mapsUrl && (
          <p>
            <span dir="ltr" className="text-text-secondary">{item.latitude?.toFixed(6)}, {item.longitude?.toFixed(6)}</span>{' '}
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-primary font-semibold">فتح الخريطة</a>
          </p>
        )}
        {item.notes && <p><span className="text-text-secondary">الملاحظات: </span>{item.notes}</p>}
      </div>

      <div className="border-t border-border pt-3 text-xs text-text space-y-1">
        <p className="text-[11px] text-text-secondary font-semibold">نتيجة الطلب</p>
        {item.status === 'pending' && (
          <>
            <p className="flex items-center gap-1 font-bold text-amber-700">⏳ بانتظار الاعتماد</p>
            <div className="flex gap-2 pt-1">
              <button onClick={() => onDecide('approve')} disabled={busy}
                className="flex-1 bg-success text-white text-[11px] py-2 rounded-lg disabled:opacity-50">
                {busy ? 'جاري...' : 'اعتماد وتخفيض الرصيد'}
              </button>
              <button onClick={() => onDecide('reject')} disabled={busy}
                className="flex-1 bg-red-500 text-white text-[11px] py-2 rounded-lg disabled:opacity-50">
                رفض
              </button>
            </div>
          </>
        )}
        {item.status === 'approved' && (
          <>
            <p className="flex items-center gap-1 font-bold text-success">✅ تم الاعتماد</p>
            <p><span className="text-text-secondary">اعتمد بواسطة: </span><span className="font-semibold">{item.decided_by_name || 'الإدارة العليا'}</span></p>
            <p><span className="text-text-secondary">تاريخ الاعتماد: </span>{formatDate(item.decided_at!)}</p>
            <p><span className="text-text-secondary">وقت الاعتماد: </span>{formatTime(item.decided_at!)}</p>
          </>
        )}
        {item.status === 'rejected' && (
          <>
            <p className="flex items-center gap-1 font-bold text-red-600">❌ تم رفض الطلب</p>
            {item.notes && <p><span className="text-text-secondary">سبب الرفض: </span>{item.notes}</p>}
            <p><span className="text-text-secondary">اسم الرافض: </span><span className="font-semibold">{item.decided_by_name || 'الإدارة العليا'}</span></p>
            <p><span className="text-text-secondary">التاريخ: </span>{formatDate(item.decided_at!)}</p>
            <p><span className="text-text-secondary">الوقت: </span>{formatTime(item.decided_at!)}</p>
          </>
        )}
      </div>
    </div>
  )
}