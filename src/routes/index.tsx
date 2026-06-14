import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { LoginPage, RegistrationPage } from '../pages/auth'
import { ProtectedRoute } from '../components/auth/ProtectedRoute'
import { CompaniesPage, StorefrontPage, CartPage, OrderReviewPage } from '../pages/storefront'
import { CheckoutPage } from '../pages/checkout/CheckoutPage'
import { OrderSuccessPage } from '../pages/checkout/OrderSuccessPage'
import { OrdersPage, OrderDetailPage, OrderEditPage, OrderNewPage, ApprovalQueuePage } from '../pages/orders'
import { AccountPage } from '../pages/account/AccountPage'
import { UserProfilePage } from '../pages/account/UserProfilePage'
import { UserPermissionsPage } from '../pages/account/UserPermissionsPage'
import { ProductManagerPage } from '../pages/products/ProductManagerPage'
import { CompanyManagerPage } from '../pages/companies/CompanyManagerPage'
import { VisitsPage, VisitDetailPage, VisitScreen, NewVisitPage } from '../pages/visits'
import { CollectionsPage, NewCollectionPage } from '../pages/collections'
import { ReturnsPage, ReturnDetailPage, ReturnNewPage } from '../pages/returns'
import { ProductsPage, ProductProfilePage } from '../pages/products'
import { DealsPage } from '../pages/deals'
import { DailyDealsPage, DailyDealDetailPage, DailyDealsManagementPage } from '../pages/daily-deals'
import { FlashOffersPage, FlashOfferDetailPage, FlashOffersManagementPage } from '../pages/flash-offers'
import { TierSystemPage, TiersManagerPage } from '../pages/tiers'
import { AuctionsPage, AuctionDetailPage, AuctionsManagerPage } from '../pages/auctions'
import { CustomersPage, CustomerProfilePage, NewCustomerPage } from '../pages/customers'
import { DashboardPage } from '../pages/dashboard'
import PerformanceAnalysisPage from '../pages/dashboard/PerformanceAnalysisPage'
import CompanyTargetsPage from '../pages/dashboard/CompanyTargetsPage'
import EmployeeTargetsPage from '../pages/dashboard/EmployeeTargetsPage'
import EmployeeAnalysisPage from '../pages/dashboard/EmployeeAnalysisPage'
import { ModuleLauncherPage } from '../pages/dashboard/ModuleLauncherPage'
import { AnalyticsListPage } from '../pages/analytics/AnalyticsListPage'
import { CustomerAnalyticsPage } from '../pages/analytics/CustomerAnalyticsPage'
import { CreditProgramsPage, CreditProgramsManagerPage, CreditApplicationsPage, CreditReviewPage, CustomerCreditPage, CreditManagementPage } from '../pages/credit'
import { DeliveryPage, DeliveryDetailPage, CollectionFollowupPage } from '../pages/delivery'
import { WarehousePage, WarehouseReviewPage, WarehousePrepDetail } from '../pages/warehouse'
import { EmployeesPage, EmployeeProfilePage, HierarchyPage, EmployeeManagementPage } from '../pages/employees'
import { CompaniesPage as MgmtCompaniesPage, CompanyProfilePage } from '../pages/companies'
import { ReportsPage } from '../pages/reports'
import { CompanyProfilePage as SettingsCompanyProfilePage } from '../pages/settings'
import ActivityPage from '../pages/activity/ActivityPage'
import { SupervisorPage } from '../pages/supervisor/SupervisorPage'
import { CommandCenterPage, ModuleWorkspacePage } from '../pages/command-center'
import {
  AttendancePage,
  AttendanceSettingsPage,
  LiveMonitoringPage,
  TeamMapPage,
  AlertsPage,
  AttendanceReportsPage,
  HistoryPage,
  EmployeeDayMapPage,
  EmployeeWorkdayDetailPage,
} from '../pages/attendance'
import { AttendanceRuntimePage } from '../pages/attendance/runtime'
import { AttendanceRouter } from '../components/attendance/AttendanceRouter'
import { OperationsCenterPage } from '../pages/operations-center'
import { SalesManagerCCPage } from '../pages/sales-manager'
import { GpsTestPage } from '../pages/diagnostics'

