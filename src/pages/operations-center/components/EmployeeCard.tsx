import { useNavigate } from 'react-router-dom'
import { Clock } from 'lucide-react'

interface ActiveEmployee {
  employee_id: string
  name: string
  role_name: string | null
  status: string
  session_status: string
  started_at: string | null
  duration_minutes: number
  net_minutes: number | null
  break_count: number
  break_minutes: number
  target_pct: number | null
  attendance_status: string | null
  late_minutes: number
  schedule_type: string | null
  work_location: string | null
  required_daily_hours: number
  attendance_enabled: boolean | null
  order_count: number
  sales_value: number
  collection_count: number
  collection_amount: number
  new_customer_count: number
  visit_count: number
  latitude: number | null
  longitude: number | null
  last_seen_at: string | null
  connection_status: string
  last_seen_label: string
}

interface NoStartEmployee {
  employee_id: string
  name: string
  role_name: string | null
  schedule_type: string | null
  work_location: string | null
  required_daily_hours: number
  shift_start_time: string | null
  attendance_enabled: boolean | null
}

interface EndedEmployee {
  employee_id: string
  name: string
  role_name: string | null
  ended_at: string | null
  duration_minutes: number
  net_minutes: number | null
  target_pct: number | null
  visit_count: number
  order_count: number
  sales_value: number
  collection_count: number
  collection_amount: number
  new_customer_count: number
  attendance_status: string | null
  break_count: number
  break_minutes: number
  schedule_type: string | null
  work_location: string | null
  required_daily_hours: number
}

type EmployeeCardProps =
  | { variant: 'active'; employee: ActiveEmployee }
  | { variant: 'no_start'; employee: NoStartEmployee }
  | { variant: 'ended'; employee: EndedEmployee }

const locLabel = (loc: string | null) => {
  if (!loc) return null
  return loc === 'field' ? 'ميداني' : loc === 'office' ? 'مكتبي' : loc
}

const schedLabel = (sched: string | null) => {
  if (!sched) return null
  return sched === 'flexible' ? 'مرن' : sched === 'fixed' ? 'ثابت' : sched === 'hourly' ? 'ساعي' : sched
}

const formatDuration = (m?: number | null) => {
  if (m == null) return '--'
  const h = Math.floor(m / 60)
  const min = Math.round(m % 60)
  return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`
}

const statusIcon = (status: string) => {
  switch (status) {
    case 'connected': return <span className="text-green-500">🟢</span>
    case 'delayed': return <span className="text-yellow-500">🟡</span>
    case 'lost': return <span className="text-red-500">🔴</span>
    default: return <span className="text-gray-300">⚪</span>
  }
}

const workStatusLabel = (status: string) => {
  switch (status) {
    case 'working': return 'يعمل'
    case 'on_visit': return 'في زيارة'
    case 'on_break': return 'في استراحة'
    default: return '--'
  }
}

const workStatusColor = (status: string) => {
  switch (status) {
    case 'working': return 'bg-green-100 text-green-700'
    case 'on_visit': return 'bg-blue-100 text-blue-700'
    case 'on_break': return 'bg-amber-100 text-amber-700'
    default: return 'bg-gray-100 text-gray-500'
  }
}

function ProgressBar({ pct, label }: { pct: number | null; label: string }) {
  const safePct = pct != null ? Math.min(Math.max(pct, 0), 100) : 0
  const color = safePct >= 100 ? 'bg-green-500'
    : safePct >= 80 ? 'bg-blue-500'
    : safePct >= 50 ? 'bg-amber-500'
    : 'bg-red-500'

  return (
    <div className="mt-1">
      <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
        <span>{label}</span>
        <span dir="ltr">{safePct.toFixed(0)}%</span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${safePct}%` }} />
      </div>
    </div>
  )
}

