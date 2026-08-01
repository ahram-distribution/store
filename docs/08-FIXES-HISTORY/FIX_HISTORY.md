# FIX HISTORY — سجل الإصلاحات

> **الهدف:** تسجيل كل مشكلة يتم اكتشافها وإصلاحها رسمياً  
> **التنسيق:** `[YYYY-MM-DD] — وصف المشكلة`  
> **المرجع:** PROJECT_TRUTH_AUDIT.md، SYSTEM_REFERENCE_CURRENT_STATE.md (Section 4 — Runtime)

---

## القواعد

1. كل تغيير في الكود يجب أن يسجل هنا
2. كل مهاجرة SQL جديدة يجب أن تشير إلى الـ Fix ID
3. المشاكل المفتوحة تبقى بدون تاريخ إصلاح
4. ترتيب الإدخالات من الأحدث إلى الأقدم

---

## المشاكل المفتوحة (لم يتم إصلاحها بعد)

### [FIX-001] — Hardcoded Role Names في RPCs
- **الوصف:** 32+ ملف مهاجرة تحتوي على ~91 فحص باسم الدور hardcoded بثلاثة أنماط مختلفة (English trilogy, Arabic trilogy, Extended)
- **السبب:** تطور سريع دون توحيد النمط
- **الإصلاح المقترح:** استخدام `is_upper_management()` أو `app.has_role_by_id()` بدلاً من hardcoded names
- **الملفات المتأثرة:** 32+ ملف مهاجرة SQL
- **الأولوية:** عالية
- **الحالة:** مفتوحة

### [FIX-002] — Hardcoded Employee Codes في RPCs
- **الوصف:** `WRQ1002`, `WRQ1004` موجودة كاستثناءات رؤية في ~25 RPC
- **السبب:** استثناءات سريعة لدعم موظفين محددين
- **الإصلاح المقترح:** استخدام آلية dynamic (مثلاً جدول employee_exceptions أو role-based)
- **الملفات المتأثرة:** ~25 RPC
- **الأولوية:** عالية
- **الحالة:** مفتوحة

### [FIX-003] — Service Layer مهجور
- **الوصف:** الصفحات تستدعي `supabase.rpc()` مباشرة بدلاً من المرور عبر الـ services layer
- **السبب:** الـ services أضيفت لاحقاً والصفحات الحالية لم تُهاجر
- **الإصلاح المقترح:** اعتماد نمط واحد — إما services كلها أو RPC مباشرة كلها
- **الملفات المتأثرة:** جميع الصفحات + 19 service
- **الأولوية:** متوسطة
- **الحالة:** مفتوحة

### [FIX-004] — 29 Console.log في الإنتاج
- **الوصف:** 29 استدعاء `console.*` في 11 ملف، بعضها يعرض بيانات تفصيلية
- **السبب:** بقايا تطوير
- **الإصلاح المقترح:** إزالة console.log غير الضروري، وتحويل الباقي إلى failureLogger
- **الملفات المتأثرة:** 11 ملف (MapTab.tsx, VisitScreen.tsx, إلخ)
- **الأولوية:** منخفضة
- **الحالة:** مفتوحة

### [FIX-005] — customer_addresses غير موحد مع unified_locations
- **الوصف:** نظاما عناوين متوازيان — customer_addresses (قديم) و unified_locations (جديد)
- **السبب:** هيكلة قديمة لم تُهاجر بالكامل
- **الإصلاح المقترح:** ترحيل جميع البيانات من customer_addresses إلى unified_locations
- **الملفات المتأثرة:** customer_addresses جدول، CustomerProfilePage، CustomerForm
- **الأولوية:** متوسطة
- **الحالة:** مفتوحة

### [FIX-006] — تنسيقا ترميز عملاء مختلفان
- **الوصف:** `REG-XXXXXXXX` (تسجيل) مقابل `CUS-YYYY-NNNNNN` (إنشاء يدوي)
- **السبب:** نظامان مختلفان للترميز
- **الإصلاح المقترح:** توحيد التنسيق في نظام واحد
- **الملفات المتأثرة:** customer registration, customer creation workflows
- **الأولوية:** متوسطة
- **الحالة:** مفتوحة

### [FIX-007] — 9 أدوار خارج الهيكل الإداري النهائي
- **الوصف:** محصل، محاسب، أمن، بوفيه، مشتريات، سكرتير، إدخال بيانات، توصيل، مشرف تنفيذي — خارج الهيكل (الإدارة العليا ← مدير بيع ← مندوب ← عميل)
- **السبب:** إما مرحلة سابقة أو متطلبات مستقبلية لم تُوثق
- **الإصلاح المقترح:** مراجعة كل دور وإثبات الحاجة أو إزالة الـ Workspace المرتبط به
- **الملفات المتأثرة:** DashboardPage، 9 Workspace components
- **الأولوية:** متوسطة
- **الحالة:** مفتوحة

