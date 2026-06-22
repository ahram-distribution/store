# Source of Truth — Field Rep Work Policy

> **تاريخ الاعتماد**: 22 يونيو 2026
> **يخص**: Sales Representatives, Field Sales, Collection Representatives
> **الموظفون المكتبيون**: يخضعون لسياساتهم الخاصة (fixed_shift) — هذا القرار لا ينطبق عليهم

---

## المبادئ الأساسية

المندوب ليس عامل شيفت. لا يخضع لـ:
- ❌ تأخير (Late)
- ❌ انصراف مبكر (Early Departure)
- ❌ ساعات إضافية (Overtime)
- ❌ مواعيد شيفت (Shift Compliance)
- ❌ نقاط الحضور (Attendance Score)

---

## تعريف مدة التواجد (المعتمد)

```text
مدة التواجد = وقت بدء اليوم → وقت إنهاء اليوم
```

**مثال**: 09:00 → 18:00 = 9 ساعات

**بدون خصم**: لا تُخصم الاستراحات، لا التوقفات، لا idle time.
**بدون إضافة**: لا overtime، لا إضافي.

---

## المقاييس اليومية للمندوب

| المقياس | المصدر | ملاحظات |
|---------|--------|---------|
| وقت بدء العمل | `workday_sessions.start_time` | |
| وقت إنهاء العمل | `workday_sessions.end_time` | |
| مدة التواجد | `end_time - start_time` | بدون خصم |
| عدد الزيارات | `workday_sessions.visit_count` | أو `visits` |
| عدد الطلبات | `orders` via `resolve_employee_id` | |
| عدد التحصيلات | `collections` via `resolve_employee_id` | |
| عدد العملاء الجدد | `customers` via `resolve_employee_id` | |
| آخر نشاط | `last_activity_at` + `last_activity_type` | من RPCs Phase A |

---

## المقاييس الشهرية للمندوب

| المقياس | طريقة الحساب |
|---------|-------------|
| عدد أيام العمل | COUNT distinct dates with sessions |
| عدد الأيام بدون بدء | (أيام الشهر) - (أيام العمل) |
| إجمالي ساعات التواجد | SUM(end_time - start_time) لكل session |
| متوسط ساعات التواجد اليومي | الإجمالي / أيام العمل |
| إجمالي الزيارات | SUM(visit_count) |
| إجمالي الطلبات | SUM(order_count) |
| إجمالي التحصيلات | SUM(collection_amount) |
| إجمالي العملاء الجدد | SUM(new_customer_count) |

---

## مؤشرات الإنتاجية المعتمدة

1. أيام العمل
2. ساعات التواجد
3. الزيارات
4. الطلبات
5. التحصيلات
6. العملاء الجدد
7. آخر نشاط

**فقط**. لا مؤشرات مركبة.

---

## ممنوع استخدامه للمندوبين

- `late_minutes`
- `early_departure_minutes`
- `overtime_minutes`
- `attendance_status` (late, early_departure, compliant)
- `composite_score`
- أي درجة أو نقاط تركيبية

---

## أثر هذا القرار على النظام

### RPCs التي تحتاج تحديث

| الـ RPC | التغيير المطلوب |
|--------|----------------|
| `get_employee_workday_history` | إرجاع `duration_minutes` بدون خصم break. إخفاء `late_minutes`/`early_departure` للمندوبين |
| `get_daily_target_vs_actual` | استخدام `duration_minutes` (بدون خصم) لـ `current_net_seconds` للمندوبين |
| `get_work_hours_ledger` **(جديد)** | يجب أن يرجع فقط حضور + غياب بدون break/idle للمندوبين |
| `get_my_workday_status` | نفس التغيير — duration فقط |

### شاشة EmployeeWorkdayDetailPage — التغييرات

