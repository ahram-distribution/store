# TRACKING_RETENTION_SAFETY_REPORT

> تاريخ الإنشاء: 2026-06-17
> الغرض: التحقق من سلامة حذف `tracking_points` الأقدم من 90 يوم قبل التنفيذ

---

## 1. الوضع الحالي — حجم البيانات

| الجدول | الحجم (Total) | السجلات | ملاحظة |
|--------|--------------|---------|--------|
| **قاعدة البيانات بالكامل** | **25 MB** | — | Free Plan حد = 500 MB |
| **tracking_points** | **224 KB** | **338** | أكبر مستهلك متوقع بعد التشغيل |
| **الجدول التالي الأكبر** (order_items) | 272 KB | — | تجاري — ممنوع الحذف |
| **gps_test_points** | 32 KB | 4 | تشخيصي — مسموح الحذف |
| **tracking_cleanup_log** | 16 KB | 0 | سجل التنظيف — فارغ حالياً |

**الخلاصة**: النظام جديد (7 أيام). `tracking_points` حالياً 224 KB لكنه سينمو سريعاً.

---

## 2. ماذا سيتم حذفه بالضبط

### الجدول: `tracking_points`

مسموح حذف: **السجلات الأقدم من 90 يوم**

المحتوى:
- `latitude`, `longitude` — إحداثيات GPS
- `accuracy_meters`, `altitude_meters`, `speed_mps`, `heading_degrees` — بيانات GPS خام
- `battery_pct` — مستوى البطارية (قيمة منخفضة)
- `recorded_at` — وقت الالتقاط
- `point_type` — نوع النقطة (`periodic`, `start`, `end`, `visit_checkin`, etc)
- `session_id` — رابط بجلسة العمل
- `employee_id` — الموظف

**مساحة متوقعة بعد سنة بدون حذف**: ~17,500 نقطة × ~168 بايت/نقطة = **~2.8 MB** سنوياً
**بعد 3 سنوات**: ~8.5 MB (ضمن الحد الآمن 500 MB)

### الجدول: `gps_test_points`

مسموح حذف: **السجلات الأقدم من 60 يوم**

حالياً: 4 سجلات فقط. لا تأثير تشغيلي.

---

## 3. الحقول التي سيتم فقدها بعد حذف `tracking_points`

| الحقل المفقود | المصدر | هل هو مطلوب لـ؟ |
|--------------|--------|----------------|
| مسار GPS على الخريطة | `tracking_points` (route polyline) | شاشة خريطة يوم الموظف للتواريخ القديمة |
| `start_point`, `end_point` على الخريطة | `tracking_points` (point_type='start'/'end') | خريطة اليوم — لكنها موجودة أيضاً في `workday_sessions.start_latitude/longitude` |
| عدد نقاط التتبع (`tracking_points_count`) | `tracking_points` | الأداء التاريخي — سيرجع 0 للجلسات القديمة |
| رابط visit → tracking_point | `visit_links.checkin_tracking_point_id` | خريطة اليوم — لكن نقاط الزيارة موجودة في جدول `visits` مباشرة |

---

## 4. الحقول التي ستبقى محفوظة (بعد الحذف)

| الحقل | المصدر البديل | هل يتأثر بالحذف |
|-------|--------------|----------------|
| **جلسة العمل (date, start, end, status)** | `workday_sessions` | ❌ لا يتأثر |
| **حالة الحضور (late/ontime)** | `workday_sessions.attendance_status` | ❌ لا يتأثر |
| **دقائق التأخير** | `workday_sessions.late_minutes` | ❌ لا يتأثر |
| **دقائق الانصراف المبكر** | `workday_sessions.early_departure_minutes` | ❌ لا يتأثر |
| **المسافة المقطوعة** | `workday_sessions.total_distance_meters` | ❌ لا يتأثر |
| **عدد الزيارات** | `workday_sessions.visit_count` | ❌ لا يتأثر |
| **إحداثيات البداية/النهاية** | `workday_sessions.start_lat/lng`, `end_lat/lng` | ❌ لا يتأثر |
| **أوقات الاستراحات** | `workday_breaks` (غير محذوف) | ❌ لا يتأثر |
| **عدد الطلبات** | `orders` (غير محذوف) | ❌ لا يتأثر |
| **قيمة المبيعات** | `orders` (غير محذوف) | ❌ لا يتأثر |
| **عدد التحصيلات + القيمة** | `collections` (غير محذوف) | ❌ لا يتأثر |
| **العملاء الجدد** | `customers` (غير محذوف) | ❌ لا يتأثر |
| **نقاط GPS للزيارات** | `visits.check_in_lat/lng`, `check_out_lat/lng` | ❌ لا يتأثر |

