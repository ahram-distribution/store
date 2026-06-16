# ACTIVE DATABASE USAGE — استخدام جداول قاعدة البيانات

> **التاريخ:** 2026-06-15  
> **الهدف:** توثيق أي الجداول تُقرأ وأيها تُكتب أثناء التشغيل الحقيقي

---

## طريقة التصنيف

1. **ACTIVE** — يُقرأ أو يُكتب بواسطة RPC نشط (مُستدعى من frontend)
2. **UNUSED** — لا يُقرأ ولا يُكتب (بياناته فارغة أو قديمة)
3. **LEGACY** — له بديل أحدث (البيانات تُرحل)

---

## 1. جداول الهوية والصلاحيات (Identity & Auth)

| الجدول | يُقرأ؟ | يُكتب؟ | ACTIVE؟ |
|--------|--------|--------|---------|
| `identities` | نعم — `login`, `register_customer` | نعم — `register_customer` | **ACTIVE** |
| `app.sessions` | نعم — `validate_session` | نعم — `login`, `register_customer` | **ACTIVE** |
| `employees` | نعم — `get_governed_employees` وجميع RPCs الموظفين | نعم — `governed_create_employee`, `governed_update_employee` | **ACTIVE** |
| `roles` | نعم — `get_governed_roles` | نعم — `governed_create_role`, `governed_update_role` | **ACTIVE** |
| `capabilities` | نعم — `get_all_capabilities` | نعم — (عبر RPCs) | **ACTIVE** |
| `employee_roles` | نعم — ضمن استعلامات roles | نعم — `governed_change_employee_role` | **ACTIVE** |
| `role_capabilities` | نعم — `get_role_capabilities` | نعم — `governed_update_role_capabilities` | **ACTIVE** |
| `employee_capabilities` | نعم — `get_employee_capabilities` | نعم — `governed_update_employee_capabilities` | **ACTIVE** |
| `code_sequences` | نعم — ضمن generate_code() | نعم — increment | **ACTIVE** |

---

## 2. جداول العملاء (Customers)

| الجدول | يُقرأ؟ | يُكتب؟ | ACTIVE؟ |
|--------|--------|--------|---------|
| `customers` | نعم — 6+ RPCs مختلفة | نعم — `governed_create_customer`, `register_customer` | **ACTIVE** |
| `customer_contacts` | نعم — `get_governed_customer_contacts` | نعم — `register_customer` | **ACTIVE** |
| `customer_addresses` | نعم — `get_governed_customer_addresses` (قديم) | لا — لا توجد كتابة جديدة | **LEGACY** ← يُستبدل بـ `unified_locations` |
| `customer_ownership_history` | نعم — `get_governed_customer_ownership_history` | نعم — `governed_change_customer_ownership` | **ACTIVE** |
| `customer_credit_ledger` | ضمنياً (عبر credit RPCs) | نعم — (عبر credit RPCs) | **ACTIVE** |

---

## 3. جداول الشركات والمنتجات (Companies & Products)

| الجدول | يُقرأ؟ | يُكتب؟ | ACTIVE؟ |
|--------|--------|--------|---------|
| `companies` | نعم — `get_governed_companies` | نعم — `governed_create_company`, `governed_update_company` | **ACTIVE** |
| `products` | نعم — `get_governed_products` | نعم — `governed_create_product`, `governed_update_product` | **ACTIVE** |
| `product_units` | نعم — ضمن استعلامات products | نعم — `governed_update_product_units` | **ACTIVE** |
| `inventory` | غير مؤكد — قد يُقرأ ضمن استعلامات products | نعم — `governed_update_product_inventory` | **ACTIVE** (مشكوك به) |
| `company_profile` | نعم — `get_company_profile`, `get_public_company_profile` | نعم — `governed_update_company_profile` | **ACTIVE** |

---

## 4. جداول الطلبات (Orders)

| الجدول | يُقرأ؟ | يُكتب؟ | ACTIVE؟ |
|--------|--------|--------|---------|
| `orders` | نعم — `get_governed_orders`, `get_governed_order` | نعم — `governed_create_order`, `governed_update_order` | **ACTIVE** |
| `order_items` | نعم — `get_governed_order_items` | نعم — `governed_create_order` | **ACTIVE** |
| `order_status_history` | نعم — `get_governed_order_history` | نعم — `governed_submit_order`, `governed_approve_order` | **ACTIVE** |
| `order_modification_history` | لا — لم يُؤكد | نعم — (عند تعديل الطلب) | **ACTIVE** (مشكوك به) |

---

## 5. جداول الزيارات (Visits)