### [FIX-008] — types/database.ts قديم
- **الوصف:** يغطي 6 جداول فقط من أصل 72
- **السبب:** لم يتم تحديثه مع تطور النظام
- **الإصلاح المقترح:** تحديث الملف ليشمل جميع الجداول الـ72 (أو إنشاء types/ مجلد منظم)
- **الملفات المتأثرة:** types/database.ts
- **الأولوية:** متوسطة
- **الحالة:** مفتوحة

### [FIX-009] — 7 دوال SQL اختبارية
- **الوصف:** `multiline_test`, `test_func`, `test_ping2`, `test_ping3`, `test_rpc`, `test_setof`, `ping`
- **السبب:** بقايا تطوير
- **الإصلاح المقترح:** حذف جميع دوال test_* (إبقاء ping كخيار)
- **الملفات المتأثرة:** قاعدة البيانات (دوال public)
- **الأولوية:** منخفضة
- **الحالة:** مفتوحة

### [FIX-010] — Order GPS غير مطبق
- **الوصف:** 4 أعمدة GPS في orders (execution_latitude, execution_longitude, execution_accuracy_meters, execution_captured_at) كلها null دائماً
- **السبب:** لم يكتمل سير العمل
- **الإصلاح المقترح:** إما تفعيل GPS عند إنشاء الطلب أو إزالة الحقول
- **الملفات المتأثرة:** orders.execution_* أعمدة، OrderNewPage، OrderReviewPage
- **الأولوية:** منخفضة
- **الحالة:** مفتوحة

### [FIX-011] — 5 مستويات Dashboard Workspace غير قابلة للوصول
- **الوصف:** 13 Workspace لأدوار غير ممنوحة لأي موظف حالياً
- **السبب:** أدوار قديمة أو غير مفعلة
- **الإصلاح المقترح:** إخفاء Workspaces غير القابلة للوصول أو إزالتها
- **الملفات المتأثرة:** DashboardPage.tsx
- **الأولوية:** منخفضة
- **الحالة:** مفتوحة

### [FIX-012] — CSS Tailwind فئات غير معرّفة
- **الوصف:** بعض الفئات في المكونات ليست في Tailwind config — قد تظهر مشاكل بعد `npm run build`
- **السبب:** استخدام كلاسات مخصصة بدون تسجيلها
- **الإصلاح المقترح:** مراجعة Tailwind safelist أو توحيد الأنماط
- **الملفات المتأثرة:** مكونات متعددة
- **الأولوية:** منخفضة
- **الحالة:** مفتوحة

### [FIX-013] — تخطي Governance في AccountPage.tsx (خطر أمني)
- **الوصف:** `AccountPage.tsx:156` تستخدم `supabase.from('customer_addresses').select('*')` مباشرة — لا تمر عبر RPC
- **السبب:** كتابة مباشرة بدون استخدام الـ governed layer
- **الإصلاح المقترح:** استخدام `get_governed_customer_addresses` RPC الموجود مسبقاً
- **الملفات المتأثرة:** `src/pages/account/AccountPage.tsx`
- **الأولوية:** عالية
- **الحالة:** مفتوحة

### [FIX-014] — تخطي Governance في CompanyManagerPage.tsx (خطر أمني)
- **الوصف:** `CompanyManagerPage.tsx:72` تستخدم `supabase.from('companies').select('*')` مباشرة
- **السبب:** كتابة مباشرة بدون استخدام الـ governed layer
- **الإصلاح المقترح:** استخدام `get_governed_companies` RPC أو `get_company_profile`
- **الملفات المتأثرة:** `src/pages/companies/CompanyManagerPage.tsx`
- **الأولوية:** عالية
- **الحالة:** مفتوحة

### [FIX-015] — كود موظف Hardcoded WRQ1001 في DashboardPage.tsx
- **الوصف:** `DashboardPage.tsx:39` تعيد توجيه `WRQ1001` مباشرة إلى `WarehouseDashboard` بدلاً من استخدام routing ديناميكي
- **السبب:** استثناء سريع لمستخدم معين
- **الإصلاح المقترح:** استخدام role-based routing مثل باقي الأدوار
- **الملفات المتأثرة:** `src/pages/dashboard/DashboardPage.tsx`
- **الأولوية:** متوسطة
- **الحالة:** مفتوحة

---

## الإصلاحات المنجزة

### [FIX-017] — governed_cancel_order يكتب employee_id في order_status_history.changed_by (FK 23503)
- **الوصف:** `order_status_history.changed_by` يحمل FK إلى `identities(id)`، لكن
  `governed_cancel_order` كان يكتب `v_session.employee_id` (معرّف الموظف ليس معرّف هوية)
  → فشل إلغاء أي طلب بواسطة جلسة موظف بـ FK 23503 (تم اعتماده كخلل تنفيذي Verified Defect — Severity: High).
