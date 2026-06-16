# WORK_HOURS_ANALYTICS_DESIGN

## نظرة عامة — طبقة التحليلات

تعتمد هذه الطبقة على بيانات حقيقية من:
- `workday_sessions` — فترات العمل
- `workday_breaks` — فترات الاستراحة
- `tracking_points` — نقاط التتبع (بعد تشغيل Tracking Runtime)
- `orders` — الطلبات
- `collections` — التحصيلات
- `customers` — العملاء الجدد
- `visits` — الزيارات

**الهدف:** تحويل الحضور من مجرد "بدء/إنهاء يوم" إلى منصة تحليلات إنتاجية متكاملة.

---

## 1. الجداول المستخدمة

### Core — Attendance

| الجدول | العمود | الاستخدام |
|--------|--------|-----------|
| `workday_sessions` | `start_time` | بداية يوم العمل |
| | `end_time` | نهاية يوم العمل |
| | `status` | `active` / `completed` |
| | `date` | تاريخ الجلسة |
| | `attendance_status` | `ontime` / `late` / `early_departure` |
| | `late_minutes` | دقائق التأخير |
| | `early_departure_minutes` | دقائق الانصراف المبكر |
| `workday_breaks` | `break_start` | بداية الاستراحة |
| | `break_end` | نهاية الاستراحة |
| | `duration_seconds` | مدة الاستراحة (تحتسب عند الإنهاء) |

### Tracking

| الجدول | العمود | الاستخدام |
|--------|--------|-----------|
| `tracking_points` | `latitude`, `longitude` | نقاط المسار |
| | `recorded_at` | وقت النقطة |
| | `point_type` | `periodic` / `start` / `end` / `visit_checkin` / ... |
| | `speed_mps`, `heading_degrees` | سرعة واتجاه |

### Productivity

| الجدول | العمود | الاستخدام |
|--------|--------|-----------|
| `orders` | `owner_id` → employee | الطلبات لكل موظف |
| | `total_amount` | قيمة المبيعات |
| | `created_at` | تاريخ الطلب |
| `collections` | `owner_id` → employee | التحصيلات لكل موظف |
| | `amount` | قيمة التحصيل |
| | `created_at` | تاريخ التحصيل |
| `customers` | `owner_id` → employee | العملاء الجدد لكل موظف |
| | `created_at` | تاريخ الإضافة |
| `visits` | `employee_id` | الزيارات لكل موظف |
| | `check_in_at`, `check_out_at` | وقت الزيارة |

---

## 2. طريقة حساب ساعات العمل

### 2.1. مدة العمل الإجمالية

```sql
-- لجلسة مكتملة
duration_minutes = EXTRACT(EPOCH FROM (end_time - start_time)) / 60

-- لجلسة نشطة (لم تنتهِ بعد)
duration_minutes = EXTRACT(EPOCH FROM (now() - start_time)) / 60
```

### 2.2. مدة الاستراحات

```sql
-- لكل جلسة — مجموع duration_seconds من break_end - break_start
total_break_minutes = SUM(duration_seconds) / 60

-- للاستراحة النشطة حالياً (break_end IS NULL):
-- تحتسب من break_start حتى now()
active_break_minutes = EXTRACT(EPOCH FROM (now() - break_start)) / 60
```

### 2.3. صافي ساعات العمل

```sql
net_minutes = duration_minutes - total_break_minutes
```

**ملاحظة مهمة:** صافي ساعات العمل **لا يشمل** وقت التنقل بين الزبائن. هو فقط الفرق بين مدة الجلسة والاستراحات. وقت التنقل يُحتسب ضمن الصافي (هو وقت عمل فعلي).

### 2.4. متوسط ساعات العمل اليومية

```sql
daily_average_minutes = SUM(net_minutes لكل completed sessions) / COUNT(completed sessions)
```

### 2.5. أطول/أقل يوم عمل

```sql
longest_day = MAX(net_minutes) FROM completed sessions في الفترة
shortest_day = MIN(net_minutes) FROM completed sessions في الفترة
```

### 2.6. عدد أيام العمل

```sql
work_days_count = COUNT(*) FROM workday_sessions
  WHERE status = 'completed'
    AND date BETWEEN p_from AND p_to
```

---

## 3. RPCs المطلوبة — الحالية والمعدلة

### 3.1. `get_employee_workday_history` — توسيع

