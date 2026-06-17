# TRACKING_POINTS_IMPACT_ANALYSIS

> **الغرض**: تحليل أثر حذف `tracking_points` على كل شاشة ووظيفة في النظام
> **التواريخ**: 90 يوم، 180 يوم، 365 يوم
> **تاريخ التقرير**: 2026-06-17

---

## 1. ملخص الجداول المتأثرة

| الجدول | هل يُحذف؟ | هل يؤثر على KPIs؟ |
|--------|----------|-------------------|
| `tracking_points` | ✅ نعم (90/180/365) | لا — لا يحتوي أي KPI تجاري |
| `workday_sessions` | ❌ لا | لا — تبقى محفوظة بالكامل (مع `total_distance_meters`) |
| `visit_links` | ❌ لا | لا — يبقى، لكن `checkin_tracking_point_id` يصبح orphan |
| `visits` | ❌ لا | لا — تبقى محفوظة (مع `check_in_lat/lng` مباشرة) |
| `orders`, `collections`, `customers` | ❌ لا | لا — تبقى محفوظة (كل KPIs) |

---

## 2. المصفوفة الرئيسية — أثر الحذف على كل شاشة

| الشاشة / الوظيفة | المصدر (RPC) | هل تستخدم tracking_points؟ | كيف تستخدمه؟ | 90 يوم | 180 يوم | 365 يوم |
|-----------------|-------------|---------------------------|-------------|--------|---------|---------|
| **خريطة الفريق** (Team Map) | `get_team_map` | ✅ نعم | `last_points` CTE: `WHERE recorded_at >= CURRENT_DATE` | ❌ لا تأثير | ❌ لا تأثير | ❌ لا تأثير |
| **خريطة يوم الموظف** (Employee Day Map) | `get_employee_day_map` | ✅ نعم | Route polyline, start/end points, visit locations, Haversine distance | ⚠️ متأثر | ⚠️ متأثر | ⚠️ متأثر |
| **الموقع الحالي للموظف** (Live Location) | `get_employee_current_location` | ✅ نعم | `ORDER BY recorded_at DESC LIMIT 1` | ❌ لا تأثير¹ | ❌ لا تأثير¹ | ❌ لا تأثير¹ |
| **تاريخ الموظف** (Attendance Detail) | `get_employee_workday_history` | ✅ نعم | `COUNT(*)` لكل session (tracking_points_count) | ⚠️ count=0² | ⚠️ count=0² | ⚠️ count=0² |
| **الأداء التاريخي** (الجديد) | `get_completed_workdays_history` | ✅ نعم | `COUNT(*)` لكل session | ⚠️ count=0² | ⚠️ count=0² | ⚠️ count=0² |
| **نظرة عامة حية** (Live Overview) | `get_live_workday_overview` | ❌ لا | — | ❌ لا تأثير | ❌ لا تأثير | ❌ لا تأثير |
| **تقرير الحضور** | `get_workday_report` | ❌ لا | — | ❌ لا تأثير | ❌ لا تأثير | ❌ لا تأثير |
| **تحليل الحضور** | `get_attendance_analysis` | ❌ لا | — | ❌ لا تأثير | ❌ لا تأثير | ❌ لا تأثير |
| **Leaderboard** | `get_kpi_contributors` | ❌ لا | — | ❌ لا تأثير | ❌ لا تأثير | ❌ لا تأثير |
| **Daily Target vs Actual** | `get_daily_target_vs_actual` | ❌ لا | — | ❌ لا تأثير | ❌ لا تأثير | ❌ لا تأثير |
| **مسافة GPS (مخزنة)** | `workday_sessions.total_distance_meters` | ❌ لا | محسوبة أثناء `end_workday` | ❌ لا تأثير | ❌ لا تأثير | ❌ لا تأثير |
| **مسافة GPS (مُعاد حسابها)** | `get_employee_day_map` (Haversine) | ✅ نعم | إعادة حساب من النقاط | ⚠️ 0 مسافة | ⚠️ 0 مسافة | ⚠️ 0 مسافة |
| **مسار GPS (Polyline)** | `get_employee_day_map` | ✅ نعم | `jsonb_agg` من tracking_points | ❌ فارغ | ❌ فارغ | ❌ فارغ |

**ملاحظات:**
1. **الموقع الحالي للموظف**: فقط أحدث نقطة. إذا كان للموظف جلسة نشطة اليوم ← لديه نقاط حديثة (لم تُحذف). إذا كانت آخر جلسة للموظف قبل 90+ يوم ← سيعيد `null` لأي حال (لأنه لا توجد جلسة نشطة).
2. **عدد نقاط التتبع**: سيصبح `0` للجلسات الأقدم من فترة الحذف. لا يؤثر على أي KPI آخر.

---

## 3. تحليل تفصيلي لكل شاشة

### 3.1 خريطة الفريق (Team Map) — `get_team_map`

