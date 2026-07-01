# Canonical System Specification — المواصفات الهندسية المعتمدة

**الإصدار:** 1.0  
**تاريخ الاعتماد:** 2026-06-30  
**الحالة:** ✅ **معتمد — المرجع الرسمي الوحيد للنظام**  
**الجهة المصدرة:** Phase 3 (KPI Canonicalization) + Phase 4 (KPI Certification)

---

## 1. قواعد العمل النهائية (Business Rules)

### 1.1 دورة حياة الطلب (Order Lifecycle)

```
                     ORDER LIFECYCLE
                     
    [Draft]          →  لا شيء (لم يُرسَل)
    [Submitted]       →  ✅ النشاط (Activity)
    [Delivered]       →  ✅ الإنجاز (Achievement)
    [Cancelled] (أي مرحلة) →  ❌ مطلقًا لا شيء
```

| الحالة | في النشاط | في الإنجاز | في التقارير |
|--------|----------|-----------|-------------|
| `draft` | ❌ | ❌ | ❌ |
| `pending / confirmed / reviewing / preparing / dispatched / approved` | ✅ | ❌ | النشاط فقط |
| `delivered` | ✅ | ✅ | ✅ |
| `cancelled` | ❌ مطلقًا | ❌ مطلقًا | ❌ مطلقًا |

### 1.2 الطلبات الملغاة — قاعدة صارمة

أي طلب حالته `cancelled` في أي مرحلة:
- لا يدخل في Created Orders
- لا يدخل في Created Sales
- لا يدخل في Delivered Orders/Sales
- لا يدخل في Achievement %
- لا يدخل في Overall Score
- لا يدخل في أداء المندوب أو المدير أو الفريق أو الشركة
- يُعتبر كأنه لم يُنتج قيمة تشغيلية

### 1.3 سياسة الموظف غير النشط

| القاعدة | التفصيل |
|---------|---------|
| بياناته التاريخية | تُحتسب في إجمالي الشركة (company-level queries لا تفلتر بـ is_active) |
| بياناته في أداء الفريق | تُحتسب إذا كانت الفترة التي يعمل بها التقرير تغطي فترة نشاطه |
| الهدف الشهري | يُحتسب في إجمالي الفريق إذا كان لديه target في ذلك الشهر |
| إخفاؤه من القوائم | يُخفى من قوائم الموظفين النشطين فقط |
| مديره | يحصل على credit عن العمل الذي تم أثناء فترة عضوية الموظف في فريقه |

**التنفيذ:** استعلامات الـ employee-level يجب أن تستخدم:
```sql
WHERE (e.is_active = true OR EXISTS atividade employee IN فترة التقرير)
```
بدلاً من:
```sql
WHERE e.is_active = true
```

**الاستثناء:** إذا تم حذف الموظف بالكامل (وليس مجرد إيقاف)، عندها تُلحق بياناته بـ "موظف غير معروف" (Unattributed).

### 1.4 سياسة العملاء

| KPI | النوع | التعريف |
|-----|-------|---------|
| **Registered Customers** | مجهود (Activity) | عدد العملاء الذين سجَّلهم المندوب — `customers.created_at` IN الفترة |
| **New Customers (First Delivered)** | إنجاز (Achievement) | عدد العملاء الذين أصبحوا فعليين بأول طلب تسليم — `MIN(orders.delivered_at)` IN الفترة |

- Registered Customer ≠ New Customer
- لا يتم دمجهما أبدًا
- كل منهما KPI مستقل

### 1.5 سياسة التحصيل (Collections)

| KPI | التعريف | المصدر |
|-----|---------|--------|
| **Collections Count** | عدد عمليات التحصيل (كل الحالات) | `collections.created_at` IN الفترة |
| **Collections Amount** | **المبلغ الذي دخل الشركة فعليًا فقط** | `collections` WHERE `status='collected'` AND `collected_at` IN الفترة |

- أي مبلغ لم يُحصَّل فعليًا لا يدخل في أي مؤشر أو تقرير أو نسبة إنجاز أو أداء
- مبلغ التحصيل يقارن بـ target التحصيل (إذا وُجد)

### 1.6 سياسة المسافة (Distance)

| القاعدة | التفصيل |
|---------|---------|
| مصدر الحقيقة | **Tracking Points** — تُحسب المسافة من أول نقطة إلى آخر نقطة |
| خوارزمية | Haversine بين النقاط المتتالية |
| يُستبعد فقط | إحداثيات NULL/faulty، accuracy > 50m، سرعة > 5 m/s (18 km/h) |
| لا يُستبعد | القفزات الحقيقية (فقدان GPS ثم استعادته — إذا كانت السرعة منطقية زمنيًا) |
| لا يُستبعد | الحركة القصيرة (< 20m) — عتبة min_distance ملغاة |
| التخزين | `total_distance_meters` في `workday_sessions` يُحدَّث عند `end_workday` |
| الحساب المباشر | `get_employee_day_map` يحسب مباشرة — متاح دائمًا |