**موجود حالياً في:** `20260610_attendance_module.sql:989` — V1 مع role-name check

**التعديلات المطلوبة:**

```sql
-- 1. تغيير governance من role-name إلى check_capability
-- 2. إضافة sales_value, order_count لكل session
-- 3. توسيع summary block

-- المخرج الجديد (لكل session في الـ array):
{
  id, date, start_time, end_time, status,
  duration_minutes,        -- إجمالي مدة العمل
  break_minutes,           -- مجموع الاستراحات (بالدقائق)
  net_minutes,             -- صافي ساعات العمل
  break_count,             -- عدد الاستراحات
  distance_meters,         -- المسافة المقطوعة
  visit_count,             -- عدد الزيارات
  order_count,             -- عدد الطلبات
  sales_value,             -- إجمالي المبيعات
  collection_count,        -- عدد التحصيلات
  collection_amount,       -- إجمالي التحصيل
  new_customer_count,      -- عدد العملاء الجدد
  attendance_status,       -- ontime / late / early_departure
  late_minutes,
  early_departure_minutes
}

-- summary المطور:
{
  total_days,              -- عدد أيام العمل المكتملة
  total_duration_minutes,  -- إجمالي مدة العمل
  total_break_minutes,     -- إجمالي الاستراحات
  total_net_minutes,       -- صافي الساعات الكلي
  avg_net_minutes,         -- متوسط صافي الساعات اليومي
  max_net_day,             -- أطول يوم (بالدقائق)
  min_net_day,             -- أقل يوم (بالدقائق)
  total_sales_value,       -- إجمالي المبيعات
  total_orders,            -- إجمالي الطلبات
  total_visits,            -- إجمالي الزيارات
  total_collections,       -- إجمالي التحصيلات
  total_collections_amount,-- إجمالي قيمة التحصيل
  total_new_customers,     -- إجمالي العملاء الجدد
  late_days,
  early_departure_days,
  ontime_days
}
```

### 3.2. `get_my_workday_status` — توسيع

**موجود حالياً في:** `20260611_phase6_hotfix_runtime.sql:344` — يعيد状态 + session

**الإضافات:**

```sql
-- إضافة ضمن الـ jsonb الناتج:
'today_orders', (SELECT COUNT(*) FROM public.orders
  WHERE owner_id = v_employee_id AND created_at::date = CURRENT_DATE),
'today_sales', (SELECT COALESCE(SUM(total_amount), 0) FROM public.orders
  WHERE owner_id = v_employee_id AND created_at::date = CURRENT_DATE),
'today_collections', (SELECT COUNT(*) FROM public.collections
  WHERE owner_id = v_employee_id AND created_at::date = CURRENT_DATE),
'today_collections_amount', (SELECT COALESCE(SUM(amount), 0) FROM public.collections
  WHERE owner_id = v_employee_id AND created_at::date = CURRENT_DATE),
'today_new_customers', (SELECT COUNT(*) FROM public.customers
  WHERE owner_id = v_employee_id AND created_at::date = CURRENT_DATE),
```

### 3.3. الباقي — لا تغيير

| RPC | الحالة | السبب |
|-----|--------|-------|
| `get_employee_detail` | V2 ✅ | موجود وحديث |
| `get_employee_day_map` | V2 ✅ | موجود وحديث |
| `get_employee_day_timeline` | V2 ✅ | موجود وحديث |
| `get_live_workday_overview` | V2 ✅ | موجود وحديث |
| `get_team_map` | V2 ✅ | موجود وحديث |
| `get_workday_report` | V2 ✅ | موجود وحديث |
| `get_attendance_analysis` | V1 ⚠️ | اختياري — غير مستخدم في Analytics Layer |

---

## 4. التعديلات على الشاشات الحالية

### 4.1. `EmployeeProfilePage.tsx` — سجل يومي + ملخص شهري

**الموقع:** تبويب "ملخص الحضور" (الموجود حالياً في السطور 514-551)

**الهيكل الحالي:**
```
[ملخص الحضور]
  أيام العمل: X
  صافي الساعات: Y
  [في الموعد: Z] [متأخر: W] [مغادرة مبكرة: V]
```

**الهيكل بعد التطوير:**

