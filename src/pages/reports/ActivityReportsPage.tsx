import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { ReportIdentity, monthFilter, computeDateRange } from '../../components/reports'
import { UnifiedFilterBar } from '../../components/shared/UnifiedFilterBar'
import { KpiDrillDownModal } from '../../components/KpiDrillDownModal'
import { EmployeeActivitySummary } from '../../components/reports/EmployeeActivitySummary'
import { exportToExcel, type ExportColumn } from '../../services/excelExporter'
import { exportToPdf, tableToHtml, kpiGridToHtml } from '../../services/pdfExporter'
import type { FilterState } from '../../types/filters'
import type { ReportIdentity as IdentityData, KpiCardData } from '../../types/reports'
import type { EntityType } from '../../modules/types'
import type { ActivityViewModel, ActivityDailyRow, DayDetailData } from '../../types/reports'
import { cairoDateComponents, toCairoDate } from '../../lib/dateRange'

interface GovEmployee {
  id: string
  full_name: string
  code: string
  manager_id: string | null
}

interface TeamMemberRow {
  employee_id: string
  code: string
  full_name: string
  manager_id: string | null
  manager_name: string
  manager_code: string
  sales: number
  orders: number
  completed_visits: number
  registered_customers: number
}

function safeRow(r: Record<string, unknown>): TeamMemberRow {
  return {
    employee_id: r.employee_id as string ?? '',
    code: r.code as string ?? '',
    full_name: r.full_name as string ?? '',
    manager_id: (r.manager_id as string) ?? null,
    manager_name: r.manager_name as string ?? '',
    manager_code: r.manager_code as string ?? '',
    sales: Number(r.sales) || 0,
    orders: Number(r.orders) || 0,
    completed_visits: Number(r.completed_visits) || 0,
    registered_customers: Number(r.registered_customers) || 0,
  }
}

function computeIdentity(
  title: string,
  filters: FilterState,
  managerName?: string,
  employeeName?: string,
  employeeCode?: string,
): IdentityData {
  const scope = filters.employeeId ? 'employee' : filters.managerId ? 'manager' : 'company'
  return {
    title,
    scope,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    generatedAt: new Date().toISOString(),
    managerName,
    employeeName,
    employeeCode,
  }
}

function getRoleLabel(employeeId: string, tree: GovEmployee[]): string {
  const emp = tree.find((e) => e.id === employeeId)
  if (!emp) return 'موظف'
  const hasDirectReports = tree.some((e) => e.manager_id === employeeId)
  if (hasDirectReports && !emp.manager_id) return 'المشرف التنفيذي'
  if (hasDirectReports) return 'مدير البيع'
  return 'مندوب المبيعات'
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

function fmtDist(meters: number | null | undefined): string {
  if (meters == null || meters === 0) return '\u2014'
  const km = meters / 1000
  return km >= 1 ? `${km.toFixed(1)} كم` : `${Math.round(meters)} م`
}

function fmtTime(t?: string): string {
  if (!t) return '\u2014'
  try { return new Date(t).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true }) }
  catch { return t.length >= 5 ? t.slice(0, 5) : t }
}

function fmtDate(d?: string): string {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }) }
  catch { return d }
}

function fmtShortDate(d?: string): string {
  if (!d) return ''
  try { return new Date(d).toLocaleDateString('ar-EG', { day: 'numeric', month: 'numeric' }) }
  catch { return d }
}

function fmtHours(minutes: number | null | undefined): string {
  if (minutes == null) return '\u2014'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

function fmtMoney(n: number | string | null | undefined): string {
  if (n == null) return '0'
  return Math.round(Number(n)).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 })
}

function generateDateRange(from: string, to: string): string[] {
  const dates: string[] = []
  const [startY, startM, startD] = cairoDateComponents(new Date(from))
  const [endY, endM, endD] = cairoDateComponents(new Date(to))
  const pad = (n: number) => String(n).padStart(2, '0')
  let cy = startY, cm = startM, cd = startD
  while (true) {
    dates.push(`${cy}-${pad(cm)}-${pad(cd)}`)
    if (cy > endY || (cy === endY && cm > endM) || (cy === endY && cm === endM && cd >= endD)) break
    const next = new Date(cy, cm - 1, cd + 1)
    const [ny, nm, nd] = cairoDateComponents(next)
    cy = ny; cm = nm; cd = nd
  }
  return dates
}

function groupByDate<T>(items: T[], getDate: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const d = getDate(item)
    if (!map.has(d)) map.set(d, [])
    map.get(d)!.push(item)
  }
  return map
}

const RECORD_ROUTES: Record<string, string> = {
  order: '/orders/',
  customer: '/customers/',
  visit: '/visits/',
}

