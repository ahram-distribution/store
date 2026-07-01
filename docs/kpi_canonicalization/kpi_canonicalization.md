# Phase 3 — KPI Canonicalization

**الهدف:** اعتماد تعريف واحد (Canonical Definition) لكل KPI في النظام، بحيث لا يُحسب أي KPI داخل أي شاشة — كل شاشة تقرأ KPI جاهزًا من المصدر المعتمد.

**القاعدة:** لا تعديل كود. مرحلة تصميم واعتماد فقط.

---

## 1. جدول تعريفات KPI الكامل

### 1.1 Orders

| KPI | التعريف الحالي (1) | التعريف الحالي (2) | هل توجد أكثر من صيغة؟ | التعريف المقترح (Canonical) | سيصبح مصدر الحقيقة |
|-----|-------------------|-------------------|----------------------|---------------------------|-------------------|
| **Created Orders** | `get_completed_workdays_history`: COUNT orders WHERE `status NOT IN ('draft','cancelled')` AND `submitted_at::date` = session date, grouped by `created_by` (identity_id) | `get_runtime_activity` (غير معروف — خارج Source Control) | ⚠️ نعم — الصيغة 1 معروفة، الصيغة 2 غير معروفة حتى استخراج تعريف runtime | COUNT orders WHERE `status NOT IN ('draft','cancelled')` AND `submitted_at` IN الفترة, `created_by` → `identity_id` | **Canonical KPI Engine** (RPC جديد أو دالة مساعدة) |
| **Delivered Orders** | `get_governed_target_performance`: COUNT orders WHERE `status='delivered'` AND `delivered_at` IN الفترة | — | ✅ لا — تعريف واحد فقط | COUNT orders WHERE `status='delivered'` AND `delivered_at` IN الفترة | **Canonical KPI Engine** |
| **Effective Orders** | `get_governed_target_performance`: `GREATEST(DeliveredOrders - FullReturns, 0)` | — | ✅ لا — تعريف واحد فقط | `GREATEST(DeliveredOrders - FullReturns, 0)` | **Canonical KPI Engine** |

### 1.2 Sales

| KPI | التعريف الحالي (1) | التعريف الحالي (2) | هل توجد أكثر من صيغة؟ | التعريف المقترح (Canonical) | سيصبح مصدر الحقيقة |
|-----|-------------------|-------------------|----------------------|---------------------------|-------------------|
| **Created Sales** | `get_completed_workdays_history`: SUM `total_amount` WHERE `status NOT IN ('draft','cancelled')` AND `submitted_at::date` = session date, `created_by` → identity_id | `get_runtime_activity` (غير معروف) | ⚠️ نعم | SUM `total_amount` WHERE `status NOT IN ('draft','cancelled')` AND `submitted_at` IN الفترة | **Canonical KPI Engine** |
| **Delivered Sales** | `get_governed_target_performance`: SUM `total_amount` WHERE `status='delivered'` AND `delivered_at` IN الفترة, JOIN employees على `owner_id` | — | ✅ لا — تعريف واحد | SUM `total_amount` WHERE `status='delivered'` AND `delivered_at` IN الفترة | **Canonical KPI Engine** |
| **Effective Sales** | `get_governed_target_performance`: `GREATEST(DeliveredSales - ReturnDeductions, 0)` | — | ✅ لا — تعريف واحد | `GREATEST(DeliveredSales - ReturnDeductions, 0)` | **Canonical KPI Engine** |

### 1.3 Visits

| KPI | التعريف الحالي (1) | التعريف الحالي (2) | هل توجد أكثر من صيغة؟ | التعريف المقترح (Canonical) | سيصبح مصدر الحقيقة |
|-----|-------------------|-------------------|----------------------|---------------------------|-------------------|
| **Visits** | `get_governed_target_performance`: COUNT visits WHERE `status='completed'` AND `check_out_at` IN الفترة, `employee_id` | `get_completed_workdays_history`: `visit_count` من جدول `workday_sessions` (قيمة مُخزَّنة تُحدَّث عند check-in/out) | ⚠️ نعم — الأولى تحسب مباشرة من جدول `visits`، الثانية تقرأ قيمة مُخزَّنة | COUNT visits WHERE `status='completed'` AND `check_out_at` IN الفترة | **Canonical KPI Engine** (لا تعتمد على القيمة المخزنة) |

