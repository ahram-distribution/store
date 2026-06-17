# التحقيق الشامل - صفحة EmployeeWorkdayDetail

**التاريخ**: 2026-06-17  
**الملف المستهدف**: `src/pages/attendance/EmployeeWorkdayDetailPage.tsx`  
**الغرض**: تحديد الأسباب الجذرية لفراغ البيانات في صفحة تفاصيل يوم العمل

---

## نظرة عامة على تدفق البيانات

الصفحة عند التحميل تستدعي 6 RPCs:

| # | RPC | المصدر | الغرض |
|---|-----|--------|-------|
| 1 | `get_governed_employee` | `20260607_recovery_missing_functions.sql` | اسم الموظف |
| 2 | `get_employee_workday_history` | `20260724_identity_integration_layer.sql` (آخر إصدار) | بيانات الجلسة + KPI + التاريخ |
| 3 | `get_employee_day_map` | `20260722_fix_attendance_rpcs_visibility.sql` (آخر إصدار) | الخريطة + المسار + الزيارات |
| 4 | `get_employee_day_timeline` | `20260722_fix_attendance_rpcs_visibility.sql` (آخر إصدار) | الأحداث الزمنية |
| 5 | `get_daily_target_vs_actual` | `20260724_identity_integration_layer.sql` (آخر إصدار) | التقدم مقابل الهدف |
| 6 | `get_work_hours_ledger` | **غير موجود في أي SQL migration** | سجل ساعات العمل |

ترتيب الهجرات (من الأقدم للأحدث):
- `20260717_fix_employee_day_map_route.sql` ← map مع long_stops
- `20260720_unify_upper_management_role.sql` ← timeline مع events + map مع long_stops
- **`20260722_fix_attendance_rpcs_visibility.sql`** ← **مسح** long_stops من map و events من timeline
- `20260723_phase7_work_hours_analytics_v2.sql` ← history بدون resolve_employee_id
- `20260724_identity_integration_layer.sql` ← history + target مع resolve_employee_id (صحيح)

---

## 1. ✅ بطاقة ملخص وقت البداية/النهاية - غير موجودة في UI

### المشكلة
لا توجد بطاقة عرض لوقت بدء اليوم ووقت إنهائه في أعلى الصفحة.

### التحليل
- كائن `session` (من `get_employee_workday_history`) يحتوي على `start_time` و `end_time` (السطر 21-22 في `SessionData`).
- الـ UI (الأسطر 263-278) يعرض فقط KPI مصغر (صافي العمل، طلبات، مبيعات، تحصيل، عملاء جدد، زيارات، مسافة، استراحة).
- `start_time`/`end_time` لا يُستخدمان أبداً في العرض، رغم وجودهما في البيانات.

### الجذر
**نقص في واجهة المستخدم (UI gap)** — البيانات متوفرة ولكن غير معروضة.

### الإصلاح
إضافة بطاقة أو شريط معلومات يعرض:
- 🟢 وقت بدء اليوم
- 🔴 وقت إنهاء اليوم (أو "مستمر" إذا لم ينتهِ)
- ⏱ إجمالي مدة اليوم
- 📍 الحضور (status badge)

---

## 2. ❌ سجل ساعات العمل (Work Hours Ledger) فارغ

### المشكلة
قسم "📋 سجل ساعات العمل" يظهر "لا توجد بيانات".

### التحليل
- كود الخدمة (`src/services/attendance.ts:284-294`) يستدعي:
  ```ts
  supabase.rpc('get_work_hours_ledger', { p_token, p_employee_id, p_from, p_to })
  ```
- كود الصفحة (`EmployeeWorkdayDetailPage.tsx:198-200`) يستدعي نفس الـ RPC.
- **الدالة `get_work_hours_ledger` غير موجودة مطلقاً في أي ملف SQL في `supabase/migrations/`.**
- تم البحث في جميع ملفات `.sql` باستخدام `Select-String -Pattern "get_work_hours_ledger"` ولم يُعثر على أي `CREATE FUNCTION`.
- الدالة مذكورة فقط في:
  - `src/services/attendance.ts:284` (استدعاء)
  - `src/pages/attendance/EmployeeWorkdayDetailPage.tsx:198` (استدعاء)
  - `docs/` (توثيق فقط)
