# Attendance Runtime — Gap Analysis: Current vs Target Image

**Date:** 2026-06-11  
**Reference Image:** `docs/ChatGPT Image 10 يونيو 2026، 06_34_57 ص.png`  
**Design Spec:** `docs/DESIGN_WORKDAY_TRACKING_V2.md`  
**Status:** Analysis — No implementation  

---

## Section 1 — Current State (per screen)

### 1.1 AttendancePage (employee self-service)

| Aspect | Detail |
|--------|--------|
| **Data displayed** | Workday status (started_at, duration, break time, net work time, visit count) |
| **RPCs used** | `get_my_workday_status`, `start_workday`, `end_workday`, `start_break`, `end_break` |
| **Working** | Start/end workday, break with reason selector, timer with auto-refresh, GPS + battery on actions, attendance status feedback (late detection) |
| **Not working** | No mini-timeline for self view (design spec V2 §10.3 mentions employee can see own mini-timeline) |
| **Known errors** | None reported |

### 1.2 LiveMonitoringPage

| Aspect | Detail |
|--------|--------|
| **Data displayed** | 5 summary counters (active, on_visit, on_break, connection_loss, no_start), employee cards grouped by status (working, on_visit, on_break, lost, no_start, ended) |
| **RPCs used** | `get_live_workday_overview` |
| **Working** | Employee cards with name, status badge, connection dot, start time, duration, productivity grid (visits, breaks, break_time, net, orders, collections, new_customers), location popup, map/history links |
| **Not working** | 9 counters not displayed (RPC doesn't return zero_visits/zero_orders/inactive counters), no employee detail drill-down (popup is basic — no timeline, no map, no stops, no daily summary) |
| **Known errors** | None |

### 1.3 TeamMapPage

| Aspect | Detail |
|--------|--------|
| **Data displayed** | Employee cards with name, location coordinates, status, duration, break_minutes, order_count, collection_count, new_customer_count, last_seen_at |
| **RPCs used** | `get_team_map` |
| **Working** | Cards with Google Maps link, navigation to employee day map page, productivity metrics visible |
| **Not working** | No interactive map (Google Maps links only), no summary counters displayed (RPC returns them but UI doesn't render them), no role display, no sales/collection amounts (only counts), no employee photo |
| **Known errors** | None |

### 1.4 HistoryPage

| Aspect | Detail |
|--------|--------|
| **Data displayed** | Session list per employee with date, start/end time, duration, break_minutes, net_work_minutes, visit_count, attendance_status badge |
| **RPCs used** | `get_employee_workday_history` |
| **Working** | Date range filter, employee UUID input, session cards with formatted times and status badges |
| **Not working** | Employee selector is raw UUID text field (no search/autocomplete), no productivity metrics per session (orders, collections, customers), no date pills for quick navigation |
| **Known errors** | None |

### 1.5 ReportsPage

| Aspect | Detail |
|--------|--------|
| **Data displayed** | Employee work hours cards (total_days, net_hours, break_hours, visits, orders, collections, new_customers), compliance analysis cards (late, early_departure, absence), CSV export |
| **RPCs used** | `get_workday_report`, `get_attendance_analysis` |
| **Working** | Date range filter, per-employee cards with productivity, compliance breakdown, CSV download |
| **Not working** | Summary section (RPC returns `summary` block but UI doesn't render it), no collection_amount display (RPC has it, UI skips it), no total_distance_km (RPC doesn't include it — missing from SQL), no average-per-day metrics, no charts/graphs |
| **Known errors** | None |

### 1.6 AlertsPage

| Aspect | Detail |
|--------|--------|
| **Data displayed** | Active/resolved alerts list with type, title, description, employee name, timestamp |
| **RPCs used** | `get_alerts`, `resolve_alert` |
| **Working** | Active/resolved tabs, alert type icons and labels, resolve button, employee history link, auto-refresh 60s |
| **Not working** | No `zero_orders` alert type (V2 spec requires it — مندوب نشط لم يصدر أي طلب بعد 4 ساعات), no navigation to related entities (order/collection/customer links) |
| **Known errors** | None |

### 1.7 EmployeeDayMapPage

| Aspect | Detail |
|--------|--------|
| **Data displayed** | Tracking points list (reverse chronological) with timestamp, coordinates, type label (visit/break/tracking), first/last point summary |
| **RPCs used** | `get_employee_day_map` |
| **Working** | Point list with Google Maps links per point, point count, start/end time, back navigation |
| **Not working** | No interactive map, no route polyline, no visit/order/collection/customer event markers, no long stop detection display, no distance calculation, no route replay, no timeline scrubber |
| **Known errors** | None |

### 1.8 AttendanceSettingsPage

| Aspect | Detail |
|--------|--------|
| **Data displayed** | official_start_time, official_end_time, late_threshold, early_departure_threshold, location_interval_seconds |
| **RPCs used** | `get_workday_settings`, `update_workday_settings` |
| **Working** | Read/write all 5 displayed fields |
| **Not working** | Missing UI fields: tracking_mode, retention_days, auto_cleanup_enabled, cleanup_frequency (exist in DB table but no UI), no cleanup tools (manual cleanup button, cleanup log viewer) |
| **Known errors** | None |

---

## Section 2 — Target State (extracted from reference image)

### Screen: Employee Monitoring Detail (NEW — does not exist)

Accessed by clicking an employee from Live Monitoring or Team Map. This is the PRIMARY target screen in the reference image.

#### Employee Header

| # | Element | Example (from image) |
|---|---------|---------------------|
| 1 | Employee name | أحمد محمد |
| 2 | Job title / Role | مندوب مبيعات – قطاع طنطا |
| 3 | Connection status | متصل الآن |
| 4 | Employee photo | (avatar/photo placeholder) |

#### Top Row — 6 KPI Cards

| # | KPI | Example Value | Data Source |
|---|-----|---------------|-------------|
| 1 | العملاء الجدد (New Customers) | 2 | `customers` WHERE owner_id = employee AND created_at::date = today |
| 2 | إجمالي المبيعات (Total Sales) | 18,450 ج.م | `orders` WHERE created_by = employee AND created_at::date = today, SUM(total) |
| 3 | عدد الطلبات (Orders Count) | 9 | `orders` WHERE created_by = employee AND created_at::date = today, COUNT |
| 4 | عدد الزيارات (Visits Count) | 14 | `visit_links` WHERE employee_id = employee AND date = today |
| 5 | مدة العمل (Work Duration) | 9:31 | `workday_sessions` net_work calculation |
| 6 | أوقات اليوم (Day Times) | 08:12 / 17:43 | `workday_sessions` start_time / end_time |

#### Section 1: Route Map (خريطة حركة اليوم)

| # | Element | Description |
|---|---------|-------------|
| 7 | Interactive map | Visual map with route polyline |
| 8 | Start point marker | Beginning of workday location |
| 9 | Movement route | Polyline connecting tracking points in sequence |
| 10 | Visit point markers | Locations of visit check-ins |
| 11 | Long stop markers | Locations where employee stopped > threshold |
| 12 | End point marker | Workday end location |
| 13 | Total distance | إجمالي المسافة (km) |
| 14 | Long stops count | عدد التوقفات الطويلة |
| 15 | Total stop duration | إجمالي زمن التوقف |
| 16 | Timeline replay scrubber | شريط إعادة تشغيل Timeline للحركة |

#### Section 2: Timeline (الخط الزمني ليوم العمل)

| # | Event Type | Example | Required Fields |
|---|------------|---------|-----------------|
| 17 | Start workday | 08:15 بدء يوم العمل | Time, event type |
| 18 | Visit start | 08:47 بدء زيارة — عميل X | Time, event type, customer name, location |
| 19 | Visit end | 09:06 إنهاء زيارة — عميل X | Time, event type, customer name, duration |
| 20 | Order created | 09:06 طلب رقم 4523 — 1,250 ج.م | Time, event type, order number, amount |
| 21 | Collection taken | 09:15 تحصيل من عميل X — 850 ج.م نقداً | Time, event type, customer name, amount, method |
| 22 | New customer added | 09:35 عميل جديد: Z Store | Time, event type, customer name |
| 23 | Break start | 09:45 استراحة (طعام) | Time, event type, reason |
| 24 | Break end | 10:00 انتهاء استراحة | Time, event type |
| 25 | End workday | 17:43 إنهاء يوم العمل | Time, event type |

Each event is **clickable** → navigates to detail screen (order page, visit page, collection page, customer profile).

#### Section 3: Long Stops (التوقفات الطويلة)

| # | Element |
|---|---------|
| 26 | Start time |
| 27 | End time |
| 28 | Duration |
| 29 | Location (address/coordinates) |

#### Section 4: Daily Summary (ملخص اليوم)

| # | Metric |
|---|--------|
| 30 | الزيارات المعتمدة (Approved visits) |
| 31 | الزيارات المرفوضة (Rejected visits) |
| 32 | عدد الطلبات (Order count) |
| 33 | إجمالي المبيعات (Total sales) |
| 34 | مدة العمل الفعلية (Actual work duration — net) |
| 35 | إجمالي الحركة بالكيلومتر (Total movement km) |

### Additional Target Requirements per Screen

#### Live Monitoring (employee entry card)

| # | Element |
|---|---------|
| 36 | Employee name |
| 37 | Employee photo |
| 38 | Status (connected/disconnected/delayed) |
| 39 | Last seen timestamp |
| 40 | Current location (coordinates/address) |
| 41 | Work duration |
| 42 | Orders count (today) |
| 43 | Visits count (today) |
| 44 | New customers count (today) |
| 45 | Collections amount (today) |
| 46 | Sales value (today) |

#### Team Map (per-employee marker/card)

| # | Element |
|---|---------|
| 47 | Employee name |
| 48 | Role (job title) |
| 49 | Status |
| 50 | Work duration |
| 51 | Orders count |
| 52 | Visits count |
| 53 | New customers count |
| 54 | Collections amount |
| 55 | Sales value |
| 56 | Last seen timestamp |
| 57 | Current location |

#### Reports (unified operational report)

| # | Element |
|---|---------|
| 58 | Attendance (start/end time, net hours, breaks) |
| 59 | Orders (count, total value) |
| 60 | Visits (count) |
| 61 | New customers (count) |
| 62 | Collections (count, total amount) |
| 63 | Sales (total value) |

---

## Section 3 — Data Mapping

| Element | Component | Data Source | Table | Existing RPC | Existing UI | Status |
|---------|-----------|-------------|-------|-------------|-------------|--------|
| Employee name | Header | `employees.full_name` | employees | All RPCs return name | ✅ All pages | READY |
| Employee role | Header | `employees.role` | employees | NOT returned by any RPC | ❌ Not in any page | PARTIAL |
| Connection status | Header | computed from `tracking_points` | tracking_points | `get_live_workday_overview` returns it | ✅ LiveMonitoring | READY |
| Employee photo | Header | `employees.avatar_url` | employees | NOT returned by management RPCs | ❌ Not in any page | MISSING |
| New customers count | KPI card | `COUNT(customers WHERE owner_id=employee AND date=today)` | customers | `get_live_workday_overview`, `get_team_map`, `get_workday_report` return it | ✅ Live, TeamMap, Reports | READY |
| Total sales value | KPI card | `SUM(orders.total WHERE created_by=employee AND date=today)` | orders | NOT returned by any RPC (only order_count exists) | ❌ Not in any page | MISSING |
| Orders count | KPI card | `COUNT(orders WHERE created_by=employee AND date=today)` | orders | ✅ All 3 management RPCs return `order_count` | ✅ Live, TeamMap, Reports | READY |
| Visits count | KPI card | `COUNT(visit_links WHERE employee_id=employee AND date=today)` | visit_links | ✅ `get_live_workday_overview`, `get_workday_report` return `visit_count` | ✅ Live, Reports | READY |
| Work duration (net) | KPI card | computed from `workday_sessions` | workday_sessions | ✅ `get_live_workday_overview` returns `net_minutes` | ✅ Live | READY |
| Start time | KPI card | `workday_sessions.start_time` | workday_sessions | ✅ Live, History return it | ✅ Live, History | READY |
| End time | KPI card | `workday_sessions.end_time` | workday_sessions | ✅ History returns it | ✅ History | READY |
| Interactive route map | Section 1 | `tracking_points` polyline | tracking_points | `get_employee_day_map` returns raw points only | ❌ Not implemented | MISSING |
| Start point marker | Map | First tracking_point of day | tracking_points | Same RPC | ❌ | MISSING |
| Route polyline | Map | All tracking_points (ordered) | tracking_points | Same RPC | ❌ | MISSING |
| Visit markers | Map | visit_links with coordinates | visit_links | NOT in RPC | ❌ | MISSING |
| Long stop markers | Map | Detected from tracking_points gaps | computed | NOT in any RPC | ❌ | MISSING |
| End point marker | Map | Last tracking_point | tracking_points | Same RPC | ❌ | MISSING |
| Total distance | Map summary | Computed from tracking_points | computed | NOT in any RPC | ❌ | MISSING |
| Long stops count | Map summary | Detected from gaps | computed | NOT in any RPC | ❌ | MISSING |
| Total stop duration | Map summary | Duration of long stops | computed | NOT in any RPC | ❌ | MISSING |
| Timeline replay | Map | Sequence playback UI | — | — | ❌ | MISSING |
| Timeline events | Section 2 | Mixed: session, visits, orders, collections, customers, breaks | multiple | `get_employee_day_timeline` RPC does NOT exist | ❌ Not implemented | MISSING |
| Start workday event | Timeline | `workday_sessions` | workday_sessions | No timeline RPC | ❌ | MISSING |
| Visit events | Timeline | `visit_links` | visit_links | No timeline RPC | ❌ | MISSING |
| Order events | Timeline | `orders` | orders | No timeline RPC | ❌ | MISSING |
| Collection events | Timeline | `collections` | collections | No timeline RPC | ❌ | MISSING |
| New customer events | Timeline | `customers` | customers | No timeline RPC | ❌ | MISSING |
| Break events | Timeline | `workday_breaks` | workday_breaks | No timeline RPC | ❌ | MISSING |
| End workday event | Timeline | `workday_sessions` | workday_sessions | No timeline RPC | ❌ | MISSING |
| Clickable events | Timeline | Navigate to order/visit/customer pages | — | — | ❌ | MISSING |
| Long stops list | Section 3 | Computed from tracking_points | computed | NOT in any RPC | ❌ | MISSING |
| Daily summary | Section 4 | Aggregated from multiple tables | multiple | `get_workday_report` has summary block (not displayed in UI) | ❌ Not rendered | PARTIAL |
| Approved/rejected visits | Summary | visit_links status | visit_links | NOT in any RPC | ❌ | MISSING |
| Collection amount | KPI / Summary | `collections.amount` | collections | `get_live_workday_overview` returns `collection_amount` (not displayed in UI for employee card) | ✅ In Live data but ❌ Not in UI | PARTIAL |
| Sales value (orders.total) | KPI / Summary | `orders.total` | orders | NOT returned by any RPC | ❌ | MISSING |
| Total movement km | Summary | Computed from tracking_points distance | computed | NOT in any RPC | ❌ | MISSING |

---

## Section 4 — Image Target Validation

| Element In Image | Current Implementation | Gap | Required Work |
|-----------------|----------------------|-----|---------------|
| Employee name (أحمد محمد) | ✅ All RPCs return full_name from employees table | None | None |
| Employee role (مندوب مبيعات – قطاع طنطا) | ❌ No RPC returns role/job_title or region | Role + region NOT in any management RPC response | **RPC**: Add `role`, `region` to `get_live_workday_overview` (or dedicated employee detail RPC). **Frontend**: Display in header |
| Connection status (متصل الآن) | ✅ `get_live_workday_overview` returns connection_status + last_seen_label | None | None |
| Employee photo | ❌ `employees.avatar_url` exists but no RPC returns it; no UI displays it | Avatar field available but unused | **RPC**: Include avatar_url in employee detail. **Frontend**: Display avatar in header |
| KPI: العملاء الجدد (2) | ✅ RPCs return `new_customer_count` (Live, TeamMap, Reports) | Value 2 shown in image → data exists | None |
| KPI: إجمالي المبيعات (18,450 ج.م) | ❌ **CRITICAL** — No RPC returns `sales_value` (SUM of orders.total) | `orders.total` column exists but never aggregated in any RPC | **RPC**: Add `sales_value` to employee detail RPC (SUM orders.total WHERE created_by=employee AND date=today) |
| KPI: عدد الطلبات (9) | ✅ RPCs return `order_count` (Live, TeamMap, Reports) | None | None |
| KPI: عدد الزيارات (14) | ✅ RPCs return `visit_count` (Live, Reports) | None | None |
| KPI: مدة العمل (9:31) | ✅ RPCs return `net_minutes` / `duration_minutes` | None | None |
| KPI: أوقات اليوم (08:12 / 17:43) | ✅ `workday_sessions.start_time` + `end_time` exist and returned by some RPCs | Not returned by same RPC populating live monitoring; History returns them | **RPC**: Include start_time + end_time in employee detail RPC |
| Route map (interactive) | ❌ **CRITICAL** — No interactive map anywhere | Only Google Maps links exist | **Frontend**: Add Leaflet/MapLibre map component. **RPC**: Ensure all tracking_points with lat/lng are returned |
| Start point marker | ❌ Not shown on any map | No map exists | **Frontend**: Marker on first tracking_point |
| Route polyline | ❌ Not drawn anywhere | No polyline rendering | **Frontend**: Polyline connecting tracking_points ordered by timestamp |
| Visit point markers | ❌ Not shown | visit_links coordinates not in map RPC | **RPC**: Include visit locations in map RPC. **Frontend**: Markers |
| Long stop markers | ❌ Not detected or shown | No long stop detection logic | **RPC/Logic**: Detect stops from tracking_points gaps (>N minutes). **Frontend**: Markers |
| End point marker | ❌ Not shown | No map exists | **Frontend**: Marker on last tracking_point |
| Total distance (km) | ❌ Not computed anywhere | No distance calculation | **RPC**: Compute from tracking_points coordinates using haversine/spherical distance |
| Long stops count | ❌ Not computed | No stop detection | **RPC**: Detect + count long stops |
| Total stop duration | ❌ Not computed | No stop detection | **RPC**: Sum long stop durations |
| Timeline replay scrubber | ❌ Not implemented | No animation/slider UI | **Frontend**: Timeline scrubber component |
| Timeline: Start workday | ❌ No unified timeline RPC or UI | No get_employee_day_timeline RPC exists | **RPC**: CREATE `get_employee_day_timeline(p_token uuid, p_employee_id uuid, p_date date)`. **Frontend**: Timeline component |
| Timeline: Visit events | ❌ Same as above | visit_links data exists in DB | **RPC**: Include visit_links in timeline |
| Timeline: Order events | ❌ Same as above | orders data exists in DB | **RPC**: Include orders in timeline with order_number, total, status |
| Timeline: Collection events | ❌ Same as above | collections data exists in DB | **RPC**: Include collections with customer_name, amount, method |
| Timeline: New customer events | ❌ Same as above | customers data exists in DB | **RPC**: Include new_customers in timeline |
| Timeline: Break events | ❌ Same as above | workday_breaks data exists in DB | **RPC**: Include breaks in timeline |
| Timeline: End workday | ❌ Same as above | workday_sessions.end_time exists | **RPC**: Include session end in timeline |
| Timeline: Clickable events | ❌ Not implemented | No navigation from timeline | **Frontend**: Each event links to order/visit/customer/collection page |
| Long stops list (Section 3) | ❌ Not implemented | No stop detection | See above (stops detection) |
| Daily summary (Section 4) | ❌ Not implemented | `get_workday_report` has summary block but not for single employee + missing fields | **RPC**: Add single-employee summary. **Frontend**: Summary cards |
| Approved/rejected visits | ❌ Not tracked or displayed | `visit_links` has no approved/rejected status concept | **DB/Logic**: May need visit approval workflow (currently visit_links has no status field). **Analysis needed**: Is this a new requirement? |
| Collection amount (value) | ⚠️ PARTIAL — `get_live_workday_overview` returns `collection_amount` but UI doesn't display it | Data exists in RPC; UI missing | **Frontend**: Add collection_amount to KPI display |
| Sales value (from orders.total) | ❌ **CRITICAL** — Not returned by any RPC | `orders.total` column exists; needs SUM aggregation | **RPC**: Add `sales_value` to all employee-level RPCs |
| Total movement km | ❌ Not computed | No distance aggregation | **RPC**: Add distance calculation. **Frontend**: Display in summary |

### Validation Summary

| Category | Count | Percentage |
|----------|-------|------------|
| READY (exists) | 10 | 28% |
| PARTIAL (exists but incomplete) | 4 | 11% |
| MISSING (does not exist) | 22 | 61% |
| **Total elements** | **36** | **100%** |

---

## Section 5 — Design Spec vs Image: Alignment Check

| Design Spec (§) | Image Element | Alignment | Notes |
|----------------|---------------|-----------|-------|
| §10.2 Live Monitoring — 10 questions | KPI cards (orders, collections, new customers, net time) | ✅ MATCH | Both spec and image require productivity KPIs |
| §10.2 — employee card fields | Name, status, duration, net, visits, orders, collections, new customers | ✅ MATCH | Spec matches image card content |
| §10.3 — Unified Timeline | 11 event types + clickable navigation | ✅ MATCH | Image timeline matches spec event list |
| §10.3 — time_distribution | Not in image | ⚠️ Spec-only | Image doesn't show time distribution pie/bar; spec requires it |
| §10.5 — Reports | Orders, collections, customers added | ✅ MATCH | Image requires sales value; spec mentions total_collections_amount |
| §10.5 — Average per-day metrics | Not in image | ⚠️ Spec-only | Spec mentions "متوسط الطلبات لكل يوم"; image doesn't show it |
| §10.7 — Team Map | Productivity per employee | ✅ MATCH | Both require full KPI per employee on map |
| §10.7 — 7 summary counters | Not in image | ⚠️ Spec-only | Image shows employee detail, not team map overview |
| §10.8 — 10 operational questions | All 10 covered by KPI cards + status | ✅ MATCH | Image answers all 10 questions |
| §13 — Ownership hierarchy | Employee role/region display | ✅ IMPLIED | Image shows "مندوب مبيعات – قطاع طنطا" which implies role + region |
| §4 — get_employee_day_timeline | Timeline + events + clickable | ✅ MATCH | Image requires exactly this RPC |
| §4 — get_live_workday_overview with productivity | KPI cards data source | ✅ MATCH | Image data = RPC fields |
| **Sales value (orders.total SUM)** | **إجمالي المبيعات 18,450 ج.م** | ❌ **NOT IN SPEC** | Design spec only mentions order_count, not total sales value |
| **Employee photo** | Avatar in header | ❌ **NOT IN SPEC** | Design spec doesn't mention photo; image shows it |
| **Route map with polyline** | خريطة حركة اليوم | ❌ **NOT IN SPEC** | Design spec §10.3 mentions route but no detailed map requirements |
| **Long stops detection** | التوقفات الطويلة | ❌ **NOT IN SPEC** | Spec mentions long stops as timeline event type but no dedicated section |
| **Distance calculation** | إجمالي المسافة | ❌ **NOT IN SPEC** | Spec mentions total_distance_km in report but not in employee detail |
| **Approved/rejected visits** | الزيارات المعتمدة / المرفوضة | ❌ **NOT IN SPEC** | New concept not in design spec or current DB schema |

### Conclusion: Image extends beyond DESIGN_WORKDAY_TRACKING_V2.md

The reference image shows a **richer employee detail screen** than what the design spec describes. The spec focuses on aggregate screens (live monitoring, team map, reports), while the image shows a drill-down detail view that integrates:
1. Live KPI monitoring (from spec §10.2)
2. Route map with polyline (beyond spec)
3. Unified timeline with clickable events (from spec §10.3)
4. Long stops detection (beyond spec)
5. Daily summary with new metrics (sales value, distance, approved/rejected visits — beyond spec)

**New elements in image NOT in DESIGN_V2:**
- Sales value (SUM of orders.total)
- Employee photo
- Interactive route map with polyline
- Long stops list (detection + display)
- Total distance calculation
- Approved/rejected visits
- Timeline replay scrubber

---

## Section 6 — Database Impact

### Do we need new tables?

| Candidate | Verdict | Reason |
|-----------|---------|--------|
| New table for long stops | ❌ **NO** | Long stops can be computed from existing `tracking_points` data (gap detection) |
| New table for visit approval | ⚠️ **MAYBE** | `visit_links` has no `status` column (approved/rejected). If approval workflow is needed, add column `status VARCHAR` to `visit_links` |
| New table for employee daily summary | ❌ **NO** | Summary is computed via SQL aggregation from existing tables |

### Do we need new columns?

| Table | Column | Required For | Verdict |
|-------|--------|-------------|---------|
| `employees` | `avatar_url` | Employee photo | ✅ **ALREADY EXISTS** — just not used by any RPC/UI |
| `employees` | `region` | Region display ("قطاع طنطا") | ⚠️ **MAYBE** — `employees` has no `region` column. Check if `area` or `branch` exists. If not, may need to add or derive from manager hierarchy |
| `visit_links` | `status` | Approved/rejected visits distinction | ⚠️ **MAYBE** — If approval concept is new, add `status VARCHAR DEFAULT 'pending'`. Otherwise hardcode as approved |
| `orders` | (none needed) | `total` column already exists | ✅ **EXISTS** |
| `collections` | (none needed) | `amount`, `method` columns exist | ✅ **EXISTS** |
| `customers` | (none needed) | All needed columns exist | ✅ **EXISTS** |
| `tracking_points` | (none needed) | `latitude`, `longitude`, `recorded_at`, `employee_id` exist | ✅ **EXISTS** |

### Do we need new views?

| View | Need | Verdict |
|------|------|---------|
| Employee daily KPI summary | Not needed if RPC handles it | ❌ **NO** — RPC approach sufficient |
| Long stops detection | Could be a helper function | ⚠️ **MAYBE** — Could be inline in RPC or separate function |

### Do we need new RPCs?

| RPC | Required For | Priority | Verdict |
|-----|-------------|----------|---------|
| `get_employee_day_timeline(p_token uuid, p_employee_id uuid, p_date date)` | Timeline section + clickable events | **HIGH** | ✅ **CREATE — NEW** |
| Enhance `get_employee_day_map` or create new: `get_employee_day_route(p_token, p_employee_id, p_date)` | Route map with polyline, distance, stops | **HIGH** | ✅ **ENHANCE or CREATE** |
| `get_employee_detail(p_token uuid, p_employee_id uuid)` | Single-employee KPI + summary + sales value + role/region/photo | **HIGH** | ✅ **CREATE — NEW** |
| Enhance `get_live_workday_overview` | Add `sales_value`, `role`, `region`, `avatar_url` | **MEDIUM** | ⚠️ **ENHANCE** |
| Enhance `get_team_map` | Add `role`, `sales_value`, `collection_amount`, visit_count | **MEDIUM** | ⚠️ **ENHANCE** |
| Enhance `get_workday_report` | Add `sales_value` to employee array; fix total_distance_km | **MEDIUM** | ⚠️ **ENHANCE** |

### Do we need new indexes?

| Index | Reason | Verdict |
|-------|--------|---------|
| `tracking_points(employee_id, recorded_at)` | Route queries filter by employee + date range | ⚠️ **MAYBE** — Check if exists; if not, beneficial for performance |
| `orders(created_by, created_at::date)` | Daily order aggregation per employee | ⚠️ **MAYBE** — Check if exists |
| `collections(created_by, collected_at::date)` | Daily collection aggregation per employee | ⚠️ **MAYBE** — Check if exists |

### Verdict

| Question | Answer |
|----------|--------|
| Do we need new tables? | **NO** — All data exists in current schema |
| Do we need new columns? | **NO** — All required columns exist already (check `visit_links.status` — may need addition) |
| Do we need new views? | **NO** — RPC approach covers everything |
| Do we need new RPCs? | **YES** — **3 new RPCs** minimum (timeline, route-with-distance, employee-detail) |
| Do we need to enhance existing RPCs? | **YES** — Add `sales_value`, `role`, `region`, `avatar_url`, `collection_amount` |
| Do we need new indexes? | **MAYBE** — Performance optimization, not blocking |
| **Can we reach 95% match with current data?** | **YES** — All data exists in DB. Only missing: RPCs to aggregate + frontend components to display |

---

## Section 7 — Governance Impact

### Ownership Hierarchy (from DESIGN_V2 §13)

| Role | Sees | Can Open | Can Edit | Can Export |
|------|------|----------|----------|------------|
| **الإدارة العليا** (ياسر, محمد, علي, محمود) | ALL employees (via `attendance.view_all`). Full KPI, timeline, map, stops, summary for every employee | Live Monitoring, Team Map, Timeline, History, Reports, Alerts, Settings, all employee details | Configure settings (`attendance.configure`), cleanup data (`attendance.cleanup`), resolve alerts | CSV reports |
| **مدير البيع** (خالد سعيد) | Subtree only (his team via `app.get_subtree_ids()`). Full KPI for his team members. **NO** settings/cleanup | Live Monitoring, Team Map, Timeline, History, Reports, Alerts, employee details within subtree | Resolve alerts only | CSV reports |
| **مشرف** (supervisor) | Subtree only (assigned reps). Limited KPI. **NO** reports, **NO** timeline for others (only own) | Live Monitoring, Alerts, own timeline | Resolve alerts (own scope) | None |
| **مندوب** (sales rep) | Self only. Own workday page, own mini-timeline for today | AttendancePage (start/end/break), own profile | Start/end own workday, own breaks | None |

### Target Image Governance Check

| Image Element | Who Can See It | Current Governance |
|---------------|---------------|-------------------|
| Employee detail page (map + timeline + stops + summary) | الإدارة العليا + مدير البيع (subtree) | ✅ `attendance.view_timeline` + `attendance.view_all` or subtree exists for map access |
| KPI: sales value (إجمالي المبيعات) | Same as above | ✅ No new governance needed — same scope as other KPIs |
| KPI: new customers | Same as above | ✅ Already governed |
| Route map with polyline | Same as above | ✅ Same as `get_employee_day_map` (uses `attendance.view_timeline`) |
| Long stops | Same as above | ✅ Derived from tracking_points (already governed) |
| Daily summary | Same as above | ✅ Same as `get_workday_report` (uses `attendance.view_reports`) |
| Employee photo | Same as above | ⚠️ No governance issue — data from `employees` table |
| Role/region | Same as above | ⚠️ No governance issue — data from `employees` table |

**Verdict:** No new capabilities needed. The employee detail screen fits under existing `attendance.view_timeline` capability. All new data (sales value, distance, stops) are computed from tables already governed by existing RPCs.

---

## Section 8 — Execution Plan

### Phase A: Data Layer — New RPCs

**Files:** `supabase/migrations/20260611_<phase>.sql`

| Step | Action | Dependencies |
|------|--------|-------------|
| A1 | CREATE `get_employee_day_timeline(p_token uuid, p_employee_id uuid, p_date date)` — returns unified timeline events: session start/end, visits, orders, collections, customers, breaks, long stops. All events sorted chronologically with clickable entity references | None |
| A2 | CREATE `get_employee_day_route(p_token uuid, p_employee_id uuid, p_date date)` — returns tracking_points ordered, start/end markers, visit markers with lat/lng, long stops with duration, total distance (computed via haversine) | A1 (share stop detection logic) |
| A3 | CREATE `get_employee_detail(p_token uuid, p_employee_id uuid, p_date date)` — returns single-employee KPI: name, role, region, avatar, status, start_time, end_time, duration, net_minutes, visit_count, order_count, sales_value (SUM orders.total), collection_count, collection_amount, new_customer_count, daily summary (visits approved/rejected, total distance, stops) | A1, A2 |
| A4 | ENHANCE `get_team_map` — add `role`, `sales_value`, `collection_amount`, `visit_count` to employee array | None |
| A5 | ENHANCE `get_workday_report` — add `sales_value` to employee items, fix `total_distance_km` inclusion | None |

**RPCs to create:** 3 new  
**RPCs to enhance:** 2 existing  

### Phase B: Component — Employee Detail Screen (NEW)

**Files:** `src/pages/attendance/EmployeeMonitoringPage.tsx` (NEW)

| Step | Action | Dependencies |
|------|--------|-------------|
| B1 | Create `EmployeeMonitoringPage` component — route `/attendance/monitor/:employeeId?date=YYYY-MM-DD` | A3 |
| B2 | Build Employee Header: name, role, region, photo, connection status | A3 |
| B3 | Build 6-KPI card row: new_customers, sales_value, order_count, visit_count, net_duration, start/end time | A3 |
| B4 | Build Interactive Map (Leaflet/MapLibre): polyline route, start/end/visit/stop markers, distance + stops + stop duration below map, timeline playback scrubber | A2 |
| B5 | Build Unified Timeline component: chronological event list, event icons/colors, clickable entities (→ orders/:id, visits/:id, etc.) | A1 |
| B6 | Build Long Stops list: start time, end time, duration, location | A2 |
| B7 | Build Daily Summary cards: approved visits, rejected visits, orders, sales, net hours, distance | A3 (enhanced with visit status) |

**Dependencies between B steps:** B4 depends on B1; B5 depends on B4; B6/B7 independent.

### Phase C: Live Monitoring — Employee Entry Enhancement

**Files:** `src/pages/attendance/LiveMonitoringPage.tsx`

| Step | Action | Dependencies |
|------|--------|-------------|
| C1 | Update employee card: add photo, role, sales_value display, collection_amount display | A4 |
| C2 | Add "متابعة" (monitor) button → navigates to `/attendance/monitor/:employeeId` | Phase B |
| C3 | Update location popup: add sales_value, collection_amount, full KPI | A3 |

### Phase D: Team Map Enhancement

**Files:** `src/pages/attendance/TeamMapPage.tsx`

| Step | Action | Dependencies |
|------|--------|-------------|
| D1 | Update employee cards: add role, sales_value, collection_amount, visit_count | A4 |
| D2 | Add "متابعة" button → navigates to `/attendance/monitor/:employeeId` | Phase B |
| D3 | Render summary counters (7 counters from RPC) | A4 |

### Phase E: Reports Enhancement

**Files:** `src/pages/attendance/ReportsPage.tsx`

| Step | Action | Dependencies |
|------|--------|-------------|
| E1 | Add `sales_value` column to report cards + CSV | A5 |
| E2 | Add `collection_amount` column to report cards + CSV | A5 |
| E3 | Render summary section (total_sessions, total_net_hours, total_visits, total_orders, total_collections, total_collections_amount, total_new_customers) from RPC `summary` block | A5 |

### Phase F: Alerts Enhancement

**Files:** `src/pages/attendance/AlertsPage.tsx`

| Step | Action | Dependencies |
|------|--------|-------------|
| F1 | Add `zero_orders` alert type to `ALERT_LABELS` + icon | Requires RPC change to `get_alerts` to detect zero_orders |
| F2 | Add clickable entity links (order → /orders/:id, collection → /collections/:id, etc.) | None |

### Phase G: Route Guard / Navigation

**Files:** `src/routes/index.tsx`

| Step | Action |
|------|--------|
| G1 | Add `/attendance/monitor/:employeeId` route with `requireCapability="attendance.view_timeline"` |

### Execution Order

```
Phase A (Data Layer) ───────────────────┐
    A1 → A2 → A3 ───────────────────────┤
    A4, A5 (parallel with A1–A3) ───────┤
                                         ▼
Phase B (Employee Detail Screen) ──── Phase C, D, E, F (parallel)
    B1 → B2 → B3 → B4 → B5 → B6 → B7     C1, C2, D1, D2, D3, E1, E2, E3, F1, F2
                                         │
                                         ▼
                                    Phase G (Route)
                                     G1 (quick)
```

---

## Section 9 — Reality Check

| Domain | Percentage | Justification |
|--------|-----------|---------------|
| **Database** | 95% | All required tables and columns exist. Only `visit_links.status` (approved/rejected) may need addition if approval workflow is required. All data (orders, collections, customers, tracking points, sessions, breaks) is already tracked in current schema |
| **RPCs** | 20% | Existing RPCs cover aggregate views (live overview, team map, report) with productivity fields. But **3 critical RPCs are missing**: `get_employee_day_timeline`, `get_employee_day_route`, `get_employee_detail`. Existing RPCs lack `sales_value` (SUM orders.total), `role`, `region`, `avatar_url` |
| **UI** | 15% | The primary target screen (employee monitoring detail with map + timeline + stops + summary) **does not exist at all**. Current screens are aggregate overviews. The interactive map, timeline component, long stops list, and 6-KPI card layout are all new |
| **Governance** | 100% | Capability model already covers all required access patterns. New employee detail page fits under `attendance.view_timeline`. No new capabilities needed |
| **Overall** | **40%** | Database foundation is solid (95%). Governance is complete (100%). But RPCs (20%) and UI (15%) need significant work. The core gap is: no employee detail page exists, no timeline RPC exists, no route-with-distance RPC exists, no sales value aggregation exists |

### Can we reach 95% with current data?

**YES** — All data exists in the current database:
- `employees` has name, role (`employees.role`), photo (`employees.avatar_url`)
- `orders` has `created_by`, `total`, `created_at` — needed for order count + sales value
- `collections` has `created_by`, `amount`, `collected_at` — needed for collection count + amount
- `customers` has `owner_id`, `created_at` — needed for new customer count
- `tracking_points` has `employee_id`, `latitude`, `longitude`, `recorded_at` — needed for route map, distance, stops
- `visit_links` has `employee_id`, `session_id`, `checkin_at`, `checkout_at` — needed for visit events + markers
- `workday_breaks` has `session_id`, `break_start`, `break_end` — needed for break events
- `workday_sessions` has `employee_id`, `date`, `start_time`, `end_time`, `status` — needed for session info

**What's needed to reach 95%:**
1. **3 new RPCs** (timeline, route, employee detail) — aggregates existing data
2. **Enhance 2 existing RPCs** (team_map, report) — add sales_value + missing fields
3. **1 new frontend page** (EmployeeMonitoringPage) — map + timeline + stops + KPI
4. **Enhance existing pages** (LiveMonitoring, TeamMap, Reports) — add sales_value display, navigation to detail page

**No schema changes needed** unless `visit_links.status` for approved/rejected is required.
**No new tables needed.**
**No new capabilities needed.**

---

## Executive Summary (max 20 lines)

1. **Database 95% ready** — كل البيانات موجودة (طلبات، زيارات، تحصيلات، عملاء، نقاط تتبع، استراحات، جلسات) وتحتاج فقط تجميع في RPCs جديدة.
2. **RPCs 20% فقط** — ينقص 3 RPCs أساسية: `get_employee_day_timeline` للأحداث المتكاملة، `get_employee_day_route` للخريطة مع المسافة، `get_employee_detail` للـ KPI الفردي مع قيمة المبيعات.
3. **UI 15% فقط** — الشاشة الأساسية في الصورة (Employee Monitoring Detail) غير موجودة بالمرة. الخريطة التفاعلية، الـ Timeline، التوقفات الطويلة، والملخص كله جديد.
4. **Governance 100% جاهز** — نظام الصلاحيات الحالي (`attendance.view_timeline` + `app.get_subtree_ids()`) يغطي كل الوصول المطلوب بدون أي تعديل.
5. **الفجوة الأساسية:** الصورة تظهر شاشة جديدة كلياً (متابعة موظف فردي) بينما الموجود حالياً هو شاشات عرض إجمالي (Live monitoring, Team map). لا توجد شاشة تفاصيل موظف بخريطة وتايم لاين وتوقفات.
6. **عناصر غير موجودة في DESIGN_V2 أصلاً:** قيمة المبيعات (`SUM orders.total`)، المسافة المقطوعة (`tracking_points`), التوقفات الطويلة، صورة الموظف، الموافقة/رفض الزيارات.
7. **الخلاصة:** يمكن الوصول إلى 95% تطابق مع البيانات الحالية بدون أي جداول جديدة. المطلوب: 3 RPCs جديدة، تعزيز 2 RPCs قائمة، شاشة Frontend جديدة، وتحسينات لشاشات قائمة.