---

## 5. إثبات السلامة — لكل نظام

### 5.1 الأداء التاريخي (الشاشة الجديدة)

**مصدر البيانات**: `get_completed_workdays_history` RPC جديد

| KPI | المصدر في الـ RPC | هل يحتاج `tracking_points`؟ |
|----|-------------------|---------------------------|
| عدد الجلسات | `workday_sessions` | ❌ لا |
| ساعات العمل | `start_time - end_time` | ❌ لا |
| صافي ساعات العمل | duration - break_minutes | ❌ لا (breaks من `workday_breaks`) |
| عدد الطلبات | `orders` (JOIN) | ❌ لا |
| قيمة المبيعات | `orders` (JOIN) | ❌ لا |
| عدد التحصيلات | `collections` (JOIN) | ❌ لا |
| قيمة التحصيلات | `collections` (JOIN) | ❌ لا |
| عدد الزيارات | `workday_sessions.visit_count` | ❌ لا |
| عملاء جدد | `customers` (JOIN) | ❌ لا |
| مسافة مقطوعة | `workday_sessions.total_distance_meters` | ❌ لا |
| هدف المبيعات | `employee_monthly_targets` | ❌ لا |
| نقاط التتبع | `tracking_points` (COUNT) | **✅ نعم — سترجع 0 بعد الحذف** |
| الالتزام بالحضور | `workday_sessions.attendance_status` | ❌ لا |

**الخلاصة**: KPI واحد فقط يتأثر: `tracking_points_count`. الحل: تجاهل هذه القيمة للجلسات القديمة أو عرض `0`.

---

### 5.2 الحضور والانصراف

| الشاشة | هل تتأثر؟ |
|--------|-----------|
| `get_my_workday_status` | ❌ لا — فقط `workday_sessions` الحالية |
| `get_live_workday_overview` | ❌ لا — فقط اليوم |
| `get_employee_workday_history` | ❌ لا — فقط `workday_sessions` + joins مع orders/visits |
| `get_workday_report` | ❌ لا — تقارير إجمالية من sessions |
| `get_attendance_analysis` | ❌ لا — تحليل من sessions |

**الخلاصة**: الحضور والانصراف بأمان تام.

---

### 5.3 خرائط التتبع

| الشاشة | هل تتأثر؟ |
|--------|-----------|
| **شاشة خريطة الفريق** (`/attendance/team-map`) | ❌ لا — تظهر الموظفين الأحياء فقط (آخر tracking_point في اليوم الحالي) |
| **شاشة خريطة اليوم** (`/attendance/operations` → 🗺️) | ❌ لا — نفس الشيء |
| **شاشة تفاصيل يوم الموظف** (`/attendance/employee/:id/:date`) | ⚠️ **تتأثر للتواريخ القديمة** ← المسار بين النقاط سيكون فارغاً، لكن: |
|  | — نقاط بداية/نهاية اليوم ستظهر من `workday_sessions` |
|  | — نقاط الزيارات ستظهر من `visits` مباشرة |
|  | — `total_distance_meters` مقروء من `workday_sessions` |

**الخلاصة**: خرائط التواريخ القديمة لن تظهر المسار المتصل بين النقاط، لكن جميع نقاط GPS الهامة sتبقى ظاهرة.

---

### 5.4 تقارير الإدارة العليا

| التقرير | المصدر | هل يتأثر؟ |
|---------|--------|-----------|
| `get_live_workday_overview` | اليوم فقط | ❌ لا |
| `get_team_map` | آخر tracking_point لكل موظف نشط | ❌ لا (لأن الموظف النشط له نقاط حديثة) |
| `get_alerts` | بيانات اليوم | ❌ لا |
| `get_daily_target_vs_actual` | `workday_sessions` + `employee_monthly_targets` | ❌ لا |

**الخلاصة**: الإدارة العليا بأمان تام.

---

## 6. المساحة المتوقعة

### بدون حذف (الوضع الحالي)

