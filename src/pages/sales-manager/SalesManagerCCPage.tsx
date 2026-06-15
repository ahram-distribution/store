import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, toEnglishDigits } from '../../utils/format'
import { locationService } from '../../services/location'
import { getCurrentLocation } from '../../services/gpsService'
import { VisitCard } from '../../components/visits/VisitCard'
import toast from 'react-hot-toast'

const BUSINESS_TYPES = [
  { value: 'wholesaler', label: 'تاجر جملة' },
  { value: 'distributor', label: 'موزع' },
  { value: 'cosmetics_store', label: 'متجر مستحضرات تجميل' },
  { value: 'supermarket', label: 'سوبر ماركت' },
  { value: 'hypermarket', label: 'هايبر ماركت' },
  { value: 'perfume_store', label: 'متجر عطور / عطار' },
  { value: 'pharmacy', label: 'صيدلية' },
  { value: 'warehouse', label: 'مخزن' },
  { value: 'other', label: 'أخرى' },
]

interface ActiveSession {
  employee_id: string
  employee_name: string
  session_status: string
  started_at: string
  duration_minutes: number
  net_minutes: number
  break_minutes: number
  work_status: string
  order_count: number
  sales_value: number
  latitude: number | null
  longitude: number | null
  last_seen_at: string | null
  connection_status: string
}

interface NoStartEmployee {
  employee_id: string
  employee_name: string
}

interface EndedEmployee {
  employee_id: string
  employee_name: string
  ended_at: string
  duration_minutes: number
  visit_count: number
}

interface TeamOverview {
  member_count: number
  active_today: number
  customer_count: number
}

interface AttendanceData {
  active_sessions: ActiveSession[]
  no_start_employees: NoStartEmployee[]
  ended_employees: EndedEmployee[]
  active_count: number
  on_visit_count: number
  on_break_count: number
  no_start_count: number
  ended_count: number
}

interface OrdersData {
  today_orders: number
  today_sales: number
  month_orders: number
  month_sales: number
  pending_followup: number
  pending_collections: number
}

interface VisitsData {
  active_visits: number
  today_visits: number
  month_visits: number
}

interface CustomersData {
  total_customers: number
  new_customers_month: number
  inactive_customers: number
}

interface MemberPerf {
  employee_id: string
  employee_code: string
  employee_name: string
  customer_count: number
  month_orders: number
  month_sales: number
  today_orders: number
  today_visits: number
  month_visits: number
  sales_target: number
  visits_target: number
  orders_target: number
  new_customers_target: number
  achievement_pct: number
}

interface TeamTargets {
  sales_target: number
  visits_target: number
  orders_target: number
  new_customers_target: number
  sales_achievement: number
  visits_achievement: number
  orders_achievement: number
  new_customers_achievement: number
  sales_achievement_pct: number
  visits_achievement_pct: number
  orders_achievement_pct: number
  new_customers_achievement_pct: number
}

interface TeamPerformance {
  members: MemberPerf[]
  team_targets: TeamTargets
}

interface PersonalSummary {
  customer_count: number
  month_orders: number
  month_sales: number
  today_orders: number
  active_visits: number
  today_visits: number
  month_visits: number
  pending_collections: number
}

interface SalesManagerCC {
  team_overview: TeamOverview
  attendance: AttendanceData
  orders: OrdersData
  visits: VisitsData
  customers: CustomersData
  team_performance: TeamPerformance
  personal_summary: PersonalSummary
}

const POLLING_INTERVAL = 30000

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => Number.isFinite(n) ? n.toLocaleString('ar-EG-u-nu-latn') : '0'
const fmtPct = (n: number) => Number.isFinite(n) ? n.toFixed(1) + '%' : '0.0%'
const pctColor = (pct: number) => pct >= 100 ? 'text-success' : pct >= 50 ? 'text-warning' : 'text-red-500'

