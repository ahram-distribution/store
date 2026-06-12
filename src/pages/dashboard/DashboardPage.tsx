import React from 'react'
import { useAuthStore } from '../../store/auth'
import { SalesDashboard } from './SalesDashboard'
import { SalesRepWorkDay } from '../sales-rep'
import WarehouseDashboard from './WarehouseDashboard'
import { TransportDashboard } from './TransportDashboard'
import { ManagementDashboard } from './ManagementDashboard'
import { AdminWorkspace } from './AdminWorkspace'
import { SuperAdminWorkspace } from './SuperAdminWorkspace'
import { ChairmanWorkspace } from './ChairmanWorkspace'
import UpperManagementDashboard from './UpperManagementDashboard'
import { SalesDirectorWorkspace } from './SalesDirectorWorkspace'
import { AccountantWorkspace } from './AccountantWorkspace'
import { WarehouseManagerWorkspace } from './WarehouseManagerWorkspace'
import { PurchasingManagerWorkspace } from './PurchasingManagerWorkspace'
import { SecretaryWorkspace } from './SecretaryWorkspace'
import { SecurityWorkspace } from './SecurityWorkspace'
import { BuffetWorkspace } from './BuffetWorkspace'
import { DataEntryWorkspace } from './DataEntryWorkspace'
import { CollectorWorkspace } from './CollectorWorkspace'
import { DeliveryWorkspace } from './DeliveryWorkspace'
import { SupervisorPage } from '../supervisor/SupervisorPage'

function normalizeRole(r: string): string {
  return r.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const empCode = user?.code as string | undefined
  const roles = user?.roles ?? []
  const normalized = roles.map(normalizeRole)
  const raw = roles.map((r: string) => r.toLowerCase())

  if (empCode === 'WRQ1001') {
    return <WarehouseDashboard />
  }

  const hasRole = (en: string[], ar: string[]) =>
    normalized.some((r) => en.some((e) => r === e || r.includes(e))) ||
    raw.some((r) => ar.some((a) => r === a))

  const umdMatch = hasRole(
    ['superadmin', 'super_admin', 'admin', 'administrator', 'chairman', 'executive_director', 'executive', 'salesdirector', 'sales_director', 'salesmanager', 'sales_manager'],
    ['سوبر أدمن', 'سوبرادمن', 'أدمن', 'ادمن', 'رئيس مجلس الإدارة', 'رئيس مجلس الادارة', 'المدير التنفيذي', 'مدير تنفيذي', 'مدير البيع', 'مدير المبيعات', 'مدير مبيعات']
  )

  if (umdMatch) {
    return <UpperManagementDashboard />
  }

  const checks = [
    { cond: hasRole(['warehousemanager', 'warehouse_manager'], ['مدير مستودع']), comp: 'WarehouseManagerWorkspace' },
    { cond: hasRole(['warehouse'], ['مستودع']), comp: 'WarehouseDashboard' },
    { cond: hasRole(['transport', 'delivery'], ['مدير نقل', 'توصيل']), comp: 'DeliveryWorkspace' },
    { cond: hasRole(['salesrep', 'sales_rep'], ['مندوب مبيعات']), comp: 'SalesRepWorkDay' },
    { cond: hasRole(['salesdirector', 'sales_director'], ['مدير المبيعات']), comp: 'SalesDirectorWorkspace' },
    { cond: hasRole(['salesmanager', 'sales_manager'], ['مدير مبيعات']), comp: 'SalesDashboard' },
    { cond: hasRole(['sales'], ['مبيعات']), comp: 'SalesDashboard' },
    { cond: hasRole(['collector'], ['محصل']), comp: 'CollectorWorkspace' },
    { cond: hasRole(['accountant'], ['محاسب']), comp: 'AccountantWorkspace' },
    { cond: hasRole(['purchasingmanager', 'purchasing_manager'], ['مدير مشتريات']), comp: 'PurchasingManagerWorkspace' },
    { cond: hasRole(['secretary', 'receptionist'], ['سكرتير']), comp: 'SecretaryWorkspace' },
    { cond: hasRole(['security'], ['أمن', 'امن']), comp: 'SecurityWorkspace' },
    { cond: hasRole(['buffet', 'cafeteria', 'kitchen'], ['بوفيه']), comp: 'BuffetWorkspace' },
    { cond: hasRole(['dataentry', 'data_entry'], ['مدخل بيانات']), comp: 'DataEntryWorkspace' },
    { cond: hasRole(['generalsupervisor', 'general_supervisor'], ['مشرف تنفيذي']), comp: 'SupervisorWorkspace' },
    { cond: hasRole(['supervisor'], ['مشرف مبيعات']), comp: 'SupervisorWorkspace' },
  ]

  const matched = checks.find(c => c.cond)
  if (matched) {
    const map: Record<string, React.ReactNode> = {
      WarehouseManagerWorkspace: <WarehouseManagerWorkspace />,
      WarehouseDashboard: <WarehouseDashboard />,
      DeliveryWorkspace: <DeliveryWorkspace />,
      SalesRepWorkDay: <SalesRepWorkDay />,
      SalesDirectorWorkspace: <SalesDirectorWorkspace />,
      SalesDashboard: <SalesDashboard />,
      CollectorWorkspace: <CollectorWorkspace />,
      AccountantWorkspace: <AccountantWorkspace />,
      PurchasingManagerWorkspace: <PurchasingManagerWorkspace />,
      SecretaryWorkspace: <SecretaryWorkspace />,
      SecurityWorkspace: <SecurityWorkspace />,
      BuffetWorkspace: <BuffetWorkspace />,
      DataEntryWorkspace: <DataEntryWorkspace />,
      SupervisorWorkspace: <SupervisorPage />,
    }
    return map[matched.comp]
  }

  return <ManagementDashboard />
}
