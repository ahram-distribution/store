import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort } from '../../utils/format'
import { formatNumber } from '../../utils/numbers'
import SmartFilterBar, { type FilterValues } from '../../components/SmartFilterBar'
import { resolveDateRangeISO } from '../../lib/dateRange'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import { OrderOwnershipInfo } from '../../components/orders/OrderOwnershipInfo'
import { ORDER_STATUS_LABELS } from '../../types/order-display'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => formatNumber(n)

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  submitted: 'bg-blue-100 text-blue-800',
  sales_manager_approved: 'bg-blue-100 text-blue-800',
  reviewing: 'bg-blue-100 text-blue-800',
  returned_for_revision: 'bg-purple-100 text-purple-800',
  approved: 'bg-green-100 text-green-800',
  preparing: 'bg-green-100 text-green-800',
  prepared: 'bg-green-100 text-green-800',
  ready_for_dispatch: 'bg-green-100 text-green-800',
  sent_to_delivery: 'bg-green-100 text-green-800',
  dispatched: 'bg-green-100 text-green-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  deferred: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-800',
  stock_review: 'bg-blue-100 text-blue-800',
}

export default function SalesManagerOrdersList() {
  const nav = useNavigate()
  const [orders, setOrders] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])
  const [viewState, setViewState, resetViewState] = usePersistentViewState('sales-orders', {
    filters: { datePreset: 'month', dateFrom: '', dateTo: '', search: '', employeeId: '' } as FilterValues,
  })
  const { filters } = viewState
  const [sfResetKey, setSfResetKey] = useState(0)

  const resolveDateRange = (f: FilterValues): { from: string | null; to: string | null } => {
    if (f.datePreset === 'all') return { from: null, to: null }
    if (f.datePreset === 'custom') return resolveDateRangeISO('custom', f.dateFrom || undefined, f.dateTo || undefined)
    return resolveDateRangeISO(f.datePreset as any)
  }

  const fetchData = useCallback(async () => {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const range = resolveDateRange(filters)
    const { data } = await supabase.rpc('get_governed_orders', {
      p_token: token.trim(),
      p_search: filters.search || null,
      p_employee_id: filters.employeeId || null,
      p_date_from: range.from,
      p_date_to: range.to,
    })
    if (data) setOrders(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [filters])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    const token = getToken()
    if (!token) return
    supabase.rpc('get_sales_manager_cc', { p_token: token.trim() }).then(({ data: d }: any) => {
      if (d?.team_performance?.members) {
        setEmployees(d.team_performance.members.map((m: any) => ({ id: m.employee_id, name: m.employee_name })))
      }
    })
  }, [])

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 bg-white border-b border-border pb-2 pt-2">
        <div className="flex items-center gap-2">
          <button onClick={() => nav('/sales-manager/operations')} className="text-xs text-primary font-semibold">→ رجوع</button>
          <h1 className="text-lg font-bold text-text">الطلبات</h1>
        </div>
      </div>

      <SmartFilterBar key={sfResetKey} initialFilters={filters}
        searchPlaceholder="بحث برقم الطلب أو اسم العميل..."
        employees={employees}
        onFilterChange={(f) => setViewState({ filters: f })}
      />
      <button onClick={() => { resetViewState(); setSfResetKey(k => k + 1) }} className="text-[10px] px-2 py-1 text-danger font-semibold">إعادة تعيين</button>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد طلبات</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {orders.map((o: any) => (
            <button key={o.id} onClick={() => nav(`/orders/${o.id}`)}
              className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors hover:shadow-sm text-right">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-text">{o.order_number}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${STATUS_COLORS[o.status] || 'bg-gray-100 text-text-secondary'}`}>
                  {ORDER_STATUS_LABELS[o.status] || o.status}
                </span>
              </div>
              <p className="text-sm font-bold text-text mb-1">{o.customer_name}</p>
              <OrderOwnershipInfo
                creatorName={o.created_by_name}
                creatorId={o.created_by_id}
                ownerId={o.owner_id}
                currentOwnerName={o.owner_name}
                label="المنشئ:"
                compact
              />
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-primary">{formatCurrencyShort(o.total_amount)}</span>
                <span className="text-text-secondary">{o.item_count ?? 0} صنف</span>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="text-center text-[10px] text-text-secondary pb-4">
        إجمالي: {fmt(orders.length)} طلب
      </div>
    </div>
  )
}