| القسم | للمندوب | للمكتبي (fixed_shift) |
|-------|---------|----------------------|
| مدة التواجد | `end_time - start_time` (بدون خصم) | `net_minutes` (مع خصم break) |
| الاستراحات | **مخفية** | تظهر |
| التأخير/الانصراف المبكر | **مخفية** | تظهر |
| Attendance Status | **مخفية** | تظهر |
| KPI: المسافة | تظهر (إذا tracking_points موجودة) | تظهر |
| KPI: صافي العمل | **مخفية** (تستبدل بـ "مدة التواجد") | تظهر |

### شرط `schedule_type`

التفرقة بين المندوب والمكتبي تعتمد على `schedule_type` في `employee_work_policies`:
- `'flexible'` أو `'hourly'` → دوار ميداني → يطبق القرار أعلاه
- `'fixed_shift'` → مكتبي → يطبق النظام القديم مع late/early/break خصم

---

## خريطة الطريق — Phase C

```
Step 1 — إنشاء get_work_hours_ledger (للمكتبي: مع break/idle. للمندوب: حضور فقط)
Step 2 — إصلاح get_daily_target_vs_actual (إزالة شرط completed + duration بدلاً من net)
Step 3 — تحديث EmployeeWorkdayDetailPage
    • إخفاء late/early/attendance_status للمندوب
    • إظهار "مدة التواجد" بدلاً من "صافي العمل"
    • إخفاء الاستراحات للمندوب
Step 4 — تحديث Productivity Runtime Design (بناءً على المقاييس المعتمدة فقط)
```

---

## جلسات العمل المتعددة (Multiple Sessions Per Day)

معتمد رسمياً. المندوب يمكنه:

1. بدء يوم العمل → 08:00
2. إنهاء اليوم → 12:00
3. العودة وبدء يوم عمل جديد → 15:00
4. إنهاء اليوم → 20:00

**بدون أخطاء، بدون تدخل إداري.**

### دعم قاعدة البيانات

قاعدة البيانات **تسمح** حالياً بذلك. `uq_wds_active_per_day` يمنع فقط:
- جلسة `active` ثانية لنفس الموظف في نفس اليوم

يسمح بـ:
- جلسات `completed` متعددة لنفس الموظف في نفس اليوم ✅
- جلسة `active` واحدة + جلسات `completed` متعددة ✅

### طريقة الحساب

```text
إجمالي ساعات التواجد اليومية = مجموع جميع الجلسات المغلقة + الجلسة المفتوحة
```

**مثال:**
```
08:00 → 12:00 = 4 ساعات
15:00 → 18:00 = 3 ساعات
الإجمالي = 7 ساعات
```

---

## `get_work_hours_ledger` — بنية الـ RPC

### للمندوب (flexible / hourly)

```json
{
  "schedule_type": "flexible",
  "schedule_info": {
    "presence_minutes": 540,
    "sessions_count": 2,
    "day_start": "2026-06-22T08:00:00+02:00",
    "day_end": "2026-06-22T20:00:00+02:00"
  },
  "ledger": [
    { "start_time": "...", "end_time": "...", "activity_type": "presence", "duration_minutes": 240, "description": null },
    { "start_time": "...", "end_time": "...", "activity_type": "presence", "duration_minutes": 300, "description": null }
  ]
}
```

### للمكتبي (fixed_shift)

```json
{
  "schedule_type": "fixed_shift",
  "schedule_info": {
    "presence_minutes": 540,
    "net_minutes": 480,
    "break_minutes": 60,
    "late_minutes": 0,
    "early_departure_minutes": 5,
    "attendance_status": "early_departure",
    "sessions_count": 1
  },
  "ledger": [
    { "start_time": "...", "end_time": "...", "activity_type": "work", "duration_minutes": 240, "description": null }
  ]
}
```

---

> **المرجع**: `docs/WORK_POLICY_AND_HOURS_AUDIT.md` للتحقيق الكامل.
> **المرجع**: `docs/PHASE_C_WORKDAY_DETAIL_REPAIR.md` لتفاصيل التنفيذ.
> **هذا الملف هو Source Of Truth لأي تطوير متعلق بالحضور أو ساعات العمل أو الإنتاجية.**
