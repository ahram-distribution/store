import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { useCapability } from '../../hooks/useCapability'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import SmartFilterBar, { type FilterValues } from '../../components/SmartFilterBar'
import { CustomerCard } from '../../components/customers/CustomerCard'
import type { CustomerCardData } from '../../types/customers'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function CustomersPage() {
  const navigate = useNavigate()
  const canCreate = useCapability('customers.create')
  const currentEmpId = useAuthStore((s) => s.user?.employee_id)
  const [customers, setCustomers] = useState<CustomerCardData[]>([])
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [viewState, setViewState, resetViewState] = usePersistentViewState('customers-list', {
    myOnly: false,
    filters: { datePreset: 'all', dateFrom: '', dateTo: '', search: '', employeeId: '' } as FilterValues,
    quickFilters: { noOrders: false, noVisits: false, noLocation: false },
  })
  const { myOnly, filters, quickFilters } = viewState
  const [sfResetKey, setSfResetKey] = useState(0)

  const resolveDateRange = (f: FilterValues): { from: string | null; to: string | null } => {
    if (f.datePreset === 'all') return { from: null, to: null }
    const now = new Date()
    const startOfDay = (d: Date) => { d.setHours(0, 0, 0, 0); return d.toISOString() }
    const endOfDay = (d: Date) => { d.setHours(23, 59, 59, 999); return d.toISOString() }
    switch (f.datePreset) {
      case 'today': return { from: startOfDay(new Date()), to: endOfDay(new Date()) }
      case 'yesterday': {
        const y = new Date(); y.setDate(y.getDate() - 1)
        return { from: startOfDay(y), to: endOfDay(y) }
      }
      case 'week': {
        const wk = new Date(); wk.setDate(wk.getDate() - wk.getDay())
        return { from: startOfDay(wk), to: endOfDay(new Date()) }
      }
      case 'month': return { from: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: endOfDay(new Date()) }
      case 'prev_month': {
        const pm = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        const pe = new Date(now.getFullYear(), now.getMonth(), 0)
        return { from: startOfDay(pm), to: endOfDay(pe) }
      }
      case 'custom': return { from: f.dateFrom ? startOfDay(new Date(f.dateFrom)) : null, to: f.dateTo ? endOfDay(new Date(f.dateTo)) : null }
      default: return { from: null, to: null }
    }
  }

  const fetchData = async () => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    setLoading(true)
    const range = resolveDateRange(filters)
    const params: any = {
      p_token: token.trim(),
      p_search: filters.search || null,
      p_employee_id: filters.employeeId || null,
      p_date_from: range.from,
      p_date_to: range.to,
      p_no_orders: quickFilters.noOrders || null,
      p_no_visits: quickFilters.noVisits || null,
      p_no_location: quickFilters.noLocation || null,
    }
    if (myOnly && currentEmpId) {
      params.p_employee_id = currentEmpId
    }

    const [custRes, empRes] = await Promise.all([
      supabase.rpc('get_governed_customers', params),
      supabase.rpc('get_governed_employees', { p_token: token }),
    ])
    if (empRes.data) {
      const list = Array.isArray(empRes.data) ? empRes.data : []
      setEmployees(list.map((e: any) => ({ id: e.id, name: e.full_name })))
    }
    if (custRes.data) {
      setCustomers(Array.isArray(custRes.data) ? custRes.data : [])
    }
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [filters, myOnly, quickFilters])

  const toggleQuickFilter = (key: keyof typeof quickFilters) => {
    setViewState((prev: typeof viewState) => ({ quickFilters: { ...prev.quickFilters, [key]: !prev.quickFilters[key] } }))
  }

  const hasActiveQuickFilter = quickFilters.noOrders || quickFilters.noVisits || quickFilters.noLocation

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">العملاء</h1>
        {canCreate && (
          <button onClick={() => navigate('/customers/new')} className="mr-auto bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">+ إضافة عميل</button>
        )}
      </div>

      {currentEmpId && (
        <div className="flex gap-1 bg-white rounded-lg border border-border p-1">
          <button onClick={() => setViewState({ myOnly: false })} className={`flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ${!myOnly ? 'bg-primary text-white' : 'text-text-secondary'}`}>الكل</button>
          <button onClick={() => setViewState({ myOnly: true })} className={`flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ${myOnly ? 'bg-primary text-white' : 'text-text-secondary'}`}>عملائي</button>
          <button onClick={() => { resetViewState(); setSfResetKey(k => k + 1) }} className="text-[10px] px-2 py-1 mr-auto text-danger font-semibold">إعادة تعيين</button>
        </div>
      )}

      <SmartFilterBar
        key={sfResetKey}
        searchPlaceholder="بحث باسم العميل أو الكود..."
        employees={employees}
        employeeLabel="المسؤول عن العميل"
        initialFilters={filters}
        onFilterChange={(f) => setViewState({ filters: f })}
      />

      {/* Stats bar */}
      {!loading && customers.length > 0 && (
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] bg-white rounded-lg border border-border p-2.5">
          <span className="text-text font-semibold whitespace-nowrap">👥 <span className="text-text-muted font-medium">المعروض:</span> {customers.length} عميل</span>
          <span className="text-border">|</span>
          <span className="text-text font-semibold" dir="ltr">{customers.filter(c => (c.previous_order_count ?? 0) > 0).length}</span>
          <span className="text-text-muted whitespace-nowrap">📦 لديهم طلبات</span>
          <span className="text-border">|</span>
          <span className="text-text font-semibold" dir="ltr">{customers.filter(c => !c.previous_order_count || c.previous_order_count === 0).length}</span>
          <span className="text-text-muted whitespace-nowrap">🚫 بدون طلبات</span>
          <span className="text-border">|</span>
          <span className="text-text font-semibold" dir="ltr">{customers.filter(c => !c.location_id).length}</span>
          <span className="text-text-muted whitespace-nowrap">📍 بدون لوكيشن</span>
          <span className="text-border">|</span>
          <span className="text-text font-semibold" dir="ltr">{customers.filter(c => !c.visit_count || c.visit_count === 0).length}</span>
          <span className="text-text-muted whitespace-nowrap">🚗 بدون زيارات</span>
        </div>
      )}

      {/* Quick filters */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => toggleQuickFilter('noOrders')}
          className={`text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors border ${
            quickFilters.noOrders
              ? 'bg-orange-100 text-orange-700 border-orange-200'
              : 'bg-white text-text-secondary border-border'
          }`}
        >
          {quickFilters.noOrders ? '✓' : '□'} بدون طلبات
        </button>
        <button
          onClick={() => toggleQuickFilter('noVisits')}
          className={`text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors border ${
            quickFilters.noVisits
              ? 'bg-blue-100 text-blue-700 border-blue-200'
              : 'bg-white text-text-secondary border-border'
          }`}
        >
          {quickFilters.noVisits ? '✓' : '□'} بدون زيارات
        </button>
        <button
          onClick={() => toggleQuickFilter('noLocation')}
          className={`text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors border ${
            quickFilters.noLocation
              ? 'bg-purple-100 text-purple-700 border-purple-200'
              : 'bg-white text-text-secondary border-border'
          }`}
        >
          {quickFilters.noLocation ? '✓' : '□'} بدون رابط لوكيشن
        </button>
        {hasActiveQuickFilter && (
          <button
            onClick={() => setViewState({ quickFilters: { noOrders: false, noVisits: false, noLocation: false } })}
            className="text-[10px] px-2.5 py-1 rounded-lg font-semibold bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 transition-colors"
          >
            إلغاء الكل
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : customers.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">
          {myOnly ? 'لا يوجد عملاء تابعين لك' : 'لا يوجد عملاء'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {customers.map((c) => (
            <CustomerCard key={c.id} customer={c} />
          ))}
        </div>
      )}
    </div>
  )
}
