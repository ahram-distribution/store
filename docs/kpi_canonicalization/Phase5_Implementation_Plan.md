# Phase 5 — Implementation Plan: Activity Screen Unification

**المرجع:** Canonical_System_Spec.md v1.0  
**الهدف:** تحويل شاشة `/dashboard/activity-target` إلى التنفيذ الفعلي للـ Canonical System Spec  
**الحالة:** 📋 خطة — لم يبدأ التنفيذ بعد

---

## 1. تحليل الشاشة الحالية: `PerformancePage` (4 Tabs)

```
PerformancePage.tsx
  ├── [Tab 1] ActivityScreen.tsx          ← نشاط (Created KPIs)
  ├── [Tab 2] HierarchyTargetPage.tsx     ← إنجاز (Achievement % + Targets)
  ├── [Tab 3] TargetsTab.tsx              ← تارجت (إدارة الأهداف)
  └── [Tab 4] WeightsTab.tsx              ← أوزان (إدارة الأوزان)
```

---

## 2. تحليل Tab 1: ActivityScreen

### الـ RPCs المستخدمة

| RPC | أين تُستدعى | خارج Source Control؟ |
|-----|-----------|---------------------|
| `get_runtime_activity(p_employee_id, p_date_from, p_date_to)` | سطر 82, 101, 128 | ✅ غير موجود في أي ملف SQL |
| `get_runtime_team_activity(p_manager_employee_id, p_date_from, p_date_to)` | سطر 89, 100 | ✅ غير موجود في أي ملف SQL |

### الـ KPIs التي تُقرأ من الـ RPCs

| KPI | الحقل في RPC | هل يطابق Canonical Spec؟ |
|-----|-------------|------------------------|
| Created Orders | `created_orders` | ✅ يطابق — `COUNT orders WHERE status NOT IN ('draft','cancelled') AND submitted_at` |
| Created Sales | `created_sales` | ✅ يطابق — `SUM total_amount WHERE status NOT IN ('draft','cancelled') AND submitted_at` |
| Completed Visits | `completed_visits` | ✅ يطابق — `COUNT visits WHERE status='completed' AND check_out_at` |
| Registered Customers | `registered_customers` | ✅ يطابق — `COUNT customers WHERE created_at` |

### ملاحظات هامة

| البند | الحالة |
|-------|--------|
| Session validation | لا يحتاج p_token (Ungoverned) → متاح بدون جلسة ✅ |
| Inactive employee filter | غير معروف — يعتمد على تنفيذ RPC الفعلي في الإنتاج. إذا كان يفلتر بـ `e.is_active = true` فهناك مشكلة ❓ |
| Client-side sum | السطر 139-149: `companyTotals` تُحسب يدويًا بجمع أعضاء الفريق → قد لا يطابق company totals الحقيقي إذا كان هناك موظفون غير نشطين أو owner_ids بدون employee |
| KPI completeness | لا يحتوي `registered_customers` — هل هذا صحيح؟ نعم، Registered != New (First Delivered) ✅ |
| Missing KPIs (Collections, Attendance, Distance, etc.) | غير مطلوب في هذه الشاشة (نشاط فقط) ✅ |

### الحكم: Tab 1

| البند | القرار |
|-------|--------|
| KPI logic | ✅ صحيحة وكاملة حسب Canonical Spec |
| RPC location | ❌ غير معرّفة في Source Control → يجب استخراجها وإعادة تعريفها أو استبدالها بـ canonical RPC |
| Data source | يجب أن يبقى `get_runtime_activity` أو يُستبدل بـ canonical equivalent |
| **خطورة التغيير** | 🔴 **عالية** — 4 شاشات أخرى تعتمد على هذين الـ RPC |

---

## 3. تحليل Tab 2: HierarchyTargetPage

### الـ RPC المستخدم

