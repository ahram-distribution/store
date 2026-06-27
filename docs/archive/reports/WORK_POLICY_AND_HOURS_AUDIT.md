# Work Policy and Hours Audit

> **الهدف**: جرد نظام سياسات العمل وساعات العمل بالكامل قبل تنفيذ Phase C — Workday Detail Repair.
> 
> **المبدأ**: لا إصلاح في هذا التقرير. فقط توثيق للواقع الحالي والفجوات.

---

## 1. السياسات الثلاث — هل هي موجودة فعلاً؟

### ✅ النوع الأول: دوام ثابت (`fixed_shift`)

**موجود فعلاً** في `employee_work_policies.schedule_type`.

| الحقل | القيمة |
|-------|--------|
| شيفرة التخزين | `'fixed_shift'` |
| العمود | `schedule_type` في `employee_work_policies` |
| مواقيت الدوام | `shift_start_time` و `shift_end_time` (أو fallback إلى `workday_settings.official_start_time` / `official_end_time`) |
| سماحية التأخير | `late_threshold_minutes` (أو fallback إلى `workday_settings.late_threshold_minutes`) |
| سماحية الانصراف المبكر | `early_departure_threshold_minutes` (أو fallback) |

**نظام العمل**: الموظف لديه وردية محددة. يُحسب التأخير والانصراف المبكر بالنسبة للوردية. مثال: 10:00 صباحاً → 08:00 مساءً.

**الاستخدام الحالي**: يُطبق تلقائياً على `work_location = 'office'` (الموظفين المكتبيين).

---

### ✅ النوع الثاني: دوام مرن (`flexible`)

**موجود فعلاً** في `employee_work_policies.schedule_type`.

| الحقل | القيمة |
|-------|--------|
| شيفرة التخزين | `'flexible'` |
| العمود | `schedule_type` في `employee_work_policies` |
| الساعات المطلوبة | `required_daily_hours` (افتراضي 8) |

**نظام العمل**: لا يوجد وقت بداية أو نهاية محدد. المطلوب هو تحقيق `required_daily_hours` ساعات صافي عمل خلال الـ 24 ساعة. لا يوجد مفهوم تأخير أو انصراف مبكر.

**الاستخدام الحالي**: يُطبق تلقائياً على `work_location = 'field'` (الموظفين الميدانيين — مندوبي المبيعات). هذا هو النوع الأكثر استخداماً.

---

### ✅ النوع الثالث: بالساعة (`hourly`)

**موجود فعلاً** في `employee_work_policies.schedule_type`.

| الحقل | القيمة |
|-------|--------|
| شيفرة التخزين | `'hourly'` |
| العمود | `schedule_type` في `employee_work_policies` |
| الساعات المتوقعة | `required_daily_hours` (اختياري) |

**نظام العمل**: موظف بعقود بالساعة. لا يوجد دوام ثابت ولا دوام مرن. الهدف هو تتبع ساعات العمل الفعلية.

**ملاحظة**: هذا النوع موجود في CHECK constraint لكن **لا توجد سياسة تصنيف تلقائي** تنتج هذا النوع. دالة `classify_employee_work_policies()` تُنتج فقط `'flexible'` (للميدانيين) و `'fixed_shift'` (للمكتبيين). النوع `'hourly'` لم يُسند لأي موظف تلقائياً — يحتاج تعيين يدوي عبر `upsert_employee_work_policy`.

---

## 2. أين يتم تخزين نوع السياسة؟

### الجدول الرئيسي: `public.employee_work_policies`

| العمود | النوع | القيم الافتراضية | ملاحظات |
|--------|------|-----------------|---------|
| `id` | `uuid PK` | `gen_random_uuid()` | |
| `employee_id` | `uuid FK` | — | `UNIQUE` — موظف واحد/سياسة واحدة |
| `work_location` | `varchar(10)` | `'field'` | CHECK: `'field'`, `'office'` |
| `schedule_type` | `varchar(20)` | `'flexible'` | CHECK: `'fixed_shift'`, `'flexible'`, `'hourly'` |
| `required_daily_hours` | `decimal(4,1)` | `8` | للساعات المطلوبة (لـ flexible, hourly) |
| `shift_start_time` | `time` | `null` | للدوام الثابت فقط |
| `shift_end_time` | `time` | `null` | للدوام الثابت فقط |
| `late_threshold_minutes` | `integer` | `null` | سماحية التأخير (يسقط على الإعدادات العامة إذا null) |
| `early_departure_threshold_minutes` | `integer` | `null` | سماحية الانصراف المبكر |
| `tracking_required` | `boolean` | `true` | هل يجب تتبع GPS |
| `attendance_enabled` | `boolean` | `true` | هل معفي من الحضور |