**الكود المصدري** (من Supabase Management API):
```sql
last_points AS (
    SELECT DISTINCT ON (tp.employee_id)
        tp.employee_id, tp.latitude, tp.longitude, tp.recorded_at
    FROM public.tracking_points tp
    WHERE tp.recorded_at >= CURRENT_DATE    -- ← يقرأ اليوم فقط
    ORDER BY tp.employee_id, tp.recorded_at DESC
),
```

**التحليل**: الـ CTE `last_points` يستخدم `WHERE recorded_at >= CURRENT_DATE` — أي يقرأ **نقاط اليوم فقط**. حذف النقاط القديمة لا يؤثر عليه بتاتاً.

**الخلاصة**:
| 90 يوم | 180 يوم | 365 يوم |
|--------|---------|---------|
| ✅ آمن تماماً | ✅ آمن تماماً | ✅ آمن تماماً |

---

### 3.2 خريطة يوم الموظف (Employee Day Map) — `get_employee_day_map`

**الكود المصدري** (من Supabase Management API):
```sql
-- Route polyline
SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'latitude', latitude, 'longitude', longitude, 'time', recorded_at, 'type', point_type
) ORDER BY recorded_at), '[]'::jsonb) INTO v_route
FROM public.tracking_points
WHERE session_id = v_session_record.id AND point_type IN ('periodic', 'start', 'end');

-- Start/end points
SELECT jsonb_build_object('latitude', latitude, 'longitude', longitude, 'recorded_at', recorded_at)
INTO v_start_point
FROM public.tracking_points WHERE session_id = v_session_record.id AND point_type = 'start' ORDER BY recorded_at LIMIT 1;

SELECT jsonb_build_object('latitude', latitude, 'longitude', longitude, 'recorded_at', recorded_at)
INTO v_end_point
FROM public.tracking_points WHERE session_id = v_session_record.id AND point_type = 'end' ORDER BY recorded_at DESC LIMIT 1;

-- Distance (Haversine re-calculation)
FOR v_pt IN
    SELECT latitude, longitude FROM public.tracking_points
    WHERE session_id = v_session_record.id AND point_type IN ('periodic', 'start', 'end')
    ORDER BY recorded_at
LOOP
    -- Haversine formula ...
END LOOP;
```

**التحليل**: هذا الـ RPC هو الأكثر تضرراً. عند حذف `tracking_points` لجلسة معينة:
- **Route polyline**: `jsonb_agg` سيعيد `[]` (فارغ)
- **Start point**: `LIMIT 1` سيعيد `NULL`
- **End point**: `LIMIT 1` سيعيد `NULL`
- **Distance**: لن يدخل الـ LOOP، `v_total_distance` = 0
- **Visit locations**: `visit_links` JOIN مع `tracking_points` → مواقع الزيارات لن تظهر على الخريطة

**ما سيبقى**: يمكن قراءة `workday_sessions.start_latitude/longitude` و `end_latitude/longitude` مباشرة، و `visits.check_in_latitude/longitude` مباشرة.

**الخلاصة**:
| 90 يوم | 180 يوم | 365 يوم |
|--------|---------|---------|
| ⚠️ مسار GPS فارغ للجلسات > 90 يوم | ⚠️ مسار GPS فارغ للجلسات > 180 يوم | ⚠️ مسار GPS فارغ للجلسات > 365 يوم |

---

### 3.3 الموقع الحالي للموظف — `get_employee_current_location`

**الكود المصدري**:
```sql
LEFT JOIN LATERAL (
    SELECT latitude, longitude, recorded_at
    FROM public.tracking_points
    WHERE employee_id = p_employee_id
    ORDER BY recorded_at DESC LIMIT 1  -- ← أحدث نقطة فقط
) tp ON true
```

**التحليل**: يقرأ أحدث نقطة تتبع للموظف. إذا كان الموظف لديه جلسة اليوم ← أحدث نقطة له هي من اليوم (محفوظة). إذا كان الموظف لديه جلسة قبل 90+ يوم ← النقطة الأخيرة قد تُحذف. لكن في هذه الحالة، الموظف ليس لديه جلسة نشطة، لذا `wds.status` سيكون `null` أو `inactive` ← الموقع لا يهم.

**الخلاصة**:
| 90 يوم | 180 يوم | 365 يوم |
|--------|---------|---------|
| ✅ آمن | ✅ آمن | ✅ آمن |

---

### 3.4 تاريخ الموظف — `get_employee_workday_history`

**الكود المصدري**:
```sql
LEFT JOIN (
    SELECT tp.session_id, COUNT(*)::int AS tracking_points_count
    FROM public.tracking_points tp GROUP BY tp.session_id
) tp ON tp.session_id = wds.id
```

**التحليل**: الـ `LEFT JOIN` سيعيد `NULL` للجلسات التي حُذفت نقاط تتبعها. الـ `COALESCE(tp.tracking_points_count, 0)` سيعيد `0`. كل KPIs الأخرى (orders, sales, collections, etc.) تأتي من جداول أخرى غير محذوفة.