- **الإصلاح:** سطر واحد فقط — `v_employee_id := v_session.identity_id;` دون أي تغيير في
  منطق الحجز (RESERVATION_RELEASE) أو الاسترجاع أو تحديث الحالة أو الأرصدة الائتمانية.
- **الملف المتأثر:** `supabase/migrations/20270810_fix_cancel_changed_by_identity.sql`
  (المهاجرة تشير إلى FIX-017).
- **التحقق:** إلغاء طلب `submitted` محجوز (ALLOCATE→RELEASE، لا خصم، مخزون ثابت، سطر status_history
  بغير null) + إلغاء طلب `approved` محسوم (DEDUCT→ORDER_CANCELLATION_RESTORE، عودة المخزون) — PASS.
- **الأولوية:** عالية
- **الحالة:** منجزة (بانتظار المراجعة — لا commit/deploy)

### [FIX-016] — حجز وتخصيص المخزون (Inventory Reservation & Allocation) — Migrations A–D
- **الوصف:** تنفيذ ميزة الحجز المشتق وتخصيص FCFS وفق التصميم المعتمد
  `docs/01-ARCHITECTURE/SCHEMA_RPC_CONTRACTS_DESIGN_RESERVATION_ALLOCATION.md`
  (القسم 15 — تسلسل التنفيذ A–D، القرارات 16.1: حجز مشتق بلا جدول؛ submitted=يبدأ الحجز؛
  approved=الخصم ينهي الحجز؛ العروض مؤجَّلة).
- **Migration A** (`20270810_inventory_reservation_migration_a.sql`):
  +3 أعمدة تدقيق على `inventory_movements` (reason, previous_quantity, new_quantity — BR-AUD-01)؛
  دالة `_to_pieces` الموحدة (BR-SU-01/02)؛ تحديث `governed_inventory_deduct` (تحويل موحد عبر
  `_to_pieces` بأحدث `carton_quantity` + تسجيل قبل/بعد)؛ تحديث `governed_inventory_restore`
  (معاملان اختياريان `p_movement_type`/`p_reason` + تسجيل قبل/بعد).
- **Migration B** (`20270810_inventory_reservation_migration_b.sql`):
  `_reserved_quantity_for_order` (حجز مشتق: مجموع `_to_pieces` على `order_items` فقط في
  `submitted` وغير المحسوم، وإلا 0 — BR-RS-01..05)؛ `_reservation_capacity` (سعة محدودة =
  رصيد المخزون − حجوزات الطلبات المؤهلة الأخرى، أو NULL غير محدودة عند تفعيل البيع بالسالب
  عالمياً — BR-AL-01)؛ REVOKE من الأعمدة العامة (دوال داخلية غير معروضة).
- **Migration C** (`20270810_inventory_reservation_migration_c.sql`):
  توسيع `governed_check_product_availability` (معاملان اختياريان `p_unit_type`/`p_token` +
  `max_allowed_units` + قراءة السياسة العالمية بدل العمود المهجور `products.negative_selling_allowed`
  + مراعاة الحجوزات — BR-VIS-01)؛ توسيع `governed_get_order_inventory_snapshot`
  (reserved_quantity / allocated_quantity / capacity لكل منتج — BR-VIS-02) مع حفظ الحقول الحالية.
- **Migration D** (`20270810_inventory_reservation_migration_d.sql`):
  ربط القواعد على المسارات الفعلية المعتمدة: `governed_submit_order`
  (فحص سعة + RESERVATION_REJECT/ALLOCATE)؛ `governed_approve_order` / `governed_cancel_order`
  / `governed_return_order_for_revision` (RESERVATION_RELEASE عند الخروج من submitted +
  استرجاع بنوع ORDER_REVISION_RESTORE)؛ `governed_change_order_status`
  (RELEASE/فحص سعة/ALLOCATE حول submitted)؛ `governed_supreme_edit_order`
  (مزامنة الخصم ORDER_EDIT_RESTORE ← استبدال ← إعادة خصم + RESERVATION_UPDATE/REJECT — BR-RS-08).
- **ملاحظة معتمدة:** `governed_create_order` و `governed_replace_order_contents` لا يعملان
  أبداً على طلب في `submitted` (إنشاء دائم في draft؛ الاستبدال محصور في
  draft/returned_for_revision/stock_review) → الحجز صفر فيهما → لا حاجة لربط (قرار تعيين 2026-08-01).
- **الملفات المتأثرة:** 4 مهاجرات SQL جديدة (A–D) + الوثائق
  `00-INDEX/DOCUMENTATION_INDEX.md` و `00-INDEX/ANCHORED_SUMMARY.md`
  (حالة التصميم: معتمد).
- **الأولوية:** عالية
- **الحالة:** منجزة (بانتظار المراجعة — لا commit/deploy)

---

*تاريخ الإنشاء: 2026-06-16*
*المرجع: PROJECT_TRUTH_AUDIT.md*