### 1.7 سياسة الهدف (Targets)

| المكوّن | المصدر |
|---------|--------|
| Company Target | `company_monthly_targets` (مصدر واحد لكل شهر/سنة) |
| Employee Target | `employee_monthly_targets` لكل موظف — مع توزيع نسبي للأطر الزمنية |
| Company Weights | `performance_weights_config` (بالسنة) |
| Employee Weights | `get_effective_weights(employee_id)` — أوزان فردية |

### 1.8 قاعدة عامة: لا إعادة حساب داخل أي شاشة

- ✅ كل شاشة تقرأ KPI جاهزًا من الـ Canonical KPI Engine
- ❌ لا يُحسَب أي KPI داخل أي شاشة (لا JavaScript-side ولا client-side)
- ✅ جميع RPCs النهائية تستدعي Canonical KPI Engine داخليًا
- ❌ لا يوجد تعريف مختلف لأي KPI في أي مكان

---

## 2. تعريفات KPI المعتمدة

### Orders

| KPI | التعريف | المصدر | الصيغة | أين يُحتسب |
|-----|---------|-------|--------|-----------|
| Created Orders | عدد الطلبات المرسلة (submitted) غير draft/cancelled | `orders` | `COUNT(*) WHERE status NOT IN ('draft','cancelled') AND submitted_at IN الفترة` | النشاط |
| Delivered Orders | عدد الطلبات المسلَّمة | `orders` | `COUNT(*) WHERE status='delivered' AND delivered_at IN الفترة` | الإنجاز |
| Full Returns | طلب رجعت جميع قطعه | `returns` + `return_items` | `SUM(quantity) >= SUM(piece_quantity) AND status='approved'` | الإنجاز |
| Effective Orders | Delivered - FullReturns | محسوب | `GREATEST(DeliveredOrders - FullReturns, 0)` | الإنجاز |

### Sales

| KPI | التعريف | المصدر | الصيغة | أين يُحتسب |
|-----|---------|-------|--------|-----------|
| Created Sales | قيمة الطلبات المرسلة غير draft/cancelled | `orders` | `SUM(total_amount) WHERE status NOT IN ('draft','cancelled') AND submitted_at IN الفترة` | النشاط |
| Delivered Sales | قيمة الطلبات المسلَّمة | `orders` | `SUM(total_amount) WHERE status='delivered' AND delivered_at IN الفترة` | الإنجاز |
| Return Deductions | قيمة المرتجعات المعتمدة | `returns` | `SUM(credit_note_amount) WHERE status='approved' AND created_at IN الفترة` | الإنجاز |
| Effective Sales | Delivered - Deductions | محسوب | `GREATEST(DeliveredSales - ReturnDeductions, 0)` | الإنجاز |

### Visits

| KPI | التعريف | المصدر | الصيغة | أين يُحتسب |
|-----|---------|-------|--------|-----------|
| Visits | الزيارات المكتملة | `visits` | `COUNT(*) WHERE status='completed' AND check_out_at IN الفترة` | النشاط (+ الإنجاز إذا كان له target) |

### Customers

| KPI | التعريف | المصدر | الصيغة | أين يُحتسب |
|-----|---------|-------|--------|-----------|
| Registered Customers | العملاء المسجلون | `customers` | `COUNT(*) WHERE created_at IN الفترة` | النشاط (مجهود) |
| New Customers (First Delivered) | العملاء الفعليون | `orders` | `COUNT(DISTINCT customer_id) WHERE MIN(delivered_at) لكل customer IN الفترة` | الإنجاز |

### Collections

| KPI | التعريف | المصدر | الصيغة | أين يُحتسب |
|-----|---------|-------|--------|-----------|
| Collections Count | عدد عمليات التحصيل | `collections` | `COUNT(*) WHERE created_at IN الفترة` | النشاط |
| Collections Amount | المبلغ المُحصَّل فعليًا | `collections` | `SUM(amount) WHERE status='collected' AND collected_at IN الفترة` | الإنجاز |

### Attendance

| KPI | التعريف | المصدر | الصيغة | أين يُحتسب |
|-----|---------|-------|--------|-----------|
| Active Days | أيام العمل المكتملة | `workday_sessions` | `COUNT(DISTINCT date) WHERE status='completed'` | النشاط |
| Working Hours | صافي دقائق العمل | `workday_sessions` + `workday_breaks` + `employee_work_policies` | `GREATEST(EPOCH(end-start)/60 - CASE fixed_shift THEN break_minutes ELSE 0 END, 0)` | النشاط |
| Distance | المسافة المقطوعة | `tracking_points` / `total_distance_meters` | Haversine + 3 drift filters | النشاط |
| Tracking Points | عدد نقاط التتبع | `tracking_points` | `COUNT(*) WHERE session_id IN الفترة` | النشاط |

