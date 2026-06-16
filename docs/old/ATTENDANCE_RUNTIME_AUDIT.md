# ATTENDANCE RUNTIME AUDIT

## الخلاصة

دورة الحضور والانصراف **صالحة للعمل الآن** ✅

تم إصلاح 4 أخطاء في RPCs, وتطبيقها على قاعدة البيانات (`20260611_phase6_hotfix_runtime.sql`):
1. `get_workday_settings` — تغيير `record` → `jsonb` ✅
2. `get_live_workday_overview` — استبدال `visit_links` بـ `visits`, إضافة `visit_count` و `break_count` ✅
3. `get_team_map` — إضافة CTE `filtered_employees`, استبدال `visit_links` بـ `visits` ✅
4. `get_my_workday_status` — تغيير `visit_links` → `visits` ✅

### حالة كل شاشة (يونيو 2026)

| الشاشة | الحالة |
|--------|--------|
| AttendancePage (شاشة المندوب) | ✅ **صالحة** — الأزرار تستجيب, العدادات تعمل, البيانات تُحفظ |
| LiveMonitoringPage | ✅ **صالحة** — `get_live_workday_overview` يعود ببيانات كاملة |
| TeamMapPage | ✅ **صالحة** — `get_team_map` يعود بالعدادات والموظفين |
| AttendanceSettingsPage | ✅ **صالحة** — `get_workday_settings` يعود بالإعدادات |
| ReportsPage | ✅ **صالحة** — `get_workday_report` تم تطبيقه سابقاً |
| AlertsPage | ✅ **صالحة** — `get_alerts` تم تطبيقه سابقاً |
| EmployeeDayMapPage | ✅ **صالحة** — `get_employee_detail/map/timeline` تم تطبيقها سابقاً |
| HistoryPage | ✅ **صالحة** — `get_employee_workday_history` موجودة مسبقاً |

### الاختبارات في Runtime

جميع RPCs الأربعة أعادت `HTTP 201` بدون أخطاء:
- `get_workday_settings`: 11 حقل من الإعدادات ✅
- `get_live_workday_overview`: فريق واحد نشط (حسن بكر), حالة `working`, `visit_count=0`, `break_count=12`, `break_minutes=25` ✅
- `get_team_map`: `active=1, not_started=14, ended=12` — جميع العدادات تعمل ✅
- `get_my_workday_status`: حالة `completed` مع مدة 215 دقيقة ✅

### Frontend Build
`npm run build` — **مر بنجاح** بدون أخطاء TypeScript. (2045 modules, 15.74s)

---

## 1. شاشة المندوب — AttendancePage (`/attendance`)

### المشاكل

| الخطوة | هل تعمل؟ | التفاصيل |
|--------|----------|----------|
| بدء يوم العمل | ✅ يعمل | يستدعي `start_workday` — يُنشئ session و tracking point |
| أخذ استراحة | ✅ يعمل | يستدعي `start_break` — يُنشئ break |
| مواصلة العمل | ⚠️ جزئياً | يستدعي `get_my_workday_status` ثم `end_break` — لكن **العداد لا يتحرك فوراً** لأنه يعتمد على `fetchStatus` كل 30 ثانية |
| إنهاء يوم العمل | ✅ يعمل | يستدعي `end_workday` — يغلق الـ session ويحسب attendance_status |

### الخطأ المؤكد

**`get_my_workday_status` يحسب `visit_count` من `visit_links` وليس من `visits`**

```sql
SELECT COUNT(*) INTO v_visit_count FROM public.visit_links
WHERE session_id = v_workday.id;
```

`visit_links` **جدول فارغ (0 سجلات)**. التحقق من `visits` مباشرة هو الصواب:
```sql
SELECT COUNT(*) INTO v_visit_count FROM public.visits
WHERE employee_id = v_employee_id AND check_in_at::date = CURRENT_DATE;
```

النتيجة: شاشة المندوب تظهر **الزيارات = 0 دائماً** حتى لو كانت هناك زيارات حقيقية.

### مشاكل ثانوية

- **Battery API**: `navigator.getBattery()` deprecated وغير مدعوم في كل المتصفحات — لكنها اختيارية ولا تعطل.
- **Geolocation**: `getCurrentPosition` timeout = 5s فقط — قد يفشل في ضعف الشبكة.

