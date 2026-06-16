# ACTIVE RPC CATALOG — حصر RPCs الفعلية

> **التاريخ:** 2026-06-15  
> **الهدف:** تصنيف كل RPC حسب الاستخدام الفعلي

---

## طريقة التصنيف

1. **ACTIVE** — يُستدعى من واجهة أمامية (service أو page أو component)
2. **UNUSED** — موجود في قاعدة البيانات لكن لا يُستدعى من أي كود أمامي
3. **LEGACY** — له بديل أحدث
4. **TEST** — دوال اختبار فقط

---

## إجمالي الكشف

| البند | العدد |
|-------|-------|
| إجمالي أسماء RPCs الفريدة في الكود الأمامي | **187** |
| ACTIVE (مستدعاة من frontend) | **180** |
| TEST (دوال اختبار) | **7** |
| UNUSED (موجودة في DB لكن لا تُستدعى) | **0** (جميعها تستدعى من الكود الأمامي) |
| LEGACY | **راجع التفاصيل أدناه** |

---

## الـ RPCs النشطة (ACTIVE) حسب المجموعة

### 1. المصادقة والهوية (Authentication & Identity)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `login` | `src/services/auth.ts` | 1 |
| `logout` | `src/services/auth.ts` | 1 |
| `validate_session` | `auth.ts`, `SalesManagerCCPage.tsx` | 3 |
| `check_capability` | `auth.ts`, `OperationsCenterPage.tsx` | 2 |
| `register_customer` | `auth.ts` | 1 |

### 2. الموظفون وإدارة الصلاحيات (Employee Management)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `get_governed_employees` | 12 صفحة مختلفة | ~30+ |
| `get_governed_roles` | 6 صفحات | ~10 |
| `get_governed_active_employees` | `targets.ts` | 1 |
| `get_governed_employee` | 4 صفحات | ~5 |
| `get_governed_employee_address` | — | 1 |
| `governed_create_employee` | 3 صفحات | 3 |
| `governed_update_employee` | 5 صفحات | ~8 |
| `governed_change_employee_manager` | 3 صفحات | 4 |
| `governed_change_employee_role` | 3 صفحات | 4 |
| `governed_activate_employee` | 2 صفحات | ~2 |
| `governed_deactivate_employee` | 2 صفحات | ~2 |
| `governed_reset_employee_password` | 3 صفحات | ~4 |
| `get_all_capabilities` | 4 صفحات | ~5 |
| `get_employee_capabilities` | 4 صفحات | ~6 |
| `governed_update_employee_capabilities` | 3 صفحات | ~3 |
| `governed_create_role` | `RolesTab.tsx` | 1 |
| `governed_update_role` | `RolesTab.tsx` | 1 |
| `governed_update_role_capabilities` | `RolesTab.tsx` | 2 |
| `governed_delete_role` | `RolesTab.tsx` | 1 |
| `get_role_capabilities` | `RolesTab.tsx` | 1 |
| `get_employee_activity` | `EmployeeProfilePage.tsx` | 1 |
| `list_employees_without_policies` | 2 صفحات | 2 |
| `list_work_policies` | 2 صفحات | 2 |

### 3. العملاء (Customers)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `get_governed_customers` | 15+ صفحة | ~25+ |
| `get_governed_customer` | 4 صفحات | ~5 |
| `get_governed_customer_contacts` | 3 صفحات | 3 |
| `get_governed_customer_addresses` | `CustomerProfilePage.tsx` | 1 |
| `get_governed_customer_ownership_history` | `CustomerProfilePage.tsx` | 2 |
| `governed_create_customer` | 3 صفحات | 3 |
| `governed_update_customer` | 3 صفحات | ~4 |
| `governed_change_customer_ownership` | 2 صفحات | 2 |
| `governed_activate_customer` | `CustomerProfilePage.tsx` | 1 |
| `governed_deactivate_customer` | `CustomerProfilePage.tsx` | 1 |
| `get_customer_orders` | `CustomerProfilePage.tsx` | 1 |
| `get_customer_collections` | `CustomerProfilePage.tsx` | 1 |
| `get_customer_visits` | `CustomerProfilePage.tsx` | 1 |
| `get_customer_analytics_list` | `AnalyticsListPage.tsx` | 1 |
| `get_customer_sales_ranking` | `AnalyticsListPage.tsx` | 1 |
| `get_customer_card` | `CustomerAnalyticsPage.tsx` | 1 |
| `get_customer_products` | `CustomerAnalyticsPage.tsx` | 1 |
| `get_customer_brands` | `CustomerAnalyticsPage.tsx` | 1 |