export function AppRoutes() {
  const { token } = useAuthStore()

  if (!token) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegistrationPage />} />
        <Route path="/storefront" element={<CompaniesPage />} />
        <Route path="/storefront/products" element={<StorefrontPage />} />
        <Route path="/daily-deals" element={<DailyDealsPage />} />
        <Route path="/daily-deals/:id" element={<DailyDealDetailPage />} />
        <Route path="/flash-offers" element={<FlashOffersPage />} />
        <Route path="/flash-offers/:id" element={<FlashOfferDetailPage />} />
        <Route path="/tiers" element={<TierSystemPage />} />
        <Route path="/auctions" element={<AuctionsPage />} />
        <Route path="/auctions/:id" element={<AuctionDetailPage />} />
        <Route path="*" element={<Navigate to="/storefront" replace />} />
      </Routes>
    )
  }

  const user = useAuthStore.getState().user

  return (
    <Routes>
      <Route path="/login" element={<Navigate to={user?.identity_type === 'employee' ? '/dashboard' : '/storefront'} replace />} />

      <Route path="/" element={<Navigate to={user?.identity_type === 'employee' ? '/dashboard' : '/storefront'} replace />} />

      {/* Protected routes */}
      <Route path="/dashboard" element={<ProtectedRoute employeeOnly><DashboardPage /></ProtectedRoute>} />
      <Route path="/dashboard/performance" element={<ProtectedRoute employeeOnly><PerformanceAnalysisPage /></ProtectedRoute>} />
      <Route path="/dashboard/company-targets" element={<ProtectedRoute employeeOnly><CompanyTargetsPage /></ProtectedRoute>} />
      <Route path="/dashboard/employee-targets" element={<ProtectedRoute employeeOnly><EmployeeTargetsPage /></ProtectedRoute>} />
      <Route path="/dashboard/employee-analysis" element={<ProtectedRoute employeeOnly><EmployeeAnalysisPage /></ProtectedRoute>} />
      <Route path="/supervisor" element={<ProtectedRoute employeeOnly><SupervisorPage /></ProtectedRoute>} />
      <Route path="/storefront" element={<ProtectedRoute><CompaniesPage /></ProtectedRoute>} />
      <Route path="/storefront/products" element={<ProtectedRoute><StorefrontPage /></ProtectedRoute>} />
      <Route path="/cart" element={<ProtectedRoute><CartPage /></ProtectedRoute>} />
      <Route path="/order-review" element={<ProtectedRoute><OrderReviewPage /></ProtectedRoute>} />
      <Route path="/checkout" element={<ProtectedRoute><CheckoutPage /></ProtectedRoute>} />
      <Route path="/order-success" element={<ProtectedRoute><OrderSuccessPage /></ProtectedRoute>} />
      <Route path="/orders" element={<ProtectedRoute><OrdersPage /></ProtectedRoute>} />
      <Route path="/orders/new" element={<ProtectedRoute employeeOnly><OrderNewPage /></ProtectedRoute>} />
      <Route path="/orders/:id" element={<ProtectedRoute><OrderDetailPage /></ProtectedRoute>} />
      <Route path="/orders/:id/edit" element={<ProtectedRoute requireCapability="orders.update"><OrderEditPage /></ProtectedRoute>} />
      <Route path="/orders/approval-queue" element={<ProtectedRoute requireCapability="orders.approve"><ApprovalQueuePage /></ProtectedRoute>} />
      <Route path="/account" element={<ProtectedRoute><AccountPage /></ProtectedRoute>} />
      <Route path="/visits" element={<ProtectedRoute requireCapability="visits.create"><VisitsPage /></ProtectedRoute>} />
      <Route path="/visits/screen" element={<ProtectedRoute requireCapability="visits.create"><VisitScreen /></ProtectedRoute>} />
      <Route path="/visits/new" element={<ProtectedRoute requireCapability="visits.create"><NewVisitPage /></ProtectedRoute>} />
      <Route path="/visits/:id" element={<ProtectedRoute requireCapability="visits.create"><VisitDetailPage /></ProtectedRoute>} />
      <Route path="/customers" element={<ProtectedRoute><CustomersPage /></ProtectedRoute>} />
      <Route path="/customers/new" element={<ProtectedRoute requireCapability="customers.create"><NewCustomerPage /></ProtectedRoute>} />
      <Route path="/customers/:id" element={<ProtectedRoute><CustomerProfilePage /></ProtectedRoute>} />
      <Route path="/customers/:id/analytics" element={<ProtectedRoute employeeOnly><CustomerAnalyticsPage /></ProtectedRoute>} />
      <Route path="/analytics/customers" element={<ProtectedRoute employeeOnly><AnalyticsListPage /></ProtectedRoute>} />
      <Route path="/collections" element={<ProtectedRoute requireCapability="collections.read"><CollectionsPage /></ProtectedRoute>} />
      <Route path="/collections/new" element={<ProtectedRoute requireCapability="collections.create"><NewCollectionPage /></ProtectedRoute>} />
      <Route path="/returns" element={<ProtectedRoute><ReturnsPage /></ProtectedRoute>} />
      <Route path="/returns/new" element={<ProtectedRoute><ReturnNewPage /></ProtectedRoute>} />
      <Route path="/returns/:id" element={<ProtectedRoute><ReturnDetailPage /></ProtectedRoute>} />
      <Route path="/products" element={<ProtectedRoute employeeOnly><ProductsPage /></ProtectedRoute>} />
      <Route path="/products/:id" element={<ProtectedRoute employeeOnly><ProductProfilePage /></ProtectedRoute>} />
      <Route path="/deals" element={<ProtectedRoute employeeOnly><DealsPage /></ProtectedRoute>} />
      <Route path="/daily-deals" element={<ProtectedRoute><DailyDealsPage /></ProtectedRoute>} />
      <Route path="/daily-deals/:id" element={<ProtectedRoute><DailyDealDetailPage /></ProtectedRoute>} />
      <Route path="/daily-deals/manage" element={<ProtectedRoute requireCapability="deals.manage"><DailyDealsManagementPage /></ProtectedRoute>} />
      <Route path="/flash-offers" element={<ProtectedRoute><FlashOffersPage /></ProtectedRoute>} />
      <Route path="/flash-offers/:id" element={<ProtectedRoute><FlashOfferDetailPage /></ProtectedRoute>} />
      <Route path="/flash-offers/manage" element={<ProtectedRoute requireCapability="flash_offers.manage"><FlashOffersManagementPage /></ProtectedRoute>} />
      <Route path="/tiers" element={<ProtectedRoute><TierSystemPage /></ProtectedRoute>} />
      <Route path="/tiers/manage" element={<ProtectedRoute requireCapability="tiers.manage"><TiersManagerPage /></ProtectedRoute>} />
      <Route path="/auctions" element={<ProtectedRoute><AuctionsPage /></ProtectedRoute>} />
      <Route path="/auctions/manage" element={<ProtectedRoute requireCapability="auctions.manage"><AuctionsManagerPage /></ProtectedRoute>} />
      <Route path="/auctions/:id" element={<ProtectedRoute><AuctionDetailPage /></ProtectedRoute>} />
      <Route path="/credit" element={<ProtectedRoute><CustomerCreditPage /></ProtectedRoute>} />
      <Route path="/customer/credit" element={<Navigate to="/credit" replace />} />
      <Route path="/credit/manage" element={<ProtectedRoute requireCapability="credit.manage"><CreditManagementPage /></ProtectedRoute>} />
      <Route path="/credit/programs" element={<ProtectedRoute requireCapability="credit.manage"><CreditProgramsPage /></ProtectedRoute>} />
      <Route path="/credit/programs/manage" element={<ProtectedRoute requireCapability="credit.program.manage"><CreditProgramsManagerPage /></ProtectedRoute>} />
      <Route path="/credit/applications" element={<ProtectedRoute requireCapability="credit.view"><CreditApplicationsPage /></ProtectedRoute>} />
      <Route path="/credit/applications/:id" element={<ProtectedRoute requireCapability="credit.review"><CreditReviewPage /></ProtectedRoute>} />
      <Route path="/warehouse" element={<ProtectedRoute requireCapability="warehouse.prepare"><WarehousePage /></ProtectedRoute>} />
      <Route path="/warehouse/review" element={<ProtectedRoute requireCapability="warehouse.prepare"><WarehouseReviewPage /></ProtectedRoute>} />
      <Route path="/warehouse/prep/:id" element={<ProtectedRoute requireCapability="warehouse.prepare"><WarehousePrepDetail /></ProtectedRoute>} />
      <Route path="/delivery" element={<ProtectedRoute requireCapability="delivery.dispatch"><DeliveryPage /></ProtectedRoute>} />
      <Route path="/delivery/:id" element={<ProtectedRoute requireCapability="delivery.deliver"><DeliveryDetailPage /></ProtectedRoute>} />
      <Route path="/collections/followup" element={<ProtectedRoute requireCapability="collections.read"><CollectionFollowupPage /></ProtectedRoute>} />

      <Route path="/employees" element={<ProtectedRoute requireCapability="employees.manage"><EmployeeManagementPage /></ProtectedRoute>} />
      <Route path="/employees/:id" element={<ProtectedRoute employeeOnly><EmployeeProfilePage /></ProtectedRoute>} />
      <Route path="/hierarchy" element={<ProtectedRoute requireCapability="employees.manage"><HierarchyPage /></ProtectedRoute>} />
      <Route path="/companies" element={<ProtectedRoute><MgmtCompaniesPage /></ProtectedRoute>} />
      <Route path="/companies/:id" element={<ProtectedRoute><CompanyProfilePage /></ProtectedRoute>} />
      <Route path="/reports" element={<ProtectedRoute employeeOnly><ReportsPage /></ProtectedRoute>} />
      <Route path="/activity" element={<ProtectedRoute employeeOnly><ActivityPage /></ProtectedRoute>} />
      <Route path="/settings/company" element={<ProtectedRoute employeeOnly><SettingsCompanyProfilePage /></ProtectedRoute>} />
      <Route path="/launcher/:module" element={<ProtectedRoute employeeOnly><ModuleLauncherPage /></ProtectedRoute>} />
      <Route path="/account/profile" element={<ProtectedRoute employeeOnly><UserProfilePage /></ProtectedRoute>} />
      <Route path="/account/permissions" element={<ProtectedRoute employeeOnly><UserPermissionsPage /></ProtectedRoute>} />
      <Route path="/products/manage" element={<ProtectedRoute employeeOnly><ProductManagerPage /></ProtectedRoute>} />
      <Route path="/companies/manage" element={<ProtectedRoute employeeOnly><CompanyManagerPage /></ProtectedRoute>} />

      <Route path="/command-center" element={<ProtectedRoute employeeOnly><CommandCenterPage /></ProtectedRoute>} />
      <Route path="/command-center/modules/:moduleKey" element={<ProtectedRoute employeeOnly><ModuleWorkspacePage /></ProtectedRoute>} />

      {/* Attendance module routes */}
      <Route path="/attendance" element={<ProtectedRoute employeeOnly><AttendanceRouter /></ProtectedRoute>} />
      <Route path="/attendance/runtime" element={<ProtectedRoute employeeOnly><AttendanceRuntimePage /></ProtectedRoute>} />
      <Route path="/attendance/settings" element={<ProtectedRoute employeeOnly requireCapability="attendance.configure"><AttendanceSettingsPage /></ProtectedRoute>} />
      <Route path="/attendance/live" element={<ProtectedRoute employeeOnly requireCapability="attendance.live_monitor"><LiveMonitoringPage /></ProtectedRoute>} />
      <Route path="/attendance/team-map" element={<ProtectedRoute employeeOnly requireCapability="attendance.view_team_map"><TeamMapPage /></ProtectedRoute>} />
      <Route path="/attendance/alerts" element={<ProtectedRoute employeeOnly requireCapability="attendance.view_alerts"><AlertsPage /></ProtectedRoute>} />
      <Route path="/attendance/reports" element={<ProtectedRoute employeeOnly requireCapability="attendance.view_reports"><AttendanceReportsPage /></ProtectedRoute>} />
      <Route path="/attendance/history" element={<ProtectedRoute employeeOnly requireCapability="attendance.view_history"><HistoryPage /></ProtectedRoute>} />
      <Route path="/attendance/map/:employeeId/:date" element={<ProtectedRoute employeeOnly requireCapability="attendance.view_timeline"><EmployeeDayMapPage /></ProtectedRoute>} />
      <Route path="/attendance/employee/:employeeId/:date" element={<ProtectedRoute employeeOnly requireCapability="attendance.view_history"><EmployeeWorkdayDetailPage /></ProtectedRoute>} />
      <Route path="/attendance/operations" element={<ProtectedRoute employeeOnly requireCapability="attendance.live_monitor"><OperationsCenterPage /></ProtectedRoute>} />

      <Route path="/sales-manager-cc" element={<ProtectedRoute employeeOnly><SalesManagerCCPage /></ProtectedRoute>} />

      <Route path="/ops/gps-test" element={<ProtectedRoute requireUpperManagement><GpsTestPage /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}