| الجدول | يُقرأ؟ | يُكتب؟ | ACTIVE؟ |
|--------|--------|--------|---------|
| `visits` | نعم — `get_governed_visits`, `get_governed_visit` | نعم — `governed_checkin_visit`, `governed_checkout_visit` | **ACTIVE** |

---

## 6. جداول التحصيلات والخزينة (Collections & Treasury)

| الجدول | يُقرأ؟ | يُكتب؟ | ACTIVE؟ |
|--------|--------|--------|---------|
| `collections` | نعم — `get_governed_collections` | نعم — `governed_create_collection`, `governed_approve_collection` | **ACTIVE** |
| `treasury_transactions` | غير مؤكد | نعم — (ضمن collection RPCs) | **ACTIVE** (مشكوك به) |
| `expenses` | لا — لم يُؤكد | لا — 0 صفوف | **UNUSED** |
| `employee_advances` | لا — لم يُؤكد | لا — 0 صفوف | **UNUSED** |

---

## 7. جداول المرتجعات (Returns)

| الجدول | يُقرأ؟ | يُكتب؟ | ACTIVE؟ |
|--------|--------|--------|---------|
| `returns` | نعم — `get_governed_returns`, `get_governed_return` | نعم — `governed_create_return` | **ACTIVE** |
| `return_items` | نعم — `get_governed_return_items` | نعم — `governed_create_return` | **ACTIVE** |
| `return_inspection` | لا — لم يُؤكد | نعم — `governed_approve_return` | **ACTIVE** (مشكوك به) |

---

## 8. جداول العروض (Deals, Offers, Auctions)

| الجدول | يُقرأ؟ | يُكتب؟ | ACTIVE؟ |
|--------|--------|--------|---------|
| `daily_deals` | نعم — `get_governed_daily_deals`, `get_governed_active_daily_deals` | نعم — `governed_create_daily_deal` | **ACTIVE** |
| `daily_deal_items` | ضمنياً | نعم | **ACTIVE** |
| `order_daily_deals` | ضمنياً | نعم | **ACTIVE** |
| `flash_offers` | نعم — `get_governed_flash_offers`, `get_governed_active_flash_offers` | نعم — `governed_create_flash_offer` | **ACTIVE** |
| `flash_offer_items` | ضمنياً | نعم | **ACTIVE** |
| `order_flash_offers` | ضمنياً | نعم | **ACTIVE** |
| `auctions` | نعم — `get_governed_auctions`, `get_governed_auction_detail` | نعم — `governed_create_auction` | **ACTIVE** |
| `auction_items` | ضمنياً | نعم | **ACTIVE** |
| `auction_participants` | نعم — ضمن تفاصيل المزاد | نعم — `governed_request_auction_participation` | **ACTIVE** |
| `auction_bids` | نعم — ضمن تفاصيل المزاد | نعم — `governed_place_bid` | **ACTIVE** |
| `auction_awards` | ضمنياً | نعم | **ACTIVE** |
| `auction_activity` | نعم — Realtime | نعم | **ACTIVE** |

---

## 9. جداول الـ tiers (Tiers)

| الجدول | يُقرأ؟ | يُكتب؟ | ACTIVE؟ |
|--------|--------|--------|---------|
| `tiers` | نعم — `get_governed_tiers` | نعم — `governed_create_tier`, `governed_update_tier` | **ACTIVE** |
| `tier_exceptions` | ضمنياً | نعم | **ACTIVE** |
| `tier_company_exceptions` | ضمنياً | نعم — `governed_set_tier_company_exception` | **ACTIVE** |
| `tier_product_exceptions` | ضمنياً | نعم — `governed_set_tier_product_exception` | **ACTIVE** |

---

## 10. جداول الائتمان (Credit)

| الجدول | يُقرأ؟ | يُكتب؟ | ACTIVE؟ |
|--------|--------|--------|---------|
| `credit_programs` | نعم — `governed_get_credit_programs` | نعم — `governed_create_credit_program` | **ACTIVE** |
| `credit_applications` | نعم — `get_governed_credit_applications` | نعم — `governed_create_credit_application` | **ACTIVE** |
| `credit_contracts` | لا — 0 صفوف (غير مستخدم) | لا | **UNUSED** |
| `credit_contract_templates` | لا — لم يُؤكد | لا | **UNUSED** |

---

## 11. جداول المخازن والتوصيل (Warehouse & Delivery)

