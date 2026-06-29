# حساب المسافة المقطوعة (Distance Calculation)

## المصدر الأساسي

المسافة تُحسب من **جدول `tracking_points`** في قاعدة البيانات.
هذا الجدول يحتوي على نقاط GPS يتم إرسالها من أجهزة المندوبين بشكل دوري
عبر RPC `sync_tracking_points`.

### هيكل جدول tracking_points

| الحقل | النوع | الوصف |
|---|---|---|
| `id` | uuid | المفتاح الأساسي |
| `session_id` | uuid | معرف جلسة العمل |
| `employee_id` | uuid | معرف المندوب |
| `latitude` | decimal(10,7) | خط العرض |
| `longitude` | decimal(10,7) | خط الطول |
| `accuracy_meters` | decimal(8,2) | دقة GPS (مستخدم في فلترة الانحراف) |
| `altitude_meters` | decimal(8,2) | الارتفاع |
| `speed_mps` | decimal(6,2) | السرعة (م/ث) |
| `heading_degrees` | decimal(5,1) | الاتجاه |
| `battery_pct` | decimal(4,1) | نسبة البطارية |
| `recorded_at` | timestamptz | وقت التسجيل |
| `point_type` | varchar(20) | نوع النقطة (periodic, start, end, visit_checkin, ...) |

---

## RPC المسؤول عن الحساب

**`get_employee_day_map`** — الوظيفة الوحيدة في قاعدة البيانات التي تحسب المسافة.

### مكان التطبيق

`supabase/migrations/20260717_fix_employee_day_map_route.sql`

### الخوارزمية

1. **Haversine Formula** لحساب المسافة بين نقطتين على سطح الكرة الأرضية:
   ```
   a = sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlng/2)
   c = 2 · atan2(√a, √(1-a))
   d = R · c    (R = 6,371,000 متر)
   ```

2. **Anchor-based approach**: بدلاً من حساب المسافة بين كل نقطتين متتاليتين،
   يتم استخدام نقطة مرجعية (anchor). يتم تحديث النقطة المرجعية فقط عندما
   تجتاز النقطة الحالية جميع الفلاتر.

### طبقات الفلترة (GPS Drift Protection)

لضمان عدم احتساب نقاط GPS غير صحيحة، يتم تطبيق 3 فلاتر:

| الفلتر | القيمة الافتراضية | الوصف |
|---|---|---|
| **1. دقة GPS** (accuracy) | 50 مترًا | يتم استبعاد أي نقطة دقتها > 50 متر |
| **2. الحد الأدنى للمسافة** (min distance) | 20 مترًا | إذا كانت المسافة من النقطة المرجعية < 20 متر، تُعتبر انحراف GPS ويتم تخطيها |
| **3. سرعة غير منطقية** (max speed) | 5 م/ث (≈ 18 كم/س) | إذا كانت السرعة المحسوبة (مسافة ÷ وقت) > 5 م/ث، تُعتبر قفزة غير منطقية ويتم تخطيها |

### مخرجات RPC

```json
{
  "total_distance_meters": 4850,
  "total_distance_km": "4.85",
  "total_counted_segments": 42,
  "max_consecutive_distance": 350,
  "filter_stats": {
    "skipped_accuracy": 5,
    "skipped_min_distance": 12,
    "skipped_speed": 1,
    "min_distance_threshold": 20,
    "max_accuracy": 50,
    "max_speed": 5
  }
}
```

### موقع الحساب

الحساب يتم **داخل قاعدة البيانات** (PostgreSQL PL/pgSQL)،
وليس في Frontend.

---

## أين تظهر المسافة؟

### 1. شاشة تفاصيل يوم المندوب

`/attendance/employee/:employeeId/:date`

- تُظهر `total_distance_km` من `get_employee_day_map`.
- تعرض جدول نقاط التتبع مع المسافة بين كل نقطة وسابقتها (محسوبة في الـ Frontend باستخدام `haversineKm`).

### 2. شاشة تقارير مدير المبيعات (صفحة التفاصيل)

`get_employee_workday_history` يعيد حقل `distance_meters` لكل جلسة.

---

## مشكلة معروفة

حقل `total_distance_meters` في جدول `workday_sessions` **دائمًا صفر**.
لم يتم تحديثه مطلقًا.

`get_employee_workday_history` يقرأ من هذا الحقل،
لذا المسافة في تقارير الفترات التاريخية **غير متاحة حاليًا**.

الحل: إما تحديث `workday_sessions.total_distance_meters` عند إنهاء جلسة العمل
(عبر جمع المسافات من `tracking_points`)، أو تعديل RPC التاريخي ليحسب المسافة
من `tracking_points` مباشرةً بدلاً من قراءة الحقل المخزن.

---

## ملخص

| السؤال | الإجابة |
|---|---|
| من أي جدول تأتي المسافة؟ | `tracking_points` (جدول نقاط GPS) |
| هل تعتمد على GPS Tracking Points؟ | نعم، بشكل كامل |
| هل يتم حسابها بين كل نقطتين متتاليتين؟ | لا — تستخدم طريقة Anchor-based مع نقطة مرجعية |
| هل يتم استبعاد النقاط غير الصحيحة؟ | نعم — 3 فلاتر للدقة والمسافة الدنيا والسرعة |
| هل يوجد حد أدنى للمسافة بين النقطتين؟ | نعم — 20 مترًا |
| هل يتم استبعاد القفزات غير المنطقية؟ | نعم — > 5 م/ث (18 كم/س) |
| هل يتم الحساب داخل قاعدة البيانات أم في Frontend؟ | داخل قاعدة البيانات (PostgreSQL) باستخدام Haversine |
| الخوارزمية المستخدمة | Haversine Formula (نصف قطر الأرض = 6371 كم) |