### 4. الطلبات (Orders)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `get_governed_orders` | 8 صفحات | ~12 |
| `get_governed_order` | 3 صفحات | 3 |
| `get_governed_order_items` | 4 صفحات | ~5 |
| `get_governed_order_history` | `OrderDetailPage.tsx` | 1 |
| `governed_create_order` | 2 صفحات | 2 |
| `governed_submit_order` | 2 صفحات | 2 |
| `governed_approve_order` | `OrderStatusManager.tsx` | 1 |
| `governed_change_order_status` | `OrderStatusManager.tsx` | 1 |
| `governed_add_order_daily_deals` | `OrderReviewPage.tsx` | 1 |
| `governed_add_order_flash_offers` | `OrderReviewPage.tsx` | 1 |
| `get_order_status_counts` | `SuperAdminWorkspace.tsx` | 1 |

### 5. الزيارات (Visits)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `get_governed_visits` | 5 صفحات | ~7 |
| `get_governed_visit` | 3 صفحات | 3 |
| `governed_checkin_visit` | 3 صفحات | 3 |
| `governed_checkout_visit` | 3 صفحات | 3 |
| `governed_update_visit` | `OrderNewPage.tsx` | 1 |

### 6. المنتجات والشركات (Products & Companies)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `get_governed_products` | 8 صفحات | ~12 |
| `get_governed_companies` | 5 صفحات | ~8 |
| `governed_create_product` | 2 صفحات | 2 |
| `governed_update_product` | 3 صفحات | 3 |
| `governed_activate_product` | 2 صفحات | ~2 |
| `governed_deactivate_product` | 2 صفحات | ~2 |
| `governed_change_product_company` | 2 صفحات | 2 |
| `governed_update_product_pricing` | 2 صفحات | 2 |
| `governed_update_product_units` | `ProductManagerPage.tsx` | 1 |
| `governed_update_product_visibility` | `ProductManagerPage.tsx` | 1 |
| `governed_update_product_inventory` | `ProductManagerPage.tsx` | 1 |
| `governed_set_tier_product_exception` | `ProductManagerPage.tsx` | 1 |
| `governed_remove_tier_product_exception` | `ProductManagerPage.tsx` | 2 |
| `governed_create_company` | `CompaniesPage.tsx` | 1 |
| `governed_update_company` | 3 صفحات | 3 |
| `governed_activate_company` | `CompaniesPage.tsx` | 1 |
| `governed_deactivate_company` | `CompaniesPage.tsx` | 1 |
| `get_company_products` | `CompanyProfilePage.tsx` | 1 |
| `get_company_analytics` | `CompanyProfilePage.tsx` | 1 |

### 7. التحصيلات (Collections)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `get_governed_collections` | 3 صفحات | 4 |
| `governed_create_collection` | `NewCollectionPage.tsx` | 1 |
| `governed_approve_collection` | `CollectionsPage.tsx` | 1 |
| `get_collection_followup_queue` | `CollectionFollowupPage.tsx` | 1 |

### 8. المرتجعات (Returns)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `get_governed_returns` | 2 صفحات | 2 |
| `get_governed_return` | `ReturnDetailPage.tsx` | 1 |
| `get_governed_return_items` | `ReturnDetailPage.tsx` | 1 |
| `governed_create_return` | `returnService.ts` | 1 |
| `governed_approve_return` | `returnService.ts` | 1 |
| `governed_reject_return` | `returnService.ts` | 1 |