```
[فلتر زمني — TimeRangeFilter]
  ┌─────────────────────────────────┐
  │ [اليوم] [أمس] [7 أيام] [شهر] [مخصص] │
  └─────────────────────────────────┘

[جدول ساعات العمل اليومية]
  التاريخ  │  المدة  │  استراحة  │  الصافي  │  طلبات  │  مبيعات
  ─────────┼─────────┼───────────┼──────────┼─────────┼─────────
  01/06    │  07:10  │  00:30    │  06:40   │  5      │  12,500
  02/06    │  08:00  │  00:20    │  07:40   │  3      │  8,200
  03/06    │  06:50  │  00:15    │  06:35   │  0      │  0
  ...

[ملخص الشهر]
  أيام العمل:          22
  إجمالي الساعات:      165:30
  إجمالي الاستراحات:   8:15
  صافي الساعات:        157:15
  متوسط اليومي:        7:09
  أطول يوم:            8:40 (15/06)
  أقصر يوم:            5:20 (03/06)
  مبيعات الشهر:        285,000 ج.م
  طلبات الشهر:         98
  تحصيلات الشهر:       45,000 ج.م
  زيارات الشهر:        132
```

**طريقة التنفيذ:**
1. `useEffect` يستدعي `get_employee_workday_history` عند تغيير التاب أو الفلتر
2. يعرض `sessions` في جدول (مع scroll)
3. يعرض `summary` في بطاقات إحصائية
4. كل تاريخ ← رابط `navigate(/attendance/map/${employeeId}/${date})`

### 4.2. `AttendancePage.tsx` — إضافة إنتاجية اليوم

**الموقع:** تحت بطاقات المدة الحالية (السطور 162-187)

**الإضافات:**

```
(المحتوى الحالي: مدة اليوم, استراحات, صافي, زيارات)

[بطاقات إضافية]
  ┌──────────┬───────────┬──────────┬──────────┐
  │ الطلبات  │ المبيعات  │ تحصيلات  │ عملاء جدد │
  │    5     │ 12,500 ج.م│ 3,200 ج.م│    1     │
  └──────────┴───────────┴──────────┴──────────┘
```

**طريقة التنفيذ:**
1. `get_my_workday_status` RPC الموسع يعيد القيم الجديدة
2. `fetchStatus()` (الموجود حالياً كل 30 ثانية) يحدّث البطاقات تلقائياً
3. عرض في grid 2×2 تحت البطاقات الموجودة

### 4.3. `ReportsPage.tsx` — فرز

**الموقع:** جدول التقارير (السطور 81-200 تقريباً)

**الإضافات:**
- أزرار الفرز في رأس الجدول لكل عمود
- `useState` للـ sort field و direction
- فرز client-side لأن RPC يعيد كل البيانات

### 4.4. `LiveMonitoringPage.tsx` — رابط التفاصيل

**الموقع:** كل بطاقة موظف (السطور 100-200)

**الإضافة:**
- زر "تفاصيل" أو جعل اسم الموظف رابطاً
- `navigate(/attendance/map/${employeeId})` → `EmployeeDayMapPage`

### 4.5. `EmployeeDayMapPage.tsx` — الفلتر الزمني

**الموقع:** بدلاً من `date` من URL params

**التغيير:** استخدام `TimeRangeFilter` بدلاً من قراءة `date` من `useParams`.

### 4.6. `TeamMapPage.tsx` — auto-refresh

**الموقع:** إضافة `useEffect` مع `setInterval` (مثل LiveMonitoringPage)

---

## 5. مكون TimeRangeFilter — الفلتر الزمني الموحد

**الملف:** `src/components/TimeRangeFilter.tsx`

**التصميم:**

```tsx
interface TimeRange {
  from: string   // YYYY-MM-DD
  to: string     // YYYY-MM-DD
  label: string  // نص العرض
}

interface TimeRangeFilterProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
  presets?: ('today' | 'yesterday' | 'last7' | 'thisMonth' | 'lastMonth' | 'custom')[]
}
```

**الـ Presets (حساب التواريخ):**

| preset | from | to |
|--------|------|----|
| اليوم | `CURRENT_DATE` | `CURRENT_DATE` |
| أمس | `CURRENT_DATE - 1` | `CURRENT_DATE - 1` |
| آخر 7 أيام | `CURRENT_DATE - 6` | `CURRENT_DATE` |
| هذا الشهر | `first day of month` | `CURRENT_DATE` |
| الشهر السابق | `first day of prev month` | `last day of prev month` |
| فترة مخصصة | من المستخدم | من المستخدم |

