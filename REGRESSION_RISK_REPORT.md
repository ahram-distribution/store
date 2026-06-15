# REGRESSION RISK REPORT — تقييم مخاطر رجوع الأعطال

> **التاريخ:** 2026-06-16  
> **الهدف:** تحديد الإصلاحات التي يمكن أن تنكسر بسهولة لحمايتها مستقبلاً  
> **المرجع:** REGRESSION_GUARD.md (RG-001 — RG-065)  
> **المنهجية:** تحليل عدد نقاط الفشل (failure points)، وجود مسارات متعددة، جودة التوثيق، وجود اختبارات

---

## Quick Summary

| مستوى الخطورة | العدد | % |
|--------------|-------|---|
| **HIGH** — يمكن أن ينكسر بسهولة | 18 | 28% |
| **MEDIUM** — مستقر جزئياً | 22 | 34% |
| **LOW** — مستقر ومثبت | 20 | 31% |
| **UNKNOWN** — غير مؤكد | 5 | 8% |
| **الإجمالي** | **65** | **100%** |

---

## HIGH RISK — إصلاحات يمكن أن تنكسر بسهولة

> هذه الإصلاحات معرضة للخطر بسبب: وجود أكثر من مسار/تنفيذ، عدم اكتمال الإصلاح، عدم وجود اختبارات، اعتماد على كود غير موحد.

### HR-001 — Hardcoded Role Names في RPCs (RG-002)
- **السبب:** الإصلاح طُبق على ملفين فقط من أصل 32+ — باقي 30+ ملف لا تزال تستخدم hardcoded names
- **نقاط الفشل:** 30+ ملف مهاجرة مع 3 أنماط مختلفة (EN trilogy, AR trilogy, Extended)
- **سيناريو الكسر:** إضافة دور جديد يتطلب تعديل 30+ ملف — أي ملف يُنسى يسبب كسر الرؤية
- **كيفية الحماية:** إكمال الترحيل لجميع الـ RPCs لاستخدام `is_upper_management()`

### HR-002 — Console.log يعود بعد التنظيف (RG-060)
- **السبب:** تم تنظيف 63 log ثم ظهر 29 log جديد — لا توجد قاعدة إلزامية
- **نقاط الفشل:** 11 ملف حالياً، أي developer يمكنه إضافة `console.log`
- **سيناريو الكسر:** أي commit جديد قد يضيف logs
- **كيفية الحماية:** إضافة ESLint rule (`no-console: error`) في CI/CD

### HR-003 — supabase.from() يعود بعد الإصلاح (RG-008)
- **السبب:** تم إصلاح 6 صفحات ثم ظهر استدعاءان جديدان في AccountPage و CompanyManagerPage
- **نقاط الفشل:** 3 مواقع حالياً (AccountPage, CompanyManagerPage, OrderEditPage)
- **سيناريو الكسر:** أي صفحة جديدة قد تستخدم `supabase.from()` مباشرة
- **كيفية الحماية:** إضافة ESLint rule (`no-restricted-imports`) + مراجعة الكود الجديد

### HR-004 — أسماء أعمدة خاطئة في Attendance (RG-033, RG-039)
- **السبب:** 6 دوال استخدمت `e.name`/`e.active` — صُححت ثم عاد الخطأ في مهاجرة أخرى
- **نقاط الفشل:** أي RPC جديد يشير إلى `employees` قد يكرر الخطأ
- **سيناريو الكسر:** مهاجرة جديدة تستخدم `e.name` بدلاً من `e.full_name`
- **كيفية الحماية:** إنشاء دالة `employee_cols()` أو view موحد لـ employees

### HR-005 — Sales By Rep Nested Aggregate (RG-040)
- **السبب:** PostgreSQL aggregate nesting limitation — فقط `get_sales_by_rep` تم إصلاحه
- **نقاط الفشل:** دوال reports الأخرى (8 دوال) قد يكون لديها نفس المشكلة
- **سيناريو الكسر:** إضافة aggregate جديد داخل `jsonb_agg` في أي RPC
- **كيفية الحماية:** مراجعة جميع دوال reports لنفس pattern

### HR-006 — DashboardPage Routing (RG-021, RG-022)
- **السبب:** مساران مختلفان (role-based + hardcoded WRQ1001) — أي تغيير في hierarchy قد يكسر routing
- **نقاط الفشل:** 3 أنماط routing مختلفة (WORKSPACE_HIERARCHY, DEPRECATED_ROUTES, hardcoded WRQ1001)
- **سيناريو الكسر:** إضافة دور جديد دون تحديث DashboardPage
- **كيفية الحماية:** توحيد الـ routing في مصفوفة واحدة

