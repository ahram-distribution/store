import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { targetService } from '../../services/targets'
import { attendanceService } from '../../services/attendance'
import * as XLSX from 'xlsx'

const MONTHS = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

type PeriodType = 'today' | 'week' | 'month' | 'custom'

interface HKpiValue { target: number; actual: number; pct: number | null }
interface HKpis { sales: HKpiValue; visits: HKpiValue; orders: HKpiValue; new_customers: HKpiValue; collections: HKpiValue; attendance: HKpiValue }
interface HMember { employee_id: string; employee_code: string; employee_name: string; is_manager: boolean; has_target: boolean; has_activity: boolean; is_locked: boolean | null; overall_achievement_score: number | null; weights: Record<string, number>; kpis: HKpis }
interface HTeamSummary { team_target: Record<string, number>; team_actual: Record<string, number>; team_achievement_pct: Record<string, number | null>; team_overall_pct: number; team_member_count: number }
interface HManager { manager_id: string; manager_code: string; manager_name: string; own_overall_score: number | null; own_kpis: HKpis; team_summary: HTeamSummary; members: HMember[] }
interface HData { manager_count: number; managers: HManager[]; unassigned_count: number; unassigned: HMember[] }
interface EPerf { employee_id: string; employee_code: string; employee_name: string; manager_id: string | null; manager_name: string | null; sales_target: number; visits_target: number; orders_target: number; new_customers_target: number; gross_sales: number; visits_actual: number; gross_orders: number; new_customers_actual: number; effective_sales: number; effective_orders: number; return_deduction: number; full_returns: number; sales_achievement_pct: number | null; visits_achievement_pct: number | null; orders_achievement_pct: number | null; new_customers_achievement_pct: number | null; overall_achievement_score: number | null; has_target: boolean; has_activity: boolean; sales_weight_percent: number; visits_weight_percent: number; orders_weight_percent: number; new_customers_weight_percent: number }
interface CInfo { sales_target: number; visits_target: number; orders_target: number; new_customers_target: number; sales_actual: number; visits_actual: number; orders_actual: number; new_customers_actual: number; overall_achievement_pct: number }
interface PData { has_target: boolean; company: CInfo | null; employees: EPerf[]; best_employee: EPerf | null; weakest_employee: EPerf | null; hierarchy?: HData | null }

interface SSession {
  date: string; start_time: string; end_time: string | null
  net_minutes: number; break_minutes: number; break_count: number
  visit_count: number | null; order_count: number; sales_value: number
  collection_count: number; collection_amount: number; new_customer_count: number
  attendance_status: string | null; late_minutes: number | null; distance_meters: number; tracking_points_count: number
}

interface SSummary {
  total_days: number; total_net_minutes: number; avg_net_minutes: number
  total_orders: number; total_sales_value: number; total_collection_count: number
  total_collection_amount: number; total_new_customers: number; total_visits: number
  total_distance_meters: number; total_tracking_points: number
  late_count: number; ontime_count: number; early_departure_count: number
}

interface SWEmployee { employee_id: string; employee_name: string; employee_code: string; summary: SSummary; sessions: SSession[] }
interface SWTotals { total_employees: number; total_visits: number; total_orders: number; total_sales: number; total_collection_amount: number; total_new_customers: number; total_net_minutes: number }
interface LWEmployee { employee_id: string; name: string; started_at?: string; ended_at?: string; duration_minutes?: number; net_minutes?: number; break_minutes?: number; break_count?: number; visit_count: number; order_count: number; sales_value: number; collection_count: number; collection_amount: number; new_customer_count: number; latitude?: number; longitude?: number; last_seen_at?: string; status: string; attendance_status?: string | null; late_minutes?: number; target_pct?: number | null }
interface SWSEmployee { employee_id: string; name: string; ended_at?: string; duration_minutes?: number; net_minutes?: number; visit_count?: number; order_count?: number; sales_value?: number; collection_count?: number; collection_amount?: number; new_customer_count?: number; break_minutes?: number; attendance_status?: string | null; late_minutes?: number }

interface TLEvent { time: string; type: string; title: string; description: string; latitude?: string | null; longitude?: string | null }
interface TLData { employee: { full_name: string; code: string }; session: { start_time: string; end_time?: string | null }; events: TLEvent[] }

interface RepRow {
  employee_id: string; employee_name: string; employee_code: string; manager_id: string | null
  start_time: string | null; end_time: string | null; net_minutes: number; break_minutes: number
  tracking_points: number; distance_meters: number; visit_count: number; order_count: number
  sales_value: number; collection_count: number; collection_amount: number; new_customer_count: number
  late_minutes: number | null; attendance_status: string | null; day_count: number
  sales_target: number; orders_target: number; visits_target: number; customers_target: number
  sales_pct: number | null; orders_pct: number | null; visits_pct: number | null; customers_pct: number | null
  overall_score: number | null; has_target: boolean; has_activity: boolean
}

const ALL_COLUMNS = [
  { key: 'employee_name', label: 'المندوب', numeric: false, group: 'info' },
  { key: 'employee_code', label: 'الكود', numeric: false, group: 'info' },
  { key: 'start_time', label: 'بداية اليوم', numeric: false, group: 'activity' },
  { key: 'end_time', label: 'نهاية اليوم', numeric: false, group: 'activity' },
  { key: 'net_minutes', label: 'صافي ساعات', numeric: true, group: 'activity' },
  { key: 'break_minutes', label: 'الاستراحة', numeric: true, group: 'activity' },
  { key: 'tracking_points', label: 'نقاط التتبع', numeric: true, group: 'activity' },
  { key: 'distance_meters', label: 'المسافة', numeric: true, group: 'activity' },
  { key: 'visit_count', label: 'الزيارات', numeric: true, group: 'activity' },
  { key: 'order_count', label: 'الطلبات', numeric: true, group: 'activity' },
  { key: 'sales_value', label: 'المبيعات', numeric: true, group: 'activity' },
  { key: 'collection_amount', label: 'التحصيل', numeric: true, group: 'activity' },
  { key: 'new_customer_count', label: 'عملاء جدد', numeric: true, group: 'activity' },
  { key: 'sales_target', label: 'هدف مبيعات', numeric: true, group: 'achievement' },
  { key: 'overall_score', label: 'الإنجاز%', numeric: true, group: 'achievement' },
]

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '\u2014'
  return n.toFixed(1) + '%'
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || n === 0) return '\u2014'
  return Math.round(n).toLocaleString('ar-EG-u-nu-latn')
}

