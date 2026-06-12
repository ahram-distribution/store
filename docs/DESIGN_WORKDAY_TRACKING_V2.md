# الحضور والانصراف — Design Specification V2

**Status:** Design Specification — Architectural Alignment  
**Version:** 2.0  
**Module Key:** `attendance`  
**Module Tier:** Primary (7th)  
**Previous Version:** `DESIGN_WORKDAY_TRACKING.md` (V1)  
**Alignment Date:** 2026-06-11  

## Architectural Alignment Summary

V2 aligns attendance with the project's established architectural decisions:

1. **Capability-Based Governance** — All management screens use `check_capability()` (not role name checks)
2. **Ownership Hierarchy** — Visibility scoped by `manager_id` subtree (`app.get_subtree_ids()`)
3. **Operational Productivity** — Attendance is a productivity management module, not a GPS tracker
4. **Mandatory Integration** — Attendance + Visits + Orders + Collections + Customers in every screen
5. **Preserved Foundations** — Employee mobile simplicity, database schema, RPC strategy, sync model, terminology

---

## V1 → V2 Delta

| Section | V1 (Removed/Replaced) | V2 (New/Corrected) |
|---------|----------------------|-------------------|
| Operational Rule 4 | Reports: time distribution only | Reports: time distribution + orders + collections + customers |
| Operational Rule 16 | 6 operational questions | 10 operational questions (adds orders, collections, customers, productive time) |
| Operational Rule 17 | 5 Command Center counters | 9 counters (+ zero-visits, zero-orders, inactive hours) |
| Section 4 RPCs | Role-based governance | Capability-based + ownership scoping + order/collection counts |
| Section 10.1 Settings | Role-gated (سوبر أدمن, etc.) | Capability-gated (`attendance.configure`) |
| Section 10.2 Live Monitoring | Passive (location, time only) | Operational (visits, orders, collections, customers per employee) |
| Section 10.3 Timeline | Attendance-only (GPS, breaks, visits) | Unified (attendance + visits + orders + collections + customers) |
| Section 10.5 Reports | Time + breaks + visits | Time + breaks + visits + orders + collections + customers + compliance |
| Section 10.7 Team Map | Location + status | Full productivity card per employee |
| Section 10.8 Operational Focus | 6 questions | 10 questions |
| Section 10.9 Command Center | 5 counters | 9 counters |
| Section 13 Hierarchy | Board/Chairman → Sales Director → Sales Manager → Supervisor → Rep | الإدارة العليا (flat, identical) → مدير البيع → سوبر فايزر → مندوب → عميل تابع |
| Section 13 Customer Ownership | Implicit: only مندوب owns customers | Explicit: مدير البيع, سوبر فايزر, or مندوب may own customers |
| Section 13 Security | Role-based table | Capability-based + ownership hierarchy |

**Preserved (unchanged from V1):**
- Sections 1-3 (Database Schema, Tables, Relationships)
- Sections 5-6 (Sync Model, Offline Model)
- Sections 7-8 (Storage, Battery)
- Section 9 (Mobile UI — employee simplicity)
- Sections 11-12 (Retention, Cleanup)
- Appendix A (Net Work Hours)
- Appendix B (Command Center Navigation)
- Appendix C (Module Tier Registration)
- Appendix D (Future-Ready Services)

---

## Corrected Operational Rules

> Rules 1-3, 5-15, 18-19: **UNCHANGED from V1.** Only rules 4, 16, 17 are updated.

| # | Rule | V1 | V2 |
|---|------|----|----|
| 4 | **Reports** | تحتوي على توزيع وقت المندوب: صافي العمل, الزيارات, التنقل, الاستراحات | تحتوي على توزيع وقت المندوب + إنجازاته: صافي العمل, الزيارات, الطلبات, التحصيلات, العملاء الجدد, التنقل, الاستراحات |
| 16 | **Operational Focus** | 6 أسئلة (من يعمل؟ من لم يبدأ؟ من في زيارة؟ من في استراحة؟ أين يوجد؟ هل هناك مشكلة؟) | 10 أسئلة (+ كم طلباً أنجز؟ كم تحصيلاً؟ كم عميلاً جديداً؟ ما هو وقت العمل المنتج الفعلي؟) |
| 17 | **Command Center** | 5 مؤشرات (عدد العاملين, في زيارة, في استراحة, لم يبدأوا, انقطاع متابعة) | 9 مؤشرات (+ بدون زيارات, بدون طلبات, خامل لأكثر من ساعتين) |

