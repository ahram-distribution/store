import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatCurrencyShort, safeFormatDateTime, toEnglishDigits } from '../../utils/format'
import { locationService } from '../../services/location'
import { VisitCard } from '../../components/visits/VisitCard'
import { lifeSignalService } from '../../services/lifeSignalService'
import { MobileDialog } from '../../components/shared/MobileDialog'
import { CustomerForm } from '../../components/customers/CustomerForm'
import type { CustomerFormData } from '../../components/customers/CustomerForm'
import { CUSTOMER_DEFAULT_PASSWORD } from '../../lib/customerConstants'
import toast from 'react-hot-toast'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

const fmt = (n: number) => Number.isFinite(n) ? n.toLocaleString('ar-EG-u-nu-latn') : '0'

interface OrdersData {
  today_orders: number; today_sales: number; month_orders: number; month_sales: number
  pending_followup: number; pending_collections: number
}

interface VisitsData { active_visits: number; today_visits: number; month_visits: number }

interface CustomersData { total_customers: number; new_customers_month: number; inactive_customers: number }

interface MemberPerf {
  employee_id: string; employee_name: string
  customer_count: number; month_orders: number; month_sales: number
  today_orders: number; today_visits: number; month_visits: number
  sales_target: number; visits_target: number; orders_target: number
  new_customers_target: number; achievement_pct: number
}