### الإعدادات العامة: `public.workday_settings`

هذا جدول singleton (صف واحد) يحوي الإعدادات الافتراضية:

| العمود | القيمة الافتراضية |
|--------|------------------|
| `official_start_time` | `'09:00'` |
| `official_end_time` | `'17:00'` |
| `late_threshold_minutes` | `0` |
| `early_departure_threshold_minutes` | `0` |
| `location_interval_seconds` | `300` (5 دقائق) |

### ربط السياسة بالجلسة: `workday_sessions.work_policy_id`

```
employee_work_policies
    ↓ وقت بدء يوم العمل
workday_sessions.work_policy_id (snapshot — يحفظ السياسة وقت بدء اليوم)
```

هذا مهم: عند بدء يوم العمل، تُقرأ سياسة الموظف وتُحفظ مع الجلسة. هذا يسمح بالتقارير التاريخية باستخدام السياسة وقت بدء اليوم وليس السياسة الحالية.

---

## 3. الـ RPCs المستخدمة في حساب ساعات العمل

### 3.1 RPCs حساب ساعات العمل لكل جلسة

| الـ RPC | مكان الحساب | الصيغة |
|--------|------------|--------|
| `get_employee_workday_history` | SQL — `net_minutes = GREATEST(duration_minutes - break_minutes, 0)` | `duration = end_time - start_time` بالدقائق. `break = SUM(duration_seconds) / 60` |
| `get_my_workday_status` | SQL — `v_net_work_minutes := v_duration_minutes - (v_break_total_seconds / 60)` | نفس الصيغة |
| `get_completed_workdays_history` | SQL — `SUM(GREATEST(duration_minutes - break_minutes, 0)) AS total_net_minutes` | نفس الصيغة |
| `get_daily_target_vs_actual` | SQL — `v_today_net_seconds = SUM(...)` | `duration_seconds - break_seconds`, يشترط `status = 'completed'` |
| `get_employee_day_timeline` | SQL — UNION ALL من الأحداث | لا يحسب ساعات — فقط يُرجع الأحداث مرتبة زمنياً |

### 3.2 RPCs عرض ساعات العمل

| الـ RPC | يعرض | يستخدم لـ |
|--------|------|----------|
| `get_employee_workday_history` | `net_minutes`, `break_minutes`, `duration_minutes` لكل جلسة + summary | ملخص اليوم (EmployeeWorkdayDetailPage) |
| `get_daily_target_vs_actual` | `current_net_seconds`, `current_net_hours`, `progress_pct`, `remaining_seconds` | شريط التقدم في الصفحة |
| `get_my_workday_status` | `net_work_minutes`, `required_daily_hours` | شاشة المندوب نفسه |

### 3.3 RPC المفقود: `get_work_hours_ledger`

**غير موجود في أي ملف SQL** من أصل 104+ ملفات.

**الوظيفة المتوقعة** (من استدعاءات TypeScript):

```sql
-- Expected signature:
get_work_hours_ledger(p_token uuid, p_employee_id uuid, p_from date, p_to date) RETURNS jsonb
```

**البنية المتوقعة** (من `WorkHoursLedgerEntry` interface):

```json
{
  "ledger": [
    {
      "start_time": "2026-06-22T10:00:00",
      "end_time": "2026-06-22T10:45:00",
      "activity_type": "work",
      "duration_minutes": 45,
      "description": null
    },
    {
      "start_time": "2026-06-22T10:45:00",
      "end_time": "2026-06-22T10:55:00",
      "activity_type": "break",
      "duration_minutes": 10,
      "description": "استراحة شاي"
    }
  ]
}
```

**الأنشطة المتوقعة** (من الكود):
| `activity_type` | التصنيف |
|----------------|---------|
| `work` | عمل — الفترات التي لا يوجد فيها break/visit/idle |
| `break` | استراحة — من `workday_breaks` |
| `idle` | توقف — فجوات بدون نشاط (لم يحسب لها break رسمي) |
| `visit` | زيارة — من `visits.check_in_at` → `check_out_at` |

---

## 4. فجوات النظام الحالي

### فجوة 1: `get_work_hours_ledger` غير موجود

| التأثير | الشدة |
|---------|-------|
| قسم "سجل ساعات العمل" لا يعمل في EmployeeWorkdayDetailPage | 🔴 **P0** |
| Cannot deploy Phase C without this RPC | 🔴 **P0** |

### فجوة 2: `schedule_type` غير مستخدم في حسابات ساعات العمل