**التكامل مع كل صفحة:**

كل صفحة تستخدم `useState<TimeRange>` وتمرر `onChange` الذي يستدعي `fetchData()` مع `range.from` و `range.to`.

---

## 6. SQL Migration — التغييرات

### ملف SQL واحد: `phase7_work_hours_analytics.sql`

```
1. CREATE OR REPLACE FUNCTION get_employee_workday_history — V2 rewrite
2. CREATE OR REPLACE FUNCTION get_my_workday_status — توسيع
3. GRANT EXECUTE
```

### `get_employee_workday_history` — V2 (إعادة كتابة كاملة)

```sql
CREATE OR REPLACE FUNCTION public.get_employee_workday_history(
    p_token uuid,
    p_employee_id uuid,
    p_from date,
    p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_subtree_ids uuid[];
    v_result jsonb;
BEGIN
    -- V2 governance check
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
    IF NOT public.check_capability(p_token, 'attendance.view_history') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    IF public.check_capability(p_token, 'attendance.view_all') THEN
        v_subtree_ids := NULL;
    ELSE
        v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    END IF;
    IF v_subtree_ids IS NOT NULL AND NOT (p_employee_id = ANY(v_subtree_ids)) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    WITH session_data AS (
        SELECT
            wds.id, wds.date, wds.start_time, wds.end_time, wds.status,
            EXTRACT(EPOCH FROM (COALESCE(wds.end_time, now()) - wds.start_time)) / 60 AS duration_minutes,
            COALESCE(wb.break_seconds, 0) / 60 AS break_minutes,
            COALESCE(wb.break_count, 0) AS break_count,
            wds.visit_count,
            wds.attendance_status, wds.late_minutes, wds.early_departure_minutes,
            wds.total_distance_meters,
            COALESCE(od.order_count, 0) AS order_count,
            COALESCE(od.sales_value, 0) AS sales_value,
            COALESCE(cd.collection_count, 0) AS collection_count,
            COALESCE(cd.collection_amount, 0) AS collection_amount,
            COALESCE(nd.new_customer_count, 0) AS new_customer_count
        FROM public.workday_sessions wds
        LEFT JOIN (
            SELECT session_id,
                COUNT(*) AS break_count,
                SUM(COALESCE(duration_seconds, 0)) AS break_seconds
            FROM public.workday_breaks
            GROUP BY session_id
        ) wb ON wb.session_id = wds.id
        LEFT JOIN (
            SELECT o.owner_id, o.created_at::date AS d,
                COUNT(*)::int AS order_count,
                COALESCE(SUM(o.total_amount), 0) AS sales_value
            FROM public.orders o GROUP BY o.owner_id, o.created_at::date
        ) od ON od.owner_id = wds.employee_id AND od.d = wds.date
        LEFT JOIN (
            SELECT c.owner_id, c.created_at::date AS d,
                COUNT(*)::int AS collection_count,
                COALESCE(SUM(c.amount), 0) AS collection_amount
            FROM public.collections c GROUP BY c.owner_id, c.created_at::date
        ) cd ON cd.owner_id = wds.employee_id AND cd.d = wds.date
        LEFT JOIN (
            SELECT c2.owner_id, c2.created_at::date AS d,
                COUNT(*)::int AS new_customer_count
            FROM public.customers c2 GROUP BY c2.owner_id, c2.created_at::date
        ) nd ON nd.owner_id = wds.employee_id AND nd.d = wds.date
        WHERE wds.employee_id = p_employee_id AND wds.date >= p_from AND wds.date <= p_to
    )
    SELECT jsonb_build_object(
        'sessions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', sd.id, 'date', sd.date, 'start_time', sd.start_time, 'end_time', sd.end_time,
            'status', sd.status,
            'duration_minutes', sd.duration_minutes::int,
            'break_minutes', sd.break_minutes::int,
            'net_minutes', GREATEST(sd.duration_minutes - sd.break_minutes, 0)::int,
            'break_count', sd.break_count,
            'visit_count', sd.visit_count,
            'order_count', sd.order_count,
            'sales_value', sd.sales_value,
            'collection_count', sd.collection_count,
            'collection_amount', sd.collection_amount,
            'new_customer_count', sd.new_customer_count,
            'distance_meters', sd.total_distance_meters,
            'attendance_status', sd.attendance_status,
            'late_minutes', sd.late_minutes,
            'early_departure_minutes', sd.early_departure_minutes
        ) ORDER BY sd.date DESC) FROM session_data sd WHERE sd.status = 'completed'), '[]'::jsonb),
        'summary', (SELECT jsonb_build_object(
            'total_days', COUNT(*) FILTER (WHERE status = 'completed'),
            'total_duration_minutes', SUM(duration_minutes) FILTER (WHERE status = 'completed')::int,
            'total_break_minutes', SUM(break_minutes) FILTER (WHERE status = 'completed')::int,
            'total_net_minutes', SUM(GREATEST(duration_minutes - break_minutes, 0)) FILTER (WHERE status = 'completed')::int,
            'avg_net_minutes', COALESCE(
                AVG(GREATEST(duration_minutes - break_minutes, 0)) FILTER (WHERE status = 'completed'),
                0
            )::int,
            'max_net_day', COALESCE(
                MAX(GREATEST(duration_minutes - break_minutes, 0)) FILTER (WHERE status = 'completed'),
                0
            )::int,
            'min_net_day', COALESCE(
                MIN(GREATEST(duration_minutes - break_minutes, 0)) FILTER (WHERE status = 'completed'),
                0
            )::int,
            'total_sales_value', SUM(sales_value)::int,
            'total_orders', SUM(order_count)::int,
            'total_visits', SUM(visit_count)::int,
            'total_collections', SUM(collection_count)::int,
            'total_collections_amount', SUM(collection_amount)::int,
            'total_new_customers', SUM(new_customer_count)::int,
            'late_days', COUNT(*) FILTER (WHERE status = 'completed' AND attendance_status = 'late'),
            'early_departure_days', COUNT(*) FILTER (WHERE status = 'completed' AND attendance_status = 'early_departure'),
            'ontime_days', COUNT(*) FILTER (WHERE status = 'completed' AND attendance_status = 'ontime')
        ) FROM session_data)
    ) INTO v_result;
    RETURN v_result;
END;
$function$;
```

