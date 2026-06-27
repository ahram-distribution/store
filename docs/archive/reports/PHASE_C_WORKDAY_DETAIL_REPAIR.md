# Phase C — Workday Detail Repair

> **تاريخ الإنشاء**: 22 يونيو 2026
> **الحالة**: مكتمل
> **القرار التنفيذي**: `docs/01-ARCHITECTURE/FIELD_REP_PRESENCE_POLICY.md`

---

## 1. المشكلة

### شاشة EmployeeWorkdayDetailPage تُظهر:

- لا توجد نقاط تتبع
- لا توجد أحداث
- 0 كم
- لا توجد بيانات ساعات عمل
- لا توجد استراحات

**رغم وجود نشاط فعلى للمندوب** (زيارات، طلبات، يوم عمل).

### الأسباب الجذرية (من `ROOT_CAUSE_EMPLOYEE_WORKDAY_DETAIL.md`)

| # | السبب | المستوى |
|---|-------|--------|
| A | `get_work_hours_ledger` RPC غير موجود — سجل ساعات العمل لا يعمل | 🔴 P0 |
| B | صلاحية `attendance.view_timeline` غير موجودة للمستخدم → map + timeline يعيدان FORBIDDEN | 🔴 P0 |
| C | `get_daily_target_vs_actual` يشترط `status = 'completed'` → target = 0% لليوم النشط | 🟡 P1 |
| D | `schedule_type` (flexible/fixed_shift/hourly) غير مستخدم في العرض — المندوب يرى "صافي عمل" و"متأخر" رغم أنه دوام مرن | 🟡 P1 |

---

## 2. القرار التنفيذي — نموذج المندوبين

اعتمد قرار جديد يغيّر طريقة حساب ساعات المندوبين (`FIELD_REP_PRESENCE_POLICY.md`):

### للمندوب (`flexible` / `hourly`)

```
مدة التواجد = وقت بدء اليوم → وقت إنهاء اليوم
```

لا خصم استراحات، لا late، لا early departure، لا overtime، لا attendance_status.

**المقاييس المعتمدة**: أيام العمل، ساعات التواجد، الزيارات، الطلبات، التحصيلات، العملاء الجدد، آخر نشاط.

### للموظف المكتبي (`fixed_shift`)

يبقى النظام الحالي: `net_minutes = duration - breaks` + late/early/attendance_status.

---

## 3. دعم الجلسات المتعددة (Multiple Sessions Per Day)

### التحقق من قاعدة البيانات

تم التحقق من `workday_sessions`:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_wds_active_per_day
    ON public.workday_sessions (employee_id, date) WHERE status = 'active';
```

**النتيجة**: الـ UNIQUE constraint يمنع فقط وجود **جلسة active ثانية** لنفس الموظف في نفس اليوم. يسمح بـ **جلسات completed متعددة**.

### التدفق المعتمد

```
08:00 → start_workday()    → session active
12:00 → end_workday()      → session completed
15:00 → start_workday()    → session active (مسموح: لا يوجد active session)
20:00 → end_workday()      → session completed