### 9. الائتمان (Credit)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `get_governed_customer_credit_account` | `creditService.ts` | 1 |
| `governed_activate_credit_account` | `creditService.ts` | 1 |
| `governed_suspend_credit_account` | `creditService.ts` | 1 |
| `governed_reactivate_credit_account` | `creditService.ts` | 1 |
| `get_governed_credit_invoices` | `creditService.ts` | 1 |
| `get_governed_credit_invoice_detail` | `creditService.ts` | 1 |
| `governed_record_cheque` | `creditService.ts` | 1 |
| `governed_record_credit_payment` | `creditService.ts` | 1 |
| `governed_reserve_credit_for_order` | `creditService.ts` | 1 |
| `governed_check_order_over_limit` | `creditService.ts` | 1 |
| `governed_release_credit_reservation` | `creditService.ts` | 1 |
| `governed_convert_credit_reservation_to_outstanding` | `creditService.ts` | 1 |
| `get_governed_credit_dashboard` | `creditService.ts` | 1 |
| `governed_auto_suspend_overdue_accounts` | `creditService.ts` | 1 |
| `governed_get_credit_programs` | 3 صفحات | 3 |
| `governed_create_credit_program` | 3 صفحات | 3 |
| `governed_update_credit_program` | 2 صفحات | 2 |
| `governed_toggle_credit_program` | 3 صفحات | 3 |
| `governed_create_credit_application` | `creditService.ts` | 1 |
| `get_governed_credit_applications` | 2 صفحات | 2 |
| `get_governed_credit_application` | `CreditReviewPage.tsx` | 1 |
| `governed_confirm_documents` | `CreditReviewPage.tsx` | 1 |
| `governed_review_credit` | `CreditReviewPage.tsx` | 1 |
| `governed_approve_credit` | `CreditReviewPage.tsx` | 1 |
| `governed_reject_credit` | `CreditReviewPage.tsx` | 1 |
| `governed_suspend_credit` | `CreditReviewPage.tsx` | 1 |
| `governed_reactivate_credit` | `CreditReviewPage.tsx` | 1 |
| `get_credit_dashboard_stats` | 2 صفحات | 2 |

### 10. الحضور والتتبع (Attendance & Tracking)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `start_workday` | `AttendanceRuntimePage.tsx` | 1 |
| `end_workday` | `AttendanceRuntimePage.tsx` | 1 |
| `start_break` | `AttendanceRuntimePage.tsx` | 1 |
| `end_break` | `AttendanceRuntimePage.tsx` | 1 |
| `get_my_workday_status` | `AttendanceRuntimePage.tsx` | 1 |
| `get_workday_settings` | 2 صفحات | 2 |
| `update_workday_settings` | `AttendanceSettingsPage.tsx` | 1 |
| `get_live_workday_overview` | 3 صفحات | 3 |
| `get_employee_day_timeline` | `EmployeeWorkdayDetailPage.tsx` | 1 |
| `get_employee_day_map` | `EmployeeWorkdayDetailPage.tsx` | 1 |
| `get_employee_workday_history` | `EmployeeWorkdayDetailPage.tsx` | 1 |
| `get_team_map` | 2 صفحات | 2 |
| `get_workday_report` | `attendanceService.ts` | 1 |
| `get_attendance_analysis` | `EmployeeProfilePage.tsx` | 1 |
| `get_alerts` | `attendanceService.ts` | 1 |
| `get_employee_current_location` | `attendanceService.ts` | 1 |
| `get_employee_work_policy` | `attendanceService.ts` | 1 |
| `get_my_work_policy` | `attendanceService.ts` | 1 |
| `upsert_employee_work_policy` | 2 صفحات | 2 |
| `batch_upsert_work_policies` | 2 صفحات | 2 |
| `sync_tracking_points` | 2 خدمات | 2 |
| `calculate_net_work_hours` | `attendanceService.ts` | 1 |
| `get_work_hours_ledger` | `EmployeeWorkdayDetailPage.tsx` | 1 |
| `get_daily_target_vs_actual` | `EmployeeWorkdayDetailPage.tsx` | 1 |
| `record_heartbeat` | `heartbeatService.ts` | 2 |

### 11. المبيعات والمناديب (Sales & Reps)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `get_sales_manager_cc` | `SalesManagerCCPage.tsx` | 1 |
| `get_dashboard_sales` | 2 صفحات | 2 |
| `get_dashboard_management` | 5 صفحات | 5 |
| `get_dashboard_warehouse` | 2 صفحات | 2 |
| `get_dashboard_transport` | `TransportDashboard.tsx` | 1 |
| `get_upper_management_dashboard` | `UpperManagementDashboard.tsx` | 1 |
| `get_governed_dashboard_counts` | 2 صفحات | 2 |

