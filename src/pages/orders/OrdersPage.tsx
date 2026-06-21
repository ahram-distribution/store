import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/auth'
import { OrderCard } from '../../components/orders/OrderCard'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

type Tab = 'all' | 'my_orders' | 'my_invoices'

const STATUS_OPTIONS = [
  { value: '', label: 'كل الحالات' },
  { value: 'draft', label: 'مسودة' },
  { value: 'submitted', label: 'مقدم' },
  { value: 'reviewing', label: 'قيد المراجعة' },
  { value: 'returned_for_revision', label: 'معاد للتعديل' },
  { value: 'approved', label: 'معتمد' },
  { value: 'preparing', label: 'قيد التجهيز' },
  { value: 'prepared', label: 'تم التجهيز' },
  { value: 'ready_for_dispatch', label: 'بانتظار قرار الشحن' },
  { value: 'sent_to_delivery', label: 'أرسل للتوصيل' },
  { value: 'dispatched', label: 'تم الشحن' },
  { value: 'deferred', label: 'مؤجل' },
  { value: 'cancelled', label: 'ملغي' },
  { value: 'delivered', label: 'تم التسليم' },
]

export function OrdersPage() {
  const navigate = useNavigate()
  const currentUserId = useAuthStore((s) => s.user?.identity_id)
  const currentEmpId = useAuthStore((s) => s.user?.employee_id)
  const [orders, setOrders] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [employees, setEmployees] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const params = new URLSearchParams(window.location.search)
  const [tab, setTab] = useState<Tab>(params.get('my') === '1' ? 'my_orders' : 'all')

  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [customerFilter, setCustomerFilter] = useState('')
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    const token = getToken()
    if (!token) { setLoading(false); return }
    Promise.all([
      supabase.rpc('get_unified_orders', { p_token: token }),
      supabase.rpc('get_governed_customers', { p_token: token }),
      supabase.rpc('get_governed_employees', { p_token: token }),
    ]).then(([ordRes, custRes, empRes]) => {
      const ordData = (ordRes.data as any[]) || []
      setOrders(Array.isArray(ordData) ? ordData : [])
      const custData = (custRes.data as any[]) || []
      setCustomers(Array.isArray(custData) ? custData : [])
      const empData = (empRes.data as any[]) || []
      setEmployees(Array.isArray(empData) ? empData : [])
      setLoading(false)
    })
  }, [])

  const sorted = useMemo(() => {
    return [...orders].sort((a: any, b: any) => ((b.created_at || '') > (a.created_at || '') ? 1 : -1))
  }, [orders])

  const filtered = useMemo(() => {
    let list = sorted

    if (tab === 'my_orders' && currentUserId) {
      list = list.filter((o: any) => o.created_by === currentUserId)
    }
    if (tab === 'my_invoices' && currentUserId) {
      list = list.filter((o: any) => o.owner_id === currentUserId)
    }

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter((o: any) =>
        (o.order_number || '').toLowerCase().includes(q) ||
        (o.customer_name || '').toLowerCase().includes(q)
      )
    }
    if (statusFilter) list = list.filter((o: any) => o.status === statusFilter)
    if (customerFilter) list = list.filter((o: any) => o.customer_id === customerFilter)
    if (employeeFilter) {
      const emp = employees.find((e: any) => e.id === employeeFilter)
      const filterIdentityId = emp?.identity_id || employeeFilter
      list = list.filter((o: any) => o.created_by === filterIdentityId)
    }
    if (dateFrom) list = list.filter((o: any) => o.created_at >= dateFrom)
    if (dateTo) list = list.filter((o: any) => o.created_at <= dateTo + 'T23:59:59')

    return list
  }, [sorted, tab, currentEmpId, searchQuery, statusFilter, customerFilter, employeeFilter, dateFrom, dateTo])

  const tabLabel = tab === 'all' ? 'الطلبات' : tab === 'my_orders' ? 'طلباتي' : 'فواتيري'

  return (
    <div className="ds-gap-lg flex flex-col">
      <div className="flex items-center ds-gap-md">
        <button onClick={() => navigate('/dashboard')} className="text-text-secondary text-xl leading-none">&larr;</button>
        <h1 className="ds-title">{tabLabel}</h1>
        <button onClick={() => navigate('/orders/new')} className="ds-btn ds-btn-primary mr-auto">+ إنشاء طلب</button>
      </div>

      {currentEmpId && (
        <div className="ds-tabs">
          <button onClick={() => setTab('all')} className={`ds-tab ${tab === 'all' ? 'ds-tab-active' : 'ds-tab-inactive'}`}>الكل</button>
          <button onClick={() => setTab('my_orders')} className={`ds-tab ${tab === 'my_orders' ? 'ds-tab-active' : 'ds-tab-inactive'}`}>طلباتي</button>
          <button onClick={() => setTab('my_invoices')} className={`ds-tab ${tab === 'my_invoices' ? 'ds-tab-active' : 'ds-tab-inactive'}`}>فواتيري</button>
        </div>
      )}

      <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="بحث برقم الطلب أو اسم العميل..." className="ds-input" />

      <div className="grid grid-cols-2 ds-gap-sm">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="ds-select">
          {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
        <select value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}
          className="ds-select">
          <option value="">كل العملاء</option>
          {customers.map((c: any) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
        <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}
          className="ds-select">
          <option value="">كل الموظفين</option>
          {employees.map((e: any) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
        <div className="flex ds-gap-xs">
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            className="ds-input" />
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            className="ds-input" />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 ds-small">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 ds-small">
          {tab === 'my_orders' ? 'لا توجد طلبات لك' : tab === 'my_invoices' ? 'لا توجد فواتير لك' : 'لا توجد طلبات'}
        </div>
      ) : (
        <div className="ds-gap-sm flex flex-col">
          {filtered.map((order: any) => (
            <OrderCard key={order.id} order={order} onClick={() => navigate(`/orders/${order.id}`)} />
          ))}
        </div>
      )}
    </div>
  )
}