**الخلاصة**:
| 90 يوم | 180 يوم | 365 يوم |
|--------|---------|---------|
| ⚠️ `tracking_points_count=0` فقط | ⚠️ نفس الشيء | ⚠️ نفس الشيء |

---

### 3.5 الأداء التاريخي (جديد) — `get_completed_workdays_history`

**الكود المصدري** (نفس النمط):
```sql
LEFT JOIN (
    SELECT tp.session_id, COUNT(*)::int AS tracking_points_count
    FROM public.tracking_points tp GROUP BY tp.session_id
) tp ON tp.session_id = wds.id
```

**التحليل**: نفس تحليل 3.4.

**الخلاصة**:
| 90 يوم | 180 يوم | 365 يوم |
|--------|---------|---------|
| ⚠️ `total_tracking_points=0` فقط | ⚠️ نفس الشيء | ⚠️ نفس الشيء |

---

### 3.6 مسافة GPS — المخزنة vs المُعاد حسابها

**المخزنة** (`workday_sessions.total_distance_meters`):
- تُحسب أثناء `end_workday` من الـ RPC
- قيمتها الأصلية تبقى محفوظة في الجدول
- **لا تتأثر بالحذف**

**المُعاد حسابها** (`get_employee_day_map` — Haversine):
- تُحسب من `tracking_points` عند الطلب
- **تتأثر بالحذف** ← ستعيد `0` للجلسات القديمة

**الخلاصة**:
| النوع | 90 يوم | 180 يوم | 365 يوم |
|------|--------|---------|---------|
| مخزنة (workday_sessions) | ✅ محفوظة | ✅ محفوظة | ✅ محفوظة |
| معاد حسابها (Haversine) | ⚠️ 0 | ⚠️ 0 | ⚠️ 0 |

---

## 4. أثر الحذف على بنية البيانات

### 4.1 Orphan Foreign Keys

`visit_links.checkin_tracking_point_id` يشير إلى `tracking_points.id`. عند حذف النقاط:

- القيد: **لا يوجد FK فعلي** (أو هو soft reference)
- الأثر: `visit_links` ستبقى ولكن `checkin_tracking_point_id` سيشير إلى ID غير موجود
- الحل: `visits.check_in_latitude/longitude` (موجود في `visits` مباشرة) يستخدم كبديل

### 4.2 حمل قاعدة البيانات

| المدة | tracking_points (تقدير) | الحجم |
|------|-------------------------|-------|
| الحالي (7 أيام) | 338 نقطة | 224 KB |
| 90 يوم | ~4,300 نقطة | ~2.9 MB |
| 180 يوم | ~8,600 نقطة | ~5.7 MB |
| 365 يوم | ~17,500 نقطة | ~11.5 MB |

---

## 5. الحلول المقترحة

### 5.1 للشاشات المتأثرة

| الشاشة | المشكلة | الحل المقترح |
|--------|---------|-------------|
| Employee Day Map — Route | polyline فارغ | عرض رسالة "بيانات المسار غير متوفرة لهذا التاريخ" |
| Employee Day Map — Start/End | NULL من tracking_points | استخدام `workday_sessions.start_lat/lng` كبديل |
| Employee Day Map — Visit Locations | orphan tracking_point_id | استخدام `visits.check_in_lat/lng` مباشرة |
| Employee Day Map — Distance | 0 | استخدام `workday_sessions.total_distance_meters` المخزنة |
| tracking_points_count | 0 | إخفاء الحقل للجلسات التي count=0 أو عرض شرط "غير متوفر" |

### 5.2 تحسين RPC `get_employee_day_map` (اختياري)

يمكن تعديل الـ RPC ليقرأ start/end points من `workday_sessions` كـ fallback:

```sql
-- Fallback: إذا لم توجد نقطة بداية في tracking_points، اقرأ من workday_sessions
IF v_start_point IS NULL THEN
    SELECT jsonb_build_object(
        'latitude', v_session_record.start_latitude,
        'longitude', v_session_record.start_longitude,
        'recorded_at', v_session_record.start_time,
        'source', 'session_fallback'
    ) INTO v_start_point;
END IF;
```

---

## 6. القرار النهائي

| مستوى الحذف | المخاطر | القرار |
|------------|---------|--------|
| **90 يوم** | Employee Day Map يفقد المسار للجلسات > 90 يوم (محتمل حدوثه فقط إذا شوهدت جلسة قديمة على الخريطة) | ✅ آمن — التنفيذ مسموح |
| **180 يوم** | نفس 90 يوم مع نطاق أوسع | ✅ آمن — التنفيذ مسموح |
| **365 يوم** | نفس 90 يوم مع نطاق أوسع | ✅ آمن — التنفيذ مسموح |

**جميع KPIs التجارية** (الطلبات، المبيعات، التحصيلات، العملاء الجدد، الزيارات، ساعات العمل، الالتزام) **غير متأثرة** في جميع الحالات الثلاث.

**البيانات الوحيدة المفقودة**: مسار GPS التاريخي على الخريطة + عدد نقاط التتبع. هذه بيانات مساعدة وليست أساسية للتقارير.