### 1.4 Customers

| KPI | التعريف الحالي (1) | التعريف الحالي (2) | هل توجد أكثر من صيغة؟ | التعريف المقترح (Canonical) | سيصبح مصدر الحقيقة |
|-----|-------------------|-------------------|----------------------|---------------------------|-------------------|
| **Registered Customers** | `get_runtime_activity` (غير معروف — يُفترض COUNT customers WHERE `created_at` IN الفترة) | — | ❓ غير معروف حتى استخراج تعريف runtime | COUNT customers WHERE `created_at` IN الفترة | **Canonical KPI Engine** (KPI منفصل عن New Customers) |
| **New Customers (First Delivered)** | `get_governed_target_performance`: COUNT DISTINCT customers WHERE `MIN(delivered_at)` لكل customer يقع في الفترة | `get_completed_workdays_history`: COUNT customers WHERE `created_at::date` = session date, `owner_id` | ⚠️ نعم — الأولى تستخدم First Delivery، الثانية تستخدم Creation Date | COUNT DISTINCT customers WHERE `MIN(delivered_at)` للـ customer يقع في الفترة (First Delivery) | **Canonical KPI Engine** |

**ملاحظة:** `Registered Customers` و `New Customers (First Delivered)` هما KPI مختلفان — الأول يقيس إنشاء العملاء، الثاني يقيس أول عملية بيع. يجب الاحتفاظ بهما كـ KPI منفصلين.

### 1.5 Collections

| KPI | التعريف الحالي (1) | التعريف الحالي (2) | هل توجد أكثر من صيغة؟ | التعريف المقترح (Canonical) | سيصبح مصدر الحقيقة |
|-----|-------------------|-------------------|----------------------|---------------------------|-------------------|
| **Collections Count** | `get_completed_workdays_history`: COUNT collections (كل الحالات) WHERE `collected_at::date` = session date, `created_by` → identity_id | `get_runtime_activity` (غير معروف) | ⚠️ نعم — الصيغة 2 غير معروفة | COUNT collections WHERE `created_at` IN الفترة (كل الحالات) | **Canonical KPI Engine** |
| **Collections Amount** | `get_governed_target_performance`: SUM `amount` (كل الحالات) WHERE `created_at` IN الفترة, `resolve_employee_id(owner_id)` | `get_completed_workdays_history`: SUM `amount` WHERE `status='collected'` فقط | ⚠️ نعم — `get_governed_target_performance` لا يفلتر بالحالة، `get_completed_workdays_history` يفلتر بـ `status='collected'` فقط | SUM `amount` WHERE `status='collected'` AND `collected_at` IN الفترة **أو** SUM `amount` (كل الحالات) — **يحتاج قرار عمل** | **Canonical KPI Engine** (بعد قرار: collected-only أو all-statuses) |

### 1.6 Attendance

| KPI | التعريف الحالي (1) | التعريف الحالي (2) | هل توجد أكثر من صيغة؟ | التعريف المقترح (Canonical) | سيصبح مصدر الحقيقة |
|-----|-------------------|-------------------|----------------------|---------------------------|-------------------|
| **Active Days** | `get_completed_workdays_history`: COUNT completed `workday_sessions` WHERE `date` IN الفترة | `get_sales_reps_effort`: COUNT DISTINCT dates مع sessions | ✅ لا — تعريف واحد (عدّ sessions المكتملة) | COUNT DISTINCT `date` WHERE `status='completed'` | **Canonical KPI Engine** |
| **Working Hours (Net Minutes)** | `get_completed_workdays_history`: Schedule-aware — `fixed_shift` → `GREATEST(duration - break_minutes, 0)`، `flexible` → `GREATEST(duration, 0)` | `get_sales_reps_effort`: نفس الصيغة | ✅ لا — تعريف واحد (نفس الصيغة في RPCs المتعددة) | `GREATEST(EPOCH(end-start)/60 - CASE fixed_shift THEN break_minutes ELSE 0 END, 0)` | **Canonical KPI Engine** |
| **Distance** | `get_employee_day_map`: Haversine + 3 drift filters (anchor-based، يُحسب مباشرة من tracking_points) | `get_completed_workdays_history`: يقرأ `total_distance_meters` من `workday_sessions` (قيمة مُخزَّنة) | ⚠️ نعم — الأولى تحسب مباشرة، الثانية تقرأ قيمة مُخزَّنة (قد تكون 0 إذا لم يُطبَّق fix) | Haversine + 3 drift filters (نفس خوارزمية `calculate_session_distance`) | **Canonical KPI Engine** (دالة مساعدة واحدة `calculate_session_distance`) |
| **Tracking Points** | `get_completed_workdays_history`: COUNT `tracking_points` WHERE `session_id` | `get_employee_day_map`: COUNT نقاط المسار لكل يوم | ✅ لا — تعريف واحد | COUNT `tracking_points` WHERE `session_id` IN الفترة | **Canonical KPI Engine** |