الإجمالي = (12:00 - 08:00) + (20:00 - 15:00) = 4 + 5 = 9 ساعات تواجد
```

**لا تغيير في الـ Schema مطلوب.** دالة `start_workday` ترجع `ALREADY_ACTIVE` فقط إذا كان هناك session active — بعد إنهائها، تسمح بجلسة جديدة.

---

## 4. التنفيذ

### 4.1 SQL Migration: `20260622_phase_c_workday_detail_repair.sql`

#### 4.1.1 `get_work_hours_ledger` — Polymorphic RPC

| `schedule_type` | محتوى الـ ledger | الحقول في `schedule_info` |
|----------------|-----------------|--------------------------|
| `fixed_shift` | entries مع `activity_type = 'work'` | `presence_minutes`, `net_minutes`, `break_minutes`, `late_minutes`, `early_departure_minutes`, `sessions_count` |
| `flexible` / `hourly` | entries مع `activity_type = 'presence'` | `presence_minutes`, `sessions_count`, `day_start`, `day_end` |

مثال استجابة للمندوب (`flexible`):

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

#### 4.1.2 `get_daily_target_vs_actual` — إصلاح شرط `completed`

| الحالة السابقة | الحالة الجديدة |
|---------------|---------------|
| `v_today_seconds` يُحسب فقط من `status = 'completed'` | للمندوب: يحسب من `status IN ('active', 'completed')` — يشمل الجلسات النشطة |
| `net = presence - break` لجميع الأنواع | للمندوب: `presence = end_time - start_time` بدون خصم break |
| للمكتبي: يبقى `status = 'completed'` + `net = presence - break` كما هو |

### 4.2 EmployeeWorkdayDetailPage — تغييرات الواجهة

| العنصر | للمندوب (`flexible`/`hourly`) | للمكتبي (`fixed_shift`) |
|--------|------------------------------|------------------------|
| ملخص اليوم — بداية/نهاية | ✅ يظهر | ✅ يظهر |
| ملخص اليوم — "مدة التواجد" | ✅ (جديد) يحل محل "صافي العمل" | ❌ مخفي |
| ملخص اليوم — "صافي العمل" | ❌ مخفي | ✅ يظهر |
| ملخص اليوم — "عدد الجلسات" | ✅ (جديد) | ❌ مخفي |
| ملخص اليوم — "الاستراحة" | ❌ مخفي | ✅ يظهر |
| ملخص اليوم — `Badge` (متأخر/ملتزم) | ❌ مخفي | ✅ يظهر |
| Week History — عمود "تواجد"/"صافي" | "تواجد" (duration) | "صافي" (net) |
| Week History — عمود الحالة (متأخر/ملتزم) | ❌ مخفي | ✅ يظهر |
| Week History — ملخص (متأخر/مبكر/ملتزم) | ❌ مخفي | ✅ يظهر |
| Route Map | ✅ فقط إذا `hasViewTimeline` | ✅ فقط إذا `hasViewTimeline` |
| Timeline | ✅ فقط إذا `hasViewTimeline` | ✅ فقط إذا `hasViewTimeline` |
| Tracking Points | ✅ فقط إذا `hasViewTimeline` | ✅ فقط إذا `hasViewTimeline` |
| Long Stops | ✅ فقط إذا `hasViewTimeline` | ✅ فقط إذا `hasViewTimeline` |
| سجل ساعات العمل | "سجل التواجد" مع entries حضور | "سجل ساعات العمل" مع entries عمل |
| سجل الاستراحات | ❌ مخفي بالكامل | ✅ يظهر |

### 4.3 صلاحيات العرض

عندما يكون `attendance.view_timeline` غير ممنوح للمستخدم:
- **لا تظهر** أقسام: Route Map, Timeline, Tracking Points, Long Stops, Break History
- **لا تظهر رسائل** "لا توجد نقاط تتبع" أو "لا توجد أحداث"
- المستخدم يرى فقط Summary Card + Target Progress + Week History + Work Hours Ledger

---

## 5. الاختبارات

### اختبار 1: مندوب (`flexible`) مع جلسة واحدة

```
Database: 1 workday_session (08:00-16:00), 5 visits, 3 orders
→ Summary: بداية 08:00, نهاية 16:00, مدة التواجد 08:00, 5 زيارات, 3 طلبات
→ لا يظهر: استراحة, Badge, late, early
→ Ledger: entry واحد activity_type=presence, duration_minutes=480
```

### اختبار 2: مندوب (`flexible`) مع جلسات متعددة

```
Database: 2 workday_sessions (08:00-12:00, 15:00-20:00)
→ Summary: عدد الجلسات 2, مدة التواجد 09:00
→ Ledger: entryين activity_type=presence
→ Target Progress: مجموع الجلستين (540 دقيقة presence)
```

### اختبار 3: مكتبي (`fixed_shift`)

```
Database: 1 workday_session (09:00-17:00), break 30 دقيقة, status=completed
→ Summary: بداية 09:00, نهاية 17:00, صافي العمل 07:30, استراحة 00:30
→ يظهر: Badge (ملتزم/متأخر), late_minutes, early_departure
→ Ledger: entry مع activity_type=work, schedule_info.net_minutes=450
```

### اختبار 4: مستخدم بدون `view_timeline`

```
→ لا تظهر: Route Map, Timeline, Tracking Points, Long Stops, Break History
→ تظهر: Summary, Target, Week History, Work Hours Ledger
→ لا توجد رسائل "لا توجد بيانات" مضللة
```

### اختبار 5: start_workday بعد end_workday (Multiple Sessions)

```
→ end_workday(session_1) → status = completed
→ start_workday() → session جديدة (لا تظهر ALREADY_ACTIVE)
→ workday_sessions: صفان لنفس الموظف + التاريخ
```

---

## 6. ملفات التغيير

| الملف | الحالة | الوصف |
|-------|--------|-------|
| `supabase/migrations/20260622_phase_c_workday_detail_repair.sql` | 🆕 جديد | إنشاء `get_work_hours_ledger` + إصلاح `get_daily_target_vs_actual` |
| `src/pages/attendance/EmployeeWorkdayDetailPage.tsx` | 🔄 تعديل | تكامل `schedule_type`, إخفاء الأقسام حسب الصلاحية والنوع |
| `docs/01-ARCHITECTURE/FIELD_REP_PRESENCE_POLICY.md` | 🔄 تعديل | Source of Truth |
| `docs/archive/reports/PHASE_C_WORKDAY_DETAIL_REPAIR.md` | 🆕 جديد | هذا الملف — التوثيق الكامل |
| `docs/archive/reports/FINAL_EXECUTIVE_REPORT.md` | 🔄 تعديل | تحديث بحالة Phase C |

---

## 7. النشر

```
1. Build → ✅ npm run build
2. Verify → No errors
3. Commit → git commit -m "feat(tracking): Phase C — Workday Detail Repair"
4. Push → git push
5. Deploy → Auto-deploy via GitHub

Commit: [غير معروف بعد]
```

---

## 8. القرارات المستقبلية المعلقة

| القرار | السياق | التاريخ المقترح |
|--------|--------|----------------|
| منح `attendance.view_timeline` لمشرف مبيعات | حالياً مشرف المبيعات لا يرى الخريطة والتايم لاين — قد يحتاجها للإشراف اليومي | مستقبلاً |
| إضافة toggle يدوي لـ `schedule_type` في لوحة الإدارة | حالياً `flexible` يُصنف تلقائياً — لو فيه مندوب يحتاج `fixed_shift`، يحتاج واجهة | بعد Phase C |
| Productivity Runtime Dashboard | يستخدم المقاييس المعتمدة من `FIELD_REP_PRESENCE_POLICY.md` | بعد اعتماد هذا التقرير |
