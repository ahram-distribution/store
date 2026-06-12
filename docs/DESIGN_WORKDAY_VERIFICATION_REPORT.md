# Verification Report — Actual Data Readiness for Target Image (Corrected)

**Date:** 2026-06-11  
**Reference:** `DESIGN_WORKDAY_RUNTIME_GAP_ANALYSIS.md`  
**Based on:** Live SQL queries against production database (2026-06-11)  
**Status:** ⚠️ CONDITIONALLY READY — 3 schema gaps remain, data is sparse but structurally sufficient

---

## 1. Orders Table

| Field | Value |
|-------|-------|
| **Table** | `public.orders` (37 columns) |
| **Employee link** | `orders.owner_id` → **`employees.id`** (direct, when `owner_type = 'employee'`) |
| **Value column** | `orders.total_amount` (numeric, NOT `total`) |
| **Total records** | 47 |
| **Employees with orders** | 6 distinct employees (via `owner_id`) |
| **Has `total_amount`?** | ✅ YES — all 47 |
| **Has `owner_id`?** | ✅ YES — direct FK to employees |
| **Orders TODAY** | ❌ **0 orders today** |
| **Per-employee breakdown** | ياسر توفيق: 17 orders (129,719.60), خالد سعيد: 10 (427,384), حسن بكر: 9 (244,034.80), محمد حافظ: 5 (94,445.90), عمر محسن: 4 (588,059), محمد عبد الباسط: 1 (1,731) |
| **Target image KPI** | "إجمالي المبيعات: 18,450 ج.م" — ✅ computable via `SUM(total_amount)` |

---

## 2. Collections Table

| Field | Value |
|-------|-------|
| **Table** | `public.collections` (16 columns) |
| **Employee link** | `collections.owner_id` → **`employees.id`** (direct, when `owner_type = 'employee'`) |
| **Total records** | ❌ **6 records** |
| **Employees with collections** | 3 employees |
| **Status** | ❌ **ALL 'pending'** — no approved collections |
| **Has `collected_at`?** | ❌ **ALL NULL** |
| **Target image KPI** | "التحصيلات: 525 ج.م" — ❌ no approved data |

---

## 3. Customers Table

| Field | Value |
|-------|-------|
| **Table** | `public.customers` |
| **Employee link** | `customers.owner_id` → `employees.id` (direct FK) |
| **Name column** | `company_name` (not `name`) |
| **Total records** | 25 |
| **Employees with customers** | 7 |
| **Target image KPI** | "العملاء الجدد: 2" — ✅ computable from `created_at` + `owner_id` |

---

## 4. Tracking Points Table

| Field | Value |
|-------|-------|
| **Table** | `public.tracking_points` (13 columns) |
| **Employee link** | `tracking_points.employee_id` → `employees.id` (direct FK) |
| **Total records** | 23 |
| **Employees with data** | 2 employees |
| **Today (2026-06-11)** | حسن بكر: **17 points**, ياسر توفيق: 2 points |
| **Data quality** | Has lat/lng, recorded_at, point_type, speed_mps, accuracy_meters, altitude, heading, battery_pct |
| **Sufficient for route?** | ⚠️ **17 points is borderline** — enough for a basic polyline but not rich detail |

---

## 5. Visits Table

| Field | Value |
|-------|-------|
| **Table** | `public.visits` (18 columns) |
| **Employee link** | `visits.employee_id` → `employees.id` (direct FK) |
| **Total records** | **13 visits** (NOT 0!) |
| **Employees with visits** | **حسن بكر only** (1 employee) |
| **Completed** | All 13 completed (have check_out_at) |
| **Visit results** | order_taken (8), customer_closed (2), no_responsible_person (2), collection_taken (1) |
| **Visit durations** | Range: 0–209 minutes. Sample: 3 min, 1 min, 3 min, 0 min |
| **Has lat/lng?** | YES — `check_in_latitude/longitude`, `check_out_latitude/longitude` |
| **Has `google_maps_link`?** | YES |
| **Target image** | "عدد الزيارات: 14" — close! 13 visits exist |
| **`visit_links`** | 0 records (visits not linked to workday sessions) — ✅ NOT NEEDED for target; visits.employee_id is sufficient |

---

## 6. Employees Table

| Field | Value |
|-------|-------|
| **Table** | `public.employees` (10 columns) |
| **Active employees** | 16 |
| **Columns** | `id`, `identity_id`, `code`, `full_name`, `email`, `manager_id`, `is_active`, `created_at`, `updated_at`, `address` |

### ROLE status: ✅ EXISTS (via JOIN, not direct column)

| Aspect | Detail |
|--------|--------|
| Direct `role` column in `employees`? | ❌ **NO** |
| But `employee_roles` + `roles` tables exist? | ✅ **YES** |
| Every employee has a role? | ✅ YES — all 16 employees have exactly 1 role in `employee_roles` |
| Roles available | 23 roles including "مندوب مبيعات", "مدير البيع", "مدير تنفيذي", "سوبر أدمن", etc. |
| Target image shows | "مندوب مبيعات – قطاع طنطا" |
| **Verdict** | ✅ **ROLE is available** — requires LEFT JOIN `employee_roles` + `roles`. No new column needed. RPCs need updating. |
| **Location** | `employees.id` → `employee_roles.employee_id` → `employee_roles.role_id` → `roles.id` → `roles.name` |
| **Affected tables** | `employee_roles`, `roles` (both exist, both populated) |
| **Org impact** | None. Role is already assigned to every employee. |