| RPC | أين تُستدعى | خارج Source Control؟ |
|-----|-----------|---------------------|
| `get_governed_target_performance(p_token, p_month, p_year)` | عبر `targetService.getPerformance()` | ❌ موجود في Source Control (Phase 4) |

### الـ KPIs التي تُقرأ

| KPI | المصدر | هل يطابق Canonical Spec؟ |
|-----|--------|------------------------|
| Company Target | `company.sales_target` | ✅ |
| Company Actual (Sales) | `company.sales_actual` | ✅ |
| Company Achievement % | `company.overall_achievement_pct` | ✅ |
| Employee KPIs | `m.kpis.sales {target, actual, pct}` | ✅ |
| Employee Overall Score | `m.overall_achievement_score` | ✅ |
| Manager Summary | `mgr.team_summary {team_target, team_actual, team_overall_pct}` | ✅ |
| Manager Own KPIs | `mgr.own_kpis {sales, visits, orders, new_customers, collections, attendance}` | ✅ |
| Weights | `m.weights` | ✅ |

### ملاحظات هامة

| البند | الحالة |
|-------|--------|
| Session token (`p_token`) | **مطلوب** → الشاشة لا تعمل بدون جلسة صالحة ❌ |
| Inactive employee filter | `get_governed_target_performance` يستخدم `WHERE e.is_active = true` → يستبعد بدر عامر وفريقه بالكامل من الهيكل ❌ |
| Weights source | الـ RPC يقرأ من `performance_weights_config` (حسب السنة) ← بينما WeightsTab يكتب في `company_monthly_targets` → **مصدران غير متطابقين** ❌ |
| Collections / Attendance weights = 0 | لا مشكلة — القيمة 0 تعني تجاهل ✅ |

### الحكم: Tab 2

| البند | القرار |
|-------|--------|
| RPC is correct | ✅ `get_governed_target_performance` هو الـ Canonical Engine |
| Session token | 🔴 يحتاج إصلاح — إما بإزالة الشرط من RPC أو توفير token تلقائي |
| Inactive employee | 🔴 يحتاج تعديل شرط `is_active` ليشمل الموظفين الذين كانوا نشطين في فترة التقرير |
| **خطورة التغيير** | 🟡 **متوسطة** — الـ RPC نفسه صحيح لكن يحتاج تعديلين محدّدين |

---

## 4. تحليل Tab 3: TargetsTab

### الـ RPCs المستخدمة

| RPC | الاستخدام |
|-----|-----------|
| `get_governed_active_employees(p_token)` | قراءة قائمة الموظفين النشطين |
| `get_governed_company_monthly_target(p_token, p_month, p_year)` | قراءة هدف الشركة |
| `get_governed_employee_monthly_targets(p_token, p_month, p_year)` | قراءة أهداف الموظفين |
| `governed_upsert_company_monthly_target(...)` | كتابة هدف الشركة |
| `governed_upsert_employee_monthly_target(...)` | كتابة هدف الموظف |

### ملاحظات هامة

| البند | الحالة |
|-------|--------|
| All RPCs in source control | ✅ جميعها موجودة في Phase 4 |
| Session token | ✅ مطلوب — وهو صحيح لأن هذه شاشة إدارة |
| Inactive employee | `get_governed_active_employees` يستخدم `is_active = true` → غير النشطين لا يظهرون في قائمة التعديل ✅ هذا صحيح |
| Tab هو أداة إدارة | ✅ يقرأ ويكتب — غير معني بـ Achievement % |
| **خطورة التغيير** | 🟢 **منخفضة** — لا يحتاج تغييراً في هذا Phase |

### الحكم: Tab 3

لا تغيير مطلوب. ✅

---

## 5. تحليل Tab 4: WeightsTab

### الـ RPC المستخدم

| RPC | الاستخدام |
|-----|-----------|
| `get_governed_company_monthly_target(p_token, p_month, p_year)` | قراءة الأوزان من `company_monthly_targets` |
| `governed_upsert_company_monthly_target(...)` | كتابة الأوزان إلى `company_monthly_targets` |