| الجدول | يُقرأ؟ | يُكتب؟ | ACTIVE؟ |
|--------|--------|--------|---------|
| `packages` | ضمنياً | نعم | **ACTIVE** |
| `package_items` | ضمنياً | نعم | **ACTIVE** |
| `package_orders` | ضمنياً | نعم | **ACTIVE** |
| `delivery_tracking` | نعم — `get_governed_deliveries`, `governed_get_delivery` | نعم — `governed_assign_delivery` | **ACTIVE** |
| `delivery_attempts` | نعم | نعم | **ACTIVE** |
| `preparation_records` | نعم — `get_governed_preparation_queue`, `get_governed_waiting_preparations` | نعم — `governed_start_preparation` | **ACTIVE** |
| `preparation_exceptions` | نعم — ضمن preparation | نعم — `governed_record_exception` | **ACTIVE** |
| `preparation_status_history` | ضمنياً | نعم | **ACTIVE** |

---

## 12. جداول الحضور والتتبع (Attendance & Tracking)

| الجدول | يُقرأ؟ | يُكتب؟ | ACTIVE؟ |
|--------|--------|--------|---------|
| `workday_settings` | نعم — `get_workday_settings` | نعم — `update_workday_settings` | **ACTIVE** |
| `workday_sessions` | نعم — `get_my_workday_status`, `get_live_workday_overview` | نعم — `start_workday`, `end_workday` | **ACTIVE** |
| `workday_breaks` | نعم — ضمن `end_workday` (auto-close) | نعم — `start_break`, `end_break` | **ACTIVE** |
| `tracking_points` | نعم — `get_employee_day_map`, `get_team_map` | نعم — `start_workday`, `end_workday`, `sync_tracking_points` | **ACTIVE** |
| `visit_links` | ضمنياً | نعم | **ACTIVE** |
| `tracking_cleanup_log` | لا — لم يُؤكد | نعم — (عند التنظيف) | **مشكوك به** |
| `employee_work_policies` | نعم — `get_employee_work_policy`, `list_work_policies` | نعم — `upsert_employee_work_policy` | **ACTIVE** |
| `gps_test_points` | لا — يُستخدم فقط للتشخيص | نعم — `insert_gps_test_point` | **مشكوك به** (تشخيصي) |

---

## 13. جداول المواقع (Locations)

| الجدول | يُقرأ؟ | يُكتب؟ | ACTIVE؟ |
|--------|--------|--------|---------|
| `unified_locations` | نعم — `get_governed_location`, `get_governed_locations` | نعم — `governed_create_location`, `register_customer` | **ACTIVE** |
| `customer_addresses` | نعم — `get_governed_customer_addresses` (قديم) | لا — لا توجد كتابة جديدة | **LEGACY** |

---

## 14. جداول أخرى

| الجدول | يُقرأ؟ | يُكتب؟ | ACTIVE؟ |
|--------|--------|--------|---------|
| `company_monthly_targets` | نعم — `get_governed_company_monthly_target` | نعم — `governed_upsert_company_monthly_target` | **ACTIVE** |
| `employee_monthly_targets` | نعم — `get_governed_employee_monthly_targets` | نعم — `governed_upsert_employee_monthly_target` | **ACTIVE** |
| `system_modules` | نعم — `get_command_center` | لا — للقراءة فقط | **ACTIVE** |
| `owner_decisions` | نعم — `get_command_center` | لا — للقراءة فقط | **ACTIVE** |
| `owner_requests` | نعم — `get_command_center` | لا — للقراءة فقط | **ACTIVE** |
| `module_icon_defaults` | نعم — `get_command_center` | لا — للقراءة فقط | **ACTIVE** |

---

## الجدول النهائي حسب التصنيف

### ACTIVE (يُستخدم فعلياً) — 65 جدولاً

جميع الجداول المذكورة أعلاه عدا المصنفة UNUSED أو LEGACY.

### UNUSED (غير مستخدم) — 4 جداول

| الجدول | السبب |
|--------|-------|
| `expenses` | 0 صفوف، لا يُقرأ ولا يُكتب |
| `employee_advances` | 0 صفوف، لا يُقرأ ولا يُكتب |
| `credit_contracts` | 0 صفوف، سير العمل الائتماني لم يكتمل |
| `credit_contract_templates` | لم يُؤكد استخدامه |

### LEGACY (له بديل) — 1 جدول

| الجدول | البديل |
|--------|--------|
| `customer_addresses` | `unified_locations` (25 صفاً مقابل ~30 صفاً) |

### مشكوك به (SUSPECTED) — 3 جداول

| الجدول | السبب |
|--------|-------|
| `inventory` | يُكتب `governed_update_product_inventory` لكن قراءته غير مؤكدة |
| `tracking_cleanup_log` | يُكتب عند التنظيف لكن لا يُقرأ من UI |
| `gps_test_points` | تشخيصي فقط — يُكتب من GpsTestPage |