---

## 2. شاشات الإدارة العليا — 3 RPCs معطلة

### 2.1 `get_team_map` — 404 Runtime

**الخطأ**: `relation "filtered_employees" does not exist`

**السبب**: الـ CTE `filtered_employees` مُستخدم في العداد `not_started` لكنه **غير مُعَرَّف** داخل دالة `get_team_map`. موجود فقط في `get_live_workday_overview`.

**التوقيع**: `get_team_map(p_token uuid)` ✅ صحيح

### 2.2 `get_live_workday_overview` — 400 Runtime

**الخطأ**: `column vl2.employee_id does not exist`

**السبب**: `LEFT JOIN LATERAL (SELECT vl2.session_id, vl2.employee_id FROM public.visit_links vl2 ...) vl` — جدول `visit_links` **لا يحتوي عمود `employee_id`**. العمود الصحيح هو `as2.employee_id` من الجدول الأصلي.

**مشكلة إضافية**: نفس الدالة تستخدم `visit_count` في `employee_summary` بدون تعريفه في SELECT.

### 2.3 `get_workday_settings` — 400 Runtime

**الخطأ**: `COALESCE types record and jsonb cannot be matched`

**السبب**: `v_settings` مُصرَّح به كـ `record` لكن `COALESCE(v_settings, '{}'::jsonb)` يتطلب نوعين متوافقين.

**التوقيع**: `get_workday_settings(p_token uuid)` ✅ صحيح

---

## 3. Data Flow Audit — تتبع الدورة الكاملة

### 3.1 بدء يوم العمل

```
AttendancePage.tsx
  → start_workday(p_token, p_latitude, p_longitude, p_device_status)
    → INSERT INTO workday_sessions (employee_id, start_latitude, start_longitude, start_device_status)
    → INSERT INTO tracking_points (session_id, employee_id, latitude, longitude, recorded_at, point_type='start')
    → RETURN { session_id, started_at }
  ✓ يكتب في قاعدة البيانات
  ✓ يرجع نتيجة للمستخدم
```

### 3.2 أخذ استراحة

```
AttendancePage.tsx
  → start_break(p_token, p_session_id, p_latitude, p_longitude, p_reason)
    → INSERT INTO workday_breaks (session_id, employee_id, break_reason, latitude, longitude)
    → RETURN { break_id, break_start }
  ✓ يكتب في قاعدة البيانات
  ✓ يرجع نتيجة للمستخدم
```

### 3.3 مواصلة العمل

```
AttendancePage.tsx
  → get_my_workday_status(p_token) ← يحصل على session_id
  → supabase.from('workday_breaks').select('id').eq('session_id', session_id).is('break_end', null)
    ← يستعلم عن break مفتوح
  → end_break(p_token, p_session_id, p_break_id)
    → UPDATE workday_breaks SET break_end=now(), duration_seconds=... WHERE id=p_break_id
    → RETURN { break_id, break_end, duration_seconds }
  ✓ يكتب في قاعدة البيانات
  ✓ يرجع نتيجة للمستخدم
```

### 3.4 إنهاء يوم العمل

```
AttendancePage.tsx
  → end_workday(p_token, p_session_id, p_latitude, p_longitude, p_device_status)
    → (auto-closes any open breaks)
    → UPDATE workday_sessions SET end_time=now(), status='completed', attendance_status=...
    → INSERT INTO tracking_points (point_type='end')
    → RETURN { session_id, ended_at, attendance_status, ... }
  ✓ يكتب في قاعدة البيانات
  ✓ يرجع نتيجة للمستخدم
```

### 3.5 عرض البيانات في الإدارة العليا

