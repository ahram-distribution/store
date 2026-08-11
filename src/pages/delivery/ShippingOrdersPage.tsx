import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../../lib/supabase'
import { MapButton } from '../../components/shared/MapButton'
import { StatusKpiBar } from '../../components/data-list/StatusKpiBar'
import { ResultsSummary } from '../../components/data-list/ResultsSummary'
import { EmptyState } from '../../components/data-list/EmptyState'
import type { KpiChipConfig } from '../../types/data-list'
import { getToken, deliveryStepLabel, stepChipStyles, fmtAmount, fmtTime, hasCoords, isDeliveryCompleted } from './shared'

interface ShippingOrder {
  delivery_id: string
  order_id: string
  order_number: string
  order_status: string
  customer_name: string
  customer_phone: string
  customer_latitude: string | null
  customer_longitude: string | null
  total_amount: string | number
  payment_method: string
  items_count: number
  delivery_status: string
  delivery_step: string | null
  collection_required: boolean | null
  rep_name: string | null
  driver_name: string | null
  assigned_to: string | null
  driver_id: string | null
  assigned_at: string | null
  started_at: string | null
  completed_at: string | null
  returned_at: string | null
  journey_id: string | null
  journey_code: string | null
  journey_status: string | null
  last_action: {
    action: string | null
    employee_name: string | null
    latitude: string | null
    longitude: string | null
    amount: string | number | null
    captured_at: string | null
  } | null
  collection: { id: string; status: string; amount: string | number; collected_at: string | null; approved_at: string | null } | null
}

const FILTERS = [
  { id: '', label: 'الكل' },
  { id: 'need_crew', label: 'بانتظار التعيين' },
  { id: 'in_delivery', label: 'قيد التوصيل' },
  { id: 'in_journey', label: 'داخل رحلة' },
  { id: 'collected', label: 'تم التحصيل' },
  { id: 'returned_to_company', label: 'مكتملة' },
]

const TIME_FILTERS = [
  { id: 'all', label: 'الكل' },
  { id: 'today', label: 'اليوم' },
  { id: 'yesterday', label: 'أمس' },
  { id: 'week', label: 'هذا الأسبوع' },
  { id: 'month', label: 'هذا الشهر' },
  { id: 'custom', label: 'فترة مخصصة' },
] as const

type TimeFilter = (typeof TIME_FILTERS)[number]['id']