export function ActivityReportsPage() {
  const nav = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const locationScope = (location.state as { scope?: 'company' | 'team' | 'self' })?.scope

  if (!locationScope) {
    console.error('[ActivityReportsPage] Missing scope in route state. Every caller must pass scope explicitly.')
  }

  const scope: 'company' | 'team' | 'self' = locationScope ?? (
    (import.meta.env.DEV ? 'team' : 'team')
  )
  
  // DEBUG: Log initial scope
  if (import.meta.env.DEV) {
    console.log('[ActivityReportsPage] MOUNT - scope:', scope, 'user:', user?.employee_id)
  }
  const effectiveManagerId = scope === 'team' && user?.employee_id ? user.employee_id : null
  const effectiveEmployeeId = scope === 'self' && user?.employee_id ? user.employee_id : null
  const isRepScope = effectiveEmployeeId != null
  const initialFilter = monthFilter()
  const [filters, setFilters] = useState<FilterState>({
    ...initialFilter,
    managerId: effectiveManagerId,
    employeeId: effectiveEmployeeId,
  })
  const [rows, setRows] = useState<TeamMemberRow[]>([])
  const [teamCache, setTeamCache] = useState<TeamMemberRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [employeeTree, setEmployeeTree] = useState<GovEmployee[]>([])
  const [employeeTreeLoaded, setEmployeeTreeLoaded] = useState(false)
  const [dd, setDd] = useState<{ open: boolean; kpiType: string; title: string; records: any[]; loading: boolean; recordType: string }>({
    open: false, kpiType: '', title: '', records: [], loading: false, recordType: '',
  })
  const [view, setView] = useState<'list' | 'employee'>('list')
  const [selectedEmployee, setSelectedEmployee] = useState<TeamMemberRow | null>(null)

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => (b.sales || 0) - (a.sales || 0))
  }, [rows])

  // DEBUG: Log every state change
  if (import.meta.env.DEV) {
    const prevViewRef = useRef(view)
    const prevSelectedEmployeeRef = useRef(selectedEmployee)
    useEffect(() => {
      if (prevViewRef.current !== view) {
        console.log('[ActivityReportsPage] view CHANGED:', prevViewRef.current, '->', view)
        prevViewRef.current = view
      }
    }, [view])
    useEffect(() => {
      if (prevSelectedEmployeeRef.current !== selectedEmployee) {
        console.log('[ActivityReportsPage] selectedEmployee CHANGED:', prevSelectedEmployeeRef.current?.employee_id, '->', selectedEmployee?.employee_id)
        prevSelectedEmployeeRef.current = selectedEmployee
      }
    }, [selectedEmployee])
  }

  const [activityVM, setActivityVM] = useState<ActivityViewModel | null>(null)
  const [activityLoading, setActivityLoading] = useState(false)
  const [activityError, setActivityError] = useState<string | null>(null)

  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const userRef = useRef(user)
  userRef.current = user
  const employeeTreeRef = useRef(employeeTree)
  employeeTreeRef.current = employeeTree
  const viewRef = useRef(view)
  viewRef.current = view
  const selectedEmployeeRef = useRef(selectedEmployee)
  selectedEmployeeRef.current = selectedEmployee

  useEffect(() => {
    const tok = (function getToken() { try { return localStorage.getItem('session_token') } catch { return null } })()
    if (!tok) return
    supabase.rpc('get_governed_employees', { p_token: tok }).then(({ data, error }: { data: any; error: any }) => {
      if (error || !data || data?.error) { setEmployeeTreeLoaded(true); return }
      if (Array.isArray(data)) setEmployeeTree(data as GovEmployee[])
      setEmployeeTreeLoaded(true)
    })
  }, [])

  const managerOptions = useMemo(() => {
    if (scope === 'team') {
      const me = employeeTree.find((e) => e.id === user?.employee_id)
      return me ? [{ value: me.id, label: me.full_name }] : []
    }
    const map = new Map<string, string>()
    for (const e of employeeTree) {
      if (e.manager_id && !map.has(e.manager_id)) {
        const mgr = employeeTree.find((m) => m.id === e.manager_id)
        map.set(e.manager_id, mgr ? mgr.full_name : e.manager_id)
      }
    }
    return Array.from(map, ([value, label]) => ({ value, label }))
  }, [employeeTree, scope, user?.employee_id])

  const employeeOptions = useMemo(() => {
    const toOpt = (e: GovEmployee) => ({ value: e.id, label: e.full_name || e.code || e.id })
    if (scope === 'team') {
      return employeeTree
        .filter((e) => e.manager_id === user?.employee_id)
        .map(toOpt)
    }
    if (filters.managerId) {
      return employeeTree
        .filter((e) => e.manager_id === filters.managerId)
        .map(toOpt)
    }
    return employeeTree.map(toOpt)
  }, [employeeTree, scope, user?.employee_id, filters.managerId])

  const selectedManagerName = useMemo(() => {
    if (scope === 'team') {
      const me = employeeTree.find((e) => e.id === user?.employee_id)
      return me?.full_name || undefined
    }
    if (filters.managerId) {
      const mgr = employeeTree.find((e) => e.id === filters.managerId)
      return mgr?.full_name || undefined
    }
    return undefined
  }, [filters.managerId, employeeTree, scope, user?.employee_id])

  const loadData = useCallback(async (f: FilterState) => {
    if (import.meta.env.DEV) console.log('[ActivityReportsPage] loadData START:', { hasEmployeeId: !!f.employeeId, managerId: f.managerId, dateFrom: f.dateFrom, dateTo: f.dateTo })
    setLoading(true)
    setError(null)

    if (f.employeeId) {
      if (import.meta.env.DEV) console.log('[ActivityReportsPage] loadData: single employee branch')
      const tok = getToken()
      if (!tok) { setLoading(false); return }
      const detailRes = await supabase.rpc('get_employee_detail_data', {
        p_token: tok,
        p_employee_id: f.employeeId,
        p_from: f.dateFrom || null,
        p_to: f.dateTo || null,
      })
      if (detailRes.error) { setError(detailRes.error.message); setLoading(false); return }
      const detail = (detailRes.data as any) || {}
      const dOrders = Array.isArray(detail.orders) ? detail.orders : []
      const dCustomers = Array.isArray(detail.customers) ? detail.customers : []
      const dVisits = Array.isArray(detail.visits) ? detail.visits : []
      const singleRow = safeRow({
        employee_id: f.employeeId,
        code: detail.employee_code || '',
        full_name: detail.employee_name || '',
        manager_id: null, manager_name: '', manager_code: '',
        sales: dOrders.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0),
        orders: dOrders.length,
        completed_visits: dVisits.length,
        registered_customers: dCustomers.length,
      })
      setRows([singleRow])
      if (viewRef.current === 'employee' && selectedEmployeeRef.current) {
        setSelectedEmployee(singleRow)
      }
    } else {
      if (import.meta.env.DEV) console.log('[ActivityReportsPage] loadData: team activity branch')
      const managerId = scopeRef.current === 'team'
        ? (userRef.current?.employee_id ?? null)
        : f.managerId
      if (import.meta.env.DEV) console.log('[ActivityReportsPage] loadData: managerId for RPC:', managerId)
      const tok = getToken()
      if (!tok) { setLoading(false); return }

      const { data: governedData, error: govErr } = await supabase.rpc('get_governed_employees', { p_token: tok })
      if (govErr) { setError(govErr.message); setLoading(false); return }
      if (!Array.isArray(governedData)) { setRows([]); setTeamCache([]); setLoading(false); return }

      let empIds: string[]
      if (managerId) {
        const teamMembers = (governedData as any[]).filter((e: any) => e.manager_id === managerId)
        empIds = teamMembers.map((e: any) => e.id as string)
        empIds.push(managerId)
      } else {
        empIds = (governedData as any[]).map((e: any) => e.id as string)
      }

      const governedMap = new Map<string, any>((governedData as any[]).map((e: any) => [e.id, e]))
      const teamData: TeamMemberRow[] = empIds.map((eid) => {
        const emp = governedMap.get(eid)
        return safeRow({
          employee_id: eid,
          code: emp?.code || '',
          full_name: emp?.full_name || '',
          manager_id: managerId ?? null,
          manager_name: '',
          manager_code: '',
          sales: 0, orders: 0, completed_visits: 0, registered_customers: 0,
        })
      })
      const isTeamView = !f.employeeId && managerId
      if (import.meta.env.DEV) console.log('[ActivityReportsPage] loadData: isTeamView:', isTeamView, 'tree length:', employeeTreeRef.current.length)
      if (isTeamView && employeeTreeRef.current.length > 0) {
        const teamMemberIds = new Set(employeeTreeRef.current
          .filter((e) => e.manager_id === managerId)
          .map((e) => e.id))
        teamMemberIds.add(managerId)
        const existingIds = new Set(teamData.map((r) => r.employee_id))
        for (const id of teamMemberIds) {
          if (!existingIds.has(id)) {
            const emp = employeeTreeRef.current.find((e) => e.id === id)
            if (emp) {
              teamData.push({
                employee_id: emp.id, code: emp.code, full_name: emp.full_name,
                manager_id: managerId ?? null, manager_name: '', manager_code: '',
                sales: 0, orders: 0, completed_visits: 0, registered_customers: 0,
              })
            }
          }
        }
      }

      const detailResults = await Promise.all(
        teamData.map(async (row) => {
          const { data: d } = await supabase.rpc('get_employee_detail_data', {
            p_token: tok,
            p_employee_id: row.employee_id,
            p_from: f.dateFrom || null,
            p_to: f.dateTo || null,
          })
          return { id: row.employee_id, detail: d }
        })
      )
      const detailMap = new Map(detailResults.map(r => [r.id, r.detail]))

      for (const row of teamData) {
        const detail = (detailMap.get(row.employee_id) as any) || {}
        const dOrders = Array.isArray(detail.orders) ? detail.orders : []
        const dCustomers = Array.isArray(detail.customers) ? detail.customers : []
        const dVisits = Array.isArray(detail.visits) ? detail.visits : []
        row.sales = dOrders.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0)
        row.orders = dOrders.length
        row.completed_visits = dVisits.length
        row.registered_customers = dCustomers.length
      }

      if (import.meta.env.DEV) console.log('[ActivityReportsPage] loadData: final teamData length:', teamData.length)
      setRows(teamData)
      setTeamCache(teamData)
      if (viewRef.current === 'employee' && selectedEmployeeRef.current) {
        const updated = teamData.find(r => r.employee_id === selectedEmployeeRef.current!.employee_id)
        if (updated) { setSelectedEmployee(updated) }
      }
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (import.meta.env.DEV) console.log('[ActivityReportsPage] filter useEffect triggered:', { filters, employeeTreeLoaded })
    if (filters.dateFrom && filters.dateTo) {
      const isTeamView = !filters.employeeId && filters.managerId
      if (isTeamView && !employeeTreeLoaded) return
      if (import.meta.env.DEV) console.log('[ActivityReportsPage] calling loadData from filter useEffect')
      loadData(filters)
    }
  }, [filters, loadData, employeeTreeLoaded])

  useEffect(() => {
    if (view !== 'employee' || !selectedEmployee) {
      setActivityVM(null)
      setActivityError(null)
      return
    }

    const token = getToken()
    if (!token) return

    setActivityLoading(true)
    setActivityError(null)

    let cancelled = false

    async function build() {
      try {
        const [sessionsRes, detailRes] = await Promise.all([
          supabase.rpc('get_employee_workday_history', {
            p_token: token,
            p_employee_id: selectedEmployee.employee_id,
            p_from: filters.dateFrom,
            p_to: filters.dateTo,
          }),
          supabase.rpc('get_employee_detail_data', {
            p_token: token,
            p_employee_id: selectedEmployee.employee_id,
            p_from: filters.dateFrom,
            p_to: filters.dateTo,
          }),
        ])

        if (cancelled) return
        if (sessionsRes.error) { setActivityError(sessionsRes.error.message); setActivityLoading(false); return }

        const raw = sessionsRes.data as Record<string, unknown> | null
        const sessionsArray = (raw?.sessions ?? []) as Record<string, unknown>[]
        const sessionList = sessionsArray.map((s) => ({
          date: toCairoDate(s.date),
          start_time: (s.start_time as string) ?? '',
          end_time: (s.end_time as string) ?? null,
          net_minutes: Number(s.net_minutes) || 0,
          distance_meters: Number(s.distance_meters) || 0,
          visit_count: s.visit_count != null ? Number(s.visit_count) : null,
        }))

        const detail = detailRes.data as any || {}
        const detailOrders = Array.isArray(detail.orders) ? detail.orders : []
        const detailCustomers = Array.isArray(detail.customers) ? detail.customers : []
        const detailVisits = Array.isArray(detail.visits) ? detail.visits : []

        const ordersByDate = groupByDate(detailOrders, (o: any) => toCairoDate(o.submitted_at))
        const customersByDate = groupByDate(detailCustomers, (c: any) => toCairoDate(c.created_at))
        const visitsByDate = groupByDate(detailVisits, (v: any) => toCairoDate(v.check_in_at || v.created_at))

        const sessionMap = new Map<string, { net_minutes: number; distance_meters: number; start_time: string; end_time: string | null }>()
        for (const s of sessionList) {
          if (!s.date) continue
          const existing = sessionMap.get(s.date)
          if (existing) {
            existing.net_minutes += s.net_minutes
            existing.distance_meters += s.distance_meters
            if (s.start_time && (!existing.start_time || s.start_time < existing.start_time)) existing.start_time = s.start_time
            if (s.end_time && (!existing.end_time || s.end_time > existing.end_time)) existing.end_time = s.end_time
          } else {
            sessionMap.set(s.date, { net_minutes: s.net_minutes, distance_meters: s.distance_meters, start_time: s.start_time, end_time: s.end_time })
          }
        }

        const allDates = generateDateRange(filters.dateFrom, filters.dateTo)
        const dailyRows: ActivityDailyRow[] = allDates.map((date) => {
          const session = sessionMap.get(date)
          const dayOrders = ordersByDate.get(date) || []
          const dayCustomers = customersByDate.get(date) || []
          const dayVisits = visitsByDate.get(date) || []
          return {
            date,
            start_time: session?.start_time ?? null,
            end_time: session?.end_time ?? null,
            net_minutes: session?.net_minutes ?? 0,
            visits: dayVisits.length,
            orders: dayOrders.length,
            sales: dayOrders.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0),
            new_customers: dayCustomers.length,
            distance_meters: session?.distance_meters ?? 0,
            has_activity: !!session || dayOrders.length > 0 || dayCustomers.length > 0 || dayVisits.length > 0,
          }
        })

        const kpi = {
          sales: detailOrders.reduce((sum: number, o: any) => sum + (Number(o.total_amount) || 0), 0),
          orders: detailOrders.length,
          visits: detailVisits.length,
          customers: detailCustomers.length,
          netMinutes: dailyRows.reduce((s, r) => s + r.net_minutes, 0),
          distanceMeters: dailyRows.reduce((s, r) => s + r.distance_meters, 0),
        }

        const detailEmp = employeeTreeRef.current.find((e) => e.id === selectedEmployee.employee_id)
        const detailEmpName = detailEmp?.full_name || selectedEmployee.full_name
        const detailManagerName = detailEmp?.manager_id
          ? employeeTreeRef.current.find((m) => m.id === detailEmp.manager_id)?.full_name
          : undefined
        const detailRoleLabel = getRoleLabel(selectedEmployee.employee_id, employeeTreeRef.current)

        const exportPdf = () => {
          const headers = ['التاريخ', 'البداية', 'النهاية', 'ساعات العمل', 'الزيارات', 'الطلبات', 'المبيعات', 'عملاء جدد', 'المسافة']
          const dataRows = dailyRows.map((r) => [
            fmtShortDate(r.date),
            r.start_time ? fmtTime(r.start_time) : '—',
            r.end_time ? fmtTime(r.end_time) : '—',
            fmtHours(r.net_minutes),
            r.visits, r.orders, Math.round(r.sales), r.new_customers, fmtDist(r.distance_meters),
          ])
          const kpis = [
            { label: 'إجمالي المبيعات', value: fmtMoney(kpi.sales) + ' ج.م', color: 'emerald' as const },
            { label: 'إجمالي الطلبات', value: fmtNum(kpi.orders), color: 'blue' as const },
            { label: 'إجمالي الزيارات', value: fmtNum(kpi.visits), color: 'amber' as const },
            { label: 'عملاء جدد', value: fmtNum(kpi.customers), color: 'violet' as const },
            { label: 'ساعات العمل', value: fmtHours(kpi.netMinutes) },
            { label: 'المسافة', value: fmtDist(kpi.distanceMeters) },
          ]
          exportToPdf({
            title: `كشف نشاط ${detailRoleLabel}`,
            subtitle: detailEmpName,
            identity: { roleLabel: detailRoleLabel, ownerName: detailEmpName, managerName: detailManagerName },
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
            sections: [
              { title: 'ملخص الشهر', content: kpiGridToHtml(kpis) },
              { title: 'كشف يومى', content: tableToHtml(headers, dataRows) },
            ],
          })
        }

        const exportExcel = () => {
          const cols: ExportColumn[] = [
            { key: 'date', label: 'التاريخ' },
            { key: 'start_time', label: 'البداية' },
            { key: 'end_time', label: 'النهاية' },
            { key: 'hours', label: 'ساعات العمل' },
            { key: 'visits', label: 'الزيارات' },
            { key: 'orders', label: 'الطلبات' },
            { key: 'sales', label: 'المبيعات', format: 'currency' },
            { key: 'new_customers', label: 'عملاء جدد' },
            { key: 'distance', label: 'المسافة' },
          ]
          const data = dailyRows.map((r) => ({
            date: fmtShortDate(r.date),
            start_time: r.start_time ? fmtTime(r.start_time) : '—',
            end_time: r.end_time ? fmtTime(r.end_time) : '—',
            hours: fmtHours(r.net_minutes),
            visits: r.visits,
            orders: r.orders,
            sales: r.sales,
            new_customers: r.new_customers,
            distance: fmtDist(r.distance_meters),
          }))
          exportToExcel({
            title: `كشف نشاط ${detailRoleLabel}`,
            subtitle: detailEmpName,
            identity: { roleLabel: detailRoleLabel, ownerName: detailEmpName, managerName: detailManagerName },
            columns: cols,
            data,
            fileName: `نشاط_${selectedEmployee.full_name}`,
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
          })
        }

        const loadDayData = async (date: string): Promise<DayDetailData> => {
          const tok = getToken()
          if (!tok) return { timeline: null, mapData: null }

          const [timelineRes, trackingRes] = await Promise.all([
            supabase.rpc('get_employee_day_timeline', {
              p_token: tok,
              p_employee_id: selectedEmployee.employee_id,
              p_date: date,
            }),
            supabase.rpc('get_employee_daily_tracking', {
              p_token: tok,
              p_employee_id: selectedEmployee.employee_id,
              p_date_from: date,
              p_date_to: date,
            }),
          ])

          let timeline = null
          if (timelineRes.data && !timelineRes.error) {
            const t = timelineRes.data as any
            timeline = {
              session: { start_time: t.session?.start_time ?? '', end_time: t.session?.end_time ?? null },
              events: (t.events ?? []).map((e: any) => ({
                time: e.time ?? '', type: e.type ?? '', title: e.title ?? '',
                description: e.description ?? '', latitude: e.latitude ?? null, longitude: e.longitude ?? null,
              })),
            }
          }

          let mapData = null
          if (trackingRes.data && !trackingRes.error) {
            const m = trackingRes.data as any
            mapData = {
              route: (m.route ?? []).map((r: any) => ({
                latitude: Number(r.latitude), longitude: Number(r.longitude),
                time: r.time ?? '', type: r.type ?? '',
              })),
              visit_locations: (m.visit_locations ?? []).map((v: any) => ({
                visit_id: v.visit_id ?? '', customer_id: v.customer_id ?? '',
                customer_name: v.customer_name ?? '', latitude: Number(v.latitude),
                longitude: Number(v.longitude), check_in_at: v.check_in_at ?? '',
                check_out_at: v.check_out_at ?? null, visit_result: v.visit_result ?? '',
              })),
              long_stops: (m.long_stops ?? []).map((s: any) => ({
                start_time: s.start_time ?? '', end_time: s.end_time ?? '',
                duration_minutes: Number(s.duration_minutes) || 0,
                latitude: Number(s.latitude), longitude: Number(s.longitude),
              })),
              total_distance_km: Number(m.total_distance_km) || 0,
              total_points: Number(m.total_points) || 0,
            }
          }

          return { timeline, mapData }
        }

        if (!cancelled) {
          setActivityVM({
            employee: {
              employee_id: selectedEmployee.employee_id,
              full_name: selectedEmployee.full_name,
              code: selectedEmployee.code,
            },
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
            kpi,
            dailyRows,
            detailData: { orders: detailOrders, customers: detailCustomers, visits: detailVisits },
            loadDayData,
            exportPdf,
            exportExcel,
          })
          setActivityLoading(false)
        }
      } catch (e: any) {
        if (!cancelled) { setActivityError(e.message); setActivityLoading(false) }
      }
    }

    build()
    return () => { cancelled = true }
  }, [view, selectedEmployee, filters.dateFrom, filters.dateTo])

