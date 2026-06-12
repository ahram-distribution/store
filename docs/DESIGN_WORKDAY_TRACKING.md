# الحضور والانصراف — Design Specification

**Status:** Design Specification — Implementation Ready
**Module Key:** `attendance`
**Module Tier:** Primary (7th — alongside الطلبات, العملاء, الزيارات, المخزون, الموظفون, الائتمان)
**Based On:** `OWNER_KNOWLEDGE_BASE/17_WORKDAY_TRACKING_SYSTEM.md` + Final Design Specification + Design Adjustment + Operational Rules 1–19
**Date:** 2026-06-10

> **Naming Rule:** The term "Workday Tracking" or "Tracking" MUST NOT appear in any operational screen.
> All UI labels, screen titles, settings, and user-facing text use only Arabic operational terminology:
> الحضور والانصراف, بدء يوم العمل, إنهاء يوم العمل, المتابعة الحية, خريطة اليوم, سجل الأيام, التقارير, التنبيهات, خريطة الفريق, عرض الموقع, آخر ظهور, انقطاع متابعة.
>
> **Operational Rules (Source of Truth):**
> 1. **صافي ساعات العمل** هو مؤشر التشغيل الرسمي الوحيد لجميع التقارير والتحليلات وقياس الأداء.
> 2. **سبب الاستراحة** اختياري — قائمة بسيطة (استراحة قصيرة, صلاة, طعام, أخرى).
> 3. **الاستراحات المفتوحة** تُغلق تلقائياً عند وقت الانصراف إذا لم يضغط المستخدم "مواصلة العمل".
> 4. **التقارير** تحتوي على توزيع وقت المندوب: صافي العمل, الزيارات, التنقل, الاستراحات.
> 5. **التنبيهات** للإدارة فقط — لا تظهر للمندوب أي رسائل تتبع أو مراقبة.
> 6. **بساطة واجهة المندوب** — 4 أزرار فقط + 5 مؤشرات.
> 7. **Mobile First** — أزرار كبيرة, شاشات مختصرة, استخدام بيد واحدة.
> 8. **حالة آخر ظهور** — كل موظف في المتابعة الحية يظهر مع حالة اتصاله (🟢 متصل الآن, 🟡 آخر ظهور منذ X دقائق, 🔴 لا توجد بيانات حديثة).
> 9. **زر عرض الموقع المباشر** — في المتابعة الحية، زر مباشر لعرض موقع الموظف دون الدخول في خريطة اليوم الكاملة.
> 10. **خريطة الفريق** — شاشة إدارية مستقلة تعرض جميع الموظفين النشطين على خريطة واحدة مع عدادات التوزيع.
> 11. **كشف انقطاع التحديثات** — رصد انقطاع التحديثات (⚠ انقطاع متابعة) إذا تخطى الوقت الفاصل × 5 دون استلام تحديث موقع.
> 12. **تنبيهات الإشراف** — 5 أنواع تنبيهات إشرافية (لم يبدأ, يوم مفتوح, استراحة طويلة, لا تحديثات, لا زيارات) — للإدارة فقط.
> 13. **إجراءات سريعة** — من شاشة المتابعة الحية: فتح الخريطة, فتح سجل اليوم, فتح ملف الموظف مباشرة.
> 14. **جاهزية الخدمات المستقبلية** — تصميم يدعم لاحقاً: أقرب مندوب, توزيع المهام, تغطية المناطق.
> 15. **Mobile First للإدارة** — جميع شاشات الإشراف تعمل بكاملها على الجوال.
> 16. **التركيز التشغيلي** — كل شاشة تجيب على 6 أسئلة تشغيلية (من يعمل؟ من لم يبدأ؟ من في زيارة؟ من في استراحة؟ أين يوجد؟ هل هناك مشكلة؟).
> 17. **ربط مركز القيادة** — نظام الحضور والانصراف يُعرّض 5 مؤشرات تشغيلية لمركز القيادة (عدد العاملين, في زيارة, في استراحة, لم يبدأوا, انقطاع متابعة).
> 18. **مواعيد الدوام الرسمي** — الإدارة تضبط بداية ونهاية الدوام الرسمي من الإعدادات (لا قيم ثابتة في الكود). النظام يحسب التأخير, الانصراف المبكر, والغياب دون منع التشغيل.
> 19. **تقييم الالتزام وليس منع التشغيل** — التحليلات تقيس الالتزام فقط (بدأ في الموعد, تأخر, انصرف مبكراً, غياب). لا تمنع الموظف من بدء أو إنهاء يوم العمل بأي حال.

---

## Table of Contents