### مشكلة حرجة: مصدر الأوزان

| المصدر | أين يُقرأ | أين يُكتب |
|--------|---------|-----------|
| `company_monthly_targets.weights` | WeightsTab ✅ | WeightsTab ✅ |
| `performance_weights_config` (حسب السنة) | `get_governed_target_performance` | لا يُكتب أبدًا — فقط يُقرأ بواسطة Canonical Engine |

**النتيجة:** المستخدم يعدّل الأوزان في WeightsTab، لكن هذه التعديلات **لا تؤثر في `get_governed_target_performance`** (Canonical Engine) لأنه يقرأ من `performance_weights_config`.

**هذه مشكلة تكامل — الأوزان التي يراها المستخدم ≠ الأوزان التي يستخدمها النظام لحساب الأداء.**

| البند | الحالة |
|-------|--------|
| RPC in source control | ✅ موجود |
| Session token | ✅ مطلوب (وهو صحيح) |
| Weights source mismatch | ❌ **خلل جوهري** — ما يُكتب لا يُقرأ وما يُقرأ لا يُكتب |
| **خطورة التغيير** | 🔴 **حرجة** — يحتاج توحيد المصدر أولاً قبل أي شيء آخر |

### الحكم: Tab 4

**يحتاج إصلاح قبل بدء Phase 5** — توحيد مصدر الأوزان بين التخزين والحساب.

---

## 6. جدول KPI الكامل

| KPI | Tab | المصدر الحالي | المصدر المعتمد (Canonical) | يطابق؟ | يحتاج تعديل | درجة الخطورة |
|-----|-----|-------------|---------------------------|--------|-----------|-------------|
| Created Orders | 1 | `get_runtime_activity` | `get_runtime_activity` (or Canonical Engine) | ✅ | لا — المصدر صحيح، لكن يحتاج استخراج SQL إلى source control | 🟢 |
| Created Sales | 1 | `get_runtime_activity` | `get_runtime_activity` | ✅ | لا — نفس المصدر | 🟢 |
| Completed Visits | 1 | `get_runtime_activity` | `get_runtime_activity` | ✅ | لا — نفس المصدر | 🟢 |
| Registered Customers | 1 | `get_runtime_activity` | `get_runtime_activity` | ✅ | لا — نفس المصدر | 🟢 |
| Company Target (Sales) | 2, 3 | `get_governed_target_performance` | `company_monthly_targets` | ✅ | لا — مقروء من الجدول الصحيح | 🟢 |
| Company Achievement % | 2 | `get_governed_target_performance` | Canonical Engine | ✅ | لا — المحرك نفسه | 🟢 |
| Employee Target (per KPI) | 2, 3 | `get_governed_target_performance` | `employee_monthly_targets` | ✅ | لا — مقروء من الجدول الصحيح | 🟢 |
| Employee Achievement % | 2 | `get_governed_target_performance` | Canonical Engine | ✅ | لا | 🟢 |
| Employee Overall Score | 2 | `get_governed_target_performance` | Canonical Engine | ✅ | لا | 🟢 |
| Manager Team Summary | 2 | `get_governed_target_performance` | Canonical Engine | ✅ | لا | 🟢 |
| Weights | 4 | `company_monthly_targets` | `performance_weights_config` | ❌ | **خلل جوهري — مصدران غير متطابقين** | 🔴 |
| Delivered Sales | 2 | `get_governed_target_performance` | Canonical Engine | ✅ | لا | 🟢 |
| Delivered Orders | 2 | `get_governed_target_performance` | Canonical Engine | ✅ | لا | 🟢 |
| New Customers (First Delivered) | 2 | `get_governed_target_performance` | Canonical Engine | ✅ | لا | 🟢 |
| Collections | 2 | `get_governed_target_performance` | Canonical Engine | ✅ | لا (weight = 0) | 🟢 |
| Attendance | 2 | `get_governed_target_performance` | Canonical Engine | ✅ | لا (weight = 0) | 🟢 |

