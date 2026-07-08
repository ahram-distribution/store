# 03 – Data Access Map

**التصنيف:** خريطة الوصول للبيانات  
**الغرض:** توثيق كل نقطة وصول للبيانات في الكود وتصنيفها حسب النوع  
**تاريخ المسح:** 5 يوليو 2026

---

## 1. Data Access Patterns المستخدمة

| النوع | هل يُستخدم؟ | مكان الاستخدام |
|-------|------------|----------------|
| **Supabase Client** (createClient) | ✅ | `src/lib/supabase.ts` |
| **RPC** (`supabase.rpc()`) | ✅✅✅ **الأساسي** | جميع الـ Services ومعظم الـ Pages |
| **Direct Table** (`supabase.from('table')`) | ⚠️ نادراً | Storefront (public), بعض الصفحات العامة |
| **REST** | ❌ لا | — |
| **localStorage** | ✅ | Auth token, Cart, Theme, Company profile cache |
| **Session Storage** | ⚠️ نادراً | OrderSuccessPage (تفاصيل الطلب) |
| **Zustand Store** (in-memory) | ✅ | Auth, Cart, Orders, Visits, Account, Companies |
| **Engine** (computed) | ✅ | Pricing engine |

---

## 2. كل استدعاءات `supabase.rpc()` في الـ Frontend

### 2.1 Auth Service (`src/services/auth.ts`)

| الـ RPC | الدالة | الغرض |
|---------|--------|-------|
| `login` | `authService.login()` | مصادقة المستخدم |
| `logout` | `authService.logout()` | إنهاء الجلسة |
| `validate_session` | `authService.validateSession()` | التحقق من صحة الـ token |
| `check_capability` | `authService.checkCapability()` | التحقق من صلاحية |
| `register_customer` | `authService.register()` | تسجيل عميل |

### 2.2 Attendance Service (`src/services/attendance.ts`)

| الـ RPC | الدالة |
|---------|--------|
| `start_workday` | `attendanceService.startWorkday()` |
| `end_workday` | `attendanceService.endWorkday()` |
| `start_break` | `attendanceService.startBreak()` |
| `end_break` | `attendanceService.endBreak()` |
| `get_my_workday_status` | `attendanceService.getMyWorkdayStatus()` |
| `get_workday_settings` | `attendanceService.getWorkdaySettings()` |
| `update_workday_settings` | `attendanceService.updateWorkdaySettings()` |
| `get_live_workday_overview` | `attendanceService.getLiveWorkdayOverview()` |
| `get_auto_closed_sessions_today` | `attendanceService.getAutoClosedSessionsToday()` |
| `get_auto_closed_sessions_month` | `attendanceService.getAutoClosedSessionsMonth()` |
| `get_employee_day_timeline` | `attendanceService.getEmployeeDayTimeline()` |
| `get_employee_day_map` | `attendanceService.getEmployeeDayMap()` |
| `get_employee_workday_history` | `attendanceService.getEmployeeWorkdayHistory()` |
| `get_team_map` | `attendanceService.getTeamMap()` |
| `get_workday_report` | `attendanceService.getWorkdayReport()` |
| `get_attendance_analysis` | `attendanceService.getAttendanceAnalysis()` |
| `get_alerts` | `attendanceService.getAlerts()` |
| `get_employee_current_location` | `attendanceService.getEmployeeCurrentLocation()` |
| `get_employee_work_policy` | `attendanceService.getEmployeeWorkPolicy()` |
| `get_my_work_policy` | `attendanceService.getMyWorkPolicy()` |
| `upsert_employee_work_policy` | `attendanceService.upsertEmployeeWorkPolicy()` |
| `batch_upsert_work_policies` | `attendanceService.batchUpsertWorkPolicies()` |
| `list_work_policies` | `attendanceService.listWorkPolicies()` |
| `sync_tracking_points` | `attendanceService.syncTrackingPoints()` |
| `calculate_net_work_hours` | `attendanceService.calculateNetWorkHours()` |
| `get_work_hours_ledger` | `attendanceService.getWorkHoursLedger()` |
| `get_daily_target_vs_actual` | `attendanceService.getDailyTargetVsActual()` |
| `get_completed_workdays_history` | `attendanceService.getCompletedWorkdaysHistory()` |