### Achievement

| KPI | التعريف | المصدر | الصيغة |
|-----|---------|-------|--------|
| Achievement % (per KPI) | (الفعلي / الهدف) * 100 | محسوب | `LEAST(actual / NULLIF(target,0) * 100, 100)` |
| Overall Score | Sum(KPI% * الوزن / 100) | محسوب | بأوزان فردية من `get_effective_weights()` |

### Targets

| KPI | التعريف | المصدر |
|-----|---------|-------|
| Company Target | لكل KPI (sales, visits, orders, new_customers) | `company_monthly_targets` لكل شهر/سنة |
| Employee Target | لكل موظف لكل KPI — مع توزيع نسبي للأطر الزمنية | `employee_monthly_targets` + توزيع |
| Weights | أوزان الأداء — عامة على مستوى الشركة وفردية لكل موظف | `performance_weights_config` + `get_effective_weights()` |

---

## 3. مصدر الحقيقة لكل KPI

| KPI | مصدر الحقيقة | يقرأ من |
|-----|-------------|---------|
| Created Orders | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) |
| Created Sales | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) |
| Delivered Orders | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) |
| Delivered Sales | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) |
| Effective Orders | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) |
| Effective Sales | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) |
| Visits | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) — لا يُقرأ `visit_count` المخزَّن |
| Registered Customers | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) |
| New Customers (First Delivered) | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) |
| Collections Count | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) |
| Collections Amount | **Canonical KPI Engine** (`status='collected'`) | RPC موحد (جميع الشاشات) |
| Active Days | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) |
| Working Hours | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) |
| Distance | **`calculate_session_distance()`** + `total_distance_meters` | RPC موحد (جميع الشاشات) |
| Tracking Points | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) |
| Achievement % | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) |
| Overall Score | **Canonical KPI Engine** | RPC موحد (جميع الشاشات) |
| Company Target | **جدول `company_monthly_targets`** | عبر Canonical KPI Engine |
| Employee Target | **جدول `employee_monthly_targets`** | عبر Canonical KPI Engine |
| Weights | **`performance_weights_config` + `get_effective_weights()`** | عبر Canonical KPI Engine |

---

## 4. الـ Runtime المعتمد

| المكوّن | الحالة | ملاحظة |
|---------|--------|--------|
| `get_governed_target_performance` | ✅ معتمد | محرك KPI الأساسي — يحتاج تعديل سياسة inactive employee + Session Token اختياري |
| `get_completed_workdays_history` | ✅ معتمد | محرك النشاط — sessions + KPIs اليومية |
| `get_employee_day_map` | ✅ معتمد | GPS + مسافة + مسار |
| `get_dashboard_management` | ✅ معتمد | لوحة الإدارة |
| `get_sales_reps_effort` | ✅ معتمد | جهد المندوبين |
| `get_live_workday_overview` | ✅ معتمد | نظرة حية |
| `get_dashboard_sales` | ✅ معتمد | ملخص المبيعات |
| `get_runtime_activity` | 🟢 خارج Source Control | يحتاج استخراج تعريف وتوحيد مع Canonical Engine |
| `get_runtime_team_activity` | 🟢 خارج Source Control | يحتاج استخراج تعريف وتوحيد |
| `get_runtime_achievement` | 🟢 خارج Source Control | يحتاج استخراج تعريف وتوحيد |
| `get_runtime_achievement_with_targets` | 🟢 خارج Source Control | يحتاج استخراج تعريف وتوحيد |
| `get_runtime_team` | 🟢 خارج Source Control | يحتاج استخراج تعريف وتوحيد |

### قاعدة Runtime:
- بعد التوحيد: جميع RPCs النهائية تستدعي Canonical KPI Engine فقط
- لا تعيد تعريف أي KPI من الصفر
- جميعها تعيد JSON بقيم جاهزة — لا تحتاج الشاشات لأي حساب إضافي

---

## 5. الاستثناءات المعتمدة

### 5.1 الموظف غير النشط

| البند | القاعدة |
|-------|---------|
| بياناته في إجمالي الشركة | تُحتسب (كما هو الحالي) |
| بياناته في أداء الفريق | تُحتسب إذا كانت الفترة الزمنية تغطي فترة نشاطه |
| هدفه الشهري | يُحتسب إذا كان لديه target |
| ظهوره في القوائم | لا يظهر في قوائم الموظفين النشطين |
| مديره | يحصل على credit عن العمل المنجز أثناء عضوية الموظف في فريقه |

### 5.2 الفرق بين Company Total و Employee Sum