### 1.7 Achievement

| KPI | التعريف الحالي (1) | التعريف الحالي (2) | هل توجد أكثر من صيغة؟ | التعريف المقترح (Canonical) | سيصبح مصدر الحقيقة |
|-----|-------------------|-------------------|----------------------|---------------------------|-------------------|
| **Achievement % (per KPI)** | `get_governed_target_performance`: `LEAST(actual / target * 100, 100)` لكل KPI | `get_runtime_achievement` (غير معروف) | ⚠️ نعم — canonical معروف، runtime غير معروف | `LEAST(actual / NULLIF(target,0) * 100, 100)` | **Canonical KPI Engine** |
| **Overall Score** | `get_governed_target_performance`: `Σ(KPI_pct * weight / 100)` بأوزان فردية من `get_effective_weights()` | `get_runtime_achievement_with_targets` (غير معروف) | ⚠️ نعم — canonical معروف، runtime غير معروف | `Σ(KPI_pct * weight / 100)` بأوزان فردية لكل موظف | **Canonical KPI Engine** |

### 1.8 Targets

| KPI | التعريف الحالي (1) | التعريف الحالي (2) | هل توجد أكثر من صيغة؟ | التعريف المقترح (Canonical) | سيصبح مصدر الحقيقة |
|-----|-------------------|-------------------|----------------------|---------------------------|-------------------|
| **Company Target** | `company_monthly_targets` (مصدر واحد لكل شهر/سنة) | — | ✅ لا | `company_monthly_targets` | **جدول `company_monthly_targets`** |
| **Employee Target** | `employee_monthly_targets` (لكل موظف) — مع توزيع نسبي للأطر الزمنية الممتدة | — | ✅ لا | `employee_monthly_targets` | **جدول `employee_monthly_targets`** |
| **Effective Weights** | `get_effective_weights()` — من `employee_monthly_targets` + `performance_weights_config` | — | ✅ لا | `get_effective_weights()` | **دالة `get_effective_weights`** (أو جدول `performance_weights_config`) |

---