### HR-007 — Warehouse Runtime Param Types (RG-063, RG-064, RG-065)
- **السبب:** ROWTYPE null field bug عاد 3 مرات — لم يُحل جذرياً
- **نقاط الفشل:** 3 إصلاحات لنفس المشكلة في 3 مراحل
- **سيناريو الكسر:** أي RPC جديد يستخدم ROWTYPE قد يكرر المشكلة
- **كيفية الحماية:** قاعدة إلزامية: لا تستخدم ROWTYPE في warehouse RPCs

### HR-008 — Order Status History CHECK (RG-049)
- **السبب:** CHECK constraint يسرد 13 حالة يدوياً — إضافة حالة جديدة تتطلب ALTER TABLE
- **نقاط الفشل:** قائمة يدوية بالحالات في CHECK constraint
- **سيناريو الكسر:** إضافة حالة طلب جديدة (مثلاً `partially_delivered`) — 409 Conflict
- **كيفية الحماية:** استبدال CHECK constraint بجدول `order_statuses` مع FK

### HR-009 — Governance Compliance (RG-043)
- **السبب:** بعض governed RPCs تفتقد حقول — الإصلاح أضاف حقول لكن قد تظهر حقول مفقودة جديدة
- **نقاط الفشل:** تزامن RPCs مع تعريفات الجداول ليس مؤتمتاً
- **سيناريو الكسر:** إضافة عمود جديد لجدول دون تحديث RPC — العمود لا يظهر في API
- **كيفية الحماية:** فحص دوري: مقارنة أعمدة RPC outputs مع تعريفات الجداول

### HR-010 — GPS sync_tracking_points Double-Encoded JSON (RG-036)
- **السبب:** البيئة (Capacitor + browser) قد ترسل JSON بترميزات مختلفة
- **نقاط الفشل:** 3 تنسيقات JSON محتملة (array, string-encoded, object)
- **سيناريو الكسر:** تحديث Capacitor أو تغيير platform يعيد مشكلة الترميز
- **كيفية الحماية:** اختبار مع جميع تنسيقات JSON المعروفة

### HR-011 — Customer Create/Update Address Storage (RG-037)
- **السبب:** ELSIF condition خاطئ — المنطق الشرطي معقد ويعتمد على ترتيب params
- **نقاط الفشل:** 3 مسارات مختلفة (text only, GPS only, both)
- **سيناريو الكسر:** تغيير ترتيب params في الـ RPC بدون تحديث الواجهة
- **كيفية الحماية:** تبسيط المنطق الشرطي + اختبارات لكل مسار

### HR-012 — Role Normalization Mapping (RG-028)
- **السبب:** تعيين 22+ variant إلى 6 أدوار — أي اسم دور جديد غير معروف يسقط إلى `'مندوب مبيعات'`
- **نقاط الفشل:** تعيين صامت (silent fallback) — لا يوجد تحذير عند إضافة دور غير معروف
- **سيناريو الكسر:** إضافة دور جديد (`مدير تسويق`) — يُصنف خطأً كـ `مندوب مبيعات`
- **كيفية الحماية:** رفع خطأ (throw) بدلاً من الـ fallback الصامت

### HR-013 — UAT Defect Pipeline (RG-051)
- **السبب:** 4 RPCs لم تُنشر رغم أن الكود الأمامي يشير إليها — فجوة بين التطوير والنشر
- **نقاط الفشل:** أي feature جديد قد يُطبق في frontend قبل backend
- **سيناريو الكسر:** بناء ميزة في الواجهة والـ RPC المقابل لم يُنشر بعد
- **كيفية الحماية:** CI/CD pipeline: `supabase db push` قبل `npm run build`

### HR-014 — Phase 5 Role Management Type Mismatch (RG-029)
- **السبب:** `p_token` من `text` بدلاً من `uuid` — type mismatch بين تعريف RPC والتابع المُستدعَى
- **نقاط الفشل:** أي RPC جديد قد يعلن params بنوع خاطئ
- **سيناريو الكسر:** نسخ-لصق RPC من RPC قديم مع `p_token text`
- **كيفية الحماية:** eslint plugin for SQL types أو قالب RPC موحد

### HR-015 — Credit Module Enum/Constraint (RG-057)
- **السبب:** 3 مشاكل في seed data (enum, constraint, NOT NULL)
- **نقاط الفشل:** أي seeds جديد قد يكرر نفس المشاكل
- **سيناريو الكسر:** إضافة credit module seed جديد دون اختبار على DB فارغة
- **كيفية الحماية:** اختبارات SQL للتأكد من صحة seeds على DB فارغة

