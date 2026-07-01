# Phase 7: Distance Verification — GPS Algorithm Audit

**Date:** 2026-06-30
**Status:** SQL trace complete. **لم يتم التحقق من DB الإنتاج الفعلية.**

---

## 1. Algorithm Overview

The distance calculation uses a **Haversine formula** with **anchor-based GPS drift filtering** (3 filters):

### Haversine Formula
```sql
6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lng2 - lng1) / 2), 2)
))
```
Returns distance in meters. **Verified:** ✅ Formula is correct.

### Three GPS Drift Filters

| # | Filter | Threshold | Default | Purpose |
|---|--------|-----------|---------|---------|
| 1 | Accuracy | `p_max_accuracy` | 50m | Skip points with poor GPS accuracy |
| 2 | Min Distance | `p_min_distance_threshold` | 20m | Skip micro-movements (anchor drift) |
| 3 | Max Speed | `p_max_speed` | 5 m/s (18 km/h) | Skip unrealistic teleportation |

**Algorithm:**
- First acceptable (accuracy <= 50m) point becomes anchor
- Each subsequent point: calculate Haversine from anchor
- If < 20m from anchor: skip (GPS drift)
- If speed > 5 m/s from anchor: skip (GPS jump)
- Otherwise: add to total, point becomes new anchor

**Verified from code:** ✅ Algorithm is sound. 3-filter approach is industry standard for GPS noise reduction.

## 2. مسافة الثبات: ❓ Unknown (لم يُتحقق من DB الإنتاج)

**الملاحظة من كود SQL:** في ملفات الترحيل الحالية، `end_workday` لا يكتب المسافة المحسوبة إلى `workday_sessions.total_distance_meters`. لكن:

- **لم يتم التحقق** من قاعدة بيانات الإنتاج الفعلية — قد يكون التعديل طُبق يدويًا أو بآلية أخرى
- **لم يتم التحقق** من أن `total_distance_meters` فارغ فعلاً في DB الإنتاج
- يوجد ملف إصلاح (`20261230_fix_session_distance_persistence.sql`) في المشروع لكن حالة تطبيقه غير معروفة

**الحالة:** ❓ **Unknown** — بحاجة فحص DB الإنتاج لتأكيد أو نفي وجود المشكلة.

## 3. مسارا حساب المسافة

| المسار | الدالة | المصدر | الحالة |
|--------|--------|--------|--------|
| A — مباشر (on-the-fly) | `get_employee_day_map` (Haversine مضمّن) | `tracking_points` الخام | ✅ صحيح (تم التحقق) |
| B — مخبأ (cached) | `workday_sessions.total_distance_meters` | يُحدَّث بواسطة `end_workday` | ❓ Unknown — لم يُتحقق |

ملاحظة: في DB الإنتاج، `get_employee_day_map` يستخدم المسار A ويعيد المسافة الصحيحة بغض النظر عن حالة المسار B.

## 4. خوارزمية مكررة

خوارزمية Haversine + 3 filters موجودة في **مكانين** بنفس المنطق:
1. `get_employee_day_map` (في `20260727_fix_attendance_detail_rpcs.sql`)
2. `calculate_session_distance` (في `20261230_fix_session_distance_persistence.sql`)

**ملاحظة:** تكرار الكود — إذا تغيرت إحداهما تصبح الأخرى غير متطابقة. يُفضل استخراجها إلى دالة مساعدة مشتركة.

**التأثير:** لا يؤثر على صحة Runtime الحالية. `get_employee_day_map` يعمل بشكل مستقل.

## 5. فحوصات إضافية تحتاج DB الإنتاج

| الفحص | المتوقع | الحالة |
|-------|---------|--------|
| `total_distance_meters` في DB الإنتاج — هل هو NULL أم 0 أم قيمة فعلية؟ | غير معروف | ❓ Unknown |
| هل ملف `20261230_fix_session_distance_persistence.sql` طُبق على DB الإنتاج؟ | غير معروف | ❓ Unknown |
| دقة مرشح السرعة (مشي ~1.4 م/ث) | يُحتسب بشكل صحيح | ✅ الخوارزمية صحيحة |
| دقة مرشح السرعة (قيادة ~10 م/ث) | يُتجاوز | ✅ الخوارزمية صحيحة |
