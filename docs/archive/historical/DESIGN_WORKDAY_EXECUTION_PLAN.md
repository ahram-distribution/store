# Design Execution Plan — Employee Monitoring Detail Screen

**Date:** 2026-06-11  
**Target:** `ChatGPT Image 10 يونيو 2026، 06_34_57 ص.png`  
**Current Score:** 25% → **Target Score: ~90%**  
**Status:** PENDING APPROVAL — no implementation until approved

---

## Phase A: Database Changes

### A1 — Add columns to `employees` (minimal, non-breaking)

```sql
ALTER TABLE employees ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS avatar_url text;
```

| Column | Type | Nullable | Default | Purpose |
|--------|------|----------|---------|---------|
| `region` | text | YES | NULL | Sales territory like "قطاع طنطا", "قطاع القاهرة" |
| `avatar_url` | text | YES | NULL | URL to employee photo (Supabase Storage or CDN) |

**Affected tables:** 1 — `employees` only  
**Data migration:** None (nullable, no default)  
**Org impact:** None. Region is soft metadata, not part of any constraint.  
**Rollback:** `ALTER TABLE employees DROP COLUMN IF EXISTS region;` (and for avatar_url)

### A2 — No other schema changes needed

All required data exists in current tables:
- **Role**: Available via `employee_roles` + `roles` JOIN
- **Visit data**: Available via `visits` table directly
- **Orders/Collections/Customers**: Available via `owner_id` → employees
- **Tracking/Route**: Available via `tracking_points`

### Migration file
- One new file: `supabase/migrations/20260611_phase6_employee_meta.sql`

---

## Phase B: New RPCs (3 total)

### B1 — `get_employee_detail(p_employee_id uuid, p_date date)`

**Purpose:** Return complete daily summary for one employee (header KPIs)

**Returns:**
```json
{
  "employee": { "id", "full_name", "code", "role_name", "region", "avatar_url", "manager_name" },
  "summary": {
    "total_orders", "total_sales", "total_collections", "total_collections_amount",
    "new_customers", "total_visits", "completed_visits", "visit_results": { "order_taken", "collection_taken", "customer_closed", "no_responsible_person" },
    "total_distance_meters", "total_break_minutes", "total_work_minutes",
    "session_count", "attendance_status"
  }
}
```

**Queries involved:**
1. `SELECT from employees LEFT JOIN employee_roles+roles` for employee + role
2. `SELECT COUNT(*), SUM(total_amount) FROM orders WHERE owner_id = p_employee_id AND created_at::date = p_date`
3. `SELECT COUNT(*), SUM(amount) FROM collections WHERE owner_id = p_employee_id AND created_at::date = p_date` (with status filter)
4. `SELECT COUNT(*) FROM customers WHERE owner_id = p_employee_id AND created_at::date = p_date`
5. `SELECT COUNT(*), ... FROM visits WHERE employee_id = p_employee_id AND check_in_at::date = p_date`
6. `SELECT SUM(duration_seconds) FROM workday_breaks WHERE employee_id = p_employee_id AND break_start::date = p_date`
7. `SELECT SUM(total_distance_meters) FROM workday_sessions WHERE employee_id = p_employee_id AND date = p_date`

**Security:** `SECURITY DEFINER`, `ROLE CURRENT_USER`, check_capability('attendance.view_timeline')

### B2 — `get_employee_day_timeline(p_employee_id uuid, p_date date)`

**Purpose:** Return ordered timeline of all events for one employee on a given date

**Returns:**
```json
[
  {
    "time": "2026-06-11T08:00:00Z",
    "type": "workday_start" | "workday_end" | "break_start" | "break_end" |
            "visit_start" | "visit_end" | "order_taken" | "collection_taken" |
            "tracking_point",
    "title": "بداية يوم العمل",
    "description": "...",
    "latitude": 30.0444,
    "longitude": 31.2357,
    "metadata": {}
  }
]
```

**Data sources merged and sorted by timestamp:**
1. `workday_sessions` (start_time, end_time) → events
2. `workday_breaks` (break_start, break_end) → events
3. `visits` (check_in_at, check_out_at + visit_result) → events
4. `tracking_points` (recorded_at + point_type) → events (sampled)

**Security:** Same as B1

### B3 — `get_employee_day_route(p_employee_id uuid, p_date date)`

**Purpose:** Return route geometry and stop detection for the map