### HR-016 — Attendance RPC PostgREST 404 (RG-031, RG-032)
- **السبب:** `get_visible_employee_ids` يرجع `uuid[]` لكن الكود استخدم `FROM-subquery` pattern — PostgREST 404
- **نقاط الفشل:** أي RPC جديد يستخدم `get_visible_employee_ids` قد يكرر نفس pattern الخاطئ
- **سيناريو الكسر:** RPC جديد يستخدم `IN (SELECT * FROM get_visible_employee_ids(...))`
- **كيفية الحماية:** قاعدة إلزامية: استخدم `= ANY(get_visible_employee_ids(...))` دائماً

### HR-017 — is_upper_management ليس بديلاً كاملاً (RG-001, RG-027)
- **السبب:** `is_upper_management()` موجود لكن ليس كل RPCs تستخدمه — بعضها لا يزال يفحص hardcoded names
- **نقاط الفشل:** 30+ RPC لم تُهاجر — أي RPC يُعاد إنشاؤه قد ينسى استخدام الدالة
- **سيناريو الكسر:** إعادة إنشاء RPC من restore قد يعيد النمط القديم
- **كيفية الحماية:** grep دوري للتحقق من عدم ظهور hardcoded patterns جديدة

### HR-018 — Credit Program Limit (RG-058)
- **السبب:** قيمة 150,000 عوضاً عن 100,000 — خطأ يدوي في الإدخال
- **نقاط الفشل:** 1 قيمة في 1 row
- **سيناريو الكسر:** إعادة seeding قاعدة البيانات من صفر قد يستخدم القيمة الخاطئة
- **كيفية الحماية:** مراجعة يدوية + اختبار acceptance

---

## MEDIUM RISK — إصلاحات مستقرة جزئياً

> هذه الإصلاحات تعمل حالياً لكن有可能 broken if certain conditions change.

### MR-001 — Database Recovery (RG-059)
- **مستقر لأن:** المهاجرات idempotent (`IF NOT EXISTS`/`OR REPLACE`)
- **خطر:** 92 function + 9 tables — أي منها قد يحتاج تحديثاً ولا يتزامن مع الباقي
- **سيناريو الكسر:** إعادة بناء DB كامل ونسيان المهاجرات الترتيبية

### MR-002 — Order Approval Pipeline (RG-048)
- **مستقر لأن:** `'reviewing'` أضيف كحالة مقبولة
- **خطر:** إضافة حالة جديدة (مثلاً `'escalated'`) 需 تحديث المنطق الشرطي

### MR-003 — Customer Visibility (RG-010)
- **مستقر لأن:** hierarchical filter مطبق
- **خطر:** 25 عميل REG-* لا يزالون بلا `owner_id` مناسب — فقط SYS-OWNER

### MR-004 — Warehouse & Transport Dashboard (RG-011)
- **مستقر لأن:** فلاتر الرؤية مطبقة
- **خطر:** لا يزال يعتمد على hardcoded `WRQ1002`/`WRQ1004`

### MR-005 — SalesRep identity_id Fix (RG-012)
- **مستقر لأن:** `app.identity_id` يُضبط قبل استدعاءات الحوكمة
- **خطر:** أي RPC جديد ينسى ضبط `app.identity_id` سيفشل للمستخدمين العاديين

### MR-006 — Sales Manager Dashboard Scoping (RG-041)
- **مستقر لأن:** scoping مطبق
- **خطر:** 5 مستخدمين فقط (الإدارة العليا) — غير مُختبر بشكل كافٍ لغير UM

### MR-007 — Customer Analytics 5 Issues (RG-052)
- **مستقر لأن:** 5 مشاكل تقنية صُححت
- **خطر:** analytics RPCs معقدة — أي تعديل قد يعيد إحدى المشاكل

### MR-008 — Phase 3 Recovery Completeness (RG-059)
- **مستقر لأن:** DB قابلة للتكرار
- **خطر:** 92 function — عدم اليقين أن جميعها مستخدمة (6 test functions موجودة)

### MR-009 — Tier Discount Enforcement (RG-056)
- **مستقر لأن:** hierarchy مطبق (product exception > company exception > default)
- **خطر:** `governed_create_order` لديه 5 إصدارات — الأحدث فقط لديه الخصم

### MR-010 — Customer Direct Ownership (RG-047)
- **مستقر لأن:** RPCs ownership موجودة
- **خطر:** تغيير الملكية سير عمل معقد — لم يُختبر بشكل كافٍ لجميع السيناريوهات

