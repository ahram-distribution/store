import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useVisitsStore } from '../../store/visits'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { VisitCard } from '../../components/visits/VisitCard'
import { locationService } from '../../services/location'
import { getCurrentLocation } from '../../services/gpsService'
import { lifeSignalService } from '../../services/lifeSignalService'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const filterLabels: Record<string, string> = {
  today: 'زيارات اليوم', active: 'زيارات نشطة',
}

const STATUS_OPTIONS = [
  { value: '', label: 'كل الحالات' },
  { value: 'active', label: 'نشط' },
  { value: 'completed', label: 'مكتمل' },
  { value: 'cancelled', label: 'ملغي' },
]

export function VisitsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const filter = searchParams.get('filter')
  const { activeVisit } = useVisitsStore()
  const [visits, setVisits] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [showCheckin, setShowCheckin] = useState(false)
  const [checkinCustomerId, setCheckinCustomerId] = useState('')

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_governed_visits', { p_token: token }),
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('get_governed_employees', { p_token: token }),
    ]).then(([visRes, custRes, empRes]) => {
      let result = (visRes.data as any[]) || []
      if (filter === 'today') {
        result = result.filter((v: any) => {
          const dt = v.check_in_at || v.created_at
          if (!dt) return false
          const d = new Date(dt); const n = new Date()
          return !isNaN(d.getTime()) && d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
        })
      } else if (filter === 'active') {
        result = result.filter((v: any) => v.status === 'active')
      }
      setVisits(result)
      if (custRes.data) setCustomers(Array.isArray(custRes.data) ? custRes.data : [])
      if (empRes.data) setEmployees(empRes.data)
      setLoading(false)
    })
  }, [filter])

  const customerMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of customers) m.set(c.id, c.company_name)
    return m
  }, [customers])

  const employeeMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of employees) m.set(e.id, e.full_name)
    return m
  }, [employees])

  const filtered = useMemo(() => {
    let list = visits
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter((v: any) =>
        (v.customer_name || customerMap.get(v.customer_id) || '').toLowerCase().includes(q) ||
        (v.code || '').toLowerCase().includes(q) ||
        (v.notes || '').toLowerCase().includes(q)
      )
    }
    if (statusFilter) list = list.filter((v: any) => v.status === statusFilter)
    if (customerFilter) list = list.filter((v: any) => v.customer_id === customerFilter)
    if (employeeFilter) list = list.filter((v: any) => v.employee_id === employeeFilter)
    if (dateFrom) list = list.filter((v: any) => v.created_at >= dateFrom)
    if (dateTo) list = list.filter((v: any) => v.created_at <= dateTo + 'T23:59:59')
    return list
  }, [visits, searchQuery, statusFilter, customerFilter, employeeFilter, dateFrom, dateTo, customerMap])

  async function handleCheckin() {
    if (!checkinCustomerId) { toast.error('اختر العميل'); return }
    const token = getToken()

    const result = await getCurrentLocation()

    let locationId: string | null = null
    let gps = result.location
    if (result.success && result.location) {
      locationId = await locationService.saveLocation(result.location)
    }

    const { data, error } = await supabase.rpc('governed_checkin_visit', {
      p_token: token, p_customer_id: checkinCustomerId,
      p_start_location_id: locationId,
      p_latitude: gps?.latitude || null,
      p_longitude: gps?.longitude || null,
    })
    if (error) { console.error('[VISIT] VisitsPage checkin failed', error); toast.error(error.message); return }
    const resultData = data as any
    if (resultData.error) { console.error('[VISIT] VisitsPage checkin result error', resultData.error); toast.error(resultData.error); return }
    lifeSignalService.notifyBusiness('visit_checkin')
    toast.success('تم تسجيل الدخول')
    setShowCheckin(false); setCheckinCustomerId('')
    if (resultData.id) navigate(`/visits/${resultData.id}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {filter && <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-lg">&larr;</button>}
          <h1 className="text-lg font-bold text-text">{filter && filterLabels[filter] ? filterLabels[filter] : 'الزيارات'}</h1>
        </div>
        <div className="flex gap-2">
          {!filter && !activeVisit && (
            <button onClick={() => setShowCheckin(true)} className="bg-success text-white text-xs px-3 py-2 rounded-lg">
              + تسجيل دخول
            </button>
          )}
          {!filter && !activeVisit && (
            <button onClick={() => navigate('/visits/new')} className="bg-primary text-white text-xs px-3 py-2 rounded-lg">
              + زيارة جديدة
            </button>
          )}
        </div>
      </div>

      {activeVisit && (
        <div className="bg-success/10 border border-success/30 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-sm font-semibold text-text">زيارة نشطة</span>
              <p className="text-xs text-text-secondary">{activeVisit.customerName}</p>
            </div>
            <StatusBadge status="active" />
          </div>
          <button onClick={() => navigate(`/visits/${activeVisit.id}`)} className="w-full bg-success text-white text-xs py-2 rounded-lg mt-2">
            فتح الزيارة
          </button>
        </div>
      )}

      {showCheckin && (
        <div className="bg-white rounded-lg border border-border p-4 space-y-3">
          <h2 className="text-sm font-bold">تسجيل دخول زيارة</h2>
          <select value={checkinCustomerId} onChange={(e) => setCheckinCustomerId(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="">اختر العميل</option>
            {customers.map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={handleCheckin} className="flex-1 bg-success text-white text-xs py-2 rounded-lg">تسجيل الدخول</button>
            <button onClick={() => setShowCheckin(false)} className="px-4 border border-border rounded-lg text-xs">إلغاء</button>
          </div>
        </div>
      )}

      <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="بحث باسم العميل أو كود الزيارة..." className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-white" />

      <div className="grid grid-cols-2 gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
        <select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}
          className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          <option value="">كل العملاء</option>
          {customers.map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}
          className="border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          <option value="">كل الموظفين</option>
          {employees.map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
        <div className="flex gap-1">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد زيارات</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((visit: any) => (
            <VisitCard
              key={visit.id}
              visit={visit}
              customerName={visit.customer_name || customerMap.get(visit.customer_id) || ''}
              employeeName={employeeMap.get(visit.employee_id) || ''}
              onClick={() => navigate(`/visits/${visit.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
