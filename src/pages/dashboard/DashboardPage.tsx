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
import { SupervisorWorkspace } from './SupervisorWorkspace'

function normalizeRole(r: string): string {
  return r.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const empCode = user?.code as string | undefined
  const roles = user?.roles ?? []
  const normalized = roles.map(normalizeRole)
  const raw = roles.map((r: string) => r.toLowerCase())

  console.log('[DashboardPage] user.code:', empCode, 'roles:', roles, 'normalized:', normalized)

  if (empCode === 'WRQ1001') {
    return <WarehouseDashboard />
  }

  const hasRole = (en: string[], ar: string[]) =>
    normalized.some((r) => en.some((e) => r === e || r.includes(e))) ||
    raw.some((r) => ar.some((a) => r === a || r.includes(a)))

  if (hasRole(
    ['superadmin', 'super_admin', 'admin', 'administrator', 'chairman', 'executive_director', 'executive', 'salesdirector', 'sales_director', 'salesmanager', 'sales_manager'],
    ['سوبر أدمن', 'سوبرادمن', 'أدمن', 'ادمن', 'رئيس مجلس الإدارة', 'رئيس مجلس الادارة', 'المدير التنفيذي', 'مدير تنفيذي', 'مدير البيع', 'مدير المبيعات', 'مدير مبيعات']
  )) {
    return <UpperManagementDashboard />
  }

  if (hasRole(['warehousemanager', 'warehouse_manager'], ['مدير مستودع'])) {
    return <WarehouseManagerWorkspace />
  }
  if (hasRole(['warehouse'], ['مستودع'])) {
    return <WarehouseDashboard />
  }
  if (hasRole(['transport', 'delivery'], ['مدير نقل', 'توصيل'])) {
    return <DeliveryWorkspace />
  }
  if (hasRole(['salesrep', 'sales_rep'], ['مندوب مبيعات'])) {
    return <SalesRepWorkDay />
  }
  if (hasRole(['salesdirector', 'sales_director'], ['مدير المبيعات'])) {
    return <SalesDirectorWorkspace />
  }
  if (hasRole(['salesmanager', 'sales_manager'], ['مدير مبيعات'])) {
    return <SalesDashboard />
  }
  if (hasRole(['sales'], ['مبيعات'])) {
    return <SalesDashboard />
  }

  if (hasRole(['collector'], ['محصل'])) {
    return <CollectorWorkspace />
  }
  if (hasRole(['accountant'], ['محاسب'])) {
    return <AccountantWorkspace />
  }
  if (hasRole(['purchasingmanager', 'purchasing_manager'], ['مدير مشتريات'])) {
    return <PurchasingManagerWorkspace />
  }
  if (hasRole(['secretary', 'receptionist'], ['سكرتير'])) {
    return <SecretaryWorkspace />
  }
  if (hasRole(['security'], ['أمن', 'امن'])) {
    return <SecurityWorkspace />
  }
  if (hasRole(['buffet', 'cafeteria', 'kitchen'], ['بوفيه'])) {
    return <BuffetWorkspace />
  }
  if (hasRole(['dataentry', 'data_entry'], ['مدخل بيانات'])) {
    return <DataEntryWorkspace />
  }

  if (hasRole(['generalsupervisor', 'general_supervisor'], ['مشرف تنفيذي'])) {
    return <SupervisorWorkspace />
  }
  if (hasRole(['supervisor'], ['مشرف'])) {
    return <SupervisorWorkspace />
  }

  return <ManagementDashboard />
}