### `get_my_workday_status` — توسيع

تضاف الاستعلامات التالية قبل الـ RETURN:

```sql
-- داخل DECLARE أضف:
v_today_orders int;
v_today_sales numeric;
v_today_collections int;
v_today_collections_amount numeric;
v_today_new_customers int;

-- قبل الـ RETURN، أضف:
SELECT COUNT(*), COALESCE(SUM(total_amount), 0) INTO v_today_orders, v_today_sales
FROM public.orders WHERE owner_id = v_employee_id AND created_at::date = CURRENT_DATE;

SELECT COUNT(*), COALESCE(SUM(amount), 0) INTO v_today_collections, v_today_collections_amount
FROM public.collections WHERE owner_id = v_employee_id AND created_at::date = CURRENT_DATE;

SELECT COUNT(*) INTO v_today_new_customers
FROM public.customers WHERE owner_id = v_employee_id AND created_at::date = CURRENT_DATE;
```

ثم تضاف إلى jsonb الناتج:

```json
'today_orders', v_today_orders,
'today_sales', v_today_sales,
'today_collections', v_today_collections,
'today_collections_amount', v_today_collections_amount,
'today_new_customers', v_today_new_customers
```

---

## 7. العلاقة بين فلاتر الزمن والبيانات

| الصفحة | RPC المُستخدم | معاملات الفلتر |
|--------|---------------|----------------|
| LiveMonitoringPage | `get_live_workday_overview` | لا يحتاج فلتر — دائماً `CURRENT_DATE` في الـ RPC |
| TeamMapPage | `get_team_map` | لا يحتاج فلتر — دائماً `CURRENT_DATE` |
| ReportsPage | `get_workday_report` | `p_from`, `p_to` ← من TimeRangeFilter |
| EmployeeDayMapPage | `get_employee_day_map` + `get_employee_detail` + `get_employee_day_timeline` | `p_date` ← من TimeRangeFilter (تاريخ واحد) |
| EmployeeProfilePage | `get_employee_workday_history` | `p_from`, `p_to` ← من TimeRangeFilter |

**ملاحظة:** LiveMonitoring و TeamMap يعرضان دائماً اليوم فقط (هما شاشات مراقبة لحظية). الفلتر الزمني لهما سيقتصر على اختيار اليوم أو عدم عرض الفلتر أصلاً — حسب الحاجة.

---