export default function SalesManagerOperations() {
  const nav = useNavigate()

  /* Data summary */
  const [orders, setOrders] = useState<OrdersData | null>(null)
  const [visits, setVisits] = useState<VisitsData | null>(null)
  const [customers, setCustomers] = useState<CustomersData | null>(null)
  const [teamMembers, setTeamMembers] = useState<MemberPerf[]>([])
  const [loading, setLoading] = useState(true)

  /* Add Employee */
  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const [empName, setEmpName] = useState('')
  const [empPhone, setEmpPhone] = useState('')
  const [empPassword, setEmpPassword] = useState('')
  const [empEmail, setEmpEmail] = useState('')
  const [empAddress, setEmpAddress] = useState('')
  const [empRoleId, setEmpRoleId] = useState('')
  const [roles, setRoles] = useState<any[]>([])
  const [submitting, setSubmitting] = useState(false)

  /* Add Customer */
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [custOwnerId, setCustOwnerId] = useState('')

  /* Customer Picker */
  const [showCustomerPicker, setShowCustomerPicker] = useState<'order' | 'visit' | null>(null)
  const [customerList, setCustomerList] = useState<any[]>([])
  const [custSearchQuery, setCustSearchQuery] = useState('')

  /* Visits List */
  const [visitsList, setVisitsList] = useState<any[]>([])
  const [visitsLoading, setVisitsLoading] = useState(false)
  const [visitsFilter, setVisitsFilter] = useState<'all' | 'active' | 'today'>('all')
  const [customerMap, setCustomerMap] = useState<Map<string, string>>(new Map())
  const [employeeVisitMap, setEmployeeVisitMap] = useState<Map<string, string>>(new Map())

  /* Visit Detail */
  const [selectedVisit, setSelectedVisit] = useState<any | null>(null)
  const [selectedVisitLoading, setSelectedVisitLoading] = useState(false)
  const [visitDetailCustName, setVisitDetailCustName] = useState('')
  const [visitDetailEmpName, setVisitDetailEmpName] = useState('')
  const [visitDetailStartCoord, setVisitDetailStartCoord] = useState('')
  const [visitDetailEndCoord, setVisitDetailEndCoord] = useState('')

  const token = getToken()

  const fetchData = useCallback(async () => {
    if (!token) return
    const { data: result, error } = await supabase.rpc('get_sales_manager_cc', { p_token: token.trim() })
    if (error || (result && typeof result === 'object' && (result as Record<string, unknown>).error)) {
      setLoading(false); return
    }
    if (result && typeof result === 'object') {
      const d = result as any
      setOrders(d.orders ?? null)
      setVisits(d.visits ?? null)
      setCustomers(d.customers ?? null)
      setTeamMembers(d.team_performance?.members ?? [])
      setLoading(false)
    }
  }, [token])

  useEffect(() => { fetchData() }, [fetchData])

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
    const { data: session } = await supabase.rpc('validate_session', { p_token: t })
    const managerId = (session as any)?.employee_id || null
    const salesRepRole = roles.find((r: any) => r.name === 'مندوب مبيعات')
    const { data, error } = await supabase.rpc('governed_create_employee', {
      p_token: t, p_full_name: empName.trim(), p_phone: empPhone.trim(),
      p_password: empPassword || null, p_email: empEmail || null,
      p_role_id: salesRepRole?.id || null, p_manager_id: managerId, p_address: empAddress || null,
    })
    setSubmitting(false)
    if (error) { toast.error(error.message); return }
    const res = data as any
    if (res?.error) { toast.error(res.error); return }
    toast.success(`تم إضافة ${res.full_name}`)
    setShowAddEmployee(false); setEmpName(''); setEmpPhone(''); setEmpPassword(''); setEmpEmail(''); setEmpAddress('')
    fetchData()
  }

  const handleAddCustomer = async (formData: CustomerFormData) => {
    setSubmitting(true)
    const t = getToken()
    const { data: session } = await supabase.rpc('validate_session', { p_token: t })
    const managerId = (session as any)?.employee_id || null
    const { data, error } = await supabase.rpc('governed_create_customer', {
      p_token: t, p_company_name: formData.companyName.trim(), p_phone: formData.phone.trim() || null,
      p_contact_name: formData.contactName.trim() || null, p_contact_phone: formData.phone.trim() || null,
      p_business_type: formData.businessType || null, p_responsible_name: formData.contactName.trim() || null,
      p_password: CUSTOMER_DEFAULT_PASSWORD,
      p_latitude: formData.latitude, p_longitude: formData.longitude,
      p_accuracy_meters: formData.accuracyMeters,
      p_governorate_id: formData.governorateId || null,
      p_city: formData.city.trim() || null,
      p_street_address: formData.streetAddress.trim() || null,
    })
    if (error) {
      setSubmitting(false)
      if (error.message?.includes('duplicate') || error.message?.includes('already exists')) {
        toast.error('رقم الهاتف موجود مسبقاً')
      } else {
        toast.error(error.message)
      }
      return
    }
    const res = data as any
    if (res?.error) { setSubmitting(false); toast.error(res.error); return }
    lifeSignalService.notifyBusiness('customer_created')
    const customerId = res.id as string
    const targetOwner = custOwnerId || managerId
    if (targetOwner && customerId) {
      const { error: xferErr } = await supabase.rpc('governed_change_customer_ownership', {
        p_token: t, p_customer_id: customerId, p_new_owner_id: targetOwner, p_reason: 'إضافة عميل بواسطة مدير البيع',
      })
      if (xferErr) toast.error('تم إنشاء العميل لكن فشل نقل الملكية: ' + xferErr.message)
    }
    setSubmitting(false)
    toast.success('تم إنشاء العميل بنجاح')
    setShowAddCustomer(false); setCustOwnerId('')
    fetchData()
  }

  const fetchCustomers = useCallback(async () => {
    const t = getToken()
    if (!t || customerList.length > 0) return
    const { data } = await supabase.rpc('get_governed_customers', { p_token: t })
    if (data) setCustomerList(Array.isArray(data) ? data : typeof data === 'object' && data !== null ? [data] : [])
  }, [customerList.length])

  const handlePickCustomer = async (customer: any) => {
    const t = getToken()
    if (!t) return
    if (showCustomerPicker === 'order') {
      nav(`/orders/new?customer=${customer.id}`)
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
    setVisitDetailCustName(''); setVisitDetailEmpName(''); setVisitDetailStartCoord(''); setVisitDetailEndCoord('')
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
      if (slat && slng) setVisitDetailStartCoord(`${slat.toFixed(6)}, ${slng.toFixed(6)}`)
      if (elat && elng) setVisitDetailEndCoord(`${elat.toFixed(6)}, ${elng.toFixed(6)}`)
    }
    setSelectedVisitLoading(false)
  }

  if (loading) return <div className="text-center py-12 text-text-secondary text-sm">جاري التحميل...</div>

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-border pb-2 pt-2">
        <div className="flex items-center gap-2">
          <button onClick={() => nav('/sales-manager-cc')} className="text-xs text-primary font-semibold">→ رجوع</button>
          <h1 className="text-lg font-bold text-text">العمليات التجارية</h1>
        </div>
      </div>

      {/* Quick Actions Row */}
      <div className="grid grid-cols-2 gap-2 mb-1">
        <button onClick={() => { setShowCustomerPicker('order'); fetchCustomers() }}
          className="bg-primary/10 text-primary border border-primary/20 py-3 rounded-xl font-bold text-sm active:scale-[0.98] transition-all flex items-center justify-center gap-1.5">
          🛒 إنشاء طلب
        </button>
        <button onClick={() => nav('/visits/screen')}
          className="bg-accent/10 text-accent border border-accent/20 py-3 rounded-xl font-bold text-sm active:scale-[0.98] transition-all flex items-center justify-center gap-1.5">
          📍 بدء زيارة
        </button>
      </div>
      <div className="flex gap-2">
        <button onClick={() => { setShowAddEmployee(true) }}
          className="flex-1 text-xs bg-primary/10 text-primary py-2.5 rounded-lg font-semibold border border-primary/20 text-center">+ مندوب</button>
        <button onClick={() => { setShowAddCustomer(true); setCustOwnerId('') }}
          className="flex-1 text-xs bg-accent/10 text-accent py-2.5 rounded-lg font-semibold border border-accent/20 text-center">+ عميل</button>
      </div>

      {/* Orders Monitoring */}
      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">مراقبة الطلبات</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Card label="طلبات اليوم" value={fmt(orders?.today_orders ?? 0)} icon="📋" />
          <Card label="مبيعات اليوم" value={formatCurrencyShort(orders?.today_sales ?? 0)} icon="💰" />
          <Card label="طلبات الشهر" value={fmt(orders?.month_orders ?? 0)} icon="📊" />
          <Card label="مبيعات الشهر" value={formatCurrencyShort(orders?.month_sales ?? 0)} icon="📈" />
          <Card label="بانتظار الاعتماد" value={fmt(orders?.pending_followup ?? 0)} icon="⏳" />
          <Card label="تحصيلات معلقة" value={formatCurrencyShort(orders?.pending_collections ?? 0)} icon="💳" />
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          <ActionBtn label="كل الطلبات" onClick={() => nav('/sales-manager/orders-list')} />
          <ActionBtn label="اعتماد الطلبات" onClick={() => nav('/orders/approval-queue')} />
          <ActionBtn label="التحصيلات" onClick={() => nav('/collections')} />
        </div>
      </div>

      {/* Visits Monitoring */}
      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">مراقبة الزيارات</h3>
        <div className="grid grid-cols-3 gap-3">
          <Card label="زيارات نشطة" value={fmt(visits?.active_visits ?? 0)} icon="📍" />
          <Card label="زيارات اليوم" value={fmt(visits?.today_visits ?? 0)} icon="📅" />
          <Card label="زيارات الشهر" value={fmt(visits?.month_visits ?? 0)} icon="📊" />
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          <ActionBtn label="كل الزيارات" onClick={() => nav('/sales-manager/visits-list')} />
          <ActionBtn label="زيارة جديدة" onClick={() => nav('/visits/screen')} />
        </div>
      </div>

      {/* Visits List */}
      {visitsList.length > 0 && (
        <div className="bg-white rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-text">كل الزيارات</h3>
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 scrollbar-none">
            {[
              { key: 'all', label: 'الكل' },
              { key: 'active', label: 'نشط' },
              { key: 'today', label: 'اليوم' },
            ].map(f => (
              <button key={f.key} onClick={() => setVisitsFilter(f.key as 'all' | 'active' | 'today')}
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

      {/* Visit Detail */}
      {selectedVisit && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 bg-surface">
            <h3 className="text-sm font-bold text-text">تفاصيل الزيارة</h3>
            <button onClick={() => setSelectedVisit(null)} className="text-xs text-primary font-semibold">إغلاق</button>
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
                  <span className={'text-xs px-2.5 py-0.5 rounded-full font-semibold ' + codeBg}>{v.code || 'غير متوفر'}</span>
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
                  {startTime && (<><span className="text-[13px] text-blue-600 font-semibold">البداية</span><span className="text-[15px] text-blue-800">{safeFormatDateTime(startTime, startTime)}</span></>)}
                  {endTime && (<><span className="text-[13px] text-emerald-600 font-semibold">النهاية</span><span className="text-[15px] text-emerald-800">{safeFormatDateTime(endTime, endTime)}</span></>)}
                  {durationText && (<><span className="text-[13px] text-amber-700 font-semibold">المدة</span><span className={'text-[15px] ' + (isActive ? 'text-accent font-semibold' : isCompleted ? 'text-success font-semibold' : 'text-text-secondary font-semibold')}>{durationText}</span></>)}
                </div>
                {(v.check_in_latitude || v.check_out_latitude) && <div className="h-px bg-border/60" />}
                <div className="space-y-2.5">
                  {v.check_in_latitude && (
                    <div className="bg-blue-50/70 border border-blue-200/50 rounded-lg px-3.5 py-2.5">
                      <p className="text-[11px] text-blue-700 font-semibold mb-1">بداية الزيارة</p>
                      <p className="text-[13px] flex items-center flex-wrap gap-x-2">
                        <a href={locationService.buildGoogleMapsUrl(Number(v.check_in_latitude), Number(v.check_in_longitude))} target="_blank" rel="noopener noreferrer" className="inline-block bg-blue-600 text-white text-[11px] px-3 py-1 rounded-full font-semibold">فتح الخريطة</a>
                        {visitDetailStartCoord && <span className="text-blue-500 text-[10px]">({visitDetailStartCoord})</span>}
                      </p>
                    </div>
                  )}
                  {v.check_out_latitude && (
                    <div className="bg-emerald-50/70 border border-emerald-200/50 rounded-lg px-3.5 py-2.5">
                      <p className="text-[11px] text-emerald-700 font-semibold mb-1">نهاية الزيارة</p>
                      <p className="text-[13px] flex items-center flex-wrap gap-x-2">
                        <a href={locationService.buildGoogleMapsUrl(Number(v.check_out_latitude), Number(v.check_out_longitude))} target="_blank" rel="noopener noreferrer" className="inline-block bg-emerald-600 text-white text-[11px] px-3 py-1 rounded-full font-semibold">فتح الخريطة</a>
                        {visitDetailEndCoord && <span className="text-emerald-500 text-[10px]">({visitDetailEndCoord})</span>}
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

      {/* Customers */}
      <div className="bg-white rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold text-text mb-3">نمو العملاء</h3>
        <div className="grid grid-cols-3 gap-3">
          <Card label="إجمالي العملاء" value={fmt(customers?.total_customers ?? 0)} icon="👥" />
          <Card label="عملاء جدد (شهر)" value={fmt(customers?.new_customers_month ?? 0)} icon="🌟" />
          <Card label="عملاء غير نشطين" value={fmt(customers?.inactive_customers ?? 0)} icon="⚠️" />
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          <ActionBtn label="كل العملاء" onClick={() => nav('/sales-manager/customers-list')} />
          <ActionBtn label="عميل جديد" onClick={() => nav('/customers/new')} />
        </div>
      </div>

      {/* Add Employee Modal */}
      <MobileDialog
        open={showAddEmployee}
        onClose={() => setShowAddEmployee(false)}
        title="إضافة مندوب للفريق"
        footer={
          <div className="flex items-center gap-2">
            <button type="submit" form="addEmployeeForm" disabled={submitting}
              className="flex-1 bg-primary text-white text-xs py-2.5 rounded-lg font-semibold disabled:opacity-40">
              {submitting ? 'جاري الحفظ...' : 'حفظ'}
            </button>
          </div>
        }
      >
        <form id="addEmployeeForm" onSubmit={handleAddEmployee} className="space-y-3">
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
      </MobileDialog>

      {/* Add Customer Modal */}
      <MobileDialog
        open={showAddCustomer}
        onClose={() => setShowAddCustomer(false)}
        title="إضافة عميل جديد"
        footer={null}
      >
        <CustomerForm
          mode="modal"
          onSubmit={handleAddCustomer}
          onCancel={() => setShowAddCustomer(false)}
          compact
          ownerId={custOwnerId}
          onOwnerChange={setCustOwnerId}
          teamMembers={teamMembers.map(m => ({ employee_id: m.employee_id, employee_name: m.employee_name }))}
        />
      </MobileDialog>

      {/* Customer Picker Modal */}
      <MobileDialog
        open={!!showCustomerPicker}
        onClose={() => { setShowCustomerPicker(null); setCustSearchQuery('') }}
        title={showCustomerPicker === 'order' ? 'اختيار عميل للطلب' : 'اختيار عميل للزيارة'}
      >
        <input type="text" value={custSearchQuery} onChange={e => setCustSearchQuery(e.target.value)}
          placeholder="بحث بالاسم أو الكود..."
          className="w-full border border-border rounded-lg px-3 py-2 text-sm" />
        <div className="space-y-1">
          {customerList.filter((c: any) => {
            if (!custSearchQuery) return true
            const q = custSearchQuery.toLowerCase()
            return c.company_name?.toLowerCase().includes(q) || c.code?.toLowerCase().includes(q)
          }).length === 0 && (
            <p className="text-center text-xs text-text-secondary py-4">لا يوجد عملاء</p>
          )}
          {customerList.filter((c: any) => {
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
      </MobileDialog>

      <div className="text-center text-[10px] text-text-secondary pb-4">
        يتم التحديث تلقائياً
      </div>
    </div>
  )
}

function Card({ label, value, icon, onClick }: { label: string; value: string; icon: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="bg-white rounded-xl border border-border p-3 text-right active:bg-surface transition-colors w-full">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{icon}</span>
        <span className="text-[10px] text-text-secondary">{label}</span>
      </div>
      <p className="text-lg font-bold text-text">{value}</p>
    </button>
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