const ACTION_LABELS: Record<string, string> = {
  received: 'استلام الشحنة',
  moving_to_customer: 'بدء التحرك من الشركة',
  arrived_at_customer: 'تم الوصول للعميل',
  customer_not_found: 'لم يتم العثور على العميل',
  collected: 'تم التحصيل',
  returned_to_company: 'تم الرجوع لمقر الشركة',
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

const customToRange = (fromDate: string, toDate: string): { from: string; to: string } | null => {
  if (!fromDate || !toDate) return null
  const from = new Date(fromDate + 'T00:00:00')
  const to = new Date(toDate + 'T00:00:00')
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return null
  if (from > to) return null
  to.setDate(to.getDate() + 1)
  return { from: from.toISOString(), to: to.toISOString() }
}

const normalizeText = (s: string) =>
  s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه')

const matchesSearch = (it: ShippingOrder, q: string): boolean => {
  if (!q) return true
  const hay = normalizeText([it.customer_name, it.customer_phone, it.rep_name, it.driver_name, it.order_number].filter(Boolean).join(' '))
  return hay.includes(q)
}

export function ShippingOrdersPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<ShippingOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const q = normalizeText(search.trim())

  const visible = useMemo(() => items.filter((it) => matchesSearch(it, q)), [items, q])

  const range = useMemo(() => {
    if (timeFilter === 'all') return { from: null as string | null, to: null as string | null }
    if (timeFilter === 'custom') return customRange ?? { from: null, to: null }
    const today = startOfDay(new Date())
    if (timeFilter === 'today') return { from: today.toISOString(), to: null }
    if (timeFilter === 'yesterday') {
      const from = new Date(today)
      from.setDate(from.getDate() - 1)
      return { from: from.toISOString(), to: today.toISOString() }
    }
    if (timeFilter === 'week') {
      // الأسبوع يبدأ السبت وينتهي الجمعة
      const from = new Date(today)
      from.setDate(from.getDate() - ((today.getDay() + 1) % 7))
      return { from: from.toISOString(), to: null }
    }
    // month
    const from = new Date(today.getFullYear(), today.getMonth(), 1)
    return { from: from.toISOString(), to: null }
  }, [timeFilter, customRange])

  const load = useCallback(async () => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase.rpc('governed_get_shipping_orders', {
      p_token: token,
      p_filter: filter || null,
      p_from: range.from,
      p_to: range.to,
    })
    if (error) { toast.error(error.message) }
    if (Array.isArray(data)) setItems(data as ShippingOrder[])
    setLoading(false)
  }, [filter, range])

  useEffect(() => { load() }, [load])

  const totalValue = useMemo(() => visible.reduce((s, i) => s + (Number(i.total_amount) || 0), 0), [visible])

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': visible.length, need_crew: 0, in_delivery: 0, in_journey: 0, collected: 0, returned_to_company: 0 }
    for (const i of visible) {
      if (i.journey_id) c.in_journey += 1
      if (!i.delivery_step && !i.assigned_to && !i.driver_id && !i.journey_id) c.need_crew += 1
      if (i.delivery_step === 'received' || i.delivery_step === 'moving_to_customer' || i.delivery_step === 'arrived_at_customer' || i.delivery_step === 'customer_not_found') c.in_delivery += 1
      if (i.delivery_step === 'collected') c.collected += 1
      if (i.delivery_step === 'returned_to_company') c.returned_to_company += 1
    }
    return c
  }, [items])

  const kpiChips: KpiChipConfig[] = useMemo(() => {
    return FILTERS
      .filter((f) => f.id === '' || counts[f.id] > 0)
      .map((f) => {
        const styles = stepChipStyles(f.id === 'need_crew' ? null : f.id === 'in_delivery' ? 'moving_to_customer' : f.id === 'in_journey' ? 'received' : f.id === 'collected' ? 'collected' : f.id === 'returned_to_company' ? 'returned_to_company' : 'received')
        return {
          id: f.id,
          label: f.label,
          count: f.id === '' ? visible.length : counts[f.id],
          dotClass: styles.dot,
          chipClass: styles.chip,
          activeChipClass: styles.active,
        }
      })
  }, [visible, counts])

  const lastActionLocation = (it: ShippingOrder): { lat: number; lng: number } | null => {
    if (it.last_action && hasCoords(it.last_action.latitude, it.last_action.longitude)) {
      return { lat: Number(it.last_action.latitude), lng: Number(it.last_action.longitude) }
    }
    if (hasCoords(it.customer_latitude, it.customer_longitude)) {
      return { lat: Number(it.customer_latitude), lng: Number(it.customer_longitude) }
    }
    return null
  }

  const canSelect = (it: ShippingOrder) =>
    it.order_status === 'dispatched' && !it.journey_id && !isDeliveryCompleted(it.delivery_step)

  const toggleSelect = (orderId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  const goCreateJourney = () => {
    if (selectedIds.size === 0) { toast.error('اختر طلباً واحداً على الأقل'); return }
    navigate('/shipping/journeys/new', { state: { preselectedOrderIds: [...selectedIds] } })
  }

  const cancelSelect = () => { setSelectMode(false); setSelectedIds(new Set()) }

  const renderCard = (it: ShippingOrder, completed: boolean) => {
    const loc = lastActionLocation(it)
    const selectable = canSelect(it)
    const isSelected = selectedIds.has(it.order_id)
    return (
      <div key={it.delivery_id} className="relative">
        {selectMode && selectable && (
          <span className={`absolute top-2 left-2 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-bold text-white ${isSelected ? 'border-primary bg-primary' : 'border-gray-300 bg-white'}`}>
            {isSelected ? '✓' : ''}
          </span>
        )}
        <button
          onClick={() => {
            if (selectMode) { if (selectable) toggleSelect(it.order_id); return }
            if (it.journey_id) navigate(`/shipping/journeys/${it.journey_id}`)
            else navigate(`/shipping/${it.delivery_id}`)
          }}
          className={`w-full text-right rounded-xl border p-2 transition-shadow hover:shadow-sm ${
            isSelected
              ? 'border-primary bg-blue-50/40'
              : `bg-white ${completed ? 'border-gray-200' : 'border-border'}`
          }`}
        >
        <div className="flex items-center justify-between gap-1 mb-1.5">
          <span className={`text-[11px] font-bold truncate ${completed ? 'text-gray-500' : 'text-text'}`}>📦 {it.customer_name}</span>
          <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded-full ${completed ? 'bg-gray-100 text-gray-600' : 'bg-blue-50 text-blue-700'}`}>
            {completed ? '✓ مكتملة' : deliveryStepLabel(it.delivery_step)}
          </span>
        </div>
        <div className="text-[10px] text-text-secondary space-y-0.5">
          <p><span className="font-semibold text-text">{it.order_number}</span> - {fmtAmount(it.total_amount)}</p>
          <p className="flex items-center gap-1 flex-wrap">
            {it.collection_required === false
              ? <span className="text-emerald-600">✓ بدون تحصيل</span>
              : <span className="text-amber-600">💰 مطلوب</span>}
            {it.journey_id && <span className="text-primary font-semibold">🚚 في رحلة {it.journey_code || ''}</span>}
            {!it.delivery_step && !it.assigned_to && !it.driver_id && !it.journey_id && <span className="text-gray-500">بانتظار التعيين</span>}
            {it.driver_name && <span>🚚 {it.driver_name}</span>}
            {it.rep_name && <span>👤 {it.rep_name}</span>}
          </p>
          {it.last_action?.action && (
            <p>
              آخر حركة: {ACTION_LABELS[it.last_action.action] || it.last_action.action}
              {it.last_action.captured_at ? ` - ${fmtTime(it.last_action.captured_at)}` : ''}
            </p>
          )}
          {it.collection && it.delivery_step === 'collected' && (
            <p className={it.collection.status === 'approved' ? 'text-emerald-600' : 'text-amber-600'}>
              💰 {fmtAmount(it.collection.amount)} - {it.collection.status === 'approved' ? 'معتمد' : 'قيد الاعتماد'}
            </p>
          )}
          {it.returned_at && <p>🏢 {fmtTime(it.returned_at)}</p>}
        </div>
        {loc && (
          <div className="mt-1 flex flex-col items-end gap-1" onClick={(e) => e.stopPropagation()}>
            <MapButton latitude={loc.lat} longitude={loc.lng} size="sm" showCopyLink={false} />
          </div>
        )}
      </button>
      </div>
    )
  }

  const applyCustom = () => {
    const r = customToRange(fromDate, toDate)
    if (!r) { toast.error('اختر تاريخ البداية والنهاية') ; return }
    setCustomRange(r)
  }

  const current = visible.filter((it) => !isDeliveryCompleted(it.delivery_step))
  const completed = visible.filter((it) => isDeliveryCompleted(it.delivery_step))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">شحن الطلبات</h1>
      </div>

      {/* إجراءات الرحلات */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate('/shipping/journeys')}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-white px-3 py-2.5 text-sm font-semibold text-text"
        >
          🚚 رحلات التوصيل
        </button>
        <button
          onClick={selectMode ? goCreateJourney : () => setSelectMode(true)}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2.5 text-sm font-semibold text-white"
        >
          {selectMode ? `إنشاء رحلة توصيل (${selectedIds.size})` : '✨ إنشاء رحلة توصيل'}
        </button>
        {selectMode && (
          <button
            onClick={cancelSelect}
            className="shrink-0 rounded-xl border border-border bg-white px-3 py-2.5 text-sm font-semibold text-text-secondary"
          >
            إلغاء
          </button>
        )}
      </div>

      {selectMode && (
        <div className="rounded-xl border border-primary/30 bg-blue-50/50 px-3 py-2 text-xs font-semibold text-primary">
          حدد طلباً واحداً أو أكثر من الطلبات المشحونة، ثم اضغط «إنشاء رحلة توصيل».
        </div>
      )}

      {/* البحث */}
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="🔍 بحث: اسم العميل، الهاتف، المندوب، السائق، أو رقم الطلب"
        className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-white text-text placeholder:text-text-secondary/60"
      />

      {/* الفلتر الزمني */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {TIME_FILTERS.map((tf) => (
          <button
            key={tf.id}
            onClick={() => setTimeFilter(tf.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors ${
              timeFilter === tf.id ? 'bg-primary text-white border-primary' : 'bg-white text-text-secondary border-border'
            }`}
          >
            {tf.label}
          </button>
        ))}
      </div>

      {timeFilter === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white text-text"
          />
          <span className="text-xs text-text-secondary">إلى</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white text-text"
          />
          <button onClick={applyCustom} className="shrink-0 bg-primary text-white rounded-lg px-3 py-1.5 text-xs font-semibold">
            تطبيق
          </button>
        </div>
      )}

      {/* فلاتر حالات الطلبات */}
      {!loading && kpiChips.length > 0 && (
        <StatusKpiBar chips={kpiChips} selectedId={filter} onToggle={(id) => setFilter(id === filter ? '' : id)} />
      )}

      <ResultsSummary
        total={visible.length}
        totalValue={totalValue}
        filters={[]}
        onRefresh={load}
        refreshState={loading ? 'loading' : 'idle'}
        title="عدد الطلبات المشحونة"
        unit="طلب"
        valueLabel="إجمالي القيمة"
      />

      {!loading && visible.length === 0 ? (
        <EmptyState message="لا توجد نتائج مطابقة للبحث" />
      ) : (
        <div className="space-y-2">
          {current.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {current.map((it) => renderCard(it, false))}
            </div>
          )}
          {completed.length > 0 && (
            <>
              <div className="flex items-center gap-2 pt-3 pb-1">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs font-semibold text-text-secondary">المهام المكتملة ({completed.length})</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                {completed.map((it) => renderCard(it, true))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