export default function EmployeeCard(props: EmployeeCardProps) {
  const navigate = useNavigate()

  const handleDetails = (employeeId: string) => {
    navigate(`/attendance/employee/${employeeId}/${new Date().toISOString().slice(0, 10)}`)
  }

  if (props.variant === 'active') {
    const e = props.employee

    return (
      <div className="bg-white rounded-2xl shadow-sm p-4 border-r-4 transition-all hover:shadow-md"
        style={{
          borderRightColor:
            e.connection_status === 'lost' ? '#ef4444'
            : e.status === 'on_break' ? '#f59e0b'
            : e.status === 'on_visit' ? '#3b82f6'
            : '#22c55e'
        }}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="font-bold text-gray-800 text-sm">{e.name}</span>
            {e.role_name && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{e.role_name}</span>}
          </div>
          <div className="flex items-center gap-1">
            {statusIcon(e.connection_status)}
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mb-1">
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${workStatusColor(e.status)}`}>
            {workStatusLabel(e.status)}
          </span>
        </div>

        <div className="flex items-center gap-1 text-xs text-gray-400 mb-2">
          <Clock className="w-3 h-3" />
          {e.started_at
            ? new Date(e.started_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
            : '--'}
          <span className="mx-1">-</span>
          <span className="font-bold text-gray-600">{formatDuration(e.duration_minutes)}</span>
        </div>

        <ProgressBar
          pct={e.target_pct}
          label={`${formatDuration(e.net_minutes)} / ${formatDuration(e.required_daily_hours * 60)}`}
        />

        <div className="grid grid-cols-4 gap-1 my-2">
          <div className="bg-blue-50 rounded-lg p-1 text-center">
            <p className="text-xs font-bold text-blue-600">{e.visit_count}</p>
            <p className="text-[9px] text-blue-500">زيارات</p>
          </div>
          <div className="bg-purple-50 rounded-lg p-1 text-center">
            <p className="text-xs font-bold text-purple-600">{e.order_count}</p>
            <p className="text-[9px] text-purple-500">طلبات</p>
          </div>
          <div className="bg-emerald-50 rounded-lg p-1 text-center">
            <p className="text-xs font-bold text-emerald-600">{e.sales_value.toLocaleString('ar-EG')}</p>
            <p className="text-[9px] text-emerald-500">مبيعات</p>
          </div>
          <div className="bg-orange-50 rounded-lg p-1 text-center">
            <p className="text-xs font-bold text-orange-600">{e.new_customer_count}</p>
            <p className="text-[9px] text-orange-500">جدد</p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-[10px] text-gray-400">
            {e.connection_status === 'connected' && <span className="text-green-500">🟢 متصل</span>}
            {e.connection_status === 'delayed' && <span className="text-yellow-500">🟡 متأخر</span>}
            {e.connection_status === 'lost' && <span className="text-red-500">🔴 منقطع</span>}
            {e.connection_status === 'no_data' && <span className="text-gray-300">⚪ لا يوجد موقع</span>}
          </div>
          <button
            onClick={() => handleDetails(e.employee_id)}
            className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-1 rounded-lg hover:bg-indigo-100 font-bold"
          >
            التفاصيل
          </button>
        </div>
      </div>
    )
  }

  if (props.variant === 'no_start') {
    const e = props.employee

    return (
      <div className="bg-white rounded-2xl shadow-sm p-4 border-r-4 border-gray-300 transition-all hover:shadow-md">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-gray-300">⚪</span>
          <span className="font-bold text-gray-800 text-sm">{e.name}</span>
          {e.role_name && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{e.role_name}</span>}
        </div>
        <div className="flex flex-wrap gap-1 mb-2">
          <span className="text-[10px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded">لم يبدأ</span>
        </div>
        <div className="text-xs text-gray-400 mb-2">
          {e.shift_start_time
            ? `وقت الدوام: ${new Date(e.shift_start_time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`
            : `الهدف: ${e.required_daily_hours} ساعات`}
        </div>
        <button
          onClick={() => handleDetails(e.employee_id)}
          className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-1 rounded-lg hover:bg-indigo-100 font-bold"
        >
          التفاصيل
        </button>
      </div>
    )
  }

  if (props.variant === 'ended') {
    const e = props.employee

    return (
      <div className="bg-white rounded-2xl shadow-sm p-4 border-r-4 border-green-600 transition-all hover:shadow-md">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-green-600">✅</span>
          <span className="font-bold text-gray-800 text-sm">{e.name}</span>
          {e.role_name && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{e.role_name}</span>}
          <span className="text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded">منتهي</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
          <Clock className="w-3 h-3" />
          {e.ended_at && (
            <span>
              {new Date(e.ended_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })} · {formatDuration(e.duration_minutes)}
            </span>
          )}
        </div>
        <ProgressBar
          pct={e.target_pct}
          label={`${formatDuration(e.net_minutes)} / ${formatDuration(e.required_daily_hours * 60)}`}
        />
        <div className="grid grid-cols-4 gap-1 mt-2 mb-2">
          <div className="bg-blue-50 rounded-lg p-1 text-center">
            <p className="text-xs font-bold text-blue-600">{e.visit_count}</p>
            <p className="text-[9px] text-blue-500">زيارات</p>
          </div>
          <div className="bg-purple-50 rounded-lg p-1 text-center">
            <p className="text-xs font-bold text-purple-600">{e.order_count}</p>
            <p className="text-[9px] text-purple-500">طلبات</p>
          </div>
          <div className="bg-emerald-50 rounded-lg p-1 text-center">
            <p className="text-xs font-bold text-emerald-600">{e.sales_value.toLocaleString('ar-EG')}</p>
            <p className="text-[9px] text-emerald-500">مبيعات</p>
          </div>
          <div className="bg-orange-50 rounded-lg p-1 text-center">
            <p className="text-xs font-bold text-orange-600">{e.new_customer_count}</p>
            <p className="text-[9px] text-orange-500">جدد</p>
          </div>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-[10px] text-gray-400">
            {e.attendance_status === 'late' ? '⏰ متأخر' : e.attendance_status === 'compliant' ? '✅ ملتزم' : ''}
          </span>
          <button
            onClick={() => handleDetails(e.employee_id)}
            className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-1 rounded-lg hover:bg-indigo-100 font-bold"
          >
            التفاصيل
          </button>
        </div>
      </div>
    )
  }

  return null
}

export type { ActiveEmployee, NoStartEmployee, EndedEmployee }