كل RPCs حساب ساعات العمل تستخدم نفس الصيغة (`GREATEST(duration - break, 0)`) بغض النظر عن `schedule_type`:

- **لـ `fixed_shift`**: تحتاج حساب التأخير (`late_minutes`) والانصراف المبكر (`early_departure_minutes`). هذه محسوبة حالياً لكنها مخزنة في `attendance_status` فقط (late, early_departure, compliant). لا توجد RPC واضحة تُرجع التأخير بالدقائق لكل يوم.

- **لـ `flexible`**: `late_minutes` و `early_departure_minutes` غير منطقية — يجب أن تكون 0 أو null. لا يوجد `status = 'completed'` شرط — لكن `get_daily_target_vs_actual` يشترط `status = 'completed'` لجميع الأنواع.

- **لـ `hourly`**: `attendance_status` (late/early/compliant) غير مناسب — يجب أن يكون `null` أو `'hourly'`.

### فجوة 3: `get_daily_target_vs_actual` يشترط `status = 'completed'`

لأي session نشط اليوم:
```
v_today_net_seconds = 0 (لأن status != 'completed')
progress_pct = 0%
remaining_seconds = 8 ساعات
```

هذا خطأ لجميع الأنواع الثلاثة — الـ session النشط اليوم يجب أن يحسب ساعاته حتى لو لم ينتهِ.

### فجوة 4: لا يوجد تكامل بين `schedule_type` وشاشة Workday Detail

الشاشة الحالية:
- تعرض `late_minutes` للجميع (حتى `flexible` و `hourly`)
- تعرض `early_departure_minutes` للجميع
- تظهر `attendance_status` (متأخر/ملتزم/مبكر) لجميع الأنواع

ولهذا قد يظهر لمندوب ميداني (`flexible`) أنه "متأخر" رغم أنه ليس لديه دوام ثابت.

### فجوة 5: `attendance.view_timeline` محدد لنوع المستخدم

**من لديه `attendance.view_timeline`:**

| المستخدم | `view_timeline`؟ | يراه في الشاشة؟ |
|----------|-----------------|----------------|
| الإدارة العليا (ياسر، محمد، علي، محمود) | ✅ | Route Map + Timeline + Tracking Points + Breaks |
| مدير البيع | ✅ | كل التفاصيل |
| أدمن / سوبر أدمن | ✅ | كل التفاصيل |
| مشرف مبيعات | ❌ | فقط Summary + Week History (بدون خريطة، بدون أحداث، بدون ساعات تفصيلية) |

**الحالي**: مشرف مبيعات يرى `session` موجود لكن map/timeline يعيدان FORBIDDEN → 5 أقسام فارغة.

---

## 5. تصميم `get_work_hours_ledger` الصحيح

### 5.1 متطلبات الأنواع الثلاثة

| النوع | الحقول المطلوبة في الـ Ledger |
|-------|------------------------------|
| `fixed_shift` | `work`, `break`, `visit`, `idle` + `late_minutes`, `early_departure_minutes`, `attendance_status` |
| `flexible` | `work`, `break`, `visit`, `idle` + `net_minutes`, `remaining_seconds`, `progress_pct` |
| `hourly` | `work`, `break`, `idle` (لا visits إجبارية) + `total_net_minutes` فقط |

### 5.2 بنية الـ Ledger المقترحة

```json
{
  "ledger": [
    {
      "start_time": "2026-06-22T10:00:00",
      "end_time": "2026-06-22T10:45:00",
      "activity_type": "work",
      "duration_minutes": 45,
      "description": null
    }
  ],
  "schedule_info": {
    "schedule_type": "flexible",           // fixed_shift | flexible | hourly
    "required_daily_hours": 8,
    "current_net_minutes": 240,
    "remaining_minutes": 240,
    "progress_pct": 50.0,
    "attendance_status": null              // فقط لـ fixed_shift: late | compliant | early_departure
  }
}
```

### 5.3 مصدر كل نشاط في الـ Ledger

| `activity_type` | المصدر | كيف نحسب |
|----------------|--------|---------|
| `break` | `workday_breaks` | `break_start` → `break_end`. `duration_seconds` موجود. |
| `visit` | `visits` | `check_in_at` → `check_out_at`. طول الزيارة = `check_out_at - check_in_at`. |
| `work` | محسوب | الزمن المتبقي بعد خصم break + visit من إجمالي مدة الجلسة. **التحدي**: كيف نفرق بين `work` و `idle`؟ الفرق الوحيد هو فجوات GPS. |
| `idle` | `tracking_points` فجوات | فجوة > 5 دقائق بين نقاط التتبع بدون break رسمي → idle |

