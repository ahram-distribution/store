# REGRESSION GUARD — سجل الإصلاحات المنجزة

> **التاريخ:** 2026-06-16  
> **الهدف:** منع رجوع الأعطال التي تم إصلاحها سابقاً  
> **المرجع:** FIX_HISTORY.md (لمشاكل مفتوحة)، PROJECT_TRUTH_AUDIT.md  
> **مبدأ أساسي:** إذا عاد عطل تم إصلاحه، نرجع إلى هذا الملف أولاً قبل إعادة الإصلاح

---

## فهرس التصنيفات

| التصنيف | RG IDs | عدد الإصلاحات |
|---------|--------|---------------|
| صلاحيات الإدارة العليا | RG-001 — RG-004 | 4 |
| governed_* RPC Access & Governance | RG-005 — RG-012 | 8 |
| Company Update | RG-013 — RG-014 | 2 |
| Product Update | RG-015 — RG-017 | 3 |
| Daily Deals, Flash Offers, Auctions | RG-018 — RG-020 | 3 |
| Launcher & Dashboard Routing | RG-021 — RG-024 | 4 |
| WhatsApp Order Sending | RG-025 | 1 |
| GitHub Pages / Vite Routing | RG-026 | 1 |
| Role Normalization | RG-027 — RG-030 | 4 |
| Attendance & GPS | RG-031 — RG-039 | 9 |
| Sales Manager Dashboard | RG-040 — RG-042 | 3 |
| Governance Compliance | RG-043 — RG-045 | 3 |
| Customer & Orders | RG-046 — RG-053 | 8 |
| Employee | RG-054 — RG-055 | 2 |
| Tier System & Credit | RG-056 — RG-058 | 3 |
| Database Recovery | RG-059 | 1 |
| UI & Mobile | RG-060 — RG-062 | 3 |
| Warehouse Runtime | RG-063 — RG-065 | 3 |
| **الإجمالي** | **RG-001 — RG-065** | **65 إصلاحاً** |

---

## 1. صلاحيات الإدارة العليا (Upper Management Permissions)

---

### RG-001 — توحيد أدوار الإدارة العليا

- **المشكلة:** 4+ أدوار عليا منفصلة (`SUPER_ADMIN`, `سوبر أدمن`, `رئيس مجلس الإدارة`, `أدمن`, `مدير تنفيذي`) — صيانة مستحيلة، تضارب في الرؤية
- **السبب الجذري:** تطور تاريخي بدون توحيد
- **الإصلاح:** إنشاء دور `الإدارة العليا` الموحد عبر `20260720_unify_upper_management_role.sql` + تحديث `DashboardPage.tsx` لاستخدامه
- **الملفات المتأثرة:**
  - Backend: `20260720_unify_upper_management_role.sql`
  - Frontend: `DashboardPage.tsx` — `WORKSPACE_HIERARCHY` مع `الإدارة العليا`
- **التحقق:** مستخدمو الإدارة العليا يرون `UpperManagementDashboard` بدلاً من fallback
- **الحالة:** VERIFIED

---

### RG-002 — استبدال Hardcoded Role Names في RPCs

- **المشكلة:** 32+ ملف مهاجرة تفحص `r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')` و `r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')`
- **السبب الجذري:** كتابة سريعة بدون تجريد
- **الإصلاح:** استبدال بـ `public.is_upper_management()` في ملفين: `_20260721_fix_removed_hardcoded_checks.sql` (طبق على `get_governed_employees`, `get_governed_collections`)
- **الملفات المتأثرة:**
  - Backend: `_20260721_fix_removed_hardcoded_checks.sql`
- **التحقق:** `get_governed_employees` و `get_governed_collections` تعمل بدون أخطاء
- **ملاحظة:** الإصلاح لم يكتمل — باقي 30+ ملف مهاجرة لا تزال تستخدم hardcoded names
- **الحالة:** PARTIALLY_VERIFIED

---

### RG-003 — إنشاء is_upper_management() + RLS للأدوار العليا

- **المشكلة:** لا توجد دالة موحدة للتحقق من الإدارة العليا. RLS غير مفعل على 14 جدولاً رئيسياً.
- **السبب الجذري:** غياب طبقة أمان للقراءة المباشرة
- **الإصلاح:** `20260706_role_normalization.sql` — أنشأ `is_upper_management()`، فعّل RLS على 14 جدولاً مع `upper_management_all_*` policies
- **الملفات المتأثرة:**
  - Backend: `20260706_role_normalization.sql` (14 RLS policies، `is_upper_management` function)
  - Frontend: غير مباشر
- **التحقق:** `check_capability` يتجاوز فحص الصلاحية لأدوار الإدارة العليا
- **الحالة:** VERIFIED

---

### RG-004 — SUPER_ADMIN Routing Fix

- **المشكلة:** `SUPER_ADMIN` لا يتم توجيهه بشكل صحيح في DashboardPage لأن `"super admin".includes("super_admin")` يعطي `false`
- **السبب الجذري:** مسافة و underscore mismatch
- **الإصلاح:** إضافة `normalizeRole()` في `DashboardPage.tsx` التي تزيل كل non-alphanumeric chars
- **الملفات المتأثرة:**
  - Frontend: `src/utils/roleNormalization.ts`, `src/pages/dashboard/DashboardPage.tsx`
- **التحقق:** SUPER_ADMIN يشاهد UpperManagementDashboard
- **الحالة:** VERIFIED

---

## 2. governed_* RPC Access & Governance Layer

---

### RG-005 — تسريب Governance (Subtree Scoping)

- **المشكلة:** `get_governed_orders` و `get_governed_employees` لم تطبق subtree scoping — المستخدم العادي يرى طلبات/موظفين خارج نطاقه
- **السبب الجذري:** عدم وجود `WHERE o.created_by = ANY(v_identity_ids)` و `WHERE e.id = ANY(v_subtree_ids)`
- **الإصلاح:** `20260618_fix_governance_leak.sql` — إضافة فلاتر الرؤية
- **الملفات المتأثرة:**
  - Backend: `20260618_fix_governance_leak.sql`
  - RPCs: `get_governed_orders`, `get_governed_employees`, `get_governed_visits`, `get_governed_collections`, `get_customer_analytics_list`, `get_supervisor_dashboard`
- **التحقق:** المستخدم العادي يرى فقط بيانات نطاقه
- **الحالة:** VERIFIED