## 8. اختبار الحسابات

### معادلات التحقق

```
1. net_minutes = duration_minutes - break_minutes
   ✅ يجب أن يكون net_minutes >= 0 دائماً

2. avg_net_minutes = total_net_minutes / total_days
   ✅ عندما total_days > 0

3. max_net_day >= avg_net_minutes >= min_net_day
   ✅ لجميع الحالات

4. ontime_days + late_days + early_departure_days = total_days
   ✅ إذا كانت attendance_status دائماً قيمة

5. لكل يوم: break_count >= 0
   ✅

6. total_sales_value = SUM(sales_value لكل الأيام)
   ✅ يتم حسابه في SQL مباشرة
```

### سيناريوهات الحافة

| السيناريو | التعامل |
|-----------|---------|
| يوم عمل لم ينتهِ (status = active) | لا يُحتسب ضمن `completed` sessions. `duration_minutes` من الآن. |
| استراحة نشطة (break_end IS NULL) | `duration_seconds` = NULL → تحتسب بـ 0 في `COALESCE` |
| يوم بدون أي استراحة | break_minutes = 0, break_count = 0 |
| يوم بدون طلبات | order_count = 0, sales_value = 0 |
| فترة بدون أي أيام عمل | `total_days` = 0, جميع القيم 0 |
| موظف جديد (لم يسجل أي يوم) | sessions = [], summary كلها 0 |
| p_from > p_to | RPC يعيد sessions = [] و summary كلها 0 |

---

## 9. UI/UX Standards

### 9.1. تنسيق الوقت

كل قيم الوقت تُعرض كـ `HH:MM` (مثلاً 07:30 وليس 7.5).

```typescript
function formatDuration(minutes: number): string {
  if (!minutes || isNaN(minutes)) return '--:--'
  const h = Math.floor(Math.abs(minutes))
  const m = Math.round(Math.abs(minutes) % 60)
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
}
```

### 9.2. تنسيق العملة

```typescript
function formatCurrency(value: number): string {
  return value?.toLocaleString('ar-EG') + ' ج.م' ?? '0 ج.م'
}
```

### 9.3. تنسيق التاريخ

```typescript
function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
```

### 9.4. الألوان

| العنصر | اللون |
|--------|-------|
| مدة العمل (إيجابي) | `text-green-600` |
| استراحة | `text-amber-600` |
| صافي وقت العمل | `text-blue-600` |
| متوسط يومي | `text-indigo-600` |
| أطول يوم | `text-green-700` |
| أقصر يوم | `text-red-600` |
| مبيعات/تحصيلات | `text-orange-600` / `text-cyan-600` |
| الفلتر النشط | `bg-primary text-white` |

---

## 10. ملخص التنفيذ — الملفات

### SQL

| الملف | المحتوى |
|-------|---------|
| `supabase/migrations/20260611_phase7_work_hours_analytics.sql` | `get_employee_workday_history` V2 + `get_my_workday_status` توسيع |

### Frontend — مشترك

| الملف | المحتوى |
|-------|---------|
| `src/components/TimeRangeFilter.tsx` | مكون الفلتر الزمني الموحد |

### Frontend — تعديلات

| الملف | التغيير |
|-------|---------|
| `src/services/attendance.ts` | تحديث types لـ `WorkdayStatus` مع الحقول الجديدة |
| `src/pages/employees/EmployeeProfilePage.tsx` | تبويب الحضور: جدول يومي + ملخص شهري + TimeRangeFilter |
| `src/pages/attendance/AttendancePage.tsx` | إضافة بطاقات الإنتاجية (طلبات/مبيعات/تحصيلات/عملاء جدد) |
| `src/pages/attendance/ReportsPage.tsx` | TimeRangeFilter + فرز |
| `src/pages/attendance/LiveMonitoringPage.tsx` | رابط → EmployeeDayMapPage |
| `src/pages/attendance/TeamMapPage.tsx` | Auto-refresh + رابط → EmployeeDayMapPage |
| `src/pages/attendance/EmployeeDayMapPage.tsx` | TimeRangeFilter بدلاً من URL param |

### UI — لا تغيير

| الملف | السبب |
|-------|-------|
| `UpperManagementDashboard.tsx` | يعرض attendance widget فقط — لا يحتاج فلتر |
| `ManagementDashboard.tsx` | لا يحتوي على attendance |

---

*End of Design Document*