---

## Section 4 — RPC List (UPDATED)

### Governance Pattern Change

**V1 (REMOVED):** All management RPCs used role-name checks:
```sql
r.name IN ('سوبر أدمن', 'رئيس مجلس الإدارة', 'أدمن', 'مدير مبيعات/مدير البيع', 'مشرف')
```

**V2 (REPLACEMENT):** All management RPCs use:
```sql
IF NOT public.check_capability(p_token, 'attendance.live_monitor') THEN
  RETURN jsonb_build_object('error', 'FORBIDDEN');
END IF;
```

### Ownership Scoping

**V1 (REMOVED):** Simple `employee_id = ANY(array)` or no scoping at all.

**V2 (REPLACEMENT):** Every management RPC that returns employee data uses:
```sql
-- Super-admin sees all; managers see subtree only
IF check_capability(p_token, 'attendance.view_all') THEN
  -- no filter = all employees
ELSE
  -- scope to subtree
  v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
  -- filter by employee_id = ANY(v_subtree_ids)
END IF;
```

### New Capability Codes

| Code | Grants | Screen |
|------|--------|--------|
| `attendance.configure` | Full settings access | Settings |
| `attendance.live_monitor` | View live monitoring | Live Monitoring |
| `attendance.view_timeline` | View any employee timeline | Timeline/Map |
| `attendance.view_history` | View historical records | History |
| `attendance.view_reports` | View aggregated reports | Reports |
| `attendance.view_alerts` | View and act on alerts | Alerts |
| `attendance.view_team_map` | View team map | Team Map |
| `attendance.view_all` | Bypass ownership scope | All (super-admin) |
| `attendance.cleanup` | Manual data cleanup | Settings |

### RPC Changes

#### get_live_workday_overview (UPDATED)
- Add capability check: `attendance.live_monitor`
- Add ownership scoping via `app.get_subtree_ids()`
- Add per-employee: `order_count`, `collection_count`, `new_customer_count`
- Return structure extended:

```json
{
  "employees": [{
    "employee_id", "name", "status", "started_at",
    "duration_minutes", "net_minutes", "break_minutes",
    "visit_count", "order_count", "collection_count", "new_customer_count",
    "latitude", "longitude", "last_seen_at",
    "connection_status", "last_seen_label"
  }]
}
```

#### get_employee_day_timeline (UPDATED)
- Add capability check: `attendance.view_timeline`
- Add ownership scoping
- Add events: `orders_created[]`, `collections_taken[]`, `customers_created[]`
- Return structure extended:

```json
{
  "session": {...},
  "points": [...],
  "breaks": [...],
  "visit_links": [...],
  "orders": [{
    "id", "customer_name", "total", "status", "created_at"
  }],
  "collections": [{
    "id", "customer_name", "amount", "method", "status", "created_at"
  }],
  "new_customers": [{
    "id", "name", "route", "created_at"
  }],
  "time_distribution": {
    "net_work_seconds",
    "visit_seconds",
    "travel_seconds",
    "break_seconds",
    "order_seconds",
    "collection_seconds"
  }
}
```

#### get_team_map (UPDATED)
- Add capability check: `attendance.view_team_map`
- Add ownership scoping
- Add per-employee productivity metrics
- Return structure extended:

```json
{
  "counters": { "active", "on_visit", "on_break", "connection_lost", "not_started",
                "zero_visits_today", "zero_orders_today", "inactive_over_2h" },
  "employees": [{
    "employee_id", "name", "status", "connection_status",
    "latitude", "longitude", "last_seen_at",
    "duration_minutes", "break_minutes",
    "visit_count", "order_count", "collection_count",
    "last_activity_type", "last_activity_time"
  }]
}
```

#### get_workday_report (UPDATED)
- Add capability check: `attendance.view_reports`
- Add ownership scoping
- Add operational metrics

```json
{
  "summary": {
    "total_sessions", "total_net_hours",
    "total_visits", "total_orders", "total_collections", "total_collections_amount",
    "total_new_customers", "total_distance_km",
    "late_days", "early_departure_days", "ontime_days"
  },
  "employees": [{
    "employee_id", "name",
    "sessions", "net_hours",
    "total_visits", "total_orders", "total_collections", "total_collections_amount",
    "new_customers", "distance_km",
    "late_days", "early_departure_days", "ontime_days"
  }]
}
```