| الفترة | tracking_points | DB الكلي |
|--------|----------------|---------|
| اليوم (7 أيام) | 224 KB | 25 MB |
| شهر واحد | ~1 MB | ~27 MB |
| سنة واحدة | ~12 MB | ~42 MB |
| 3 سنوات | ~36 MB | ~75 MB |

> **الحد الحالي (Supabase Free)**: **500 MB**
> **الخلاصة**: حتى بدون حذف، المساحة ضمن الحد لعدة سنوات.

### مع حذف tracking_points بعد 90 يوم

| الفترة | tracking_points | DB الكلي |
|--------|----------------|---------|
| بعد 90 يوم | ~3 MB | ~30 MB |
| بعد سنة | ~3 MB (ثابت) | ~30 MB |
| بعد 3 سنوات | ~3 MB (ثابت) | ~33 MB |

---

## 7. خطة التنفيذ

### المرحلة 1: إنشاء Job التنظيف التلقائي (ليلي)

```sql
-- يتم إنشاء Job عبر pg_cron أو Scheduled Function
-- الوقت: 03:00 صباحاً يومياً

-- 1. حذف tracking_points الأقدم من 90 يوم
DELETE FROM public.tracking_points
WHERE recorded_at < CURRENT_DATE - INTERVAL '90 days';

-- 2. حذف gps_test_points الأقدم من 60 يوم
DELETE FROM public.gps_test_points
WHERE captured_at < CURRENT_DATE - INTERVAL '60 days';

-- 3. تسجيل العملية
INSERT INTO public.tracking_cleanup_log
(action_type, deleted_sessions, deleted_points, cutoff_date, reason, executed_by)
VALUES ('auto_cleanup', 0, (<عدد>), CURRENT_DATE - 90, 'Scheduled retention cleanup', <system_employee_id>);
```

### المرحلة 2: تحديث auto_cleanup_tracking_data

تعديل الدالة الحالية لتصبح no-op آمنة (حتى لا تحذف tracking_points عن طريق الخطأ من UI الإعدادات):

```sql
CREATE OR REPLACE FUNCTION public.auto_cleanup_tracking_data()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    RETURN jsonb_build_object('skipped', true, 'reason', 'auto_cleanup_disabled_by_policy');
END;
$function$;
```

### المرحلة 3: التراجع

إذا ظهرت مشكلة بعد التنفيذ:

```sql
-- إعادة البيانات: غير ممكن (DELETE لا يمكن التراجع عنه بدون backup)

-- الحل الوقائي: قبل التنفيذ
CREATE TABLE tracking_points_backup_20260617 AS SELECT * FROM tracking_points;
```

---

## 8. المخاطر المتبقية

| الخطر | درجة الخطورة | الحل |
|-------|-------------|------|
| فقدان مسار GPS لخرائط التواريخ القديمة | منخفضة | نقاط البداية والنهاية والزيارات محفوظة في جداول أخرى |
| `tracking_points_count` = 0 للأيام القديمة | منخفضة | الحقل غير أساسي — يمكن إخفاؤه أو عرض 0 |
| `visit_links` تشير إلى `tracking_points` IDs محذوفة | منخفضة | الـ Foreign Key سيصبح orphan — لكن `visits` لديها GPS مباشر |
| `get_employee_day_map` يرجع مساراً فارغاً للقديم | متوسطة | الشاشة تعرض 0 نقطة بدلاً من الخريطة — المعلومة (وقت اليوم، attendance_status) موجودة |

---

## 9. القرار النهائي

### ✅ Safe to proceed

بناءً على التحليل الكامل:

| النظام | الحالة |
|--------|--------|
| الأداء التاريخي (الشاشة الجديدة) | ✅ آمن — KPI واحد فقط سيفقد (`tracking_points_count`) |
| الحضور والانصراف | ✅ آمن تماماً |
| تقارير الإدارة العليا | ✅ آمن تماماً |
| تقارير مدير البيع | ✅ آمن تماماً |
| شاشة خريطة الفريق | ✅ آمن تماماً (بيانات حية فقط) |
| خريطة يوم الموظف للقديم | ⚠️ يفقد المسار المتصل — يحتفظ بنقاط GPS الهامة |

**التوصية**: تطبيق الحذف مع backup احتياطي للجداول المتأثرة.
