import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import SmartFilterBar, { type FilterValues } from '../../components/SmartFilterBar'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => Number.isFinite(n) ? Math.round(n).toLocaleString('ar-EG-u-nu-latn') : '0'

export default function SalesManagerCustomersList() {
  const nav = useNavigate()
  const [customers, setCustomers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])
  const [filters, setFilters] = useState<FilterValues>({
    datePreset: 'all', dateFrom: '', dateTo: '', search: '', employeeId: ''
  })

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

  const fetchData = useCallback(async () => {
    const token = getToken()
    if (!token) return
    setLoading(true)
    const range = resolveDateRange(filters)
    const { data } = await supabase.rpc('get_governed_customers', {
      p_token: token.trim(),
      p_search: filters.search || null,
      p_employee_id: filters.employeeId || null,
      p_date_from: range.from,
      p_date_to: range.to,
    })
    if (data) setCustomers(Array.isArray(data) ? data : [])
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
          <h1 className="text-lg font-bold text-text">العملاء</h1>
        </div>
      </div>

      <SmartFilterBar
        searchPlaceholder="بحث باسم العميل أو الكود..."
        employees={employees}
        onFilterChange={setFilters}
      />

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : customers.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا يوجد عملاء</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {customers.map((c: any) => (
            <button key={c.id} onClick={() => nav(`/customers/${c.id}`)}
              className="bg-white rounded-xl border border-border p-4 text-right active:bg-surface transition-colors hover:shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-bold text-text">{c.company_name}</p>
                <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded">{c.code}</span>
              </div>
              {c.responsible_name && (
                <p className="text-[11px] text-text-secondary mb-1">المسؤول: {c.responsible_name}</p>
              )}
              <div className="flex items-center gap-2 text-[10px] text-text-secondary">
                <span>{c.owner_name || 'بدون مالك'}</span>
                {c.business_type && <span>| {c.business_type}</span>}
              </div>
              {c.phone && <p className="text-[11px] text-text-secondary mt-1" dir="ltr">{c.phone}</p>}
            </button>
          ))}
        </div>
      )}

      <div className="text-center text-[10px] text-text-secondary pb-4">
        إجمالي: {fmt(customers.length)} عميل
      </div>
    </div>
  )
}
