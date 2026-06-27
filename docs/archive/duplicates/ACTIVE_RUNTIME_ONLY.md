# ACTIVE RUNTIME ONLY — الحقيقة الفعلية للنظام

> **التاريخ:** 2026-06-15  
> **الهدف:** توثيق ما يُستخدم فعلياً أثناء التشغيل الحقيقي — وليس ما هو موجود في الكود فقط  
> **المرجع:** PROJECT_TRUTH_AUDIT.md

---

## ملخص النتائج النهائي

| البند | في الكود | يُستخدم فعلياً | unused/legacy |
|-------|----------|---------------|---------------|
| مسارات (routes) | 82 | 82 | 0 |
| مكونات صفحات | ~100+ | ~100+ | 0 |
| RPCs فريدة | 187 | 180 | 7 (test_*) |
| جداول قاعدة البيانات | 72 | ~65 | ~7 |
| خدمات (services) | 19 | 19 | 0 (كلها مستخدمة) |
| أنظمة GPS | 5 | 4.5 | Order GPS (غير مطبق) |
| أدوار (roles) | 32+ | 5 in DB + ~27 legacy في الكود | انظر التقرير |
| Workspaces | 25 | ~9 (الباقي لأدوار غير موجودة) | ~16 |
| أدوار ممنوحة لموظفين | — | 5 | انظر أدناه |
| تخطي Governance (from) | 2 موقع | 2 | يجب إصلاحهما |

---

## اكتشافات حرجة

### 1. Service Layer مهجور — الصفحات تستدعي supabase مباشرة

تقريباً كل صفحة تستدعي `supabase.rpc()` مباشرة بدلاً من المرور عبر الـ services layer. الـ services موجودة لكن الصفحات لا تستخدمها. هذا يعني **الـ services layer غير فعال** — التغييرات فيه لا تؤثر على شيء.

**مثال:**
- `attendanceService.startWorkday()` موجود في `attendance.ts:8` لكن `AttendanceRuntimePage.tsx:158` تستدعي `supabase.rpc('start_workday', ...)` مباشرة

### 2. Workspaces غير قابلة للوصول

16 من 25 Dashboard workspace تستخدم أدواراً غير موجودة في قاعدة البيانات (لم يتم منحها لأي موظف). هذه الـ workspaces **لا يمكن الوصول إليها فعلياً**:

- `AdminWorkspace` — لا يوجد موظف بدور "أدمن"
- `ChairmanWorkspace` — لا يوجد موظف بدور "رئيس مجلس الإدارة"
- `SuperAdminWorkspace` — لا يوجد موظف بدور "سوبر أدمن"
- `AccountantWorkspace` — لا يوجد موظف بدور "محاسب"
- `CollectorWorkspace`, `SecurityWorkspace`, `BuffetWorkspace`, `DataEntryWorkspace`, إلخ — لا يوجد موظفون بهذه الأدوار

### 3. GPS لنظام الطلبات غير مطبق

كل بنية GPS لإنشاء الطلبات موجودة (حقول في جدول orders، معاملات في RPC)، لكن القيم دائماً `null`. أمر GPS لا يُستدعى أبداً عند إنشاء الطلب.

### 4. Hardcoded Role Names منتشرة في RPCs

32+ ملف مهاجرة تحتوي على ~91 فحص باسم الدور (hardcoded). أي تغيير في مسمى دور يتطلب تحديث 32+ ملف.

### 5. كود موظف Hardcoded

`WRQ1002`, `WRQ1004` موجودة كاستثناءات رؤية في ~25 RPC. إذا غادر هؤلاء الموظفون تنكسر الرؤية.

### 6. 29 Console.log في الإنتاج

في 11 ملف مختلف. بعضها يعرض بيانات تفصيلية (مثل `MapTab.tsx` يعرض كامل استجابة API).

### 7. تخطي Governance في صفحتين على الأقل (خطر أمني)

تم اكتشاف 3 مواقع تستدعي `supabase.from()` مباشرة بدلاً من RPCs:

| الموقع | المسار | الاستدعاء | الخطر |
|--------|--------|-----------|-------|
| AccountPage.tsx | `src/pages/account/AccountPage.tsx:156` | `supabase.from('customer_addresses').select('*')` | يعتمد على RLS لكن RLS غير مفعل على public.* |
| CompanyManagerPage.tsx | `src/pages/companies/CompanyManagerPage.tsx:72` | `supabase.from('companies').select('*')` | يعتمد على RLS لكن RLS غير مفعل |
| deals.ts (مُبلغ عنه سابقاً، قد يكون محدثاً) | `src/services/deals.ts` | سابقاً `supabase.from('packages')` | (تم التحقق — يستخدم RPC الآن) |

**الخطر:** جميع جداول `public.*` لديها `rowsecurity = false`. أي استدعاء مباشر للجدول يتجاوز طبقة الأمان بالكامل ويكشف البيانات كاملة.