#### get_attendance_analysis (UNCHANGED)
- Add capability check only
- No structural changes — already measures compliance correctly

#### get_alerts (UPDATED)
- Add capability check: `attendance.view_alerts`
- Add ownership scoping
- Add alert type: `zero_orders` (مندوب نشط لم يصدر أي طلب بعد 4 ساعات)

#### get_employee_current_location (UPDATED)
- Add capability check: `attendance.view_timeline`
- Add ownership scoping
- Add `order_count`, `collection_count`, `visit_count` for today

---

## Section 10.2 — Live Monitoring (UPDATED)

> شاشة إدارة تشغيلية — تجيب على 10 أسئلة تشغيلية، وليس 6.

### Additional Layout Requirements

Every active employee card must display:

```
👤 أحمد علي
  🟢 متصل الآن  |  مدة: 02:34  |  صافي: 02:05
  ┌──────┬──────┬──────┬──────┬──────┐
  │ 6    │ 3    │ 2    │ 1    │ 0    │
  │زيارات│طلبات │تحصيل│عملاء │استراحة│
  │      │      │      │جدد   │      │
  └──────┴──────┴──────┴──────┴──────┘
  📍 عرض الموقع  🗺️ الخريطة  📋 السجل  📄 الطلبات
```

### Quick Actions Extended

| Icon | Action | Navigates to |
|------|--------|-------------|
| 📍 | Location quick view | Popup |
| 🗺️ | Open map | `/attendance/map/:employee/:date` |
| 📋 | Open day record | `/attendance/history?employee=:id` |
| 📄 | Open today's orders | `/orders?created_by=:employee_id&date=today` |

### Operational Questions Answered

| # | السؤال | المصدر |
|---|--------|--------|
| 1 | من يعمل الآن؟ | employee status = 'working' |
| 2 | من لم يبدأ يومه؟ | no_start section |
| 3 | من في زيارة؟ | status = 'on_visit' |
| 4 | من في استراحة؟ | status = 'on_break' |
| 5 | أين يوجد الآن؟ | location popup |
| 6 | هل هناك مشكلة تحتاج تدخلاً؟ | connection_loss alert |
| 7 | **كم طلباً أنجز كل مندوب؟** | **order_count NEW** |
| 8 | **كم تحصيلاً أنجز؟** | **collection_count NEW** |
| 9 | **كم عميلاً جديداً؟** | **new_customer_count NEW** |
| 10 | **ما هو وقت العمل المنتج الفعلي؟** | **net_minutes NEW** |

---

## Section 10.3 — Employee Timeline (UPDATED)

> شاشة الجدول الزمني التشغيلي الموحد (Unified Operational Timeline)

### Timeline Event Types

| Type | Icon | Color | Data Source |
|------|------|-------|-------------|
| Start Workday | 🟢 | Green | `tracking_points` type='start' |
| End Workday | 🔴 | Red | `tracking_points` type='end' |
| Break Start | 🟡 | Yellow | `workday_breaks` |
| Break End | 🟢 | Green | `workday_breaks` |
| Visit Check-in | 🔵 | Blue | `visit_links` |
| Visit Check-out | 🔵 | Blue | `visit_links` |
| **Order Created** | 🛒 | **Orange** | **`orders` WHERE created_by = employee AND date = session.date NEW** |
| **Collection Taken** | 💰 | **Green** | **`collections` WHERE created_by = employee AND date = session.date NEW** |
| **New Customer** | 👤 | **Purple** | **`customers` WHERE owner_id = employee AND date = session.date NEW** |
| Long Stop | 🟠 | Orange | `detect_long_stops` |
| Connection Loss | ⚠ | Red | `tracking_points` gap analysis |

### Timeline Layout

```
🟢 08:15  بدء يوم العمل
🔵 08:47  بدء زيارة — عميل X (شارع الجمهورية)
🔵 09:06  إنهاء زيارة — عميل X
🛒 09:06  طلب رقم 4523 — 1,250 ج.ن (تم)
💰 09:15  تحصيل من عميل X — 850 ج.ن نقداً
🔵 09:21  بدء زيارة — عميل Y
👤 09:35  عميل جديد: Z Store (المنصورة)
🟡 09:45  استراحة (طعام)
🟢 10:00  انتهاء استراحة
🟠 10:15  توقف طويل (18 دقيقة) — الموقع: طنطا
🔴 10:47  إنهاء يوم العمل
```

