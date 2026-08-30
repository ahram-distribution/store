import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { ExecEmployeeRow } from '../../types/executiveFollowup'
import { ExecutiveEmployeeDrawer } from './ExecutiveEmployeeDrawer'

interface DetailNavigationState {
  employee?: ExecEmployeeRow
}

export default function ExecutiveEmployeeDetailPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const employee = (location.state as DetailNavigationState | null)?.employee
  const from = params.get('from') || ''
  const to = params.get('to') || from
  const liveMode = params.get('live') === '1'

  if (!employee || !from || !to) {
    return (
      <div className="max-w-3xl mx-auto bg-white border border-border rounded-xl p-6 text-center" dir="rtl">
        <div className="text-sm font-bold text-text">بيانات الموظف غير متاحة في هذه الصفحة.</div>
        <button onClick={() => navigate('/attendance/executive')} className="mt-3 text-xs font-bold text-blue-700 border border-blue-200 bg-blue-50 rounded-md px-3 py-2">العودة إلى الحضور والمتابعة</button>
      </div>
    )
  }

  return <ExecutiveEmployeeDrawer employee={employee} from={from} to={to} liveMode={liveMode} onClose={() => navigate('/attendance/executive')} />
}