### MR-011 — Employee Password Update (RG-054)
- **مستقر لأن:** `p_password` أضيف
- **خطر:** لم يُتحقق من تشفير password داخل الـ RPC

### MR-012 — Schema Alignment Additions (RG-013, RG-015, RG-055)
- **مستقر لأن:** الأعمدة أضيفت إلى الجداول
- **خطر:** لا توجد آلية لضمان تزامن تعريفات الجداول مع الكود مستقبلاً

### MR-013 — Global Search Extension (RG-053)
- **مستقر لأن:** يبحث في 6 مجالات
- **خطر:** يعتمد على `ilike` — أداء ضعيف مع بيانات كبيرة

### MR-014 — Mobile-First UI Fixes (RG-061)
- **مستقر لأن:** 5 صفحات تعمل على المحمول
- **خطر:** صفحتان (OrderEditPage, Warehouse) لا تزالان تستخدمان `supabase.from()` مباشرة

### MR-015 — Customer Reality Gap (RG-046)
- **مستقر لأن:** `p_email` أضيف إلى `register_customer`
- **خطر:** `customers.email` لا يزال يظهر في CustomerProfilePage رغم إزالته من الإنشاء

### MR-016 — P2 Runtime Usability (RG-051)
- **مستقر لأن:** 4 RPCs جديدة أُنشئت
- **خطر:** `governed_create_customer` في 3 صفحات — قد يكون هناك نسخ/لصق في RPCs أخرى

### MR-017 — RLS for Unified Locations (RG-044)
- **مستقر لأن:** policies مضافة
- **خطر:** RLS لا يزال غير مفعل على بقية جداول public.* — وهم أمني

### MR-018 — Schema Grants (RG-045)
- **مستقر لأن:** GRANT USAGE مضاف
- **خطر:** أي schema جديد يُنشأ ويُنسى منح الصلاحية له

### MR-019 — Product Availability UI (RG-016, RG-062)
- **مستقر لأن:** الأسعار مشتقة من `carton_price`/`carton_quantity` — لا استعلامات لجداول غير موجودة
- **خطر:** 5 ملفات تأثرت — أي تعديل في حساب السعر قد يكسرها

### MR-020 — Warehouse Runtime ROWTYPE (RG-063-065)
- **مستقر لأن:** scalar variables تستخدم بدلاً من ROWTYPE
- **خطر:** ROWTYPE bug عاد 3 مرات — قد يعود مرة رابعة إذا استخدمه developer جديد

### MR-021 — Order Status FK Fix (RG-050)
- **مستقر لأن:** `v_session.identity_id` يُستخدم الآن
- **خطر:** 3 RPCs فقط تأثرت — RPCs أخرى قد لا تزال تستخدم `employee_id`

### MR-022 — SuperAdmin Workspace Routing (RG-001, RG-004)
- **مستقر لأن:** `normalizeEmployeeRole()` موجود
- **خطر:** تعيين 22 اسم دور → 6 أدوار — أي اسم جديد غير معروف يسبب fallback خاطئ

---

## LOW RISK — إصلاحات مستقرة ومثبتة

> هذه الإصلاحات تعمل بشكل موثوق ولديها فرصة ضئيلة للكسر.

### LR-001 — is_upper_management() Function (RG-027)
- **مستقر جداً:** دالة واحدة مركزية، مستخدمة في 20+ RPC، مختبرة
- **تحذير:** فقط إذا حُذفت الدالة (CAREFUL: DROP CASCADE)

### LR-002 — Attendance RPC Visibility (RG-032)
- **مستقر:** pattern `= ANY()` مثبت

### LR-003 — Attendance Employee Columns (RG-033)
- **مستقر:** 6 دوال صُححت — أسماء الأعمدة مطابقة للـ DB

### LR-004 — Phase 6 Hotfix (4 RPCs) (RG-034)
- **مستقر:** HTTP 201 لكل RPC + `npm run build` نجح

### LR-005 — GPS Distance Drift (RG-035)
- **مستقر:** 3 طبقات حماية في `get_employee_day_map`

### LR-006 — Sync Tracking Points (RG-036)
- **مستقر:** يتعامل مع double-encoded JSON

### LR-007 — Customer Create/Update (RG-037)
- **مستقر:** `unified_locations` هو source of truth

### LR-008 — Employee Day Map (RG-038)
- **مستقر:** RPC مُحدّث بالكامل

### LR-009 — Live Workday Overview (RG-039)
- **مستقر:** أسماء أعمدة صحيحة

### LR-010 — Sales By Rep (RG-040)
- **مستقر:** nested aggregate في subquery

### LR-011 — Dashboard Counts (RG-042)
- **مستقر:** `get_governed_dashboard_counts` مع subtree scoping

