import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { creditCollectionService, type ManagementData, type CreditCollectionInvoice } from '../../services/creditCollection'
import { formatCurrency, formatDateTime } from '../../utils/format'
import { normalizeArabic } from '../../utils/smartSearch'
import { CreditFilterBar, applyCreditFilters, type CreditFilters } from './CreditFilterBar'

const creditStatusMeta: Record<string, { label: string; cls: string }> = {
  uncollected: { label: 'غير محصلة', cls: 'text-red-700 bg-red-50' },
  partially_collected: { label: 'محصلة جزئياً', cls: 'text-amber-700 bg-amber-50' },
  fully_collected: { label: 'محصلة بالكامل', cls: 'text-green-700 bg-green-50' },
}

type Tab = 'pending' | 'route' | 'location' | 'invoices' | 'summary' | 'history'

interface CollectionStop {
  collector: string
  order_number: string
  customer_name: string
  amount: number
  collected_at: string
  status: string
  latitude: number | null
  longitude: number | null
  notes: string | null
}

export function CreditInvoicesManagementPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('pending')
  const [data, setData] = useState<ManagementData | null>(null)
  const [invoices, setInvoices] = useState<CreditCollectionInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<CreditFilters>({ datePreset: 'all', dateFrom: '', dateTo: '', status: '', search: '' })

  async function refresh() {
    const [mgmt, list] = await Promise.all([
      creditCollectionService.getManagementData(),
      creditCollectionService.listCollectorInvoices(),
    ])
    setData(mgmt)
    setInvoices(list || [])
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  const filteredInvoices = useMemo(() => applyCreditFilters(invoices, filters), [invoices, filters])

  const searchQ = useMemo(() => (filters.search.trim() ? normalizeArabic(filters.search.trim()) : ''), [filters.search])
  const filteredPending = useMemo(() => {
    if (!data) return []
    if (!searchQ) return data.pending_requests
    return data.pending_requests.filter((r) =>
      normalizeArabic(`${r.customer_name} ${r.order_number}`).includes(searchQ)
    )
  }, [data, searchQ])

  const routeStops: CollectionStop[] = useMemo(() => {
    if (!data) return []
    const stops: CollectionStop[] = [
      ...data.pending_requests.map((r) => ({
        collector: r.collector_name,
        order_number: r.order_number,
        customer_name: r.customer_name,
        amount: r.amount,
        collected_at: r.collected_at,
        status: 'قيد الانتظار',
        latitude: r.latitude,
        longitude: r.longitude,
        notes: r.notes,
      })),
      ...data.history.map((h) => ({
        collector: h.collector_name,
        order_number: h.order_number,
        customer_name: h.customer_name,
        amount: h.amount || 0,
        collected_at: h.collected_at,
        status: h.status === 'approved' ? 'معتمد' : 'مرفوض',
        latitude: null,
        longitude: null,
        notes: h.notes,
      })),
    ]
    return stops.sort((a, b) => (a.collected_at < b.collected_at ? -1 : 1))
  }, [data])

  const routeGroups = useMemo(() => {
    const groups = new Map<string, CollectionStop[]>()
    for (const s of routeStops) {
      const list = groups.get(s.collector) || []
      list.push(s)
      groups.set(s.collector, list)
    }
    return Array.from(groups.entries())
  }, [routeStops])

  const locationStops = useMemo(
    () => routeStops.filter((s) => s.latitude != null && s.longitude != null),
    [routeStops]
  )

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!data) return <div className="text-center py-12 text-text-secondary text-sm">لا توجد بيانات</div>

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'pending', label: 'طلبات الاعتماد', badge: data.summary.pending_requests },
    { key: 'route', label: 'مراجعة المسار' },
    { key: 'location', label: 'مراجعة الموقع' },
    { key: 'invoices', label: 'فواتير الائتمان' },
    { key: 'summary', label: 'الملخص' },
    { key: 'history', label: 'السجل' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
          <div>
            <h1 className="text-lg font-bold text-text">فواتير الائتمان</h1>
            <p className="text-xs text-text-secondary">إدارة تحصيل الائتمان (ittiman) — الإدارة العليا</p>
          </div>
        </div>
        <button onClick={refresh} className="bg-surface text-text text-xs px-3 py-2 rounded-lg border border-border">تحديث</button>
      </div>

      <CreditFilterBar
        filters={filters}
        onChange={setFilters}
        showOverdue
        searchPlaceholder="بحث برقم الطلب، اسم العميل، الهاتف، رقم الشيك، صاحب الشيك"
      />

      <div className="flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${tab === t.key ? 'bg-primary text-white' : 'bg-white text-text border border-border'}`}>
            {t.label}
            {t.badge ? <span className="mr-1 text-[10px] bg-accent text-white rounded-full px-1.5 py-0.5">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'pending' && (
        filteredPending.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">لا توجد طلبات تحصيل معلقة</div>
        ) : (
          filteredPending.map((r) => (
            <div
              key={r.request_id}
              onClick={() => navigate(`/credit/invoices/${r.order_id}`)}
              className="bg-white rounded-xl border border-border p-4 space-y-3 cursor-pointer active:bg-surface"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-text">{r.customer_name}</p>
                  <p className="text-xs text-text-secondary mt-0.5">فاتورة {r.order_number} • تحصيل {formatDateTime(r.collected_at)}</p>
                </div>
                <p className="text-base font-bold text-accent">{formatCurrency(r.amount)}</p>
              </div>
              <div className="bg-surface rounded-lg p-2 text-[10px] text-text-secondary">
                <p>المعتمد: {r.collector_name}</p>
                {r.latitude != null && r.longitude != null && (
                  <p>
                    الموقع:{' '}
                    <a href={`https://www.google.com/maps?q=${r.latitude},${r.longitude}`} target="_blank" rel="noreferrer" className="text-primary font-semibold">
                      فتح على الخريطة
                    </a>
                  </p>
                )}
                {r.notes && <p>ملاحظات: {r.notes}</p>}
              </div>
              <p className="text-xs text-primary font-semibold border-t border-border pt-2">فتح الفاتورة</p>
            </div>
          ))
        )
      )}

      {tab === 'route' && (
        routeGroups.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">لا توجد نقاط تحصيل بعد</div>
        ) : (
          <div className="space-y-4">
            {routeGroups.map(([collector, stops]) => (
              <div key={collector} className="bg-white rounded-xl border border-border p-4 space-y-3">
                <p className="text-sm font-bold text-text">المحصل: {collector}</p>
                {stops.map((s, i) => (
                  <div key={`${collector}-${i}`} className="border-r-2 border-primary/30 pr-3 space-y-0.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-text">{s.customer_name} — {s.order_number}</p>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                        s.status === 'قيد الانتظار' ? 'text-amber-700 bg-amber-50' :
                        s.status === 'معتمد' ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
                      }`}>{s.status}</span>
                    </div>
                    <p className="text-[10px] text-text-secondary">
                      {formatCurrency(s.amount)} • {formatDateTime(s.collected_at)}
                    </p>
                    {s.latitude != null && s.longitude != null && (
                      <p className="text-[10px]">
                        <a href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`} target="_blank" rel="noreferrer" className="text-primary font-semibold">
                          فتح الموقع على الخريطة
                        </a>
                      </p>
                    )}
                    {s.notes && <p className="text-[10px] text-text-secondary">ملاحظات: {s.notes}</p>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'location' && (
        locationStops.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">لا توجد مواقع تحصيل مسجلة</div>
        ) : (
          <div className="space-y-2">
            {locationStops.map((s, i) => (
              <div key={i} className="bg-white rounded-xl border border-border p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-text">{s.customer_name} — {s.order_number}</p>
                  <span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-medium">قيد الانتظار</span>
                </div>
                <p className="text-[10px] text-text-secondary">
                  المحصل: {s.collector} • {formatDateTime(s.collected_at)}
                </p>
                {s.latitude != null && s.longitude != null && (
                  <p className="text-[10px]">
                    الموقع: {s.latitude.toFixed(6)}, {s.longitude.toFixed(6)}{' '}
                    <a href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`} target="_blank" rel="noreferrer" className="text-primary font-semibold">
                      فتح على الخريطة
                    </a>
                  </p>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'invoices' && (
        filteredInvoices.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">
            {invoices.length === 0 ? 'لا توجد فواتير ائتمان مسجلة' : 'لا توجد نتائج مطابقة للفلاتر'}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredInvoices.map((inv) => {
              const badge = creditStatusMeta[inv.credit_status] ?? creditStatusMeta.uncollected
              const mapsUrl = inv.location_latitude != null && inv.location_longitude != null
                ? `https://www.google.com/maps?q=${inv.location_latitude},${inv.location_longitude}`
                : null
              return (
                <div
                  key={inv.order_id}
                  onClick={() => navigate(`/credit/invoices/${inv.order_id}`)}
                  className="bg-white rounded-xl border border-border p-4 space-y-2 cursor-pointer active:bg-surface"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-bold text-text">{inv.customer_name}</p>
                      <p className="text-xs text-text-secondary mt-0.5">فاتورة {inv.order_number}{inv.reference_number ? ` • مرجع ${inv.reference_number}` : ''}{inv.phone ? ` • ${inv.phone}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {inv.overdue && <span className="text-[10px] px-2 py-0.5 rounded-full font-medium text-red-700 bg-red-50">متأخرة</span>}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div>
                      <p className="text-text-secondary">القيمة</p>
                      <p className="font-bold text-text">{formatCurrency(inv.invoice_amount)}</p>
                    </div>
                    <div>
                      <p className="text-text-secondary">المحصَّل</p>
                      <p className="font-bold text-success">{formatCurrency(inv.collected_amount)}</p>
                    </div>
                    <div>
                      <p className="text-text-secondary">المتبقي</p>
                      <p className={`font-bold ${inv.balance > 0 ? 'text-accent' : 'text-success'}`}>{formatCurrency(inv.balance)}</p>
                    </div>
                  </div>
                  <div className="border-t border-border pt-2 text-[10px] text-text-secondary space-y-0.5">
                    <p>استحقاق: {inv.due_date ?? '—'}</p>
                    <p>شيك: {inv.check_number || '—'} • بنك: {inv.bank_name || '—'} • صاحب الشيك: {inv.check_holder || '—'}</p>
                    {mapsUrl && (
                      <p>
                        <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-primary font-semibold">فتح الموقع على الخريطة</a>
                      </p>
                    )}
                    {inv.notes && <p>ملاحظات: {inv.notes}</p>}
                  </div>
                  <p className="text-xs text-primary font-semibold border-t border-border pt-2">فتح الفاتورة</p>
                </div>
              )
            })}
          </div>
        )
      )}

      {tab === 'summary' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <SummaryCard label="محصَّل اليوم" value={formatCurrency(data.summary.collected_today)} cls="text-success" />
            <SummaryCard label="إجمالي المتبقي" value={formatCurrency(data.summary.outstanding)} cls="text-accent" />
            <SummaryCard label="فواتير متأخرة" value={`${data.summary.overdue_count}`} cls="text-red-600" />
            <SummaryCard label="طلبات معلقة" value={`${data.summary.pending_requests}`} cls="text-amber-600" />
            <SummaryCard label="إجمالي الفواتير" value={`${data.summary.total_invoices}`} cls="text-text" />
            <SummaryCard label="محصلة بالكامل" value={`${data.summary.fully_collected_count}`} cls="text-success" />
          </div>
        </div>
      )}

      {tab === 'history' && (
        data.history.length === 0 ? (
          <div className="text-center py-12 text-text-secondary text-sm">لا يوجد سجل تحصيل بعد</div>
        ) : (
          data.history.map((h) => (
            <div key={h.request_id} className="bg-white rounded-xl border border-border p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-text">{h.customer_name} — {h.order_number}</p>
                <p className="text-xs text-text-secondary mt-0.5">
                  {h.amount ? formatCurrency(h.amount) : ''} • {formatDateTime(h.collected_at)} • المعتمد: {h.collector_name}
                </p>
                <p className="text-[10px] text-text-secondary mt-0.5">
                  قرار: {h.decided_by_name ?? '—'} • {h.decided_at ? formatDateTime(h.decided_at) : ''}
                </p>
                {h.notes && <p className="text-[10px] text-text-secondary mt-0.5">ملاحظات: {h.notes}</p>}
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${h.status === 'approved' ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
                {h.status === 'approved' ? 'معتمد' : 'مرفوض'}
              </span>
            </div>
          ))
        )
      )}
    </div>
  )
}

function SummaryCard({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="bg-white rounded-xl border border-border p-4 text-center">
      <p className={`text-lg font-bold ${cls}`}>{value}</p>
      <p className="text-xs text-text-secondary mt-1">{label}</p>
    </div>
  )
}
