import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { useCapability } from '../../hooks/useCapability'
import { locationService } from '../../services/location'
import { LocationDisplay } from '../../components/shared/LocationDisplay'

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
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [myOnly, setMyOnly] = useState(false)

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('get_governed_customer_contacts', { p_token: token }),
    ]).then(async ([custRes, contRes]) => {
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
    })
  }, [])

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

  const filtered = useMemo(() => {
    let list = enriched
    if (myOnly && currentEmpId) {
      list = list.filter((c: any) => c.owner_id === currentEmpId || c.created_by === currentEmpId)
    }
    const q = searchQuery.trim().toLowerCase()
    if (!q) return list
    return list.filter((c: any) =>
      (c.company_name || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.address || '').toLowerCase().includes(q)
    )
  }, [enriched, searchQuery, myOnly, currentEmpId])

  return (
    <div className="ds-gap-lg flex flex-col">
      <div className="flex items-center ds-gap-md">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-xl leading-none">&larr;</button>
        <h1 className="ds-title">العملاء</h1>
        {canCreate && (
          <button onClick={() => navigate('/customers/new')} className="ds-btn ds-btn-primary mr-auto">+ إضافة عميل</button>
        )}
      </div>

      {currentEmpId && (
        <div className="ds-tabs">
          <button onClick={() => setMyOnly(false)} className={`ds-tab ${!myOnly ? 'ds-tab-active' : 'ds-tab-inactive'}`}>الكل</button>
          <button onClick={() => setMyOnly(true)} className={`ds-tab ${myOnly ? 'ds-tab-active' : 'ds-tab-inactive'}`}>عملائي</button>
        </div>
      )}

      <input
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="بحث عن عميل..."
        className="ds-input"
      />

      {loading ? (
        <div className="text-center py-12 ds-small">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 ds-small">
          {searchQuery ? 'لا توجد نتائج' : (myOnly ? 'لا يوجد عملاء تابعين لك' : 'لا يوجد عملاء')}
        </div>
      ) : (
        <div className="ds-gap-sm flex flex-col">
          {filtered.map((c: any) => {
            const loc = c.location_id ? locations.get(c.location_id) : null
            return (
              <div key={c.id} onClick={() => navigate(`/customers/${c.id}`)}
                className="ds-card cursor-pointer active:bg-surface transition-colors"
              >
                <div className="ds-body font-bold">{c.company_name}</div>
                <div className="ds-xs mt-0.5">
                  {c.phone && <span>{c.phone}</span>}
                  {c.phone && (c.address || loc?.formatted_address) && <span> </span>}
                  {c.address && <span>{c.address}</span>}
                  {!c.address && loc?.formatted_address && <span>{loc.formatted_address}</span>}
                </div>
                {loc && (
                  <div className="flex items-center ds-gap-sm mt-2">
                    <LocationDisplay lat={loc.latitude} lng={loc.longitude} size="sm" />
                    <span className={'ds-xs ' + locationService.formatAccuracy(loc.accuracy_meters).className}>
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