### LR-012 — Governance Compliance Fields (RG-043)
- **مستقر:** الحقول `image_url`, `is_visible`, `logo_url` مضافة

### LR-013 — Order Approval Pipeline (RG-048)
- **مستقر:** `'reviewing'` كحالة مقبولة

### LR-014 — Order Status History CHECK (RG-049)
- **مستقر:** 13 حالة في CHECK constraint

### LR-015 — Credit Program Correction (RG-058)
- **مستقر:** 100,000 EGP — قيمة ثابتة

### LR-016 — Phase 3 Recovery (RG-059)
- **مستقر:** 92 function + 9 tables + 3 enums + 25 constraints + 8 indexes

### LR-017 — Repository Cleanup (RG-026)
- **مستقر:** index.html مستعاد، `npm run build` يعمل

### LR-018 — Mobile UI Fixes (RG-061)
- **مستقر:** 5 صفحات تعمل على المحمول

### LR-019 — Console Log Cleanup (RG-060)
- **مستقر:** 63 log أزيلت (لكن 29 ظهرت — انظر HR-002)

### LR-020 — Phase 2 Verification (RG-059-adjacent)
- **مستقر:** discovery phase — لا كود للإصلاح

---

## تحليل أنماط الـ Regression

### النمط الأكثر تكراراً: "نفس المشكلة، إصلاحات متعددة"

| المشكلة | RG IDs | عدد الإصلاحات | الوضع الحالي |
|---------|--------|---------------|--------------|
| ROWTYPE null field bug | RG-063, RG-064, RG-065 | **3** | استُبدل بـ scalar variables |
| أسماء أعمدة Attendance (e.name) | RG-033, RG-039 | **2** | صُححت — قد تعود |
| console.log | RG-060, FIX-004 | **2** | عاد 29 log جديد |
| supabase.from() | RG-008, FIX-013, FIX-014 | **3** | عاد في موقعين |
| Ordered approval logic | RG-048, RG-049, RG-050 | **3** | مستقر حالياً |

### الأسباب الجذرية للتكرار

1. **لا توجد اختبارات آلية** — Playwright موجود في devDependencies لكن غير مستخدم
2. **لا توجد CI/CD** — لا ESLint rules، لا pre-commit hooks، لا automated checks
3. **لا يوجد توثيق مركزي للمعرفات** — أسماء الأعمدة (full_name vs name) تسبب أخطاء متكررة
4. **المهاجرات (migrations) غير موحدة** — 99 مهاجرة بـ 4 أنماط مختلفة للترقيم
5. **لا يوجد نظام تحذير (warning system)** — الإصلاحات الجديدة لا تُتحقق من الإصلاحات السابقة

---

## التوصيات للحماية

### فورية (يمكن تطبيقها بدون كود)
1. إضافة `REGRESSION_GUARD.md` إلى عملية مراجعة الكود — قبل أي PR، تحقق من RG IDs المتأثرة
2. إنشاء قائمة تحقق (checklist) قبل كل مهاجرة SQL جديدة:
   - [ ] هل تستخدم `is_upper_management()` بدلاً من hardcoded names؟
   - [ ] هل تستخدم `= ANY(get_visible_employee_ids())` لا `IN (SELECT ...)`؟
   - [ ] هل الأعمدة `full_name`, `is_active` لا `name`, `active`؟
   - [ ] هل `p_token` من نوع `uuid` لا `text`؟
   - [ ] هل `app.identity_id` مضبوط قبل استدعاءات الحوكمة؟
3. إضافة هذه القائمة إلى `.opencode/AGENTS.md`

### قصيرة المدى (تتطلب تغيير كود)
4. إزالة `console.log` عبر ESLint rule (`no-console: error`)
5. منع `supabase.from()` عبر ESLint rule (`no-restricted-imports`)
6. إكمال ترحيل RPCs المتبقية من hardcoded names إلى `is_upper_management()`

### طويلة المدى
7. إضافة اختبارات API (لـ RPCs) قبل أي تغييرات جذرية
8. إنشاء `types/database.ts` شامل ليكون المصدر الوحيد للحقيقة لتعريفات الجداول
9. إضافة CI/CD pipeline مع lint + typecheck + migration check

---

*تاريخ الإنشاء: 2026-06-16*  
*المرجع: REGRESSION_GUARD.md (65 إصلاحاً)، FIX_HISTORY.md (15 مشكلة مفتوحة)*  
*إجمالي الإصلاحات: 65 | HIGH: 18 | MEDIUM: 22 | LOW: 20 | UNKNOWN: 5*