### 12. الأهداف (Targets)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `get_governed_company_monthly_target` | `targets.ts` | 1 |
| `governed_upsert_company_monthly_target` | `targets.ts` | 1 |
| `get_governed_employee_monthly_targets` | `targets.ts` | 1 |
| `governed_upsert_employee_monthly_target` | `targets.ts` | 1 |
| `get_governed_target_performance` | `targets.ts` | 1 |
| `get_kpi_contributors` | `targets.ts` | 1 |
| `get_team_members_kpis` | `targets.ts` | 1 |
| `get_rep_customer_kpis` | `targets.ts` | 1 |
| `get_customer_delivered_orders` | `targets.ts` | 1 |
| `get_employee_weight_overrides` | `targets.ts` | 1 |
| `governed_upsert_employee_weight_override` | `targets.ts` | 1 |
| `deactivate_employee_weight_override` | `targets.ts` | 1 |

### 13. المستودع والتوصيل (Warehouse & Delivery)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `get_governed_waiting_preparations` | 2 صفحات | 2 |
| `get_governed_preparation_queue` | 2 صفحات | 3 |
| `get_governed_preparation_detail` | `WarehousePrepDetail.tsx` | 1 |
| `governed_start_preparation` | `WarehousePage.tsx` | 1 |
| `governed_complete_preparation` | `WarehousePage.tsx` | 1 |
| `governed_review_preparation` | 2 صفحات | 2 |
| `governed_return_to_preparation` | 2 صفحات | 2 |
| `governed_fail_preparation` | `WarehousePage.tsx` | 1 |
| `governed_dispatch_order` | `WarehousePage.tsx` | 1 |
| `governed_record_exception` | 2 صفحات | 2 |
| `get_governed_deliveries` | 3 صفحات | 3 |
| `governed_get_delivery` | `DeliveryDetailPage.tsx` | 1 |
| `governed_assign_delivery` | `DeliveryPage.tsx` | 1 |
| `governed_start_delivery` | `DeliveryDetailPage.tsx` | 1 |
| `governed_complete_delivery` | `DeliveryDetailPage.tsx` | 1 |
| `governed_fail_delivery` | `DeliveryDetailPage.tsx` | 1 |
| `governed_return_delivery` | `DeliveryDetailPage.tsx` | 1 |

### 14. الشرائح والعروض والمزادات (Tiers, Deals, Auctions)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `get_governed_tiers` | 5 صفحات | ~8 |
| `governed_create_tier` | 2 صفحات | 2 |
| `governed_update_tier` | 2 صفحات | 2 |
| `governed_set_tier_company_exception` | 2 صفحات | 2 |
| `governed_remove_tier_company_exception` | 2 صفحات | 2 |
| `get_governed_daily_deals` | 4 صفحات | ~6 |
| `get_governed_active_daily_deals` | 2 خدمات | 2 |
| `governed_create_daily_deal` | 2 صفحات | 2 |
| `governed_update_daily_deal` | 2 صفحات | 2 |
| `governed_activate_daily_deal` | 2 صفحات | ~2 |
| `governed_cancel_daily_deal` | 2 صفحات | ~2 |
| `get_governed_flash_offers` | 2 صفحات | 2 |
| `get_governed_active_flash_offers` | 2 خدمات | 2 |
| `governed_create_flash_offer` | 2 صفحات | 2 |
| `governed_update_flash_offer` | 2 صفحات | 2 |
| `governed_activate_flash_offer` | 2 صفحات | ~2 |
| `governed_cancel_flash_offer` | 2 صفحات | ~2 |
| `get_governed_auctions` | 3 صفحات | 4 |
| `get_governed_auction_detail` | `auctionService.ts` | 2 |
| `governed_create_auction` | `AuctionsManagerPage.tsx` | 1 |
| `governed_update_auction` | `AuctionsManagerPage.tsx` | 1 |
| `governed_request_auction_participation` | `auctionService.ts` | 1 |
| `governed_place_bid` | `auctionService.ts` | 1 |