- Supabase سيعيد خطأ "function public.get_work_hours_ledger does not exist" → `ledgerRes.data` يساوي `undefined` → الشرط `(!workHoursLedger || workHoursLedger.length === 0)` يكون `true`.

### الجذر
**الدالة لم تُنشأ مطلقاً في قاعدة البيانات** — لا توجد في أي SQL migration.

### الإصلاح
- **الخيار A**: إنشاء دالة `get_work_hours_ledger` الجديدة التي تجمع بيانات من `workday_sessions` و `workday_breaks` و `tracking_points` وتعيد سجل زمني.
- **الخيار B**: إزالة استدعاء الـ RPC واستخدام بيانات موجودة (مثل Timeline events) بدلاً منه.
- **الخيار C**: إزالة القسم بالكامل إذا كان غير ضروري.

---

## 3. ❌ الخط الزمني (Timeline) فارغ

### المشكلة
قسم "⏳ الخط الزمني" يظهر "لا توجد أحداث".

### التحليل
- الـ UI (`EmployeeWorkdayDetailPage.tsx:63-80`) يتوقع هيكل:
  ```ts
  interface TimelineData {
    employee: { id, full_name, code, role_name, manager_name }
    session: { id, status, start_time, end_time, attendance_status }
    events: TimelineEvent[]
  }
  ```
- الصفحة تفحص `timeline?.events` في السطر 409:
  ```tsx
  {(!timeline?.events || timeline.events.length === 0) ? (
    <div>لا توجد أحداث</div>
  ) : (...)}
  ```
- **آخر إصدار** من `get_employee_day_timeline` هو من `20260722_fix_attendance_rpcs_visibility.sql:71-104`.  
  هذا الإصدار يرجع:
  ```json
  {
    "session": {...},
    "points": [...],
    "breaks": [...],
    "visit_links": [...],
    "time_distribution": {...},
    "attendance_status": "...",
    "late_minutes": ...,
    "early_departure_minutes": ...
  }
  ```
  **لا يحتوي على `events` ولا على `employee`**.
- الإصدار الصحيح (من `20260611_phase6_attendance_v2_complete.sql:140-283`) كان يعيد:
  ```json
  {
    "employee": {...},
    "session": {...},
    "events": [
      { "time": "...", "type": "workday_start", "title": "بدء يوم العمل", "description": "", "latitude": null, "longitude": null, "metadata": {...} },
      { "time": "...", "type": "order_created", ... },
      { "time": "...", "type": "collection_taken", ... },
      { "time": "...", "type": "new_customer", ... },
      ...
    ]
  }
  ```
- الـ Phase 6 كان يحتوي على أحداث: بداية اليوم، نهاية اليوم، استراحات، زيارات، طلبات، تحصيلات، عملاء جدد.
- **`20260722_fix_attendance_rpcs_visibility.sql` استبدل الـ Phase 6 بهذا الإصدار القديم المبسط.**

### الجذر
**هجرة `20260722_fix_attendance_rpcs_visibility.sql` مسحت الإصدار المتقدم من `get_employee_day_timeline` واستبدلته بإصدار قديم لا يحتوي على `events`.**

### الإصلاح
إعادة كتابة `get_employee_day_timeline` بناءً على نسخة Phase 6 (`20260611_phase6_attendance_v2_complete.sql:140-283`) مع:
- استخدام `check_capability` بدلاً من `is_upper_management` (للامتثال لـ `20260720_unify_upper_management_role.sql`)
- استخدام `resolve_employee_id()` للأوردرات والتحصيلات والعملاء بدلاً من `o.owner_id = p_employee_id` المباشر
- إضافة مفتاح `net_minutes` للمقارنة مع KPI

---

## 4. ❌ التوقفات الطويلة (Long Stops) فارغة

### المشكلة
قسم "⏸️ التوقفات الطويلة" يظهر "لا توجد توقفات طويلة".

### التحليل
- الـ UI (`EmployeeWorkdayDetailPage.tsx:486-513`) يتوقع من `DayMapData`:
  ```ts
  long_stops: LongStop[]
  long_stops_count: number
  long_stops_total_minutes: number
  ```