---

### RG-006 — Inline CTE + SETOF uuid Fix

- **المشكلة:** PostgreSQL لا يقبل `IN (SELECT * FROM setof_returning_function())`
- **السبب الجذري:** SETOF uuid لا يعمل داخل IN clause
- **الإصلاح:** استبدال بـ inline CTE + `array_agg()` + `ANY()` pattern
- **الملفات المتأثرة:**
  - Backend: جميع دوال `get_governed_*` list/single
- **التحقق:** جميع دوال `get_governed_*` تعمل بدون `SETOF uuid` error
- **الحالة:** VERIFIED

---

### RG-007 — Customer & Order Single-Record Governance

- **المشكلة:** `get_governed_customer` و `get_governed_order` لم تطبق `owner_id = ANY(v_visible)` — المستخدم يرى عميل/طلب حتى لو لم يكن مالكاً
- **السبب الجذري:** غياب فحص الملكية في single-record RPCs
- **الإصلاح:** إضافة `WHERE owner_id = ANY(v_visible)` ورفع `FORBIDDEN` إن لم يصرح
- **الملفات المتأثرة:**
  - Backend: `get_governed_customer`, `get_governed_order`
- **التحقق:** محاولة قراءة عميل غير مملوك تعيد `FORBIDDEN`
- **الحالة:** VERIFIED

---

### RG-008 — Dashboard Frontend Direct Reads → Governed RPC

- **المشكلة:** 6 صفحات تستخدم `supabase.from().select()` مباشرة — تتجاوز طبقة الحوكمة بالكامل
- **السبب الجذري:** كتابة أولية بدون RPCs
- **الإصلاح:** استبدال جميع الاستدعاءات المباشرة بـ `supabase.rpc()` في 6 صفحات
- **الملفات المتأثرة:**
  - Frontend: `OrdersPage.tsx`, `VisitsPage.tsx`, `CollectionsPage.tsx`, `ReturnsPage.tsx`, `OrderDetailPage.tsx`, `AccountPage.tsx`
- **التحقق:** لا توجد استدعاءات `supabase.from()` متبقية في هذه الصفحات
- **ملاحظة:** تم إصلاح 6 صفحات — لكن ظهرت استدعاءات جديدة لاحقاً (AccountPage عاد يستخدم `from()` في customer_addresses)
- **الحالة:** PARTIALLY_VERIFIED — بعض الصفحات عادت لاستخدام `from()`

---

### RG-009 — Order Visibility Fix (Customer Owner)

- **المشكلة:** `get_governed_orders` لم يكن يصفي حسب `customer.owner_id` — مندوب المبيعات يرى طلبات مناديب آخرين
- **السبب الجذري:** عدم ربط الطلبات بمالك العميل
- **الإصلاح:** `20260607_order_visibility_fix.sql` — إضافة `INNER JOIN customers c ON o.customer_id = c.id WHERE c.owner_id = ANY(v_visible)`
- **الملفات المتأثرة:**
  - Backend: `20260607_order_visibility_fix.sql`
  - RPCs: `get_governed_orders`
- **التحقق:** مندوب يرى فقط طلبات عملائه
- **الحالة:** VERIFIED

---

### RG-010 — Customer Visibility Fix

- **المشكلة:** `get_governed_customers` لا يصفي حسب المشرف — الجميع يرى جميع العملاء. عملاء `REG-*` بلا مالك.
- **السبب الجذري:** غياب hierarchical filter + عملاء التسجيل الذاتي ليس لديهم `owner_id`
- **الإصلاح:** `20260606_customer_visibility_fix.sql` — تعيين SYS-OWNER للأهرام لـ REG-* customers + إضافة hierarchical filter
- **الملفات المتأثرة:**
  - Backend: `20260606_customer_visibility_fix.sql`
  - RPCs: `get_governed_customers`, `get_employee_activity`, `get_sales_by_rep`, `get_sales_by_manager`
- **التحقق:** مندوب يرى فقط عملاءه
- **الحالة:** VERIFIED

---

### RG-011 — Warehouse & Transport Dashboard Governance

- **المشكلة:** Warehouse و Transport Dashboards تظهر لـ SALES_REP أرقاماً مضخّمة (4/6/31 بدلاً من 0/1/4)
- **السبب الجذري:** غياب `AND owner_id = ANY(v_visible)` في عدادات dashboard
- **الإصلاح:** إضافة فلاتر الرؤية إلى جميع العدادات في 15 RPC + استبدال `full_name = '...'` بـ `code = 'WRQ1002'/'WRQ1004'`
- **الملفات المتأثرة:**
  - Backend: 15 دالة — `get_dashboard_*`, `get_governed_*`
- **التحقق:** SALES_REP يرى 0/1/4 (قبل: 4/6/31). CHAIRMAN يرى 41/25 (قبل: 1/1)
- **الحالة:** VERIFIED

---

### RG-012 — SalesRep Governance identity_id Fix

- **المشكلة:** `get_governed_customers` لا يضبط `app.identity_id` — دوال `app.current_employee_id()`, `app.has_capability()` تفشل
- **السبب الجذري:** `app.identity_id` لم يُضبط قبل استدعاء دوال الحوكمة
- **الإصلاح:** `20260627_fix_storefront_companies_and_salesrep_governance.sql` — إضافة `SET app.identity_id = ...` قبل استدعاءات الحوكمة
- **الملفات المتأثرة:**
  - Backend: `20260627_fix_storefront_companies_and_salesrep_governance.sql`
  - RPCs: `get_governed_customers`, `get_employee_activity`, `get_sales_by_rep`, `get_sales_by_manager`
- **التحقق:** RPCs تعمل للمستخدمين العاديين (ليس فقط UM)
- **الحالة:** VERIFIED

---

## 3. Company Update

---

### RG-013 — Schema Alignment: Companies

- **المشكلة:** `companies.is_visible` و `companies.logo_url` مفقودان من تعريف الجدول رغم استخدامهما في الكود
- **السبب الجذري:** الكود أضيف أولاً، تعريف الجدول لم يتزامن
- **الإصلاح:** `20260608_schema_alignment.sql` — إضافة الأعمدة المفقودة
- **الملفات المتأثرة:**
  - Database: `companies` — أضيف `is_visible` (boolean), `logo_url` (text)