### 2.3 Products Service (`src/services/products.ts`)

| الـ RPC | الدالة |
|---------|--------|
| `get_governed_products` | `productService.getProducts(token)` |
| `get_governed_products` (active) | `productService.getActiveProducts(token)` |
| `get_governed_products` (all) | `productService.getAllProducts(token)` |
| `get_governed_products` (search) | `productService.searchProducts(token, query)` |

### 2.4 Returns Service (`src/services/returns.ts`)

| الـ RPC | الدالة |
|---------|--------|
| `get_governed_returns` | `returnService.getReturns(token)` |
| `get_governed_return` | `returnService.getReturn(token, id)` |
| `get_governed_return_items` | `returnService.getReturnItems(token, returnId)` |
| `governed_create_return` | `returnService.createReturn(token, ...)` |
| `governed_approve_return` | `returnService.approveReturn(token, id)` |
| `governed_reject_return` | `returnService.rejectReturn(token, id, reason)` |

### 2.5 Credit Service (`src/services/credit.ts`)

| الـ RPC | الدالة |
|---------|--------|
| `get_governed_customer_credit_account` | `creditService.getMyCreditAccount(token)` |
| `governed_activate_credit_account` | `creditService.activateCreditAccount(...)` |
| `governed_suspend_credit_account` | `creditService.suspendCreditAccount(...)` |
| `governed_reactivate_credit_account` | `creditService.reactivateCreditAccount(...)` |
| `get_governed_credit_invoices` | `creditService.getMyInvoices(token, ...)` |
| `get_governed_credit_invoice_detail` | `creditService.getInvoiceDetail(token, invoiceId)` |
| `governed_record_cheque` | `creditService.recordCheque(...)` |
| `governed_record_credit_payment` | `creditService.recordCreditPayment(...)` |
| `governed_reserve_credit_for_order` | `creditService.reserveCreditForOrder(token, orderId)` |
| `governed_check_order_over_limit` | `creditService.checkOrderOverLimit(token, orderId)` |
| `governed_release_credit_reservation` | `creditService.releaseCreditReservation(token, orderId)` |
| `governed_convert_credit_reservation_to_outstanding` | `creditService.convertReservationToOutstanding(...)` |
| `get_governed_credit_dashboard` | `creditService.getCreditDashboard(token)` |
| `governed_auto_suspend_overdue_accounts` | `creditService.autoSuspendOverdueAccounts()` |
| `governed_get_credit_programs` | `creditService.getCreditPrograms(token, ...)` |
| `governed_create_credit_program` | `creditService.createCreditProgram(...)` |
| `governed_toggle_credit_program` | `creditService.toggleCreditProgram(token, programId)` |
| `governed_create_credit_application` | `creditService.createCreditApplication(token, programId)` |
| `get_governed_credit_applications` | `creditService.getCreditApplications(token)` |

### 2.6 Other Services

| الخدمة | الـ RPCs المستخدمة |
|--------|-------------------|
| `auctions.ts` | `get_governed_auctions`, `get_governed_auction_detail`, `governed_request_auction_participation`, `governed_place_bid` |
| `dailyDeals.ts` | `get_governed_daily_deals`, `get_governed_active_daily_deals`, `governed_create_daily_deal`, `governed_activate_daily_deal`, `governed_cancel_daily_deal` |
| `flashOffers.ts` | `get_governed_flash_offers`, `get_governed_active_flash_offers`, `governed_create_flash_offer`, `governed_activate_flash_offer`, `governed_cancel_flash_offer` |
| `deals.ts` | `get_governed_daily_deals`, `get_governed_active_daily_deals` |
| `tiers.ts` | `get_governed_tiers`, `governed_create_tier`, `governed_update_tier`, `governed_set_tier_company_exception`, `governed_remove_tier_company_exception` |
| `businessActivity.ts` | `get_employee_detail_data` |
| `location.ts` | `get_governed_location`, `get_governed_locations`, `governed_create_location` |
| `targets.ts` | دوال RPC متعددة للمستهدفات |
| `trackingEngine.ts` | `sync_tracking_points` |
| `heartbeatService.ts` | `record_heartbeat`, `check_session_timeout` |
| `lifeSignalService.ts` | `touch_session_activity` |
| `dataDeletion.ts` | RPCs متعددة لحذف البيانات |
| `unifiedSearch.ts` | `unified_search` |
| `useCompanyProfile.ts` | `get_public_company_profile`, `get_company_profile` |