### Navigation

Each timeline event is clickable:
- Visit → `/visits/:id`
- Order → `/orders/:id`
- Collection → `/collections/:id`
- Customer → `/customers/:id`
- Break → scroll to break detail
- Long Stop → highlight on map

---

## Section 10.5 — Reports (UPDATED)

### Extended Metrics

| المؤشر | النوع | الوصف | V1 | V2 |
|--------|------|-------|----|----|
| صافي ساعات العمل | **رسمي** | إجمالي مدة اليوم - إجمالي الاستراحات | ✅ | ✅ |
| إجمالي الزيارات | توزيعي | عدد الزيارات في الفترة | ✅ | ✅ |
| **إجمالي الطلبات** | **رسمي** | **عدد الطلبات التي أنشئت في الفترة** | ❌ | **✅ NEW** |
| **إجمالي التحصيلات** | **رسمي** | **عدد ونقدار التحصيلات** | ❌ | **✅ NEW** |
| **العملاء الجدد** | **رسمي** | **عدد العملاء الجدد المسجلين** | ❌ | **✅ NEW** |
| ساعات التنقل | توزيعي | الوقت بين الزيارات | ✅ | ✅ |
| ساعات الاستراحات | توزيعي | إجمالي وقت الاستراحات | ✅ | ✅ |
| **متوسط الطلبات لكل يوم** | **أداء** | **مؤشر إنتاجية** | ❌ | **✅ NEW** |
| **معدل التحصيل** | **أداء** | **نسبة التحصيل إلى المستهدف** | ❌ | **✅ NEW** |

### Report Layout Addition

```
┌─────────────────────────────────────────┐
│  ★ إنجازات المندوب (المقاييس التشغيلية) │
│  ─────────────────────────────           │
│  صافي ساعات العمل:       09:15          │
│  الزيارات:               138            │
│  الطلبات:                45             │
│  التحصيلات:              32 (124,500 ج.م)│
│  عملاء جدد:              8              │
│  المسافة:                342 كم          │
│  ─────────────────────────────           │
│  متوسط الطلبات/يوم:      2.0            │
│  متوسط التحصيلات/يوم:    1.5            │
└─────────────────────────────────────────┘
```

---

## Section 10.7 — Team Map (UPDATED)

### Per-Employee Card (on map marker click)

```
┌─────────────────────────────────┐
│  👤 أحمد علي                    │
│  🟢 يعمل — متصل الآن           │
│  ─────────────────              │
│  مدة اليوم:        02:34       │
│  صافي العمل:       02:05       │
│  الاستراحات:       00:29       │
│  ─────────────────              │
│  📍 زيارات اليوم:   6           │
│  🛒 طلبات اليوم:    3           │
│  💰 تحصيلات اليوم:  2           │
│  👤 عملاء جدد:      1           │
│  ─────────────────              │
│  آخر نشاط: طلب رقم 4523        │
│  منذ: 12:15 م                    │
│  ─────────────────              │
│  🔗 عرض اليوم → خريطة → طلبات  │
└─────────────────────────────────┘
```

### Summary Counters Extended

| Counter | V1 | V2 |
|---------|----|----|
| عدد العاملين الآن | ✅ | ✅ |
| عدد الموجودين في زيارة | ✅ | ✅ |
| عدد الموجودين في استراحة | ✅ | ✅ |
| عدد الذين لم يبدأوا يومهم | ✅ | ✅ |
| **عدد المندوبين بدون زيارات اليوم** | ❌ | **✅ NEW** |
| **عدد المندوبين بدون طلبات اليوم** | ❌ | **✅ NEW** |
| **عدد المندوبين الخاملين > ساعتين** | ❌ | **✅ NEW** |

---

## Section 10.8 — Operational Focus (UPDATED)

### 10 Operational Questions