- **التحقق:** CompanyManagerPage يعرض logo_url و is_visible بدون أخطاء
- **الحالة:** VERIFIED

---

### RG-014 — CompanyManagerPage Direct Access

- **المشكلة:** `CompanyManagerPage.tsx:72` يستخدم `supabase.from('companies').select('*')` مباشرة
- **السبب الجذري:** لم يتم تحويله إلى governed RPC عند كتابته
- **الإصلاح:** لم يُصلح بعد — يجب استخدام `get_governed_companies` أو `get_company_profile`
- **الملفات المتأثرة:**
  - Frontend: `src/pages/companies/CompanyManagerPage.tsx`
- **التحقق:** لم يتم التحقق منه — قائم كـ FIX-014 في FIX_HISTORY
- **الحالة:** UNKNOWN (غير معمول به)

---

## 4. Product Update

---

### RG-015 — Schema Alignment: Products

- **المشكلة:** `products.is_visible` مفقود من تعريف الجدول
- **السبب الجذري:** نفس RG-013
- **الإصلاح:** `20260608_schema_alignment.sql` — إضافة `is_visible` (boolean, NOT NULL DEFAULT true)
- **الملفات المتأثرة:**
  - Database: `products` — أضيف `is_visible`
- **الحالة:** VERIFIED

---

### RG-016 — Product Availability Enforcement - mapProduct()

- **المشكلة:** `mapProduct()` في StorefrontPage يستعلم جداول غير موجودة (`product_prices`) وأعمدة غير موجودة (`is_base_unit`, `unit_code`, `is_sellable`, `units_per_parent`) — كل الأسعار = 0، كل المنتجات تظهر "نفذت الكمية"
- **السبب الجذري:** افتراض وجود جداول/أعمدة غير موجودة في DB الفعلية
- **الإصلاح:** استخراج أسعار الوحدات من `carton_price` و `carton_quantity` فقط
- **الملفات المتأثرة:**
  - Frontend: `StorefrontPage.tsx`, `ProductCard.tsx`, `cart.ts`, `CartPage.tsx`, `CheckoutPage.tsx`
- **التحقق:** الأسعار تظهر بشكل صحيح، المنتجات لا تظهر "نفذت الكمية" خطأ
- **الحالة:** VERIFIED

---

### RG-017 — Product Update RPC

- **المشكلة:** تحديث المنتج عبر `governed_update_product` يعمل — لا مشكلة موثقة
- **ملاحظة:** لا يوجد fix محدد للمنتجات بجانب RG-015 و RG-016
- **الحالة:** — (لا إصلاح محدد)

---

## 5. Daily Deals, Flash Offers, Auctions

---

### RG-018 — Auction Module V2: 400 Bad Request + v_session.id

- **المشكلة 1:** `get_governed_auctions` يعيد 400 Bad Request عند استدعائه بـ `p_token: null` لأن REST API لا يقبل null كـ UUID param
- **المشكلة 2:** `v_session.id` لا وجود له — `app.sessions` ليس لديه عمود `id`، الصحيح هو `v_session.token`
- **السبب الجذري:** عدم توافق param types + خطأ في اسم عمود session
- **الإصلاح:** استدعاء شرطي (إذا token == null لا تمرر p_token) + `v_session.id` → `v_session.token`
- **الملفات المتأثرة:**
  - Backend: `20260603_auction_v2.sql` — `get_governed_auctions`, `get_governed_auction_detail`
- **التحقق:** `tsc --noEmit` 0 errors, `vite build` 1949 modules
- **الحالة:** VERIFIED

---

### RG-019 — Auction Governance RPC Created

- **المشكلة:** `governed_create_auction` لم يكن موجوداً — إنشاء مزاد لم يكن خاضعاً للحوكمة
- **السبب الجذري:** نسيان إنشاء RPC للحوكمة عند إضافة Auctions V2
- **الإصلاح:** `20260707_governance_compliance_fix.sql` — إنشاء `governed_create_auction` مع SECURITY DEFINER + session validation + capability check
- **الملفات المتأثرة:**
  - Backend: `20260707_governance_compliance_fix.sql`
- **الحالة:** VERIFIED

---

### RG-020 — Daily Deals Service (deals.ts) Governance

- **المشكلة:** `deals.ts` كان يستخدم `supabase.from('packages').select('*')` مباشرة — يتجاوز الحوكمة
- **السبب الجذري:** كتابة أولية قبل إنشاء governed RPCs
- **الإصلاح:** استبدال بـ `supabase.rpc('get_governed_daily_deals')` و `supabase.rpc('get_governed_active_daily_deals')`
- **الملفات المتأثرة:**
  - Frontend: `src/services/deals.ts` (تم التحقق منه — يستخدم RPC حالياً)
- **التحقق:** الكود الحالي لا يحتوي على `supabase.from('packages')`
- **الحالة:** VERIFIED

---

## 6. Launcher & Dashboard Routing

---

### RG-021 — DashboardPage Routing (Role-Based)

- **المشكلة:** DashboardPage كان يوجّه الجميع إلى ManagementDashboard — الموظفون لا يرون dashboard مناسباً لدورهم
- **السبب الجذري:** عدم وجود role-based routing
- **الإصلاح:** إضافة `WORKSPACE_HIERARCHY` + `DEPRECATED_ROUTES` + `normalizeEmployeeRole()`
- **الملفات المتأثرة:**
  - Frontend: `src/pages/dashboard/DashboardPage.tsx`
- **التحقق:** الإدارة العليا → UpperManagementDashboard, مدير بيع → SalesManagerCCPage, مندوب → SalesRepWorkDay
- **الحالة:** VERIFIED

---

### RG-022 — DashboardPage WRQ1001 Hardcoded

- **المشكلة:** كود الموظف `WRQ1001` مبرمج hardcoded في `DashboardPage.tsx:39` لتوجيهه إلى WarehouseDashboard
- **السبب الجذري:** استثناء سريع لمستخدم معين
- **الإصلاح:** استخدام `user.code` في SessionUser + إضافته إلى auth store
- **الملفات المتأثرة:**
  - Frontend: `src/store/auth.ts` (أضيف `code` إلى `SessionUser`), `src/services/auth.ts` (أضيف `code` إلى `SessionResult`), `DashboardPage.tsx`
- **التحقق:** WRQ1001 يوجه إلى WarehouseDashboard
- **ملاحظة:** لا يزال hardcoded — لم يُستبدل بـ role-based
- **الحالة:** PARTIALLY_VERIFIED

