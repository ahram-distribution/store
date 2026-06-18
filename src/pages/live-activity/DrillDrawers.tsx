import { useNavigate } from 'react-router-dom'
import { formatCurrencyShort } from '../../utils/format'

interface BaseDrill {
  id: string
  employee_name?: string
  created_at?: string
}

interface OrderDrill extends BaseDrill {
  order_number: string
  customer_name: string
  total_amount: number
  status: string
}

interface VisitDrill extends BaseDrill {
  customer_name: string
  check_in_at: string
  check_out_at: string | null
  status: string
}

interface CustomerDrill extends BaseDrill {
  code: string
  company_name: string
  registered_at?: string
}

interface CollectionDrill extends BaseDrill {
  amount: number
}

interface EmployeeDrill extends BaseDrill {
  name: string
  employee_code?: string
  connection_status: string
  last_seen_at: string | null
  order_count: number
  sales_value: number
  visit_count: number
  status: string
}

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

function Drawer({ open, onClose, title, children }: DrawerProps) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-30 flex items-end sm:items-center justify-center bg-black/30" onClick={onClose}>
      <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl p-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between mb-3 sticky top-0 bg-white pb-2 border-b border-border">
          <h3 className="text-sm font-bold text-text">{title}</h3>
          <button type="button" onClick={onClose} className="text-xs text-text-secondary hover:text-text transition-colors">إغلاق</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function fmtTime(d: string | null | undefined): string {
  if (!d) return '--'
  try { return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { hour: '2-digit', minute: '2-digit' }).format(new Date(d)) }
  catch { return '--' }
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'قيد الانتظار', approved: 'معتمد', completed: 'مكتمل',
  cancelled: 'ملغي', deferred: 'مؤجل', active: 'نشط',
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-yellow-600 bg-yellow-50',
  approved: 'text-blue-600 bg-blue-50',
  completed: 'text-green-600 bg-green-50',
  cancelled: 'text-red-600 bg-red-50',
  deferred: 'text-gray-600 bg-gray-50',
  active: 'text-green-600 bg-green-50',
}

export function OrdersDrill({ open, onClose, orders, titleOverride }: { open: boolean; onClose: () => void; orders: OrderDrill[]; titleOverride?: string }) {
  const nav = useNavigate()
  return (
    <Drawer open={open} onClose={onClose} title={titleOverride || `طلبات اليوم (${orders.length})`}>
      <div className="space-y-1.5">
        {orders.length === 0 ? (
          <p className="text-center text-xs text-text-secondary py-6">لا توجد طلبات اليوم</p>
        ) : orders.map((o) => (
          <button key={o.id} type="button" onClick={() => { nav(`/orders/${o.id}`); onClose() }}
            className="w-full text-right bg-surface rounded-lg px-3 py-2 hover:bg-surface/80 transition-colors active:scale-[0.99] border border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text">{o.order_number || '#' + o.id.slice(0, 8)}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_COLORS[o.status] || 'text-gray-600 bg-gray-50'}`}>
                {STATUS_LABELS[o.status] || o.status}
              </span>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <span className="text-[10px] text-text-secondary truncate">{o.customer_name || '---'}</span>
              <span className="text-[11px] font-bold text-green-600">{formatCurrencyShort(o.total_amount)}</span>
            </div>
            <div className="text-[9px] text-text-secondary mt-0.5">{o.employee_name} · {fmtTime(o.created_at)}</div>
          </button>
        ))}
      </div>
    </Drawer>
  )
}

export function VisitsDrill({ open, onClose, visits }: { open: boolean; onClose: () => void; visits: VisitDrill[] }) {
  const nav = useNavigate()
  return (
    <Drawer open={open} onClose={onClose} title={`زيارات اليوم (${visits.length})`}>
      <div className="space-y-1.5">
        {visits.length === 0 ? (
          <p className="text-center text-xs text-text-secondary py-6">لا توجد زيارات اليوم</p>
        ) : visits.map((v) => (
          <button key={v.id} type="button" onClick={() => { nav(`/visits/${v.id}`); onClose() }}
            className="w-full text-right bg-surface rounded-lg px-3 py-2 hover:bg-surface/80 transition-colors active:scale-[0.99] border border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text truncate">{v.customer_name}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${v.status === 'active' ? 'text-green-600 bg-green-50' : 'text-gray-600 bg-gray-50'}`}>
                {v.status === 'active' ? 'جاري' : 'مكتمل'}
              </span>
            </div>
            <div className="text-[10px] text-text-secondary mt-0.5">
              {v.employee_name}
            </div>
            <div className="text-[9px] text-text-secondary">
              {fmtTime(v.check_in_at)} → {v.check_out_at ? fmtTime(v.check_out_at) : '---'}
            </div>
          </button>
        ))}
      </div>
    </Drawer>
  )
}