1. [Database Schema](#1-database-schema)
2. [Tables](#2-tables)
3. [Relationships](#3-relationships)
4. [RPC List](#4-rpc-list)
5. [Sync Model](#5-sync-model)
6. [Offline Model](#6-offline-model)
7. [Storage Estimation](#7-storage-estimation)
8. [Battery Impact Estimation](#8-battery-impact-estimation)
9. [Mobile UI Flow](#9-mobile-ui-flow)
10. [Upper Management UI Flow](#10-upper-management-ui-flow)
    - 10.1 [Settings](#101-screen-settings-الإعدادات)
    - 10.2 [Live Monitoring](#102-screen-live-monitoring-المتابعة-الحية)
    - 10.3 [Employee Timeline](#103-screen-employee-timeline-خريطة-اليوم)
    - 10.4 [Historical Records](#104-screen-historical-records-سجل-الأيام)
    - 10.5 [Reports](#105-screen-reports-التقارير)
    - 10.6 [Alerts](#106-screen-alerts-التنبيهات)
    - 10.7 [Team Map](#107-screen-team-map-خريطة-الفريق)
    - 10.8 [Operational Focus](#108-operational-focus-التركيز-التشغيلي)
    - 10.9 [Command Center Integration](#109-command-center-integration-ربط-مع-مركز-القيادة)
11. [Data Retention Strategy](#11-data-retention-strategy)
12. [Cleanup Strategy](#12-cleanup-strategy)
13. [Security and Permissions Model](#13-security-and-permissions-model)

---

## 1. Database Schema

### Overview

Six tables (plus generated columns for attendance analysis):

| Table | Purpose (Arabic in app) | Sync |
|-------|------------------------|------|
| `workday_settings` | إعدادات الحضور والانصراف (single row) | Server only |
| `workday_sessions` | سجلات أيام العمل للموظفين | Server + offline queue |
| `workday_breaks` | سجل الاستراحات لكل يوم عمل | Server + offline queue |
| `tracking_points` | نقاط تحديد الموقع الجغرافي | Batched upsert |
| `visit_links` | ربط الجدول الزمني بالزيارات | Server only |
| `tracking_cleanup_log` | سجل عمليات التنظيف | Server only |
| `offline_sync_queue` | سجل المزامنة المعلقة | Client only |

---

## 2. Tables

### 2.1 `workday_settings`

```sql
CREATE TABLE public.workday_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tracking_mode varchar(30) NOT NULL DEFAULT 'OFF'
        CHECK (tracking_mode IN ('OFF', 'VISITS_ONLY', 'WORKDAY', 'WORKDAY_PLUS_VISITS')),
    location_interval_seconds integer NOT NULL DEFAULT 300
        CHECK (location_interval_seconds IN (120, 300, 600, 900, 1800, 3600)),
    official_start_time time NOT NULL DEFAULT '09:00',     -- بداية الدوام الرسمي (Rule 18)
    official_end_time time NOT NULL DEFAULT '17:00',       -- نهاية الدوام الرسمي (Rule 18)
    late_threshold_minutes integer NOT NULL DEFAULT 0,     -- الدقائق المسموح بها قبل اعتبار التأخير
    early_departure_threshold_minutes integer NOT NULL DEFAULT 0,  -- الدقائق المسموح بها قبل اعتبار الانصراف المبكر
    retention_days integer NOT NULL DEFAULT 90
        CHECK (retention_days IN (7, 30, 90, 180, 365)),
    auto_cleanup_enabled boolean NOT NULL DEFAULT false,
    cleanup_frequency varchar(10) NOT NULL DEFAULT 'daily'
        CHECK (cleanup_frequency IN ('daily', 'weekly', 'monthly')),
    last_cleanup_at timestamptz,
    updated_by uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);
```

COMMENT ON COLUMN public.workday_settings.official_start_time IS
  'بداية الدوام الرسمي. مثلاً 08:00 أو 09:00. تستخدم لحساب التأخير.';
COMMENT ON COLUMN public.workday_settings.official_end_time IS
  'نهاية الدوام الرسمي. مثلاً 17:00 أو 18:00. تستخدم لحساب الانصراف المبكر.';
COMMENT ON COLUMN public.workday_settings.late_threshold_minutes IS
  'الدقائق المسموح بها بعد بداية الدوام قبل اعتبار الموظف متأخراً. 0 = أي تأخير يُحتسب.';
COMMENT ON COLUMN public.workday_settings.early_departure_threshold_minutes IS
  'الدقائق المسموح بها قبل نهاية الدوام قبل اعتبار الموظف منصرفاً مبكراً. 0 = أي انصراف مبكر يُحتسب.';

### 2.2 `workday_sessions`

```sql
CREATE TABLE public.workday_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id uuid NOT NULL,
    date date NOT NULL DEFAULT CURRENT_DATE,
    start_time timestamptz NOT NULL DEFAULT now(),
    end_time timestamptz,
    start_latitude decimal(10,7),
    start_longitude decimal(10,7),
    end_latitude decimal(10,7),
    end_longitude decimal(10,7),
    start_device_status jsonb,    -- battery %, network type, etc.
    end_device_status jsonb,
    status varchar(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'cancelled')),
    sync_status varchar(20) NOT NULL DEFAULT 'synced'
        CHECK (sync_status IN ('synced', 'pending', 'conflict')),
    total_distance_meters decimal(12,2) DEFAULT 0,
    visit_count integer DEFAULT 0,
    -- Attendance analysis fields (Rule 18) — populated by end_workday RPC
    attendance_status varchar(20) DEFAULT 'unknown'
        CHECK (attendance_status IN ('ontime', 'late', 'early_departure', 'absent', 'unknown')),
    late_minutes integer DEFAULT 0,          -- computed at end_workday based on current official_start_time
    early_departure_minutes integer DEFAULT 0,  -- computed at end_workday based on current official_end_time
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Foreign keys
ALTER TABLE public.workday_sessions ADD CONSTRAINT fk_wds_employee
    FOREIGN KEY (employee_id) REFERENCES public.employees (id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wds_employee_id ON public.workday_sessions (employee_id);
CREATE INDEX IF NOT EXISTS idx_wds_date ON public.workday_sessions (date);
CREATE INDEX IF NOT EXISTS idx_wds_status ON public.workday_sessions (status);
CREATE INDEX IF NOT EXISTS idx_wds_employee_date ON public.workday_sessions (employee_id, date);

-- One active session per employee per day
CREATE UNIQUE INDEX IF NOT EXISTS uq_wds_active_per_day
    ON public.workday_sessions (employee_id, date) WHERE status = 'active';

COMMENT ON TABLE public.workday_sessions IS
  'Each row = one workday session for one employee. Active sessions must be unique per employee per day.';
COMMENT ON COLUMN public.workday_sessions.start_device_status IS
  'Snapshot of device state at start: {battery: 85, network: "4g", provider: "..."}';
COMMENT ON COLUMN public.workday_sessions.sync_status IS
  'synced = confirmed on server, pending = created offline, conflict = needs resolution';
```

### 2.3 `workday_breaks`

```sql
CREATE TABLE public.workday_breaks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    break_start timestamptz NOT NULL DEFAULT now(),
    break_end timestamptz,
    duration_seconds integer,  -- computed on end (or on workday end if auto-closed)
    break_reason varchar(30),  -- optional: short_break, prayer, meal, other
    auto_closed boolean NOT NULL DEFAULT false,  -- true if closed by end_workday
    latitude decimal(10,7),    -- location when break started
    longitude decimal(10,7),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Foreign keys
ALTER TABLE public.workday_breaks ADD CONSTRAINT fk_wb_session
    FOREIGN KEY (session_id) REFERENCES public.workday_sessions (id) ON DELETE CASCADE;
ALTER TABLE public.workday_breaks ADD CONSTRAINT fk_wb_employee
    FOREIGN KEY (employee_id) REFERENCES public.employees (id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wb_session_id ON public.workday_breaks (session_id);
CREATE INDEX IF NOT EXISTS idx_wb_employee_id ON public.workday_breaks (employee_id);

COMMENT ON TABLE public.workday_breaks IS
  'سجل الاستراحات. كل استراحة تنتمي ليوم عمل واحد ولا تنهي يوم العمل.';
COMMENT ON COLUMN public.workday_breaks.duration_seconds IS
  'تحتسب عند إنهاء الاستراحة. الفرق بين break_end و break_start بالثواني.';
```

### 2.4 Attendance Analysis (تحليل الحضور) — Rule 18

تُحتسب حالة الالتزام لكل يوم عمل بناءً على مقارنة وقت الحضور والانصراف مع مواعيد الدوام الرسمي من `workday_settings`.

#### الحالات

| الحالة | المعيار | مثال (بداية 09:00, نهاية 17:00) |
|--------|---------|-------------------------------|
| بدأ في الموعد | بداية <= official_start + late_threshold | 09:00 → ✅ في الموعد |
| تأخر عن الدوام | بداية > official_start + late_threshold | 09:25 → ⏰ متأخر 25 دقيقة |
| انصرف مبكراً | نهاية < official_end - early_departure_threshold | 15:30 → 🚶 انصرف مبكراً 90 دقيقة |
| تجاوز ساعات الدوام | نهاية > official_end | 18:00 → ⏳ تجاوز ساعة |
| غياب كامل | لا يوجد session أو status = 'cancelled' | — ❌ غياب |

#### العمود المحتسبة

تضاف إلى `workday_sessions` حقول يُملؤها RPC `end_workday` عند إنهاء يوم العمل بناءً على إعدادات `workday_settings` في وقت الإنهاء:

| العمود | النوع | المنطق |
|--------|-------|--------|
| `attendance_status` | varchar(20) | `ontime`, `late`, `early_departure`, `absent`, `unknown` |
| `late_minutes` | integer | دقائق التأخير (0 إن لم يكن متأخراً) |
| `early_departure_minutes` | integer | دقائق الانصراف المبكر (0 إن لم ينصرف مبكراً) |

**طريقة الاحتساب (في `end_workday` RPC):**

```sql
-- يتم قراءة إعدادات الدوام الرسمي من workday_settings
SELECT official_start_time, official_end_time, late_threshold_minutes, early_departure_threshold_minutes
INTO v_start, v_end, v_late_thresh, v_early_thresh
FROM public.workday_settings LIMIT 1;

-- حساب التأخير
IF start_time::time > v_start + (v_late_thresh || ' minutes')::interval THEN
    attendance_status := 'late';
    late_minutes := EXTRACT(EPOCH FROM (start_time::time - v_start)) / 60;
END IF;

-- حساب الانصراف المبكر
IF end_time IS NOT NULL AND end_time::time < v_end - (v_early_thresh || ' minutes')::interval THEN
    attendance_status := 'early_departure';
    early_departure_minutes := EXTRACT(EPOCH FROM (v_end - end_time::time)) / 60;
END IF;

-- إذا لم يكن متأخراً ولا منصرفاً مبكراً
IF attendance_status = 'unknown' THEN
    attendance_status := 'ontime';
END IF;
```

#### Owner Rule

> **Rule 19:** هذه التحليلات تقيس الالتزام فقط. **لا تمنع** الموظف من بدء أو إنهاء يوم العمل بأي حال.
> تُحتسب قيم الالتزام عند إنهاء يوم العمل (`end_workday` RPC) بناءً على إعدادات `workday_settings` في وقت الإنهاء.
> هذا يضمن أن تغيير الإعدادات لاحقاً لا يغيّر السجلات التاريخية.

### 2.5 `tracking_points`

```sql
CREATE TABLE public.tracking_points (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    latitude decimal(10,7) NOT NULL,
    longitude decimal(10,7) NOT NULL,
    accuracy_meters decimal(8,2),
    altitude_meters decimal(8,2),
    speed_mps decimal(6,2),
    heading_degrees decimal(5,1),
    battery_pct decimal(4,1),
    recorded_at timestamptz NOT NULL,
    synced_at timestamptz NOT NULL DEFAULT now(),
    point_type varchar(20) NOT NULL DEFAULT 'periodic'
        CHECK (point_type IN ('periodic', 'start', 'end', 'visit_checkin', 'visit_checkout', 'long_stop', 'manual'))
);

-- Foreign keys
ALTER TABLE public.tracking_points ADD CONSTRAINT fk_tp_session
    FOREIGN KEY (session_id) REFERENCES public.workday_sessions (id) ON DELETE CASCADE;
ALTER TABLE public.tracking_points ADD CONSTRAINT fk_tp_employee
    FOREIGN KEY (employee_id) REFERENCES public.employees (id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tp_session_id ON public.tracking_points (session_id);
CREATE INDEX IF NOT EXISTS idx_tp_employee_id ON public.tracking_points (employee_id);
CREATE INDEX IF NOT EXISTS idx_tp_recorded_at ON public.tracking_points (recorded_at);
-- BRIN index for large-table time-range queries
CREATE INDEX IF NOT EXISTS idx_tp_recorded_at_brin
    ON public.tracking_points USING BRIN (recorded_at) WITH (pages_per_range = 32);

COMMENT ON TABLE public.tracking_points IS
  'GPS breadcrumbs. Heavily write-optimised. BRIN index on recorded_at for time-range scans.';
COMMENT ON COLUMN public.tracking_points.point_type IS
  'periodic=scheduled, start=workday start, end=workday end, visit_checkin/out=linked to visit, long_stop=idle detection, manual=on-demand';
```

### 2.6 `visit_links`

```sql
CREATE TABLE public.visit_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL,
    visit_id uuid NOT NULL,
    checkin_tracking_point_id uuid,   -- nullable until point is synced
    checkout_tracking_point_id uuid,  -- nullable until point is synced
    checkin_at timestamptz NOT NULL,
    checkout_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Foreign keys
ALTER TABLE public.visit_links ADD CONSTRAINT fk_vl_session
    FOREIGN KEY (session_id) REFERENCES public.workday_sessions (id) ON DELETE CASCADE;
ALTER TABLE public.visit_links ADD CONSTRAINT fk_vl_visit
    FOREIGN KEY (visit_id) REFERENCES public.visits (id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_vl_session_id ON public.visit_links (session_id);
CREATE INDEX IF NOT EXISTS idx_vl_visit_id ON public.visit_links (visit_id);

COMMENT ON TABLE public.visit_links IS
  'Links workday timeline to visit events. Only populated in WORKDAY_PLUS_VISITS mode.';
```

### 2.7 `tracking_cleanup_log`

```sql
CREATE TABLE public.tracking_cleanup_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    action_type varchar(20) NOT NULL
        CHECK (action_type IN ('auto_cleanup', 'manual_cleanup', 'manual_delete')),
    deleted_sessions int NOT NULL DEFAULT 0,
    deleted_points int NOT NULL DEFAULT 0,
    cutoff_date timestamptz,
    employee_id uuid,
    reason text,
    executed_by uuid NOT NULL,
    executed_at timestamptz NOT NULL DEFAULT now()
);

-- Foreign keys
ALTER TABLE public.tracking_cleanup_log ADD CONSTRAINT fk_tcl_executed_by
    FOREIGN KEY (executed_by) REFERENCES public.employees (id);

COMMENT ON TABLE public.tracking_cleanup_log IS
  'Audit trail of every data removal operation on tracking data.';
```

---

## 3. Relationships

```
workday_settings (1)  ← singleton, no FK to other tables

employees (1) ──→ workday_sessions (many)
  An employee can have one active session per day.
  Historical sessions accumulate.

workday_sessions (1) ──→ workday_breaks (many)
  Cascading delete: breaks belong to the session.
  Each break stores start, end, duration, and location.

workday_sessions (1) ──→ tracking_points (many)
  Cascading delete: when a session is cleaned up, its points go too.
  BRIN index optimises large-scale point queries by time.

workday_sessions (1) ──→ visit_links (many)
  Only populated in WORKDAY_PLUS_VISITS mode.
  Links to visits which have their own lifecycle.

visits (1) ──→ visit_links (many)
  A visit may appear in multiple workday sessions only if it
  crosses midnight (edge case — rare).

tracking_cleanup_log — independent audit table, FK to employees (executor).
```

**Data flow diagram (text):**

```
[Employee taps "بدء يوم العمل"]
    ↓
workday_sessions.insert({ employee_id, start_time, start_location })
    ↓
[Timer fires every N seconds (from workday_settings.location_interval_seconds)]
    ↓
tracking_points.insert({ session_id, lat, lng, recorded_at })
    ↓
[Employee taps "أخذ استراحة"]  (optional, any number of times)
    ↓
workday_breaks.insert({ session_id, employee_id, break_start })
Hides break button, shows "مواصلة العمل"
    ↓
[Employee taps "مواصلة العمل"]
    ↓
workday_breaks.update({ break_end: now(), duration_seconds: ... })
Shows break button again
    ↓
[Visit check-in/out events (when VISITS_ONLY or WORKDAY_PLUS_VISITS)]
    ↓
tracking_points.insert({ point_type: 'visit_checkin' })
visit_links.insert({ session_id, visit_id, checkin_at })
    ↓
[Employee taps "إنهاء يوم العمل"]
    ↓
[Auto-close any open break — Rule 3]
IF EXISTS (SELECT 1 FROM workday_breaks WHERE session_id = session AND break_end IS NULL) THEN
    UPDATE workday_breaks SET break_end = now(), duration_seconds = ..., auto_closed = true
    WHERE session_id = session AND break_end IS NULL;
END IF;
    ↓
workday_sessions.update({ end_time, end_location, status: 'completed' })
    ↓
[Auto-cleanup cron (per workday_settings.cleanup_frequency)]
    ↓
DELETE tracking_points WHERE recorded_at < cutoff
DELETE workday_sessions WHERE end_time < cutoff
INSERT tracking_cleanup_log
```

---

## 4. RPC List

### Employee-facing (6)

| RPC | Purpose | Parameters | Returns |
|-----|---------|-----------|---------|
| `start_workday(p_token, p_latitude, p_longitude, p_device_status)` | بدء يوم العمل | token, lat, lng, device_status jsonb | `{ session_id, started_at }` |
| `end_workday(p_token, p_session_id, p_latitude, p_longitude, p_device_status)` | إنهاء يوم العمل — يغلق تلقائياً أي استراحة مفتوحة | token, session_id, lat, lng, device_status | `{ session_id, ended_at, duration_minutes, auto_closed_breaks: N }` |
| `start_break(p_token, p_session_id, p_latitude, p_longitude, p_reason)` | أخذ استراحة (السبب اختياري) | token, session_id, lat, lng, reason (optional) | `{ break_id, break_start }` |
| `end_break(p_token, p_session_id, p_break_id)` | مواصلة العمل | token, session_id, break_id | `{ break_id, break_end, duration_seconds }` |
| `get_my_workday_status(p_token)` | حالة يوم العمل الحالية | token | `{ status, session, today_visits, today_breaks, duration, break_duration }` or null |
| `sync_tracking_points(p_token, p_session_id, p_points jsonb)` | مزامنة النقاط المخزنة محلياً | token, session_id, points[] | `{ synced: N, rejected: N }` |

### Upper Management — Configuration (3)

| RPC | Purpose | Parameters | Returns |
|-----|---------|-----------|---------|
| `get_workday_settings(p_token)` | Read config (including official hours) | token | `workday_settings` row (with official_start_time, official_end_time, thresholds) |
| `update_workday_settings(p_token, p_fields jsonb)` | Write config (including official hours) | token, `{ tracking_mode, official_start_time, official_end_time, late_threshold_minutes, early_departure_threshold_minutes, location_interval_seconds, retention_days, ... }` | `{ success }` |
| `get_workday_cleanup_log(p_token, p_limit)` | View cleanup history | token, limit | `[cleanup_log rows]` |

### Upper Management — Operations (10)

| RPC | Purpose | Parameters | Returns |
|-----|---------|-----------|---------|
| `get_live_workday_overview(p_token)` | Dashboard summary with last_seen | token | `{ active_count, no_start_count, on_visit_count, connection_loss_count, ended_count, employees[] }` each employee has: `{ ..., last_seen_at, last_seen_label, connection_status, recent_location }` |
| `get_employee_day_timeline(p_token, p_employee_id, p_date)` | Full timeline with time distribution | token, employee_id, date | `{ session, points[], breaks[], visit_links[], time_distribution: { net_work_seconds, visit_seconds, travel_seconds, break_seconds } }` |
| `get_employee_day_map(p_token, p_employee_id, p_date)` | Map data | token, employee_id, date | `{ start_point, end_point, route_polyline, visit_locations, stop_locations }` |
| `get_employee_workday_history(p_token, p_employee_id, p_from, p_to)` | Historical list with attendance_status | token, employee_id, date_from, date_to | `[{ session, duration, distance, visits, attendance_status, late_minutes, early_departure_minutes }]` |
| `get_team_map(p_token)` | خريطة الفريق — active employees on map | token | `{ counters: { active, on_visit, on_break, not_started }, employees: [{ id, name, status, lat, lng, last_seen, recent_location }] }` |
| `get_workday_report(p_token, p_from, p_to, p_employee_ids)` | Aggregated report | token, date_from, date_to, employee_ids[] | `{ summary, employees[] }` |
| `get_attendance_analysis(p_token, p_from, p_to, p_employee_ids)` | تحليل الالتزام — late/early/absence compliance | token, date_from, date_to, employee_ids[] | `{ summary: { late_days, late_minutes, early_departure_days, early_departure_minutes, absent_days, ontime_days }, employees[] }` |
| `get_alerts(p_token)` | تنبيهات الحضور والانصراف (للمدير فقط) | token | `{ active_alerts[], resolved_alerts[] }` |
| `get_employee_current_location(p_token, p_employee_id)` | عرض الموقع المباشر — live location popup | token, employee_id | `{ employee_id, name, lat, lng, address, status, last_updated_at }` |
| `cleanup_tracking_data(p_token, p_mode, p_employee_id, p_from, p_to)` | Manual cleanup | token, mode('all'|'range'|'employee'|'day'), params | `{ deleted_sessions, deleted_points }` |

### Internal / Scheduled (2)

| RPC | Purpose | Parameters |
|-----|---------|-----------|
| `auto_cleanup_tracking_data()` | Cron-triggered retention enforcement | (none — reads settings) |
| `detect_long_stops(p_token, p_session_id, p_threshold_minutes)` | Identify idle periods | token, session_id, threshold (default 15) |

---

## 5. Sync Model

### Architecture

```
┌─────────────────────────────────────────────────┐
│                  Mobile Client                    │
│                                                  │
│  ┌──────────┐   ┌────────────┐   ┌───────────┐  │
│  │  IndexedDB│──▶│Sync Queue  │──▶│  Batcher  │  │
│  │ (offline) │   │(pending)   │   │(chunk by  │  │
│  └──────────┘   └────────────┘   │ 50 points)│  │
│                                  └─────┬─────┘  │
│                                        │        │
└────────────────────────────────────────┼────────┘
                                         │ HTTPS
                                         ▼
                              ┌──────────────────┐
                              │   Supabase RPC    │
                              │ sync_tracking_   │
                              │ points()          │
                              └──────────────────┘
```

### Sync strategy

1. **Priority**: Sync session start/end events immediately (critical). Points are deferrable.
2. **Batching**: Points uploaded in chunks of 50 to avoid request size limits.
3. **Retry**: Exponential backoff: 2s → 4s → 8s → 16s → 32s → max 60s. Retry until success.
4. **Conflict resolution**: Server timestamp wins. If a session was already ended server-side, late points are still accepted (attached to the session).
5. **Idempotency**: Each tracking point carries a client-generated UUID. Server uses `ON CONFLICT (id) DO NOTHING` to prevent duplicates.
6. **Session continuity**: If a session is started offline and the device goes online, the session start is uploaded first, then queued points are attached to the now-known server session_id.

### Client-side queue table (IndexedDB)

```typescript
interface OfflineTrackingQueue {
  id: string              // client-generated UUID
  session_client_id: string // client session UUID (maps to server after sync)
  employee_id: string
  latitude: number
  longitude: number
  accuracy: number
  recorded_at: string     // ISO 8601
  point_type: string
  retry_count: number
  last_retry_at: string | null
  status: 'pending' | 'syncing' | 'synced' | 'failed'
}
```

---

## 6. Offline Model

### Detection

`navigator.onLine` + periodic heartbeat ping to `supabase.co` (every 60s). When both fail → offline mode.

### Offline behavior

| Feature | Online | Offline |
|---------|--------|---------|
| Start workday | RPC call → server | Create local session_id, queue start event |
| Location points | Periodic RPC batch | Store in IndexedDB |
| End workday | RPC call → server | Queue end event locally |
| Visit links | RPC with visit_id | Queue with pending status |
| View my status | RPC call | IndexedDB local session |
| Settings | RPC call | Cached from last online fetch |

### Online transition

1. `window.addEventListener('online', handleOnline)`
2. Drain sync queue in priority order: session start/end → visit links → points
3. Update local IndexedDB with server-confirmed IDs
4. Notify UI of sync completion

### Data guarantees

- No points dropped during offline period
- Session can be started and ended entirely offline (both events queued)
- If session was ended offline and device never comes back, the data is available on the next device the employee uses (after sync resolves)

---

## 7. Storage Estimation

### Server-side

| Data | Per point/event | Per employee/day | 50 employees × 90 days |
|------|----------------|------------------|------------------------|
| Tracking point | ~120 bytes (lat+lng+accuracy+altitude+speed+heading+battery+type+timestamps+UUIDs) | 96 points × 120B = ~11.5KB (5-min interval, 8h day) | 11.5KB × 50 × 90 = ~51.8MB |
| Workday session | ~500 bytes | 1 × 500B = 0.5KB | 0.5KB × 50 × 90 = ~2.3MB |
| Visit links | ~200 bytes | ~8 visits × 200B = 1.6KB | 1.6KB × 50 × 90 = ~7.2MB |
| **Total** | | **~13.6KB/day/employee** | **~61.3MB** |

At 2-min interval: ~34KB/day/employee → ~153MB for 50 employees × 90 days.
At 15-min interval: ~4.5KB/day/employee → ~20MB for 50 employees × 90 days.

**Verdict**: Storage is negligible even at aggressive intervals. The bigger concern is write throughput on tracking_points, mitigated by BRIN index and batch inserts.

### Client-side (IndexedDB)

~Same as estimated daily server volume per employee (~13.6KB/day), since offline queue holds at most a few days of unsynced data. Well within browser storage limits (typically 50MB+ for IndexedDB).

---

## 8. Battery Impact Estimation

### GPS power consumption factors

| Interval | GPS-on time per 8h day | Estimated drain (typical phone) |
|----------|----------------------|-------------------------------|
| 2 min | 240 acquisitions | ~8-10% of battery |
| 5 min | 96 acquisitions | ~4-6% of battery |
| 10 min | 48 acquisitions | ~2-3% of battery |
| 15 min | 32 acquisitions | ~1.5-2.5% of battery |
| 30 min | 16 acquisitions | ~1-2% of battery |
| 60 min | 8 acquisitions | ~0.5-1% of battery |

### Optimisations

1. **Passive GPS**: Use `navigator.geolocation.watchPosition` with `{ enableHighAccuracy: false }` between scheduled points. This uses WiFi/cell triangulation (negligible drain). Only acquire high-accuracy GPS at the scheduled interval.
2. **Significant-change detection**: If the employee hasn't moved >100m since last point, skip the point and reschedule (reduces duplicate points during idle periods).
3. **Battery-aware throttling**: If device battery <20%, double the interval. If <10%, quadruple the interval.
4. **No accelerometer**: Don't keep the CPU awake unnecessarily. Use system alarm/worker timers.
5. **Batch network**: Points are bundled and uploaded every N points or every 15 minutes (whichever comes first), keeping the radio in low-power mode between batches.

**Verdict**: At the preferred 5-min interval, expect ~4-6% additional battery drain per 8-hour workday. This is acceptable for field employees who can charge overnight. The setting is configurable by Upper Management if battery life is a concern.

---

## 9. Mobile UI Flow

### Screen: Employee Attendance (الحضور والانصراف) — Mobile First

> **Rule 6:** واجهة المندوب تحتوي فقط على 4 أزرار و 5 مؤشرات. لا توجد مصطلحات تقنية أو إشارات للتتبع أو GPS أو المراقبة.

**Before starting:**

```
┌─────────────────────────────────────────┐
│   الحضور والانصراف                       │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐    │
│  │    ☀️  بدء يوم العمل            │    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  يوم موفق بإذن الله 🎉                  │
│                                         │
└─────────────────────────────────────────┘
```

4 أزرار متاحة (حسب الحالة):
1. **بدء يوم العمل** — متاح قبل البدء
2. **أخذ استراحة** — متاح بعد البدء
3. **مواصلة العمل** — متاح أثناء الاستراحة
4. **إنهاء يوم العمل** — متاح بعد البدء

5 مؤشرات معروضة (بعد البدء):
1. وقت الحضور
2. مدة اليوم
3. إجمالي الاستراحات
4. صافي وقت العمل
5. عدد الزيارات

**Normal working state:**

```
┌─────────────────────────────────────────┐
│   الحضور والانصراف                       │
├─────────────────────────────────────────┤
│                                         │
│  الحضور:       08:15 ص                  │
│  مدة اليوم:    06:20                    │
│  الاستراحات:   00:40                    │
│  صافي العمل:   05:40    ← المقياس الرسمي│
│  الزيارات:     3                        │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │         [ أخذ استراحة ]         │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │       [ إنهاء يوم العمل ]        │    │
│  └─────────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

**Break state:**

```
┌─────────────────────────────────────────┐
│   الحضور والانصراف                       │
├─────────────────────────────────────────┤
│                                         │
│  الحضور:       08:15 ص                  │
│  مدة اليوم:    02:34                    │
│  الاستراحات:   00:15                    │
│  صافي العمل:   02:19                    │
│  الزيارات:     3                        │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │        [ مواصلة العمل ]         │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │       [ إنهاء يوم العمل ]        │    │
│  └─────────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

**Break reason selection (optional) — Rule 2:**

عند الضغط على "أخذ استراحة":

```
┌─────────────────────────────────┐
│  سبب الاستراحة (اختياري)        │
│                                 │
│  ○ استراحة قصيرة               │
│  ● استراحة صلاة                │
│  ○ استراحة طعام                │
│  ○ أخرى                        │
│                                 │
│  ┌──────────────────────┐      │
│  │   [ بدء الاستراحة ]  │      │
│  └──────────────────────┘      │
└─────────────────────────────────┘
```

الحقل غير إجباري. يمكن الضغط على "بدء الاستراحة" مباشرة دون اختيار سبب.

### Start workday confirmation

عند الضغط على **بدء يوم العمل**:

```
┌─────────────────────────────────┐
│                                 │
│    يوم موفق بإذن الله 🎉        │
│                                 │
│    [حسناً]                      │
│                                 │
└─────────────────────────────────┘
```

رسالة إيجابية بسيطة فقط. لا ذكر للتتبع أو GPS.

### Confirmation dialogs

- **End**: "سيتم تسجيل الانصراف. المدة: 02:34. هل تريد الإنهاء؟" → [إنهاء] [إلغاء]

### Confirmation dialogs

- **Start**: "سيتم تسجيل الحضور وبدء يوم العمل. هل تريد البدء؟" → [بدء] [إلغاء]
- **End**: "سيتم تسجيل الانصراف. المدة: 02:34. هل تريد الإنهاء؟" → [إنهاء] [إلغاء]

### Employee states

> **Rule 6:** فقط 4 أزرار و 5 مؤشرات. لا تظهر أي تقنيات تتبع للمندوب.

| State | Available Buttons | Status Label | Indicators Shown |
|-------|-----------------|-------------|-----------------|
| لم يبدأ | [بدء يوم العمل] | — | — |
| يعمل | [أخذ استراحة] + [إنهاء يوم العمل] | ✅ يعمل | الحضور, مدة اليوم, الاستراحات, صافي العمل, الزيارات |
| في استراحة | [مواصلة العمل] + [إنهاء يوم العمل] | 🟡 في استراحة | الحضور, مدة اليوم, الاستراحات, صافي العمل, الزيارات |
| في زيارة | [أخذ استراحة] + [إنهاء يوم العمل] | 🔵 في زيارة | الحضور, مدة اليوم, الاستراحات, صافي العمل, الزيارات |
| أنهى اليوم | — | ⬜ انتهى | إجمالي المدة + صافي ساعات العمل |
| *(Connection loss — management only)* | — | ⚠ انقطاع متابعة | آخر تحديث: HH:MM |

### Last Seen connection status (management view only, in Live Monitoring)

| Status Label | Criteria | Shown to Employee? |
|-------------|----------|-------------------|
| 🟢 متصل الآن | Last tracking point < 1× `location_interval_seconds` ago | ❌ لا |
| 🟡 آخر ظهور منذ X دقائق | Last point between 1× and 5× interval ago | ❌ لا |
| 🔴 لا توجد بيانات حديثة | Last point > 5× interval ago or no data today | ❌ لا |
| ⚠ انقطاع متابعة | No update for 5× interval AND employee was active today | ❌ لا |

**Calculation:** `FLOOR(EXTRACT(EPOCH FROM (now() - last_tracking_point.recorded_at)) / 60)` دقائق.

**Connection Loss causes (Rule 11):** تنبيه انقطاع المتابعة لا يعني بالضرورة مشكلة تقنية — قد يكون أحد الأسباب التالية:

| السبب | يظهر كـ | ملاحظة |
|-------|---------|--------|
| جهاز المندوب غير متصل بالإنترنت | ⚠ انقطاع متابعة | شائع — قد يكون المندوب في منطقة بدون تغطية |
| التطبيق مغلق أو في الخلفية | ⚠ انقطاع متابعة | قد يغلق المندوب التطبيق دون قصد أو لضعف البطارية |
| صلاحيات تحديد الموقع ملغاة | ⚠ انقطاع متابعة | يحتاج تذكير المندوب بتفعيل صلاحيات الموقع |
| تعطل في التطبيق أو إعادة تشغيل | ⚠ انقطاع متابعة | مؤقت — يعود بعد فتح التطبيق

---

## 10. Upper Management UI Flow

### 10.1 Screen: Attendance Settings (إعدادات الحضور والانصراف)

> **Rule 18:** بداية ونهاية الدوام الرسمي قابلة للتعديل من الإعدادات. لا قيم ثابتة في الكود.

```
┌─────────────────────────────────────────┐
│  إعدادات الحضور والانصراف               │
├─────────────────────────────────────────┤
│                                         │
│  ─────── مواعيد الدوام الرسمي ───────   │
│                                         │
│  بداية الدوام الرسمي                    │
│  [  09:00  ]  ⏰                         │
│                                         │
│  نهاية الدوام الرسمي                    │
│  [  17:00  ]  ⏰                         │
│                                         │
│  المهلة المسموحة للتأخير               │
│  [  0  ] دقيقة                          │
│                                         │
│  المهلة المسموحة للانصراف المبكر       │
│  [  0  ] دقيقة                          │
│                                         │
│  ───────────────────────────────────    │
│                                         │
│  نظام التتبع                            │
│  ○ متوقف  ○ أثناء الزيارة فقط          │
│  ○ يوم العمل  ● يوم العمل + الزيارات   │
│                                         │
│  ➤ المفضل: يوم العمل + الزيارات        │
│                                         │
│  ───────────────────────────────────    │
│                                         │
│  تردد التتبع                            │
│  ● كل 5 دقائق  ○ كل 10 دقائق           │
│  ○ كل 15 دقيقة ○ كل 30 دقيقة           │
│  ○ كل ساعة     ○ كل دقيقتين            │
│                                         │
│  ───────────────────────────────────    │
│                                         │
│  الاحتفاظ بالبيانات                      │
│  ● 90 يوماً  ○ 30 يوماً  ○ 180 يوماً   │
│  ○ 7 أيام    ○ سنة        ○ بدون حذف   │
│                                         │
│  الحذف التلقائي                          │
│  ● مفعل  ○ معطل                        │
│  التردد: [شهري]                        │
│                                         │
│  آخر تنظيف: 2026-06-01                  │
│                                         │
│  ┌────────────────────────────────┐     │
│  │        [ حفظ الإعدادات ]       │     │
│  └────────────────────────────────┘     │
│                                         │
└─────────────────────────────────────────┘
```

**Access:** الحضور والانصراف ← الإعدادات
**Permission:** Upper Management only (سوبر أدمن, رئيس مجلس الإدارة, أدمن)

### 10.2 Screen: Live Monitoring (المتابعة الحية)

> **Rule 8 (Last Seen):** كل موظف يظهر مع حالة اتصاله محتسبة من آخر نقطة تحديد موقع مقابل الفاصل الزمني المضبوط في الإعدادات.
> **Rule 9 (Location Button):** زر 📍 عرض الموقع مباشر لكل موظف يفتح نافذة خفيفة بالموقع الحالي دون التنقل لخريطة اليوم.
> **Rule 11 (Connection Loss):** إذا لم يستلم النظام تحديث موقع لأكثر من الفاصل الزمني × 5، يظهر الموظف كـ ⚠ انقطاع متابعة.
> **Rule 13 (Quick Actions):** كل صف موظف يحتوي على 3 إجراءات سريعة: فتح الخريطة, فتح سجل اليوم, فتح ملف الموظف.
> **Rule 16 (Operational Focus):** الشاشة تجيب على: من يعمل الآن؟ من لم يبدأ؟ من في زيارة؟ من في استراحة؟ أين يوجد؟ هل هناك مشكلة؟

```
┌─────────────────────────────────────────┐
│  المتابعة الحية            📅 اليوم     │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │
│  │  12  │ │  3   │ │  8   │ │  1   │  │
│  │نشط   ││بدون  ││بزيارة││انقطاع││
│  │      ││بدء   ││      ││متابعة││
│  └──────┘ └──────┘ └──────┘ └──────┘  │
│                                         │
│  ─────── الموظفون النشطون ────────      │
│                                         │
│  👤 أحمد علي          02:34  📍📍📍    │
│    🟢 متصل الآن                        │
│    بدأ: 08:15   آخر موقع: شارع الجمهورية│
│    📍 عرض الموقع  🗺️  📋  👤           │
│                                         │
│  👤 محمد حسن         01:50  📍📍       │
│    🟡 آخر ظهور منذ 12 دقيقة            │
│    بدأ: 08:47   آخر موقع: ميدان المحطة  │
│    📍 عرض الموقع  🗺️  📋  👤           │
│                                         │
│  👤 سامي نور         00:00  —           │
│    🔴 لا توجد بيانات حديثة              │
│    بدأ: 08:00   آخر موقع: —             │
│    ⚠ انقطاع متابعة (آخر تحديث 10:00)   │
│    📍 عرض الموقع  🗺️  📋  👤           │
│                                         │
│  ─────── بدون بدء اليوم ──────────      │
│                                         │
│  👤 خالد عمر  —  ❌ لم يبدأ بعد        │
│    🟡 آخر ظهور منذ ساعة (أمس)           │
│    📋  👤                               │
│                                         │
│  ─────── أنهوا يوم العمل ─────────      │
│                                         │
│  👤 كريم سعد   06:32  12 زيارة         │
│    🟢 متصل الآن (غير نشط في يوم العمل)  │
│    📋  👤                               │
│                                         │
└─────────────────────────────────────────┘
```

**Location Quick View (نافذة عرض الموقع) — Rule 9:**

```
┌─────────────────────────────────┐
│  📍 موقع أحمد علي               │
│                                 │
│  الحالة: ✅ يعمل                │
│  آخر تحديث: 10:32 ص             │
│  العنوان: شارع الجمهورية, طنطا  │
│  الإحداثيات: 30.0444, 31.2357   │
│                                 │
│  [🗺️ فتح الخريطة]  [إغلاق]    │
└─────────────────────────────────┘
```

**Access:** الحضور والانصراف ← المتابعة الحية
**Employee statuses displayed:**

| Status | Arabic Label | Color | Meaning |
|--------|-------------|-------|---------|
| Working | يعمل | ✅ أخضر | Within workday, not on visit or break |
| On visit | في زيارة | 🔵 أزرق | Currently checked into a visit |
| On break | في استراحة | 🟡 أصفر | Workday active, on break |
| Ended day | أنهى يوم العمل | ⬜ رمادي | Completed workday |
| Not started | لم يبدأ يوم العمل | ❌ أحمر | No session today |
| Connection lost | انقطاع متابعة | ⚠ برتقالي | No location update received for 5× interval |

**Last Seen status (Rule 8):**

| Indicator | Label | Criteria |
|-----------|-------|----------|
| 🟢 متصل الآن | Connected | Last point < 1× interval ago |
| 🟡 آخر ظهور منذ X دقائق | Delayed | Last point between 1× and 5× interval ago |
| 🔴 لا توجد بيانات حديثة | Stale | Last point > 5× interval ago or no data today |
| ⚠ انقطاع متابعة | Connection loss | No update for 5× interval AND employee was active today |

**Last Seen calculation:** مقارنة آخر `recorded_at` في `tracking_points` مع `location_interval_seconds` من `workday_settings`.

**Quick Actions per row (Rule 13):**

| Icon | Action | Navigates to |
|------|--------|-------------|
| 📍 عرض الموقع | Location quick view | Popup/nav — not the full timeline |
| 🗺️ | Open map | `/attendance/map/:employee/:date` |
| 📋 | Open day record | `/attendance/history/:employee` |
| 👤 | Open employee profile | `/employees/:id` |

**Grouped by:** يعمل → في زيارة → في استراحة → انقطاع متابعة → أنهى يوم العمل → لم يبدأ  
**Employee row click:** Opens location quick view (default action)

### 10.3 Screen: Employee Timeline (خريطة اليوم)

```
┌─────────────────────────────────────────┐
│  خريطة اليوم                            │
│  أحمد علي — 2026-06-10                  │
│  2026-06-10                             │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐    │
│  │         🗺️ MAP VIEW             │    │
│  │                                 │    │
│  │  🟢 بداية (08:15)               │    │
│  │  🔵 زيارات (3)                  │    │
│  │  🟠 توقف طويل (1)               │    │
│  │  🔴 نهاية (10:47)               │    │
│  │  ─── مسار الحركة ───            │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ملخص اليوم:                            │
│  • وقت الحضور: 08:15                    │
│  • وقت الانصراف: 10:47                  │
│  • إجمالي مدة اليوم: 02:32             │
│  • إجمالي الاستراحات: 00:15            │
│  • عدد الاستراحات: 1                   │
│  • أطول استراحة: 00:15                 │
│  • متوسط مدة الاستراحة: 00:15          │
│  • صافي ساعات العمل: 02:17             │ ← المقياس الرسمي
│  • المسافة: 12.3 كم                    │
│  • الزيارات: 6                         │
│  • وقت الزيارات: 01:15                 │
│                                         │
│  ─────── الجدول الزمني ────────         │
│                                         │
│  🟢 08:15  بدء يوم العمل               │
│         الموقع: 30.0444, 31.2357        │
│  🔵 08:47  بدء زيارة - عميل X          │
│         الموقع: 30.0450, 31.2360        │
│  🔵 09:06  إنهاء زيارة - عميل X        │
│  🟡 09:30  بدء استراحة                 │
│  🟡 09:45  انتهاء استراحة (15 د)       │
│  🔵 09:21  بدء زيارة - عميل Y          │
│  ...                                    │
│  🟠 10:02  توقف طويل (22 دقيقة)        │
│         الموقع: طنطا                    │
│  🔴 10:47  إنهاء يوم العمل             │
│                                         │
│  [▶ إعادة تشغيل اليوم] [1x] [2x] [5x]  │
│                                         │
└─────────────────────────────────────────┘
```

**Access:** Click employee name in Live Monitoring screen

### 10.4 Screen: Historical Records (سجل الأيام)

```
┌─────────────────────────────────────────┐
│  سجل الأيام — أحمد علي                  │
├─────────────────────────────────────────┤
│  من [2026-05-01]     إلى [2026-06-10]   │
│                                         │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │
│  │  22  │ │  132 │ │  4.2 │ │  156 │  │
│  │يوم عمل││ساعة  ││ساعة  ││كم    ││  │
│  │      ││عمل   ││زيارات││إجمالي││  │
│  └──────┘ └──────┘ └──────┘ └──────┘  │
│                                         │
│  ────────── سجل الأيام ──────────        │
│                                         │
│  📅 10-06  02:32  6 زيارات  12.3كم     │ ▶
│  📅 09-06  03:15  8 زيارات  15.1كم     │ ▶
│  📅 08-06  إجازة                         │
│  📅 07-06  02:48  5 زيارات  10.8كم     │ ▶
│  ...                                    │
│                                         │
└─────────────────────────────────────────┘
```

**Access:** الحضور والانصراف ← سجل الأيام ← اختيار الموظف

### 10.5 Screen: Reports (التقارير)

> **Rule 4:** تحتوي التقارير على توزيع وقت المندوب الفعلي: صافي ساعات العمل, ساعات الزيارات, ساعات التنقل, ساعات الاستراحات.

```
┌─────────────────────────────────────────┐
│  تقارير الحضور والانصراف                 │
├─────────────────────────────────────────┤
│  الفترة: [شهر يونيو 2026]               │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  ★ ملخص الأداء (المقاييس الرسمية) │   │
│  │  ─────────────────────────────   │    │
│  │  صافي ساعات العمل:      09:15   │    │ ← المقياس الرسمي الوحيد
│  │  إجمالي أيام العمل:     22     │    │
│  │  متوسط صافي العمل يومياً: 08:50 │    │
│  │  إجمالي الزيارات:      138     │    │
│  │  إجمالي المسافة:       342 كم  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  توزيع وقت المندوب (مثال ليوم)  │    │
│  │  ─────────────────────────────  │    │
│  │  ■ صافي ساعات العمل:    08:00  │    │ ← المؤشر الرسمي
│  │  ■ ساعات الزيارات:      05:00  │    │
│  │  ■ ساعات التنقل:        02:00  │    │
│  │  ■ ساعات الاستراحات:    01:00  │    │
│  │  ─────────────────────────────  │    │
│  │  إجمالي مدة اليوم:      08:00  │    │ للعلم فقط
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  تفاصيل الاستراحات              │    │
│  │  ─────────────────────────────   │    │
│  │  عدد الاستراحات:         2      │    │
│  │  إجمالي وقت الاستراحات:  00:45 │    │
│  │  أطول استراحة:           00:30 │    │
│  │  متوسط مدة الاستراحة:   00:22  │    │
│  │  أسباب الاستراحات:             │    │
│  │    صلاة:          1 (30 دقيقة) │    │
│  │    طعام:          1 (15 دقيقة) │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ─────── الموظفون بدون بدء ────────     │
│  👤 خالد عمر      — 3 أيام             │
│  👤 سامي نور      — يومين              │
│                                         │
│  ─────── تنبيهات الأداء ────────────     │
│  ⚠ خالد عمر     — استراحة أكثر من ساعتين│
│  ⚠ محمد علي     — لم يبدأ اليوم حتى 10ص│
│  ⚠ سامي نور     — يوم أمس لم ينته      │
│                                         │
│  [تصدير Excel]    [طباعة]               │
└─────────────────────────────────────────┘
```

**مؤشرات الأداء الرئيسية في التقارير:**

| المؤشر | النوع | الوصف |
|--------|------|-------|
| ★ صافي ساعات العمل | **رسمي** | إجمالي مدة اليوم - إجمالي الاستراحات |
| ساعات الزيارات | توزيعي | إجمالي الوقت المقضي في الزيارات |
| ساعات التنقل | توزيعي | إجمالي الوقت بين الزيارات |
| ساعات الاستراحات | توزيعي | إجمالي وقت الاستراحات |
| عدد الاستراحات | توزيعي | عدد مرات أخذ الاستراحة |
| أطول استراحة | توزيعي | أطول مدة استراحة في اليوم |
| متوسط مدة الاستراحة | توزيعي | متوسط مدة الاستراحة الواحدة |
| إجمالي مدة اليوم | **للعرض فقط** | وقت الانصراف - وقت الحضور (غير رسمي) |

**مؤشرات تحليل الالتزام (Rule 18):**

| المؤشر | الوصف | المصدر |
|--------|-------|--------|
| عدد أيام التأخير | عدد الأيام التي كان فيها الموظف متأخراً | `attendance_status = 'late'` |
| إجمالي دقائق التأخير | مجموع دقائق التأخير في الفترة | SUM(`late_minutes`) |
| عدد مرات الانصراف المبكر | عدد الأيام التي انصرف فيها مبكراً | `attendance_status = 'early_departure'` |
| إجمالي دقائق الانصراف المبكر | مجموع دقائق الانصراف المبكر | SUM(`early_departure_minutes`) |
| عدد أيام الغياب | عدد أيام الغياب الكامل في الفترة | `attendance_status = 'absent'` |
| عدد أيام الالتزام الكامل | عدد الأيام التي بدأ وانتهى في الموعد | `attendance_status = 'ontime'` |

**مثال على بطاقة تحليل الالتزام في التقرير:**

```
┌─────────────────────────────────────────┐
│  تحليل الالتزام — يونيو 2026            │
│  ─────────────────────────────           │
│  📅 أيام العمل:          22             │
│  ✅ التزام كامل:         15             │
│  ⏰ تأخير:                5             │
│     إجمالي دقائق التأخير: 47            │
│  🚶 انصراف مبكر:          2             │
│     إجمالي دقائق الانصراف: 35           │
│  ❌ غياب:                  0             │
└─────────────────────────────────────────┘
```

---

### 10.6 Screen: Alerts (التنبيهات) — للإدارة فقط

> **Rule 5:** التنبيهات مخصصة للإدارة فقط. لا تظهر للمندوب أي رسائل تتبع أو مراقبة.

```
┌─────────────────────────────────────────┐
│  التنبيهات — الحضور والانصراف            │
├─────────────────────────────────────────┤
│                                         │
│  ⚠  3 تنبيهات نشطة                      │
│                                         │
│  ┌────────────────────────────────────┐ │
│  │ ⚠  🟡 استراحة طويلة               │ │
│  │ أحمد علي — 02:15 في استراحة       │ │
│  │ منذ 01:30 م                        │ │
│  │ [عرض التفاصيل]                     │ │
│  └────────────────────────────────────┘ │
│                                         │
│  ┌────────────────────────────────────┐ │
│  │ ⚠  ⬜ لم يبدأ يوم العمل           │ │
│  │ خالد عمر — الساعة الآن 10:15 ص   │ │
│  │ وقت البدء الافتراضي: 08:00 ص      │ │
│  │ [إرسال إشعار] [عرض التفاصيل]      │ │
│  └────────────────────────────────────┘ │
│                                         │
│  ┌────────────────────────────────────┐ │
│  │ ⚠  🔴 يوم مفتوح من أمس           │ │
│  │ سامي نور — بدأ يوم 09-06 08:00    │ │
│  │ اليوم 10-06 10:00 — لم ينته       │ │
│  │ [إنهاء اليوم] [عرض التفاصيل]      │ │
│  └────────────────────────────────────┘ │
│                                         │
│  ─────── التنبيهات المحلولة ────────    │
│  ✅ محمد علي     — بدأ اليوم 08:05    │ │
│  ✅ كريم سعد     — أنهى اليوم أمس    │ │
│                                         │
├─────────────────────────────────────────┤
│  آخر تحديث: 10:15 ص                      │
└─────────────────────────────────────────┘
```

**أنواع التنبيهات:**

> **Rule 12:** 5 أنواع تنبيهات إشرافية — كلها للإدارة فقط. لا تظهر للمندوب أي رسائل تتبع أو مراقبة.
> **Rule 12a (Actionable Alerts):** كل تنبيه قابل للتنفيذ — الضغط على التنبيه يفتح الشاشة المناسبة مباشرة.

| النوع | الشرط | الظهور للمندوب؟ | إجراء مقترح | الضغط يفتح |
|-------|-------|-----------------|-------------|-----------|
| لم يبدأ اليوم | بعد وقت البدء الافتراضي بـ 30 دقيقة | ❌ لا | إرسال إشعار, استدعاء | شاشة المتابعة الحية — صف الموظف |
| يوم مفتوح من اليوم السابق | session بدون end_time من أمس | ❌ لا | إنهاء اليوم عن بعد, استدعاء | شاشة خريطة اليوم للموظف |
| استراحة طويلة بشكل غير طبيعي | استراحة > ساعتين (قابل للضبط) | ❌ لا | إرسال إشعار, استدعاء | شاشة خريطة اليوم — توقيت الاستراحة |
| لا توجد تحديثات حديثة | آخر تحديث > الفاصل × 5 ولم ينته اليوم | ❌ لا | تحقق من اتصال المندوب, استدعاء | شاشة المتابعة الحية — حالة الموظف |
| لا توجد زيارات طوال اليوم | مندوب نشط لم يقم بأي زيارة بعد 4 ساعات من البدء | ❌ لا | استفسار, إعادة توجيه | سجل اليوم للموظف |
| لم يبدأ بعد موعد الدوام | بعد بداية الدوام الرسمي بـ 30 دقيقة ولم يبدأ | ❌ لا | إرسال إشعار, استدعاء | شاشة المتابعة الحية — صف الموظف |
| غياب كامل | لا يوجد session لليوم بعد نهاية الدوام الرسمي | ❌ لا | تسجيل غياب, استدعاء | سجل الأيام — تقويم الموظف |
| انصراف مبكر متكرر | 3+ أيام انصراف مبكر في آخر 10 أيام عمل | ❌ لا | تنبيه المشرف, استدعاء | سجل الأيام — تحليل الالتزام |
| تأخير متكرر | 3+ أيام تأخير في آخر 10 أيام عمل | ❌ لا | تنبيه المشرف, استدعاء | سجل الأيام — تحليل الالتزام |

**RPC:** `get_alerts(p_token)` — تعيد التنبيهات النشطة والمحلولة.

**أنواع التنبيهات في الشاشة:**

```
┌────────────────────────────────────┐
│ ⚠  لا توجد تحديثات حديثة          │
│ علي حسن — آخر تحديث 10:00 ص       │
│ ⏱ منذ 35 دقيقة بدون تحديث        │
│ [عرض التفاصيل] [إرسال إشعار]      │
└────────────────────────────────────┘
┌────────────────────────────────────┐
│ ⚠  لا توجد زيارات اليوم           │
│ خالد عمر — بدأ اليوم 08:00        │
│ الساعة الآن 12:30 — 0 زيارات     │
│ [عرض التفاصيل]                     │
└────────────────────────────────────┘
```

---

### 10.7 Screen: Team Map (خريطة الفريق)

> **Rule 10:** شاشة إدارية مستقلة تعرض جميع الموظفين النشطين على خريطة واحدة مع عدادات التوزيع وحالات مختلفة.
> **Rule 15 (Mobile First):** الشاشة مصممة للجوال — أزرار تصغير/تكبير, ألوان واضحة, لوحة جانبية قابلة للطي.

```
┌─────────────────────────────────────────┐
│  خريطة الفريق              📍 12 نشط   │
├─────────────────────────────────────────┤
│                                         │
│  ┌────────────── 🗺️ ───────────────┐   │
│  │  الدقهلية                         │   │
│  │                                   │   │
│  │    🟢 أحمد (شارع الجمهورية)      │   │
│  │    🟢 خالد (ميدان المحطة)        │   │
│  │    🔵 محمد (زيارة — عميل X)      │   │
│  │    🟡 سامي (استراحة — كافتيريا)  │   │
│  │    🟢 كريم (شارع البحر)          │   │
│  │    🔵 عمرو (زيارة — عميل Y)      │   │
│  │                                   │   │
│  │    ⚠ انقطاع: علي (آخر تحديث 10:00)│   │
│  │                                   │   │
│  │    🏢 موقعي                       │   │
│  └───────────────────────────────────┘   │
│                                         │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │
│  │  12  │ │  5   │ │  3   │ │  4   │  │
│  │نشط   ││بزيارة││باستراحة││لم يبدأ││
│  └──────┘ └──────┘ └──────┘ └──────┘  │
│                                         │
│  ┌────────────────────────────────┐     │
│  │  🟢 عاملين الآن:       12     │     │
│  │  🔵 في زيارة:           5     │     │
│  │  🟡 في استراحة:         3     │     │
│  │  ❌ لم يبدأوا اليوم:    4     │     │
│  └────────────────────────────────┘     │
│                                         │
│  ⚡ ملخص سريع:                          │
│  5 مندوبين اليوم بدون زيارات            │
│  2 مندوبين في استراحة > ساعة            │
│                                         │
├─────────────────────────────────────────┤
│  [تصغير]  [تكبير]  [📍 موقعي]  [تحديث]  │
└─────────────────────────────────────────┘
```

**Marker types on map:**

| Marker | Status | Action on tap |
|--------|--------|-------------|
| 🟢 | يعمل (Working) | Open location quick view |
| 🔵 | في زيارة (On visit) | Open location + visit details |
| 🟡 | في استراحة (On break) | Open location + break info |
| ⚠ | انقطاع متابعة (Connection lost) | Open location + alert details |
| ⬜ | أنهى يوم العمل | Not shown on team map (filtered) |

**Summary counters (Rules 10 + 16):**

| Counter | Answers |
|---------|---------|
| عدد العاملين الآن | من يعمل الآن؟ |
| عدد الموجودين في زيارة | من في زيارة؟ |
| عدد الموجودين في استراحة | من في استراحة؟ |
| عدد الذين لم يبدأوا يومهم | من لم يبدأ؟ |

**Access:** الحضور والانصراف ← خريطة الفريق  
**RPC:** `get_team_map(p_token)` — تعيد قائمة الموظفين النشطين مع إحداثياتهم + حالتهم + وقت آخر تحديث لكل منهم.

---

### 10.8 Operational Focus (التركيز التشغيلي)

> **Rule 16:** كل شاشة في نظام الحضور والانصراف يجب أن تجيب على الأسئلة التشغيلية الستة.

| السؤال | تجيب عليه الشاشة |
|---------|-----------------|
| من يعمل الآن؟ | المتابعة الحية + خريطة الفريق |
| من لم يبدأ يومه؟ | المتابعة الحية + التنبيهات |
| من في زيارة؟ | المتابعة الحية + خريطة الفريق |
| من في استراحة؟ | المتابعة الحية + خريطة الفريق |
| أين يوجد الآن؟ | المتابعة الحية (عرض الموقع) + خريطة الفريق |
| هل هناك مشكلة تحتاج تدخلاً؟ | التنبيهات |

**ممنوع:** عرض معلومات تقنية (إصدار التطبيق, نوع الجهاز, حالة البطارية, قوة الإشارة) في أي شاشة تشغيلية.

---

### 10.9 Command Center Integration (ربط مع مركز القيادة)

> **Rule 17 (Management Dashboard Integration):** نظام الحضور والانصراف يُعرّض مؤشرات تشغيلية حية لواجهة مركز القيادة (Command Center) بحيث يمكن عرضها في الإجراءات المطلوبة وعدادات الوحدات الأساسية.

**المؤشرات المكشوفة لمركز القيادة:**

| المؤشر | المصدر | نوع التكامل |
|--------|--------|-----------|
| عدد العاملين الآن | `get_live_workday_overview().active_count` | عداد فوري |
| عدد الموجودين في زيارة | `get_live_workday_overview().on_visit_count` | عداد فوري |
| عدد الموجودين في استراحة | `get_live_workday_overview().on_break_count` | عداد فوري |
| عدد الذين لم يبدأوا يومهم | `get_live_workday_overview().no_start_count` | عداد فوري |
| عدد حالات انقطاع المتابعة | `get_live_workday_overview().connection_loss_count` | عداد فوري |

**كيفية التكامل مع Command Center (`get_command_center` RPC):**

يجب إضافة مقطع إلى RPC الموجود `get_command_center` لجلب هذه العدادات:

```sql
-- داخل get_command_center، أضف:
attendance_counters := (
    SELECT jsonb_build_object(
        'active_workers',        COALESCE(active_count, 0),
        'on_visit',              COALESCE(on_visit_count, 0),
        'on_break',              COALESCE(on_break_count, 0),
        'not_started',           COALESCE(no_start_count, 0),
        'connection_loss',       COALESCE(connection_loss_count, 0)
    )
    FROM get_live_workday_overview()
);
```

**المؤشرات في واجهة مركز القيادة:**

```
┌──────────────────────────────────────┐
│  الحضور والانصراف                     │
│                                       │
│  🟢 العاملين الآن:          12       │
│  🔵 في زيارة:               5        │
│  🟡 في استراحة:             3        │
│  ❌ لم يبدأوا:              4        │
│  ⚠ انقطاع متابعة:          1        │
│                                       │
│  [فتح المتابعة الحية]                 │
└──────────────────────────────────────┘
```

**التحديث:** يتم تحديث العدادات عند تحميل صفحة مركز القيادة (polling كل 60 ثانية أو يدوي).

---

## 11. Data Retention Strategy

### Two-tier approach

| Tier | Data | Retention Rule |
|------|------|---------------|
| **Live** | `workday_sessions` + `tracking_points` within retention period | Keep. Queried for monitoring/timeline/replay. |
| **Archived** | `workday_sessions` rows (points deleted) beyond retention period | Keep session metadata forever (or until manual delete), delete tracking points. |

### Behavior by retention setting

| Setting | Points kept | Sessions kept |
|---------|------------|---------------|
| 7 days | 7 days | Forever (metadata only) |
| 30 days | 30 days | Forever (metadata only) |
| 90 days | 90 days | Forever (metadata only) |
| 180 days | 180 days | Forever (metadata only) |
| 365 days | 365 days | Forever (metadata only) |

"Forever" = until manually deleted by Upper Management. Session metadata (start/end times, employee, totals) is extremely small storage and provides historical continuity.

### Rationale

Tracking points are the bulk of storage. Session metadata (duration, visit count, distance) is trivial. Keeping session metadata indefinitely allows:
- Historical workday duration trends
- Monthly/yearly attendance patterns
- Employee performance over time
- Without the storage cost of raw GPS data

---

## 12. Cleanup Strategy

### 12.1 Automatic Cleanup

**Trigger:** Scheduled job (pg_cron or external cron) running at `cleanup_frequency` interval.

**Logic:**
```sql
DELETE FROM public.tracking_points
WHERE recorded_at < CURRENT_DATE - INTERVAL '1 day' * (
  SELECT retention_days FROM public.workday_settings
);
```

**After cleanup:**
```sql
INSERT INTO public.tracking_cleanup_log
  (action_type, deleted_points, cutoff_date, executed_by)
VALUES ('auto_cleanup', deleted_count, cutoff_date,
  (SELECT id FROM public.employees WHERE ... ));
```

The cleanup runs as a SECURITY DEFINER function triggered by cron.

### 12.2 Manual Cleanup

Upper Management can manually delete from the settings screen:

| Mode | UI Control | SQL |
|------|-----------|-----|
| Single day | Date picker + [حذف] | `WHERE DATE(recorded_at) = target_date` |
| Date range | From/To + [حذف] | `WHERE recorded_at BETWEEN from AND to` |
| Single employee | Employee picker + [حذف] | `WHERE employee_id = target_id` |
| All data | [حذف جميع بيانات التتبع] button | Truncates tracking_points, leaves sessions (metadata) |

**Safety:** Manual cleanup always prompts confirmation with count of affected records: "سيتم حذف 1,250 نقطة تتبع. هل أنت متأكد؟"

### 12.3 Audit Trail

Every cleanup (auto or manual) logs to `tracking_cleanup_log`:
- `action_type`: auto_cleanup | manual_cleanup | manual_delete
- `deleted_sessions`, `deleted_points`: counts
- `cutoff_date` or `employee_id`: scope
- `executed_by`: who triggered it
- `executed_at`: timestamp

This log is visible to Upper Management in the settings screen.

---

## 13. Security and Permissions Model

### Role-based access

| Role | Workday Settings | Live Monitoring | Timeline/Map | History | Reports | Cleanup |
|------|-----------------|----------------|-------------|---------|---------|---------|
| سوبر أدمن | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| رئيس مجلس الإدارة | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| أدمن | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| مدير مبيعات (Sales Manager) | ❌ | ✅ Team only | ✅ Team only | ✅ Team only | ✅ Team only | ❌ |
| مشرف (Supervisor) | ❌ | ✅ Team only | ✅ Team only | ✅ Team only | ❌ | ❌ |
| مندوب مبيعات (Sales Rep) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| عميل | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### Employee self-access

Sales Rep can:
- Start/end their own workday
- See their own current status (duration, visit count)
- See their own mini-timeline for today
- NOT see anyone else's tracking data
- NOT see historical data of their own beyond today (management decides)

### RPC-level enforcement

Every RPC follows the governed pattern:

```sql
CREATE OR REPLACE FUNCTION public.start_workday(p_token uuid, ...)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_employee_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  -- Only employees can start workdays
  IF v_session.identity_type != 'employee' THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  v_employee_id := v_session.employee_id;
  -- ... proceed with start
END;
$function$;
```

For management-facing RPCs, a role check is added:

```sql
SELECT EXISTS(
  SELECT 1 FROM public.employee_roles er
  JOIN public.roles r ON r.id = er.role_id
  WHERE er.employee_id = v_session.employee_id
  AND r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن', 'مدير مبيعات', 'مشرف')
) INTO v_is_management;
```

For manager-level filtering (team only):

```sql
-- Sales Manager sees only employees under their management chain
SELECT e.id FROM public.employees e
WHERE e.manager_id IN (
  SELECT id FROM public.employees WHERE id = v_session.employee_id
  UNION
  SELECT id FROM public.employees WHERE manager_id = v_session.employee_id
);
```

### Data sensitivity

- **Location data** is considered sensitive. Logging and cleanup operations are audited.
- Only Upper Management and direct managers can view employee routes and maps.
- Employees cannot view their own historical route replays without management approval (design choice to prevent gaming the system).
- Tracking points are bulk-writable (employee can insert their own) but read-restricted.

### API surface

| Endpoint | Auth | Role Check |
|----------|------|-----------|
| `start_workday` | Session token | employee only |
| `end_workday` | Session token | employee only, must own session |
| `get_my_workday_status` | Session token | employee only |
| `sync_tracking_points` | Session token | employee only, must own session |
| `get_workday_settings` | Session token | upper management only |
| `update_workday_settings` | Session token | upper management only |
| `get_live_workday_overview` | Session token | management (upper + sales manager + supervisor) |
| `get_employee_day_timeline` | Session token | management (team-filtered for managers) |
| `get_employee_day_map` | Session token | management (team-filtered) |
| `get_employee_workday_history` | Session token | management (team-filtered) |
| `get_team_map` | Session token | management (upper + sales manager + supervisor) |
| `get_employee_current_location` | Session token | management (team-filtered for managers) |
| `get_workday_report` | Session token | upper management only |
| `get_attendance_analysis` | Session token | upper management only |
| `get_alerts` | Session token | management (upper + sales manager + supervisor) |
| `cleanup_tracking_data` | Session token | upper management only |
| `auto_cleanup_tracking_data` | cron (no token) | runs as SECURITY DEFINER |

---

## Appendix A: Net Working Hours Calculation (صافي ساعات العمل)

### Formulas

```
# إجمالي مدة اليوم
وقت الانصراف - وقت الحضور

# إجمالي الاستراحات
SUM(break_end - break_start) لكل استراحة في اليوم

# صافي ساعات العمل (المقياس الرسمي)
إجمالي مدة اليوم - إجمالي الاستراحات
```

### Example

| Field | Value |
|-------|-------|
| الحضور | 08:00 |
| الانصراف | 18:00 |
| إجمالي مدة اليوم | 10:00 |
| استراحة أولى | 00:30 |
| استراحة ثانية | 00:15 |
| إجمالي الاستراحات | 00:45 |
| **صافي ساعات العمل** | **09:15** |

### Impact on reporting

- Break periods are **excluded completely** from working time.
- All attendance and productivity reports must use **صافي ساعات العمل** as the primary working-hours metric.
- إجمالي مدة اليوم is informational only (for attendance compliance).
- Performance analysis, KPIs, and productivity scoring are based on صافي ساعات العمل.

### Live monitoring fields (for active employees)

| Field | Example |
|-------|---------|
| مدة اليوم الحالية | 06:20 |
| إجمالي الاستراحات الحالية | 00:40 |
| صافي وقت العمل الحالي | 05:40 |

### Management report fields

| Field | Priority |
|-------|----------|
| وقت الحضور | معلوماتية |
| وقت الانصراف | معلوماتية |
| إجمالي مدة اليوم | معلوماتية |
| إجمالي وقت الاستراحات | معلوماتية |
| **صافي ساعات العمل** | **رسمي** |
| عدد الاستراحات | معلوماتية |
| أطول استراحة | معلوماتية |
| متوسط مدة الاستراحة | معلوماتية |

---

## Appendix B: Updated Command Center Navigation Map (with الحضور والانصراف)

### Main Command Center Screen

```
┌──────────────────────────────────────┐
│ مركز القيادة                         │
├──────────────────────────────────────┤
│                                       │
│ الإجراءات المطلوبة                    │
│ ⚠ 3 طلبات تنتظر الاعتماد             │
│ ⚠ 2 عميل تجاوز الحد الائتماني       │
│ ⚠ 1 مرتجعات تنتظر القرار            │
│ ⚠ ...                                │
├──────────────────────────────────────┤
│                                       │
│ ملخص الحضور والانصراف (Rule 17)      │
│ 🟢 العاملين الآن:         12         │
│ 🔵 في زيارة:              5          │
│ 🟡 في استراحة:            3          │
│ ❌ لم يبدأوا:             4          │
│ ⚠ انقطاع متابعة:         1          │
│                                       │
├──────────────────────────────────────┤
│                                       │
│ العمليات الأساسية (7 وحدات)          │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ │
│ │🛒 طلبات│ │👥 عملاء│ │📍 زيارات│ │💳 ائتمان│
│ ├──────┤ ├──────┤ ├──────┤ ├──────┤ │
│ │📦 مخزون│ │👤 موظفون│ │✅ حضور │ │
│ │      │ │      │ │وانصراف│ │
│ └──────┘ └──────┘ └──────┘ └──────┘ │
│                                       │
│ كل بطاقة → تفتح الشاشة التشغيلية مباشرة│
├──────────────────────────────────────┤
│                                       │
│ العمليات الثانوية                     │
│ › المرتجعات  › التحصيلات  › التوصيل  │
│ › التقارير   › المستهدفات › الصلاحيات│
├──────────────────────────────────────┤
│                                       │
│ وحدات داعمة (اطوِ)                    │
│ › المزادات  › العروض اليومية         │
│ › العروض السريعة  › المستويات        │
│ › الشركات   › المستودع  › المنتجات   │
└──────────────────────────────────────┘
```

### Module Routes (click behavior)

| Module | Click → Direct Route | Rationale |
|--------|--------------------|-----------|
| الطلبات | `/orders` | Existing screen has all status tabs |
| العملاء | `/customers` | List + profile cover all needs |
| الزيارات | `/visits` | Status filters + workflow exist |
| الائتمان | `/credit` | Central hub with overview |
| المخزون | `/products` | Product list + manager |
| الموظفون | `/employees` | List + profile + hierarchy |
| **الحضور والانصراف** | **`/attendance`** | **New dedicated module workspace** |
| المرتجعات | `/returns` | Status filters exist |
| التحصيلات | `/collections` | List + follow-up exist |
| التوصيل | `/delivery` | List + detail exist |
| التقارير | `/reports` | Multi-section page exists |
| المستهدفات | `/dashboard/company-targets` | Target screens exist |
| الصلاحيات | `/account/permissions` | Permission management exists |

> **Note:** Unlike other primary modules that link to existing screens directly, الحضور والانصراف requires a **dedicated module workspace** because it has 7 sub-screens (الإعدادات, المتابعة الحية, خريطة اليوم, سجل الأيام, التقارير, التنبيهات, خريطة الفريق) that don't exist elsewhere.

### الحضور والانصراف Module Internal Navigation

```
/attendance
├── /attendance                  ← Main dashboard (live overview)
├── /attendance/settings         ← إعدادات الحضور والانصراف
├── /attendance/live             ← المتابعة الحية
├── /attendance/map/:employee/:date  ← خريطة اليوم
├── /attendance/team-map         ← خريطة الفريق
├── /attendance/history          ← سجل الأيام
├── /attendance/history/:employee    ← سجل موظف
├── /attendance/reports          ← التقارير
└── /attendance/alerts           ← التنبيهات
```

---

## Appendix C: Updated Module Tier Registration

For `scripts/sync-module-registry.mjs`, add:

```javascript
// In MODULE_DISPLAY_NAMES:
'attendance': { ar: 'الحضور والانصراف', en: 'Attendance' },

// In MODULE_ICONS:
'attendance': 'clock',

// In KB_PREFIX_MAP:
'attendance': ['17_WORKDAY'],

// In MODULE_EXPECTATIONS:
'attendance': { routes: 8, rpcs: 21, tables: 7 },

// In MODULE_PIPELINE_VERBS:
'attendance': ['start', 'track', 'pause', 'resume', 'end', 'sync'],

// In BUSINESS_MODULE_KEYS (already has 'workday', change to 'attendance'):
'attendance',  // replace 'workday'

// In MODULE_ROUTES (for CommandCenterPage.tsx):
'attendance': '/attendance',

// In MODULE_TIERS.primary (for CommandCenterPage.tsx):
primary: ['orders', 'customers', 'visits', 'credit', 'inventory', 'employees', 'attendance'],
```

---

## Appendix D: Future-Ready Location Services (الخدمات المستقبلية)

> **Rule 14:** لا يتم التنفيذ الآن. فقط ضمان أن التصميم وقاعدة البيانات يدعمان هذه القدرات دون إعادة تصميم.

### القدرات المستقبلية المخطط لها

| القدرة | الوصف | المتطلبات من التصميم الحالي |
|--------|-------|---------------------------|
| **أقرب مندوب إلى عميل** | عند طلب زيارة أو خدمة, تحديد أقرب مندوب متاح | `tracking_points` تحتوي على `employee_id`, `recorded_at`, `lat`, `lng` — كافية لحساب المسافة |
| **أقرب مندوب إلى زيارة جديدة** | توجيه الزيارة الجديدة لأقرب مندوب نشط | `visit_links` تربط المندوب بالزيارة + `workday_sessions` تحدد النشاط |
| **توزيع المهام حسب الموقع** | توزيع عادل للزيارات بناءً على مواقع المندوبين الحالية | `tracking_points.latest` لكل موظف + حالة `workday_sessions` |
| **تغطية المناطق الجغرافية** | تحديد الفجوات في التغطية — مناطق بدون زيارات أو بدون مندوبين | `tracking_points` التاريخية تكفي لتحليل التغطية |

### كفاية التصميم الحالي

| المكون الحالي | يدعم | ملاحظات |
|--------------|------|---------|
| `tracking_points.employee_id + recorded_at + lat + lng` | ✅ أقرب مندوب, تحليل التغطية, مسارات الحركة | يمكن الاستعلام بأقل نقطة زمنية لكل موظف |
| `workday_sessions.start_time + end_time + status` | ✅ حالة المندوب (يعمل/في استراحة/انتهى) | أساس تحديد المندوبين المتاحين |
| `visit_links.session_id + visit_id + checkin_at` | ✅ ربط الزيارات بالمندوبين وأوقاتها | يدعم توزيع الزيارات |
| `workday_settings.location_interval_seconds` | ✅ دقة الموقع قابلة للضبط | يمكن تحسينها لتطبيقات التوزيع |

### ما لا حاجة لتغييره

- لا حاجة لجدول `employee_zones` أو `geofences` حالياً — التصميم الحالي كافٍ للقدرات المستقبلية المخططة.
- لا حاجة لإضافة أعمدة `is_available` أو `current_task` إلى `workday_sessions` — يمكن اشتقاق الحالة من البيانات الموجودة.
- لا حاجة لـ `real_time` subscriptions حالياً — التصميم الحالي يستخدم RPC polling, وهو كافٍ للمرحلة الأولى.

---

## Appendix E: Implementation Order

| Phase | Scope | Dependencies |
|-------|-------|-------------|
| **Phase 1 — Schema & Infrastructure** | Database schema + Tables + RPCs + Permissions + Retention system + `workday_settings` (including official hours) | Existing `employees`, `visits` tables |
| **Phase 2 — Employee Mobile** | Employee screens (start/end workday, break/resume, timer) + Attendance workflow + Break workflow + Offline support (IndexedDB sync) | Phase 1 |
| **Phase 3 — Management UI** | Upper Management screens: Settings, Live Monitoring (with last_seen, location view, connection loss), Team Map (خريطة الفريق), Alerts (including attendance violation alerts), Reports (including attendance analysis), History | Phase 1 + Map library |
| **Phase 4 — Validation** | Real database testing + Mobile testing + Battery & storage verification + End-to-end workflow validation | Phase 2 + Phase 3 |
