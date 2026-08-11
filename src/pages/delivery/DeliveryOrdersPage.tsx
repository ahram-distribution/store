import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { StatusKpiBar } from '../../components/data-list/StatusKpiBar'
import { ResultsSummary } from '../../components/data-list/ResultsSummary'
import { EmptyState } from '../../components/data-list/EmptyState'
import type { KpiChipConfig } from '../../types/data-list'
import {
  getToken, journeyStatusLabel, isJourneyReturned, fmtAmount, fmtTime,
} from './shared'
import type { DeliveryJourneyItem } from './shared'

const FILTERS = [
  { id: '', label: 'الكل' },
  { id: 'active', label: 'جارية' },
  { id: 'returned', label: 'مكتملة' },
]

export function DeliveryOrdersPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<DeliveryJourneyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    setLoading(true)
    const { data } = await supabase.rpc('governed_get_my_journeys', { p_token: token })
    if (Array.isArray(data)) setItems(data as DeliveryJourneyItem[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (!filter) return items
    if (filter === 'active') return items.filter((j) => !isJourneyReturned(j.status))
    return items.filter((j) => isJourneyReturned(j.status))
  }, [items, filter])

  const counts = useMemo(() => {
    const c: Record<string, number> = { '': items.length, active: 0, returned: 0 }
    for (const j of items) {
      if (isJourneyReturned(j.status)) c.returned += 1
      else c.active += 1
    }
    return c
  }, [items])

  const kpiChips: KpiChipConfig[] = useMemo(() => {
    return FILTERS
      .filter((f) => f.id === '' || counts[f.id] > 0)
      .map((f) => ({
        id: f.id,
        label: f.label,
        count: f.id === '' ? items.length : counts[f.id],
        dotClass: f.id === '' ? 'bg-primary' : f.id === 'returned' ? 'bg-gray-400' : 'bg-blue-400',
        chipClass: 'bg-white border-border text-text-secondary',
        activeChipClass: 'bg-primary border-primary text-white',
      }))
  }, [items, counts])

  const activeCount = useMemo(() => filtered.filter((j) => !isJourneyReturned(j.status)).length, [filtered])
  const completedCount = useMemo(() => filtered.filter((j) => isJourneyReturned(j.status)).length, [filtered])

  const renderCard = (it: DeliveryJourneyItem) => {
    const returned = isJourneyReturned(it.status)
    const orders = it.orders || []
    const firstCustomer = orders[0]?.customer_name
    const title = it.journey_code || (it.is_virtual && firstCustomer ? `توصيل ${firstCustomer}` : 'رحلة')
    return (
      <button
        key={it.journey_id}
        onClick={() => navigate(`/my-deliveries/tasks/${it.journey_id}`)}
        className={`w-full text-right bg-white rounded-xl border p-4 hover:shadow-sm transition-shadow ${returned ? 'border-gray-200' : 'border-border'}`}
      >
        <div className="flex items-center justify-between mb-2 gap-2">
          <span className={`text-sm font-bold ${returned ? 'text-gray-500' : 'text-text'}`}>
            {it.is_virtual ? '📦' : '🚚'} {title}
          </span>
          <span className={`text-xs px-2 py-1 rounded-full whitespace-nowrap ${returned ? 'bg-gray-100 text-gray-600' : it.status === 'in_progress' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
            {journeyStatusLabel(it.status)}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center mb-2">
          <div className="rounded-lg bg-surface/50 p-2">
            <p className="text-base font-bold text-text">{it.totals?.orders_count ?? orders.length}</p>
            <p className="text-[10px] text-text-secondary">الطلبات</p>
          </div>
          <div className="rounded-lg bg-surface/50 p-2">
            <p className="text-base font-bold text-text">{fmtAmount(it.totals?.total_value)}</p>
            <p className="text-[10px] text-text-secondary">القيمة</p>
          </div>
          <div className="rounded-lg bg-surface/50 p-2">
            <p className="text-base font-bold text-text">{fmtAmount(it.totals?.total_collected)}</p>
            <p className="text-[10px] text-text-secondary">التحصيل</p>
          </div>
        </div>

        <div className="text-xs text-text-secondary space-y-1">
          <p className="flex items-center gap-1.5 flex-wrap">
            <span>🚚 {it.rep_name || 'غير مُسند'}</span>
            <span>·</span>
            <span>👤 {it.driver_name || 'غير مُسند'}</span>
          </p>
          {it.started_at && <p>البدء: {fmtTime(it.started_at)}</p>}
          {it.returned_at && <p>الرجوع: {fmtTime(it.returned_at)}</p>}
        </div>

        <span className="mt-3 inline-block w-full text-center bg-surface text-primary rounded-xl p-2.5 text-sm font-semibold">
          فتح الرحلة
        </span>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/my-deliveries')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">مهماتي</h1>
      </div>

      {!loading && kpiChips.length > 0 && (
        <StatusKpiBar chips={kpiChips} selectedId={filter} onToggle={(id) => setFilter(id === filter ? '' : id)} />
      )}

      <ResultsSummary
        total={filtered.length}
        totalValue={0}
        filters={[]}
        onRefresh={load}
        refreshState={loading ? 'loading' : 'idle'}
        title="عدد الرحلات"
        unit="رحلة"
        valueLabel="إجمالي التحصيل"
      />

      {!loading && filtered.length === 0 ? (
        <EmptyState message="لا توجد رحلات حالية لك" />
      ) : (
        <div className="space-y-2">
          {filtered.map((it) => renderCard(it))}
        </div>
      )}
    </div>
  )
}
