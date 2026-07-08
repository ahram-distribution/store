# 02 – Database Baseline

**التصنيف:** وثيقة قاعدة بيانات  
**الغرض:** توثيق هيكل قاعدة البيانات الحالي (جداول، إنم، RPCs، Views، Triggers، Policies)  
**تاريخ المسح:** 5 يوليو 2026  
**المصدر:** `D:\Projects\store\supabase\migrations\` (170+ ملف هجرة)

---

## 1. Enums (14)

| الاسم | القيم |
|-------|-------|
| `identity_type` | `employee`, `customer` |
| `grant_type` | `grant`, `deny` |
| `ledger_transaction_type` | `debit`, `credit` |
| `daily_deal_status` | `draft`, `scheduled`, `active`, `sold_out`, `expired`, `cancelled` |
| `flash_offer_status` | `draft`, `scheduled`, `active`, `sold_out`, `expired`, `cancelled` |
| `auction_status` | `pending`, `live`, `ended`, `awarded`, `cancelled` |
| `auction_participant_status` | `pending`, `approved`, `rejected`, `blocked` |
| `credit_application_status` | `draft`, `submitted`, `under_review`, `documents_received`, `approved`, `rejected`, `suspended` |
| `preparation_exception_type` | `missing_quantity`, `missing_product`, `damaged_product`, `incomplete_order`, `other` |
| `preparation_status` | `in_progress`, `completed`, `reviewed`, `failed` |
| `business_type` | `wholesaler`, `distributor`, `cosmetics_store`, `supermarket`, `hypermarket`, `perfume_store`, `pharmacy`, `warehouse`, `other` |
| `credit_account_status` | `active`, `suspended`, `closed` |
| `credit_invoice_status` | `open`, `paid`, `overdue` |
| `cheque_status` | `received`, `deposited`, `collected`, `cancelled`, `returned`, `paid_directly` |

---

## 2. Tables (51)

### 2.1 Core Business Tables

| الجدول | الغرض | عدد الأعمدة | المفاتيح الخارجية |
|--------|-------|------------|-------------------|
| `identities` | حسابات المستخدمين (موظف/عميل) | 6 | — |
| `employees` | بيانات الموظفين | 9 | identities, employees(manager) |
| `customers` | بيانات العملاء (شركات) | 15 | identities, employees(owner), unified_locations |
| `customer_addresses` | عنوان العميل | 11 | customers |
| `customer_contacts` | جهات اتصال العميل | 8 | customers |
| `customer_ownership_history` | تاريخ نقل ملكية العميل | 7 | customers, employees |
| `customer_credit_ledger` | دفتر الأستاذ الائتماني | 9 | customers, employees |
| `companies` | الشركات المالكة للمنتجات | 6 | — |
| `products` | المنتجات | 11 | companies |
| `product_units` | وحدات المنتج (قطعة/دستة/كرتونة) | 5 | products |
| `inventory` | المخزون | 5 | products |

### 2.2 Orders & Transactions

| الجدول | الغرض | عدد الأعمدة |
|--------|-------|------------|
| `orders` | الطلبات | 25+ |
| `order_items` | بنود الطلب | 8 |
| `order_status_history` | تاريخ حالة الطلب | 6 |
| `order_modification_history` | تاريخ تعديل الطلب | 7 |
| `collections` | التحصيلات | 18 |
| `treasury_transactions` | معاملات الخزينة | 7 |
| `expenses` | المصروفات | 10 |
| `employee_advances` | سلف الموظفين | 10 |
| `returns` | المرتجعات | 12 |
| `return_items` | بنود المرتجع | 6 |
| `return_inspection` | فحص المرتجع | 5 |
| `return_status_history` | تاريخ حالة المرتجع | 6 |

### 2.3 Visits & Tracking

| الجدول | الغرض | عدد الأعمدة |
|--------|-------|------------|
| `visits` | زيارات العملاء | 17 |
| `workday_sessions` | جلسات يوم العمل (حضور/انصراف) | 20+ |
| `workday_breaks` | فترات الراحة | 10 |
| `workday_settings` | إعدادات يوم العمل (Singleton) | 15 |
| `tracking_points` | نقاط التتبع GPS | 12 |
| `visit_links` | ربط الزيارات بجلسات العمل | 7 |
| `tracking_cleanup_log` | سجل تنظيف التتبع | 8 |

### 2.4 Security & Roles

| الجدول | الغرض | عدد الأعمدة |
|--------|-------|------------|
| `roles` | الأدوار الوظيفية | 5 |
| `capabilities` | الصلاحيات | 6 |
| `employee_roles` | ربط الموظف بالأدوار | 5 |
| `role_capabilities` | ربط الدور بالصلاحية | 4 |
| `employee_capabilities` | صلاحيات إضافية للموظف | 6 |
| `sessions` | جلسات المصادقة (app schema) | 7 |
| `employee_work_policies` | سياسات العمل للموظف | — |

### 2.5 Sales & Marketing

| الجدول | الغرض |
|--------|-------|
| `tiers` | الشرائح التسويقية |
| `tier_exceptions` | استثناءات الشرائح للعملاء |
| `tier_company_exceptions` | خصومات الشريحة لشركة معينة |
| `tier_product_exceptions` | استثناءات منتج في شريحة |
| `daily_deals` | العروض اليومية |
| `daily_deal_items` | منتجات العرض اليومي |
| `order_daily_deals` | ربط العرض بالطلب |
| `flash_offers` | عروض الفلاش |
| `flash_offer_items` | منتجات عرض الفلاش |
| `order_flash_offers` | ربط عرض الفلاش بالطلب |
| `packages` | الباقات |
| `package_items` | منتجات الباقة |
| `package_orders` | ربط الباقة بالطلب |

### 2.6 Auctions

| الجدول | الغرض |
|--------|-------|
| `auctions` | المزادات |
| `auction_items` | منتجات المزاد |
| `auction_participants` | المشاركون في المزاد |
| `auction_bids` | المزايدات |
| `auction_awards` | ترسية المزاد |
| `auction_activity` | نشاط المزاد |

### 2.7 Credit

| الجدول | الغرض |
|--------|-------|
| `credit_programs` | برامج الائتمان |
| `credit_applications` | طلبات الائتمان |
| `credit_contracts` | عقود الائتمان |
| `credit_contract_templates` | قوالب العقود |
| `customer_credit_accounts` | حسابات الائتمان للعملاء |
| `credit_invoices` | فواتير الائتمان |
| `credit_invoice_cheques` | شيكات فواتير الائتمان |

### 2.8 Targets & Weights

| الجدول | الغرض |
|--------|-------|
| `company_monthly_targets` | المستهدفات الشهرية للشركات |
| `employee_monthly_targets` | المستهدفات الشهرية للموظفين |
| `performance_weights_config` | تكوين أوزان الأداء السنوية |
| `employee_weight_overrides` | أوزان أداء مخصصة لموظف |

### 2.9 Other

| الجدول | الغرض |
|--------|-------|
| `company_profile` | الملف التعريفي للشركة (Singleton) |
| `unified_locations` | المواقع الموحدة |
| `location_overrides` | تجاوزات المواقع |
| `code_sequences` | تسلسل الأكواد التلقائية |
| `delivery_tracking` | تتبع التوصيل |
| `preparation_records` | سجلات التجهيز |
| `preparation_exceptions` | استثناءات التجهيز |
| `system_modules` | وحدات النظام (Command Center) |
| `owner_decisions` | قرارات المالك |
| `owner_requests` | طلبات المالك |
| `module_icon_defaults` | أيقونات الوحدات الافتراضية |

---

## 3. Views

تم العثور على الـ Views التالية في ملفات الهجرة:
- `v_product_details` — تفاصيل المنتج مع معلومات الشركة
- `v_order_summary` — ملخص الطلبات
- `v_customer_balance` — رصيد العميل

(ملاحظة: معظم التقارير تستخدم RPCs بدلاً من Views)

---

## 4. RPC Functions

أكثر من **150 RPC** مسجلة عبر ملفات الهجرة. أشهرها:

### 4.1 Auth
| الـ RPC | الغرض |
|---------|-------|
| `login(p_phone, p_password)` | مصادقة المستخدم وإرجاع session token |
| `logout(p_token)` | إنهاء الجلسة |
| `validate_session(p_token)` | التحقق من صحة الـ token وإرجاع بيانات المستخدم |
| `check_capability(p_token, p_code)` | التحقق من صلاحية محددة |
| `register_customer(...)` | تسجيل عميل جديد |

### 4.2 Products
| الـ RPC | الغرض |
|---------|-------|
| `get_governed_products(p_token, p_active_only, p_search, p_visible_only)` | جلب المنتجات مع حوكمة الوصول |
| `governed_create_product(p_token, ...)` | إنشاء منتج جديد |
| `governed_update_product(p_token, ...)` | تحديث منتج |

### 4.3 Orders
| الـ RPC | الغرض |
|---------|-------|
| `get_governed_orders(p_token, ...)` | جلب الطلبات بحوكمة |
| `get_unified_order(p_token, p_order_id)` | جلب طلب موحد بكل تفاصيله |
| `governed_create_order(p_token, ...)` | إنشاء طلب |
| `governed_submit_order(p_token, p_order_id)` | إرسال الطلب |
| `governed_approve_order(p_token, p_order_id)` | الموافقة على الطلب |

### 4.4 Attendance & Tracking
| الـ RPC | الغرض |
|---------|-------|
| `start_workday(p_token, ...)` | بدء يوم العمل |
| `end_workday(p_token, ...)` | إنهاء يوم العمل |
| `start_break(p_token, ...)` | بدء استراحة |
| `end_break(p_token, ...)` | إنهاء استراحة |
| `get_my_workday_status(p_token)` | حالة يوم العمل الحالي |
| `sync_tracking_points(p_token, ...)` | مزامنة نقاط التتبع |
| `get_employee_workday_history(p_token, p_employee_id, p_date)` | تاريخ يوم العمل |
| `calculate_net_work_hours(p_token, ...)` | حساب ساعات العمل الصافية |

### 4.5 Targets & Performance
| الـ RPC | الغرض |
|---------|-------|
| `get_daily_target_vs_actual(p_token, p_date)` | المستهدف مقابل الفعلي يومياً |
| `get_employee_detail_data(p_token, p_employee_id, p_from, p_to)` | بيانات KPI التفصيلية |
| `get_sales_manager_cc(p_token, p_month, p_year)` | لوحة مدير المبيعات |

### 4.6 Reporting
| الـ RPC | الغرض |
|---------|-------|
| `get_completed_workdays_history(p_token, ...)` | تاريخ أيام العمل المكتملة |
| `get_work_hours_ledger(p_token, ...)` | دفتر ساعات العمل |
| `get_coverage_map(p_token, ...)` | خريطة التغطية |
| `get_live_workday_overview(p_token)` | نظرة حية ليوم العمل |

---

## 5. Policies (RLS)

نظام الحوكمة (Governance) مبني على RPC `get_governed_*` وليس على PostgreSQL Row Level Security التقليدية. تم العثور على سياسات RLS أساسية:

| الجدول | السياسة |
|--------|---------|
| `customers` | قيود على التحديث والحذف |
| `employees` | قيود على المشاهدة حسب التسلسل الإداري |
| `orders` | قيود على المشاهدة حسب المالك والجهة |
| `visits` | قيود حسب صلاحية المشاهدة |
| `tracking_points` | قيود حسب الموظف والجلسة |

النظام يعتمد بشكل أساسي على **Governed RPCs** (مثل `get_governed_products`) التي تطبق قواعد الحوكمة داخل الـ Function وليس عبر RLS.

---

## 6. Triggers

بعض المشغلات (Triggers) المسجلة:

| المشغل | الجدول | الغرض |
|--------|--------|-------|
| `update_updated_at_column` | متعدد | تحديث `updated_at` تلقائيًا |
| `log_order_status_change` | `orders` | تسجيل تغييرات حالة الطلب |
| `check_preparation_completion` | `preparation_records` | التحقق من اكتمال التجهيز |
| `update_delivery_attempt` | `delivery_tracking` | إدارة محاولات التوصيل |

---

## 7. Indexes

المؤشرات الأساسية الموجودة:
- `UNIQUE` على `employees.code`, `customers.code`, `products.legacy_code`, `orders.order_number`
- `UNIQUE(employee_id, date) WHERE status = 'active'` لـ `workday_sessions`
- مؤشرات على جميع المفاتيح الخارجية والأعمدة المستخدمة في `WHERE` لتقارير الأداء