**التحدي الأكبر**: التمييز بين `work` و `idle` حالياً يعتمد على فجوات `tracking_points` (أكثر من 5 دقائق = idle). هذا متاح فقط لمن لديهم `tracking_required = true`. للموظفين المكتبيين (`tracking_required = false`) لا توجد نقاط تتبع → `work` هو كل وقت الجلسة.

### 5.4 صيغة الحساب لكل `schedule_type`

#### `fixed_shift`:
```
duration = end_time - start_time (بالدقائق)
late = start_time > shift_start_time + late_threshold
early_departure = end_time < shift_end_time - early_departure_threshold
attendance_status = CASE WHEN late AND early_departure THEN 'late_and_early'
                        WHEN late THEN 'late'
                        WHEN early_departure THEN 'early_departure'
                        ELSE 'compliant' END
```

#### `flexible`:
```
net_minutes = duration_minutes - break_minutes - visit_minutes?
required = required_daily_hours * 60
progress_pct = (net_minutes / required) * 100
remaining = GREATEST(required - net_minutes, 0)
# لا يوجد late/early_departure
```

#### `hourly`:
```
net_minutes = duration_minutes - break_minutes
# لا يوجد required, لا progress, لا late/early
```

---

## 6. ملخص الفجوات والتأثير

| # | الفجوة | النوع | التأثير على Workday Detail |
|---|--------|-------|---------------------------|
| 1 | `get_work_hours_ledger` غير موجود | 🔴 P0 | قسم "سجل ساعات العمل" لا يعمل |
| 2 | `schedule_type` غير مستخدم في الحسابات | 🟡 P1 | `flexible` يظهر متأخراً; `hourly` يظهر attendance_status غير صحيح |
| 3 | `get_daily_target_vs_actual` يشترط `completed` | 🔴 P0 | Target progress = 0% لليوم النشط |
| 4 | `attendance.view_timeline` محدد | 🟡 P1 | مشرف مبيعات يرى 5 أقسام فارغة |
| 5 | `work` vs `idle` غير محسوبين بدون tracking_points | 🟡 P2 | للموظفين المكتبيين idle = 0 دائماً |

---

## 7. توصيات التصميم قبل Phase C

### 7.1 إصلاح `get_work_hours_ledger` أولاً
- إنشاء RPC جديد باسم `get_work_hours_ledger`
- يدعم `p_token`, `p_employee_id`, `p_from`, `p_to`
- يرجع `{ ledger: [...], schedule_info: {...} }`
- الأنشطة: `work`, `break`, `visit`, `idle` مع مراعاة `tracking_required` (إذا false، idle = 0)

### 7.2 إصلاح `get_daily_target_vs_actual`
- إزالة شرط `status = 'completed'`
- لليوم الحالي: حساب `net_seconds` لكل session (حتى active)
- لليوم الماضي: استخدام آخر session (كما هو الآن)

### 7.3 تكامل `schedule_type` مع واجهة Workday Detail
- إذا `schedule_type = 'flexible'`: إخفاء `attendance_status` و `late_minutes` و `early_departure_minutes`
- إذا `schedule_type = 'hourly'`: إخفاء التأخير والانصراف المبكر والـ attendance_status
- إذا `schedule_type = 'fixed_shift'`: إظهار كل شيء مع مقارنة بـ `shift_start_time` / `shift_end_time`

### 7.4 منح `attendance.view_timeline` لمشرف مبيعات (أو إزالة الأقسام الفارغة)
- الخيار A: منح الصلاحية — كل التفاصيل تظهر
- الخيار B: إخفاء الأقسام المعطلة — إذا `view_timeline` غير متاح، لا تظهر الأقسام أصلاً (بدلاً من رسائل "لا توجد")

---

## 8. خريطة الطريق المقترحة — Phase C

```
Step 1 — Audit Complete ✅ (هذا الملف)
    |
Step 2 — Create get_work_hours_ledger RPC
    |   • يدعم الأنواع الثلاثة
    |   • يرجع ledger + schedule_info
    |
Step 3 — Fix get_daily_target_vs_actual
    |   • إزالة شرط status = 'completed'
    |
Step 4 — Fix EmployeeWorkdayDetailPage
    |   • تكامل schedule_type مع العرض
    |   • إخفاء الأقسام الفارغة بدلاً من رسائل "لا توجد"
    |   • تفعيل view_timeline أو إخفاء الأقسام خلف صلاحية
    |
Step 5 — Deploy + Verify
    • Build, Commit, Push
```

**لا تبدأ أي إصلاح قبل اعتماد هذا التصميم.**