| # | السؤال | V1 | V2 |
|---|--------|----|----|
| 1 | من يعمل الآن؟ | ✅ | ✅ |
| 2 | من لم يبدأ يومه؟ | ✅ | ✅ |
| 3 | من في زيارة؟ | ✅ | ✅ |
| 4 | من في استراحة؟ | ✅ | ✅ |
| 5 | أين يوجد الآن؟ | ✅ | ✅ |
| 6 | هل هناك مشكلة تحتاج تدخلاً؟ | ✅ | ✅ |
| 7 | **كم طلباً أنجز كل مندوب؟** | ❌ | **✅ NEW** |
| 8 | **كم تحصيلاً أنجز؟** | ❌ | **✅ NEW** |
| 9 | **كم عميلاً جديداً أضاف؟** | ❌ | **✅ NEW** |
| 10 | **ما هو وقت العمل المنتج الفعلي؟** | ❌ | **✅ NEW** |

---

## Section 10.9 — Command Center (UPDATED)

### Extended Counters

| المؤشر | V1 | V2 |
|--------|----|----|
| عدد العاملين الآن | ✅ | ✅ |
| عدد الموجودين في زيارة | ✅ | ✅ |
| عدد الموجودين في استراحة | ✅ | ✅ |
| عدد الذين لم يبدأوا يومهم | ✅ | ✅ |
| عدد حالات انقطاع المتابعة | ✅ | ✅ |
| **عدد المندوبين بدون زيارات اليوم** | ❌ | **✅ NEW** |
| **عدد المندوبين بدون طلبات اليوم** | ❌ | **✅ NEW** |
| **عدد المندوبين الخاملين لأكثر من ساعتين** | ❌ | **✅ NEW** |
| **متوسط صافي ساعات العمل للفريق اليوم** | ❌ | **✅ NEW** |

---

## Section 13 — Security and Permissions Model (REPLACED)

### Capability-Based Access

| Screen | Capability Code | Ownership Scope |
|--------|----------------|-----------------|
| Settings | `attendance.configure` | Super-admin only (via `attendance.configure`) |
| Live Monitoring | `attendance.live_monitor` | Subtree (`app.get_subtree_ids()`) |
| Timeline/Map | `attendance.view_timeline` | Subtree |
| History | `attendance.view_history` | Subtree |
| Reports | `attendance.view_reports` | Subtree |
| Alerts | `attendance.view_alerts` | Subtree |
| Team Map | `attendance.view_team_map` | Subtree |
| Cleanup | `attendance.cleanup` | Super-admin only |

### Ownership Hierarchy

```
الإدارة العليا (محمود سعيد, علي سعيد, محمد سعيد, ياسر توفيق)
  → ALL have identical capabilities (all attendance.*)
  → attendance.view_all bypasses ownership scope
  → Sees ALL employees across all departments
  → Full access: live_monitor, timeline, history, reports, alerts, team_map, configure, cleanup

مدير البيع (attendance.live_monitor + subtree of team)
  → Sees all سوبر فايزر, مندوب, and assigned customers under them
  → NO settings/cleanup access
  → Has reports, timeline, history, alerts, team_map
  → May own customers directly (customer.owner_id = مدير البيع)

سوبر فايزر (attendance.live_monitor + subtree of reps)
  → Sees assigned مندوب and their customers only
  → Alerts + live_monitor only
  → NO reports, NO timeline (except own)
  → May own customers directly (customer.owner_id = سوبر فايزر)

مندوب
  → Self only (start/end workday, own status, own mini-timeline)
  → NO management screens
  → May own customers directly (customer.owner_id = مندوب)

عميل تابع
  → No attendance data
```

### Employee Self-Access (UNCHANGED from V1)

Sales Rep can:
- Start/end their own workday
- See their own current status (duration, visit count)
- See their own mini-timeline for today
- NOT see anyone else's tracking data
- NOT see historical data beyond today

### Customer Ownership Rule

Unlike V1 (which implicitly assumed customers belong only to مندوب), V2 explicitly allows **any** sales hierarchy role to own customers:

| Owner Role | Examples |
|------------|----------|
| مدير البيع | مدير البيع يمتلك عميلاً بشكل مباشر (حسابات رئيسية) |
| سوبر فايزر | سوبر فايزر يمتلك عميلاً (حسابات استراتيجية) |
| مندوب | مندوب يمتلك عميلاً (الحالة الطبيعية) |

This affects:
- **Live Monitoring**: If employee is a مدير البيع, `order_count`/`collection_count`/`new_customer_count` must still be computed per their sales activity — not just their team's
- **Timeline**: An employee's timeline shows orders/collections/customers created BY them, not their team's
- **Reports**: Per-employee KPIs measure the individual, not their team — but team-level aggregations include subtree totals

