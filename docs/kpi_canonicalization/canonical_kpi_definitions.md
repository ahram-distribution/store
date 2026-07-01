# Canonical KPI Definitions — الاعتماد النهائي

**التاريخ:** 2026-06-30
**الإصدار:** 2.0 (بعد قرارات الإدارة)
**الحالة:** معتمد — جاهز للتطوير

---

## مقدمة

هذه الوثيقة تضع التعريفات النهائية لكل KPI في النظام. جميع القرارات أدناه معتمدة من الإدارة وملزمة لكل التطوير القادم.

**القاعدة الذهبية:** تعريف واحد لكل KPI. مصدر واحد لكل رقم. لا يُحسَب أي KPI داخل أي شاشة. كل شاشة تقرأ فقط.

---

## القسم 1: دورة حياة الطلب (Order Lifecycle)

هذا هو الأساس الذي تبنى عليه جميع تعريفات KPI.

### مراحل الطلب:

1. **ORDER CREATED** — الحالة: `draft`. لم يُرسَل بعد. لا يدخل في أي شيء.
2. **ORDER SUBMITTED** — الحالة: `pending` / `confirmed`. ≠ cancelled, ≠ draft. **يدخل في النشاط** (Created Orders, Created Sales).
3. **ORDER DELIVERED** — الحالة: `delivered`. **يدخل في الإنجاز** (Delivered Orders, Delivered Sales, Effective Orders/Sales, New Customers, Achievement %, Targets).
4. **ORDER CANCELLED** (أي مرحلة) — الحالة: `cancelled`. **لا يدخل في أي مكان مطلقًا** — لا نشاط، لا إنجاز، لا تقارير، لا عدادات، لا نسب تحقيق، لا أداء.

### القواعد الثابتة:

| الحالة | في النشاط | في الإنجاز | ملاحظة |
|--------|----------|-----------|--------|
| `draft` | لا | لا | لم يُرسَل بعد |
| `pending/confirmed` (≠ cancelled, ≠ draft) | نعم | لا | الطلب في طور التنفيذ |
| `delivered` | نعم | نعم | تم التسليم — يدخل في الهدف |
| `cancelled` (أي مرحلة) | مطلقًا لا | مطلقًا لا | لا قيمة تشغيلية |

### متى يعتبر الطلب محسوبًا في النشاط؟

حالته ليست `draft` وليست `cancelled`. يُحتسب في: Created Orders, Created Sales.

### متى يعتبر الطلب محسوبًا في الإنجاز؟

حالته `delivered`. يُحتسب في: Delivered Orders, Delivered Sales, Effective Orders/Sales, New Customers.

---

## القسم 2: التعريفات النهائية المعتمدة

### 2.1 Orders

| KPI | التعريف المعتمد | المصدر | الخوارزمية |
|-----|----------------|--------|-----------|
| **Created Orders** | عدد الطلبات المرسلة (submitted) في الفترة، باستثناء draft و cancelled | `orders` WHERE `status NOT IN ('draft','cancelled')` AND `submitted_at` IN الفترة | COUNT(*) |
| **Delivered Orders** | عدد الطلبات المسلَّمة في الفترة | `orders` WHERE `status='delivered'` AND `delivered_at` IN الفترة | COUNT(DISTINCT id) |
| **Effective Orders** | Delivered Orders ناقص Full Returns | محسوب | GREATEST(DeliveredOrders - FullReturns, 0) |

### 2.2 Sales

| KPI | التعريف المعتمد | المصدر | الخوارزمية |
|-----|----------------|--------|-----------|
| **Created Sales** | إجمالي قيمة الطلبات المرسلة (submitted) في الفترة، باستثناء draft و cancelled | `orders` WHERE `status NOT IN ('draft','cancelled')` AND `submitted_at` IN الفترة | SUM(total_amount) |
| **Delivered Sales** | إجمالي قيمة الطلبات المسلَّمة في الفترة | `orders` WHERE `status='delivered'` AND `delivered_at` IN الفترة | SUM(total_amount) |
| **Effective Sales** | Delivered Sales ناقص خصم المرتجعات | محسوب | GREATEST(DeliveredSales - ReturnDeductions, 0) |

### 2.3 Returns

| KPI | التعريف المعتمد | المصدر | الخوارزمية |
|-----|----------------|--------|-----------|
| **Full Return** | طلب رجعت جميع قطعه (pieces المرتجعة >= total pieces) | `returns` + `return_items` + `order_items` + `products` | SUM(quantity بعد تحويل) >= SUM(piece_quantity) AND status='approved' |
| **Return Deductions** | إجمالي قيمة المرتجعات المعتمدة | `returns` WHERE `status='approved'` AND `created_at` IN الفترة | SUM(credit_note_amount) |

### 2.4 Visits