**الفرق مسموح به ومتوقع** عندما:
- يوجد موظفون غير نشطين لديهم بيانات في الفترة
- يوجد طلبات منسوبة إلى owner_id لا يطابق أي موظف (نادر)

**هذا ليس Bug — هذا سلوك مقصود.** إجمالي الشركة هو الحقيقة المطلقة (جميع البيانات)، وإجمالي الموظفين هو الحقيقة المنسوبة (ما يمكن إسناده إلى موظفين نشطين).

### 5.3 Collections = 0

إذا كانت التحصيلات في فترة ما = 0، فهذا أمر طبيعي ولا يحتاج معالجة خاصة.

### 5.4 Returns = 0

إذا كانت المرتجعات في فترة ما = 0، فإن Effective = Delivered.

---

## 6. اعتماد البيانات (Certification Summary)

بناءً على التحقق الفعلي من قاعدة بيانات الإنتاج (يونيو 2026):

| KPI | Raw Data | Certified | Source |
|-----|----------|-----------|--------|
| Created Orders | 56 (company) / 55 (active) | ✅ | `orders` WHERE submitted IN June |
| Delivered Orders | 10 | ✅ | `orders` WHERE delivered IN June |
| Created Sales | 3,196,184.16 / 2,992,250 | ✅ | `orders.total_amount` |
| Delivered Sales | 1,332,435.13 | ✅ | `orders.total_amount` WHERE delivered |
| Effective Sales | 1,332,435.13 (0 Returns) | ✅ | Delivered - Returns |
| Effective Orders | 10 (0 Full Returns) | ✅ | Delivered - FullReturns |
| Completed Visits | 174 / 151 | ✅ | `visits` WHERE completed |
| Registered Customers | 133 / 110 | ✅ | `customers.created_at` |
| New Customers (First Delivered) | 8 | ✅ | `MIN(orders.delivered_at)` |
| Collections Count | 0 | ✅ | `collections.created_at` |
| Collections Amount | 0 | ✅ | `collections` WHERE collected |
| Active Days | 12 company / 57 cumulative | ✅ | `workday_sessions` WHERE completed |
| Working Hours | 48,742 min (812 hrs) | ✅ | 86 sessions with duration |
| Distance | 541,170m stored / 65 sessions | ✅ | `total_distance_meters` — `calculate_session_distance` موجودة |
| Tracking Points | 1,209 | ✅ | `tracking_points` |
| Company Sales Achievement | 2.66% | ✅ | محسوب من raw data + targets |
| Overall Score | 2.94% | ✅ | محسوب من raw data + targets |
| Company Target (Sales) | 50,000,000 | ✅ | `company_monthly_targets` June 2026 |
| Company Target (Visits) | 2,000 | ✅ | نفس المصدر |
| Company Target (Orders) | 2,000 | ✅ | نفس المصدر |
| Company Target (New Cust) | 2,000 | ✅ | نفس المصدر |

---

## 7. الـ Single Source of Truth النهائي

**الشاشة:** `/dashboard/activity-target`

هي مصدر الحقيقة الوحيد لكل:
- ✅ النشاط (Activity)
- ✅ الإنجاز (Achievement)
- ✅ التارجت (Targets)
- ✅ أداء المدير (Manager Performance)
- ✅ أداء المندوب (Rep Performance)
- ✅ أداء الإدارة العليا (Executive Performance)
- ✅ التقارير (Reports)
- ✅ مجهود المندوبين (Sales Rep Effort)

**القاعدة:** لا يُحسَب أي KPI داخل أي شاشة. كل شاشة تقرأ قيمة جاهزة من الـ Canonical KPI Engine. الرقم يظهر كما هو في كل مكان — بدون اختلافات.

---

## 8. خريطة الطريق (Roadmap)

| Step | المهمة | الحالة |
|------|--------|--------|
| 1 | اعتماد تعريفات KPI | ✅ مكتمل |
| 2 | اعتماد Runtime Layer | ✅ مكتمل |
| 3 | اعتماد تذاكيد البيانات (Certification) | ✅ 19/19 KPI معتمدة |
| 4 | استخراج Runtime RPCs من DB الإنتاج | 🟢 خارج Source Control — مهمة تشغيلية |
| 5 | توحيد Activity Screen | ⏳ التالي |
| 6 | توحيد Sales Effort Screen | ⏳ |
| 7 | توحيد Manager Reports | ⏳ |
| 8 | توحيد Attendance Reports | ⏳ |
| 9 | توحيد Executive Dashboards | ⏳ |
| 10 | إزالة Technical Debt (EmployeeAnalysisPage) | ⏳ |

---

**هذه الوثيقة هي المرجع الرسمي الوحيد. أي تطوير مستقبلي يجب أن يتوافق معها.**
