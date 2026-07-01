import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { targetService } from '../../services/targets'
import { attendanceService } from '../../services/attendance'

import { KpiDrillDownModal } from '../../components/KpiDrillDownModal'
import TrackingExplorerModal from '../../components/TrackingExplorerModal'
import { getBusinessDetailData } from '../../services/businessActivity'
import * as XLSX from 'xlsx'


const MONTHS = ['يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

type PeriodType = 'today' | 'week' | 'month' | 'previous_month' | 'custom'

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

interface PSummary {
  daysWorked: number; totalVisits: number; totalOrders: number; totalSales: number
  totalNewCustomers: number; totalCollections: number
  bestSalesDate: string | null; bestSalesValue: number
  lowestActivityDate: string | null; lowestActivityVisits: number
  daysWithoutSales: number; daysWithoutVisits: number
  lastActivityDate: string | null
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
  if (n == null) return '\u2014'
  if (n === 0) return '0'
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

function getPctColor(pct: number | null | undefined): string {
  if (pct == null) return 'text-text'
  if (pct >= 100) return 'text-green-600'
  if (pct >= 80) return 'text-green-600'
  if (pct >= 50) return 'text-yellow-600'
  return 'text-red-500'
}

function getBarColor(pct: number | null | undefined): string {
  if (pct == null) return 'bg-gray-300'
  if (pct >= 100) return 'bg-green-500'
  if (pct >= 80) return 'bg-green-500'
  if (pct >= 50) return 'bg-yellow-500'
  return 'bg-red-500'
}

function getStatusLabel(pct: number | null | undefined): { label: string; color: string; bg: string } {
  if (pct == null) return { label: '—', color: 'text-gray-400', bg: 'bg-gray-50' }
  if (pct >= 100) return { label: 'ممتاز', color: 'text-green-700', bg: 'bg-green-50' }
  if (pct >= 80) return { label: 'جيد', color: 'text-green-700', bg: 'bg-green-50' }
  if (pct >= 50) return { label: 'متوسط', color: 'text-yellow-700', bg: 'bg-yellow-50' }
  return { label: 'حرج', color: 'text-red-700', bg: 'bg-red-50' }
}

function getDateRange(period: PeriodType): { from: string; to: string } {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth(); const d = now.getDate()
  switch (period) {
    case 'today': return { from: new Date(y, m, d).toISOString().slice(0, 10), to: new Date(y, m, d + 1).toISOString().slice(0, 10) }
    case 'week': { const dow = now.getDay(); const sun = new Date(y, m, d - dow); const sat = new Date(y, m, d + (6 - dow)); return { from: sun.toISOString().slice(0, 10), to: new Date(sat.getFullYear(), sat.getMonth(), sat.getDate() + 1).toISOString().slice(0, 10) } }
    case 'month': return { from: new Date(y, m, 1).toISOString().slice(0, 10), to: new Date(y, m + 1, 1).toISOString().slice(0, 10) }
    case 'previous_month': { const pm = new Date(y, m - 1, 1); return { from: new Date(pm.getFullYear(), pm.getMonth(), 1).toISOString().slice(0, 10), to: new Date(y, m, 1).toISOString().slice(0, 10) } }
    default: return { from: '', to: '' }
  }
}

function getMonthYear(from: string): { month: number; year: number } {
  const d = new Date(from || Date.now())
  return { month: d.getMonth() + 1, year: d.getFullYear() }
}

function generateInsight(overallScore: number | null, member: HMember | null): { verdict: string; explanation: string; details: string[]; color: string } {
  if (overallScore == null || !member) {
    return { verdict: 'لا توجد بيانات', explanation: 'غير كافٍ للتقييم', details: [], color: 'gray' }
  }

  const s = member.kpis.sales.pct
  const v = member.kpis.visits.pct
  const o = member.kpis.orders.pct
  const c = member.kpis.new_customers.pct
  const col = member.kpis.collections.actual

  const details: string[] = []
  let verdict: string
  let color: string
  let explanation: string

  if (overallScore >= 100) { verdict = 'أداء ممتاز'; color = 'green'; explanation = 'تجاوز المستهدف بنجاح' }
  else if (overallScore >= 80) { verdict = 'أداء جيد'; color = 'green'; explanation = 'يقترب من تحقيق الهدف' }
  else if (overallScore >= 50) { verdict = 'أداء متوسط'; color = 'yellow'; explanation = 'يحتاج إلى تطوير' }
  else { verdict = 'أداء ضعيف'; color = 'red'; explanation = 'أقل من المتوقع بشكل كبير' }

  if (v != null && v < 50) details.push('انخفاض عدد الزيارات يؤثر سلباً على الأداء')
  if (o != null && s != null && o > 0 && s != null && s < 50 && o >= 80) details.push('زيارات مرتفعة ولكن تحويل منخفض — نسبة التحويل ضعيفة')
  if (o != null && s != null && o > 0 && s / o < 50) details.push('متوسط قيمة الطلب منخفض')
  if (col === 0) details.push('لا يوجد تحصيل خلال الفترة')
  if (c != null && c >= 100) details.push('اكتساب عملاء جيد')

  if (details.length === 0 && overallScore >= 80) details.push('جميع المؤشرات ضمن المستوى المطلوب')
  if (details.length === 0 && overallScore < 80) details.push('الأداء العام يحتاج إلى مراجعة شاملة')

  return { verdict, explanation, details, color }
}

export default function ManagerReportsPage() {
  const nav = useNavigate()
  const tableRef = useRef<HTMLDivElement>(null)
  const stateRestoredRef = useRef(false)

  const SAVE_KEY = 'mgr_report_state'

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
  const [showTrackingExplorer, setShowTrackingExplorer] = useState(false)
  const [trackingMapData, setTrackingMapData] = useState<any>(null)
  const [trackingLoading, setTrackingLoading] = useState(false)
  const [repLoading, setRepLoading] = useState(false)
  const [dd, setDd] = useState({ kpiType: null as string | null, records: [] as any[], loading: false, title: '', recordType: '' })

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
    if (stateRestoredRef.current) return
    try {
      const saved = sessionStorage.getItem(SAVE_KEY)
      if (saved) {
        const s = JSON.parse(saved)
        if (s.period && s.period !== 'custom') setPeriod(s.period as PeriodType)
        if (s.selectedManagerId) setSelectedManagerId(s.selectedManagerId)
        if (s.selectedRepId) setSelectedRepId(s.selectedRepId)
        if (s.dateFrom) setDateFrom(s.dateFrom)
        if (s.dateTo) setDateTo(s.dateTo)
        if (s.scrollY) {
          requestAnimationFrame(() => {
            if (tableRef.current) tableRef.current.scrollTop = s.scrollY
          })
        }
      }
    } catch {}
    stateRestoredRef.current = true
  }, [])

  useEffect(() => {
    try {
      sessionStorage.setItem(SAVE_KEY, JSON.stringify({
        period, selectedManagerId, selectedRepId, dateFrom, dateTo,
        scrollY: tableRef.current?.scrollTop || 0,
      }))
    } catch {}
  }, [period, selectedManagerId, selectedRepId, dateFrom, dateTo])

  function saveScrollBeforeNavigate() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SAVE_KEY) || '{}')
      sessionStorage.setItem(SAVE_KEY, JSON.stringify({ ...saved, scrollY: tableRef.current?.scrollTop || 0 }))
    } catch {}
  }

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

  const isToday = period === 'today'

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
          collection_count: src?.collection_count ?? 0, collection_amount: src?.collection_amount ?? 0,
          new_customer_count: src?.new_customer_count ?? 0,
          late_minutes: src?.late_minutes ?? null, attendance_status: src?.attendance_status ?? null, day_count: 1,
          sales_target: perf?.sales_target ?? k?.sales?.target ?? 0,
          orders_target: perf?.orders_target ?? k?.orders?.target ?? 0,
          visits_target: perf?.visits_target ?? k?.visits?.target ?? 0,
          customers_target: perf?.new_customers_target ?? k?.new_customers?.target ?? 0,
          sales_pct: perf?.sales_achievement_pct ?? k?.sales?.pct ?? null,
          orders_pct: perf?.orders_achievement_pct ?? k?.orders?.pct ?? null,
          visits_pct: perf?.visits_achievement_pct ?? k?.visits?.pct ?? null,
          customers_pct: perf?.new_customers_achievement_pct ?? k?.new_customers?.pct ?? null,
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
        collection_count: s?.total_collection_count ?? 0, collection_amount: s?.total_collection_amount ?? 0,
        new_customer_count: s?.total_new_customers ?? 0,
        late_minutes: null, attendance_status: null, day_count: s?.total_days ?? 0,
        sales_target: perf?.sales_target ?? k?.sales?.target ?? 0,
        orders_target: perf?.orders_target ?? k?.orders?.target ?? 0,
        visits_target: perf?.visits_target ?? k?.visits?.target ?? 0,
        customers_target: perf?.new_customers_target ?? k?.new_customers?.target ?? 0,
        sales_pct: perf?.sales_achievement_pct ?? k?.sales?.pct ?? null,
        orders_pct: perf?.orders_achievement_pct ?? k?.orders?.pct ?? null,
        visits_pct: perf?.visits_achievement_pct ?? k?.visits?.pct ?? null,
        customers_pct: perf?.new_customers_achievement_pct ?? k?.new_customers?.pct ?? null,
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

  const periodSummary = useMemo<PSummary | null>(() => {
    if (!repSessions.length) return null
    const totalVisits = repSessions.reduce((s, sess) => s + (sess.visit_count || 0), 0)
    const totalOrders = repSessions.reduce((s, sess) => s + (sess.order_count || 0), 0)
    const totalSales = repSessions.reduce((s, sess) => s + (sess.sales_value || 0), 0)
    const totalNewCustomers = repSessions.reduce((s, sess) => s + (sess.new_customer_count || 0), 0)
    const totalCollections = repSessions.reduce((s, sess) => s + (sess.collection_amount || 0), 0)

    const sortedBySales = [...repSessions].sort((a, b) => (b.sales_value || 0) - (a.sales_value || 0))
    const bestSalesDay = sortedBySales[0]
    const sortedByVisits = [...repSessions].sort((a, b) => (a.visit_count || 0) - (b.visit_count || 0))
    const lowestActivityDay = sortedByVisits[0]
    const sortedByDate = [...repSessions].sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    const lastSession = sortedByDate[sortedByDate.length - 1]

    return {
      daysWorked: repSessions.length,
      totalVisits, totalOrders, totalSales,
      totalNewCustomers, totalCollections,
      bestSalesDate: bestSalesDay?.date?.slice(0, 10) || null,
      bestSalesValue: bestSalesDay?.sales_value || 0,
      lowestActivityDate: lowestActivityDay?.date?.slice(0, 10) || null,
      lowestActivityVisits: lowestActivityDay?.visit_count || 0,
      daysWithoutSales: repSessions.filter(s => (s.sales_value || 0) === 0).length,
      daysWithoutVisits: repSessions.filter(s => (s.visit_count || 0) === 0).length,
      lastActivityDate: lastSession?.date?.slice(0, 10) || null,
    }
  }, [repSessions])

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

  const stickyStyle: React.CSSProperties = { position: 'sticky', right: 0, zIndex: 3, background: 'inherit' }
  const stickyBorderStyle: React.CSSProperties = { position: 'sticky', right: 0, zIndex: 3, background: 'inherit', borderLeft: '1px solid #e5e7eb' }
  const stickyHeadStyle: React.CSSProperties = { position: 'sticky', right: 0, zIndex: 6, background: 'inherit', borderLeft: '1px solid #e5e7eb' }

  const cols = visibleColsArr()
  const showDetailCol = true

  const KPI_TITLE: Record<string, string> = {
    orders: 'الطلبات', sales: 'المبيعات', customers: 'عملاء جدد', visits: 'الزيارات', collections: 'التحصيل',
  }

  const handleKpiClick = useCallback(async (kpiType: string, employeeId?: string) => {
    const empId = employeeId || selectedRepId
    if (!empId || !effectiveFrom || !effectiveTo) return
    setDd({ kpiType, records: [], loading: true, title: '', recordType: '' })
    const result = await getBusinessDetailData({
      employeeId: empId,
      kpiType,
      from: effectiveFrom,
      to: effectiveTo,
      token: localStorage.getItem('session_token') || '',
    })
    const empName = employeeId ? teamMembers.find(m => m.employee_id === employeeId)?.employee_name : undefined
    setDd({ kpiType, records: result.records, loading: false, title: (KPI_TITLE[kpiType] || kpiType) + (empName ? ` - ${empName}` : ''), recordType: result.recordType })
  }, [selectedRepId, effectiveFrom, effectiveTo, teamMembers])

  async function handleSessionKpiClick(kpiType: string, sessionDate: string) {
    if (!selectedRepId) return
    setDd({ kpiType, records: [], loading: true, title: '', recordType: '' })
    const from = sessionDate
    const to = new Date(new Date(sessionDate + 'T00:00:00').getTime() + 86400000).toISOString().slice(0, 10)
    const result = await getBusinessDetailData({
      employeeId: selectedRepId, kpiType, from, to,
      token: localStorage.getItem('session_token') || '',
    })
    setDd({ kpiType, records: result.records, loading: false, title: (KPI_TITLE[kpiType] || kpiType) + ` — ${sessionDate.slice(0, 10)}`, recordType: result.recordType })
  }

  async function openTrackingExplorer() {
    if (!selectedRepId || !effectiveFrom) return
    setTrackingLoading(true)
    setShowTrackingExplorer(true)
    try {
      const res = await supabase.rpc('get_employee_day_map', {
        p_token: localStorage.getItem('session_token'),
        p_employee_id: selectedRepId,
        p_date: effectiveFrom,
      })
      if (res.data) setTrackingMapData(res.data)
    } catch { setTrackingMapData(null) }
    setTrackingLoading(false)
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

  function printToPdf(title: string, getContent: () => string) {
    const win = window.open('', '_blank')
    if (!win) return
    const periodLabel = effectiveFrom && effectiveTo
      ? `من ${effectiveFrom.slice(0, 10)} إلى ${effectiveTo.slice(0, 10)}`
      : `${MONTHS[perfMonth - 1]} ${perfYear}`
    win.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>${title}</title>
<style>
  @page { size: A4; margin: 15mm }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 12px; color: #1e293b; margin: 0; padding: 0; }
  .header { text-align: center; border-bottom: 2px solid #2563eb; padding-bottom: 10px; margin-bottom: 15px; }
  .header h1 { font-size: 18px; color: #1e293b; margin: 0 0 4px; }
  .header p { font-size: 11px; color: #64748b; margin: 2px 0; }
  .section { margin-bottom: 15px; }
  .section h2 { font-size: 13px; color: #2563eb; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 8px; }
  th { background: #f1f5f9; text-align: right; padding: 6px 8px; font-weight: 600; color: #64748b; border: 1px solid #e2e8f0; }
  td { padding: 5px 8px; border: 1px solid #e2e8f0; }
  .kpi-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 8px; }
  .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; text-align: center; }
  .kpi-card .value { font-size: 15px; font-weight: 700; }
  .kpi-card .label { font-size: 10px; color: #64748b; }
  .status-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; }
  .status-green { background: #dcfce7; color: #166534; }
  .status-yellow { background: #fef9c3; color: #854d0e; }
  .status-red { background: #fee2e2; color: #991b1b; }
  .text-green { color: #16a34a; }
  .text-yellow { color: #ca8a04; }
  .text-red { color: #dc2626; }
  .text-muted { color: #64748b; }
  .bar-bg { background: #e2e8f0; border-radius: 4px; height: 8px; overflow: hidden; }
  .bar-fill { height: 8px; border-radius: 4px; }
  .footer { text-align: center; font-size: 9px; color: #94a3b8; margin-top: 20px; padding-top: 8px; border-top: 1px solid #e2e8f0; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 8px; }
  .summary-card { padding: 6px; text-align: center; border-radius: 6px; }
  .summary-card .value { font-size: 14px; font-weight: 700; }
  .summary-card .label { font-size: 9px; }
</style></head><body>
<div class="header"><h1>${title}</h1><p>${periodLabel}</p><p class="text-muted">${new Date().toLocaleDateString('ar-EG-u-nu-latn')}</p></div>
${getContent()}
<div class="footer">تم التصدير بواسطة نظام الأهرام للتوزيع المتكامل</div>
</body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print() }, 500)
  }

  function exportRepToPDF() {
    const detail = repRows.find((r) => r.employee_id === selectedRepId)
    const member = teamMembers.find((m) => m.employee_id === selectedRepId)
    if (!detail) return

    printToPdf(`تقرير أداء المندوب: ${detail.employee_name}`, () => {
      const saleActual = member?.kpis.sales.actual ?? detail.sales_value
      const saleTarget = member?.kpis.sales.target ?? detail.sales_target ?? 0

      let html = ''

      html += '<div class="section" style="border:1px solid #bfdbfe;border-radius:8px;padding:10px;margin-bottom:12px">'
      html += '<div style="display:flex;align-items:center;gap:6px;border-bottom:1px solid #bfdbfe;padding-bottom:8px;margin-bottom:10px">'
      html += '<span style="width:8px;height:8px;border-radius:50%;background:#3b82f6;display:inline-block"></span>'
      html += '<h2 style="margin:0;font-size:14px;color:#1e40af">إجمالي النشاط</h2>'
      html += '<span style="font-size:9px;color:#60a5fa;margin-right:auto">ماذا فعل المندوب خلال الفترة؟</span>'
      html += '</div>'
      html += '<div class="summary-grid">'
      if (periodSummary) {
        html += `<div class="summary-card" style="background:#eff6ff"><div class="value" style="color:#2563eb">${fmtNum(periodSummary.daysWorked)}</div><div class="label" style="color:#3b82f6">أيام العمل</div></div>`
        html += `<div class="summary-card" style="background:#f0fdf4"><div class="value" style="color:#0d9488">${fmtNum(member?.kpis.visits.actual ?? periodSummary.totalVisits)}</div><div class="label" style="color:#14b8a6">الزيارات المنفذة</div></div>`
        html += `<div class="summary-card" style="background:#fffbeb"><div class="value" style="color:#d97706">${fmtNum(member?.kpis.orders.actual ?? periodSummary.totalOrders)}</div><div class="label" style="color:#f59e0b">الطلبات</div></div>`
        html += `<div class="summary-card" style="background:#ecfdf5"><div class="value" style="color:#059669">${fmtMoney(member?.kpis.sales.actual ?? periodSummary.totalSales)}</div><div class="label" style="color:#10b981">المبيعات</div></div>`
        html += `<div class="summary-card" style="background:#fdf4ff"><div class="value" style="color:#9333ea">${fmtMoney(member?.kpis.collections.actual ?? periodSummary.totalCollections)}</div><div class="label" style="color:#a855f7">التحصيل</div></div>`
        html += `<div class="summary-card" style="background:#ecfeff"><div class="value" style="color:#0891b2">${fmtNum(member?.kpis.new_customers.actual ?? periodSummary.totalNewCustomers)}</div><div class="label" style="color:#06b6d4">عملاء جدد</div></div>`
        html += `<div class="summary-card" style="background:#f1f5f9"><div class="value" style="color:#475569">${fmtNum(detail.tracking_points)}</div><div class="label" style="color:#64748b">نقاط التتبع</div></div>`
        html += `<div class="summary-card" style="background:#f1f5f9"><div class="value" style="color:#475569">${fmtDist(detail.distance_meters)}</div><div class="label" style="color:#64748b">المسافة</div></div>`
      }
      html += '</div></div>'

      html += '<div class="section" style="border:1px solid #a7f3d0;border-radius:8px;padding:10px;margin-bottom:12px">'
      html += '<div style="display:flex;align-items:center;gap:6px;border-bottom:1px solid #a7f3d0;padding-bottom:8px;margin-bottom:10px">'
      html += '<span style="width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block"></span>'
      html += '<h2 style="margin:0;font-size:14px;color:#065f46">المتحقق من التارجت</h2>'
      html += '<span style="font-size:9px;color:#34d399;margin-right:auto">نسبة الإنجاز مقابل الأهداف المحددة</span>'
      html += '</div>'
      html += '<div class="kpi-grid">'
      html += `<div class="kpi-card"><div class="value">${fmtMoney(saleTarget)}</div><div class="label">الهدف</div></div>`
      html += `<div class="kpi-card"><div class="value text-green">${fmtMoney(saleActual)}</div><div class="label">المنفذ</div></div>`
      const pctColor = detail.sales_pct != null && detail.sales_pct >= 80 ? 'text-green' : detail.sales_pct != null && detail.sales_pct >= 50 ? 'text-yellow' : 'text-red'
      html += `<div class="kpi-card"><div class="value ${pctColor}">${fmtPct(detail.sales_pct)}</div><div class="label">نسبة الإنجاز</div></div>`
      html += `<div class="kpi-card"><div class="value text-red">${fmtMoney(Math.max(0, saleTarget - saleActual))}</div><div class="label">المتبقي</div></div>`
      html += `<div class="kpi-card"><div class="value">${detail.day_count}</div><div class="label">أيام العمل</div></div>`
      html += `<div class="kpi-card"><div class="value">${detail.day_count > 0 ? fmtMoney(Math.round(saleActual / detail.day_count)) : '\u2014'}</div><div class="label">المعدل/يوم</div></div>`
      html += '</div>'

      if (detail.sales_pct != null && saleTarget > 0) {
        const barColor = detail.sales_pct >= 80 ? '#22c55e' : detail.sales_pct >= 50 ? '#eab308' : '#ef4444'
        html += `<div class="bar-bg"><div class="bar-fill" style="width:${Math.min(100, detail.sales_pct)}%;background:${barColor}"></div></div>`
        html += `<div style="display:flex;justify-content:space-between;font-size:10px;margin-top:2px"><span>${fmtPct(detail.sales_pct)} محقق</span><span class="text-muted">${fmtPct(100 - Math.min(100, detail.sales_pct || 0))} متبقي</span></div>`
      }
      html += '</div>'

      if (member && member.has_target) {
        html += '<div class="section" style="border:1px solid #a7f3d0;border-radius:8px;padding:10px;margin-bottom:12px">'
        html += '<h2 style="margin:0 0 8px;font-size:13px;color:#065f46">الإنجاز مقابل الهدف</h2>'
        html += '<table><thead><tr><th>المؤشر</th><th>الهدف</th><th>المنفذ</th><th>%</th><th>الحالة</th></tr></thead><tbody>'
        const items = [
          { label: 'المبيعات', target: member.kpis.sales.target, actual: member.kpis.sales.actual, pct: member.kpis.sales.pct },
          { label: 'الزيارات', target: member.kpis.visits.target, actual: member.kpis.visits.actual, pct: member.kpis.visits.pct },
          { label: 'الطلبات', target: member.kpis.orders.target, actual: member.kpis.orders.actual, pct: member.kpis.orders.pct },
          { label: 'عملاء جدد', target: member.kpis.new_customers.target, actual: member.kpis.new_customers.actual, pct: member.kpis.new_customers.pct },
        ]
        for (const item of items) {
          const st = getStatusLabel(item.pct)
          const bc = item.pct != null && item.pct >= 80 ? '#22c55e' : item.pct != null && item.pct >= 50 ? '#eab308' : '#ef4444'
          html += `<tr><td style="font-weight:600">${item.label}</td><td>${fmtMoney(item.target)}</td><td>${fmtMoney(item.actual)}</td><td style="font-weight:700;color:${bc}">${fmtPct(item.pct)}</td><td><span class="status-badge ${st.color === 'text-green-700' ? 'status-green' : st.color === 'text-yellow-700' ? 'status-yellow' : 'status-red'}">${st.label}</span></td></tr>`
        }
        if (member.overall_achievement_score != null) {
          const ost = getStatusLabel(member.overall_achievement_score)
          html += `<tr style="font-weight:700;background:#f8fafc"><td>الإجمالي</td><td></td><td></td><td>${fmtPct(member.overall_achievement_score)}</td><td><span class="status-badge ${ost.color === 'text-green-700' ? 'status-green' : ost.color === 'text-yellow-700' ? 'status-yellow' : 'status-red'}">${ost.label}</span></td></tr>`
        }
        html += '</tbody></table></div>'
      }

      if (repSessions.length > 0) {
        html += `<div class="section" style="border:1px solid #e2e8f0;border-radius:8px;padding:10px"><h2 style="margin:0 0 8px;font-size:13px;color:#1e293b">تفاصيل الجلسات (${repSessions.length})</h2><table><thead><tr><th>التاريخ</th><th>البداية</th><th>النهاية</th><th>صافي</th><th>زيارات</th><th>طلبات</th><th>مبيعات</th><th>تحصيل</th></tr></thead><tbody>`
        for (const s of repSessions.slice(0, 50)) {
          html += `<tr><td>${s.date?.slice(0, 10) || ''}</td><td>${fmtTime(s.start_time)}</td><td>${fmtTime(s.end_time)}</td><td>${fmtHours(s.net_minutes)}</td><td>${fmtNum(s.visit_count)}</td><td>${fmtNum(s.order_count)}</td><td>${fmtMoney(s.sales_value)}</td><td>${fmtMoney(s.collection_amount)}</td></tr>`
        }
        html += '</tbody></table></div>'
      }

      return html
    })
  }

  function exportToPDF() {
    if (!selectedManagerId) return
    const periodLabel = effectiveFrom && effectiveTo
      ? `من ${effectiveFrom.slice(0, 10)} إلى ${effectiveTo.slice(0, 10)}`
      : `${MONTHS[perfMonth - 1]} ${perfYear}`

    printToPdf(`تقرير مدير المبيعات: ${selectedManager?.manager_name || ''}`, () => {
      let html = '<div class="section"><h2>ملخص الفريق</h2>'

      if (selectedManager) {
        html += '<div class="kpi-grid">'
        html += `<div class="kpi-card"><div class="value">${selectedManager.team_summary.team_member_count}</div><div class="label">الفريق</div></div>`
        html += `<div class="kpi-card"><div class="value">${fmtNum(activeRepCount)}</div><div class="label">نشط</div></div>`
        html += `<div class="kpi-card"><div class="value text-green">${fmtMoney(totalsRow?.sales_value ?? 0)}</div><div class="label">المبيعات</div></div>`
        html += `<div class="kpi-card"><div class="value">${fmtNum(totalsRow?.order_count ?? 0)}</div><div class="label">الطلبات</div></div>`
        html += `<div class="kpi-card"><div class="value">${fmtNum(totalsRow?.visit_count ?? 0)}</div><div class="label">الزيارات</div></div>`
        if (avgAchievement != null) {
          const ac = avgAchievement >= 80 ? 'text-green' : avgAchievement >= 50 ? 'text-yellow' : 'text-red'
          html += `<div class="kpi-card"><div class="value ${ac}">${fmtPct(avgAchievement)}</div><div class="label">متوسط الإنجاز</div></div>`
        }
        if (bestMember) html += `<div class="kpi-card"><div class="value" style="color:#2563eb">${bestMember.employee_name}</div><div class="label">الأفضل</div></div>`
        if (worstMember) html += `<div class="kpi-card"><div class="value" style="color:#dc2626">${worstMember.employee_name}</div><div class="label">الأضعف</div></div>`
        html += '</div>'
      }

      html += '</div>'

      if (filteredRows.length > 0) {
        html += '<div class="section"><h2>قائمة المندوبين</h2><table><thead><tr><th>المندوب</th><th>الكود</th><th>صافي ساعات</th><th>الزيارات</th><th>الطلبات</th><th>المبيعات</th><th>التحصيل</th><th>%</th></tr></thead><tbody>'
        for (const r of filteredRows) {
          const rc = r.overall_score != null && r.overall_score >= 80 ? '#16a34a' : r.overall_score != null && r.overall_score >= 50 ? '#ca8a04' : '#dc2626'
          html += `<tr><td style="font-weight:600">${r.employee_name}</td><td>${r.employee_code}</td><td>${fmtHours(r.net_minutes)}</td><td>${fmtNum(r.visit_count)}</td><td>${fmtNum(r.order_count)}</td><td>${fmtMoney(r.sales_value)}</td><td>${fmtMoney(r.collection_amount)}</td><td style="font-weight:700;color:${rc}">${fmtPct(r.overall_score)}</td></tr>`
        }
        if (totalsRow) {
          html += `<tr style="font-weight:700;background:#f8fafc"><td>الإجمالي</td><td></td><td>${fmtHours(totalsRow.net_minutes)}</td><td>${fmtNum(totalsRow.visit_count)}</td><td>${fmtNum(totalsRow.order_count)}</td><td>${fmtMoney(totalsRow.sales_value)}</td><td>${fmtMoney(totalsRow.collection_amount)}</td><td></td></tr>`
        }
        html += '</tbody></table></div>'
      }

      return html
    })
  }

  function exportRepDetailToExcel() {
    const detail = repRows.find((r) => r.employee_id === selectedRepId)
    const member = teamMembers.find((m) => m.employee_id === selectedRepId)
    if (!detail) return

    const periodLabel = effectiveFrom && effectiveTo
      ? `من ${effectiveFrom.slice(0, 10)} إلى ${effectiveTo.slice(0, 10)}`
      : `${MONTHS[perfMonth - 1]} ${perfYear}`
    const now = new Date()
    const dateStr = now.toLocaleDateString('ar-EG-u-nu-latn') + ' ' + now.toLocaleTimeString('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' })

    const ws = XLSX.utils.aoa_to_sheet([])

    XLSX.utils.sheet_add_aoa(ws, [[`المندوب: ${detail.employee_name} (${detail.employee_code})`]], { origin: 'A1' })
    XLSX.utils.sheet_add_aoa(ws, [[`الفترة: ${periodLabel}`]], { origin: 'A2' })
    XLSX.utils.sheet_add_aoa(ws, [[`تاريخ التقرير: ${dateStr}`]], { origin: 'A3' })

    let curRow = 5
    const saleActual = member?.kpis.sales.actual ?? detail.sales_value
    const saleTarget = member?.kpis.sales.target ?? detail.sales_target ?? 0

    XLSX.utils.sheet_add_aoa(ws, [['إجمالي النشاط']], { origin: `A${curRow}` })
    curRow++
    const activityData = [
      ['أيام العمل', fmtNum(periodSummary?.daysWorked ?? detail.day_count), 'الزيارات المنفذة', fmtNum(member?.kpis.visits.actual ?? detail.visit_count)],
      ['الطلبات', fmtNum(member?.kpis.orders.actual ?? detail.order_count), 'المبيعات', fmtMoney(member?.kpis.sales.actual ?? detail.sales_value)],
      ['التحصيل', fmtMoney(member?.kpis.collections.actual ?? detail.collection_amount), 'عملاء جدد', fmtNum(member?.kpis.new_customers.actual ?? detail.new_customer_count)],
      ['نقاط التتبع', fmtNum(detail.tracking_points), 'المسافة', fmtDist(detail.distance_meters)],
    ]
    XLSX.utils.sheet_add_aoa(ws, activityData, { origin: `A${curRow}` })
    curRow += activityData.length + 1

    if (member && member.has_target) {
      XLSX.utils.sheet_add_aoa(ws, [['المتحقق من التارجت']], { origin: `A${curRow}` })
      curRow++
      const kpiSummary = [
        ['الهدف', fmtMoney(saleTarget), 'المنفذ', fmtMoney(saleActual)],
        ['نسبة الإنجاز', fmtPct(detail.sales_pct), 'المتبقي', fmtMoney(Math.max(0, saleTarget - saleActual))],
        ['أيام العمل', fmtNum(detail.day_count), 'المعدل/يوم', detail.day_count > 0 ? fmtMoney(Math.round(saleActual / detail.day_count)) : '\u2014'],
      ]
      XLSX.utils.sheet_add_aoa(ws, kpiSummary, { origin: `A${curRow}` })
      curRow += kpiSummary.length + 1

      XLSX.utils.sheet_add_aoa(ws, [['الإنجاز مقابل الهدف']], { origin: `A${curRow}` })
      curRow++
      const achHeaders = ['المؤشر', 'الهدف', 'المنفذ', '%', 'الحالة']
      XLSX.utils.sheet_add_aoa(ws, [achHeaders], { origin: `A${curRow}` })
      curRow++

      const achVals = [
        { label: 'المبيعات', target: member.kpis.sales.target, actual: member.kpis.sales.actual, pct: member.kpis.sales.pct },
        { label: 'الزيارات', target: member.kpis.visits.target, actual: member.kpis.visits.actual, pct: member.kpis.visits.pct },
        { label: 'الطلبات', target: member.kpis.orders.target, actual: member.kpis.orders.actual, pct: member.kpis.orders.pct },
        { label: 'عملاء جدد', target: member.kpis.new_customers.target, actual: member.kpis.new_customers.actual, pct: member.kpis.new_customers.pct },
      ]

      for (const item of achVals) {
        XLSX.utils.sheet_add_aoa(ws, [[item.label, item.target, item.actual, item.pct != null ? item.pct / 100 : '', getStatusLabel(item.pct).label]], { origin: `A${curRow}` })
        curRow++
      }
      XLSX.utils.sheet_add_aoa(ws, [['الإجمالي', '', '', member.overall_achievement_score != null ? member.overall_achievement_score / 100 : '', getStatusLabel(member.overall_achievement_score).label]], { origin: `A${curRow}` })
      curRow += 2
    }

    if (repSessions.length > 0) {
      XLSX.utils.sheet_add_aoa(ws, [['تفاصيل الجلسات']], { origin: `A${curRow}` })
      curRow++
      const sessHeaders = ['التاريخ', 'البداية', 'النهاية', 'صافي ساعات', 'استراحة', 'زيارات', 'طلبات', 'مبيعات', 'تحصيل', 'عملاء', 'مسافة', 'نقاط']
      XLSX.utils.sheet_add_aoa(ws, [sessHeaders], { origin: `A${curRow}` })
      curRow++

      for (const s of repSessions) {
        XLSX.utils.sheet_add_aoa(ws, [[
          s.date?.slice(0, 10) || '', s.start_time || '', s.end_time || '',
          s.net_minutes / 60, s.break_minutes / 60,
          s.visit_count || 0, s.order_count || 0, s.sales_value || 0,
          s.collection_amount || 0, s.new_customer_count || 0,
          s.distance_meters || 0, s.tracking_points_count || 0,
        ]], { origin: `A${curRow}` })
        curRow++
      }
    }

    const maxCols = 12
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: maxCols - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: maxCols - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: maxCols - 1 } },
    ]

    for (let R = 6; R < curRow; R++) {
      for (let C = 0; C < maxCols; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C })
        if (ws[addr] && typeof ws[addr].v === 'number') {
          if (C === 3 || C === 4) ws[addr].z = 'h:mm'
          if (C === 10 || C === 7 || C === 8) ws[addr].z = '#,##0'
        }
      }
    }

    ws['!cols'] = Array(maxCols).fill(null).map((_, i) => ({ wch: i === 0 ? 16 : 14 }))
    ws['!freeze'] = { x: 0, y: curRow > 15 ? curRow - 6 : curRow }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'التقرير')
    const filePeriod = effectiveFrom && effectiveTo ? `${effectiveFrom.slice(0, 10)}_${effectiveTo.slice(0, 10)}` : `${perfYear}_${String(perfMonth).padStart(2, '0')}`
    XLSX.writeFile(wb, `تقرير_مندوب_${detail.employee_code}_${filePeriod}.xlsx`)
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

    const insight = generateInsight(member?.overall_achievement_score ?? null, member ?? null)

    const achievementItems = member && member.has_target ? [
      { label: 'المبيعات', target: member.kpis.sales.target, actual: member.kpis.sales.actual, pct: member.kpis.sales.pct },
      { label: 'الزيارات', target: member.kpis.visits.target, actual: member.kpis.visits.actual, pct: member.kpis.visits.pct },
      { label: 'الطلبات', target: member.kpis.orders.target, actual: member.kpis.orders.actual, pct: member.kpis.orders.pct },
      { label: 'عملاء جدد', target: member.kpis.new_customers.target, actual: member.kpis.new_customers.actual, pct: member.kpis.new_customers.pct },
    ] : []

    return (
      <div className="space-y-5" dir="rtl">
        <div className="flex items-center gap-3">
          <button onClick={goBack} className="text-text-secondary text-lg">&larr;</button>
          <h1 className="text-lg font-bold text-text">{detail.employee_name}</h1>
          <span className="text-xs text-text-secondary">{detail.employee_code}</span>
          <div className="mr-auto flex gap-1.5">
            <button onClick={exportRepToPDF} className="bg-red-600 text-white text-xs px-2.5 py-1 rounded-lg font-semibold">PDF</button>
            <button onClick={exportRepDetailToExcel} className="bg-primary text-white text-xs px-2.5 py-1 rounded-lg font-semibold">Excel</button>
          </div>
        </div>

        {!periodSummary && (
          <div className="bg-blue-50/40 border border-blue-200 rounded-xl p-4 text-center text-text-secondary text-sm">لا تتوفر بيانات كافية للنشاط</div>
        )}

        <div className="bg-white rounded-xl border border-blue-200 shadow-sm overflow-hidden">
          <div className="bg-blue-50/60 px-4 py-3 border-b border-blue-100 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
            <h2 className="text-sm font-bold text-blue-800">إجمالي النشاط</h2>
            <span className="text-[9px] text-blue-500 mr-auto">ماذا فعل المندوب خلال الفترة؟</span>
          </div>
          {periodSummary ? (
            <div className="p-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-blue-50/80 rounded-lg p-2.5 text-center"><div className="text-lg font-bold text-blue-700">{fmtNum(periodSummary.daysWorked)}</div><div className="text-[10px] text-blue-600">أيام العمل</div></div>
                <div className="bg-teal-50 rounded-lg p-2.5 text-center cursor-pointer hover:brightness-95 transition-all" onClick={() => handleKpiClick('visits')}><div className="text-lg font-bold text-teal-700">{fmtNum(member?.kpis.visits.actual ?? periodSummary.totalVisits)}</div><div className="text-[10px] text-teal-600">الزيارات المنفذة</div></div>
                <div className="bg-amber-50 rounded-lg p-2.5 text-center cursor-pointer hover:brightness-95 transition-all" onClick={() => handleKpiClick('orders')}><div className="text-lg font-bold text-amber-700">{fmtNum(member?.kpis.orders.actual ?? periodSummary.totalOrders)}</div><div className="text-[10px] text-amber-600">الطلبات</div></div>
                <div className="bg-emerald-50 rounded-lg p-2.5 text-center cursor-pointer hover:brightness-95 transition-all" onClick={() => handleKpiClick('sales')}><div className="text-lg font-bold text-emerald-700">{fmtMoney(member?.kpis.sales.actual ?? periodSummary.totalSales)}</div><div className="text-[10px] text-emerald-600">المبيعات</div></div>
                <div className="bg-purple-50 rounded-lg p-2.5 text-center cursor-pointer hover:brightness-95 transition-all" onClick={() => handleKpiClick('collections')}><div className="text-lg font-bold text-purple-700">{fmtMoney(member?.kpis.collections.actual ?? periodSummary.totalCollections)}</div><div className="text-[10px] text-purple-600">التحصيل</div></div>
                <div className="bg-cyan-50 rounded-lg p-2.5 text-center cursor-pointer hover:brightness-95 transition-all" onClick={() => handleKpiClick('customers')}><div className="text-lg font-bold text-cyan-700">{fmtNum(member?.kpis.new_customers.actual ?? periodSummary.totalNewCustomers)}</div><div className="text-[10px] text-cyan-600">عملاء جدد</div></div>
                <div className="bg-slate-100 rounded-lg p-2.5 text-center cursor-pointer hover:brightness-95 transition-all shadow-sm" onClick={() => openTrackingExplorer()}><div className="text-lg font-bold text-slate-700">{fmtNum(detail.tracking_points)}</div><div className="text-[10px] text-slate-600">نقاط التتبع</div></div>
                <div className="bg-slate-100 rounded-lg p-2.5 text-center cursor-pointer hover:brightness-95 transition-all shadow-sm" onClick={() => openTrackingExplorer()}><div className="text-lg font-bold text-slate-700">{fmtDist(detail.distance_meters)}</div><div className="text-[10px] text-slate-600">المسافة</div></div>
              </div>
            </div>
          ) : (
            <div className="p-4 text-center text-text-secondary text-sm">لا تتوفر بيانات نشاط للمندوب</div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-emerald-200 shadow-sm overflow-hidden">
          <div className="bg-emerald-50/60 px-4 py-3 border-b border-emerald-100 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <h2 className="text-sm font-bold text-emerald-800">المتحقق من التارجت</h2>
            <span className="text-[9px] text-emerald-500 mr-auto">نسبة الإنجاز مقابل الأهداف المحددة</span>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
              <div className="bg-surface rounded-lg p-2 text-center"><div className="text-lg font-bold text-text">{fmtMoney(member?.kpis.sales.target ?? detail.sales_target ?? 0)}</div><div className="text-[10px] text-text-secondary">الهدف</div></div>
              <div className="bg-surface rounded-lg p-2 text-center cursor-pointer hover:bg-green-50 transition-colors" onClick={() => handleKpiClick('sales')}><div className="text-lg font-bold text-green-600">{fmtMoney(member?.kpis.sales.actual ?? detail.sales_value)}</div><div className="text-[10px] text-text-secondary">المنفذ</div></div>
              <div className="bg-surface rounded-lg p-2 text-center"><div className={`text-lg font-bold ${getPctColor(detail.sales_pct)}`}>{fmtPct(detail.sales_pct)}</div><div className="text-[10px] text-text-secondary">نسبة الإنجاز</div></div>
              <div className="bg-surface rounded-lg p-2 text-center"><div className="text-lg font-bold text-red-500">{fmtMoney(Math.max(0, (member?.kpis.sales.target ?? detail.sales_target ?? 0) - (member?.kpis.sales.actual ?? detail.sales_value)))}</div><div className="text-[10px] text-text-secondary">المتبقي</div></div>
              <div className="bg-surface rounded-lg p-2 text-center"><div className="text-lg font-bold text-text">{detail.day_count}</div><div className="text-[10px] text-text-secondary">أيام العمل</div></div>
              <div className="bg-surface rounded-lg p-2 text-center"><div className="text-lg font-bold text-text">{detail.day_count > 0 ? fmtMoney(Math.round((member?.kpis.sales.actual ?? detail.sales_value) / detail.day_count)) : '\u2014'}</div><div className="text-[10px] text-text-secondary">المعدل/يوم</div></div>
            </div>

            {detail.sales_pct != null && (member?.kpis.sales.target ?? detail.sales_target ?? 0) > 0 && (
              <div>
                <div className="w-full bg-gray-200 rounded-full h-3 relative overflow-hidden">
                  <div className={`h-3 rounded-full transition-all ${getBarColor(detail.sales_pct)}`} style={{ width: `${Math.min(100, detail.sales_pct)}%` }} />
                </div>
                <div className="flex justify-between mt-1 text-[10px]">
                  <span className="font-semibold text-text">{fmtPct(detail.sales_pct)} محقق</span>
                  <span className="text-text-secondary">{fmtPct(100 - Math.min(100, detail.sales_pct || 0))} متبقي</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {achievementItems.length > 0 && (
          <div className="bg-white rounded-xl border border-emerald-200 shadow-sm overflow-hidden">
            <h2 className="text-sm font-bold text-text px-4 pt-4 pb-2 border-b border-border/50">الإنجاز مقابل الهدف</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-surface/80">
                    <th className="px-3 py-2.5 text-right font-semibold text-text-secondary">المؤشر</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-text-secondary">الهدف</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-text-secondary">المنفذ</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-text-secondary">%</th>
                    <th className="px-3 py-2.5 text-left font-semibold text-text-secondary min-w-[100px]">التقدم</th>
                    <th className="px-3 py-2.5 text-center font-semibold text-text-secondary">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                    {achievementItems.map((item) => {
                    const pct = item.pct
                    const status = getStatusLabel(pct)
                    const kpiKey = ({ 'المبيعات': 'sales', 'الزيارات': 'visits', 'الطلبات': 'orders', 'عملاء جدد': 'customers' })[item.label] || ''
                    return (
                      <tr key={item.label} className="border-t border-border/40 hover:bg-surface/30 transition-colors">
                        <td className="px-3 py-2.5 font-semibold text-text-secondary">{item.label}</td>
                        <td className="px-3 py-2.5 text-left font-mono">{fmtMoney(item.target)}</td>
                        <td className="px-3 py-2.5 text-left font-mono cursor-pointer text-blue-600 hover:underline" onClick={() => kpiKey && handleKpiClick(kpiKey)}>{fmtMoney(item.actual)}</td>
                        <td className={`px-3 py-2.5 text-left font-bold font-mono ${getPctColor(pct)}`}>{fmtPct(pct)}</td>
                        <td className="px-3 py-2.5">
                          <div className="w-full bg-gray-200 rounded-full h-2 min-w-[80px]">
                            <div className={`h-2 rounded-full ${getBarColor(pct)}`} style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${status.bg} ${status.color}`}>{status.label}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border/80 bg-surface/50">
                    <td className="px-3 py-2.5 font-bold text-text">الإجمالي</td>
                    <td className="px-3 py-2.5" />
                    <td className="px-3 py-2.5" />
                    <td className={`px-3 py-2.5 text-left font-bold font-mono ${getPctColor(member?.overall_achievement_score)}`}>{fmtPct(member?.overall_achievement_score)}</td>
                    <td className="px-3 py-2.5">
                      <div className="w-full bg-gray-200 rounded-full h-2 min-w-[80px]">
                        <div className={`h-2 rounded-full ${getBarColor(member?.overall_achievement_score)}`} style={{ width: `${Math.min(100, member?.overall_achievement_score ?? 0)}%` }} />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${getStatusLabel(member?.overall_achievement_score).bg} ${getStatusLabel(member?.overall_achievement_score).color}`}>{getStatusLabel(member?.overall_achievement_score).label}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        <div className={`rounded-xl border p-4 shadow-sm ${
          insight.color === 'green' ? 'bg-green-50/40 border-green-200' :
          insight.color === 'yellow' ? 'bg-yellow-50/40 border-yellow-200' :
          insight.color === 'red' ? 'bg-red-50/40 border-red-200' :
          'bg-gray-50/40 border-gray-200'
        }`}>
          <h3 className="text-sm font-bold text-text mb-2">تحليل الأداء</h3>
          <div className="flex items-center gap-2 mb-2">
            <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
              insight.color === 'green' ? 'bg-green-200 text-green-800' :
              insight.color === 'yellow' ? 'bg-yellow-200 text-yellow-800' :
              insight.color === 'red' ? 'bg-red-200 text-red-800' :
              'bg-gray-200 text-gray-800'
            }`}>{insight.verdict}</span>
            <span className="text-xs text-text-secondary">{insight.explanation}</span>
          </div>
          {insight.details.length > 0 && (
            <ul className="text-xs space-y-1">
              {insight.details.map((d, i) => (
                <li key={i} className="flex items-center gap-1.5 text-text-secondary">
                  <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
                  {d}
                </li>
              ))}
            </ul>
          )}
        </div>

        {repSessions.length > 0 && (
          <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
            <h2 className="text-sm font-bold text-text px-4 pt-4 pb-2 border-b border-border/50">تفاصيل الجلسات ({repSessions.length})</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="bg-surface/80">
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
                      <td className="px-2 py-1.5 cursor-pointer text-blue-600 hover:underline" onClick={() => s.date && handleSessionKpiClick('visits', s.date)}>{fmtNum(s.visit_count)}</td>
                      <td className="px-2 py-1.5 cursor-pointer text-blue-600 hover:underline" onClick={() => s.date && handleSessionKpiClick('orders', s.date)}>{fmtNum(s.order_count)}</td>
                      <td className="px-2 py-1.5 cursor-pointer text-blue-600 hover:underline" onClick={() => s.date && handleSessionKpiClick('sales', s.date)}>{fmtMoney(s.sales_value)}</td>
                      <td className="px-2 py-1.5 cursor-pointer text-blue-600 hover:underline" onClick={() => s.date && handleSessionKpiClick('collections', s.date)}>{fmtMoney(s.collection_amount)}</td>
                      <td className="px-2 py-1.5 cursor-pointer text-blue-600 hover:underline" onClick={() => s.date && handleSessionKpiClick('customers', s.date)}>{fmtNum(s.new_customer_count)}</td>
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
        <KpiDrillDownModal
          open={dd.kpiType !== null}
          title={dd.title}
          recordType={dd.recordType}
          records={dd.records}
          loading={dd.loading}
          onClose={() => setDd({ ...dd, kpiType: null })}
          onRecordClick={(entityType, entityId) => {
            saveScrollBeforeNavigate()
            setDd({ ...dd, kpiType: null })
            const routes: Record<string, string> = {
              order: `/orders/${entityId}`,
              customer: `/customers/${entityId}`,
              visit: `/visits/${entityId}`,
              collection: `/collections`,
            }
            nav(routes[entityType] || '#')
          }}
        />
        <TrackingExplorerModal
          open={showTrackingExplorer}
          onClose={() => { setShowTrackingExplorer(false); setTrackingMapData(null) }}
          employeeName={detail.employee_name}
          employeeCode={detail.employee_code}
          date={effectiveFrom || ''}
          sessionStart={repTimeline?.session?.start_time}
          sessionEnd={repTimeline?.session?.end_time}
          timeline={repTimeline}
          mapData={trackingMapData}
        />
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
          {(['today', 'week', 'month', 'previous_month', 'custom'] as PeriodType[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`flex-1 text-[11px] py-1.5 rounded-md font-semibold transition-colors ${period === p ? 'bg-primary text-white' : 'text-text-secondary hover:text-text'}`}>
              {p === 'today' ? 'اليوم' : p === 'week' ? 'الأسبوع' : p === 'month' ? 'الشهر' : p === 'previous_month' ? 'الشهر الماضي' : 'مخصص'}
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
              <div className={`bg-surface rounded-lg p-2 text-center`}><span className={`font-bold text-lg ${avgAchievement != null && avgAchievement >= 80 ? 'text-green-600' : avgAchievement != null && avgAchievement >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>{fmtPct(avgAchievement)}</span><div className="text-text-secondary text-[10px]">إنجاز</div></div>
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
            <button onClick={exportToPDF}
              className="bg-red-600 text-white text-xs px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap">PDF</button>
            <button onClick={exportToExcel}
              className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap">Excel</button>
          </div>
          {showColMenu && <div className="fixed inset-0 z-10" onClick={() => setShowColMenu(false)} />}

          {filteredRows.length > 0 ? (
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <div className="overflow-auto max-h-[550px] relative" ref={tableRef}>
                <table className="w-full text-xs border-separate border-spacing-0">
                  <thead>
                    <tr>
                      {cols.map((col, ci) => (
                        <th key={col.key}
                          className={`px-2 py-2 text-right font-semibold text-text-secondary bg-surface ${col.numeric ? 'cursor-pointer hover:bg-gray-100 select-none' : ''}`}
                          style={{ ...(ci === 0 ? stickyHeadStyle : {}), minWidth: col.key === 'employee_name' ? 120 : col.key === 'employee_code' ? 70 : 80 }}
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
                    {filteredRows.map((row, i) => {
                      const rowStatus = getStatusLabel(row.overall_score)
                      const kpiCellCol = (colKey: string) => {
                        const kpiMap: Record<string, string> = { visit_count: 'visits', order_count: 'orders', sales_value: 'sales', collection_amount: 'collections', new_customer_count: 'customers' }
                        return kpiMap[colKey] || ''
                      }
                      return (
                      <tr key={row.employee_id}
                        className={`border-t border-border/50 cursor-pointer transition-colors ${rowStatus.bg.replace('bg-', 'bg-').replace('50', '50/30')} hover:brightness-95`}
                        onClick={() => setSelectedRepId(row.employee_id)}>
                        {cols.map((col, ci) => {
                          const kk = kpiCellCol(col.key)
                          return (
                          <td key={col.key}
                            style={ci === 0 ? stickyStyle : undefined}
                            className={`px-2 py-2 ${ci === 0 ? 'font-semibold' : ''} ${col.key === 'overall_score' ? getPctColor(row.overall_score) : ''} ${kk ? 'cursor-pointer text-blue-600 hover:underline' : ''}`}
                            onClick={kk ? (e) => { e.stopPropagation(); handleKpiClick(kk, row.employee_id) } : undefined}>
                            {col.key === 'employee_name' ? row.employee_name
                              : col.key === 'employee_code' ? row.employee_code
                              : fmtCellVal(col.key, row)}
                          </td>
                        )})}
                        {showDetailCol && <td className="px-2 py-2"><button className="text-primary text-[10px] font-semibold">عرض ←</button></td>}
                      </tr>
                    )})}
                    {totalsRow && (
                      <tr className="border-t-2 border-border bg-surface font-bold sticky bottom-0">
                        {cols.map((col, ci) => (
                          <td key={col.key} style={ci === 0 ? { ...stickyStyle, background: 'rgb(249 250 251)' } : undefined} className="px-2 py-2">
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
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-green-600">{fmtMoney(workdayTotals?.total_sales ?? perfData?.company?.sales_actual ?? 0)}</div><div className="text-[10px] text-text-secondary">إجمالي المبيعات <span className="text-[8px] text-text-secondary">(نشاط)</span></div></div>
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtNum(workdayTotals?.total_orders ?? 0)}</div><div className="text-[10px] text-text-secondary">إجمالي الطلبات <span className="text-[8px] text-text-secondary">(نشاط)</span></div></div>
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtNum(workdayTotals?.total_visits ?? 0)}</div><div className="text-[10px] text-text-secondary">إجمالي الزيارات <span className="text-[8px] text-text-secondary">(نشاط)</span></div></div>
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtMoney(workdayTotals?.total_collection_amount ?? 0)}</div><div className="text-[10px] text-text-secondary">إجمالي التحصيل <span className="text-[8px] text-text-secondary">(نشاط)</span></div></div>
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtNum(workdayTotals?.total_new_customers ?? 0)}</div><div className="text-[10px] text-text-secondary">عملاء جدد <span className="text-[8px] text-text-secondary">(نشاط)</span></div></div>
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className={`text-lg font-bold ${getPctColor(perfData?.company?.overall_achievement_pct)}`}>{fmtPct(perfData?.company?.overall_achievement_pct)}</div><div className="text-[10px] text-text-secondary">نسبة الإنجاز <span className="text-[8px] text-text-secondary">(أهداف)</span></div></div>
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{fmtNum(workdayTotals?.total_employees ?? perfData?.employees?.length ?? 0)}</div><div className="text-[10px] text-text-secondary">إجمالي المندوبين</div></div>
            <div className="bg-white rounded-lg border border-border p-3 text-center"><div className="text-lg font-bold text-text">{allManagers.length}</div><div className="text-[10px] text-text-secondary">عدد المدراء</div></div>
          </div>

          {allManagers.length > 0 && (
            <div className="bg-gradient-to-r from-primary/5 to-transparent rounded-lg border border-primary/10 p-3 text-xs">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-text-secondary">
                <span>عدد المدراء: <strong className="text-text">{allManagers.length}</strong></span>
              </div>
            </div>
          )}

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