---

### RG-023 — DashboardPage Navigation (P3 Runtime)

- **المشكلة:** WarehouseDashboard باسمه الكامل يستورد كـ named import — `{ WarehouseDashboard }` بدلاً من default import
- **السبب الجذري:** تصدير مختلف عما تتوقعه DashboardPage
- **الإصلاح:** `import WarehouseDashboard from './WarehouseDashboard'` بدلاً من `{ WarehouseDashboard }`
- **الملفات المتأثرة:**
  - Frontend: `src/pages/dashboard/DashboardPage.tsx`
- **الحالة:** VERIFIED

---

### RG-024 — Module Hierarchy Routing

- **المشكلة:** ModuleLauncherPage و SubLauncherPage و CommandCenterPage — 3 طرق مختلفة لنفس البوابة — تداخل وارتباك
- **السبب الجذري:** تطور بدون توحيد
- **الإصلاح:** (لم يتم إصلاحه — لا يزال موجوداً)
- **الحالة:** — (ليس إصلاحاً، مجرد توثيق)

---

## 7. WhatsApp Order Sending

---

### RG-025 — WhatsApp Integration Fix

- **المشكلة:** إرسال الطلب عبر WhatsApp كان يفشل بسبب خطأ في `whatsapp.ts` — رسائل غير مكتملة أو أخطاء في فتح التطبيق
- **السبب الجذري:** `console.log` تظهر بيانات حساسة + خطأ في `openWhatsApp()` عند فشل الـ API
- **الإصلاح:** إصلاح دالة `sendOrderViaWhatsApp()` في `OrderNewPage.tsx` و `OrderReviewPage.tsx` + `whatsapp.ts`
- **الملفات المتأثرة:**
  - Frontend: `src/lib/whatsapp.ts`, `OrderNewPage.tsx`, `OrderReviewPage.tsx`
- **التحقق:** زر "مشاركة عبر واتساب" يعمل بدون console errors
- **الحالة:** VERIFIED

---

## 8. GitHub Pages / Vite Routing

---

### RG-026 — index.html Restoration

- **المشكلة:** `index.html` حُذف بالخطأ أثناء التنظيف (ظُن أنه ملف اختبار)
- **السبب الجذري:** سوء تصنيف الملف أثناء cleanup
- **الإصلاح:** استعادة `index.html` من النسخة الاحتياطية فوراً
- **الملفات المتأثرة:**
  - Frontend: `index.html` (جذر المشروع)
- **التحقق:** `npm run build` يعمل — index.html هو Vite entry point
- **الحالة:** VERIFIED

---

## 9. Role Normalization

---

### RG-027 — is_upper_management() Function

- **المشكلة:** لا توجد دالة موحدة للتحقق من الإدارة العليا — 45+ hardcoded check منتشرة
- **السبب الجذري:** عدم وجود تجريد لدور الإدارة العليا
- **الإصلاح:** إنشاء `public.is_upper_management(p_employee_id uuid)` — التحقق بالكود وباسم الدور
- **الملفات المتأثرة:**
  - Backend: `20260706_role_normalization.sql`
- **التحقق:** `is_upper_management('WRQ1006'::uuid)` → true, `is_upper_management('REP001'::uuid)` → false
- **الحالة:** VERIFIED

---

### RG-028 — normalizeEmployeeRole() Utility

- **المشكلة:** أدوار متعددة (`SUPER_ADMIN`, `سوبر أدمن`, `مدير تنفيذي`, `administrator`, إلخ) كلها تعني "الإدارة العليا" لكن الكود لا يوحدها
- **السبب الجذري:** 3 أنماط مختلفة لتسمية الأدوار (English trilogy, Arabic trilogy, Extended)
- **الإصلاح:** إنشاء `src/utils/roleNormalization.ts` مع `normalizeEmployeeRole()` — تعيين 22+ variant إلى 6 أدور قانونية
- **الملفات المتأثرة:**
  - Frontend: `src/utils/roleNormalization.ts`
- **التحقق:** `normalizeEmployeeRole('SUPER_ADMIN')` → `'الإدارة العليا'`، `normalizeEmployeeRole('مندوب')` → `'مندوب مبيعات'`
- **الحالة:** VERIFIED

---

### RG-029 — Phase 5 Role Management: p_token text → uuid

- **المشكلة:** 5 RPCs (`governed_create_role`, `governed_update_role`, `governed_delete_role`, `governed_update_role_capabilities`, `get_role_capabilities`) تعلن `p_token` كـ `text` لكن `check_capability` يتوقع `uuid`
- **السبب الجذري:** عدم تطابق type بين تعريف RPC والتابع المُستدعَى
- **الإصلاح:** `20260611_phase5_role_management_fix.sql` — تغيير `p_token` من `text` إلى `uuid`
- **الملفات المتأثرة:**
  - Backend: `20260611_phase5_role_management_fix.sql`
  - RPCs: 5 دوال
- **التحقق:** إدارة الأدوار تعمل بدون type mismatch error
- **الحالة:** VERIFIED

---

### RG-030 — useCapability Hook Fast Path for SUPER_ADMIN

- **المشكلة:** `useCapability` يرجع `false` لـ SUPER_ADMIN عند فشل أي RPC — يخفي الأزرار/الإجراءات
- **السبب الجذري:** الـ hook يسقط إلى `false` على أي خطأ RPC
- **الإصلاح:** إضافة `superadmin` role prefix check كـ fast path في `useCapability` hook
- **الملفات المتأثرة:**
  - Frontend: `src/hooks/useCapability.ts`
- **التحقق:** SUPER_ADMIN يرى جميع الأزرار (أوامر الطلبات، إلخ)
- **الحالة:** VERIFIED

---

## 10. Attendance & GPS

---

### RG-031 — Attendance RPC Scoping (Subtree)

- **المشكلة:** `get_live_workday_overview` و `get_alerts` لا يصفيان حسب التسلسل الهرمي — مدير البيع يرى كل الموظفين
- **السبب الجذري:** غياب subtree scoping
- **الإصلاح:** `20260719_fix_attendance_rpc_scoping.sql` — إضافة فحص `attendance.view_all` أو subtree
- **الملفات المتأثرة:**
  - Backend: `20260719_fix_attendance_rpc_scoping.sql`
  - RPCs: `get_live_workday_overview`, `get_alerts`