useEffect(() => {
    // ONLY auto-transition for sales reps ('self' scope with effectiveEmployeeId)
    // EXPLICITLY BLOCKED for team and company scopes
    if (import.meta.env.DEV) console.log('[ActivityReportsPage] Auto-transition check:', { scope, isRepScope, loading, rowsLength: rows.length, view })
    if (scope !== 'self') return
    if (isRepScope && !loading && rows.length === 1 && view === 'list') {
      if (import.meta.env.DEV) console.log('[ActivityReportsPage] Auto-transition TRIGGERED for self scope')
      setSelectedEmployee(rows[0])
      setView('employee')
    }
  }, [scope, isRepScope, loading, rows, view])

  const totals = useMemo(() => {
    let sales = 0, orders = 0, completed_visits = 0, registered_customers = 0
    for (const r of rows) {
      sales += r.sales
      orders += r.orders
      completed_visits += r.completed_visits
      registered_customers += r.registered_customers
    }
    return { sales, orders, completed_visits, registered_customers }
  }, [rows])

  const kpiCards: KpiCardData[] = [
    { key: 'sales', label: 'إجمالي المبيعات', value: totals.sales, format: 'currency', icon: '💰', color: 'emerald' },
    { key: 'completed_visits', label: 'إجمالي الزيارات', value: totals.completed_visits, format: 'number', icon: '📍', color: 'amber' },
    { key: 'orders', label: 'إجمالي الطلبات', value: totals.orders, format: 'number', icon: '📦', color: 'blue' },
    { key: 'registered_customers', label: 'إجمالي العملاء الجدد', value: totals.registered_customers, format: 'number', icon: '👥', color: 'violet' },
  ]

  const identityEmp = filters.employeeId ? employeeTree.find((e) => e.id === filters.employeeId) : undefined
  const identityMgr = filters.managerId ? employeeTree.find((e) => e.id === filters.managerId) : undefined
  const identityEmployeeName = identityEmp?.full_name || (rows.length === 1 ? rows[0].full_name : undefined)
  const identityEmployeeCode = identityEmp?.code || (rows.length === 1 ? rows[0].code : undefined)
  const identity: IdentityData = computeIdentity('تقرير النشاط', filters, identityMgr?.full_name || selectedManagerName, identityEmployeeName, identityEmployeeCode)

  const title = (() => {
    if (identity.scope === 'company') return 'نشاط الشركة'
    if (identity.scope === 'manager' && filters.managerId) {
      const roleLabel = getRoleLabel(filters.managerId, employeeTree)
      return `نشاط ${roleLabel}`
    }
    if (identity.scope === 'employee' && filters.employeeId) {
      const roleLabel = getRoleLabel(filters.employeeId, employeeTree)
      return `نشاط ${roleLabel}`
    }
    return 'نشاط الشركة'
  })()

  function getToken(): string | null {
    try { return localStorage.getItem('session_token') } catch { return null }
  }

  async function handleKpiClick(kpiType: string, employeeId?: string) {
    const token = getToken()
    if (!token) return
    const recordType = kpiType === 'sales' ? 'orders' : kpiType === 'registered_customers' ? 'customers' : kpiType === 'completed_visits' ? 'visits' : kpiType === 'orders' ? 'orders' : kpiType

    setDd({ open: true, kpiType, title: '', records: [], loading: true, recordType })

    let allRecords: any[] = []

    if (employeeId) {
      const { data, error: err } = await supabase.rpc('get_employee_detail_data', {
        p_token: token,
        p_employee_id: employeeId,
        p_from: filters.dateFrom,
        p_to: filters.dateTo,
      })
      if (!err && data) allRecords = (data as any)?.[recordType] || []
    } else {
      const results = await Promise.all(
        rows.map(async (row) => {
          const { data } = await supabase.rpc('get_employee_detail_data', {
            p_token: token,
            p_employee_id: row.employee_id,
            p_from: filters.dateFrom,
            p_to: filters.dateTo,
          })
          return (data as any)?.[recordType] || []
        })
      )
      allRecords = results.flat()
    }

    setDd((prev) => ({
      ...prev,
      title: kpiType === 'sales' || kpiType === 'orders' ? 'الطلبات'
        : kpiType === 'completed_visits' ? 'الزيارات'
        : kpiType === 'registered_customers' ? 'العملاء الجدد'
        : kpiType,
      records: allRecords,
      loading: false,
    }))
  }

  function handleRecordClick(entityType: EntityType, entityId?: string) {
    const path = RECORD_ROUTES[entityType]
    if (path && entityId) nav(`${path}${entityId}`)
  }

  function handleEmployeeClick(emp: TeamMemberRow) {
    if (import.meta.env.DEV) console.log('[ActivityReportsPage] handleEmployeeClick:', emp.employee_id, emp.full_name)
    setSelectedEmployee(emp)
    setView('employee')
  }

  function handleBackToList() {
    if (scope === 'self') {
      nav(-1)
    } else {
      setView('list')
      setSelectedEmployee(null)
    }
  }

  const handleExportExcel = useCallback(() => {
    const cols: ExportColumn[] = [
      { key: 'full_name', label: 'المندوب' },
      { key: 'sales', label: 'المبيعات', format: 'currency' },
      { key: 'orders', label: 'الطلبات', format: 'number' },
      { key: 'completed_visits', label: 'الزيارات', format: 'number' },
      { key: 'registered_customers', label: 'عملاء جدد', format: 'number' },
    ]
    const listIdentity: { roleLabel?: string; ownerName?: string; managerName?: string } = {}
    if (identity.scope === 'employee' && identity.employeeName) {
      listIdentity.roleLabel = identity.scope === 'employee' ? getRoleLabel(filters.employeeId || '', employeeTree) : undefined
      listIdentity.ownerName = identity.employeeName
      if (identity.managerName) listIdentity.managerName = identity.managerName
    } else if (identity.scope === 'manager' && identity.managerName) {
      listIdentity.roleLabel = getRoleLabel(filters.managerId || '', employeeTree)
      listIdentity.ownerName = identity.managerName
    }
    exportToExcel({
      title,
      subtitle: title,
      identity: listIdentity.roleLabel ? listIdentity : undefined,
      columns: cols,
      data: rows.map((r) => ({ ...r, manager: r.manager_name })),
      fileName: 'تقرير_النشاط',
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    })
  }, [title, rows, filters, identity, employeeTree])

  const handleExportPdf = useCallback(() => {
    const headers = ['المندوب', 'المبيعات', 'الطلبات', 'الزيارات', 'عملاء جدد']
    const dataRows = rows.map((r) => [
      r.full_name,
      r.sales, r.orders, r.completed_visits, r.registered_customers,
    ])
    const kpis = kpiCards.map((k) => ({
      label: k.label,
      value: k.format === 'currency'
        ? Math.round(k.value ?? 0).toLocaleString('ar-EG-u-nu-latn') + ' ج.م'
        : (k.value ?? 0).toLocaleString('ar-EG-u-nu-latn'),
      color: k.color,
    }))
    const listIdentity: { roleLabel?: string; ownerName?: string; managerName?: string } = {}
    if (identity.scope === 'employee' && identity.employeeName) {
      listIdentity.roleLabel = getRoleLabel(filters.employeeId || '', employeeTree)
      listIdentity.ownerName = identity.employeeName
      if (identity.managerName) listIdentity.managerName = identity.managerName
    } else if (identity.scope === 'manager' && identity.managerName) {
      listIdentity.roleLabel = getRoleLabel(filters.managerId || '', employeeTree)
      listIdentity.ownerName = identity.managerName
    }
    exportToPdf({
      title,
      subtitle: title,
      identity: listIdentity.roleLabel ? listIdentity : undefined,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      sections: [
        { title: 'ملخص النشاط', content: kpiGridToHtml(kpis) },
        { title: 'تفاصيل المناديب', content: tableToHtml(headers, dataRows) },
      ],
    })
  }, [title, rows, kpiCards, filters, identity, employeeTree])

  if (view === 'employee' && selectedEmployee) {
    if (activityVM) {
      const detailTreeEmp = employeeTree.find((e) => e.id === selectedEmployee.employee_id)
      const detailRoleLabel = getRoleLabel(selectedEmployee.employee_id, employeeTree)
      const detailEmpName = detailTreeEmp?.full_name || selectedEmployee.full_name
      return (
        <EmployeeActivitySummary
          key={selectedEmployee.employee_id}
          viewModel={{
            ...activityVM,
            employee: { ...activityVM.employee, full_name: detailEmpName },
          }}
          onBack={handleBackToList}
          roleLabel={`نشاط ${detailRoleLabel}`}
          onPeriodChange={(preset, customFrom, customTo) => {
            const { dateFrom, dateTo } = computeDateRange(preset, customFrom, customTo)
            setFilters((prev) => ({ ...prev, dateFrom, dateTo, preset }))
          }}
        />
      )
    }
    return (
      <div className="space-y-4" dir="rtl">
        <div className="flex items-center gap-3">
          <button onClick={handleBackToList} className="text-text-secondary text-lg">&larr;</button>
          {(() => {
            const detailTreeEmp = employeeTree.find((e) => e.id === selectedEmployee.employee_id)
            const detailRoleLabel = getRoleLabel(selectedEmployee.employee_id, employeeTree)
            const detailEmpName = detailTreeEmp?.full_name || selectedEmployee.full_name
            return (
              <div>
                <h1 className="text-lg font-bold text-text">نشاط {detailRoleLabel}</h1>
                <div className="text-sm font-semibold text-text-secondary">{detailEmpName}</div>
              </div>
            )
          })()}
        </div>
        {activityError ? (
          <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger">{activityError}</div>
        ) : (
          <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={() => nav(-1)} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">{title}</h1>
      </div>

      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        <UnifiedFilterBar
          value={filters}
          onChange={setFilters}
          showMonthSelector
          showDateRange
          showManagerFilter={scope === 'company'}
          showEmployeeFilter={scope !== 'self'}
          managerOptions={managerOptions}
          employeeOptions={employeeOptions}
        />
      </div>

      <ReportIdentity identity={{ ...identity, title }} />

      <div className="flex gap-2">
        {!loading && rows.length > 0 && (
          <>
            <button onClick={handleExportExcel}
              className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold">Excel</button>
            <button onClick={handleExportPdf}
              className="bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg font-semibold">PDF</button>
          </>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : error ? (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger">{error}</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد بيانات</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {kpiCards.map((kpi) => (
              <button
                key={kpi.key}
                onClick={() => handleKpiClick(kpi.key)}
                className={`rounded-xl p-3 sm:p-4 text-center border shadow-sm overflow-hidden cursor-pointer transition-all hover:scale-[1.02] hover:shadow-md ${
                  kpi.color === 'emerald' ? 'bg-gradient-to-br from-emerald-50 to-green-100/60 border-emerald-200/50' :
                  kpi.color === 'amber' ? 'bg-gradient-to-br from-amber-50 to-yellow-100/60 border-amber-200/50' :
                  kpi.color === 'blue' ? 'bg-gradient-to-br from-blue-50 to-indigo-100/60 border-blue-200/50' :
                  'bg-gradient-to-br from-violet-50 to-purple-100/60 border-violet-200/50'
                }`}
              >
                <div className="text-xl sm:text-2xl mb-1">{kpi.icon}</div>
                <div className={`font-bold whitespace-nowrap ${
                  kpi.value != null && kpi.value >= 10000000 ? 'text-base sm:text-lg'
                  : kpi.value != null && kpi.value >= 100000 ? 'text-lg sm:text-xl'
                  : 'text-xl sm:text-2xl'
                } ${
                  kpi.color === 'emerald' ? 'text-success' :
                  kpi.color === 'amber' ? 'text-warning' :
                  kpi.color === 'blue' ? 'text-primary' :
                  'text-accent'
                }`}>
                  {kpi.value != null ? Math.round(kpi.value).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 }) : '0'}
                </div>
                <div className="text-[11px] text-text-secondary mt-1 font-medium">{kpi.label}</div>
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {sortedRows.map((row) => (
              <div key={row.employee_id}
                className="bg-white rounded-xl border border-border shadow-sm overflow-hidden transition-all hover:shadow-md hover:border-primary/30"
              >
                <div
                  className="px-4 pt-3 pb-2 cursor-pointer hover:bg-primary/5 transition-colors"
                  onClick={() => handleEmployeeClick(row)}
                >
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                      {row.full_name?.charAt(0) || row.code?.charAt(0) || '?'}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-text">{row.full_name && row.full_name !== 'employee_not_found' ? row.full_name : row.code}</div>
                      <div className="text-[10px] text-text-secondary">{getRoleLabel(row.employee_id, employeeTree)}</div>
                    </div>
                    <div className="mr-auto text-[10px] text-text-secondary">اضغط لعرض التفاصيل</div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-px bg-border/30">
                  {([
                    { key: 'sales', label: 'المبيعات', value: row.sales, color: 'text-success' },
                    { key: 'orders', label: 'الطلبات', value: row.orders, color: 'text-primary' },
                    { key: 'completed_visits', label: 'الزيارات', value: row.completed_visits, color: 'text-warning' },
                    { key: 'registered_customers', label: 'عملاء جدد', value: row.registered_customers, color: 'text-accent' },
                  ] as const).map((kpi) => (
                    <button
                      key={kpi.key}
                      onClick={(e) => { e.stopPropagation(); handleKpiClick(kpi.key, row.employee_id) }}
                      className={`bg-white py-2.5 px-2 text-center hover:bg-surface/80 transition-colors cursor-pointer`}
                    >
                      <div className={`text-sm font-bold ${kpi.color}`}>
                        {Math.round(kpi.value).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 })}
                      </div>
                      <div className="text-[10px] text-text-secondary mt-0.5">{kpi.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <KpiDrillDownModal
        open={dd.open}
        title={dd.title}
        recordType={dd.recordType}
        records={dd.records}
        loading={dd.loading}
        onClose={() => setDd((prev) => ({ ...prev, open: false }))}
        onRecordClick={handleRecordClick}
      />
    </div>
  )
}
