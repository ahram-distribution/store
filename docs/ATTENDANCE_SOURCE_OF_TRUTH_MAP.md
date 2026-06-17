# Attendance & GPS — Source of Truth Map

> تاريخ الإنشاء: 2026-06-17
> آخر تحديث: 2026-06-17

---

## Table of Contents

1. [Investigation: Completed Employees (المنتهون)](#1-investigation-completed-employees-المنتهون)
2. [Attendance Source of Truth](#2-attendance-source-of-truth)
3. [GPS Source of Truth](#3-gps-source-of-truth)
4. [Maps Source of Truth](#4-maps-source-of-truth)
5. [Operations Dashboard Source of Truth](#5-operations-dashboard-source-of-truth)
6. [Live Location vs Start/End Location](#6-live-location-vs-startend-location)

---

## 1. Investigation: Completed Employees (المنتهون)

### 1.1 مصدر بيانات المنتهون

**الشاشة**: `OperationsCenterPage.tsx` ← قسم "المنتهون" (التبويب `ended`)
**الراوت**: `/attendance/operations`
**الـ RPC**: `get_live_workday_overview(p_token)`
**الاستدعاء**: `src/services/attendance.ts:114` → `src/pages/operations-center/OperationsCenterPage.tsx:89`

### 1.2 مسار البيانات الكامل

```
Database: workday_sessions
    ↓
get_live_workday_overview RPC  (في: 20260724_identity_integration_layer.sql:651-667)
    ↓  (ended CTE: WHERE wds.date = CURRENT_DATE AND wds.status = 'completed')
attendanceService.getLiveOverview()  (src/services/attendance.ts:114)
    ↓
OperationsCenterPage.tsx  (سطر 89: يستدعي كل 30 ثانية)
    ↓
filteredEnded  (سطور 165-185: تصفية حسب القسم والمنطقة والبحث)
    ↓
TeamStatusTabs → 'ended' tab  (src/pages/operations-center/components/TeamStatusTabs.tsx:13)
    ↓
EmployeeCard variant="ended"  (src/pages/operations-center/components/EmployeeCard.tsx:253-306)
```

### 1.3 الـ SQL المسؤول

```sql
-- 20260724_identity_integration_layer.sql:651-667
ended AS (
    SELECT wds.employee_id, e.full_name AS employee_name, wds.end_time,
        EXTRACT(EPOCH FROM (wds.end_time - wds.start_time)) / 60 AS duration_minutes,
        wds.visit_count,
        COALESCE(to2.order_count, 0) AS order_count,
        COALESCE(to2.sales_value, 0) AS sales_value,
        COALESCE(tc.collection_count, 0) AS collection_count,
        COALESCE(tc.collection_amount, 0) AS collection_amount,
        COALESCE(tcu.new_customer_count, 0) AS new_customer_count
    FROM public.workday_sessions wds
    JOIN public.employees e ON e.id = wds.employee_id
    WHERE wds.date = CURRENT_DATE       -- <--- هنا المشكلة
      AND wds.status = 'completed'
)
```

### 1.4 السبب الجذري (Root Cause)

**الموظفون الذين أنهوا يوم العمل أمس/أول أمس/الأسبوع الماضي لا يظهرون** لأن:

الـ `ended` CTE في RPC `get_live_workday_overview` يصفّي بـ:

```
WHERE wds.date = CURRENT_DATE AND wds.status = 'completed'
```

هذا **ليس خطأ** — هذا **تصميم متعمد**. شاشة Operations Center هي **شاشة مراقبة حية** (Live Monitoring) تظهر فقط **بيانات اليوم الحالي**.

البيانات موجودة في قاعدة البيانات (43 جلسة مكتملة في آخر 30 يوم — تأكيد من الإنتاج)، لكنها لا تُستعرض في هذا القسم لأن القسم مخصص لليوم الحالي فقط.

### 1.5 إثبات وجود البيانات في الإنتاج

| الفترة | ACTIVE | COMPLETED |
|--------|--------|-----------|
| آخر 30 يوم | 5 | 43 |
| أمس (Jun 16) | 1 | 12 |
| أول أمس (Jun 15) | 1 | 2 |
| 3 أيام (Jun 14) | 1 | 4 |
| آخر أسبوع | 5 | 43 |

### 1.6 أين تظهر البيانات التاريخية؟

- **`EmployeeWorkdayDetailPage.tsx`** (`/attendance/employee/:employeeId/:date`): يستخدم `get_employee_workday_history` الذي يُرجع ONLY completed sessions
- **`get_workday_report`**: يُرجع تقريراً بالجلسات المكتملة في نطاق تاريخي
- **`get_attendance_analysis`**: تحليل الحضور للجلسات المكتملة

---

## 2. Attendance Source of Truth

### 2.1 Active Session Logic

| العنصر | المصدر الرسمي | التفاصيل |
|--------|---------------|----------|
| **حالة الجلسة الحالية** | `get_my_workday_status` RPC | يُرجع `status` = `null` \| `'active'` \| `'completed'` |
| **الجدول** | `workday_sessions` | مع unique index `(employee_id, date) WHERE status = 'active'` |
| **متى تصبح active** | `start_workday` RPC | تُنشئ session مع `status = 'active'` |
| **متى تنتهي** | `end_workday` RPC | تضع `status = 'completed'` |
| **قيود** | موظف واحد → جلسة active واحدة فقط في اليوم | فريد: `(employee_id, date) WHERE status = 'active'` |
| **مصدر العمال النشطين** | `get_live_workday_overview.employees` | CTE: `WHERE status = 'active' AND date = CURRENT_DATE` |

### 2.2 Completed Session Logic

| العنصر | المصدر الرسمي | التفاصيل |
|--------|---------------|----------|
| **جلسات اليوم المكتملة** | `get_live_workday_overview.ended_employees` | CTE: `WHERE date = CURRENT_DATE AND status = 'completed'` |
| **تاريخ الجلسات المكتملة** | `get_employee_workday_history` | يُرجع ONLY completed sessions في نطاق تاريخي |
| **تقرير الإنجاز** | `get_workday_report` | يُجمّع sessions المكتملة في نطاق تاريخي |
| **تحليل الحضور** | `get_attendance_analysis` | يحلل الالتزام للجلسات المكتملة |

---

## 3. GPS Source of Truth

### 3.1 تعريف الأنظمة

| النظام | المصدر | هل هو الحقيقة؟ |
|--------|--------|---------------|
| **`trackingEngine`** → `gpsService` → `tracking_points` | **النظام التشغيلي الحقيقي** | ✅ **نعم — Source of Truth** |
| **`/ops/gps-test`** (GpsTestPage) | شاشة تشخيص ← `gps_test_points` | ❌ تشخيص فقط |
| **`gpsEngine.ts`** | واجهة غير مستخدمة (0 imports) | ❌ مهجور |
| **`public/gps-test.html`** | صفحة HTML مستقلة | ❌ ليست ضمن التطبيق |

### 3.2 Live Location Source

| العنصر | المصدر الرسمي | التفاصيل |
|--------|---------------|----------|
| **الموقع الحالي للموظف** | `tracking_points` (آخر نقطة لكل موظف) | يُقرأ عبر `get_team_map` و `get_live_workday_overview` |
| **طريقة الالتقاط** | `trackingEngine._captureFromPositionImmediate()` → `sync_tracking_points` RPC | دورة 300 ثانية (قابلة للتعديل) |
| **مصدر GPS الخام** | `gpsService.ts` ← `navigator.geolocation.watchPosition` | الملف الوحيد المعتمد لاستخدام الـ Geolocation API |
| **الموقع عند بدء اليوم** | `workday_sessions.start_latitude/longitude` | نقطة واحدة فقط — مقطوعة من `start_workday` RPC |
| **الموقع عند إنهاء اليوم** | `workday_sessions.end_latitude/longitude` | نقطة واحدة فقط — مقطوعة من `end_workday` RPC |
| **آخر نشاط** | `workday_sessions.last_seen_at` | **بدون GPS** — يُحدّث بواسطة `record_heartbeat` (كل 60 ثانية) |

### 3.3 Tracking Source

```
gpsService.getCurrentLocation()   ← لقطات واحدة (workday, visits, customers)
gpsService.startWatching()         ← تتبع مستمر (trackingEngine)
    ↓
trackingEngine (دورة 300 ثانية)
    ↓
sync_tracking_points RPC
    ↓
tracking_points table   ← ✅ SOURCE OF TRUTH للتتبع المستمر
```

**قاعدة مهمة**: الموقع الحالي للموظف يُقرأ من `tracking_points` (آخر نقطة مسجلة)، **وليس** من `workday_sessions.last_seen_at` لأن `last_seen_at` هو مجرد طابع زمني بدون إحداثيات.

---

## 4. Maps Source of Truth

### 4.1 Team Map Source

| العنصر | المصدر | الملف |
|--------|--------|-------|
| **خريطة الفريق** (`/attendance/team-map`) | `get_team_map` RPC ← `tracking_points` | `TeamMapPage.tsx:94` |
| **خريطة غرفة العمليات** (`/attendance/operations` → 🗺️) | `get_team_map` RPC ← `tracking_points` | `MapTab.tsx:59` |
| **خريطة الموظف** (`/attendance/employee/:id/:date`) | `get_employee_day_map` RPC ← `tracking_points` + `visits` | `EmployeeWorkdayDetailPage.tsx:153` |

جميع الخرائط تقرأ من **`tracking_points`** — لا توجد أي شاشة خريطة غير متصلة بـ `tracking_points`.

### 4.2 Employee Map Source

```
get_employee_day_map(p_token, p_employee_id, p_date)
    ↓   ← 3 طبقات لتنقية GPS drift (accuracy, distance, speed)
tracking_points (مصفـّاة)
    ↓
    + visits.check_in_lat/lng, check_out_lat/lng
    ↓
المسار + نقاط الزيارات + نقاط التوقف الطويل على الخريطة
```

---

## 5. Operations Dashboard Source of Truth

### 5.1 Active Employees Source

| الشاشة | المصدر | التفاصيل |
|--------|--------|----------|
| Operations Center (`/attendance/operations`) | `get_live_workday_overview` | `WHERE date = CURRENT_DATE AND status = 'active'` |
| لوحة الإدارة العليا (`/`) | `get_live_workday_overview` | يعرض `active_count` فقط |
| شاشة مدير البيع | `get_live_workday_overview` | عبر `AttendanceData` |

### 5.2 Completed Employees Source

| الشاشة | المصدر | الفلتر | ملاحظة |
|--------|--------|--------|--------|
| Operations Center → تبويب "المنتهون" | `get_live_workday_overview.ended_employees` | `date = CURRENT_DATE` | **اليوم فقط** — لا يظهر الماضي |
| لوحة الإدارة العليا | `get_live_workday_overview.ended_count` | `date = CURRENT_DATE` | العدد فقط |
| تقرير الموظف (`/attendance/employee/:id/:date`) | `get_employee_workday_history` | تاريخ + `status = 'completed'` | **نعم — يظهر التاريخ** |
| تقرير الحضور | `get_workday_report` | نطاق تاريخي + `status = 'completed'` | **نعم — يظهر التاريخ** |

---

## 6. Live Location vs Start/End Location

| النوع | المصدر | الدقة | التحديث | الاستخدام |
|-------|--------|-------|---------|-----------|
| **Live Location** | `tracking_points` | ±10-100m | كل 300 ثانية | الخريطة الحية، الاتصال |
| **Start Location** | `workday_sessions.start_latitude/longitude` | ±10-100m | مرة واحدة (بدء اليوم) | إثبات بدء الدوام |
| **End Location** | `workday_sessions.end_latitude/longitude` | ±10-100m | مرة واحدة (إنهاء اليوم) | إثبات إنهاء الدوام |
| **Heartbeat** | `workday_sessions.last_seen_at` | **بدون GPS** | كل 60 ثانية | التحقق من اتصال التطبيق |
| **Visit Location** | `visits.check_in/out_lat/lng` + `unified_locations` | ±10-100m | كل زيارة | إثبات وجود في الموقع |

---

## 7. الخلاصة

### هل لدينا مشكلة في "المنتهون"؟

**لا — ليس خطأ.** البيانات موجودة (43 جلسة مكتملة في آخر 30 يوماً).

الـ "المنتهون" في شاشة Operations Center يُظهر فقط **اليوم الحالي** (`CURRENT_DATE`) حسب التصميم.

إذا احتجت لعرض الموظفين الذين أنهوا يوم العمل في أيام سابقة، استخدم:
1. **`/attendance/employee/:employeeId/:date`** — تفاصيل موظف بيوم محدد
2. **تقرير الحضور** — عبر `get_workday_report` أو `get_attendance_analysis`

### ما هو المصدر الحقيقي للموقع؟

| المفهوم | المصدر الرسمي |
|---------|---------------|
| الموقع الحالي للموظف | `tracking_points` (آخر نقطة) |
| بداية اليوم | `workday_sessions.start_lat/lng` |
| نهاية اليوم | `workday_sessions.end_lat/lng` |
| حالة الجلسة (active/completed) | `workday_sessions.status` |
| الموظفون النشطون اليوم | `get_live_workday_overview.employees` |
| الموظفون المنتهون اليوم | `get_live_workday_overview.ended_employees` |
| الموظفون المنتهون تاريخياً | `get_employee_workday_history.sessions` |