- **الحالة:** VERIFIED

---

### RG-032 — Attendance RPC Visibility (CASCADE)

- **المشكلة:** `get_employee_day_map`, `get_live_workday_overview`, `get_alerts` — `get_visible_employee_ids` يرجع `uuid[]` لكن الكود استخدم `FROM-subquery` pattern مع SETOF — PostgREST يعيد 404
- **السبب الجذري:** استخدام pattern خاطئ مع `uuid[]` return type
- **الإصلاح:** `20260722_fix_attendance_rpcs_visibility.sql` — استبدال بـ `= ANY()` pattern
- **الملفات المتأثرة:**
  - Backend: `20260722_fix_attendance_rpcs_visibility.sql`
  - RPCs: `get_employee_day_map`, `get_live_workday_overview`, `get_alerts`
- **الحالة:** VERIFIED

---

### RG-033 — Attendance Employee Columns (e.name → e.full_name)

- **المشكلة:** 6 دوال حضور تستخدم `e.name` و `e.active` — الأعمدة الصحيحة هي `e.full_name` و `e.is_active` — جميع الدوال تعيد أخطاء
- **السبب الجذري:** تعريف الجدول يستخدم `full_name` و `is_active` لكن الكود استخدم `name` و `active`
- **الإصلاح:** `20260611_fix_attendance_employee_columns.sql` — تصحيح 6 دوال
- **الملفات المتأثرة:**
  - Backend: `20260611_fix_attendance_employee_columns.sql`
  - RPCs: `get_attendance_analysis`, `get_employee_current_location`, `get_live_workday_overview`, `get_team_map`, `get_workday_report`, `get_alerts`
- **التحقق:** جميع دوال الحضور تعيد HTTP 201 بدون أخطاء
- **الحالة:** VERIFIED

---

### RG-034 — Attendance Phase 6 Hotfix (4 RPCs)

- **المشكلة:** 4 دوال حضور لا تعمل يومياً:
  - `get_workday_settings`: `COALESCE(record, jsonb)` type mismatch
  - `get_live_workday_overview`: `visit_links.employee_id` غير موجود
  - `get_team_map`: `filtered_employees` CTE مفقود
  - `get_my_workday_status`: `visit_count` من `visit_links` (جدول فارغ)
- **السبب الجذري:** دوال الحضور كانت تشير إلى جداول/أعمدة غير موجودة
- **الإصلاح:** `20260611_phase6_hotfix_runtime.sql` — تصحيح 4 دوال
- **الملفات المتأثرة:**
  - Backend: `20260611_phase6_hotfix_runtime.sql`
  - RPCs: `get_workday_settings`, `get_live_workday_overview`, `get_team_map`, `get_my_workday_status`
- **التحقق:** HTTP 201 لكل RPC + `npm run build` (2045 modules, 15.74s)
- **الحالة:** VERIFIED

---

### RG-035 — GPS Distance Drift

- **المشكلة:** نقاط GPS غير دقيقة (drift) تؤدي إلى مسافات وهمية في تقارير مسار الموظف — تظهر مسافات كبيرة جداً
- **السبب الجذري:** دقة GPS منخفضة + عدم وجود فلترة للـ outliers
- **الإصلاح:** `20260701_fix_gps_distance_drift.sql` — 3 طبقات للحماية: Accuracy filter, Min distance, Speed outlier
- **الملفات المتأثرة:**
  - Backend: `20260701_fix_gps_distance_drift.sql`
  - RPCs: `get_employee_day_map`
- **التحقق:** نقاط GPS ذات الدقة المنخفضة (> threshold) تُتجاهل، المقاطع القصيرة لا تُحتسب، السرعات غير المنطقية تُفلتر
- **الحالة:** VERIFIED

---

### RG-036 — Sync Tracking Points RPC (Double-Encoded JSON)

- **المشكلة:** `sync_tracking_points` يفشل عند استقبال JSON مزدوج الترميز (double-encoded) من جهاز المحمول
- **السبب الجذري:** Capacitor/قاعدة البيانات ترسل أحياناً نص JSON (string) بدلاً من array مباشرة
- **الإصلاح:** `20260702_fix_sync_tracking_points_rpc.sql` — التحقق من `jsonb` vs `text` ومعالجة double-encoded JSON
- **الملفات المتأثرة:**
  - Backend: `20260702_fix_sync_tracking_points_rpc.sql`
  - RPCs: `sync_tracking_points`
- **الحالة:** VERIFIED

---

### RG-037 — Customer Create/Update Address Storage

- **المشكلة 1:** `governed_create_customer` يتحقق من `p_address_line1` (لم يُرسَل من frontend) بدلاً من `p_formatted_address` — العناوين النصية بدون GPS لا تُحفظ
- **المشكلة 2:** `latitude`/`longitude` NOT NULL — لا يمكن إضافة عنوان بدون GPS
- **المشكلة 3:** `governed_update_customer` لا يقبل معاملات address/location/contacts
- **السبب الجذري:** افتراض أن all addresses must have GPS
- **الإصلاح:** `20260621_fix_customer_create_update.sql` — إصلاح ELSIF + جعل lat/lng nullable + إضافة params للـ update
- **الملفات المتأثرة:**
  - Database: `unified_locations` — ALTER COLUMN DROP NOT NULL
  - Backend: `20260621_fix_customer_create_update.sql`
  - RPCs: `governed_create_customer`, `governed_update_customer`
- **الحالة:** VERIFIED

---

### RG-038 — Employee Day Map Route Fix

- **المشكلة:** `get_employee_day_map` يعيد بيانات مسار غير مكتملة/خاطئة
- **السبب الجذري:** scoping + route calculation logic قديمان
- **الإصلاح:** `20260717_fix_employee_day_map_route.sql` — تحديث الـ RPC بالكامل
- **الملفات المتأثرة:**
  - Backend: `20260717_fix_employee_day_map_route.sql`
  - RPCs: `get_employee_day_map`
- **الحالة:** VERIFIED

---

### RG-039 — Live Workday Overview Column Names