### 8. DashboardPage — الـ routing الفعلي للصلاحيات

`DashboardPage.tsx` منظم بشكل جيد مع:
- **WORKSPACE_HIERARCHY** (6 أدوار ACTIVE): الإدارة العليا ← مدير بيع ← مشرف عام ← مندوب مبيعات ← مدير مخزن ← سيلز داخلي
- **DEPRECATED_ROUTES** (9 أدوار قديمة): warehouse, delivery, collector, accountant, purchasing_manager, secretary, security, buffet, data_entry — كلها تُوجّه إلى ManagementDashboard
- **Hardcoded** كود الموظف `WRQ1001` يعيد توجيهه إلى WarehouseDashboard (قديم — يجب استبداله)

### 9. AccountPage.tsx يستخدم customer_addresses مباشرة بدون Gobernance

`AccountPage.tsx:151-162` يستخدم `supabase.from('customer_addresses')` مباشرة — لا يمر عبر RPC. هذا يعني:
- العميل يرى عناوينه عبر مسار غير خاضع للرقابة
- لو تغير هيكل `customer_addresses` أو أزيل، تنكسر الصفحة
- لا يوجد تسجيل (logging) أو فحص صلاحية لهذا الاستدعاء

---



## تقييم ACTIVE vs DEAD

### ACTIVE — يُستخدم فعلياً

- **المسارات الأساسية:** Dashboard, Orders, Visits, Customers, Products, Storefront, Attendance, Credit, Returns, Warehouse, Delivery, Employees, Hierarchy, Collections
- **الـ Workspaces القابلة للوصول:** UpperManagementDashboard, SalesManagerCCPage, SalesRepWorkDay, WarehouseManagerWorkspace, ManagementDashboard
- **خدمات GPS:** gpsService (النواة), trackingEngine, locationService, Event GPS
- **RPCs المتعلقة بـ:** orders, customers, visits, employees, products, attendance, returns, credit, collections, delivery, warehouse, targets, tiers
- **جداول البيانات:** جميع الجداول الـ 65 التي تُقرأ أو تُكتب

### DEAD — لا يمكن الوصول إليه أو لا يُستخدم

- **أدوار:** SUPER_ADMIN, سوبر أدمن, ADMIN, CHAIRMAN, رئيس مجلس الإدارة, أدمن — غير ممنوحة لأي موظف حالياً
- **Workspaces:** AdminWorkspace, ChairmanWorkspace, SuperAdminWorkspace, AccountantWorkspace, CollectorWorkspace, SecurityWorkspace, BuffetWorkspace, DataEntryWorkspace, SecretaryWorkspace, PurchasingManagerWorkspace, DeliveryWorkspace
- **RPCs:** multiline_test, test_func, test_ping2, test_ping3, test_rpc, test_setof (اختبارية)
- **Order GPS:** لم يُطبق (القيم دائماً null)
- **جداول:** customer_addresses (قديم — يستبدله unified_locations)
- **جداول فارغة:** expenses, employee_advances, credit_contracts, preparation_records, preparation_exceptions

### LEGACY — له بديل أحدث

- **customer_addresses** ← unified_locations
- **deals.ts service** ← dailyDeals.ts (تكرار في الوظيفة)
- **orders.snapshot_sender_*** (حقول مهملة) ← snapshot_customer_* / snapshot_owner_*
- **customers.email** — يزال في CustomerProfilePage رغم إزالته من صفحات الإنشاء
- **types/database.ts** — قديم، يغطي 6 جداول فقط من أصل 72

### DUPLICATE — تكرار

- **deals.ts** + **dailyDeals.ts** — كلاهما يستدعي `get_governed_daily_deals`
- **CompaniesPage** (storefront) + **MgmtCompaniesPage** — مساران لمكونين مختلفين لكن اسم واحد (مربك)
- **PWA manifests:** `public/manifest.webmanifest` + `public/pwa/manifest.json` — ملفان للمانيفست
- **customer_addresses + unified_locations** — نظاما عناوين متوازيان

---

## الخلاصة

النظام يعمل ببيانات حقيقية وكل شيء متصل بشكل ما. لكن هيكلة الكود لا تعكس الواقع الفعلي:

1. **الـ services layer** غير فعال — معظم الصفحات تتجاوزه
2. **أدوار كثيرة** موجودة في الكود لكن غير ممنوحة لأحد
3. **نظام GPS** يحتاج توحيد للتخزين وإكمال Order GPS
4. **جميع الـ RPCs الـ 187** مستخدمة عدا 7 دوال اختبار فقط
5. **جميع الخدمات الـ 19** مستخدمة (بعضها فقط داخلياً)
6. **تخطي Governance** في موقعين (AccountPage, CompanyManagerPage) — يجب الإصلاح فوراً