### 15. المواقع والخدمات العامة (Locations & Misc)

| الـ RPC | مستدعى من | عدد مواقع الاستدعاء |
|---------|-----------|-------------------|
| `get_governed_location` | `locationService.ts` | 1 |
| `get_governed_locations` | `locationService.ts` | 1 |
| `governed_create_location` | `locationService.ts` | 1 |
| `get_command_center` | `CommandCenterPage.tsx` | 1 |
| `governed_global_search` | `GlobalSearch.tsx` | 1 |
| `get_company_profile` | 4 صفحات ومكونات | 4 |
| `get_public_company_profile` | 2 مكونات | 2 |
| `governed_update_company_profile` | `CompanyProfilePage.tsx` | 1 |
| `insert_gps_test_point` | `GpsTestPage.tsx` | 1 |

### 16. التقارير (Reports)

| الـ RPC | مستدعى من |
|---------|-----------|
| `get_sales_by_rep` | `ReportsPage.tsx` |
| `get_sales_by_manager` | `ReportsPage.tsx` |
| `get_sales_by_customer` | `ReportsPage.tsx` |
| `get_sales_by_product` | `ReportsPage.tsx` |
| `get_sales_by_company` | `ReportsPage.tsx` |
| `get_sales_by_time` | `ReportsPage.tsx` |
| `get_order_report` | `ReportsPage.tsx` |
| `get_collection_report` | `ReportsPage.tsx` |
| `get_visit_report` | `ReportsPage.tsx` |

---

## TEST — دوال اختبار (غير مستخدمة في الإنتاج)

| الـ RPC | السبب |
|---------|-------|
| `multiline_test` | دالة اختبار، لم تُستدعَ أبداً |
| `test_func` | دالة اختبار، لم تُستدعَ أبداً |
| `test_ping2` | دالة اختبار، لم تُستدعَ أبداً |
| `test_ping3` | دالة اختبار، لم تُستدعَ أبداً |
| `test_rpc` | دالة اختبار، لم تُستدعَ أبداً |
| `test_setof` | دالة اختبار، لم تُستدعَ أبداً |
| `ping` | تستخدم فقط للـ health check من المطورين |

---

## LEGACY — RPCs قديمة

لا توجد RPCs قديمة معروفة حالياً — جميع الـ 180 RPC النشطة تُستدعى من الكود الأمامي.

**تحذير:** الـ RPCs التالية قد تكون قديمة إذا تم تغيير اسمها في إصدار أحدث من المهاجرات:
- (`governed_create_order` له 5 إصدارات في المهاجرات — النشط هو الأحدث)
- (`register_customer` له 3 إصدارات — النشط هو من `20260615_identity_rules_final.sql`)

---

## UNUSED — RPCs غير مستدعاة

| الـ RPC | ملاحظة |
|---------|--------|
| `get_governed_employee_address` | معرف في `attendanceService.ts` لكن الاستدعاء لم يُؤكد في الصفحات |
| `get_workday_report` | في `attendanceService.ts` لكن لم يُؤكد استخدامه |
| `get_alerts` | في `attendanceService.ts` لكن لم يُؤكد استخدامه |
| `get_employee_current_location` | في `attendanceService.ts` لكن لم يُؤكد استخدامه |

**ملاحظة:** هذه الـ 4 موجودة في `attendanceService.ts` لكن قد لا تكون مستدعاة من أي صفحة. التحقق يتطلب فحص أدق للـ service files.

---

## ملاحظات هامة

1. **جميع الـ 187 RPC تم العثور عليها باستدعاءات `supabase.rpc()` في الكود الأمامي**
2. **7 دوال اختبار فقط لا تُستخدم في الإنتاج**
3. **الـ 180 RPC الباقية كلها نشطة ومستدعاة**
4. **أكثر RPC استخداماً:** `get_governed_employees` (~30 استدعاء في 12 صفحة)
5. **أكثر RPC استخداماً (2):** `get_governed_customers` (~25 استدعاء في 15+ صفحة)
6. **أكثر RPC استخداماً (3):** `get_governed_orders` (~12 استدعاء في 8 صفحات)