---

## 7. جميع الـ RPCs التي تستدعيها الشاشة حاليًا

| RPC | Tab(s) | الحالة |
|-----|--------|--------|
| `get_runtime_activity` | 1 | ❌ خارج Source Control — يُستخرج أو يُستبدل |
| `get_runtime_team_activity` | 1 | ❌ خارج Source Control — يُستخرج أو يُستبدل |
| `get_governed_target_performance` | 2 | ✅ موجود — لكن يحتاج تعديلين (inactive employee, session token) |
| `get_governed_active_employees` | 3 | ✅ موجود — لا تغيير |
| `get_governed_company_monthly_target` | 3, 4 | ✅ موجود — لكن Tab 4 يقرأ الأوزان من هنا والمحرك يقرأ من جدول آخر |
| `get_governed_employee_monthly_targets` | 3 | ✅ موجود — لا تغيير |
| `governed_upsert_company_monthly_target` | 3, 4 | ✅ موجود — لكنه يكتب في `company_monthly_targets` والأوزان يجب أن تذهب إلى `performance_weights_config` |
| `governed_upsert_employee_monthly_target` | 3 | ✅ موجود — لا تغيير |

---

## 8. ما سيبقى كما هو

| المكوّن | السبب |
|---------|-------|
| `HierarchyTargetPage.tsx` (Tab 2) | يستخدم بالفعل الـ Canonical Engine الصحيح — يحتاج فقط تعديل RPC السفلي |
| `TargetsTab.tsx` (Tab 3) | أداة إدارة — لا تحتاج تغييراً في هذه المرحلة |
| `get_governed_active_employees` | يعمل بشكل صحيح |
| `get_governed_company_monthly_target` | يعمل بشكل صحيح للقراءة (ما عدا weights في Tab 4) |
| `get_governed_employee_monthly_targets` | يعمل بشكل صحيح |
| `governed_upsert_employee_monthly_target` | يعمل بشكل صحيح |
| `KPI_LABELS` في ActivityScreen | التعريفات صحيحة |
| جميع TypeScript types في TargetRuntimePage | سليمة |

---

## 9. ما سيتم استبداله

| المكوّن الحالي | البديل | السبب |
|---------------|--------|-------|
| `get_runtime_activity` | **استخراج SQL إلى migration file** + توحيده مع Canonical KPI Engine | خارج Source Control — لا يمكن تتبعه أو مراجعته |
| `get_runtime_team_activity` | **استخراج SQL إلى migration file** + توحيده مع Canonical KPI Engine | خارج Source Control |
| `get_governed_target_performance` | تعديل: إزالة شرط `WHERE e.is_active = true` الصارم — استبداله بـ `is_active = true OR EXISTS activity IN period` | سياسة الموظف غير النشط الجديدة |
| `get_governed_target_performance` | تعديل: جعل `p_token` اختياريًا (DEFAULT NULL) — إذا NULL تخطى التحقق | تمكين الشاشات من العمل بدون جلسة |
| `governed_upsert_company_monthly_target` | تعديل: كتابة الأوزان إلى `performance_weights_config` بدلاً من `company_monthly_targets` | توحيد مصدر الأوزان |
| `WeightsTab.tsx` | تعديل: القراءة من `performance_weights_config` بدلاً من `company_monthly_targets` | توحيد مصدر الأوزان |
| `companyTotals` في ActivityScreen (client-side sum) | استبدال بـ RPC يجلب company totals مباشرة | دقة الأرقام — عدم الاعتماد على جمع client-side |

---

## 10. التأثير على الشاشات الأخرى

### 10.1 SalesRepActivity.tsx