export function CustomersDrill({ open, onClose, customers }: { open: boolean; onClose: () => void; customers: CustomerDrill[] }) {
  const nav = useNavigate()
  return (
    <Drawer open={open} onClose={onClose} title={`عملاء جدد (${customers.length})`}>
      <div className="space-y-1.5">
        {customers.length === 0 ? (
          <p className="text-center text-xs text-text-secondary py-6">لا يوجد عملاء جدد اليوم</p>
        ) : customers.map((c) => (
          <button key={c.id} type="button" onClick={() => { nav(`/customers/${c.id}`); onClose() }}
            className="w-full text-right bg-surface rounded-lg px-3 py-2 hover:bg-surface/80 transition-colors active:scale-[0.99] border border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text truncate">{c.company_name}</span>
              <span className="text-[10px] text-text-secondary">{c.code}</span>
            </div>
            <div className="text-[9px] text-text-secondary">{c.employee_name !== '-' ? c.employee_name : ''}</div>
          </button>
        ))}
      </div>
    </Drawer>
  )
}

export function CollectionsDrill({ open, onClose, collections }: { open: boolean; onClose: () => void; collections: CollectionDrill[] }) {
  const nav = useNavigate()
  return (
    <Drawer open={open} onClose={onClose} title={`تحصيلات اليوم (${collections.length})`}>
      <div className="space-y-1.5">
        {collections.length === 0 ? (
          <p className="text-center text-xs text-text-secondary py-6">لا توجد تحصيلات اليوم</p>
        ) : collections.map((c) => (
          <button key={c.id} type="button" onClick={() => { nav('/collections'); onClose() }}
            className="w-full text-right bg-surface rounded-lg px-3 py-2 hover:bg-surface/80 transition-colors active:scale-[0.99] border border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-green-600">{formatCurrencyShort(c.amount)}</span>
              <span className="text-[10px] text-text-secondary">{c.employee_name || ''}</span>
            </div>
            <div className="text-[9px] text-text-secondary">{fmtTime(c.created_at)}</div>
          </button>
        ))}
      </div>
    </Drawer>
  )
}

export function EmployeesDrill({ open, onClose, employees }: { open: boolean; onClose: () => void; employees: EmployeeDrill[] }) {
  const conColor = (s: string) =>
    s === 'active' ? 'text-green-600 bg-green-50' :
    s === 'delayed' ? 'text-amber-600 bg-amber-50' :
    s === 'lost' ? 'text-red-600 bg-red-50' : 'text-gray-600 bg-gray-50'
  const conLabel = (s: string) =>
    s === 'active' ? 'متصل' : s === 'delayed' ? 'متأخر' : s === 'lost' ? 'منقطع' : s
  return (
    <Drawer open={open} onClose={onClose} title={`الموظفون النشطون (${employees.length})`}>
      <div className="space-y-1.5">
        {employees.length === 0 ? (
          <p className="text-center text-xs text-text-secondary py-6">لا يوجد موظفون نشطون</p>
        ) : employees.map((e) => (
          <div key={e.id} className="bg-surface rounded-lg px-3 py-2 border border-border/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text">{e.name}</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${conColor(e.connection_status)}`}>{conLabel(e.connection_status)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <div className="text-center bg-white rounded-md py-1 border border-border/50">
                <div className="text-xs font-bold text-primary">{e.visit_count}</div>
                <div className="text-[8px] text-text-secondary">زيارات</div>
              </div>
              <div className="text-center bg-white rounded-md py-1 border border-border/50">
                <div className="text-xs font-bold text-primary">{e.order_count}</div>
                <div className="text-[8px] text-text-secondary">طلبات</div>
              </div>
              <div className="text-center bg-white rounded-md py-1 border border-border/50">
                <div className="text-xs font-bold text-green-600">{formatCurrencyShort(e.sales_value)}</div>
                <div className="text-[8px] text-text-secondary">مبيعات</div>
              </div>
            </div>
            <div className="text-[9px] text-text-secondary mt-1">
              آخر ظهور: {e.last_seen_at ? fmtTime(e.last_seen_at) : '---'}
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  )
}