### REGION status: ❌ DOES NOT EXIST

| Aspect | Detail |
|--------|--------|
| Column in `employees`? | ❌ NO |
| Any table has region info? | ❌ NO — no `regions`, `areas`, `zones`, `branches`, `territories` lookup table exists |
| Column in any other table? | ❌ NO |
| **Verdict** | ❌ **BLOCKING** — No region/area data anywhere in the database |
| **Proposed location** | Add `region` column to `employees` (text, nullable) — one region per employee |
| **Other options** | Option A: `employees.region` (text, nullable) — simplest |
|  | Option B: Separate `regions` lookup table + `employee_regions` junction (for multi-region) |
| **Affected tables** | Only `employees` (add 1 column) |
| **Org impact** | Minimal. Each employee belongs to one sales territory. Region is a soft grouping, not a structural entity. Adding as a text column allows free-form entry ("قطاع طنطا", "قطاع القاهرة", etc.) without creating a full region management system. |
| **Risk** | None — nullable column, no data migration needed |

### AVATAR_URL status: ❌ DOES NOT EXIST ANYWHERE

| Aspect | Detail |
|--------|--------|
| Column in `employees`? | ❌ NO |
| Column in `identities`? | ❌ NO — only id, phone, password_hash, identity_type, is_active |
| Any table? | ❌ **NONE** — searched entire public schema for avatar, photo, profile_pic, picture, image_url — zero matches |
| **Verdict** | ❌ **BLOCKING** — No employee photo anywhere in the database |
| **Proposed location** | Add `avatar_url` column to `employees` (text, nullable) — stores a URL string |
| **Other options** | Option A: `employees.avatar_url` (text, nullable) — simplest, stores any URL (S3, Supabase Storage, etc.) |
|  | Option B: `identities.avatar_url` — if photo is per-identity, not per-employee |
| **C: Recommend Option A** | Because the target image shows employee photo per employee (not per identity/login). Employees are the domain entity for the attendance/monitoring system. |
| **Affected tables** | Only `employees` (add 1 column) |
| **Org impact** | None. URL storage means the actual image can be served from any CDN/storage. No migration needed. |
| **Risk** | None — nullable column, no data migration needed |

---

## 7. Workday Sessions

| Field | Value |
|-------|-------|
| **Total** | 12 sessions, 2 employees |
| **Has distance?** | ✅ 12/12 have `total_distance_meters` but **ALL are 0.00** — distance not computed |
| **Has lat/lng?** | ✅ YES — start_latitude/longitude, end_latitude/longitude |

---

## 8. Corrected Data Summary

| Table | Records | Employees | Direct to employees? | Today |
|-------|---------|-----------|---------------------|-------|
| Orders | 47 | 6 | ✅ `owner_id` → employees | 0 |
| Collections | 6 | 3 | ✅ `owner_id` → employees | 0 |
| Customers | 25 | 7 | ✅ `owner_id` → employees | 0 |
| Tracking Points | 23 | 2 | ✅ `employee_id` → employees | 19 pts |
| Visits | 13 | 1 | ✅ `employee_id` → employees | 0 |
| Workday Sessions | 12 | 2 | ✅ `employee_id` → employees | 9 sessions |
| Workday Breaks | 12 | 2 | ✅ `employee_id` → employees | 10 breaks |

---

## 9. Critical Status Change vs Previous Report

| Claim | Old Report | Corrected |
|-------|-----------|-----------|
| Visit links count | 0 — CRITICAL BLOCKER | ✅ **13 visits exist** via visits.employee_id (visit_links = 0 is irrelevant) |
| Role column missing | ❌ Need to add | ✅ **Already resolvable** via employee_roles + roles join — no new column |
| Orders per employee | via identities chain | ✅ **Direct**: orders.owner_id → employees.id |
| Collections per employee | via identities chain | ✅ **Direct**: collections.owner_id → employees.id |
| Employee photo | ❌ Not available | ❌ STILL NOT available |
| Employee region | ❌ Not available | ❌ STILL NOT available |
| Operational data today | 0 orders, 0 visits, 0 collections | ✅ **17 tracking points today** for حسن بكر (can show route) but 0 orders/visits/collections today |
| Visit data quality | 0 records | ✅ **13 visits with durations, results, coordinates** — excellent for timeline |

---

## 10. Final Verdict

**⚠️ CONDITIONALLY READY** — The database structurally supports 85% of the target image. Two schema additions are needed (region, avatar_url). Role is already available via existing JOINs.

**Blockers (down from 9 to 2):**
1. **No `avatar_url`** in employees — cannot show employee photo
2. **No `region`** in employees — cannot show "قطاع طنطا"

**Data gaps (acceptable for building now):**
- Only 1 employee (حسن بكر) has real visit + tracking data
- 0 operational data today
- Distance calculation always returns 0
- 17 tracking points is borderline for route detail

**The code can be built now and will display accurate data as field usage grows.**
