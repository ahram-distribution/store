# REMOVAL CANDIDATES — مرشحو الحذف

> **التاريخ:** 2026-06-15  
> **تحذير:** هذا تقرير فقط. لا تنفذ أي حذف حتى الموافقة.

---

## 1. RPCs مرشحة للحذف

### TEST (دوال اختبار)

| الـ RPC | ملف المهاجرة | سبب الحذف |
|---------|-------------|-----------|
| `multiline_test` | غير معروف | دالة اختبار، لا تُستدعى أبداً |
| `test_func` | غير معروف | دالة اختبار، لا تُستدعى أبداً |
| `test_ping2` | غير معروف | دالة اختبار، لا تُستدعى أبداً |
| `test_ping3` | غير معروف | دالة اختبار، لا تُستدعى أبداً |
| `test_rpc` | غير معروف | دالة اختبار، لا تُستدعى أبداً |
| `test_setof` | غير معروف | دالة اختبار، لا تُستدعى أبداً |
| `ping` | غير معروف | تُستخدم فقط للـ health check اليدوي من المطورين |

**العدد الإجمالي: 7**

---

## 2. جداول مرشحة للحذف

### UNUSED (لا تُستخدم)

| الجدول | عدد الصفوف (تقريباً) | سبب الحذف |
|--------|---------------------|-----------|
| `expenses` | 0 | لا يُقرأ ولا يُكتب |
| `employee_advances` | 0 | لا يُقرأ ولا يُكتب |
| `credit_contracts` | 0 | سير العمل الائتماني لم يكتمل (هيكل فقط) |
| `credit_contract_templates` | 0 | لا يُستخدم |

### LEGACY (له بديل)

| الجدول | عدد الصفوف (تقريباً) | البديل |
|--------|---------------------|--------|
| `customer_addresses` | 25 (كلها REVIEW_REQUIRED) | `unified_locations` |

**العدد الإجمالي: 5**

---

## 3. أعمدة مرشحة للحذف (حقول Deprecated)

| الجدول | العمود | السبب |
|--------|--------|-------|
| `orders` | `snapshot_sender_name` | لا يُملأ أبداً (قيم null) |
| `orders` | `snapshot_sender_phone` | لا يُملأ أبداً (قيم null) |
| `orders` | `snapshot_sender_address` | لا يُملأ أبداً (قيم null) |
| `orders` | `execution_latitude` | نظام Order GPS غير مطبق (دائماً null) |
| `orders` | `execution_longitude` | نظام Order GPS غير مطبق (دائماً null) |
| `orders` | `execution_accuracy_meters` | نظام Order GPS غير مطبق (دائماً null) |
| `orders` | `execution_captured_at` | نظام Order GPS غير مطبق (دائماً null) |
| `customers` | `email` | أزيل من UI الإنشاء لكن لا يزال في DB |

**ملاحظة:** أعمدة `execution_*` قد تكون مطلوبة مستقبلاً عند تفعيل Order GPS. الانتظار أفضل من الحذف الفوري.

**العدد الإجمالي: 8 أعمدة (3 للحذف الفوري، 5 قيد المراجعة)**

---

## 4. خدمات (Services) مرشحة للحذف أو الدمج

| الخدمة | المسار | سبب الترشيح |
|--------|--------|-------------|
| `deals.ts` | `src/services/deals.ts` | **DUPLICATE** — نفس وظيفة `dailyDeals.ts` (كلاهما يستدعي `get_governed_daily_deals`) |
| `failureLogger.ts` | `src/services/failureLogger.ts` | غير مؤكد الاستخدام — موجود في الكود لكن قد لا يتم استدعاؤه |

**العدد الإجمالي: 2**

---

## 5. صفحات (Pages) مرشحة للحذف

### Workspaces غير القابلة للوصول

| الصفحة | المسار | سبب الترشيح |
|--------|--------|-------------|
| `AdminWorkspace.tsx` | `src/pages/dashboard/AdminWorkspace.tsx` | دور "أدمن" غير ممنوح لأي موظف |
| `SuperAdminWorkspace.tsx` | `src/pages/dashboard/SuperAdminWorkspace.tsx` | دور "سوبر أدمن" غير ممنوح لأي موظف |
| `ChairmanWorkspace.tsx` | `src/pages/dashboard/ChairmanWorkspace.tsx` | دور "رئيس مجلس الإدارة" غير ممنوح لأي موظف |
| `AccountantWorkspace.tsx` | `src/pages/dashboard/AccountantWorkspace.tsx` | دور "محاسب" غير موجود في DB |
| `CollectorWorkspace.tsx` | `src/pages/dashboard/CollectorWorkspace.tsx` | دور "محصل" غير موجود في DB |
| `PurchasingManagerWorkspace.tsx` | `src/pages/dashboard/PurchasingManagerWorkspace.tsx` | دور "مدير مشتريات" غير موجود في DB |
| `SecretaryWorkspace.tsx` | `src/pages/dashboard/SecretaryWorkspace.tsx` | دور "سكرتير" غير موجود في DB |
| `SecurityWorkspace.tsx` | `src/pages/dashboard/SecurityWorkspace.tsx` | دور "أمن" غير موجود في DB |
| `BuffetWorkspace.tsx` | `src/pages/dashboard/BuffetWorkspace.tsx` | دور "بوفيه" غير موجود في DB |
| `DataEntryWorkspace.tsx` | `src/pages/dashboard/DataEntryWorkspace.tsx` | دور "مدخل بيانات" غير موجود في DB |
| `DeliveryWorkspace.tsx` | `src/pages/dashboard/DeliveryWorkspace.tsx` | دور "توصيل" غير موجود في DB |
| `TransportDashboard.tsx` | `src/pages/dashboard/TransportDashboard.tsx` | دور قديم — مستبدل بـ WarehouseDashboard |

