import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useVisitsStore } from '../../store/visits'
import { StatusBadge } from '../../components/shared/StatusBadge'
import { VisitCard } from '../../components/visits/VisitCard'
import { RemoteSearchableSelect } from '../../components/shared/RemoteSearchableSelect'
import { locationService } from '../../services/location'
import { getStrictLocation } from '../../services/gpsService'
import { trackingEngine } from '../../services/trackingEngine'
import { lifeSignalService } from '../../services/lifeSignalService'
import SmartFilterBar, { type FilterValues } from '../../components/SmartFilterBar'
import { PaginationFooter } from '../../components/data-list/PaginationFooter'
import toast from 'react-hot-toast'
import { usePersistentViewState } from '../../hooks/usePersistentViewState'
import { resolveDateRangeISO, cairoDateComponents } from '../../lib/dateRange'
import {
  buildVisitsReportFilterSummary,
  buildVisitsReportRows,
  exportVisitsReportExcel,
  printVisitsReport,
  type VisitsReportMeta,
} from '../../services/visitsReport'

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

const PAGE_SIZE = 30

export function VisitsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const filter = searchParams.get('filter')
  const { activeVisit } = useVisitsStore()
  const [visits, setVisits] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [governorates, setGovernorates] = useState<{ id: string; name_ar: string }[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const reqCounter = useRef(0)
  const [loading, setLoading] = useState(true)
  const [viewState, setViewState, resetViewState] = usePersistentViewState('visits-list', {
    statusFilter: filter === 'active' ? 'active' : '',
    customerFilter: '',
    governorateFilter: '',
    filters: { datePreset: filter === 'today' ? 'today' : 'all', dateFrom: '', dateTo: '', search: '', employeeId: '' } as FilterValues,
  })
  const { statusFilter, customerFilter, governorateFilter, filters } = viewState
  const [sfResetKey, setSfResetKey] = useState(0)

  const [showCheckin, setShowCheckin] = useState(false)
  const [checkinCustomerId, setCheckinCustomerId] = useState('')
  const [checkinBusy, setCheckinBusy] = useState(false)

  const loadCustomerOptions = useCallback(async (query: string) => {
    const token = getToken()
    if (!token) return []
    const { data } = await supabase.rpc('get_governed_customers', {
      p_token: token.trim(), p_search: query || null, p_page: 1, p_per_page: 20,
    })
    const rows = Array.isArray(data) ? data : []
    return rows.map((c: any) => ({ id: c.id, name: c.company_name }))
  }, [])

  const resolveCustomerLabel = useCallback(async (id: string) => {
    const token = getToken()
    if (!token) return null
    const { data } = await supabase.rpc('get_governed_customer', { p_token: token.trim(), p_id: id })
    if (!data) return null
    const row = Array.isArray(data) ? data[0] : data
    return (row && row.company_name) ? String(row.company_name) : null
  }, [])

  const resolveDateRange = (f: FilterValues): { from: string | null; to: string | null } => {
    if (f.datePreset === 'all') return { from: null, to: null }
    if (f.datePreset === 'custom') return resolveDateRangeISO('custom', f.dateFrom || undefined, f.dateTo || undefined)
    return resolveDateRangeISO(f.datePreset as any)
  }

  const buildParams = useCallback((page: number, perPage: number, countOnly: boolean) => {
    const token = getToken()
    if (!token) return null
    const range = resolveDateRange(filters)
    const rpcParams: any = { p_token: token.trim(), p_page: page, p_per_page: perPage, p_count_only: countOnly }
    if (filters.search) rpcParams.p_search = filters.search
    if (filters.employeeId) rpcParams.p_employee_id = filters.employeeId
    if (range.from) rpcParams.p_date_from = range.from
    if (range.to) rpcParams.p_date_to = range.to
    if (statusFilter) rpcParams.p_status = statusFilter
    if (customerFilter) rpcParams.p_customer_id = customerFilter
    if (governorateFilter) rpcParams.p_governorate_id = governorateFilter
    return rpcParams
  }, [filters, statusFilter, customerFilter, governorateFilter])

  const fetchVisits = useCallback(async (targetPage: number) => {
    const params = buildParams(targetPage, PAGE_SIZE, false)
    if (!params) { setLoading(false); return }
    setLoading(true)
    const reqId = ++reqCounter.current
    const [rowsRes, countRes] = await Promise.all([
      supabase.rpc('get_governed_visits', params),
      supabase.rpc('get_governed_visits', buildParams(1, PAGE_SIZE, true)),
    ])
    if (reqId !== reqCounter.current) return
    const rows = Array.isArray(rowsRes.data) ? rowsRes.data : []
    const count = (countRes.data && typeof countRes.data === 'object' && 'count' in (countRes.data as any)
      ? Number((countRes.data as any).count)
      : 0)
    setVisits(rows)
    setTotalCount(count)
    setLoading(false)
  }, [buildParams])

  // Reset to page 1 whenever any filter changes; the page then re-fetches from
  // the server with the (server-side) filtered COUNT.
  useEffect(() => { setPage(1) }, [filters, statusFilter, customerFilter, governorateFilter])

  useEffect(() => { fetchVisits(page) }, [page, fetchVisits])

  useEffect(() => {
    const token = getToken()
    if (!token) return
    Promise.all([
      supabase.rpc('get_governed_employees', { p_token: token }),
      supabase.from('reference_governorates').select('id, name_ar').order('name_ar', { ascending: true }),
    ]).then(([empRes, govRes]) => {
      if (empRes.data) setEmployees(Array.isArray(empRes.data) ? empRes.data : [])
      if (govRes.data) setGovernorates(govRes.data || [])
    })
  }, [])

  const employeeMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of employees) m.set(e.id, e.full_name)
    return m
  }, [employees])

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE))

  const reportContext = () => ({
    datePreset: filters.datePreset,
    dateFrom: filters.dateFrom || '',
    dateTo: filters.dateTo || '',
    search: filters.search || '',
    employeeId: filters.employeeId || '',
    statusFilter: statusFilter || '',
    customerFilter: customerFilter || '',
    governorateFilter: governorateFilter || '',
    employees: employees.map((e: any) => ({ id: e.id, name: e.full_name })),
    customers: [] as { id: string; company_name: string }[],
    governorates,
  })

  const buildReportMeta = (): VisitsReportMeta => {
    const [y, m, d] = cairoDateComponents(new Date())
    const stamp = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    return {
      title: 'تقرير الزيارات',
      subtitle: 'قائمة الزيارات المعروضة على شاشة الزيارات',
      generatedAt: new Date(),
      filterLines: buildVisitsReportFilterSummary(reportContext()),
      fileName: `تقرير_الزيارات_${stamp}`,
    }
  }

  const fetchAllMatching = async () => {
    const params = buildParams(1, 10000, false)
    if (!params) return []
    const { data } = await supabase.rpc('get_governed_visits', params)
    return Array.isArray(data) ? data : []
  }

  const reportEmployees = () => employees.map((e: any) => ({ id: e.id, name: e.full_name }))

  const handleReportExcel = async () => {
    if (!totalCount) return
    const rows = await fetchAllMatching()
    if (!rows.length) return
    exportVisitsReportExcel(buildVisitsReportRows(rows, { employees: reportEmployees() }), buildReportMeta())
  }

  const handleReportPrint = async () => {
    if (!totalCount) return
    const rows = await fetchAllMatching()
    if (!rows.length) return
    printVisitsReport(buildVisitsReportRows(rows, { employees: reportEmployees() }), buildReportMeta())
  }

  async function handleCheckin() {
    if (!checkinCustomerId) { toast.error('اختر العميل'); return }
    if (checkinBusy) return
    const token = getToken()
    if (!token) return

    setCheckinBusy(true)

    const result = await getStrictLocation()
    if (!result.success || !result.location) {
      setCheckinBusy(false)
      toast.error('لا يمكن بدء الزيارة قبل تحديد موقعك الحالي.')
      toast.error('تعذر تحديد موقعك الحالي. تأكد من تشغيل خدمة الموقع ثم حاول مرة أخرى.')
      return
    }

    const gps = result.location
    const locationId = await locationService.saveLocation(gps)
    trackingEngine.recordActionPoint({
      latitude: gps.latitude,
      longitude: gps.longitude,
      accuracy: gps.accuracy,
      pointType: 'visit_checkin',
    }).catch(() => {})

    const { data, error } = await supabase.rpc('governed_checkin_visit', {
      p_token: token, p_customer_id: checkinCustomerId,
      p_start_location_id: locationId,
      p_latitude: gps.latitude,
      p_longitude: gps.longitude,
    })
    setCheckinBusy(false)
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
          {!loading && totalCount > 0 && (
            <>
              <button onClick={handleReportExcel} className="bg-white border border-border rounded-lg text-[11px] px-2.5 py-1.5 font-semibold text-text hover:bg-neutral-50">📊 Excel</button>
              <button onClick={handleReportPrint} className="bg-white border border-border rounded-lg text-[11px] px-2.5 py-1.5 font-semibold text-text hover:bg-neutral-50">🖨️ طباعة</button>
            </>
          )}
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
          <RemoteSearchableSelect
            value={checkinCustomerId}
            onChange={setCheckinCustomerId}
            loadOptions={loadCustomerOptions}
            resolveLabel={resolveCustomerLabel}
            placeholder="اختر العميل"
          />
          <div className="flex gap-2">
            <button onClick={handleCheckin} disabled={checkinBusy} className="flex-1 bg-success text-white text-xs py-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed">
              {checkinBusy ? 'جارٍ تحديد موقعك الحالي...' : 'تسجيل الدخول'}
            </button>
            <button onClick={() => setShowCheckin(false)} className="px-4 border border-border rounded-lg text-xs">إلغاء</button>
          </div>
        </div>
      )}

      <SmartFilterBar key={sfResetKey} initialFilters={filters}
        searchPlaceholder="بحث باسم العميل أو كود الزيارة..."
        employees={employees.map(e => ({ id: e.id, name: e.full_name }))}
        onFilterChange={(f) => setViewState({ filters: f })}
      />
        <button onClick={() => { resetViewState(); setSfResetKey(k => k + 1) }} className="text-[10px] px-2 py-1 text-danger font-semibold">إعادة تعيين</button>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <select value={statusFilter} onChange={(e) => setViewState({ statusFilter: e.target.value })}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
            {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <select value={governorateFilter} onChange={(e) => setViewState({ governorateFilter: e.target.value })}
            className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
            <option value="">كل المحافظات</option>
            {governorates.map((g) => <option key={g.id} value={g.id}>{g.name_ar}</option>)}
          </select>
        </div>
        <RemoteSearchableSelect
          value={customerFilter}
          onChange={(id) => setViewState({ customerFilter: id })}
          loadOptions={loadCustomerOptions}
          resolveLabel={resolveCustomerLabel}
          placeholder="كل العملاء"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : visits.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد زيارات</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {visits.map((visit: any) => (
              <VisitCard
                key={visit.id}
                visit={visit}
                customerName={visit.customer_name || ''}
                employeeName={employeeMap.get(visit.employee_id) || ''}
                onClick={() => navigate(`/visits/${visit.id}`)}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <PaginationFooter page={page} totalPages={totalPages} onChange={setPage} />
          )}
        </>
      )}
    </div>
  )
}