- كود فك التشفير (السطر 190):
  ```ts
  long_stops: (raw.long_stops as LongStop[]) ?? [],
  ```
- **آخر إصدار** من `get_employee_day_map` هو من `20260722_fix_attendance_rpcs_visibility.sql:5-69`.  
  هذا الإصدار يرجع:
  ```json
  {
    "session": {...},
    "start_point": {...},
    "end_point": {...},
    "route_polyline": [...],
    "visit_locations": [...],
    "total_points": ...,
    "total_distance_meters": ...,
    "total_distance_km": ...
  }
  ```
  **لا يحتوي على `long_stops` ولا `long_stops_count` ولا `long_stops_total_minutes`.**
- الإصدار الصحيح (من `20260717_fix_employee_day_map_route.sql:174-200`) كان يحتوي على:
  ```json
  {
    "route": [...],
    "long_stops": [...],
    "long_stops_count": ...,
    "long_stops_total_minutes": ...,
    "visit_locations": [...],
    "total_distance_meters": ...,
    "total_distance_km": ...,
    ...
  }
  ```
- حتى الإصدار الأقدم (`Phase 6: 20260611_phase6_attendance_v2_complete.sql:289-426`) كان يحتوي على `long_stops`.
- **`20260722_fix_attendance_rpcs_visibility.sql` أزال `long_stops` بالكامل من الاستعلام.**

### الجذر
**نفس المشكلة — هجرة `20260722_fix_attendance_rpcs_visibility.sql` مسحت `long_stops` من `get_employee_day_map`.**

### الإصلاح
إعادة `long_stops` إلى `get_employee_day_map` بناءً على نسخة `20260717_fix_employee_day_map_route.sql` مع:
- استخدام `check_capability` بدلاً من `is_upper_management`
- الاحتفاظ بمرشحات GPS drift (accuracy, min_distance, speed)
- الحفاظ على `route` بدلاً من `route_polyline` (لأن الـ UI يستخدم `raw.route_polyline ?? raw.route` في السطر 182)

---

## 5. ❌ سجل الاستراحات (Break History) فارغ

### المشكلة
قسم "☕ سجل الاستراحات (تفصيلي)" يظهر "لا توجد بيانات استراحات".

### التحليل
- مكوّن `BreakHistoryTable` (`EmployeeWorkdayDetailPage.tsx:616-689`) يستخرج فترات الاستراحة من `timeline.events`:
  ```ts
  for (const ev of sorted) {
    if (ev.type === 'break_start') { currentBreak = ev }
    else if (ev.type === 'break_end' && currentBreak) { ... }
  }
  ```
- الكود يعتمد كلياً على وجود `break_start` و `break_end` في `timeline.events`.
- بما أن `timeline.events` فارغ (المشكلة رقم 3)، فإن سجل الاستراحات فارغ أيضاً.

### الجذر
**تبعية غير مباشرة على المشكلة رقم 3 — Break History يعتمد على Timeline Events التي لا توجد.**

### الإصلاح
سيُصلح تلقائياً عند إصلاح `get_employee_day_timeline` (المشكلة رقم 3)، لأن الـ Phase 6 كان يتضمن أحداث `break_start` و `break_end`.

بديل: استخدام `workday_breaks` مباشرة من قاعدة البيانات بدلاً من استخلاصها من `timeline.events`.

---

## 6. ✅ KPI Linking (identity_id) - متابعة

### التحليل
سؤال المستخدم: هل الأصفار في KPIs (orders=0, sales=0, collections=0) بسبب أن `orders.owner_id` في بعض الأحيان يشير إلى `identities.id` وليس `employees.id`؟

**الجواب: لا، هذه المشكلة تم إصلاحها بالفعل في أحدث إصدار من RPCs.**

### التفاصيل
- `get_employee_workday_history` (آخر إصدار: `20260724_identity_integration_layer.sql:35-147`) يستخدم `resolve_employee_id()` في استعلامات الأوردرات والتحصيلات والعملاء:
  ```sql
  LEFT JOIN (
    SELECT public.resolve_employee_id(o.owner_id) AS resolved_employee_id,
        o.created_at::date AS d,
        COUNT(*)::int AS order_count,
        COALESCE(SUM(o.total_amount), 0) AS sales_value
    FROM public.orders o
    GROUP BY public.resolve_employee_id(o.owner_id), o.created_at::date
  ) od ON od.resolved_employee_id = wds.employee_id AND od.d = wds.date
  ```