### شاشات قديمة

| الصفحة | المسار | سبب الترشيح |
|--------|--------|-------------|
| `WarehouseDashboard.tsx` | `src/pages/dashboard/WarehouseDashboard.tsx` | يُستخدم فقط لرمز WRQ1001 — قديم |

### صفحات مكررة (محتوى مختلف لكن اسم/مسار متشابه)

| الصفحة | المسار | سبب الترشيح |
|--------|--------|-------------|
| `CompaniesPage.tsx` (storefront) | `src/pages/storefront/CompaniesPage.tsx` | اسم يسبب التباساً مع MgmtCompaniesPage |

**العدد الإجمالي للمرشحات للحذف: 12-13 صفحة**  
**العدد الإجمالي للمرشحات لإعادة التسمية: 1**

---

## 6. ملفات أخرى مرشحة للحذف

| الملف | المسار | سبب الترشيح |
|-------|--------|-------------|
| `DynamicSchemaEditor.tsx` | `src/utils/schemaEditor/DynamicSchemaEditor.tsx` | غير مؤكد الاستخدام (مكون editor عام) |
| `public/pwa/manifest.json` | `public/pwa/manifest.json` | **DUPLICATE** — يوجد `manifest.webmanifest` أيضاً |
| ملفات `.txt` في الجذر (4) | `*.txt` | يجب نقلها إلى `docs/archive/notes/` |
| ملفات `.md` في الجذر (4) | `*.md` (باستثناء هذا الملف) | يجب نقلها إلى `docs/` |

---

## 7. كود Hardcoded مرشح للإزالة (من RPCs)

| النمط | مكانه | سبب الإزالة |
|-------|-------|-------------|
| `r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')` | 32+ ملف مهاجرة | يجب استبداله بـ `is_upper_management()` |
| `r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن')` | 20+ ملف مهاجرة | يجب استبداله بـ `is_upper_management()` |
| كود الموظف `'WRQ1001'` في `DashboardPage.tsx:39` | ملف واحد | يجب استبداله بديناميكي |
| كود الموظف `'WRQ1002'`, `'WRQ1004'` في RPCs | ~25 RPC | يجب استبداله بديناميكي |

---

## 8. ملخص الأعداد

| الفئة | مرشح للحذف | مرشح للاستبدال/الدمج | مرشح للنقل |
|-------|-----------|---------------------|-----------|
| RPCs | 7 | 0 | 0 |
| جداول | 5 | 0 | 0 |
| أعمدة | 3 | 5 (قيد المراجعة) | 0 |
| خدمات | 0 | 2 | 0 |
| صفحات (Workspaces) | 12-13 | 0 | 0 |
| صفحات (أخرى) | 0 | 1 (إعادة تسمية) | 0 |
| ملفات | 1 | 1 | 8 |
| نماذج كود Hardcoded (في RPCs) | 0 | 4 أنماط | 0 |
| تخطي Governance (في Frontend) | 0 | 2 موقع | 0 |
| **الإجمالي التقريبي** | **28-29 عنصراً** | **14-16 عنصراً** | **8 عناصر** |

---

## 9. تخطي Governance في الكود الأمامي (Frontend)

هذه المواقع تستدعي `supabase.from()` مباشرة بدلاً من RPCs — خطر أمني لأن RLS غير مفعل:

| الموقع | المسار | الاستدعاء | الإصلاح المقترح |
|--------|--------|-----------|----------------|
| AccountPage.tsx | `src/pages/account/AccountPage.tsx:156` | `supabase.from('customer_addresses').select('*')` | استخدام `get_governed_customer_addresses` |
| CompanyManagerPage.tsx | `src/pages/companies/CompanyManagerPage.tsx:72` | `supabase.from('companies').select('*')` | استخدام `get_governed_companies` أو `get_company_profile` |

**العدد: 2 موقع**

---

## 10. تحذير هام

**لا تحذف أي شيء قبل:**

1. تأكيد عدم الاستخدام من قاعدة البيانات الحية (وليس فقط من تحليل الكود)
2. الحصول على موافقة على كل عنصر على حدة
3. إنشاء مهاجرة (migration) منفصلة لكل حذف
4. اختبار أن الحذف لا يؤثر على أي وظيفة حالية
5. توثيق كل حذف في FIX HISTORY