**Returns:**
```json
{
  "route": [
    { "lat": 30.0444, "lng": 31.2357, "time": "...", "speed": 0, "point_type": "start" },
    ...
  ],
  "stops": [
    { "lat": 30.1111, "lng": 31.2138, "started_at": "...", "ended_at": "...",
      "duration_minutes": 15, "type": "visit", "customer_name": "ماجد سيف",
      "visit_result": "order_taken" }
  ],
  "total_distance_meters": 4850,
  "total_duration_minutes": 480
}
```

**Queries:**
1. `SELECT latitude, longitude, recorded_at, speed_mps, point_type FROM tracking_points WHERE employee_id = p_employee_id AND recorded_at::date = p_date ORDER BY recorded_at`
2. Stop detection: Calculate gaps between consecutive tracking points (gap > 5 min = potential stop); correlate with visits

**Distance calculation**: Haversine formula between consecutive tracking points (since session distances are always 0). This is more accurate than relying on `workday_sessions.total_distance_meters`.

**Security:** Same as B1

---

## Phase C: Frontend Changes

### C1 — New Route

**File:** `src/routes/index.tsx`

Add one new route under `/attendance/`:
```tsx
{
  path: '/attendance/employees/:id',
  element: <EmployeeDetailPage />,
  loader: requireCapability('attendance.view_timeline')
}
```

### C2 — New Page: `EmployeeDetailPage`

**File:** `src/pages/attendance/EmployeeDetailPage.tsx`

**Layout** (top to bottom, matching reference image):

```
┌─────────────────────────────────────────────┐
│  Header Card                                │
│  [Photo]  حسن بكر                           │
│           REP004                            │
│           مندوب مبيعات – قطاع طنطا          │
│  Date Picker: [السبت, 30 مايو 2026    ▼]    │
├─────────────────────────────────────────────┤
│  KPI Cards Row                              │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│  │ 9    │ │ 950  │ │ 525  │ │ 2    │ │ 14   │
│  │طلبيات│ │مبيعات│ │تحصيل │ │عميل  │ │زيارة │
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘
├─────────────────────────────────────────────┤
│  Map + Timeline (side by side)              │
│  ┌──────────────────┐ ┌──────────────────┐ │
│  │  Route Map       │ │  Timeline        │ │
│  │  (polylines +    │ │  ● 08:00 بداية   │ │
│  │   markers)       │ │  ● 08:30 وصول    │ │
│  │                  │ │  ● 08:45 طلبية   │ │
│  │   [Replay ▶]     │ │  ● 08:45 مغادرة  │ │
│  └──────────────────┘ │  ● 09:00 استراحة │ │
│                       └──────────────────┘ │
├─────────────────────────────────────────────┤
│  Long Stops Section                         │
│  ┌─────────────────────────────────────────┐│
│  │  وقفات طويلة (أكثر من 5 دقائق): 3       ││
│  │  ● 09:00-09:20 ماجد سيف (20 د) – طلبية ││
│  │  ● 09:45-09:50 كارن (5 د) – تحصيل      ││
│  └─────────────────────────────────────────┘│
└─────────────────────────────────────────────┘
```

**Key components:**
- `EmployeeHeader` — photo (from avatar_url or placeholder), name, code, role, region, date picker
- `KpiCardsRow` — 5 cards: orders, sales, collections, new customers, visits
- `RouteMap` — Leaflet/Mapbox map with polyline + markers (reuse from TeamMapPage)
- `Timeline` — vertical timeline component (new)
- `LongStopsList` — table/list of stops with duration, reason, customer name

**Reuse from existing code:**
- Map component: `TeamMapPage.tsx` has a base map with markers — can extract into shared component
- Arabic formatting: existing i18n patterns
- Loading/error states: existing patterns

### C3 — Shared Components

**File:** `src/components/attendance/EmployeeTimeline.tsx`
- Vertical timeline component
- Color-coded dots for each event type
- Expandable details per event

**File:** `src/components/attendance/EmployeeRouteMap.tsx`
- Extract from TeamMapPage
- Add polyline support, replay animation

---

## Phase D: Existing RPC Modifications

None of the existing RPCs need changes. The 3 new RPCs are self-contained.

---

## Expected Match Percentage with Reference Image