- **المشكلة:** `get_live_workday_overview` يستخدم `e.name` → يجب `e.full_name`، `e.active` → يجب `e.is_active`
- **السبب الجذري:** مهاجرة `20260630_work_policies_phase1.sql` استخدمت أسماء أعمدة خاطئة
- **الإصلاح:** `20260718_fix_live_workday_overview_scoping.sql` — تصحيح أسماء الأعمدة
- **الملفات المتأثرة:**
  - Backend: `20260718_fix_live_workday_overview_scoping.sql`
  - RPCs: `get_live_workday_overview`
- **الحالة:** VERIFIED

---

## 11. Sales Manager Dashboard

---

### RG-040 — Sales By Rep Nested Aggregate

- **المشكلة:** PostgreSQL لا يسمح بـ `SUM()` داخل `ORDER BY` لـ `jsonb_agg()` — `get_sales_by_rep` يفشل
- **السبب الجذري:** postgresql aggregate nesting limitation
- **الإصلاح:** `20260611_fix_get_sales_by_rep_nested_aggregate.sql` — وضع الـ aggregates في subquery ثم `jsonb_agg` مع field reference
- **الملفات المتأثرة:**
  - Backend: `20260611_fix_get_sales_by_rep_nested_aggregate.sql`
  - RPCs: `get_sales_by_rep`
- **الحالة:** VERIFIED

---

### RG-041 — Sales Manager Dashboard Scoping

- **المشكلة:** SalesManagerCCPage تستخدم `get_sales_manager_cc` الذي لا يصفي حسب التسلسل الهرمي
- **السبب الجذري:** نفس مشكلة RG-005 (تسريب Governance)
- **الإصلاح:** مشمول ضمن RG-005 (subtree scoping)
- **الحالة:** VERIFIED

---

### RG-042 — Dashboard Counts (get_governed_dashboard_counts)

- **المشكلة:** أرقام الـ dashboard counts غير صحيحة لغير الإدارة العليا
- **السبب الجذري:** عدم وجود فلاتر رؤية
- **الإصلاح:** إنشاء `get_governed_dashboard_counts` مع subtree scoping
- **الحالة:** VERIFIED

---

## 12. Governance Compliance

---

### RG-043 — Governance Compliance: Missing Fields

- **المشكلة:** بعض governed RPCs تفتقد حقول (`image_url`, `is_visible`, `logo_url`, `original_quantity`, `inventory`)
- **السبب الجذري:** عدم توافق RPCs مع تعريفات الجداول
- **الإصلاح:** `20260707_governance_compliance_fix.sql` — إضافة الحقول المفقودة
- **الملفات المتأثرة:**
  - Backend: `20260707_governance_compliance_fix.sql`
- **الحالة:** VERIFIED

---

### RG-044 — RLS Policies for Unified Locations

- **المشكلة:** `unified_locations` كان لديه `ENABLE ROW LEVEL SECURITY` لكن 0 policies — كل الوصول محظور
- **السبب الجذري:** تفعيل RLS بدون إنشاء policies
- **الإصلاح:** `20260706_role_normalization.sql` — إضافة `unified_locations_read_all` + `upper_management_all_unified_locations`
- **الملفات المتأثرة:**
  - Database: `unified_locations` — RLS policies
- **الحالة:** VERIFIED

---

### RG-045 — Schema Grants Fix

- **المشكلة:** `GRANT USAGE ON SCHEMA app TO authenticated` مفقود — "permission denied for schema app" + `GRANT USAGE ON SCHEMA public TO anon` مفقود — storefront لا يعمل
- **السبب الجذري:** نسيان صلاحيات الوصول إلى schemas
- **الإصلاح:** `20260706_role_normalization.sql` — إضافة GRANT USAGE لكل من app و public
- **الملفات المتأثرة:**
  - Database: Schema grants
- **التحقق:** storefront يعمل بدون أذونات، دوال app schema متاحة
- **الحالة:** VERIFIED

---

## 13. Customer & Orders

---

### RG-046 — Customer Reality Gap: register_customer p_email

- **المشكلة:** `register_customer` لا يقبل `p_email` — RegistrationPage يرسل email لكن الـ RPC يتجاهله
- **السبب الجذري:** الـ RPC أقدم من حقل email في الواجهة
- **الإصلاح:** `20260608_customer_reality_gap_closure.sql` — إضافة `p_email` parameter إلى `register_customer`
- **الملفات المتأثرة:**
  - Backend: `20260608_customer_reality_gap_closure.sql`
  - RPCs: `register_customer`
- **الحالة:** VERIFIED

---

### RG-047 — Customer Direct Ownership

- **المشكلة:** نقل ملكية العميل لا يعمل بشكل صحيح
- **السبب الجذري:** ownership RPCs غير مكتملة
- **الإصلاح:** `20260605_customer_direct_ownership.sql` — تحسين ownership change RPCs
- **الحالة:** VERIFIED

---

### RG-048 — Order Approval Pipeline

- **المشكلة:** `governed_approve_order` يقبل فقط `'submitted'` — لكن سير العمل الطبيعي: `submitted → reviewing → approved`
- **السبب الجذري:** عدم مراعاة حالة `reviewing` في التحقق من الصلاحية
- **الإصلاح:** `20260622_fix_order_approval_pipeline.sql` — إضافة `'reviewing'` كحالة pre-approval مقبولة
- **الملفات المتأثرة:**
  - Backend: `20260622_fix_order_approval_pipeline.sql`
  - RPCs: `governed_approve_order`
- **الحالة:** VERIFIED

---

### RG-049 — Order Status History CHECK Constraint

- **المشكلة:** CHECK constraint على `order_status_history` يسرد 8 حالات فقط لكن سير العمل يستخدم 13 حالة — خطأ 409 Conflict
- **السبب الجذري:** constraint لم يتزامن مع تطور workflow statuses
- **الإصلاح:** `20260610_fix_order_status_history_check.sql` — تحديث CHECK constraint ليشمل جميع 13 حالة
- **الملفات المتأثرة:**
  - Database: `order_status_history` — CHECK constraint
  - Backend: `20260610_fix_order_status_history_check.sql`
- **التحقق:** `governed_change_order_status` يعمل بدون 409
- **الحالة:** VERIFIED

---

### RG-050 — Order Status History FK Violation

- **المشكلة:** `order_status_history.changed_by` يشير إلى `identities(id)` لكن بعض RPCs تمرر `v_session.employee_id` (employee UUID)
- **السبب الجذري:** عدم تطابق المرجعية (identities vs employees)
- **الإصلاح:** استخدام `v_session.identity_id` بدلاً من `v_session.employee_id` في insert order_status_history
- **الملفات المتأثرة:**
  - Backend: مشمول ضمن RG-049
  - RPCs: `governed_dispatch_decision`, `governed_reject_order`, `governed_reopen_cancelled`
