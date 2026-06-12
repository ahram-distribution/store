import { useNavigate } from 'react-router-dom'

interface ActiveEmp {
  employee_id: string; name: string; status: string; connection_status: string
  started_at: string | null; duration_minutes: number; break_minutes: number
  order_count: number; visit_count: number
}

interface NoStartEmp {
  employee_id: string; name: string; shift_start_time: string | null
}

interface EndedEmp {
  employee_id: string; name: string; ended_at: string | null
}

interface AlertsAreaProps {
  employees: ActiveEmp[]
  noStartEmployees: NoStartEmp[]
  endedEmployees: EndedEmp[]
  onVisitCount: number
  lateCount: number
  zeroOrdersCount: number
  endedCount: number
  hiddenAlerts: Set<string>
  onDismiss: (key: string) => void
}

export interface AlertItem {
  key: string
  type: string
  icon: string
  color: string
  employeeId: string
  employeeName: string
  message: string
}

export function computeAlerts(
  employees: ActiveEmp[],
  noStartEmployees: NoStartEmp[],
): { alerts: AlertItem[]; highSeverity: number } {
  const alerts: AlertItem[] = []
  const now = new Date()
  const hour10 = new Date(); hour10.setHours(10, 0, 0, 0)

  noStartEmployees.forEach((e) => {
    if (now >= hour10) {
      alerts.push({
        key: `no_start_${e.employee_id}`, type: 'no_start', icon: '🔴',
        color: 'border-red-400', employeeId: e.employee_id, employeeName: e.name,
        message: 'لم يبدأ يوم العمل',
      })
    }
  })

  employees.forEach((e) => {
    if (e.connection_status === 'lost') {
      alerts.push({
        key: `lost_${e.employee_id}`, type: 'lost', icon: '⚠️',
        color: 'border-orange-400', employeeId: e.employee_id, employeeName: e.name,
        message: 'انقطاع اتصال — آخر ظهور من أكثر من 15 دقيقة',
      })
    }
    if (e.status === 'on_break' && e.break_minutes > 30) {
      alerts.push({
        key: `long_break_${e.employee_id}`, type: 'long_break', icon: '🟡',
        color: 'border-yellow-400', employeeId: e.employee_id, employeeName: e.name,
        message: `استراحة طويلة — ${Math.round(e.break_minutes)} دقيقة`,
      })
    }
    if (e.duration_minutes > 120 && e.order_count === 0 && e.visit_count === 0) {
      alerts.push({
        key: `no_productivity_${e.employee_id}`, type: 'no_productivity', icon: '📉',
        color: 'border-gray-400', employeeId: e.employee_id, employeeName: e.name,
        message: `لا إنتاج — ${Math.round(e.duration_minutes)} دقيقة بدون طلبات أو زيارات`,
      })
    }
  })

  const highSeverity = alerts.filter((a) => a.type === 'no_start' || a.type === 'lost').length

  return { alerts, highSeverity }
}

export default function AlertsArea({ employees, noStartEmployees, endedEmployees, onVisitCount, lateCount, zeroOrdersCount, endedCount, hiddenAlerts, onDismiss }: AlertsAreaProps) {
  const navigate = useNavigate()
  const { alerts } = computeAlerts(employees, noStartEmployees)

  const visible = alerts.filter((a) => !hiddenAlerts.has(a.key))

  if (visible.length === 0) return null

  return (
    <div className="mb-4">
      <div className="bg-white rounded-xl shadow-sm p-3">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-xs font-bold text-gray-700">🔔 تنبيهات</span>
          <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full font-bold">
            {visible.length}
          </span>
        </div>

        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {visible.map((a) => (
            <div key={a.key} className={`bg-gray-50 rounded-lg p-2 border-r-4 ${a.color} flex items-start justify-between`}>
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => navigate(`/attendance/employee/${a.employeeId}/${new Date().toISOString().slice(0, 10)}`)}
                  className="text-right w-full"
                >
                  <p className="text-[11px] font-bold text-gray-800 truncate">{a.employeeName}</p>
                  <p className="text-[9px] text-gray-500">{a.icon} {a.message}</p>
                </button>
              </div>
              <button onClick={() => onDismiss(a.key)} className="text-gray-300 hover:text-gray-500 mr-1 shrink-0">
                <span className="text-xs">✕</span>
              </button>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 pt-2 border-t border-gray-100 text-[10px] text-gray-500">
          {lateCount > 0 && <span>⏰ متأخرون: {lateCount}</span>}
          <span>✅ منتهون: {endedCount}</span>
          {onVisitCount > 0 && <span>🔵 في زيارة: {onVisitCount}</span>}
          {zeroOrdersCount > 0 && <span>📦 بلا طلبات: {zeroOrdersCount}</span>}
        </div>
      </div>
    </div>
  )
}
