# Attendance Classification — Architecture Design

> المطلوب: طبقة فصل واضحة بين **Operational Employees** و **Executive Management**
> الحالة: مسودة معمارية — تنتظر الاعتماد قبل أي تغيير في الكود أو قاعدة البيانات

---

## 1. المشكلة الحالية

| الحالة | العدد | المثال | المشكلة |
|---|---|---|---|
| مع سياسة (`attendance_enabled=true`) | 7 موظفين | حسن بكر, ياسر توفيق | ✅ يعمل بشكل صحيح |
| بدون سياسة (`ep.id IS NULL`) | 9 موظفين | admin, REP006-008, WRQ1001-1005 | ❌ لا فرق بين "لم يُصنف بعد" و "مستثنى نهائياً" |

**المشكلة الجوهرية**: عدم وجود طريقة للتمييز بين:
1. موظف عملياتي لم يتم تعيين policy له بعد (يحتاج تصنيف في المستقبل)
2. إدارة عليا من المفترض ألا تدخل النظام أبداً

---

## 2. التصنيف المقترح

### `classification` في `employee_work_policies`

```
ALTER TABLE employee_work_policies ADD COLUMN classification text NOT NULL DEFAULT 'operational'
CHECK (classification IN ('operational', 'executive', 'review'));
```

### معنى كل قيمة

| القيمة | المعنى | `attendance_enabled` | `work_location` | `schedule_type` |
|---|---|---|---|---|
| **`operational`** | موظف عملياتي — يخضع لنظام الحضور | `true` | `field` / `office` | `flexible` / `fixed_shift` / `hourly` |
| **`executive`** | إدارة عليا — خارج النظام بالكامل | يحذف (`false`) | `null` | `null` |
| **`review`** | لم يُحدد بعد — بحاجة لمراجعة | تبقى حسب القيم الحالية | كما هو | كما هو |

### قاعدة إلزامية (CHECK constraint)
عندما يكون `classification = 'executive'`:
- `attendance_enabled = false`
- `work_location = null`
- `schedule_type = null`
- `tracking_required = false`
- `required_daily_hours = null`

---

## 3. التوزيع المتوقع بعد التطبيق

### الفئة الأولى: Operational (7 موظفين حاليين + من سيُضاف لاحقاً)
```
حسن بكر (REP-001)       — operational · field · flexible
ياسر توفيق (REP002)      — operational · field · flexible
... (جميع الموظفين الذين لديهم policy حالياً)
```

### الفئة الثانية: Executive (يُحددها المستخدم)
```
admin (ADMIN-001)        — executive (مستثنى نهائياً)
أي موظف إدارة عليا آخر   — executive (مستثنى نهائياً)
```

### الفئة الثالثة: Review (انتقالية — تُحل خلال المرحلة)
```
REP006, REP007, REP008   — review (لم يُصنف بعد — يحتاج قرار)
WRQ1001-1005             — review (لم يُصنف بعد — يحتاج قرار)
```

---

## 4. تأثير التصنيف على كل نظام

| المكون | Operational | Executive | Review |
|---|---|---|---|
| **Attendance Runtime** | ✅ يظهر badge + start/end + KPIs + target | ❌ يظهر فقط "غير خاضع للتقييم" + زر بدء فقط | ⚠️ يظهر "غير مصنف" + زر بدء فقط |
| **Work Policies** | ✅ `work_location` + `schedule_type` + `required_daily_hours` كلها نشطة | ❌ الكل `null` — لا سياسة فعالة | ⚠️ قد يكون لها أو لا — حسب ما عُيّن |
| **Attendance Scoring** | ✅ يُحتسب composite score | ❌ مستثنى تماماً | ❌ غير محتسب |
| **Work Hours Ledger** | ✅ يظهر في الـ ledger | ❌ لا يظهر | ❌ لا يظهر |
| **Attendance Alerts** | ✅ تنبيهات تأخير + انقطاع + استراحة | ❌ لا تنبيهات | ❌ لا تنبيهات |
| **Tracking Requirements** | ✅ `tracking_required = true` | ❌ `tracking_required = false` | ⚠️ حسب القيمة الحالية |
| **Attendance KPIs** | ✅ orders, sales, collections, new_customers | ❌ مخفية | ❌ مخفية |
| **Operations Center** | ✅ يظهر في العدادات + البطاقات | ❌ لا يظهر أبداً | ❌ لا يظهر أبداً |
| **Team Map** | ✅ يظهر على الخريطة | ❌ لا يظهر | ❌ لا يظهر |
| **Reports / Analytics** | ✅ يدخل في التقارير | ❌ مستثنى من التقارير | ❌ مستثنى من التقارير |
| **Target vs Actual** | ✅ يُحتسب الهدف | ❌ لا هدف | ❌ لا هدف |

---

## 5. التعديلات المطلوبة

### 5.1 قاعدة البيانات

**جديد**: إضافة عمود `classification` إلى `employee_work_policies`

```sql
ALTER TABLE employee_work_policies 
ADD COLUMN classification text NOT NULL DEFAULT 'operational'
CHECK (classification IN ('operational', 'executive', 'review'));

-- إضافة CHECK constraint متقدم
ALTER TABLE employee_work_policies
ADD CONSTRAINT executive_classification_rules
CHECK (
  (classification = 'executive' AND
   attendance_enabled = false AND
   work_location IS NULL AND
   schedule_type IS NULL AND
   tracking_required = false AND
   required_daily_hours IS NULL)
  OR
  (classification IN ('operational', 'review'))
);
```

