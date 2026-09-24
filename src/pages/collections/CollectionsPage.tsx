import { useState, useEffect, useMemo, useCallback } from 'react'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, formatDate } from '../../utils/format'
import { useCapability } from '../../hooks/useCapability'
import { RemoteSearchableSelect } from '../../components/shared/RemoteSearchableSelect'
import type { CollectionMethod } from '../../types/storefront'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const methodLabels: Record<CollectionMethod, string> = {
  cash: 'نقداً', bank_transfer: 'تحويل بنكي', cheque: 'شيك', deposit: 'إيداع',
}

const methodColors: Record<CollectionMethod, string> = {
  cash: 'text-success bg-success/10', bank_transfer: 'text-primary bg-primary/10',
  cheque: 'text-accent bg-accent/10', deposit: 'text-warning bg-warning/10',
}

const statusLabels: Record<string, string> = {
  pending: 'معلق', approved: 'معتمد', treasury_posted: 'مرحل للخزينة',
}

const filterLabels: Record<string, string> = {
  today: 'تحصيلات اليوم', pending: 'تحصيلات معلقة',
}

export function CollectionsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const filter = searchParams.get('filter')
  const canApprove = useCapability('collections.approve')
  const [collections, setCollections] = useState<any[]>([])
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [viewState, setViewState, resetViewState] = usePersistentViewState('collections-list', {
    searchQuery: '',
    methodFilter: '',
    statusFilter: '',
    customerFilter: '',
    dateFrom: '',
    dateTo: '',
  })
  const { searchQuery, methodFilter, statusFilter, customerFilter, dateFrom, dateTo } = viewState

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    supabase.rpc('get_governed_collections', { p_token: token }).then((colRes) => {
      let result = (colRes.data as any[]) || []
      if (filter === 'pending') result = result.filter((c: any) => c.status === 'pending')
      else if (filter === 'today') {
        result = result.filter((c: any) => {
          const d = new Date(c.created_at); const n = new Date()
          return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
        })
      }
      setCollections(result)
      setLoading(false)
    })
  }, [filter])

  // Lazily resolve customer names for loaded rows via the single-customer RPC
  // (avoids the full governed-customers payload).
  useEffect(() => {
    const token = getToken()
    if (!token) return
    if (collections.length === 0) return
    const ids = Array.from(new Set((collections as any[]).map((c: any) => c.customer_id).filter(Boolean)))
    const missing = ids.filter((id) => !customerNames[id]).slice(0, 100)
    if (missing.length === 0) return
    let cancelled = false
    missing.forEach((id) => {
      supabase.rpc('get_governed_customer', { p_token: token.trim(), p_id: id }).then(({ data }) => {
        if (cancelled) return
        const c = data as any
        if (c && typeof c === 'object' && c.company_name) {
          setCustomerNames((prev) => (prev[id] ? prev : { ...prev, [id]: c.company_name }))
        }
      })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collections])

  const filtered = useMemo(() => {
    let list = collections
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter((c: any) =>
        (c.customer_name || customerNames[c.customer_id] || '').toLowerCase().includes(q) ||
        (c.code || '').toLowerCase().includes(q) ||
        (c.reference_number || '').toLowerCase().includes(q)
      )
    }
    if (methodFilter) list = list.filter((c: any) => c.method === methodFilter)
    if (statusFilter) list = list.filter((c: any) => c.status === statusFilter)
    if (customerFilter) list = list.filter((c: any) => c.customer_id === customerFilter)
    if (dateFrom) list = list.filter((c: any) => c.created_at >= dateFrom)
    if (dateTo) list = list.filter((c: any) => c.created_at <= dateTo + 'T23:59:59')
    return list
  }, [collections, searchQuery, methodFilter, statusFilter, customerFilter, dateFrom, dateTo, customerNames])

  const loadCustomerOptions = useCallback(async (q: string) => {
    const token = getToken()
    if (!token) return []
    const { data } = await supabase.rpc('get_governed_customers', {
      p_token: token.trim(),
      p_search: q.trim() || null,
      p_page: 1,
      p_per_page: 20,
      p_count_only: false,
      p_stats: false,
    })
    if (!Array.isArray(data)) return []
    return data.map((c: any) => ({ id: c.id, name: c.company_name || '' }))
  }, [])

  const resolveCustomerLabel = useCallback(async (id: string) => {
    const token = getToken()
    if (!token) return id
    const { data } = await supabase.rpc('get_governed_customer', { p_token: token.trim(), p_id: id })
    const c = data as any
    if (c && typeof c === 'object' && c.company_name) return c.company_name
    return id
  }, [])

  async function handleApprove(id: string) {
    const token = getToken()
    const { data, error } = await supabase.rpc('governed_approve_collection', { p_token: token, p_id: id })
    if (error) { toast.error(error.message); return }
    const result = data as any
    if (result.error) { toast.error(result.error); return }
    toast.success('تم اعتماد التحصيل')
    const colRes = await supabase.rpc('get_governed_collections', { p_token: token })
    if (colRes.data) setCollections(colRes.data as any[])
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {filter && <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>}
          <h1 className="text-lg font-bold text-text">
            {filter && filterLabels[filter] ? filterLabels[filter] : 'التحصيلات'}
          </h1>
        </div>
        {!filter && <button onClick={() => navigate('/collections/new')} className="bg-primary text-white text-xs px-3 py-2 rounded-lg">+ تحصيل جديد</button>}
      </div>

      <input type="text" value={searchQuery} onChange={(e) => setViewState({ searchQuery: e.target.value })}
        placeholder="بحث برقم التحصيل أو اسم العميل..." className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />

      <div className="grid grid-cols-2 gap-2">
        <select value={methodFilter} onChange={(e) => setViewState({ methodFilter: e.target.value })}
          className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          <option value="">كل وسائل الدفع</option>
          <option value="cash">نقداً</option>
          <option value="bank_transfer">تحويل بنكي</option>
          <option value="cheque">شيك</option>
          <option value="deposit">إيداع</option>
        </select>
        <select value={statusFilter} onChange={(e) => setViewState({ statusFilter: e.target.value })}
          className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          <option value="">كل الحالات</option>
          <option value="pending">معلق</option>
          <option value="approved">معتمد</option>
          <option value="treasury_posted">مرحل للخزينة</option>
        </select>
        <div className="col-span-2">
          <RemoteSearchableSelect
            value={customerFilter}
            onChange={(id) => setViewState({ customerFilter: id || '' })}
            loadOptions={loadCustomerOptions}
            resolveLabel={resolveCustomerLabel}
            placeholder="كل العملاء"
            className="w-full"
          />
        </div>
        <div className="flex gap-1">
          <input type="date" value={dateFrom} onChange={(e) => setViewState({ dateFrom: e.target.value })}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          <input type="date" value={dateTo} onChange={(e) => setViewState({ dateTo: e.target.value })}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد تحصيلات</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((col: any) => {
            const cusName = col.customer_name || customerNames[col.customer_id] || ''
            return (
              <div key={col.id} className="bg-white rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-text">{cusName}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded ${methodColors[col.method as CollectionMethod] || 'bg-surface text-text-secondary'}`}>
                    {methodLabels[col.method as CollectionMethod] || col.method}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-text-secondary">
                  <span>
                    {formatDate(col.collected_at ?? col.created_at)}
                    <span className={`mr-2 px-1.5 py-0.5 rounded ${col.status === 'approved' ? 'bg-success/10 text-success' : col.status === 'pending' ? 'bg-accent/10 text-accent' : 'bg-surface text-text-secondary'}`}>
                      {statusLabels[col.status] || col.status}
                    </span>
                  </span>
                  {col.reference_number && <span>{col.reference_number}</span>}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-sm font-bold text-success">{formatCurrencyShort(col.amount)}</span>
                  {canApprove && col.status === 'pending' && (
                    <button onClick={() => handleApprove(col.id)}
                      className="text-[10px] bg-success/10 text-success px-2 py-1 rounded">اعتماد</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