| KPI | التعريف المعتمد | المصدر | الخوارزمية |
|-----|----------------|--------|-----------|
| **Visits** | عدد الزيارات المكتملة في الفترة | `visits` WHERE `status='completed'` AND `check_out_at` IN الفترة | COUNT(*) |

ملاحظة: لا يُقرأ `visit_count` من `workday_sessions`. يُحتسب مباشرة من `visits`.

### 2.5 Customers

| KPI | التعريف المعتمد | المصدر | الخوارزمية |
|-----|----------------|--------|-----------|
| **Registered Customers** | عدد العملاء الذين سجَّلهم المندوب في الفترة — **يقيس المجهود** | `customers` WHERE `created_at` IN الفترة | COUNT(*) |
| **New Customers (First Delivered)** | عدد العملاء الذين أصبحوا فعليين بعد أول طلب تسليم — **يقيس الإنجاز** | `orders` WHERE `status='delivered'` | COUNT(DISTINCT customer_id) WHERE MIN(delivered_at) يقع في الفترة |

تنبيه: هذان مؤشران منفصلان تمامًا. لا يتم دمجهما.

### 2.6 Collections

| KPI | التعريف المعتمد | المصدر | الخوارزمية |
|-----|----------------|--------|-----------|
| **Collections Count** | عدد عمليات التحصيل (كل الحالات) في الفترة | `collections` WHERE `created_at` IN الفترة | COUNT(*) |
| **Collections Amount** | **المبلغ الذي دخل الشركة فعليًا فقط** — `status='collected'` فقط | `collections` WHERE `status='collected'` AND `collected_at` IN الفترة | SUM(amount) |

قاعدة صارمة: أي مبلغ لم يُحصَّل فعليًا لا يدخل في أي مؤشر أو تقرير أو نسبة إنجاز أو أداء.

### 2.7 Attendance

| KPI | التعريف المعتمد | المصدر | الخوارزمية |
|-----|----------------|--------|-----------|
| **Active Days** | أيام العمل المكتملة في الفترة | `workday_sessions` WHERE `status='completed'` AND `date` IN الفترة | COUNT(DISTINCT date) |
| **Working Hours (Net Minutes)** | صافي دقائق العمل مع مراعاة جدول الموظف | `workday_sessions` + `workday_breaks` + `employee_work_policies` | GREATEST(EPOCH(end-start)/60 - CASE fixed_shift THEN break_minutes ELSE 0 END, 0) |

### 2.8 GPS & Tracking

| KPI | التعريف المعتمد | المصدر | الخوارزمية |
|-----|----------------|--------|-----------|
| **Distance** | المسافة المقطوعة محسوبة من جميع نقاط التتبع (Tracking Points) | `tracking_points` | Haversine بين النقاط المتتالية |
| **Tracking Points** | عدد نقاط التتبع المسجلة في الفترة | `tracking_points` WHERE `session_id` IN الفترة | COUNT(*) |

**قواعد المسافة الدقيقة:**
- ✅ **كل حركة حقيقية تُحتسب** — حتى لو كانت قفزة كبيرة بسبب فقدان الإشارة ثم استعادتها، إذا كانت السرعة زمنيًا منطقية
- يُستبعد فقط: إحداثيات NULL/talefa, accuracy > 50m, سرعة غير منطقية (> 5 m/s = 18 km/h)
- ❌ لا نستبعد الحركة القصيرة (< 20m) — العتبة السابقة ملغاة أو منخفضة جدًا (5m كحد أقصى للاستبعاد)
- القفزات الحقيقية لا تُستبعد: المندوب فقد الإشارة، ركب سيارة، تحرك كيلومترات، ثم عاد الإرسال — هذه حركة حقيقية

### 2.9 Achievement

| KPI | التعريف المعتمد | المصدر | الخوارزمية |
|-----|----------------|--------|-----------|
| **Achievement % (per KPI)** | (الفعلي / الهدف) * 100 | محسوب | LEAST(actual / NULLIF(target,0) * 100, 100) |
| **Overall Score** | Sum(KPI% * الوزن / 100) | محسوب | بأوزان فردية من get_effective_weights() |

### 2.10 Targets

| KPI | التعريف المعتمد | المصدر |
|-----|----------------|--------|
| **Company Target** | من `company_monthly_targets` (مصدر واحد لكل شهر/سنة) | جدول company_monthly_targets |
| **Employee Target** | من `employee_monthly_targets` لكل موظف، مع توزيع نسبي للأطر الزمنية | جدول employee_monthly_targets + توزيع |
| **Weights** | من `performance_weights_config` للمستوى العام، ومن `get_effective_weights()` لكل موظف | نظام الأوزان الفردية |

---

## القسم 3: مصفوفة القرارات

### كيف يُحتسب كل KPI؟