---

## 3. استدعاءات `supabase.from('table').select()` (Direct Table Access)

| الموقع | الجدول | الغرض |
|--------|--------|-------|
| `pages/storefront/CompaniesPage.tsx` | `companies` | جلب الشركات النشطة (عام) |
| `pages/storefront/StorefrontPage.tsx` | `tiers` | جلب الشرائح النشطة (عام) |
| `components/storefront/ProductCard.tsx` | `products` | تفاصيل المنتج |

هذه الاستدعاءات لا تستخدم `p_token` ويتم الوصول إليها مباشرة بدون حوكمة.

---

## 4. localStorage Usage

| المفتاح | المحتوى | مكان الكتابة |
|---------|---------|-------------|
| `session_token` | Token الجلسة | `auth.ts` (بعد login/register) |
| `ahram-cart` | عربة التسوق (مصفوفة items) | `cart.ts` (zustand persist middleware) |
| `ahram_theme` | معرف الثيم (gold/vip) | `ThemeContext.tsx` |
| `company_profile_cache` | بيانات الشركة (24 ساعة) | `useCompanyProfile.ts` |

---

## 5. Session Storage Usage

| المفتاح | المحتوى | مكان الاستخدام |
|---------|---------|----------------|
| `lastOrder` | تفاصيل آخر طلب | `OrderSuccessPage.tsx` |

---

## 6. Zustand Store Data Flow

| الـ Store | نوع البيانات | المصدر (عند التحميل) |
|-----------|-------------|---------------------|
| `auth` (token, user) | localStorage → validate_session RPC | RPC في restoreSession |
| `cart` (items, deals) | localStorage (persisted) | لا يحتاج مصدر خارجي |
| `account` (addresses) | API (get_governed_customer_addresses) | صفحة Account |
| `companies` (refreshKey) | عداد بسيط، لا بيانات | — |
| `orders` (orders list) | API (get_governed_orders) | صفحة Orders |
| `visits` (visits list) | API (get_governed_visits) | صفحة Visits |

---

## 7. البيانات التي لا تمر عبر Service Layer

بعض الصفحات تستدعي `supabase.rpc()` مباشرة بدون وساطة Service:

| الصفحة | الـ RPC |
|--------|---------|
| `pages/analytics/CustomerAnalyticsPage.tsx` | `get_customer_analytics` |
| `pages/analytics/CustomerIntelligenceOverviewPage.tsx` | `get_customer_intelligence_general_stats`, `search_customer_intelligence` |
| `pages/attendance/TeamMapPage.tsx` | `get_team_map_data` |
| `pages/coverage/CoverageMapPage.tsx` | `get_coverage_map_data`, `get_live_employees` |
| `pages/diagnostics/GpsTestPage.tsx` | `ping` |
| `pages/live-activity/LiveActivityCenterPage.tsx` | `get_live_*` متعددة |
| `pages/operations-center/OperationsCenterPage.tsx` | `get_operations_live_overview` |
| `pages/sales-effort/SalesEffortPage.tsx` | `get_sales_effort_data` |
| `pages/command-center/CommandCenterPage.tsx` | `get_system_modules`, `get_owner_decisions` |
| `pages/data-center/DataDeletionCenter.tsx` | `deletion_center_*` متعددة |
| `pages/employees/EmployeeProfilePage.tsx` | `get_employee_activity` |
| `pages/reports/ReportsPage.tsx` | `rpcMap` متعددة |

---

## 8. ملخص: نقاط الاقتران بقاعدة البيانات

| النوع | العدد التقريبي |
|-------|---------------|
| استدعاءات RPC من الـ Services | 120+ |
| استدعاءات RPC مباشرة من الـ Pages | 40+ |
| استدعاءات Direct Table | ~5 |
| إجمالي نقاط الاقتران بقاعدة البيانات | **165+** |

**الخلاصة:** النظام مقترن بشدة بقاعدة بيانات Supabase عبر RPCs. لا توجد طبقة تجريد بين الواجهة ومنطق البيانات.