function fmtHours(minutes: number | null | undefined): string {
  if (minutes == null) return '\u2014'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return `${h}:${String(m).padStart(2, '0')}`
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '\u2014'
  try { return new Date(iso).toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }) }
  catch { return '\u2014' }
}

function fmtDist(meters: number | null | undefined): string {
  if (meters == null) return '\u2014'
  if (meters >= 1000) return (meters / 1000).toFixed(1) + ' كم'
  return Math.round(meters) + ' م'
}

function getAchievementClass(score: number | null | undefined): string {
  if (score == null) return ''
  if (score >= 80) return 'row-high'
  if (score >= 50) return 'row-mid'
  return 'row-low'
}

function getDateRange(period: PeriodType): { from: string; to: string } {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth(); const d = now.getDate()
  switch (period) {
    case 'today': return { from: new Date(y, m, d).toISOString().slice(0, 10), to: new Date(y, m, d + 1).toISOString().slice(0, 10) }
    case 'week': { const dow = now.getDay(); const sun = new Date(y, m, d - dow); const sat = new Date(y, m, d + (6 - dow)); return { from: sun.toISOString().slice(0, 10), to: new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + 1).toISOString().slice(0, 10) } }
    case 'month': return { from: new Date(y, m, 1).toISOString().slice(0, 10), to: new Date(y, m + 1, 1).toISOString().slice(0, 10) }
    default: return { from: '', to: '' }
  }
}

function getMonthYear(from: string): { month: number; year: number } {
  const d = new Date(from || Date.now())
  return { month: d.getMonth() + 1, year: d.getFullYear() }
}