### RPC-Enforced Governance Pattern (UPDATED)

```sql
CREATE OR REPLACE FUNCTION public.get_live_workday_overview(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_session app.sessions;
    v_employee_id uuid;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token::text = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    -- Capability check (not role check)
    IF NOT public.check_capability(p_token, 'attendance.live_monitor') THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;

    -- Ownership scope (V2 addition)
    v_subtree_ids := app.get_subtree_ids(v_session.employee_id);
    -- ... query uses v_subtree_ids to filter employees ...
END;
$function$;
```

### API Surface (UPDATED)

| Endpoint | Capability | Ownership Scope |
|----------|-----------|-----------------|
| `start_workday` | Employee only (identity_type check) | Self only |
| `end_workday` | Employee only | Must own session |
| `get_my_workday_status` | Employee only | Self only |
| `sync_tracking_points` | Employee only | Must own session |
| `get_workday_settings` | `attendance.configure` | All (super-admin only) |
| `update_workday_settings` | `attendance.configure` | All (super-admin only) |
| `get_live_workday_overview` | `attendance.live_monitor` | Subtree |
| `get_employee_day_timeline` | `attendance.view_timeline` | Subtree |
| `get_employee_day_map` | `attendance.view_timeline` | Subtree |
| `get_employee_workday_history` | `attendance.view_history` | Subtree |
| `get_team_map` | `attendance.view_team_map` | Subtree |
| `get_employee_current_location` | `attendance.live_monitor` | Subtree |
| `get_workday_report` | `attendance.view_reports` | Subtree |
| `get_attendance_analysis` | `attendance.view_reports` | Subtree |
| `get_alerts` | `attendance.view_alerts` | Subtree |
| `cleanup_tracking_data` | `attendance.cleanup` | Super-admin only |
| `auto_cleanup_tracking_data` | cron (no auth) | System |

---

## Implementation Order (UPDATED)

| Phase | Scope | V1? | V2 Changes |
|-------|-------|-----|-----------|
| **Phase 1 — Schema & Infrastructure** | Database schema + Tables + RPCs + Permissions + Retention | ✅ (from V1) | + Capability codes registration + `order_count`/`collection_count`/`new_customer_count` fields in RPCs |
| **Phase 2 — Employee Mobile** | Start/end workday, breaks, timer, offline | ✅ (from V1) | Unchanged |
| **Phase 3a — Governance Migration** | Replace role checks with capability checks + ownership scoping | **NEW** | Update all management RPCs |
| **Phase 3b — Operational Screens** | Live Monitoring, Timeline, Team Map, Reports, Alerts | **REVISED** | All screens extended with orders/collections/customers data |
| **Phase 3c — Unified Timeline** | Full operational timeline with cross-module navigation | **NEW** | Integrate orders, collections, customers into timeline RPC and UI |
| **Phase 4 — Validation** | End-to-end testing | ✅ | + Ownership scope testing + cross-module navigation testing |

---

## Appendices

Appendices A, B, C, D: **UNCHANGED from V1.**

### Appendix E: Capability Registration

```sql
-- Register attendance capability codes
INSERT INTO public.capabilities (code, name, description, "group")
VALUES
  ('attendance.configure', N'إعدادات الحضور', N'تعديل إعدادات الحضور والانصراف', 'attendance'),
  ('attendance.live_monitor', N'المتابعة الحية', N'مشاهدة المتابعة الحية للموظفين', 'attendance'),
  ('attendance.view_timeline', N'عرض خريطة اليوم', N'مشاهدة الجدول الزمني والمسار للموظف', 'attendance'),
  ('attendance.view_history', N'سجل الأيام', N'مشاهدة سجل أيام العمل', 'attendance'),
  ('attendance.view_reports', N'التقارير', N'مشاهدة تقارير الحضور والانصراف', 'attendance'),
  ('attendance.view_alerts', N'التنبيهات', N'مشاهدة تنبيهات الحضور', 'attendance'),
  ('attendance.view_team_map', N'خريطة الفريق', N'مشاهدة خريطة الفريق', 'attendance'),
  ('attendance.view_all', N'رؤية كاملة', N'تجاوز نطاق الملكية ومشاهدة كل الموظفين', 'attendance'),
  ('attendance.cleanup', N'تنظيف البيانات', N'حذف بيانات التتبع القديمة', 'attendance')
ON CONFLICT (code) DO NOTHING;
```