- **الحالة:** VERIFIED

---

### RG-051 — P2 Runtime Usability (Create Customer + Order Actions)

- **المشكلة:** `governed_create_customer` مفقود — `governed_defer_order`, `governed_cancel_order`, `governed_reopen_order` مفقودة — كلها مشار إليها من الواجهة لكنها لم تُنشأ في DB
- **السبب الجذري:** نسيان نشر RPCs بعد كتابة الكود الأمامي
- **الإصلاح:** `20260602_p2_runtime_usability_fixes.sql` — إنشاء الـ 4 RPCs
- **الملفات المتأثرة:**
  - Backend: `20260602_p2_runtime_usability_fixes.sql`
  - RPCs: `governed_create_customer`, `governed_defer_order`, `governed_cancel_order`, `governed_reopen_order`
- **الحالة:** VERIFIED

---

### RG-052 — Customer Analytics Phase 1 DB Layer (5 Issues)

- **المشاكل:**
  1. `customers` لا يحتوي على `type` column (قُسِمَ من output) ولا `balance` (يُحسب كـ `total_ordered - total_collected`)
  2. `$F$` dollar-quoting فشل بسبب `${S}` template literal في JS — استُبدل بـ string concatenation مع `$$`
  3. PostgREST schema cache — `NOTIFY pgrst, 'reload schema'` مطلوب بعد إنشاء الدوال
  4. Ambiguous column references — `v_session` record fields تتعارض مع أسماء أعمدة SQL — استُبدلت بـ scalar variables
  5. `SELECT DISTINCT ON (p.id)` يتطلب ORDER BY يبدأ بـ `p.id` — استُبدل بـ GROUP BY subquery
- **الإصلاح:** تصحيح 5 مشاكل تقنية في دوال analytics
- **الملفات المتأثرة:**
  - Backend: `get_visible_customer_ids`, `get_customer_card`, `get_customer_analytics_list`, `get_customer_products`, `get_customer_brands`, `get_customer_sales_ranking`
- **الحالة:** VERIFIED

---

### RG-053 — Global Search Extension

- **المشكلة:** GlobalSearch يبحث في 3 مجالات فقط — غير كافٍ للمستخدمين
- **السبب الجذري:** نطاق بحث ضيق
- **الإصلاح:** تمديد البحث لـ 6 مجالات مع استعلامات `ilike` على مستوى DB
- **الملفات المتأثرة:**
  - Frontend: `src/components/GlobalSearch.tsx`
- **الحالة:** VERIFIED

---

## 14. Employee

---

### RG-054 — Employee Reality Gap: governed_update_employee p_password

- **المشكلة:** `governed_update_employee` لا يقبل `p_password` — واجهة تعديل الموظف لا تستطيع تغيير كلمة المرور
- **السبب الجذري:** الـ RPC أقدم من حقل password في الواجهة
- **الإصلاح:** `20260609_employee_reality_gap_closure.sql` — إضافة `p_password` parameter
- **الملفات المتأثرة:**
  - Backend: `20260609_employee_reality_gap_closure.sql`
  - RPCs: `governed_update_employee`
- **الحالة:** VERIFIED

---

### RG-055 — Schema Alignment: employees.address

- **المشكلة:** `employees.address` مفقود من تعريف الجدول رغم استخدامه في تعديل الموظف
- **السبب الجذري:** نفس RG-013
- **الإصلاح:** `20260608_schema_alignment.sql` — إضافة `address` (text)
- **الملفات المتأثرة:**
  - Database: `employees` — أضيف `address`
- **الحالة:** VERIFIED

---

## 15. Tier System & Credit

---

### RG-056 — Tier Runtime: governed_create_order Discount

- **المشكلة:** `governed_create_order` لا يطبق الخصم الشريحي (tier discount) على أسعار الأصناف — الأسعار كاملة بدون خصم
- **السبب الجذري:** عدم تطبيق tier logic في إنشاء الطلب
- **الإصلاح:** `20260604_tier_runtime_remediation.sql` — تطبيق tier discount hierarchy: product exception > company exception > tier default
- **الملفات المتأثرة:**
  - Backend: `20260604_tier_runtime_remediation.sql`
  - RPCs: `governed_create_order`
  - Frontend: `CartPage.tsx` (hydration guard), `cart.ts` (clearCart لا يدمر selectedTierId)
- **الحالة:** VERIFIED

---

### RG-057 — Credit Module V2: Enum + Constraint Fixes

- **المشكلة 1:** `ledger_transaction_type` enum يحتوي فقط `debit`/`credit` — كل الأنواع المخصصة فشلت
- **المشكلة 2:** `ck_credit_ledger_reference` يتطلب كلاهما أو لا شيء من `reference_type`/`reference_id`
- **المشكلة 3:** `orders.created_by` NOT NULL — seed data يحتاج قيماً
- **السبب الجذري:** عدم توافق enum مع الأنواع المستخدمة
- **الإصلاح:** تغيير الأنواع المخصصة (activation, suspension, إلخ) إلى `credit`/`debit`
- **الملفات المتأثرة:**
  - Backend: مشمول في `20260604_credit_programs_v2.sql`
- **الحالة:** VERIFIED

---

### RG-058 — Credit Program A Correction

- **المشكلة:** حد ائتمان Program A مضبوط على 150,000 EGP — الصحيح هو 100,000 EGP حسب العقود الرسمية
- **السبب الجذري:** خطأ في إدخال البيانات
- **الإصلاح:** تحديث `credit_programs` (1 row updated)
- **الملفات المتأثرة:**
  - Database: `credit_programs` — 1 row
- **التحقق:** Program A: 100,000 EGP / 15 أيام ✅
- **الحالة:** VERIFIED

---

## 16. Database Recovery

---

### RG-059 — Phase 3 Database Recovery

- **المشكلة:** 9 جداول (1 app + 8 public)، 3 enums، 25 constraints، 8 indexes، 92 functions مفقودة من المهاجرات — قاعدة البيانات غير قابلة للتكرار
- **السبب الجذري:** تم إنشاء الكائنات يدوياً على DB الحية بدون توثيق في المهاجرات
- **الإصلاح:** `20260603_recovery_missing_tables.sql` + `20260607_recovery_missing_functions.sql`
- **الملفات المتأثرة:**
  - Database: 9 جداول، 3 enums، 25 constraints، 8 indexes، 92 functions