export default function SalesManagerCCPage() {
  const nav = useNavigate()
  const [data, setData] = useState<SalesManagerCC | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState('overview')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<string>('month')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  /* Add Employee fields */
  const [empName, setEmpName] = useState('')
  const [empPhone, setEmpPhone] = useState('')
  const [empPassword, setEmpPassword] = useState('')
  const [empEmail, setEmpEmail] = useState('')
  const [empAddress, setEmpAddress] = useState('')
  const [empRoleId, setEmpRoleId] = useState('')
  const [roles, setRoles] = useState<any[]>([])

  /* Add Customer fields */
  const [custName, setCustName] = useState('')
  const [custPhone, setCustPhone] = useState('')
  const [custPassword, setCustPassword] = useState('')
  const [custResponsible, setCustResponsible] = useState('')
  const [custBusinessType, setCustBusinessType] = useState('')
  const [custAddress, setCustAddress] = useState('')
  const [custCreditLimit, setCustCreditLimit] = useState('')
  const [custCreditDays, setCustCreditDays] = useState('')
  const [custLocation, setCustLocation] = useState<{ latitude: number | null; longitude: number | null; accuracyMeters: number | null }>({ latitude: null, longitude: null, accuracyMeters: null })
  const [custLocating, setCustLocating] = useState(false)
  const [custOwnerId, setCustOwnerId] = useState('')
  const [teamMembers, setTeamMembers] = useState<any[]>([])

  /* Customer picker for order/visit */
  const [showCustomerPicker, setShowCustomerPicker] = useState<'order' | 'visit' | null>(null)
  const [customers, setCustomers] = useState<any[]>([])
  const [custSearchQuery, setCustSearchQuery] = useState('')

  /* Visit checkout */
  const [activeVisitId, setActiveVisitId] = useState<string | null>(null)
  const [visitResult, setVisitResult] = useState('')
  const [visitNotes, setVisitNotes] = useState('')

  /* Visits list inline */
  const [visitsList, setVisitsList] = useState<any[]>([])
  const [visitsLoading, setVisitsLoading] = useState(false)
  const [visitsFilter, setVisitsFilter] = useState<'all' | 'active' | 'today'>('all')
  const [customerMap, setCustomerMap] = useState<Map<string, string>>(new Map())
  const [employeeVisitMap, setEmployeeVisitMap] = useState<Map<string, string>>(new Map())

  /* Visit detail inline */
  const [selectedVisit, setSelectedVisit] = useState<any | null>(null)
  const [selectedVisitLoading, setSelectedVisitLoading] = useState(false)
  const [visitDetailCustName, setVisitDetailCustName] = useState('')
  const [visitDetailEmpName, setVisitDetailEmpName] = useState('')
  const [visitDetailStartAddr, setVisitDetailStartAddr] = useState('')
  const [visitDetailEndAddr, setVisitDetailEndAddr] = useState('')

  const token = getToken()

  const fetchData = useCallback(async () => {
    if (!token) return
    const { data: result, error } = await supabase.rpc('get_sales_manager_cc', { p_token: token?.trim() })
    if (error || (result && typeof result === 'object' && (result as Record<string, unknown>).error)) {
      const msg: string = (result as Record<string, unknown>)?.error as string || error?.message || 'خطأ في تحميل البيانات'
      if (msg === 'INVALID_SESSION') toast.error('جلسة منتهية — الرجاء إعادة تسجيل الدخول')
      else if (msg === 'FORBIDDEN') toast.error('ليس لديك صلاحية لعرض هذه الصفحة')
      else toast.error(msg)
      setLoading(false)
      return
    }
    if (result && typeof result === 'object') {
      setData(result as unknown as SalesManagerCC)
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchData(); const id = setInterval(fetchData, POLLING_INTERVAL); return () => clearInterval(id) }, [fetchData])

  const loadRoles = useCallback(async () => {
    if (roles.length > 0) return
    const t = getToken()
    if (!t) return
    const { data: r } = await supabase.rpc('get_governed_roles', { p_token: t })
    if (r) setRoles(Array.isArray(r) ? r : [])
  }, [roles.length])

  useEffect(() => { if (showAddEmployee) loadRoles() }, [showAddEmployee, loadRoles])

  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!empName.trim() || !empPhone.trim()) { toast.error('الاسم ورقم الهاتف مطلوبان'); return }
    setSubmitting(true)
    const t = getToken()
    const salesRepRole = roles.find((r: any) => r.name === 'مندوب مبيعات')
    const { data, error } = await supabase.rpc('governed_create_employee', {
      p_token: t, p_full_name: empName.trim(), p_phone: empPhone.trim(),
      p_password: empPassword || null, p_email: empEmail || null,
      p_role_id: salesRepRole?.id || null, p_manager_id: null, p_address: empAddress || null,
    })
    setSubmitting(false)
    if (error) { toast.error(error.message); return }
    const res = data as any
    if (res?.error) { toast.error(res.error); return }
    toast.success(`تم إضافة ${res.full_name}`)
    setShowAddEmployee(false); setEmpName(''); setEmpPhone(''); setEmpPassword(''); setEmpEmail(''); setEmpAddress('')
    fetchData()
  }

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!custName.trim()) { toast.error('يرجى إدخال اسم النشاط التجاري'); return }
    if (!custPhone.trim()) { toast.error('يرجى إدخال رقم الهاتف'); return }
    if (!/^01[0-9]{9}$/.test(custPhone.trim())) { toast.error('رقم الهاتف غير صالح'); return }
    setSubmitting(true)
    const t = getToken()
    const { data, error } = await supabase.rpc('governed_create_customer', {
      p_token: t, p_company_name: custName.trim(), p_phone: custPhone.trim() || null,
      p_contact_name: custResponsible.trim() || null, p_contact_phone: custPhone.trim() || null,
      p_business_type: custBusinessType || null, p_responsible_name: custResponsible.trim() || null,
      p_password: custPassword || null, p_formatted_address: custAddress.trim() || null,
      p_latitude: custLocation.latitude, p_longitude: custLocation.longitude,
      p_accuracy_meters: custLocation.accuracyMeters, p_credit_limit: custCreditLimit ? Number(custCreditLimit) : null,
      p_credit_days: custCreditDays ? Number(custCreditDays) : null,
    })
    if (error) { setSubmitting(false); toast.error(error.message); return }
    const res = data as any
    if (res?.error) { setSubmitting(false); toast.error(res.error); return }
    const customerId = res.id as string
    /* Transfer to selected team member if different from self */
    if (custOwnerId && customerId) {
      const { error: xferErr } = await supabase.rpc('governed_change_customer_ownership', {
        p_token: t, p_customer_id: customerId, p_new_owner_id: custOwnerId, p_reason: 'إضافة عميل بواسطة مدير البيع',
      })
      if (xferErr) toast.error('تم إنشاء العميل لكن فشل نقل الملكية: ' + xferErr.message)
    }
    setSubmitting(false)
    toast.success('تم إنشاء العميل بنجاح')
    setShowAddCustomer(false); setCustName(''); setCustPhone(''); setCustPassword(''); setCustResponsible('')
    setCustBusinessType(''); setCustAddress(''); setCustCreditLimit(''); setCustCreditDays('')
    setCustLocation({ latitude: null, longitude: null, accuracyMeters: null }); setCustOwnerId('')
    fetchData()
  }

  const handleCaptureLocation = async () => {
    setCustLocating(true)
    const result = await getCurrentLocation()
    setCustLocating(false)
    if (result.success && result.location) {
      setCustLocation({ latitude: result.location.latitude, longitude: result.location.longitude, accuracyMeters: result.location.accuracy })
      const acc = result.location.accuracy
      if (acc > 50) toast('⚠️ دقة الموقع منخفضة (' + acc + 'م)', { duration: 5000 })
      else toast.success('تم تحديد الموقع (' + acc + 'م)')
    } else {
      toast.error(result.error?.message || 'فشل تحديد الموقع')
    }
  }

  const fetchCustomers = useCallback(async () => {
    const t = getToken()
    if (!t || customers.length > 0) return
    const { data } = await supabase.rpc('get_governed_customers', { p_token: t })
    if (data) setCustomers(Array.isArray(data) ? data : typeof data === 'object' && data !== null ? [data] : [])
  }, [customers.length])

  const handlePickCustomer = async (customer: any) => {
    const t = getToken()
    if (!t) return
    if (showCustomerPicker === 'order') {
      nav(`/orders/new?customer=${customer.id}`)
    } else if (showCustomerPicker === 'visit') {
      const { data, error } = await supabase.rpc('governed_checkin_visit', {
        p_token: t, p_customer_id: customer.id,
      })
      if (error) { toast.error(error.message); setShowCustomerPicker(null); return }
      const res = data as any
      if (res?.error) { toast.error(res.error); setShowCustomerPicker(null); return }
      setActiveVisitId(res.id as string)
      setShowCustomerPicker(null)
      setVisitResult('')
      setVisitNotes('')
      toast.success(`بدء زيارة لـ ${customer.company_name}`)
    }
  }

  const fetchVisits = useCallback(async () => {
    setVisitsLoading(true)
    const t = getToken()
    if (!t) { setVisitsLoading(false); return }
    const [visRes, custRes, empRes] = await Promise.all([
      supabase.rpc('get_governed_visits', { p_token: t }),
      supabase.rpc('get_governed_customers', { p_token: t }),
      supabase.rpc('get_governed_employees', { p_token: t }),
    ])
    if (visRes.data) setVisitsList(Array.isArray(visRes.data) ? visRes.data : [])
    if (custRes.data) {
      const list = Array.isArray(custRes.data) ? custRes.data : []
      const m = new Map<string, string>()
      for (const c of list) m.set(c.id, c.company_name)
      setCustomerMap(m)
    }
    if (empRes.data) {
      const list = Array.isArray(empRes.data) ? empRes.data : []
      const m = new Map<string, string>()
      for (const e of list) m.set(e.id, e.full_name)
      setEmployeeVisitMap(m)
    }
    setVisitsLoading(false)
  }, [])

  const openVisitDetail = async (visitId: string) => {
    setSelectedVisitLoading(true)
    setActiveSection('visit_detail')
    setVisitDetailCustName(''); setVisitDetailEmpName(''); setVisitDetailStartAddr(''); setVisitDetailEndAddr('')
    const t = getToken()
    if (!t) { setSelectedVisitLoading(false); return }
    const { data } = await supabase.rpc('get_governed_visit', { p_token: t, p_id: visitId })
    if (data) {
      setSelectedVisit(data as any)
      const v = data as any
      if (v.customer_id) {
        supabase.rpc('get_governed_customer', { p_token: t, p_id: v.customer_id })
          .then(({ data: cd }) => { if (cd) setVisitDetailCustName(Array.isArray(cd) ? cd[0]?.company_name : (cd as any)?.company_name || '') })
      }
      if (v.employee_id) {
        supabase.rpc('get_governed_employee', { p_token: t, p_employee_id: v.employee_id })
          .then(({ data: ed }) => { if (ed && !(ed as any)?.error) setVisitDetailEmpName((ed as any)?.full_name || '') })
      }
      const slat = Number(v.check_in_latitude); const slng = Number(v.check_in_longitude)
      const elat = Number(v.check_out_latitude); const elng = Number(v.check_out_longitude)
      if (slat && slng) locationService.reverseGeocode(slat, slng).then(a => { if (a) setVisitDetailStartAddr(a) })
      if (elat && elng) locationService.reverseGeocode(elat, elng).then(a => { if (a) setVisitDetailEndAddr(a) })
    }
    setSelectedVisitLoading(false)
  }

  const handleCheckoutVisit = async () => {
    if (!activeVisitId) return
    const t = getToken()
    if (!t) return
    setSubmitting(true)
    const { error } = await supabase.rpc('governed_checkout_visit', {
      p_token: t, p_visit_id: activeVisitId,
      p_visit_result: visitResult || null, p_notes: visitNotes || null,
    })
    setSubmitting(false)
    if (error) { toast.error(error.message); return }
    setActiveVisitId(null); setVisitResult(''); setVisitNotes('')
    toast.success('تم إنهاء الزيارة')
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
  if (!data) return <div className="text-center py-12 text-text-secondary text-sm">لا توجد بيانات</div>

  const { team_overview: tov, attendance: att, orders: ord, visits: vis, customers: cust, team_performance: tp, personal_summary: ps } = data
  const tt = tp?.team_targets

  const sections = [
    { key: 'overview', label: 'نظرة عامة' },
    { key: 'attendance', label: 'الحضور', nav: '/attendance/operations' },
    { key: 'orders', label: 'الطلبات' },
    { key: 'visits', label: 'الزيارات' },
    { key: 'customers', label: 'العملاء' },
    { key: 'performance', label: 'الأداء' },
    { key: 'personal', label: 'بياناتي' },
    { key: 'actions', label: 'إجراءات' },
  ]

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 bg-white border-b border-border pb-2 pt-2">
        <h1 className="text-lg font-bold text-text mb-2">مركز قيادة المبيعات</h1>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {sections.map(s => (
            <button key={s.key} onClick={() => (s as any).nav ? nav((s as any).nav) : setActiveSection(s.key)}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                activeSection === s.key ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border/50'
              }`}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. Team Overview */}
      <div className="grid grid-cols-3 gap-3">
        <Card label="أعضاء الفريق" value={fmt(tov?.member_count ?? 0)} icon="👥" onClick={() => setActiveSection('members')} />
        <Card label="نشط اليوم" value={fmt(tov?.active_today ?? 0)} icon="✅" onClick={() => nav('/attendance/operations')} />
        <Card label="العملاء" value={fmt(tov?.customer_count ?? 0)} icon="👤" onClick={() => setActiveSection('customers')} />
      </div>

      {/* Team Members Cards */}
      {activeSection === 'members' && tp?.members && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-text">أعضاء الفريق</h3>
            <div className="flex gap-1.5">
              <button onClick={() => { setShowAddCustomer(true); setCustOwnerId(''); }} className="text-[10px] bg-accent/10 text-accent px-2.5 py-1 rounded-lg font-semibold">+ عميل</button>
              <button onClick={() => setShowAddEmployee(true)} className="text-[10px] bg-primary/10 text-primary px-2.5 py-1 rounded-lg font-semibold">+ مندوب</button>
              <button onClick={() => setActiveSection('overview')} className="text-xs text-text-secondary font-semibold">رجوع</button>
            </div>
          </div>
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            placeholder="بحث بالاسم أو الكود..."
            className="w-full text-xs px-3 py-2 rounded-lg border border-border bg-surface mb-3 focus:outline-none focus:border-primary transition-colors" />
          <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 scrollbar-none">
            {[
              { key: 'today', label: 'اليوم' },
              { key: 'yesterday', label: 'اليوم السابق' },
              { key: 'week', label: 'الأسبوع الحالي' },
              { key: 'month', label: 'هذا الشهر' },
              { key: 'prev_month', label: 'الشهر السابق' },
              { key: 'custom', label: 'فترة محددة' },
            ].map(f => (
              <button key={f.key} onClick={() => setDateFilter(f.key)}
                className={`shrink-0 text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                  dateFilter === f.key ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border/50'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
          {dateFilter === 'custom' && (
            <div className="flex gap-2 mb-3">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary" />
              <span className="text-xs text-text-secondary self-center">إلى</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-border bg-surface focus:outline-none focus:border-primary" />
            </div>
          )}
          <div className="flex gap-2 mb-3">
            <button onClick={() => { setShowCustomerPicker('order'); fetchCustomers(); }}
              className="flex-1 text-xs bg-primary/10 text-primary py-2 rounded-lg font-semibold border border-primary/20 text-center">🛒 إنشاء طلب</button>
            <button onClick={() => { setShowCustomerPicker('visit'); fetchCustomers(); }}
              className="flex-1 text-xs bg-accent/10 text-accent py-2 rounded-lg font-semibold border border-accent/20 text-center">📍 بدء زيارة</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {tp.members
              .filter(m => {
                if (!searchQuery) return true
                const q = searchQuery.toLowerCase()
                return m.employee_name?.toLowerCase().includes(q) || m.employee_code?.toLowerCase().includes(q)
              })
              .map(m => (
              <button key={m.employee_id} onClick={() => nav(`/employees/${m.employee_id}`)}
                className="bg-white rounded-xl border border-border p-3 text-right active:bg-surface transition-colors">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mb-2 mx-auto">
                  <span className="text-sm font-bold text-primary">{m.employee_name?.charAt(0) || '?'}</span>
                </div>
                <p className="text-sm font-bold text-text text-center truncate">{m.employee_name}</p>
                <p className="text-[10px] text-text-secondary text-center mb-2">{m.employee_code}</p>
                <div className="grid grid-cols-2 gap-1 text-center">
                  <div className="bg-surface rounded p-1">
                    <p className="text-xs font-bold text-text">
                      {dateFilter === 'today' || dateFilter === 'yesterday' ? fmt(m.today_orders) : fmt(m.month_orders)}
                    </p>
                    <p className="text-[8px] text-text-secondary">طلبات</p>
                  </div>
                  <div className="bg-surface rounded p-1">
                    <p className="text-xs font-bold text-text">
                      {dateFilter === 'today' || dateFilter === 'yesterday' ? fmt(m.today_visits) : fmt(m.month_visits)}
                    </p>
                    <p className="text-[8px] text-text-secondary">زيارات</p>
                  </div>
                  <div className="bg-surface rounded p-1">
                    <p className="text-xs font-bold text-text">{fmt(m.customer_count)}</p>
                    <p className="text-[8px] text-text-secondary">عملاء</p>
                  </div>
                  <div className="bg-surface rounded p-1">
                    <p className={`text-xs font-bold ${pctColor(m.achievement_pct)}`}>
                      {m.sales_target > 0 ? fmtPct(m.achievement_pct) : '—'}
                    </p>
                    <p className="text-[8px] text-text-secondary">إنجاز</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {tp.members.filter(m => {
            if (!searchQuery) return true
            const q = searchQuery.toLowerCase()
            return m.employee_name?.toLowerCase().includes(q) || m.employee_code?.toLowerCase().includes(q)
          }).length === 0 && (
            <p className="text-center text-xs text-text-secondary py-8">لا يوجد أعضاء مطابقين</p>
          )}
        </div>
      )}

      {/* 2. Attendance redirects to Operations Center */}
      {activeSection === 'attendance' && (
        <div className="bg-white rounded-xl border border-border p-8 text-center space-y-3">
          <p className="text-sm text-text-secondary">يتم تحويلك إلى شاشة الحضور والانصراف كاملة...</p>
          <button onClick={() => nav('/attendance/operations')}
            className="text-sm bg-primary/10 text-primary px-6 py-2 rounded-lg font-semibold border border-primary/20">
            اضغط هنا إذا لم يتم التحويل تلقائياً
          </button>
        </div>
      )}

      {/* 3. Orders Monitoring */}
      {activeSection === 'orders' && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">مراقبة الطلبات</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card label="طلبات اليوم" value={fmt(ord?.today_orders ?? 0)} icon="📋" />
            <Card label="مبيعات اليوم" value={formatCurrencyShort(ord?.today_sales ?? 0)} icon="💰" />
            <Card label="طلبات الشهر" value={fmt(ord?.month_orders ?? 0)} icon="📊" />
            <Card label="مبيعات الشهر" value={formatCurrencyShort(ord?.month_sales ?? 0)} icon="📈" />
            <Card label="بانتظار الاعتماد" value={fmt(ord?.pending_followup ?? 0)} icon="⏳" />
            <Card label="تحصيلات معلقة" value={formatCurrencyShort(ord?.pending_collections ?? 0)} icon="💳" />
          </div>
          <div className="flex gap-2 mt-3">
            <ActionBtn label="كل الطلبات" onClick={() => nav('/orders')} />
            <ActionBtn label="اعتماد الطلبات" onClick={() => nav('/orders/approval-queue')} />
            <ActionBtn label="التحصيلات" onClick={() => nav('/collections')} />
          </div>
        </div>
      )}

      {/* 4. Visits Monitoring */}
      {activeSection === 'visits' && (
        <div>
          <div className="bg-white rounded-xl border border-border p-4 mb-0">
            <h3 className="text-sm font-bold text-text mb-3">مراقبة الزيارات</h3>
            <div className="grid grid-cols-3 gap-3">
              <Card label="زيارات نشطة" value={fmt(vis?.active_visits ?? 0)} icon="📍" />
              <Card label="زيارات اليوم" value={fmt(vis?.today_visits ?? 0)} icon="📅" />
              <Card label="زيارات الشهر" value={fmt(vis?.month_visits ?? 0)} icon="📊" />
            </div>
            <div className="flex gap-2 mt-3">
              <ActionBtn label="كل الزيارات" onClick={() => { fetchVisits(); setActiveSection('visits_list') }} />
              <ActionBtn label="زيارة جديدة" onClick={() => { setShowCustomerPicker('visit'); fetchCustomers() }} />
            </div>
          </div>
        </div>
      )}

      {/* 4b. Visits List Inline */}
      {activeSection === 'visits_list' && (
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-text">كل الزيارات</h3>
            <button onClick={() => setActiveSection('visits')} className="text-xs text-primary font-semibold">رجوع</button>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 scrollbar-none">
            {[
              { key: 'all', label: 'الكل' },
              { key: 'active', label: 'نشط' },
              { key: 'today', label: 'اليوم' },
            ].map(f => (
              <button key={f.key} onClick={() => setVisitsFilter(f.key)}
                className={`shrink-0 text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-colors ${
                  visitsFilter === f.key ? 'bg-primary text-white' : 'bg-surface text-text-secondary border border-border/50'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
          {visitsLoading ? (
            <p className="text-center text-xs text-text-secondary py-8">جاري التحميل...</p>
          ) : (() => {
            const filtered = visitsList.filter((v: any) => {
              if (visitsFilter === 'active') return v.status === 'active'
              if (visitsFilter === 'today') {
                const d = new Date(v.check_in_at || v.created_at); const n = new Date()
                return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
              }
              return true
            })
            return filtered.length === 0 ? (
              <p className="text-center text-xs text-text-secondary py-8">لا توجد زيارات</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {filtered.map((v: any) => (
                  <VisitCard key={v.id} visit={v}
                    customerName={customerMap.get(v.customer_id)}
                    employeeName={employeeVisitMap.get(v.employee_id)}
                    onClick={() => openVisitDetail(v.id)} />
                ))}
              </div>
            )
          })()}
        </div>
      )}

      {/* 5. Customer Growth */}
      {activeSection === 'customers' && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">نمو العملاء</h3>
          <div className="grid grid-cols-3 gap-3">
            <Card label="إجمالي العملاء" value={fmt(cust?.total_customers ?? 0)} icon="👥" />
            <Card label="عملاء جدد (شهر)" value={fmt(cust?.new_customers_month ?? 0)} icon="🌟" />
            <Card label="عملاء غير نشطين" value={fmt(cust?.inactive_customers ?? 0)} icon="⚠️" />
          </div>
          <div className="flex gap-2 mt-3">
            <ActionBtn label="كل العملاء" onClick={() => nav('/customers')} />
            <ActionBtn label="عميل جديد" onClick={() => nav('/customers/new')} />
          </div>
        </div>
      )}

      {/* 6. Team Performance */}
      {activeSection === 'performance' && tp?.members && tp.members.length > 0 && (
        <>
          {tt && (
            <div className="bg-white rounded-xl border border-border p-4">
              <h3 className="text-sm font-bold text-text mb-3">أهداف الفريق</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <TargetCard label="المبيعات" target={tt.sales_target} actual={tt.sales_achievement} pct={tt.sales_achievement_pct} />
                <TargetCard label="الزيارات" target={tt.visits_target} actual={tt.visits_achievement} pct={tt.visits_achievement_pct} />
                <TargetCard label="الطلبات" target={tt.orders_target} actual={tt.orders_achievement} pct={tt.orders_achievement_pct} />
                <TargetCard label="عملاء جدد" target={tt.new_customers_target} actual={tt.new_customers_achievement} pct={tt.new_customers_achievement_pct} />
              </div>
            </div>
          )}
          <div className="bg-white rounded-xl border border-border p-4">
            <h3 className="text-sm font-bold text-text mb-3">أداء أعضاء الفريق</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-right py-2 px-2 text-text-secondary font-semibold">الاسم</th>
                    <th className="text-center py-2 px-2 text-text-secondary font-semibold">العملاء</th>
                    <th className="text-center py-2 px-2 text-text-secondary font-semibold">الطلبات</th>
                    <th className="text-center py-2 px-2 text-text-secondary font-semibold">المبيعات</th>
                    <th className="text-center py-2 px-2 text-text-secondary font-semibold">الزيارات</th>
                    <th className="text-center py-2 px-2 text-text-secondary font-semibold">الإنجاز</th>
                  </tr>
                </thead>
                <tbody>
                  {tp.members.map(m => (
                    <tr key={m.employee_id} className="border-b border-border/50 hover:bg-surface/50 cursor-pointer"
                      onClick={() => nav(`/employees/${m.employee_id}`)}>
                      <td className="py-2 px-2 font-semibold text-text">{m.employee_name}</td>
                      <td className="py-2 px-2 text-center text-text-secondary">{fmt(m.customer_count)}</td>
                      <td className="py-2 px-2 text-center text-text-secondary">{fmt(m.month_orders)}</td>
                      <td className="py-2 px-2 text-center text-text-secondary">{formatCurrencyShort(m.month_sales)}</td>
                      <td className="py-2 px-2 text-center text-text-secondary">{fmt(m.month_visits)}</td>
                      <td className={`py-2 px-2 text-center font-bold ${pctColor(m.achievement_pct)}`}>
                        {m.sales_target > 0 ? fmtPct(m.achievement_pct) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 7. Personal Summary */}
      {activeSection === 'personal' && ps && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">ملخصي الشخصي</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card label="عملائي" value={fmt(ps.customer_count)} icon="👥" onClick={() => nav('/customers?my=1')} />
            <Card label="طلباتي (شهر)" value={fmt(ps.month_orders)} icon="📋" onClick={() => nav('/orders?my=1')} />
            <Card label="مبيعاتي (شهر)" value={formatCurrencyShort(ps.month_sales)} icon="💰" />
            <Card label="طلبات اليوم" value={fmt(ps.today_orders)} icon="📅" />
            <Card label="زياراتي (شهر)" value={fmt(ps.month_visits)} icon="📍" />
            <Card label="زيارات اليوم" value={fmt(ps.today_visits)} icon="📌" />
            <Card label="زيارات نشطة" value={fmt(ps.active_visits)} icon="🔴" onClick={() => nav('/visits?filter=active')} />
            <Card label="تحصيلات معلقة" value={formatCurrencyShort(ps.pending_collections)} icon="⏳" onClick={() => nav('/collections?filter=pending')} />
          </div>
        </div>
      )}

      {/* 8. Quick Actions */}
      {activeSection === 'actions' && (
        <div className="bg-white rounded-xl border border-border p-4">
          <h3 className="text-sm font-bold text-text mb-3">إجراءات سريعة</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <QuickBtn label="كل العملاء" onClick={() => nav('/customers')} color="bg-primary text-white" />
            <QuickBtn label="كل الطلبات" onClick={() => nav('/orders')} color="bg-accent text-white" />
            <QuickBtn label="الزيارات" onClick={() => nav('/visits')} color="bg-surface text-text" />
            <QuickBtn label="التحصيلات" onClick={() => nav('/collections')} color="bg-surface text-text" />
            <QuickBtn label="الموظفون" onClick={() => nav('/employees')} color="bg-surface text-text" />
            <QuickBtn label="الهيكل البيعي" onClick={() => nav('/hierarchy')} color="bg-surface text-text" />
            <QuickBtn label="اعتماد الطلبات" onClick={() => nav('/orders/approval-queue')} color="bg-accent text-white" />
            <QuickBtn label="أهداف الفريق" onClick={() => nav('/dashboard/employee-targets')} color="bg-primary text-white" />
            <QuickBtn label="تحليل الأداء" onClick={() => nav('/dashboard/performance')} color="bg-surface text-text" />
            <QuickBtn label="التقارير" onClick={() => nav('/reports')} color="bg-surface text-text" />
            <QuickBtn label="المراقبة الحية" onClick={() => nav('/attendance/operations')} color="bg-primary text-white" />
            <QuickBtn label="تسجيل الحضور" onClick={() => nav('/attendance/runtime')} color="bg-gradient-to-l from-blue-600 to-indigo-700 text-white" />
          </div>
        </div>
      )}

      {/* Add Employee Modal */}
      {showAddEmployee && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/30">
          <form onSubmit={handleAddEmployee}
            className="w-full sm:max-w-sm bg-white rounded-2xl p-4 max-h-[85vh] overflow-y-auto space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-text">إضافة مندوب للفريق</h3>
              <div className="flex items-center gap-2">
                <button type="submit" disabled={submitting}
                  className="bg-primary text-white text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-40">
                  {submitting ? 'جاري الحفظ...' : 'حفظ'}
                </button>
                <button type="button" onClick={() => setShowAddEmployee(false)} className="text-xs text-text-secondary">إلغاء</button>
              </div>
            </div>
            <input type="text" value={empName} onChange={e => setEmpName(e.target.value)}
              placeholder="الاسم الكامل *" required
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            <input type="tel" dir="ltr" value={empPhone} onChange={e => setEmpPhone(toEnglishDigits(e.target.value))}
              placeholder="رقم الهاتف *" required maxLength={11}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            <input type="password" dir="ltr" value={empPassword} onChange={e => setEmpPassword(e.target.value)}
              placeholder="كلمة المرور (افتراضي: رقم الهاتف)"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            <input type="email" dir="ltr" value={empEmail} onChange={e => setEmpEmail(e.target.value)}
              placeholder="البريد الإلكتروني"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            <textarea value={empAddress} onChange={e => setEmpAddress(e.target.value)}
              placeholder="العنوان" rows={2}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm resize-none" />
          </form>
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <div className="fixed inset-0 z-20 flex items-end sm:items-center justify-center bg-black/30">
          <form onSubmit={handleAddCustomer}
            className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-4 max-h-[85vh] overflow-y-auto space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text">إضافة عميل جديد</h3>
              <button type="button" onClick={() => setShowAddCustomer(false)} className="text-xs text-text-secondary">إلغاء</button>
            </div>
            <input type="text" value={custName} onChange={e => setCustName(e.target.value)}
              placeholder="اسم النشاط التجاري *" required
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            <input type="tel" dir="ltr" value={custPhone} onChange={e => setCustPhone(toEnglishDigits(e.target.value))}
              placeholder="رقم الهاتف *" required maxLength={11}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            <input type="text" value={custResponsible} onChange={e => setCustResponsible(e.target.value)}
              placeholder="اسم المسؤول"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            <select value={custBusinessType} onChange={e => setCustBusinessType(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">نوع النشاط</option>
              {BUSINESS_TYPES.map(bt => <option key={bt.value} value={bt.value}>{bt.label}</option>)}
            </select>
            <input type="password" dir="ltr" value={custPassword} onChange={e => setCustPassword(e.target.value)}
              placeholder="كلمة المرور" maxLength={6}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            <textarea value={custAddress} onChange={e => setCustAddress(e.target.value)}
              placeholder="العنوان" rows={1}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm resize-none" />
            <div className="flex items-center gap-2">
              <input type="number" dir="ltr" value={custCreditLimit} onChange={e => setCustCreditLimit(toEnglishDigits(e.target.value))}
                placeholder="حد الائتمان"
                className="flex-1 border border-border rounded-lg px-3 py-2 text-sm" />
              <input type="number" dir="ltr" value={custCreditDays} onChange={e => setCustCreditDays(toEnglishDigits(e.target.value))}
                placeholder="أيام الائتمان"
                className="flex-1 border border-border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              {custLocation.latitude ? (
                <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center justify-between">
                  <span className="text-xs text-green-700">✓ تم تحديد الموقع</span>
                  <button type="button" onClick={() => setCustLocation({ latitude: null, longitude: null, accuracyMeters: null })}
                    className="text-xs text-primary font-semibold">تغيير</button>
                </div>
              ) : (
                <button type="button" onClick={handleCaptureLocation} disabled={custLocating}
                  className="w-full py-2 rounded-lg border-2 border-dashed border-primary/40 text-primary text-xs font-semibold disabled:opacity-50">
                  {custLocating ? 'جاري التحديد...' : '📍 الموقع الجغرافي'}
                </button>
              )}
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-text-secondary mb-1">ربط العميل بـ</label>
              <select value={custOwnerId} onChange={e => setCustOwnerId(e.target.value)}
                className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">نفسي (المدير)</option>
                {tp?.members.map((m: any) => (
                  <option key={m.employee_id} value={m.employee_id}>{m.employee_name}</option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={submitting || !custName.trim()}
              className="w-full bg-primary text-white text-xs py-2.5 rounded-lg font-semibold disabled:opacity-40">
              {submitting ? 'جاري الحفظ...' : 'حفظ'}
            </button>
          </form>
        </div>
      )}

      {/* Visit Detail Inline */}
      {activeSection === 'visit_detail' && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 bg-surface">
            <h3 className="text-sm font-bold text-text">تفاصيل الزيارة</h3>
            <button onClick={() => setActiveSection('visits_list')} className="text-xs text-primary font-semibold">رجوع</button>
          </div>
          {selectedVisitLoading ? (
            <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>
          ) : !selectedVisit ? (
            <div className="text-center py-12 text-text-secondary text-sm">الزيارة غير موجودة</div>
          ) : (() => {
            const v = selectedVisit
            const isActive = v.status === 'active'
            const isCompleted = v.status === 'completed'
            const startTime = v.check_in_at
            const endTime = v.check_out_at
            let durationText = ''
            if (startTime && endTime) {
              const diff = new Date(endTime).getTime() - new Date(startTime).getTime()
              const mins = Math.floor(diff / 60000)
              if (mins < 1) durationText = 'أقل من دقيقة'
              else { const h = Math.floor(mins / 60); const r = mins % 60; durationText = h > 0 ? h + 'س ' + (r > 0 ? r + 'د' : '') : r + ' دقيقة' }
            }
            let headerBg = 'bg-gradient-to-l from-primary/10 to-primary/5 border-b border-primary/10'
            let codeBg = 'bg-primary text-white'
            if (isActive) { headerBg = 'bg-gradient-to-l from-accent/15 to-accent/5 border-b border-accent/10'; codeBg = 'bg-accent text-white' }
            else if (isCompleted) { headerBg = 'bg-gradient-to-l from-success/10 to-success/5 border-b border-success/10'; codeBg = 'bg-success text-white' }
            const resultLabels: Record<string, string> = { order_taken: 'تم الطلب', collection_taken: 'تم التحصيل', order_and_collection: 'طلب وتحصيل', follow_up: 'متابعة', customer_closed: 'العميل مغلق', no_responsible_person: 'لا يوجد مسؤول', order_rejected: 'رفض الطلب', postponed: 'تأجل', other: 'أخرى' }
            return (
              <div className="p-5 space-y-4">
                <div className={'-mx-5 -mt-5 px-5 py-2.5 flex items-center justify-between ' + headerBg}>
                  <span className={'text-xs px-2.5 py-0.5 rounded-full font-semibold ' + codeBg}>{v.code || '—'}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                    isActive ? 'bg-accent/15 text-accent' : isCompleted ? 'bg-success/15 text-success' : 'bg-gray-100 text-text-secondary'
                  }`}>{isActive ? 'نشط' : isCompleted ? 'مكتمل' : v.status}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-primary font-semibold mb-0.5">العميل</p>
                    <p className="text-lg font-bold text-text">{visitDetailCustName || v.customer_id}</p>
                  </div>
                  {v.visit_result && !isActive && (
                    <span className="text-[11px] bg-success/10 text-success px-3 py-1 rounded-full font-semibold">{resultLabels[v.visit_result] || v.visit_result}</span>
                  )}
                </div>
                <div className="h-px bg-border/60" />
                <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5">
                  {visitDetailEmpName && (<><span className="text-[13px] text-indigo-600 font-semibold">بواسطة</span><span className="text-[15px] text-indigo-900 font-medium">{visitDetailEmpName}</span></>)}
                  {startTime && (<><span className="text-[13px] text-blue-600 font-semibold">البداية</span><span className="text-[15px] text-blue-800">{new Date(startTime).toLocaleString('ar-EG')}</span></>)}
                  {endTime && (<><span className="text-[13px] text-emerald-600 font-semibold">النهاية</span><span className="text-[15px] text-emerald-800">{new Date(endTime).toLocaleString('ar-EG')}</span></>)}
                  {durationText && (<><span className="text-[13px] text-amber-700 font-semibold">المدة</span><span className={'text-[15px] ' + (isActive ? 'text-accent font-semibold' : isCompleted ? 'text-success font-semibold' : 'text-text-secondary font-semibold')}>{durationText}</span></>)}
                </div>
                {(v.check_in_latitude || v.check_out_latitude) && <div className="h-px bg-border/60" />}
                <div className="space-y-2.5">
                  {v.check_in_latitude && (
                    <div className="bg-blue-50/70 border border-blue-200/50 rounded-lg px-3.5 py-2.5">
                      <p className="text-[11px] text-blue-700 font-semibold mb-1">بداية الزيارة</p>
                      <p className="text-[13px] flex items-center flex-wrap gap-x-2">
                        <a href={locationService.buildGoogleMapsUrl(Number(v.check_in_latitude), Number(v.check_in_longitude))} target="_blank" rel="noopener noreferrer" className="inline-block bg-blue-600 text-white text-[11px] px-3 py-1 rounded-full font-semibold">فتح الخريطة</a>
                        {visitDetailStartAddr && <span className="text-blue-500">- {visitDetailStartAddr}</span>}
                      </p>
                    </div>
                  )}
                  {v.check_out_latitude && (
                    <div className="bg-emerald-50/70 border border-emerald-200/50 rounded-lg px-3.5 py-2.5">
                      <p className="text-[11px] text-emerald-700 font-semibold mb-1">نهاية الزيارة</p>
                      <p className="text-[13px] flex items-center flex-wrap gap-x-2">
                        <a href={locationService.buildGoogleMapsUrl(Number(v.check_out_latitude), Number(v.check_out_longitude))} target="_blank" rel="noopener noreferrer" className="inline-block bg-emerald-600 text-white text-[11px] px-3 py-1 rounded-full font-semibold">فتح الخريطة</a>
                        {visitDetailEndAddr && <span className="text-emerald-500">- {visitDetailEndAddr}</span>}
                      </p>
                    </div>
                  )}
                </div>
                {v.notes && <div className="h-px bg-border/60" />}
                {v.notes && (() => {
                  const orderMatch = v.notes.match(/^طلب:([a-f0-9-]+)\|(.+)/)
                  return (
                    <div className="bg-amber-50 border border-amber-300/60 rounded-lg px-4 py-3">
                      <p className="text-[13px] text-amber-900 leading-relaxed whitespace-pre-wrap">{orderMatch ? orderMatch[2] : v.notes}</p>
                      {orderMatch && (
                        <button onClick={() => nav('/orders/' + orderMatch[1])} className="bg-indigo-600 text-white text-[12px] px-4 py-1.5 rounded-full font-bold mt-2 inline-block">
                          عرض تفاصيل الطلب
                        </button>
                      )}
                    </div>
                  )
                })()}
                {isActive && (
                  <button onClick={() => nav(`/orders/new?customer=${v.customer_id}&visit=${v.id}`)}
                    className="w-full bg-primary text-white text-xs py-2.5 rounded-lg font-semibold">طلب</button>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {/* Customer Picker Modal (for order/visit) */}
      {showCustomerPicker && (
        <div className="fixed inset-0 z-20 flex items-end sm:items-center justify-center bg-black/30">
          <div className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-4 max-h-[85vh] overflow-y-auto space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text">{showCustomerPicker === 'order' ? 'اختيار عميل للطلب' : 'اختيار عميل للزيارة'}</h3>
              <button type="button" onClick={() => { setShowCustomerPicker(null); setCustSearchQuery('') }} className="text-xs text-text-secondary">إلغاء</button>
            </div>
            <input type="text" value={custSearchQuery} onChange={e => setCustSearchQuery(e.target.value)}
              placeholder="بحث بالاسم أو الكود..."
              className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {customers.filter((c: any) => {
                if (!custSearchQuery) return true
                const q = custSearchQuery.toLowerCase()
                return c.company_name?.toLowerCase().includes(q) || c.code?.toLowerCase().includes(q)
              }).length === 0 && (
                <p className="text-center text-xs text-text-secondary py-4">لا يوجد عملاء</p>
              )}
              {customers.filter((c: any) => {
                if (!custSearchQuery) return true
                const q = custSearchQuery.toLowerCase()
                return c.company_name?.toLowerCase().includes(q) || c.code?.toLowerCase().includes(q)
              }).map((c: any) => (
                <button key={c.id} type="button" onClick={() => { handlePickCustomer(c); setCustSearchQuery('') }}
                  className="w-full text-right px-3 py-2 rounded-lg hover:bg-surface transition-colors border border-border/50 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-text">{c.company_name}</p>
                    <p className="text-[10px] text-text-secondary">{c.code} {c.responsible_name ? `| ${c.responsible_name}` : ''}</p>
                  </div>
                  <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded">{c.owner_name || ''}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Visit Checkout Modal */}
      {activeVisitId && (
        <div className="fixed inset-0 z-20 flex items-end sm:items-center justify-center bg-black/30">
          <div className="w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text">إنهاء الزيارة</h3>
              <button type="button" onClick={() => { setActiveVisitId(null); setVisitResult(''); setVisitNotes('') }} className="text-xs text-text-secondary">إلغاء</button>
            </div>
            <select value={visitResult} onChange={e => setVisitResult(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">نتيجة الزيارة</option>
              <option value="order_taken">تم أخذ طلب</option>
              <option value="follow_up">متابعة لاحقة</option>
              <option value="customer_closed">العميل مغلق</option>
              <option value="no_responsible_person">المسؤول غير موجود</option>
              <option value="order_rejected">تم رفض الطلب</option>
              <option value="collection_taken">تم التحصيل</option>
              <option value="new_customer">عميل جديد</option>
            </select>
            <textarea value={visitNotes} onChange={e => setVisitNotes(e.target.value)}
              placeholder="ملاحظات..." rows={3}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm resize-none" />
            <button onClick={handleCheckoutVisit} disabled={submitting}
              className="w-full bg-primary text-white text-xs py-2.5 rounded-lg font-semibold disabled:opacity-40">
              {submitting ? 'جاري الإنهاء...' : 'إنهاء الزيارة'}
            </button>
          </div>
        </div>
      )}

      <div className="text-center text-[10px] text-text-secondary pb-4">
        يتم التحديث تلقائياً كل 30 ثانية
      </div>
    </div>
  )
}

function Card({ label, value, icon, sub, onClick }: { label: string; value: string; icon: string; sub?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="bg-white rounded-xl border border-border p-3 text-right active:bg-surface transition-colors w-full">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{icon}</span>
        <span className="text-[10px] text-text-secondary">{label}</span>
      </div>
      <p className="text-lg font-bold text-text">{value}</p>
      {sub && <p className="text-[10px] text-text-secondary mt-0.5">{sub}</p>}
    </button>
  )
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-surface rounded-lg p-2 text-center border border-border/50">
      <p className={`text-sm font-bold ${color}`}>{value}</p>
      <p className="text-[10px] text-text-secondary">{label}</p>
    </div>
  )
}

function ActionBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="text-xs bg-primary/10 text-primary px-3 py-1.5 rounded-lg font-semibold active:opacity-80 transition-opacity">
      {label}
    </button>
  )
}

function QuickBtn({ label, onClick, color }: { label: string; onClick: () => void; color: string }) {
  return (
    <button onClick={onClick}
      className={`${color} text-xs py-2.5 rounded-lg font-semibold border border-border/50 active:opacity-80 transition-opacity`}>
      {label}
    </button>
  )
}

function TargetCard({ label, target, actual, pct }: { label: string; target: number; actual: number; pct: number }) {
  return (
    <div className="bg-surface rounded-xl p-3 border border-border/50">
      <p className="text-[10px] text-text-secondary mb-1">{label}</p>
      <p className="text-sm font-bold text-text">{formatCurrencyShort(target)}</p>
      <div className="flex items-center gap-2 mt-1">
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-success' : pct >= 50 ? 'bg-warning' : 'bg-red-400'}`}
            style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <span className={`text-[10px] font-bold ${pctColor(pct)}`}>{fmtPct(pct)}</span>
      </div>
    </div>
  )
}
