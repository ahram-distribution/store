import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { useCapability } from '../../hooks/useCapability'
import { locationService } from '../../services/location'
import { LocationDisplay } from '../../components/shared/LocationDisplay'
import SmartFilterBar, { type FilterValues } from '../../components/SmartFilterBar'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export function CustomersPage() {
  const navigate = useNavigate()
  const canCreate = useCapability('customers.create')
  const currentEmpId = useAuthStore((s) => s.user?.employee_id)
  const [customers, setCustomers] = useState<any[]>([])
  const [contacts, setContacts] = useState<any[]>([])
  const [locations, setLocations] = useState<Map<string, any>>(new Map())
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [myOnly, setMyOnly] = useState(false)
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
    }
    if (myOnly && currentEmpId) {
      params.p_employee_id = currentEmpId
    }

    const [custRes, contRes, empRes] = await Promise.all([
      supabase.rpc('get_governed_customers', params),
      supabase.rpc('get_governed_customer_contacts', { p_token: token }),
      supabase.rpc('get_governed_employees', { p_token: token }),
    ])
    if (empRes.data) {
      const list = Array.isArray(empRes.data) ? empRes.data : []
      setEmployees(list.map((e: any) => ({ id: e.identity_id || e.id, name: e.full_name })))
    }
    if (custRes.data) {
      const list = Array.isArray(custRes.data) ? custRes.data : []
      setCustomers(list)
      const locIds = list.map((c: any) => c.location_id).filter(Boolean)
      if (locIds.length > 0) {
        const locMap = await locationService.fetchLocations(locIds)
        setLocations(locMap)
      }
    }
    if (contRes.data) setContacts(Array.isArray(contRes.data) ? contRes.data : [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [filters, myOnly])

  const contactMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of contacts) {
      if (!m.has(c.customer_id) || c.is_primary) m.set(c.customer_id, c.phone || '')
    }
    return m
  }, [contacts])

  const enriched = useMemo(() => {
    return customers.map((c: any) => ({
      ...c,
      phone: contactMap.get(c.id) || '',
      address: (c as any).formatted_address || '',
    }))
  }, [customers, contactMap])

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
          <button onClick={() => setMyOnly(false)} className={`flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ${!myOnly ? 'bg-primary text-white' : 'text-text-secondary'}`}>الكل</button>
          <button onClick={() => setMyOnly(true)} className={`flex-1 text-xs py-1.5 rounded-md font-semibold transition-colors ${myOnly ? 'bg-primary text-white' : 'text-text-secondary'}`}>عملائي</button>
        </div>
      )}

      <SmartFilterBar
        searchPlaceholder="بحث باسم العميل أو الكود..."
        employees={employees}
        employeeLabel="المسؤول عن العميل"
        onFilterChange={setFilters}
      />

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : enriched.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">
          {myOnly ? 'لا يوجد عملاء تابعين لك' : 'لا يوجد عملاء'}
        </div>
      ) : (
        <div className="space-y-2">
          {enriched.map((c: any) => {
            const loc = c.location_id ? locations.get(c.location_id) : null
            return (
              <div key={c.id} onClick={() => navigate(`/customers/${c.id}`)}
                className="bg-white rounded-xl border border-border p-3 cursor-pointer active:bg-surface transition-colors"
              >
                <div className="text-sm font-bold text-text">{c.company_name}</div>
                <div className="text-[11px] text-text-secondary mt-0.5">
                  {c.phone && <span>{c.phone}</span>}
                  {c.phone && (c.address || loc?.formatted_address) && <span> </span>}
                  {c.address && <span>{c.address}</span>}
                  {!c.address && loc?.formatted_address && <span>{loc.formatted_address}</span>}
                </div>
                {loc && (
                  <div className="flex items-center gap-2 mt-2">
                    <LocationDisplay lat={loc.latitude} lng={loc.longitude} size="sm" />
                    <span className={'text-[10px] ' + locationService.formatAccuracy(loc.accuracy_meters).className}>
                      {locationService.formatAccuracy(loc.accuracy_meters).label} ({locationService.formatAccuracy(loc.accuracy_meters).detail})
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
