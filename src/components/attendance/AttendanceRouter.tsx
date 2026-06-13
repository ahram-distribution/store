import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { normalizeEmployeeRole } from '../../utils/roleNormalization'
import AttendanceModuleHomePage from '../../pages/attendance/AttendanceModuleHomePage'

const MODULE_HOME_TARGETS = new Set(['الإدارة العليا', 'مدير بيع'])

export function AttendanceRouter() {
  const { user, token } = useAuthStore()

  if (!token || !user) {
    return <Navigate to="/login" replace />
  }

  if (user.roles?.some((r: string) => MODULE_HOME_TARGETS.has(normalizeEmployeeRole(r)))) {
    return <AttendanceModuleHomePage />
  }

  return <Navigate to="/attendance/runtime" replace />
}
