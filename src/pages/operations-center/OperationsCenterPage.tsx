import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { User } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Header from './components/Header'
import TimeFilterBar from './components/TimeFilterBar'
import type { TimeFilter } from './components/TimeFilterBar'
import FilterBar from './components/FilterBar'
import GlobalCounters from './components/GlobalCounters'
import TeamStatusTabs from './components/TeamStatusTabs'
import type { TeamTab } from './components/TeamStatusTabs'
import EmployeeCard from './components/EmployeeCard'
import type { ActiveEmployee, NoStartEmployee, EndedEmployee } from './components/EmployeeCard'
import ProductivityArea from './components/ProductivityArea'
import AlertsArea from './components/AlertsArea'
import { computeAlerts } from './components/AlertsArea'
import MapTab from './components/MapTab'

interface LiveOverview {
  active_count: number
  on_visit_count: number
  on_break_count: number
  connection_loss_count: number
  no_start_count: number
  ended_count: number
  zero_orders_count: number
  zero_visits_count: number
  employees: ActiveEmployee[]
  no_start_employees: NoStartEmployee[]
  ended_employees: EndedEmployee[]
  late_count: number
  team_aggregates: {
    active_employee_count: number
    total_net_minutes: number | null
    total_target_minutes: number | null
    progress_pct: number
    avg_net_minutes: number | null
    avg_target_minutes: number | null
    late_count: number
    zero_orders_count: number
    zero_visits_count: number
    best_performer: { employee_id: string; name: string; score: number } | null
    worst_performer: { employee_id: string; name: string; score: number } | null
  }
}

const POLLING_INTERVAL = 30000

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const STATUS_PRIORITY: Record<string, number> = {
  connected: 0,
  working: 1,
  on_visit: 2,
  on_break: 3,
  delayed: 4,
  lost: 5,
  no_data: 6,
}