| Element | Target | Current | Expected After Phase C | Match % |
|---------|--------|---------|----------------------|---------|
| Employee photo | Avatar in header | ❌ No column | ✅ avatar_url (or placeholder) | 100% |
| Employee name | حسن بكر | ✅ full_name exists | ✅ Displayed | 100% |
| Employee code | REP004 | ✅ code exists | ✅ Displayed | 100% |
| Role | مندوب مبيعات | ✅ via employee_roles+roles | ✅ Displayed via JOIN | 100% |
| Region | قطاع طنطا | ❌ No column | ✅ region column + display | 100% |
| Date picker | السبت, 30 مايو 2026 | ✅ date picker exists | ✅ Adapted from existing patterns | 100% |
| KPI: الطلبيات (9) | Order count | ✅ orders.owner_id exists | ✅ COUNT via RPC | 100% |
| KPI: المبيعات (18,450 ج.م) | Sales value | ✅ orders.total_amount exists | ✅ SUM via RPC | 100% |
| KPI: التحصيلات (525 ج.م) | Collection amount | ✅ collections.amount exists | ✅ SUM via RPC ⚠️ data is all pending | 100% calc, 10% real |
| KPI: العملاء الجدد (2) | New customers | ✅ customers.owner_id + created_at | ✅ COUNT via RPC | 100% |
| KPI: الزيارات (14) | Visit count | ✅ 13 visits exist | ✅ COUNT via RPC | 100% calc, 90% data |
| Route map polyline | Path overlay | ⚠️ 17 tracking points (sparse) | ✅ Polyline via RPC B3 | 70% (sparse data) |
| Map markers | Location pins | ✅ lat/lng available | ✅ Pin for each route point | 100% |
| Timeline events | Color-coded dots | ✅ Data exists (sessions, breaks, visits) | ✅ RPC B2 with all event types | 100% |
| Timeline times | 08:00, 08:30... | ✅ Timestamps available | ✅ Formatted display | 100% |
| Long stops list | وقفات طويلة | ✅ Visit durations computable | ✅ Detected from gaps + visits | 90% |
| Replay animation | ▶ Play button | ⚠️ Sparse tracking points | ✅ Basic animation possible | 60% |
| Visit approved/rejected badge | Status indicator | ✅ visit_result available | ✅ Color-coded badge | 100% |
| Visit duration | 20 د, 5 د | ✅ check_in_at - check_out_at | ✅ Computable | 100% |
| **FULL SCREEN MATCH** | — | **~25%** | **~90%** | **90%** |

### Key to `calc` vs `real`:
- **100% calc** = the formula/query will produce the right number
- **X% real** = actual data quality limits what's shown (e.g., all collections are pending)

### What limits us from 95%+:
1. **Sparse tracking data** (17 points vs ideal 100+) → less detailed route polyline
2. **Only 1 employee** (حسن بكر) has real visit + tracking data → other employees show zeros
3. **0 operational data today** → timelines and KPIs show empty for current date
4. **Replay animation** works but gives coarse playback with only 17 points

These are data limitations, not code limitations. The code will be 100% ready; data fills in through real usage.

---

## Total Effort Estimate

| Phase | Files | Complexity | Notes |
|-------|-------|-----------|-------|
| A: Database | 1 migration file | 🟢 Trivial | 2 ALTER TABLE statements |
| B: RPCs | 3 SQL files | 🟡 Medium | Each is 30-80 lines with multiple CTEs |
| C: Frontend | 4-5 TSX files | 🔴 High | New page, new components, map integration |
| **Total** | **~8-10 files** | **Medium** | |

---

## Implementation Order

```
Step 1: ALTER TABLE employees — add region, avatar_url
Step 2: Create RPC get_employee_detail
Step 3: Create RPC get_employee_day_timeline  
Step 4: Create RPC get_employee_day_route
Step 5: Create EmployeeTimeline component
Step 6: Create EmployeeRouteMap component (extract from TeamMapPage)
Step 7: Create EmployeeDetailPage (compose all components)
Step 8: Add route to index.tsx
Step 9: Test (npm run build + verify)
Step 10: Update MANAGER_GUIDE.md
```

---

## Current Runtime Readiness Score (After Phases A-C)

| Domain | Before | After | Reason |
|--------|--------|-------|--------|
| Database | 70% | 90% | region + avatar_url added; role already resolvable |
| Data Availability | 15% | 15% | No change — data grows through real usage |
| RPC Readiness | 20% | 100% | 3 new RPCs cover all target image features |
| UI Readiness | 15% | 90% | Full page with map, timeline, KPIs, stops |
| Governance | 100% | 100% | Already all routes guarded |
| **Overall** | **25%** | **~75%** | Code-ready; data-limited |

**The data will fill in as employees use the system. The code is the enabler.**
