import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../store/auth'
import { SalesDashboard } from './SalesDashboard'
import { SalesRepWorkDay } from '../sales-rep'
import SalesManagerCCPage from '../sales-manager/SalesManagerCCPage'
import WarehouseDashboard from './WarehouseDashboard'
import { ManagementDashboard } from './ManagementDashboard'
import UpperManagementDashboard from './UpperManagementDashboard'
import { WarehouseManagerWorkspace } from './WarehouseManagerWorkspace'
import { ExecutiveOperationsWorkspace } from './ExecutiveOperationsWorkspace'
import { FollowUpWorkspace } from './FollowUpWorkspace'

import { normalizeEmployeeRole, isDeliveryStaffUser, type TargetRole } from '../../utils/roleNormalization'

const WORKSPACE_HIERARCHY: { target: TargetRole; component: React.ReactNode }[] = [
  { target: 'الإدارة العليا', component: <UpperManagementDashboard /> },
  { target: 'مدير بيع', component: <SalesManagerCCPage /> },
  { target: 'مشرف عام', component: <SalesManagerCCPage /> },
  { target: 'مندوب مبيعات', component: <SalesRepWorkDay /> },
  { target: 'متابعة العملاء', component: <FollowUpWorkspace /> },
  { target: 'مدير مخزن', component: <WarehouseManagerWorkspace /> },
  { target: 'سيلز داخلي', component: <ManagementDashboard /> },
  { target: 'مدير عمليات تنفيذية', component: <ExecutiveOperationsWorkspace /> },
]

const DEPRECATED_ROUTES: Record<string, React.ReactNode> = {
  warehouse: <WarehouseDashboard />,
  delivery: <WarehouseDashboard />,
  collector: <ManagementDashboard />,
  accountant: <ManagementDashboard />,
  purchasing_manager: <ManagementDashboard />,
  secretary: <ManagementDashboard />,
  security: <ManagementDashboard />,
  buffet: <ManagementDashboard />,
  data_entry: <ManagementDashboard />,
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const empCode = user?.code as string | undefined
  const roles = user?.roles ?? []

  if (user && isDeliveryStaffUser(user)) {
    return <Navigate to="/my-deliveries" replace />
  }

  if (empCode === 'WRQ1001') {
    return <WarehouseDashboard />
  }

  if (roles.includes('مشرف تنفيذي')) {
    return <ExecutiveOperationsWorkspace />
  }

  if (roles.includes('معتمد ائتماني')) {
    return <Navigate to="/credit/collector" replace />
  }

  for (const { target, component } of WORKSPACE_HIERARCHY) {
    if (roles.some((r: string) => normalizeEmployeeRole(r) === target)) {
      return <>{component}</>
    }
  }

  const rawRoles = roles.map((r: string) => r.toLowerCase())
  for (const [key, component] of Object.entries(DEPRECATED_ROUTES)) {
    if (rawRoles.some((r: string) => r === key || r.includes(key))) {
      return <>{component}</>
    }
  }

  return <ManagementDashboard />
}