- دالة `resolve_employee_id()`:
  ```sql
  SELECT COALESCE(
    (SELECT e.id FROM employees e WHERE e.id = target_id),
    (SELECT e.id FROM employees e WHERE e.identity_id = target_id)
  );
  ```
  هذا يعني: إذا كان `owner_id` هو بالفعل `employees.id` → يُستخدم مباشرة.  
  إذا كان `owner_id` هو `identities.id` → يُحل إلى `employees.id` عبر `employees.identity_id`.

### تحقق يدوي مقترح
لتأكيد أن المشكلة ليست في الـ linking، يمكن تشغيل الاستعلام التالي مباشرة على قاعدة البيانات:

```sql
-- التحقق من أن resolve_employee_id يعمل بشكل صحيح
SELECT 
  o.owner_id,
  resolve_employee_id(o.owner_id) AS resolved_id,
  o.created_at::date AS order_date,
  COUNT(*) AS order_count
FROM orders o
WHERE o.created_at::date = '2026-06-17'
  AND (o.owner_id = '{{employee_id}}' OR resolve_employee_id(o.owner_id) = '{{employee_id}}')
GROUP BY o.owner_id, resolve_employee_id(o.owner_id), o.created_at::date;
```

إذا أعاد الاستعلام صفر نتائج، فهذا يعني أنه لا توجد طلبات لذلك الموظف في ذلك اليوم (بيانات، وليس خطأ ربط).

### ملاحظة هامة
- `get_employee_day_timeline` الحالي من `20260722` لا يشمل الأوردرات والتحصيلات والعملاء إطلاقاً.  
  الـ Phase 6 كان يتضمنهم لكن بدون `resolve_employee_id()`.  
  عند إعادة بناء الـ timeline (المشكلة رقم 3)، **يجب استخدام `resolve_employee_id()`** للأوردرات والتحصيلات والعملاء.

---

## جدول ملخص

| # | المشكلة | الحالة | الجذر | الأولوية |
|---|---------|--------|-------|----------|
| 1 | بطاقة البداية/النهاية | ✅ بيانات متوفرة - غير معروضة | UI gap | P2 |
| 2 | سجل ساعات العمل | ❌ فارغ | RPC غير موجود في SQL | P1 |
| 3 | الخط الزمني | ❌ فارغ | `20260722` مسح events | P0 |
| 4 | التوقفات الطويلة | ❌ فارغة | `20260722` مسح long_stops | P0 |
| 5 | سجل الاستراحات | ❌ فارغ | تابع لـ #3 | P1 |
| 6 | KPI linking | ✅ سليم | لا إصلاح مطلوب | - |

**ترتيب الأولوية المقترح للإصلاح:**
1. **P0**: إصلاح `get_employee_day_map` ← إعادة long_stops
2. **P0**: إصلاح `get_employee_day_timeline` ← إعادة events مع resolve_employee_id
3. **P1**: إنشاء/إصلاح مصدر بيانات لـ Work Hours Ledger
4. **P1**: سجل الاستراحات (سيُصلح مع الـ timeline)
5. **P2**: إضافة بطاقة البداية/النهاية في الـ UI

---

## الملفات المتأثرة

| الملف | نوع التغيير |
|-------|------------|
| `supabase/migrations/NNNNNN_fix_employee_day_map.sql` | إصلاح RPC مع long_stops + check_capability |
| `supabase/migrations/NNNNNN_fix_employee_day_timeline.sql` | إصلاح RPC مع events + resolve_employee_id |
| `supabase/migrations/NNNNNN_create_get_work_hours_ledger.sql` | إنشاء RPC جديد أو إزالته |
| `src/pages/attendance/EmployeeWorkdayDetailPage.tsx` | إضافة بطاقة البداية/النهاية |
| `src/services/attendance.ts` | تعديل إذا تغير توقيع RPC |