## 2. Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                        RAW TABLES                           │
│  orders  │  order_items  │  returns  │  return_items        │
│  visits  │  customers    │  collections                     │
│  employees  │  workday_sessions  │  workday_breaks          │
│  tracking_points  │  employee_work_policies                │
│  company_monthly_targets  │  employee_monthly_targets       │
│  performance_weights_config                                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│               CANONICAL KPI ENGINE                           │
│                                                              │
│  get_governed_target_performance  (الرئيسي)                  │
│    → Effective Sales, Effective Orders                       │
│    → Completed Visits, New Customers (First Delivered)       │
│    → Collections Amount, Achievement %, Overall Score        │
│    → Targets (Company + Employee), Hierarchy                 │
│                                                              │
│  get_completed_workdays_history  (تاريخي/تفصيلي)             │
│    → Created Orders, Created Sales                           │
│    → Visits (من workday_sessions), New Customers (من created_at)│
│    → Working Hours, Active Days, Distance, Tracking Points   │
│    → Collections Count, Collections Amount                   │
│                                                              │
│  get_employee_day_map  (GPS تفصيلي)                          │
│    → Distance (Haversine مباشر), Route, Stops, Visit Locations│
│                                                              │
│  get_dashboard_management  (لوحة الإدارة)                    │
│    → KPIs مختصرة للإدارة                                     │
│                                                              │
│  get_sales_reps_effort  (جهد المندوبين)                      │
│    → Orders, Sales, Visits, Working Hours, Active Days       │
│                                                              │
│  get_live_workday_overview  (نظرة حية)                       │
│    → اليومي: Orders, Sales, Visits, Collections, Hours       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                  RUNTIME ACTIVITY (خارج Source Control)      │
│                                                              │
│  get_runtime_activity  (نشاط الموظف الفردي)                  │
│  get_runtime_team_activity  (نشاط الفريق)                    │
│    → Sales, Orders, Completed Visits, Registered Customers   │
│    → يعيد قيمًا جاهزة (لا يحسب داخل الشاشة)                  │
│                                                              │
│  ** ملاحظة: هذه الـ RPCs تحتاج استخراج تعريفاتها            │
│     وتوحيدها مع Canonical KPI Engine **                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│              RUNTIME ACHIEVEMENT (خارج Source Control)       │
│                                                              │
│  get_runtime_achievement  (إنجاز الموظف)                     │
│  get_runtime_achievement_with_targets  (إنجاز + أهداف)       │
│  get_runtime_team  (إنجاز الفريق)                            │
│    → Achievement %, Overall Score, Targets                   │
│    → يعيد قيمًا جاهزة (لا يحسب داخل الشاشة)                  │
│                                                              │
│  ** ملاحظة: هذه الـ RPCs تحتاج استخراج تعريفاتها            │
│     وتوحيدها مع Canonical KPI Engine **                      │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                      RPC REPORTS                             │
│                                                              │
│  get_dashboard_sales  →  ملخص المبيعات (لوحة المبيعات)       │
│  get_kpi_contributors →  مساهمو KPI                          │
│  get_team_members_kpis → KPI أعضاء الفريق                    │
│  get_rep_customer_kpis → KPI عملاء المندوب                   │
│  get_customer_delivered_orders →  طلبات العميل المُسلَّمة     │
│  governed_* CRUD →  عمليات CRUD محكومة بالصلاحيات            │
│                                                              │
│  كل هذه الـ RPCs تقرأ من جداول + دالات Canonical مباشرة       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    DASHBOARDS (تقرأ فقط)                     │
│                                                              │
│  UpperManagementDashboard → runtime_team_activity + canonical│
│  ManagementDashboard     → dashboard_management              │
│  SalesDashboard          → dashboard_sales                   │
│  TransportDashboard      → نقل فقط                            │
│  WarehouseDashboard      → مخازن فقط                          │
│  (كلها تقرأ ولا تحسب)                                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    EMPLOYEE SCREENS (تقرأ فقط)               │
│                                                              │
│  SalesRepActivity     → get_runtime_activity                 │
│  SalesRepAchievement  → get_runtime_achievement              │
│  SalesRepWorkDay      → attendance RPCs                      │
│  AttendanceRuntimePage → attendance RPCs                     │
│  (كلها تقرأ ولا تحسب)                                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                    MANAGER SCREENS (تقرأ فقط)                │
│                                                              │
│  ActivityScreen       → get_runtime_activity + team_activity │
│  ManagerReportsPage   → canonical + completed_workdays       │
│  TeamAchievement      → get_runtime_team + achievement       │
│  SalesManagerCCPage   → governed_* RPCs                      │
│  PerformanceAnalysis  → canonical + kpi_contributors         │
│  HierarchyTargetPage  → canonical (hierarchy key)            │
│  TargetRuntimePage    → canonical + active_employees         │
│  (كلها تقرأ ولا تحسب — عدا ActivityScreen قد تجمع client-side)│
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                   EXECUTIVE SCREENS (تقرأ فقط)               │
│                                                              │
│  ChairmanWorkspace        → مؤشرات عليا                      │
│  SuperAdminWorkspace      → إدارة عليا                       │
│  ExecutiveOperationsWorkspace → عمليات تنفيذية               │
│  CommandCenterPage        → مركز القيادة                     │
│  (كلها تقرأ ولا تحسب)                                        │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. ملاحظة على Dependency Graph