| البند | الحالة |
|-------|--------|
| يستخدم `get_runtime_activity` | ✅ نفس RPC الذي يستخدمه Tab 1 |
| سيتأثر بالتغيير؟ | ✅ نعم — إذا غيّرنا Tab 1، يجب تحديث هذا أيضًا |
| الحل | استخدام نفس الـ RPC الموحّد |
| **خطورة** | 🟡 **متوسطة** — RPC واحد مشترك |

### 10.2 SalesRepAchievement.tsx

| البند | الحالة |
|-------|--------|
| يستخدم `get_runtime_achievement` | ❌ خارج Source Control |
| سيتأثر بالتغيير؟ | 🟡 ليس مباشرة — ليس جزءًا من Tab 1 أو 2 |
| الحل | استخراج SQL أو استبداله بـ `get_governed_target_performance` (الذي يحتوي نفس البيانات مع الهيكل الهرمي) |
| **خطورة** | 🟡 **متوسطة** — يحتاج خطة منفصلة بعد Phase 5 |

### 10.3 TeamAchievement.tsx

| البند | الحالة |
|-------|--------|
| يستخدم `get_runtime_team` | ❌ خارج Source Control |
| يستخدم `get_runtime_achievement` | ❌ خارج Source Control |
| سيتأثر بالتغيير؟ | 🟡 ليس مباشرة — ليس جزءًا من Tab 1 أو 2 |
| الحل | استبدال بـ `get_governed_target_performance` (والذي يعيد نفس البنية الهرمية) |
| **خطورة** | 🟡 **متوسطة** — بعد Phase 5 |

### 10.4 UpperManagementDashboard.tsx

| البند | الحالة |
|-------|--------|
| يستخدم `get_runtime_team_activity` | ❌ خارج Source Control (يحتاج نشاط الشركة) |
| يستخدم `get_governed_target_performance` | ✅ (يحتاج نسبة الإنجاز) |
| يستخدم `get_dashboard_management` | ✅ موجود — لا تغيير |
| سيتأثر بالتغيير؟ | ✅ نعم — إذا غيّرنا Tab 1، هذا يستخدم نفس RPC |
| الحل | استخدام نفس الـ RPC الموحّد لـ `get_runtime_team_activity` |
| **خطورة** | 🟡 **متوسطة** — RPC واحد مشترك مع Tab 1 |

### 10.5 Attendance

| البند | الحالة |
|-------|--------|
| يستخدم `get_daily_target_vs_actual` | ✅ موجود + `get_completed_workdays_history` ✅ موجود |
| سيتأثر بالتغيير؟ | ❌ لا — لا يشارك أي RPC مع Tab 1 أو 2 |
| **خطورة** | 🟢 **منعدمة** |

---

## 11. تقدير المخاطر

| الرقم | الخطر | المستوى | الخطة |
|-------|-------|---------|-------|
| R1 | استخراج `get_runtime_activity` SQL من الإنتاج قد يعطي تعريفًا مختلفًا عما نتوقع (لأن لا أحد راجعه) | 🔴 عالي | قبل الاستخراج، كتابة التعريف المتوقع بناءً على الـ Canonical Spec، ثم مقارنته مع ما في الإنتاج |
| R2 | تعديل `get_governed_target_performance` (inactive employee + session token) قد يؤثر على الشاشات الأخرى التي تستدعيه | 🟡 متوسط | إضافة parameter جديد `p_bypass_session_check` بدلاً من تغيير السلوك الافتراضي — الشاشات الحالية تستمر كما هي |
| R3 | توحيد مصدر الأوزان قد يسبب اختلافًا في حسابات الأداء الحالية | 🔴 عالي | عمل مقارنة قبل/بعد للتأكد من أن الأرقام متطابقة |
| R4 | عدم وجود اختبارات (tests) قد يؤدي إلى كسر الشاشات | 🟡 متوسط | بعد التنفيذ، التأكد يدويًا من كل RPC في 4 سيناريوهات: company, manager, team, rep |
| R5 | تغيير `companyTotals` من client-side sum إلى RPC مباشر قد يُظهر أرقامًا مختلفة | 🟡 متوسط | توثيق الفرق المتوقع (موظف غير نشط → رقم الشركة > مجموع الموظفين النشطين) |