| KPI | في النشاط؟ | في الإنجاز؟ | مصدر الحقيقة |
|-----|-----------|------------|-------------|
| Created Orders | ✅ | ❌ | Canonical KPI Engine |
| Created Sales | ✅ | ❌ | Canonical KPI Engine |
| Delivered Orders | ❌ | ✅ | Canonical KPI Engine |
| Delivered Sales | ❌ | ✅ | Canonical KPI Engine |
| Effective Orders | ❌ | ✅ | Canonical KPI Engine |
| Effective Sales | ❌ | ✅ | Canonical KPI Engine |
| Visits | ✅ | ✅ (إن كان له target) | Canonical KPI Engine |
| Registered Customers | ✅ | ❌ | Canonical KPI Engine |
| New Customers (First Delivered) | ❌ | ✅ | Canonical KPI Engine |
| Collections Count | ✅ | ❌ | Canonical KPI Engine |
| Collections Amount | ❌ | ✅ (collected فقط) | Canonical KPI Engine |
| Active Days | ✅ | ❌ | Canonical KPI Engine |
| Working Hours | ✅ | ❌ | Canonical KPI Engine |
| Distance | ✅ | ❌ | Canonical KPI Engine |
| Tracking Points | ✅ | ❌ | Canonical KPI Engine |
| Achievement % | ❌ | ✅ | Canonical KPI Engine |
| Overall Score | ❌ | ✅ | Canonical KPI Engine |

### القرارات المعتمدة:

| القرار | الخيار المعتمد | المبرر |
|--------|---------------|--------|
| Collections Amount | فقط `status='collected'` | المبلغ الذي دخل الشركة فعليًا فقط |
| Customers | KPI منفصلان: Registered (مجهود) + New First Delivery (إنجاز) | لكل منهما معنى مختلف |
| Distance | تُحسب مباشرة من Tracking Points — لا تُستبعد الحركة الحقيقية | استبعاد الفاسد فقط، لا معاقبة المندوب |
| Cancelled Orders | لا تُحتسب أبدًا في أي مكان | لا قيمة تشغيلية |
| Order Lifecycle | submitted → Activity, delivered → Achievement | الفصل بين النشاط والإنجاز |

---

## القسم 4: مصدر الحقيقة النهائي

### شاشة `/dashboard/activity-target`

بعد تطبيق هذه التعريفات، تصبح شاشة `/dashboard/activity-target` هي **مصدر الحقيقة الوحيد** لكل:

- النشاط (Activity)
- الإنجاز (Achievement)
- التارجت (Targets)
- أداء المدير (Manager Performance)
- أداء المندوب (Rep Performance)
- أداء الإدارة العليا (Executive Performance)
- التقارير (Reports)
- مجهود المندوبين (Sales Rep Effort)

**القاعدة:** لا يُحسَب أي KPI داخل أي شاشة. كل شاشة تقرأ قيمة جاهزة من الـ Canonical KPI Engine عبر RPC موحد. الرقم يظهر كما هو في كل مكان — بدون اختلافات.

---

## القسم 5: الفروقات — هل هي Bugs أم Intentional؟

| KPI | الفرق | تحليل |
|-----|-------|-------|
| Created vs Delivered Sales | Created = كل الطلبات غير draft/cancelled. Delivered = فقط المسلَّمة. | مقصود — لكل منهما غرض (نشاط vs إنجاز) |
| Effective vs Created Sales | Effective = Delivered - returns. Created = خام. | مقصود — لكل منهما غرض مختلف |
| Visits (direct vs stored) | Canonical يحسب من `visits`. Activity يقرأ `visit_count` المخزَّن. | غير مقصود — يجب توحيدهما على الحساب المباشر |
| New Customers (First Delivery vs Created) | Canonical: أول طلب تسليم. Activity: تاريخ إنشاء العميل. | مقصود — KPI منفصلان (Registered vs New) |
| Collections Amount (all vs collected) | Canonical: كل الحالات. Completed History: فقط collected. | غير مقصود — القرار: collected فقط |
| Collections Target | هل target يقارن بكل التحصيلات أم بالمُحصَّل فقط؟ | يحتاج قرار: target يقارن بـ collected amount |
| Distance (calculated vs stored) | `get_employee_day_map` يحسب مباشرة. الباقي يقرأ المخزَّن. | غير مقصود — يجب توحيدهما على الحساب المباشر |

---

## القسم 6: الخلاصة

1. **Collections Amount** = فقط `status='collected'`
2. **Customers** = KPI منفصلان: Registered (بـ created_at) + New First Delivery (بـ MIN delivered_at)
3. **Distance** = من Tracking Points مباشرة — لا تُستبعد الحركة الحقيقية
4. **Cancelled Orders** = لا تُحتسب مطلقًا
5. **Order Lifecycle** = submitted → Activity, delivered → Achievement
6. **/dashboard/activity-target** = مصدر الحقيقة الوحيد لكل شيء
7. **كل شاشة تقرأ فقط** — لا حسابات داخلية