الوضع الحالي جيد جدًا من ناحية الـ Architecture:

- ✅ كل شاشة تقرأ KPI جاهزًا (RPC) — لا تحسب من الصفر
- ✅ الطبقات مفصولة بوضوح: Raw Tables → Canonical Engine → RPC Reports → Screens
- ✅ `get_governed_target_performance` هو المحرك المركزي لـ KPIs

**التحديات الوحيدة:**
1. ❌ `get_runtime_activity` و `get_runtime_achievement` خارج Source Control — يجب استخراج تعريفاتها وتوحيدها مع Canonical Engine
2. ❌ `ActivityScreen` تقوم بتجميع client-side (بناء mgrMap) — يجب نقل التجميع إلى RPC
3. ❌ `EmployeeAnalysisPage` تقرأ مباشرة من الجداول (Technical Debt)
4. ❌ `TargetRuntimePage` تبني التجميع client-side بدلاً من استخدام hierarchy key

---

## 4. الفروقات بين الصيغ — هل هي Bugs أم Intentional؟

| KPI | الفرق | تحليل |
|-----|-------|-------|
| **Sales (Created vs Delivered)** | Created = كل الطلبات غير draft/cancelled. Delivered = فقط المسلَّمة. | ✅ مقصود — Created يقيس النشاط اليومي، Delivered يقيس الإنجاز الفعلي |
| **Effective Sales vs Created Sales** | Effective = Delivered - returns. Created = خام. | ✅ مقصود — لكل منهما غرض مختلف |
| **Visits (direct vs stored)** | Canonical يحسب مباشرة من `visits` table. Activity يقرأ `visit_count` المخزَّن. | ⚠️ غير مقصود — `visit_count` قد لا يتزامن مع canonical بسبب توقيت التحديث |
| **New Customers (First Delivery vs Created)** | Canonical: أول طلب تسليم. Activity: تاريخ إنشاء العميل. | ✅ مقصود — KPI مختلفان يجب أن يكونا منفصلين |
| **Collections Amount (all vs collected)** | Canonical: كل الحالات. Completed History: فقط collected. | ❌ غير متسق — يجب اتخاذ قرار: هل collections amount يشمل غير المحصَّلة؟ |
| **المسافة (مباشر vs مخزَّن)** | `get_employee_day_map` يحسب مباشرة. الباقي يقرأ `total_distance_meters`. | ⚠️ غير مقصود — الفرق بسبب Bug محتمل في الثبات |

---

## 5. خطة الترحيل (Migration Plan)

### Step 1: اعتماد تعريفات KPI
- توثيق التعريفات النهائية في هذا المستند
- اتخاذ القرارات المعلقة:
  1. Collections Amount: شامل كل الحالات أم فقط collected؟
  2. المسافة: هل يكون مصدر الحقيقة هو `total_distance_meters` (بعد fix) أم الحساب المباشر دائمًا؟
  3. هل `Registered Customers` = `Customers` الـ KPI منفصل؟
- الحالة: **تصميم فقط — لا كود**

### Step 2: اعتماد Runtime Layer
- استخراج تعريفات RPCs الخمسة من DB الإنتاج
- مراجعة تعريفاتها مقابل Canonical Definitions
- توثيق أي اختلافات
- الحالة: **قراءة فقط من DB الإنتاج — لا تعديل**

### Step 3: توحيد Activity Screen (get_runtime_activity)
- بعد استخراج تعريف runtime activity:
  - إذا كان مختلفًا عن Canonical: تعديل runtime activity لاستخدام Canonical KPI Engine
  - إذا كان متطابقًا: توثيق التطابق فقط
- نقل تجميع client-side في ActivityScreen إلى RPC
- الحالة: **تعديل RPC + تعديل شاشة**

### Step 4: توحيد Sales Effort (get_sales_reps_effort)
- مراجعة تعريفات KPIs في `get_sales_reps_effort`
- توحيدها مع Canonical KPI Engine
- الحالة: **تعديل RPC إذا لزم الأمر**