---

## 12. ترتيب التنفيذ المقترح

```
[Phase 0] إصلاح مصدر الأوزان
    ├── تعديل `governed_upsert_company_monthly_target` → يكتب الأوزان في `performance_weights_config`
    ├── تعديل `WeightsTab.tsx` → يقرأ من `performance_weights_config`
    └── تأكيد: WeightsTab والـ Canonical Engine يستخدمان نفس الجدول

[Phase 1] استخراج RPCs خارج Source Control
    ├── استخراج `get_runtime_activity` من الإنتاج → إنشاء migration file
    ├── استخراج `get_runtime_team_activity` من الإنتاج → إنشاء migration file
    ├── استخراج `get_runtime_achievement` من الإنتاج → إنشاء migration file
    └── استخراج `get_runtime_team` من الإنتاج → إنشاء migration file

[Phase 2] تعديل Canonical Engine
    ├── تعديل `get_governed_target_performance`: inactive employee policy
    ├── تعديل `get_governed_target_performance`: p_token DEFAULT NULL
    └── اختبار: استدعاء RPC بدون token → يجب أن يعمل

[Phase 3] توحيد Tab 1 (ActivityScreen)
    ├── جعل ActivityScreen يستخدم canonical RPC الموحّد
    ├── استبدال client-side companyTotals بـ RPC مباشر
    └── اختبار: 4 مستويات عرض (company, managers, team, rep)

[Phase 4] توحيد Tab 2 (HierarchyTargetPage)
    ├── تعديل targetService.getPerformance() ليعمل بدون token
    └── اختبار: 4 مستويات عرض مع وبدون جلسة

[Phase 5] تحديث الشاشات المتأثرة
    ├── UpperManagementDashboard → استخدام canonical RPC الموحّد
    ├── SalesRepActivity → استخدام canonical RPC الموحّد
    └── مراجعة SalesRepAchievement + TeamAchievement → خطة Phase 6

[Phase 6] توحيد SalesRepAchievement + TeamAchievement (مستقبل)
    ├── استبدال `get_runtime_achievement` بـ canonical RPC
    └── استبدال `get_runtime_team` بـ canonical RPC
```

---

## 13. الخلاصة

| البند | القرار |
|-------|--------|
| هل Tab 1 (Activity) جاهز للتغيير؟ | ✅ نعم — KPI logic صحيحة، RPCs فقط تحتاج استخراج + توحيد |
| هل Tab 2 (Achievement) جاهز للتغيير؟ | 🟡 بعد تعديل RPC — تعديلين محدّدين + إصلاح inactive employee |
| هل Tab 3 (Targets) جاهز؟ | ✅ نعم — لا تغيير مطلوب |
| هل Tab 4 (Weights) جاهز؟ | ❌ لا — **يحتاج إصلاح مصدر الأوزان أولاً** |
| هل هناك خلل جوهري؟ | ✅ نعم — **الأوزان تُكتب في جدول وتُقرأ من جدول آخر** |
| هل نحتاج استخراج RPCs من الإنتاج؟ | ✅ نعم — 4 RPCs خارج Source Control |
| هل هناك خطر على الشاشات الأخرى؟ | 🟡 متوسط — 3 شاشات أخرى تتأثر بـ `get_runtime_activity` و `get_runtime_team_activity` |
| هل يجب تنفيذ Phase 0 (إصلاح الأوزان) قبل البدء؟ | ✅ **نعم — هو pre-requisite لـ Phase 5** |

---

**التوصية:**  
ابدأ بـ **Phase 0 (إصلاح مصدر الأوزان)** لأنه شرط أساسي لكل ما يليه.  
بعد اعتمادك، نبدأ في التنفيذ الفعلي.