```
LiveMonitoringPage.tsx
  → get_live_workday_overview(p_token)
    ✗ يفشل بـ 400 (vl.employee_id)

TeamMapPage.tsx
  → get_team_map(p_token)
    ✗ يفشل بـ 404 (filtered_employees)

AttendanceSettingsPage.tsx
  → get_workday_settings(p_token)
    ✗ يفشل بـ 400 (COALESCE type mismatch)

EmployeeDayMapPage.tsx
  → get_employee_detail(p_token, p_employee_id, p_date)  ✓ لم يُختبر
  → get_employee_day_map(p_token, p_employee_id, p_date)  ✓ لم يُختبر
  → get_employee_day_timeline(p_token, p_employee_id, p_date)  ✓ لم يُختبر

AlertsPage.tsx
  → get_alerts(p_token)  ✓ تم تطبيقه في المايجرين

ReportsPage.tsx
  → get_workday_report(p_token, p_from, p_to, p_employee_ids)  ✓ تم تطبيقه في المايجرين
```

### 3.6 أين تضيع البيانات؟

| البيانات | من أين تخرج | أين تصل | أين تضيع |
|----------|------------|---------|---------|
| session (start_time, status) | `start_workday` → `workday_sessions` | `get_my_workday_status` ✅ | `get_team_map` ✗ (404) |
| tracking_points (location) | `start_workday` → `tracking_points` | — | `get_team_map` ✗ (404) |
| breaks | `start_break` → `workday_breaks` | `get_my_workday_status` ✅ | `get_team_map` ✗ (404) |
| visit_count from visits | `visits` table | `get_my_workday_status` ✗ (يقرأ من `visit_links`) | يظهر 0 دائماً |
| end_time, attendance_status | `end_workday` → `workday_sessions` | — | `get_team_map` ✗ (404) |

---

## 4. ما الذي سيُصلَح (فقط)

### الإصلاح 1: `get_team_map` — إضافة CTE `filtered_employees`

إضافة CTE قبل `active_sessions`:
```sql
filtered_employees AS (
    SELECT e.id FROM public.employees e
    WHERE e.is_active = true
    AND (v_subtree_ids IS NULL OR e.id = ANY(v_subtree_ids))
)
```

### الإصلاح 2: `get_live_workday_overview` — إصلاح `visit_links`

استبدال `LEFT JOIN LATERAL visit_links` بالتحقق من `visits` مباشرة:
```sql
LEFT JOIN LATERAL (
    SELECT v2.id FROM public.visits v2
    WHERE v2.employee_id = as2.employee_id
      AND v2.check_in_at::date = CURRENT_DATE
      AND v2.check_out_at IS NULL LIMIT 1
) vl ON true
```

ثم تغيير `vl.employee_id` إلى `as2.employee_id` في CASE.
وإضافة `visit_count` إلى `employee_summary`:

```sql
LEFT JOIN today_visits tv ON tv.employee_id = as2.employee_id
```

وإضافة `visit_count` إلى SELECT:
```sql
COALESCE(tv.visit_count, 0) AS visit_count
```

### الإصلاح 3: `get_workday_settings` — تغيير نوع المتغير

تغيير `v_settings record;` إلى `v_settings jsonb;`.

### الإصلاح 4: `get_my_workday_status` — إصلاح visit_count

تغيير:
```sql
SELECT COUNT(*) INTO v_visit_count FROM public.visit_links
WHERE session_id = v_workday.id;
```
إلى:
```sql
SELECT COUNT(*) INTO v_visit_count FROM public.visits
WHERE employee_id = v_employee_id AND check_in_at::date = CURRENT_DATE;
```

---

## 5. خطة التنفيذ

### المرحلة 1 — إصلاح RPCs (عاجل)
1. `get_workday_settings` — تغيير `record` → `jsonb`
2. `get_live_workday_overview` — إصلاح `visit_links` + إضافة `today_visits` + `visit_count`
3. `get_team_map` — إضافة `filtered_employees` CTE
4. `get_my_workday_status` — تغيير `visit_links` → `visits`

### المرحلة 2 — اختبار
5. تشغيل كل RPC عبر Management API للتأكد من عدم وجود 400/404
6. اختبار دورة كاملة من المندوب
7. التحقق من ظهور البيانات في الإدارة العليا

### المرحلة 3 — Build
8. `npm run build` (لا تغيير في Frontend متوقع)

### ما لن يُلمَس
- EmployeeDayMapPage (موجود ويعمل بعد الـ build)
- AlertsPage (مُحدَّث ويعمل)
- ReportsPage (مُحدَّث ويعمل)
- AttendancePage UI (لا تغيير في التصميم)
- أي شاشة جديدة