**تعديل**: تحديث `employee_work_policies` الحالية:
- جميع السجلات الحالية → `classification = 'operational'` (لأنها كلها `attendance_enabled = true`)
- الموظفون بدون سجلات → يُحدد لاحقاً حسب قرار المستخدم

**إنشاء سجلات للموظفين الحاليين بدون policy**:
- لكل موظف بدون policy، إما إنشاء record مع `classification = 'executive'` (مستثنى) أو `classification = 'review'` (لم يُقرر بعد)

### 5.2 RPCs المتأثرة (11 RPCs)

| الـ RPC | التعديل المطلوب |
|---|---|
| `get_live_workday_overview` | إضافة `AND ep.classification = 'operational'` في كل CTE |
| `get_team_map` | إضافة `AND ep.classification = 'operational'` |
| `get_my_workday_status` | إضافة `classification` في الـ response |
| `get_work_hours_ledger` | إضافة `AND ep.classification = 'operational'` |
| `get_daily_target_vs_actual` | إضافة `AND ep.classification = 'operational'` |
| `calculate_net_work_hours` | إضافة `AND ep.classification = 'operational'` |
| `get_employee_workday_history` | إضافة `AND ep.classification = 'operational'` |
| `get_workday_settings` | لا تغيير (إعدادات عامة) |
| `start_workday` | يسمح لـ `operational` فقط — يرفض `executive` و `review` |
| `end_workday` | يسمح لـ `operational` فقط |
| `start_break` / `end_break` | يسمح لـ `operational` فقط |

**نمط الفلترة العام**:
```sql
AND (
  -- للمستخدم الحالي (self-service)
  ep.classification = 'operational'
  OR
  -- للسوبر أدمن أو المشرف (قراءة فقط)
  v_has_view_all
)
```

### 5.3 Frontend

**AttendanceRuntimePage**: لا تغيير كبير — `classification` يُستخدم بدلاً من `attendance_enabled !== false` للتحديد:
- `executive` → badge "غير خاضع للتقييم" + زر بدء فقط
- `review` → badge "غير مصنف" + زر بدء فقط + لا KPIs
- `operational` → كامل UI

**Operations Center**: جميع الفلاتر تستبعد `classification != 'operational'`

**Classification Report**: تحديث Phase 1 classification ليعرض:
- Operational (بدلاً من Field + Office)
- Executive (جديد)
- Review (بدلاً من Needs Review)

---

## 6. الحالات بعد التطبيق

| السيناريو | `classification` | `attendance_enabled` | الشاشة | البادجات |
|---|---|---|---|---|
| مندوب ميداني | `operational` | `true` | كامل | ميداني + دوام مرن |
| موظف مكتبي | `operational` | `true` | كامل | مكتبي + دوام ثابت |
| مدير مبيعات (Executive) | `executive` | `false` | فقط بدء/إنهاء | غير خاضع للتقييم |
| سوبر أدمن | `executive` | `false` | فقط بدء/إنهاء | غير خاضع للتقييم |
| موظف لم يُصنف بعد | `review` | حسب ما عُيّن | فقط بدء/إنهاء | غير مصنف |

---

## 7. مثال: `get_live_workday_overview` بعد التعديل

```sql
-- الفرق: إضافة فلتر classification = 'operational' لكل CTE
WITH filtered_employees AS (
    SELECT e.id FROM employees e
    JOIN employee_work_policies ep ON ep.employee_id = e.id
    WHERE e.is_active = true AND ep.classification = 'operational'
    AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
),
-- ... باقي CTEs كما هي مع نفس الفلتر
```

---

## 8. الـ timeline المقترح

| الخطوة | المدة | التفاصيل |
|---|---|---|
| 1. المصادقة على التصميم | اليوم | أنت هنا |
| 2. تحديد الموظفين Executive يدوياً | جلسة واحدة | نحدد معاً من هم الإدارة العليا |
| 3. تطبيق التعديل على قاعدة البيانات | 30 دقيقة | ALTER TABLE + إنشاء سجلات للموظفين بدون policy |
| 4. تعديل RPCs (11 RPCs) | ساعتان | إضافة `classificatoin = 'operational'` |
| 5. تعديل Frontend (حالات البادجات) | ساعة | تحديث AttendanceRuntime + OperationsCenter |
| 6. اختبار | ساعة | التحقق من Executive لا يظهر في أي مكان |

---

## 9. سؤال للمستخدم

من هم الموظفون الذين تعتبرهم **إدارة عليا (Executive)** خارج نظام الحضور؟

القائمة الحالية للموظفين بدون سياسة:

| الاسم | الكود | الإجراء المقترح |
|---|---|---|
| admin | ADMIN-001 | → `executive` |
| REP006, REP007, REP008 | ريبورت | → `operational` (مندوبين ميدانيين) أو `review` |
| WRQ1001-1005 | مخزن | → `operational` (موظفي مخزن) أو `executive` (مشرفي مخزن) |
| باقي الموظفين (إن وجد) | — | → حسب الدور |

هل تريد أن تحدد بنفسك؟ أم تريدني أن أحضر قائمة توصيات بناءً على الـ roles الحالية؟