export default function OperationsCenterPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<LiveOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('today')
  const [teamTab, setTeamTab] = useState<TeamTab>('active')
  const [searchQuery, setSearchQuery] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [areaFilter, setAreaFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [hiddenAlerts, setHiddenAlerts] = useState<Set<string>>(new Set())
  const [canConfigure, setCanConfigure] = useState(false)

  const token = getToken()
  const simpleMode = new URLSearchParams(window.location.search).has('simple')

  useEffect(() => {
    if (!token) return
    supabase.rpc('check_capability', { p_token: token.trim(), p_code: 'attendance.configure' }).then(({ data }) => {
      if (data === true) setCanConfigure(true)
    })
  }, [token])

  const fetchData = useCallback(async () => {
    if (!token) return
    const { data: result, error } = await supabase.rpc('get_live_workday_overview', { p_token: token?.trim() })
    if (error) { setLoading(false); return }
    if (result && typeof result === 'object' && !('error' in (result as Record<string, unknown>))) {
      setData(result as unknown as LiveOverview)
      setLastUpdate(new Date())
    }
    setLoading(false)
  }, [token])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, POLLING_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchData])

  const departments = useMemo(() => {
    if (!data) return []
    const set = new Set<string>();
    const emps = data.employees ?? [];
    const noStarts = data.no_start_employees ?? [];
    const endeds = data.ended_employees ?? [];
    emps.forEach((e) => { if (e.role_name) set.add(e.role_name) })
    noStarts.forEach((e) => { if (e.role_name) set.add(e.role_name) })
    endeds.forEach((e) => { if (e.role_name) set.add(e.role_name) })
    return Array.from(set).sort()
  }, [data])

  const areas = useMemo(() => {
    if (!data) return []
    const set = new Set<string>();
    const addLoc = (loc: string | null) => { if (loc && loc !== 'field' && loc !== 'office') set.add(loc) }
    const emps = data.employees ?? [];
    const noStarts = data.no_start_employees ?? [];
    const endeds = data.ended_employees ?? [];
    emps.forEach((e) => { if (e.work_location === 'field') set.add('ميداني'); else if (e.work_location === 'office') set.add('مكتبي'); else addLoc(e.work_location) })
    noStarts.forEach((e) => { if (e.work_location === 'field') set.add('ميداني'); else if (e.work_location === 'office') set.add('مكتبي'); else addLoc(e.work_location) })
    endeds.forEach((e) => { if (e.work_location === 'field') set.add('ميداني'); else if (e.work_location === 'office') set.add('مكتبي'); else addLoc(e.work_location) })
    return Array.from(set).sort()
  }, [data])

  const filteredActive = useMemo(() => {
    if (!data) return []
    return (data.employees ?? [])
      .filter((e) => {
        if (deptFilter && e.role_name !== deptFilter) return false
        if (areaFilter) {
          const areaLabel = e.work_location === 'field' ? 'ميداني' : e.work_location === 'office' ? 'مكتبي' : e.work_location
          if (areaLabel !== areaFilter) return false
        }
        if (statusFilter !== 'all' && e.status !== statusFilter) return false
        if (searchQuery && !e.name.includes(searchQuery) && !e.role_name?.includes(searchQuery)) return false
        return true
      })
      .sort((a, b) => {
        const pa = STATUS_PRIORITY[a.connection_status] ?? 99
        const pb = STATUS_PRIORITY[b.connection_status] ?? 99
        if (pa !== pb) return pa - pb
        const sa = STATUS_PRIORITY[a.status] ?? 99
        const sb = STATUS_PRIORITY[b.status] ?? 99
        return sa - sb
      })
  }, [data, deptFilter, areaFilter, statusFilter, searchQuery])

  const filteredNoStart = useMemo(() => {
    if (!data) return []
    return (data.no_start_employees ?? []).filter((e) => {
      if (deptFilter && e.role_name !== deptFilter) return false
      if (areaFilter) {
        const areaLabel = e.work_location === 'field' ? 'ميداني' : e.work_location === 'office' ? 'مكتبي' : e.work_location
        if (areaLabel !== areaFilter) return false
      }
      if (searchQuery && !e.name.includes(searchQuery) && !e.role_name?.includes(searchQuery)) return false
      return true
    })
  }, [data, deptFilter, areaFilter, searchQuery])

  const filteredEnded = useMemo(() => {
    if (!data) return []
    return (data.ended_employees ?? [])
      .filter((e) => {
        if (deptFilter && e.role_name !== deptFilter) return false
        if (areaFilter) {
          const areaLabel = e.work_location === 'field' ? 'ميداني' : e.work_location === 'office' ? 'مكتبي' : e.work_location
          if (areaLabel !== areaFilter) return false
        }
        if (searchQuery && !e.name.includes(searchQuery) && !e.role_name?.includes(searchQuery)) return false
        return true
      })
      .sort((a, b) => {
        const aEnd = a.ended_at ? new Date(a.ended_at).getTime() : NaN
        const bEnd = b.ended_at ? new Date(b.ended_at).getTime() : NaN
        if (!isNaN(aEnd) && !isNaN(bEnd)) return bEnd - aEnd
        if (!isNaN(aEnd)) return -1
        if (!isNaN(bEnd)) return 1
        return 0
      })
  }, [data, deptFilter, areaFilter, searchQuery])

  const safeNum = (v: unknown): number => (typeof v === 'number' && !isNaN(v)) ? v : 0
  const totals = useMemo(() => {
    if (!data) return { orders: 0, sales: 0, newCustomers: 0, visits: 0 }
    return {
      orders: (data.employees ?? []).reduce((s, e) => s + safeNum(e.order_count), 0) + (data.ended_employees ?? []).reduce((s, e) => s + safeNum(e.order_count), 0),
      sales: (data.employees ?? []).reduce((s, e) => s + safeNum(e.sales_value), 0) + (data.ended_employees ?? []).reduce((s, e) => s + safeNum(e.sales_value), 0),
      newCustomers: (data.employees ?? []).reduce((s, e) => s + safeNum(e.new_customer_count), 0) + (data.ended_employees ?? []).reduce((s, e) => s + safeNum(e.new_customer_count), 0),
      visits: (data.employees ?? []).reduce((s, e) => s + safeNum(e.visit_count), 0) + (data.ended_employees ?? []).reduce((s, e) => s + safeNum(e.visit_count), 0),
    }
  }, [data])

  const handleDismissAlert = useCallback((key: string) => {
    setHiddenAlerts((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }, [])

  const handleCounterClick = useCallback((label: string) => {
    const tabMap: Record<string, TeamTab> = {
      'النشطون': 'active',
      'المنتهون': 'ended',
      'لم يبدؤوا': 'no_start',
    }
    const tab = tabMap[label]
    if (tab) { setTeamTab(tab); return }
    const navMap: Record<string, string> = {
      'الطلبات': '/orders?filter=today',
      'المبيعات': '/orders?filter=today',
      'عملاء جدد': '/customers',
      'الزيارات': '/visits?filter=today',
    }
    const path = navMap[label]
    if (path) navigate(path)
  }, [navigate])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50" dir="rtl">
        <div className="text-center">
          <p className="text-gray-400 mb-2">جاري تحميل غرفة العمليات...</p>
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  const isHistoryFilter = timeFilter === 'yesterday' || timeFilter === 'this_week' || timeFilter === 'custom_range_history'

  const alertCount = data
    ? (data.no_start_employees ?? []).length + (data.employees ?? []).filter((e) => e.connection_status === 'lost').length
    : 0

  return (
    <div className="min-h-screen bg-gray-50 p-5" dir="rtl">
      <div className="mx-auto" style={{ maxWidth: '1440px' }}>
        <Header
          lastUpdate={lastUpdate}
          pollingSeconds={POLLING_INTERVAL / 1000}
          onRefresh={fetchData}
          alertCount={alertCount}
           canConfigure={canConfigure}
        />

        <TimeFilterBar active={timeFilter} onChange={setTimeFilter} />

        {!simpleMode && (
          <FilterBar
            departments={departments}
            areas={areas}
            onDepartmentChange={setDeptFilter}
            onAreaChange={setAreaFilter}
            onStatusChange={setStatusFilter}
            onSearchChange={setSearchQuery}
          />
        )}

        <GlobalCounters
          activeCount={data?.active_count ?? 0}
          onBreakCount={data?.on_break_count ?? 0}
          connectionLossCount={data?.connection_loss_count ?? 0}
          noStartCount={data?.no_start_count ?? 0}
          totalOrders={totals.orders}
          totalSales={totals.sales}
          totalNewCustomers={totals.newCustomers}
          totalVisits={totals.visits}
          onCounterClick={handleCounterClick}
        />

        {!isHistoryFilter && data?.team_aggregates && (
          <ProductivityArea
            team={data.team_aggregates}
            endedCount={data.ended_count}
            onVisitCount={data.on_visit_count}
            timeFilter={timeFilter}
          />
        )}

        {!isHistoryFilter && (
          <div id="ops-alerts-area">
            <AlertsArea
              employees={data?.employees ?? []}
              noStartEmployees={data?.no_start_employees ?? []}
              endedEmployees={data?.ended_employees ?? []}
              onVisitCount={data?.on_visit_count ?? 0}
              lateCount={data?.late_count ?? 0}
              zeroOrdersCount={data?.zero_orders_count ?? 0}
              endedCount={data?.ended_count ?? 0}
              hiddenAlerts={hiddenAlerts}
              onDismiss={handleDismissAlert}
            />
          </div>
        )}

        {isHistoryFilter && data && (
          <div className="bg-white rounded-xl shadow-sm p-4 mb-4">
            <p className="text-xs text-gray-500 text-center">وضع العرض التاريخي — المعلومات المعروضة تعكس بيانات أمس / الأسبوع</p>
          </div>
        )}

        <TeamStatusTabs
          active={teamTab}
          onChange={setTeamTab}
          activeCount={data?.active_count ?? 0}
          endedCount={data?.ended_count ?? 0}
          noStartCount={data?.no_start_count ?? 0}
        />

        {teamTab === 'map' && <MapTab />}

        {teamTab === 'active' && (
          <>
            {filteredActive.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <User className="w-12 h-12 mx-auto mb-3" />
                لا يوجد موظفون نشطون حالياً
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredActive.map((e) => (
                  <EmployeeCard key={e.employee_id} variant="active" employee={e} />
                ))}
              </div>
            )}
          </>
        )}

        {teamTab === 'no_start' && (
          <>
            {filteredNoStart.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <User className="w-12 h-12 mx-auto mb-3" />
                {searchQuery || deptFilter || areaFilter
                  ? 'لا يوجد موظفون يطابقون الفلتر'
                  : 'جميع الموظفين بدؤوا يوم العمل'}
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredNoStart.map((e) => (
                  <EmployeeCard key={e.employee_id} variant="no_start" employee={e} />
                ))}
              </div>
            )}
          </>
        )}

        {teamTab === 'ended' && (
          <>
            {filteredEnded.length === 0 ? (
              <div className="text-center py-10 text-gray-400">
                <User className="w-12 h-12 mx-auto mb-3" />
                لا يوجد موظفون منتهون اليوم
              </div>
            ) : (
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredEnded.map((e) => (
                  <EmployeeCard key={e.employee_id} variant="ended" employee={e} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