- **التحقق:** قاعدة البيانات الآن قابلة للتكرار بالكامل من المهاجرات
- **الحالة:** VERIFIED

---

## 17. UI & Mobile

---

### RG-060 — Console Log Tracing Removal (63 logs)

- **المشكلة:** 63 استدعاء `console.log` في 16 ملف — بعضها يعرض بيانات حساسة (API responses, session data)
- **السبب الجذري:** بقايا تطوير
- **الإصلاح:** إزالة 63 `console.log` من 16 ملف + تنظيف `src/lib/diag.ts`
- **الملفات المتأثرة:**
  - Frontend: 16 ملف (DashboardPage, VisitScreen, auth.ts, OrderStatusManager, إلخ)
- **ملاحظة:** ظهرت 29 `console.log` جديدة منذ ذلك الإصلاح (تم توثيقها في FIX_HISTORY FIX-004)
- **الحالة:** PARTIALLY_VERIFIED — ظهرت جديدة

---

### RG-061 — Mobile-First UI Blocking Fixes (5 Fixes)

- **المشكلة 1:** DashboardPage يوجّه الجميع إلى ManagementDashboard
- **المشكلة 2:** OrderEditPage يستخدم mock data بدلاً من live data
- **المشكلة 3:** VisitsPage يعرض UUID بدلاً من اسم العميل
- **المشكلة 4:** WarehousePage يستخدم `<table>` (غير متجاوب مع المحمول)
- **المشكلة 5:** WarehouseReviewPage يستخدم `<table>` + `notes.trim()` validation مفقود
- **الإصلاح:** 5 إصلاحات منفصلة في `20260601`:
  - DashboardPage: role-based routing
  - OrderEditPage: استبدال mock بـ `supabase.from('order_items').select('*, products(product_name)')`
  - VisitsPage: `visit.customer_name || visit.customer_id`
  - WarehousePage: `<table>` → card layout
  - WarehouseReviewPage: `<table>` → card layout + validation
- **الملفات المتأثرة:**
  - Frontend: 5 صفحات
- **التحقق:** `tsc --noEmit` passes clean
- **ملاحظة:** OrderEditPage لا يزال يستخدم `supabase.from()` مباشرة (غير محكوم)
- **الحالة:** PARTIALLY_VERIFIED

---

### RG-062 — Product Availability UI Fix

- **المشكلة:** StorefrontPage يعرض كل المنتجات كـ "نفذت الكمية" (أسعار = 0)
- **السبب الجذري:** استعلام جداول/أعمدة غير موجودة
- **الإصلاح:** مشمول ضمن RG-016
- **الحالة:** VERIFIED

---

## 18. Warehouse Runtime

---

### RG-063 — Warehouse Runtime Phase 1 (4 Issues)

- **المشاكل:**
  1. Composite type `v_session` ينتج `employee_id` = null → استُبدل بـ scalar `v_employee_id`
  2. PowerShell dollar-quoting كسر إنشاء الدوال → استُخدمت Node.js scripts
  3. `company_name` type mismatch (varchar(255) vs text) → `::text` cast
  4. `v_order_status` لم يُتحقق من `approved` → إضافة `INVALID_ORDER_STATUS` guard
- **الإصلاح:** `20260602_p2_runtime_usability_fixes.sql` + إصلاحات يدوية
- **الملفات المتأثرة:**
  - Backend: جميع دوال warehouse RPCs
- **الحالة:** VERIFIED

---

### RG-064 — Warehouse Runtime Phase 2 (ROWTYPE + WRQ1001)

- **المشكلة 1:** ROWTYPE null field bug في `governed_return_to_preparation` — استُبدل بـ scalar `v_status`
- **المشكلة 2:** كود `WRQ1001` لا يُوجّه إلى WarehouseDashboard لأن `code` لم يكن في SessionUser
- **الإصلاح:** إضافة `code` إلى `SessionUser` في auth store/service
- **الملفات المتأثرة:**
  - Frontend: `src/store/auth.ts`, `src/services/auth.ts`, `DashboardPage.tsx`
- **الحالة:** VERIFIED

---

### RG-065 — Warehouse Runtime Phase 3 (ROWTYPE + Notes Required)

- **المشكلة 1:** ROWTYPE null field bug في دوال متعددة — استُبدلت بـ scalar variables
- **المشكلة 2:** `governed_return_to_preparation` — param من `DEFAULT NULL` إلى `text` مطلوب (يتطلب drop + recreate)
- **المشكلة 3:** `notes` فارغ يسبب فشل في DB — `REASON_REQUIRED` enforcement
- **الإصلاح:** إصلاحات ROWTYPE + param type + notes validation
- **الملفات المتأثرة:**
  - Backend: `governed_fail_preparation`, `governed_record_exception`, `governed_return_to_preparation`
  - Frontend: `WarehousePage.tsx`, `WarehousePrepDetail.tsx`
- **الحالة:** VERIFIED

---

## ملحق: الإصلاحات المتكررة (KNOWN REGRESSIONS)

هذه إصلاحات تم تطبيقها أكثر من مرة — مؤشر على أن المشكلة لم تُحل جذرياً:

| الظاهرة | مرات الإصلاح | RG IDs | سبب التكرار |
|---------|--------------|--------|-------------|
| `console.log` يعود للظهور | 2 | RG-060، FIX-004 | لا توجد قاعدة إلزامية، لا lint rule |
| `supabase.from()` يعود للظهور | 2+ | RG-008، FIX-013، FIX-014 | لا يوجدـ lint rule يمنع الاستدعاء المباشر |
| Hardcoded role names تعود | 2 | RG-002، RG-003 | 30+ ملف لم تُهاجر بعد |
| أسماء أعمدة خاطئة (e.name) | 2 | RG-033، RG-039 | معرفات الجدول غير موثقة مركزياً |

---

*تاريخ الإنشاء: 2026-06-16*  
*المرجع: PROJECT_CHANGELOG.md (907 lines)، 22 fix-named migration files، ACTIVE_RPC_CATALOG.md*  
*الإجمالي: 65 إصلاحاً موثقاً (RG-001 — RG-065)*