export default function ManagerReportsPage() {
  const nav = useNavigate()
  const tableRef = useRef<HTMLDivElement>(null)

  const [period, setPeriod] = useState<PeriodType>('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedManagerId, setSelectedManagerId] = useState<string | null>(null)
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null)
  const [perfData, setPerfData] = useState<PData | null>(null)
  const [workdayEmps, setWorkdayEmps] = useState<SWEmployee[]>([])
  const [workdayTotals, setWorkdayTotals] = useState<SWTotals | null>(null)
  const [liveEmps, setLiveEmps] = useState<LWEmployee[]>([])
  const [endedEmps, setEndedEmps] = useState<SWSEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState('sales_value')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [visibleCols, setVisibleCols] = useState<Set<string>>(new Set(ALL_COLUMNS.map((c) => c.key)))
  const [showColMenu, setShowColMenu] = useState(false)
  const [repSessions, setRepSessions] = useState<SSession[]>([])
  const [repTimeline, setRepTimeline] = useState<TLData | null>(null)
  const [repLoading, setRepLoading] = useState(false)

  const range = getDateRange(period)
  const effectiveFrom = period === 'custom' ? dateFrom : range.from
  const effectiveTo = period === 'custom' ? dateTo : range.to
  const { month: perfMonth, year: perfYear } = getMonthYear(effectiveTo || effectiveFrom || new Date().toISOString())
  const fromParam = effectiveFrom ? new Date(effectiveFrom).toISOString() : ''
  const toParam = effectiveTo ? new Date(effectiveTo).toISOString() : ''

  useEffect(() => {
    if (period !== 'custom') {
      const r = getDateRange(period)
      setDateFrom(r.from); setDateTo(r.to)
    }
  }, [period])

  useEffect(() => {
    setLoading(true); setError(null); setSelectedRepId(null)
    setWorkdayEmps([]); setWorkdayTotals(null); setLiveEmps([]); setEndedEmps([])
    const promises: Promise<any>[] = [targetService.getPerformance(perfMonth, perfYear)]
    const isToday = period === 'today'
    if (isToday) {
      promises.push(supabase.rpc('get_live_workday_overview', { p_token: localStorage.getItem('session_token') }))
    } else if (fromParam && toParam) {
      promises.push(attendanceService.getCompletedWorkdaysHistory({ p_from: fromParam, p_to: toParam, p_per_page: 1000 }))
    }
    Promise.all(promises).then(([perf, extra]) => {
      if (perf.error) { setError(perf.error.message); return }
      setPerfData(perf.data as unknown as PData)
      if (extra) {
        if (isToday) { const ov = extra.data as any; if (ov && typeof ov === 'object') { setLiveEmps(Array.isArray(ov.employees) ? ov.employees : []); setEndedEmps(Array.isArray(ov.ended_employees) ? ov.ended_employees : []) } }
        else { const wh = extra as any; if (wh?.employees) { setWorkdayEmps(wh.employees as SWEmployee[]); if (wh.totals) setWorkdayTotals(wh.totals as SWTotals) } }
      }
    }).catch((e) => setError(e.message || 'خطأ في تحميل البيانات')).finally(() => setLoading(false))
  }, [perfMonth, perfYear, period, fromParam, toParam])

  useEffect(() => {
    if (!selectedRepId || !fromParam || !toParam) { setRepSessions([]); setRepTimeline(null); return }
    setRepLoading(true)
    const token = localStorage.getItem('session_token')
    Promise.all([
      supabase.rpc('get_employee_workday_history', { p_token: token, p_employee_id: selectedRepId, p_from: fromParam, p_to: toParam }),
      supabase.rpc('get_employee_day_timeline', { p_token: token, p_employee_id: selectedRepId, p_date: effectiveFrom || null }),
    ]).then(([hist, tl]) => {
      const h = hist.data as any
      if (h?.sessions) setRepSessions(h.sessions as SSession[])
      const t = tl.data as any
      if (t && typeof t === 'object' && !('error' in t)) setRepTimeline(t as TLData)
    }).finally(() => setRepLoading(false))
  }, [selectedRepId, fromParam, toParam, effectiveFrom])

  const isToday = period === 'today'

  const allManagers = useMemo(() => {
    if (!perfData?.hierarchy?.managers) return []
    return perfData.hierarchy.managers.map((m) => ({
      manager_id: m.manager_id, manager_name: m.manager_name, manager_code: m.manager_code || '',
      member_count: m.team_summary.team_member_count,
      team_sales: (m.team_summary.team_actual as any)?.sales ?? 0,
      team_orders: (m.team_summary.team_actual as any)?.orders ?? 0,
      team_visits: (m.team_summary.team_actual as any)?.visits ?? 0,
      team_customers: (m.team_summary.team_actual as any)?.new_customers ?? 0,
      team_achievement_pct: m.team_summary.team_overall_pct ?? null,
    }))
  }, [perfData])

  const teamMembers = useMemo(() => {
    if (!perfData?.hierarchy?.managers || !selectedManagerId) return []
    return perfData.hierarchy.managers.find((m) => m.manager_id === selectedManagerId)?.members || []
  }, [perfData, selectedManagerId])

  const selectedManager = useMemo(() => {
    if (!selectedManagerId || !perfData?.hierarchy?.managers) return null
    return perfData.hierarchy.managers.find((m) => m.manager_id === selectedManagerId) || null
  }, [selectedManagerId, perfData])

  const repRows = useMemo<RepRow[]>(() => {
    if (!selectedManagerId) return []
    const members = teamMembers
    if (!members.length) return []
    const ehMap = new Map<string, SWEmployee>(); workdayEmps.forEach((e) => ehMap.set(e.employee_id, e))
    const lhMap = new Map<string, LWEmployee>(); liveEmps.forEach((e) => lhMap.set(e.employee_id, e))
    const endedMap = new Map<string, SWSEmployee>(); endedEmps.forEach((e) => endedMap.set(e.employee_id, e))
    const perfMap = new Map<string, EPerf>(); if (perfData?.employees) perfData.employees.forEach((e) => perfMap.set(e.employee_id, e))
    return members.map((m) => {
      const perf = perfMap.get(m.employee_id); const k = m.kpis
      if (isToday) {
        const lw = lhMap.get(m.employee_id); const ended = endedMap.get(m.employee_id); const src = ended || lw
        return {
          employee_id: m.employee_id, employee_name: m.employee_name, employee_code: m.employee_code, manager_id: selectedManagerId,
          start_time: lw?.started_at ?? null, end_time: ended?.ended_at ?? null,
          net_minutes: src?.net_minutes ?? (src?.duration_minutes ?? 0), break_minutes: src?.break_minutes ?? 0,
          tracking_points: 0, distance_meters: 0,
          visit_count: src?.visit_count ?? 0, order_count: src?.order_count ?? 0, sales_value: src?.sales_value ?? 0,
          collection_count: src?.collection_count ?? 0, collection_amount: src?.collection_amount ?? 0, new_customer_count: src?.new_customer_count ?? 0,
          late_minutes: src?.late_minutes ?? null, attendance_status: src?.attendance_status ?? null, day_count: 1,
          sales_target: perf?.sales_target ?? k?.sales?.target ?? 0, orders_target: perf?.orders_target ?? k?.orders?.target ?? 0,
          visits_target: perf?.visits_target ?? k?.visits?.target ?? 0, customers_target: perf?.new_customers_target ?? k?.new_customers?.target ?? 0,
          sales_pct: perf?.sales_achievement_pct ?? k?.sales?.pct ?? null, orders_pct: perf?.orders_achievement_pct ?? k?.orders?.pct ?? null,
          visits_pct: perf?.visits_achievement_pct ?? k?.visits?.pct ?? null, customers_pct: perf?.new_customers_achievement_pct ?? k?.new_customers?.pct ?? null,
          overall_score: m.overall_achievement_score, has_target: m.has_target, has_activity: m.has_activity,
        }
      }
      const wh = ehMap.get(m.employee_id); const s = wh?.summary
      return {
        employee_id: m.employee_id, employee_name: m.employee_name, employee_code: m.employee_code, manager_id: selectedManagerId,
        start_time: wh?.sessions?.[0]?.start_time ?? null, end_time: wh?.sessions?.[wh.sessions.length - 1]?.end_time ?? null,
        net_minutes: s?.total_net_minutes ?? 0, break_minutes: wh?.sessions?.reduce((sum, sess) => sum + (sess.break_minutes || 0), 0) ?? 0,
        tracking_points: s?.total_tracking_points ?? 0, distance_meters: s?.total_distance_meters ?? 0,
        visit_count: s?.total_visits ?? 0, order_count: s?.total_orders ?? 0, sales_value: s?.total_sales_value ?? 0,
        collection_count: s?.total_collection_count ?? 0, collection_amount: s?.total_collection_amount ?? 0, new_customer_count: s?.total_new_customers ?? 0,
        late_minutes: null, attendance_status: null, day_count: s?.total_days ?? 0,
        sales_target: perf?.sales_target ?? k?.sales?.target ?? 0, orders_target: perf?.orders_target ?? k?.orders?.target ?? 0,
        visits_target: perf?.visits_target ?? k?.visits?.target ?? 0, customers_target: perf?.new_customers_target ?? k?.new_customers?.target ?? 0,
        sales_pct: perf?.sales_achievement_pct ?? k?.sales?.pct ?? null, orders_pct: perf?.orders_achievement_pct ?? k?.orders?.pct ?? null,
        visits_pct: perf?.visits_achievement_pct ?? k?.visits?.pct ?? null, customers_pct: perf?.new_customers_achievement_pct ?? k?.new_customers?.pct ?? null,
        overall_score: m.overall_achievement_score, has_target: m.has_target, has_activity: m.has_activity,
      }
    })
  }, [teamMembers, workdayEmps, liveEmps, endedEmps, perfData, selectedManagerId, isToday])

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) setSortDir((p) => (p === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }, [sortKey])

  const filteredRows = useMemo(() => {
    let rows = repRows
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      rows = rows.filter((r) => r.employee_name.toLowerCase().includes(q) || r.employee_code.toLowerCase().includes(q))
    }
    return [...rows].sort((a, b) => {
      const aV = (a as any)[sortKey]; const bV = (b as any)[sortKey]
      if (aV == null) return 1; if (bV == null) return -1
      const cmp = typeof aV === 'number' ? aV - bV : String(aV).localeCompare(String(bV))
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [repRows, searchQuery, sortKey, sortDir])

  const totalsRow = useMemo(() => {
    if (!filteredRows.length) return null
    return {
      net_minutes: filteredRows.reduce((s, r) => s + r.net_minutes, 0),
      break_minutes: filteredRows.reduce((s, r) => s + r.break_minutes, 0),
      tracking_points: filteredRows.reduce((s, r) => s + r.tracking_points, 0),
      distance_meters: filteredRows.reduce((s, r) => s + r.distance_meters, 0),
      visit_count: filteredRows.reduce((s, r) => s + r.visit_count, 0),
      order_count: filteredRows.reduce((s, r) => s + r.order_count, 0),
      sales_value: filteredRows.reduce((s, r) => s + r.sales_value, 0),
      collection_amount: filteredRows.reduce((s, r) => s + r.collection_amount, 0),
      new_customer_count: filteredRows.reduce((s, r) => s + r.new_customer_count, 0),
    }
  }, [filteredRows])

  const avgAchievement = useMemo(() => {
    if (!selectedManager?.members.length) return null
    const scores = selectedManager.members.map((m) => m.overall_achievement_score).filter((s) => s != null) as number[]
    if (!scores.length) return null
    return scores.reduce((a, b) => a + b, 0) / scores.length
  }, [selectedManager])

  const bestMember = useMemo(() => {
    if (!selectedManager?.members.length) return null
    return selectedManager.members.reduce((best, m) => {
      if (!best) return m; if (m.overall_achievement_score == null) return best; if (best.overall_achievement_score == null) return m
      return m.overall_achievement_score > best.overall_achievement_score ? m : best
    }, null as HMember | null)
  }, [selectedManager])

  const worstMember = useMemo(() => {
    if (!selectedManager?.members.length) return null
    return selectedManager.members.reduce((worst, m) => {
      if (!worst) return m; if (m.overall_achievement_score == null) return worst; if (worst.overall_achievement_score == null) return m
      return m.overall_achievement_score < worst.overall_achievement_score ? m : worst
    }, null as HMember | null)
  }, [selectedManager])

  const activeRepCount = useMemo(() => {
    if (!selectedManagerId) return 0
    const activeIds = new Set(isToday ? liveEmps.map((e) => e.employee_id) : workdayEmps.map((e) => e.employee_id))
    return teamMembers.filter((m) => activeIds.has(m.employee_id)).length
  }, [selectedManagerId, teamMembers, liveEmps, workdayEmps, isToday])

  function toggleCol(key: string) {
    const next = new Set(visibleCols)
    if (next.has(key) && next.size > 2) next.delete(key)
    else next.add(key)
    setVisibleCols(next)
  }

  function visibleColsArr() {
    return ALL_COLUMNS.filter((c) => visibleCols.has(c.key))
  }

  function fmtCellVal(colKey: string, row: RepRow): string {
    switch (colKey) {
      case 'start_time': return fmtTime(row.start_time); case 'end_time': return fmtTime(row.end_time)
      case 'net_minutes': return fmtHours(row.net_minutes); case 'break_minutes': return fmtHours(row.break_minutes)
      case 'tracking_points': return fmtNum(row.tracking_points); case 'distance_meters': return fmtDist(row.distance_meters)
      case 'visit_count': return fmtNum(row.visit_count); case 'order_count': return fmtNum(row.order_count)
      case 'sales_value': return fmtMoney(row.sales_value); case 'collection_amount': return fmtMoney(row.collection_amount)
      case 'new_customer_count': return fmtNum(row.new_customer_count); case 'sales_target': return fmtMoney(row.sales_target)
      case 'overall_score': return fmtPct(row.overall_score)
      default: return ''
    }
  }

  function fmtCellNum(colKey: string, val: number): string {
    switch (colKey) {
      case 'net_minutes': return fmtHours(val); case 'break_minutes': return fmtHours(val)
      case 'tracking_points': return fmtNum(val); case 'distance_meters': return fmtDist(val)
      case 'visit_count': return fmtNum(val); case 'order_count': return fmtNum(val)
      case 'sales_value': return fmtMoney(val); case 'collection_amount': return fmtMoney(val)
      case 'new_customer_count': return fmtNum(val); case 'sales_target': return fmtMoney(val)
      case 'overall_score': return fmtPct(val)
      default: return ''
    }
  }

  function getRepAchievement(repId: string): number | null {
    const member = teamMembers.find((m) => m.employee_id === repId)
    return member?.overall_achievement_score ?? null
  }

  function getPctColor(pct: number | null | undefined): string {
    if (pct == null) return 'text-text'
    if (pct >= 100) return 'text-green-600'
    if (pct >= 50) return 'text-yellow-600'
    return 'text-red-500'
  }

  const style = document.createElement('style')
  style.textContent = `
    .sticky-col-first { position: sticky; right: 0; z-index: 3; background: inherit; }
    .sticky-col-first::after { content: ''; position: absolute; left: -1px; top: 0; bottom: 0; width: 1px; background: #e5e7eb; }
    .sticky-header { position: sticky; top: 0; z-index: 5; }
    .sticky-header.sticky-col-first { z-index: 6; }
    .row-high { background-color: rgba(34, 197, 94, 0.06) !important; }
    .row-mid { background-color: rgba(234, 179, 8, 0.06) !important; }
    .row-low { background-color: rgba(239, 68, 68, 0.06) !important; }
    .row-high:hover { background-color: rgba(34, 197, 94, 0.12) !important; }
    .row-mid:hover { background-color: rgba(234, 179, 8, 0.12) !important; }
    .row-low:hover { background-color: rgba(239, 68, 68, 0.12) !important; }
    .rep-table-wrap { overflow: auto; max-height: 550px; position: relative; }
    .rep-table-wrap table { border-collapse: separate; border-spacing: 0; min-width: 100%; }
    .rep-table-wrap th, .rep-table-wrap td { border-bottom: 1px solid #e5e7eb; }
    .rep-table-wrap thead th { box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
  `
  if (!document.getElementById('rep-table-style')) { style.id = 'rep-table-style'; document.head.appendChild(style) }

  const cols = visibleColsArr()
  const showDetailCol = true

  const EVENT_LABELS: Record<string, string> = {
    workday_start: 'بداية اليوم', workday_end: 'نهاية اليوم', break_start: 'بداية استراحة', break_end: 'نهاية استراحة',
    visit_start: 'بداية زيارة', visit_end: 'نهاية زيارة', order_created: 'إنشاء طلب', collection_taken: 'تحصيل', new_customer: 'عميل جديد',
  }

  function exportToExcel() {
    const token = localStorage.getItem('session_token')
    const titleRow = selectedManager ? [`مدير البيع: ${selectedManager.manager_name}`] : ['تقرير المبيعات']
    const periodLabel = effectiveFrom && effectiveTo
      ? `من ${effectiveFrom.slice(0, 10)} إلى ${effectiveTo.slice(0, 10)}`
      : `${MONTHS[perfMonth - 1]} ${perfYear}`
    const now = new Date()
    const dateStr = now.toLocaleDateString('ar-EG-u-nu-latn') + ' ' + now.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })

    const headers = ['المندوب', 'الكود', 'بداية اليوم', 'نهاية اليوم', 'صافي ساعات', 'الاستراحة', 'نقاط التتبع', 'المسافة', 'الزيارات', 'الطلبات', 'المبيعات', 'التحصيل', 'عملاء جدد', 'هدف مبيعات', 'هدف زيارات', 'هدف طلبات', 'هدف عملاء', '% مبيعات', '% زيارات', '% طلبات', '% عملاء', '% إنجاز', 'أيام']

    const dataRows = filteredRows.map((r) => [
      r.employee_name, r.employee_code, r.start_time || '', r.end_time || '', r.net_minutes / 60, r.break_minutes / 60,
      r.tracking_points, r.distance_meters, r.visit_count, r.order_count, r.sales_value, r.collection_amount, r.new_customer_count,
      r.sales_target, r.visits_target, r.orders_target, r.customers_target,
      r.sales_pct != null ? r.sales_pct / 100 : '', r.visits_pct != null ? r.visits_pct / 100 : '',
      r.orders_pct != null ? r.orders_pct / 100 : '', r.customers_pct != null ? r.customers_pct / 100 : '',
      r.overall_score != null ? r.overall_score / 100 : '', r.day_count,
    ])

    if (totalsRow) {
      dataRows.push([
        'الإجمالي', '', '', '', totalsRow.net_minutes / 60, totalsRow.break_minutes / 60,
        totalsRow.tracking_points, totalsRow.distance_meters, totalsRow.visit_count, totalsRow.order_count,
        totalsRow.sales_value, totalsRow.collection_amount, totalsRow.new_customer_count,
        '', '', '', '', '', '', '', '', '', '',
      ])
    }

    const ws = XLSX.utils.aoa_to_sheet([])

    XLSX.utils.sheet_add_aoa(ws, [[titleRow[0]]], { origin: 'A1' })
    XLSX.utils.sheet_add_aoa(ws, [[`الفترة: ${periodLabel}`]], { origin: 'A2' })
    XLSX.utils.sheet_add_aoa(ws, [[`تاريخ التقرير: ${dateStr}`]], { origin: 'A3' })
    XLSX.utils.sheet_add_aoa(ws, [headers], { origin: 'A5' })
    XLSX.utils.sheet_add_aoa(ws, dataRows, { origin: 'A6' })

    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: headers.length - 1 } },
    ]

    ws['!cols'] = headers.map((h) => ({ wch: h.length > 6 ? h.length + 4 : 14 }))

    ws['!freeze'] = { x: 1, y: 5 }
    ws['!autofilter'] = { ref: `A5:${XLSX.utils.encode_cell({ r: 5 + dataRows.length, c: headers.length - 1 })}` }

    const pctCols = [17, 18, 19, 20, 21]
    for (let R = 5; R < 5 + dataRows.length; R++) {
      const rowData = dataRows[R - 5]
      for (let C = 4; C <= 5; C++) {
        if (typeof rowData[C] === 'number') {
          const addr = XLSX.utils.encode_cell({ r: R, c: C })
          if (ws[addr]) ws[addr].z = 'h:mm'
        }
      }
      for (const C of pctCols) {
        if (typeof rowData[C] === 'number') {
          const addr = XLSX.utils.encode_cell({ r: R, c: C })
          if (ws[addr]) ws[addr].z = '0.0%'
        }
      }
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'التقرير')
    const filePeriod = effectiveFrom && effectiveTo
      ? `${effectiveFrom.slice(0, 10)}_${effectiveTo.slice(0, 10)}`
      : `${perfYear}_${String(perfMonth).padStart(2, '0')}`
    XLSX.writeFile(wb, `تقرير_مدير_المبيعات_${filePeriod}.xlsx`)
  }

  function goBack() {
    if (selectedRepId) { setSelectedRepId(null); setRepSessions([]); setRepTimeline(null); return }
    if (selectedManagerId) { setSelectedManagerId(null); return }
    nav('/launcher/reports')
  }

  if (selectedRepId) {
    const detail = repRows.find((r) => r.employee_id === selectedRepId)
    const member = teamMembers.find((m) => m.employee_id === selectedRepId)
    if (!detail) return null

    const todayStr = effectiveFrom || new Date().toISOString().slice(0, 10)

    return (
      <div className="space-y-4" dir="rtl">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="text-text-secondary text-lg">&larr;</button>
          <h1 className="text-lg font-bold text-text">{detail.employee_name}</h1>
          <span className="text-xs text-text-secondary">{detail.employee_code}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtTime(detail.start_time)}</div><div className="text-[10px] text-text-secondary">بداية اليوم</div></div>
          <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtTime(detail.end_time)}</div><div className="text-[10px] text-text-secondary">نهاية اليوم</div></div>
          <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtHours(detail.net_minutes)}</div><div className="text-[10px] text-text-secondary">صافي ساعات</div></div>
          <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtHours(detail.break_minutes)}</div><div className="text-[10px] text-text-secondary">الاستراحة</div></div>
          <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtNum(detail.visit_count)}</div><div className="text-[10px] text-text-secondary">الزيارات</div></div>
          <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtNum(detail.order_count)}</div><div className="text-[10px] text-text-secondary">الطلبات</div></div>
          <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-green-600">{fmtMoney(detail.sales_value)}</div><div className="text-[10px] text-text-secondary">المبيعات</div></div>
          <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtMoney(detail.collection_amount)}</div><div className="text-[10px] text-text-secondary">التحصيل</div></div>
          <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtNum(detail.new_customer_count)}</div><div className="text-[10px] text-text-secondary">عملاء جدد</div></div>
          <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtNum(detail.tracking_points)}</div><div className="text-[10px] text-text-secondary">نقاط التتبع</div></div>
          <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtDist(detail.distance_meters)}</div><div className="text-[10px] text-text-secondary">المسافة</div></div>
          <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtNum(detail.day_count)}</div><div className="text-[10px] text-text-secondary">أيام العمل</div></div>
        </div>

        {member && member.has_target && (
          <div className="bg-white rounded-lg border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold text-text">الإنجاز مقابل الهدف</h2>
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-4 gap-2 py-1.5 font-bold border-b border-border/50">
                <span className="text-text-secondary">المؤشر</span><span className="text-left">الهدف</span><span className="text-left">المنفذ</span><span className="text-left">%</span>
              </div>
              {[
                { label: 'المبيعات', target: member.kpis.sales.target, actual: member.kpis.sales.actual, pct: member.kpis.sales.pct },
                { label: 'الزيارات', target: member.kpis.visits.target, actual: member.kpis.visits.actual, pct: member.kpis.visits.pct },
                { label: 'الطلبات', target: member.kpis.orders.target, actual: member.kpis.orders.actual, pct: member.kpis.orders.pct },
                { label: 'عملاء جدد', target: member.kpis.new_customers.target, actual: member.kpis.new_customers.actual, pct: member.kpis.new_customers.pct },
              ].map((item) => (
                <div key={item.label} className="grid grid-cols-4 gap-2 py-1.5 border-b border-border/50 last:border-0">
                  <span className="font-semibold text-text-secondary">{item.label}</span>
                  <span className="text-left">{fmtMoney(item.target)}</span>
                  <span className="text-left">{fmtMoney(item.actual)}</span>
                  <span className={`text-left font-bold ${getPctColor(item.pct)}`}>{fmtPct(item.pct)}</span>
                </div>
              ))}
              <div className="grid grid-cols-4 gap-2 pt-2 font-bold">
                <span className="text-text">الإجمالي</span><span className="text-left">{fmtPct(member.overall_achievement_score)}</span><span /><span />
              </div>
            </div>
          </div>
        )}

        {repTimeline && repTimeline.events.length > 0 && (
          <div className="bg-white rounded-lg border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold text-text">خط سير اليوم</h2>
            <div className="space-y-1 text-xs max-h-60 overflow-y-auto">
              {repTimeline.events.sort((a, b) => a.time.localeCompare(b.time)).map((ev, i) => (
                <div key={i} className="flex items-center gap-2 py-1 border-b border-border/30">
                  <span className="text-text-secondary w-12 shrink-0">{fmtTime(ev.time)}</span>
                  <span className="w-2 h-2 rounded-full bg-primary/40 shrink-0" />
                  <span className="font-semibold text-text-secondary">{EVENT_LABELS[ev.type] || ev.title}</span>
                  {ev.description && <span className="text-text">{ev.description}</span>}
                  {ev.latitude && <span className="text-[9px] text-text-secondary mr-auto">📍 {Number(ev.latitude).toFixed(4)}, {Number(ev.longitude).toFixed(4)}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {repSessions.length > 0 && (
          <div className="bg-white rounded-lg border border-border p-4 space-y-3">
            <h2 className="text-sm font-bold text-text">تفاصيل الجلسات ({repSessions.length})</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="bg-surface">
                  <tr>
                    {['التاريخ', 'البداية', 'النهاية', 'صافي ساعات', 'استراحة', 'زيارات', 'طلبات', 'مبيعات', 'تحصيل', 'عملاء', 'مسافة', 'نقاط'].map((l) => (
                      <th key={l} className="px-2 py-1.5 text-right font-semibold text-text-secondary">{l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {repSessions.map((s, i) => (
                    <tr key={i} className={`border-t border-border/50 ${i % 2 === 0 ? 'bg-white' : 'bg-surface/50'}`}>
                      <td className="px-2 py-1.5">{s.date?.slice(0, 10)}</td>
                      <td className="px-2 py-1.5">{fmtTime(s.start_time)}</td>
                      <td className="px-2 py-1.5">{fmtTime(s.end_time)}</td>
                      <td className="px-2 py-1.5">{fmtHours(s.net_minutes)}</td>
                      <td className="px-2 py-1.5">{fmtHours(s.break_minutes)}</td>
                      <td className="px-2 py-1.5">{fmtNum(s.visit_count)}</td>
                      <td className="px-2 py-1.5">{fmtNum(s.order_count)}</td>
                      <td className="px-2 py-1.5">{fmtMoney(s.sales_value)}</td>
                      <td className="px-2 py-1.5">{fmtMoney(s.collection_amount)}</td>
                      <td className="px-2 py-1.5">{fmtNum(s.new_customer_count)}</td>
                      <td className="px-2 py-1.5">{fmtDist(s.distance_meters)}</td>
                      <td className="px-2 py-1.5">{fmtNum(s.tracking_points_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {repLoading && <div className="text-center py-4 text-text-secondary text-sm">جاري تحميل التفاصيل...</div>}

        {effectiveFrom && effectiveTo && (
          <div className="text-center text-[10px] text-text-secondary">
            {effectiveFrom.slice(0, 10)} → {effectiveTo.slice(0, 10)} | {MONTHS[perfMonth - 1]} {perfYear}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={goBack} className="text-text-secondary text-lg">&larr;</button>
        <h1 className="text-lg font-bold text-text">
          {selectedManagerId ? `فريق ${selectedManager?.manager_name || ''}` : 'تقارير مدير المبيعات'}
        </h1>
      </div>

      <div className="bg-white rounded-lg border border-border p-3 space-y-3">
        <div className="flex gap-1 bg-surface rounded-lg p-1">
          {(['today', 'week', 'month', 'custom'] as PeriodType[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`flex-1 text-[11px] py-1.5 rounded-md font-semibold transition-colors ${period === p ? 'bg-primary text-white' : 'text-text-secondary hover:text-text'}`}>
              {p === 'today' ? 'اليوم' : p === 'week' ? 'الأسبوع' : p === 'month' ? 'الشهر' : 'مخصص'}
            </button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="flex gap-2">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
          </div>
        )}
        <select value={selectedManagerId || ''} onChange={(e) => { setSelectedManagerId(e.target.value || null); setSelectedRepId(null) }}
          className="w-full border border-border rounded-lg px-2 py-1.5 text-xs bg-white">
          <option value="">{allManagers.length ? 'اختر مدير مبيعات' : 'لا يوجد مدراء'}</option>
          {allManagers.map((m) => (
            <option key={m.manager_id} value={m.manager_id}>{m.manager_name} ({m.member_count})</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
      ) : error ? (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-sm text-danger">{error}</div>
      ) : !perfData?.has_target ? (
        <div className="text-center py-12 text-text-secondary text-sm">لا توجد أهداف لهذا الشهر</div>
      ) : selectedManagerId ? (
        <>
          <div className="bg-white rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-text">ملخص {selectedManager?.manager_name}</h2>
              {selectedManager?.own_overall_score != null && (
                <span className={`text-sm font-bold ${getPctColor(selectedManager.own_overall_score)}`}>{fmtPct(selectedManager.own_overall_score)}</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-surface rounded-lg p-2 text-center"><span className="font-bold text-lg">{selectedManager?.team_summary.team_member_count || 0}</span><div className="text-text-secondary text-[10px]">فريق</div></div>
              <div className="bg-surface rounded-lg p-2 text-center"><span className="font-bold text-lg">{fmtNum(activeRepCount)}</span><div className="text-text-secondary text-[10px]">نشط</div></div>
              <div className="bg-surface rounded-lg p-2 text-center"><span className="font-bold text-lg text-green-600">{fmtMoney(totalsRow?.sales_value ?? 0)}</span><div className="text-text-secondary text-[10px]">مبيعات</div></div>
              <div className="bg-surface rounded-lg p-2 text-center"><span className="font-bold text-lg">{fmtNum(totalsRow?.order_count ?? 0)}</span><div className="text-text-secondary text-[10px]">طلبات</div></div>
              <div className="bg-surface rounded-lg p-2 text-center"><span className="font-bold text-lg">{fmtNum(totalsRow?.visit_count ?? 0)}</span><div className="text-text-secondary text-[10px]">زيارات</div></div>
              <div className="bg-surface rounded-lg p-2 text-center"><span className={`font-bold text-lg ${avgAchievement != null && avgAchievement >= 80 ? 'text-green-600' : avgAchievement != null && avgAchievement >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>{fmtPct(avgAchievement)}</span><div className="text-text-secondary text-[10px]">إنجاز</div></div>
              <div className="bg-surface rounded-lg p-2 text-center"><span className="font-bold text-lg text-blue-600 truncate block">{bestMember ? bestMember.employee_name : '\u2014'}</span><div className="text-text-secondary text-[10px]">الأفضل</div></div>
              <div className="bg-surface rounded-lg p-2 text-center"><span className="font-bold text-lg text-red-500 truncate block">{worstMember ? worstMember.employee_name : '\u2014'}</span><div className="text-text-secondary text-[10px]">الأضعف</div></div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input type="text" placeholder="بحث عن مندوب..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 border border-border rounded-lg px-2 py-1.5 text-xs bg-white" />
            <div className="relative">
              <button onClick={() => setShowColMenu(!showColMenu)}
                className="border border-border rounded-lg px-2 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface">الأعمدة</button>
              {showColMenu && (
                <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-border rounded-lg shadow-lg p-2 w-44 max-h-64 overflow-y-auto">
                  {ALL_COLUMNS.map((col) => (
                    <label key={col.key} className="flex items-center gap-2 px-1 py-1 text-xs cursor-pointer hover:bg-surface rounded">
                      <input type="checkbox" checked={visibleCols.has(col.key)} onChange={() => toggleCol(col.key)} className="accent-primary" />
                      <span>{col.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <button onClick={exportToExcel}
              className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap">Excel</button>
          </div>
          {showColMenu && <div className="fixed inset-0 z-10" onClick={() => setShowColMenu(false)} />}

          {filteredRows.length > 0 ? (
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <div className="rep-table-wrap" ref={tableRef}>
                <table className="w-full text-xs">
                  <thead>
                    <tr>
                      {cols.map((col, ci) => (
                        <th key={col.key}
                          className={`px-2 py-2 text-right font-semibold text-text-secondary bg-surface ${ci === 0 ? 'sticky-col-first' : ''} ${col.numeric ? 'cursor-pointer hover:bg-gray-100 select-none' : ''}`}
                          style={{ minWidth: col.key === 'employee_name' ? 120 : col.key === 'employee_code' ? 70 : 80 }}
                          onClick={() => col.numeric && handleSort(col.key)}>
                          <div className="flex items-center gap-1">
                            <span>{col.label}</span>
                            {sortKey === col.key && <span className="text-[9px]">{sortDir === 'desc' ? '▼' : '▲'}</span>}
                          </div>
                        </th>
                      ))}
                      {showDetailCol && <th className="px-2 py-2 text-right font-semibold text-text-secondary bg-surface" style={{ minWidth: 50 }}>تفاصيل</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, i) => (
                      <tr key={row.employee_id}
                        className={`border-t border-border/50 cursor-pointer transition-colors ${getAchievementClass(row.overall_score)} ${i % 2 === 0 ? '' : ''}`}
                        onClick={() => setSelectedRepId(row.employee_id)}>
                        {cols.map((col, ci) => (
                          <td key={col.key}
                            className={`px-2 py-2 ${ci === 0 ? 'sticky-col-first font-semibold bg-white' : ''} ${col.key === 'overall_score' ? getPctColor(row.overall_score) : ''}`}>
                            {col.key === 'employee_name' ? row.employee_name
                              : col.key === 'employee_code' ? row.employee_code
                              : fmtCellVal(col.key, row)}
                          </td>
                        ))}
                        {showDetailCol && <td className="px-2 py-2"><button className="text-primary text-[10px] font-semibold">عرض ←</button></td>}
                      </tr>
                    ))}
                    {totalsRow && (
                      <tr className="border-t-2 border-border bg-surface font-bold sticky bottom-0">
                        {cols.map((col, ci) => (
                          <td key={col.key} className={`px-2 py-2 ${ci === 0 ? 'sticky-col-first bg-surface' : ''}`}>
                            {col.key === 'employee_name' ? 'الإجمالي'
                              : col.key === 'employee_code' ? ''
                              : col.key === 'start_time' || col.key === 'end_time' ? ''
                              : fmtCellNum(col.key, (totalsRow as any)[col.key] ?? 0)}
                          </td>
                        ))}
                        {showDetailCol && <td className="px-2 py-2" />}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-text-secondary text-sm">لا يوجد مندوبين تحت هذا المدير</div>
          )}

          <div className="text-center text-[10px] text-text-secondary">
            {effectiveFrom && effectiveTo ? `${effectiveFrom.slice(0, 10)} → ${effectiveTo.slice(0, 10)}` : ''} | {MONTHS[perfMonth - 1]} {perfYear}
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-green-600">{fmtMoney(workdayTotals?.total_sales ?? perfData?.company?.sales_actual ?? 0)}</div><div className="text-[10px] text-text-secondary">إجمالي المبيعات</div></div>
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtNum(workdayTotals?.total_orders ?? 0)}</div><div className="text-[10px] text-text-secondary">إجمالي الطلبات</div></div>
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtNum(workdayTotals?.total_visits ?? 0)}</div><div className="text-[10px] text-text-secondary">إجمالي الزيارات</div></div>
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtMoney(workdayTotals?.total_collection_amount ?? 0)}</div><div className="text-[10px] text-text-secondary">إجمالي التحصيل</div></div>
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtNum(workdayTotals?.total_new_customers ?? 0)}</div><div className="text-[10px] text-text-secondary">عملاء جدد</div></div>
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className={`text-lg font-bold ${getPctColor(perfData?.company?.overall_achievement_pct)}`}>{fmtPct(perfData?.company?.overall_achievement_pct)}</div><div className="text-[10px] text-text-secondary">نسبة الإنجاز</div></div>
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtNum(workdayTotals?.total_employees ?? allManagers.reduce((s, m) => s + m.member_count, 0))}</div><div className="text-[10px] text-text-secondary">إجمالي المندوبين</div></div>
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{allManagers.length}</div><div className="text-[10px] text-text-secondary">عدد المدراء</div></div>
          </div>

          {allManagers.length > 0 ? (
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-surface">
                  <tr>
                    {['مدير المبيعات', 'الفريق', 'المبيعات', 'الطلبات', 'الزيارات', 'عملاء جدد', 'الإنجاز%'].map((label, i) => {
                      const keys = ['manager_name', 'member_count', 'team_sales', 'team_orders', 'team_visits', 'team_customers', 'team_achievement_pct']
                      return (
                        <th key={keys[i]} className={`px-2 py-2 text-right font-semibold text-text-secondary ${i !== 0 ? 'cursor-pointer hover:bg-gray-100 select-none' : ''}`}
                          onClick={() => i !== 0 && handleSort(keys[i])}>
                          {label}{sortKey === keys[i] && <span className="mr-1 text-[9px]">{sortDir === 'desc' ? '▼' : '▲'}</span>}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {[...allManagers].sort((a, b) => (b.team_sales || 0) - (a.team_sales || 0)).map((mgr, i) => (
                    <tr key={mgr.manager_id} className={`border-t border-border/50 ${i % 2 === 0 ? 'bg-white' : 'bg-surface/50'} cursor-pointer hover:bg-primary/5 transition-colors`}
                      onClick={() => { setSelectedManagerId(mgr.manager_id); setSelectedRepId(null) }}>
                      <td className="px-2 py-2 font-semibold">{mgr.manager_name}</td>
                      <td className="px-2 py-2">{mgr.member_count}</td>
                      <td className="px-2 py-2">{fmtMoney(mgr.team_sales)}</td>
                      <td className="px-2 py-2">{fmtNum(mgr.team_orders)}</td>
                      <td className="px-2 py-2">{fmtNum(mgr.team_visits)}</td>
                      <td className="px-2 py-2">{fmtNum(mgr.team_customers)}</td>
                      <td className={`px-2 py-2 font-bold ${getPctColor(mgr.team_achievement_pct)}`}>{fmtPct(mgr.team_achievement_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-text-secondary text-sm">لا يوجد مدراء مبيعات</div>
          )}

          {perfData?.hierarchy?.unassigned && perfData.hierarchy.unassigned.length > 0 && (
            <div className="bg-white rounded-lg border border-border p-3">
              <div className="text-xs font-semibold text-text-secondary mb-2">مندوبين غير موزعين ({perfData.hierarchy.unassigned.length})</div>
              <div className="flex flex-wrap gap-1">
                {perfData.hierarchy.unassigned.map((u) => (
                  <span key={u.employee_id} className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{u.employee_name}</span>
                ))}
              </div>
            </div>
          )}

          <div className="text-center text-[10px] text-text-secondary">
            {effectiveFrom && effectiveTo ? `${effectiveFrom.slice(0, 10)} → ${effectiveTo.slice(0, 10)}` : ''} | {MONTHS[perfMonth - 1]} {perfYear}
          </div>
        </>
      )}
    </div>
  )
}