### Step 5: توحيد Manager Reports
- مراجعة `get_completed_workdays_history` مقابل Canonical Definitions
- توحيد أي اختلافات (خاصة collections amount)
- توحيد `TargetRuntimePage` — استخدام hierarchy key بدلاً من التجميع client-side
- الحالة: **تعديل RPCs إذا لزم الأمر + تعديل شاشة**

### Step 6: توحيد Attendance Reports
- مراجعة KPIs الحضور في `get_completed_workdays_history`
- توحيد مسافة GPS (تطبيق fix الثبات إذا لزم الأمر)
- الحالة: **تعديل RPC إذا لزم الأمر**

### Step 7: توحيد Executive Dashboards
- مراجعة `get_dashboard_management` و `get_dashboard_sales`
- توحيدها مع Canonical Definitions
- الحالة: **تعديل RPC إذا لزم الأمر**

### Step 8: إزالة Technical Debt
- إصلاح EmployeeAnalysisPage — استبدال `supabase.from()` بـ RPCs
- إزالة أي حسابات KPI داخل الشاشات المتبقية
- الحالة: **تعديل شاشة فقط**

---

## 6. Single Source of Truth لكل KPI

| KPI | المصدر (Source) | أين يُحسَب | أين يُقرأ |
|-----|-----------------|-----------|----------|
| **Created Orders** | `orders` (status NOT draft/cancelled) | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Delivered Orders** | `orders` (status='delivered') | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Effective Orders** | **DeliveredOrders - FullReturns** (محسوب) | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Created Sales** | `orders.total_amount` + `order_items` | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Delivered Sales** | `orders.total_amount` (status='delivered') | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Effective Sales** | **DeliveredSales - ReturnDeductions** (محسوب) | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Visits** | `visits` (status='completed') | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Registered Customers** | `customers` (created_at) | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **New Customers (First Delivered)** | `orders` (MIN delivered_at) | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Collections Count** | `collections` (كل الحالات) | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Collections Amount** | **بحاجة قرار: collected-only vs all-statuses** | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Active Days** | `workday_sessions` (status='completed') | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Working Hours** | `workday_sessions` + `workday_breaks` + `employee_work_policies` | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Distance** | `tracking_points` → Haversine (دالة `calculate_session_distance`) | Canonical KPI Engine (دالة مساعدة واحدة) | جميع الشاشات عبر RPC موحد |
| **Tracking Points** | `tracking_points` (COUNT) | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Achievement %** | `LEAST(actual/target*100, 100)` (محسوب) | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Overall Score** | `Σ(KPI% * weight/100)` (محسوب) | Canonical KPI Engine | جميع الشاشات عبر RPC موحد |
| **Company Target** | `company_monthly_targets` (جدول) | ⚡ يُقرأ مباشرة | جميع الشاشات عبر Canonical Engine |
| **Employee Target** | `employee_monthly_targets` (جدول) | ⚡ يُقرأ مباشرة | جميع الشاشات عبر Canonical Engine |
| **Weights** | `performance_weights_config` + `get_effective_weights()` | Canonical KPI Engine | جميع الشاشات عبر Canonical Engine |

---

## 7. القواعد النهائية

1. **كل KPI له مصدر واحد للحقيقة** — أي RPC يقرأ هذا KPI يجب أن يستخدم نفس المصدر
2. **لا يُحسَب أي KPI داخل أي شاشة** — الشاشات تقرأ فقط من RPCs
3. **RPCs النهائية (runtime activity, runtime achievement) يجب أن تستدعي Canonical KPI Engine داخليًا** — لا تعيد تعريف KPIs من الصفر
4. **أي اختلاف بين تعريفات الـ runtime والـ canonical يجب حله** — إما بتعديل الـ runtime أو بتعديل الـ canonical (مع توثيق القرار)
5. **بعد التوحيد، `get_governed_target_performance` يصبح المحرك الوحيد** لحساب KPIs المستهدفة (Effective Sales, Achievement %)
6. **`get_completed_workdays_history` يصبح محرك KPIs النشاط** (Created Orders, Working Hours, Active Days)
7. **`get_runtime_activity` و `get_runtime_achievement` يصبحان طبقة توصيل فقط** (Wrapper) — تستدعي المحرك ولا تعيد حساب أي شيء
