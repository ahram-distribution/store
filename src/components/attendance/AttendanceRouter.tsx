import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { normalizeEmployeeRole } from '../../utils/roleNormalization'

const MANAGEMENT_TARGETS = new Set(['الإدارة العليا', 'مدير بيع'])

export function AttendanceRouter() {
  const { user, token } = useAuthStore()

  if (!token || !user) {
    return <Navigate to="/login" replace />
  }

  if (user.roles?.some((r: string) => MANAGEMENT_TARGETS.has(normalizeEmployeeRole(r)))) {
    return <Navigate to="/attendance/operations" replace />
  }

  return <Navigate to="/attendance/runtime" replace />
}
