# Phase C Design — Dynamic Weights Integration

**Status:** Design — Approved
**Weight Model Decision:** Design A (Separate Columns) — see PHASE_C_WEIGHT_MODEL.md
**Prerequisite:** Phase A (Business Rules Freeze) + Phase B (Validation) — both closed.
**Phase C1 (Infrastructure):** Completed — migration file `20261201_phase_c1_dynamic_weights.sql` ready for deployment.
**Phase C2 (Business Weights):** Pending — owner to determine final weight values.

---

## 1. Objective

Replace the hardcoded weights block inside `get_governed_target_performance` with a call to `get_effective_weights(p_employee_id, p_target_month, p_target_year)`, so that:
- Weight values come from `performance_weights_config` (year-level defaults)
- Per-employee overrides from `employee_weight_overrides` are respected
- The `source` field correctly reflects where the weights came from

---

## 2. What Changes (and What Does Not)

### 2.1 RPC Changes (single function only)

**File:** `get_governed_target_performance` (currently in `20261003_b12_include_all_active_employees.sql`)

**Current code (hardcoded, lines ~14-17):**
```sql
v_sales_weight numeric := 75;
v_visits_weight numeric := 7.5;
v_orders_weight numeric := 7.5;
v_new_customers_weight numeric := 10;
```

**Becomes:**
```sql
-- Resolved weights per employee (computed inline in the employee CTE)
-- via: get_effective_weights(ec.employee_id, v_target_month, v_target_year)
```

Each employee row calls `get_effective_weights` once and destructures the result into individual weight variables/fields.

### 2.2 JSON Output Changes

**`weights` object inside each employee record** — currently:

```json
"weights": {
  "sales_weight_percent": 75,
  "visits_weight_percent": 7.5,
  "orders_weight_percent": 7.5,
  "new_customers_weight_percent": 10,
  "source": "hardcoded_v1"
}
```

**Changes to:**
```json
"weights": {
  "sales_weight_percent": 35,
  "visits_weight_percent": 15,
  "orders_weight_percent": <to be determined>,
  "new_customers_weight_percent": 15,
  "collections_weight_percent": 20,
  "attendance_weight_percent": 15,
  "source": "config" | "override" | "default"
}
```

| Change | Detail |
|--------|--------|
| `source` | `"hardcoded_v1"` → `"config"` / `"override"` / `"default"` |
| `collections_weight_percent` | **NEW** — added to weights object (value 20 from config) |
| `attendance_weight_percent` | **NEW** — added to weights object (value 15 from config) |
| Numeric values | Change from 75/7.5/7.5/10 to config values (35/15/15/15, plus orders) |

### 2.3 All Existing Fields UNCHANGED

The following fields in every employee JSON record remain **identical** in name, type, and position:

```
employee_id, employee_code, employee_name,
sales_target, visits_target, orders_target, new_customers_target,
gross_sales, visits_actual, gross_orders, new_customers_actual,
return_deduction, full_returns,
effective_sales, effective_orders,
has_target, has_activity,
sales_achievement_pct, visits_achievement_pct,
orders_achievement_pct, new_customers_achievement_pct,
overall_achievement_score,
is_locked
```

Same for `company` section:

```
sales_target, visits_target, orders_target, new_customers_target,
sales_actual, visits_actual, orders_actual, new_customers_actual,
return_deductions, full_returns,
sales_weight_percent, visits_weight_percent,
orders_weight_percent, new_customers_weight_percent,
sales_achievement_pct, visits_achievement_pct,
orders_achievement_pct, new_customers_achievement_pct,
overall_achievement_pct
```

**Note:** The `company` section currently has flattened weight fields. These must remain unchanged in Phase C. Dynamic weights at company level will be addressed in Phase D (Hierarchy).

### 2.4 Contract Preservation

- **No field is removed.**
- **No field is renamed.**
- **No field changes type.**
- **No new top-level fields are added to the employee or company JSON objects.**
- The only addition is inside the nested `weights` object: `collections_weight_percent` and `attendance_weight_percent`.

A consumer that reads the flat fields (`emp.sales_target`, `emp.effective_sales`, etc.) will see **zero difference** in behavior.

---

## 3. The `orders_weight_percent` Gap

### The Problem

`get_effective_weights` returns 5 weights:
| Weight | Config Default |
|--------|---------------|
| `sales_weight_percent` | 35 |
| `collections_weight_percent` | 20 |
| `visits_weight_percent` | 15 |
| `new_customers_weight_percent` | 15 |
| `attendance_weight_percent` | 15 |
| **Total** | **100** |

But there is **no `orders_weight_percent`** in:
- `performance_weights_config` table (no such column)
- `employee_weight_overrides` table (no such column)
- `get_effective_weights` return value

The current KPI set has **Orders (K2)** active, while **Collections (K5)** and **Attendance (K6)** are deferred (Phase F).

### Resolution Options

| Option | Approach | Migration Required | Risk |
|--------|----------|-------------------|------|
| **A (Recommended)** | Add `orders_weight_percent` column to `performance_weights_config` and `employee_weight_overrides`, update `get_effective_weights` to return it | Small migration (ALTER TABLE ADD COLUMN + CREATE OR REPLACE FUNCTION) | None — orders has always been in the KPI set |
| **B** | Keep orders hardcoded at 7.5, use `get_effective_weights` only for the other 4 KPIs, normalize total to 100% | No migration | Fragmented: two weight sources; confusing to debug |
| **C** | Drop orders from the weighted score entirely (treat it as 0%) until Phase F | No migration | Breaking change to overall score; not acceptable |

**Recommendation: Option A** — Orders is an active KPI (K2 in Section 4.1) and must have a configurable weight. Adding the column to both tables and updating the function is a small, safe migration.

### Config Default for Orders

Once the column is added, the `performance_weights_config` data must be updated. Since the 5 existing weights sum to 100, and orders must be added alongside a weight shift:

| Phase | Sales | Collections | Visits | New Customers | Attendance | Orders | Total |
|-------|-------|-------------|--------|---------------|------------|--------|-------|
| Now (hardcoded) | 75 | — | 7.5 | 10 | — | 7.5 | 100 |
| Option A config | 35 | 20 | 15 | 15 | 15 | **0** (pending approval) | 100 |
| Proposed orders weight | 30 | 20 | 15 | 10 | 15 | **10** | 100 |

> **Note:** The exact `orders_weight_percent` initial value is an **open decision for owner approval** before execution.

---

## 4. Integration Approach (Step by Step)

### Step 1 — Add Column (Migration #1)

```sql
ALTER TABLE public.performance_weights_config
  ADD COLUMN orders_weight_percent numeric NOT NULL DEFAULT 10;

ALTER TABLE public.employee_weight_overrides
  ADD COLUMN orders_weight_percent numeric;
```

### Step 2 — Update Function (Migration #2)

Update `get_effective_weights` to include `orders_weight_percent` in both the override path and config path, with a hardcoded default.

### Step 3 — Update RPC (Migration #3)

In `get_governed_target_performance`:
1. Remove the 4 hardcoded `DECLARE` weight variables
2. Add `get_effective_weights()` call per employee in the `employee_calc` CTE
3. Replace all references to `v_sales_weight`, `v_visits_weight`, `v_orders_weight`, `v_new_customers_weight` with dynamic values from the function result
4. Replace the `weights` JSON construction with the full result from `get_effective_weights`
5. Company-level weights: keep current flattened fields unchanged (Phase D will address company aggregation hierarchy)

> **Note on Company Weights:** The `company` section currently uses the same hardcoded weights. For Phase C, we must decide: (a) keep hardcoded company weights temporarily, or (b) compute company weights from `performance_weights_config` directly (since `get_effective_weights` requires an employee_id). **Option (b)** is recommended — read from `performance_weights_config WHERE target_year = v_target_year` for the company section.

### Step 4 — Deploy
Standard deployment: `supabase db push` with all 3 changes in a single migration file.

---

## 5. Affected Consumers

### TypeScript Interface Changes

| File | Interface | Field | Impact |
|------|-----------|-------|--------|
| `src/pages/target-runtime/TargetRuntimePage.tsx` | `EmployeePerfRow` | `sales_weight_percent` etc. | ***No change*** — these fields are declared but never read from the `weights` object. The RPC response is cast as `any` via `as PerformanceData`. Runtime behavior is unaffected. |
| `src/pages/dashboard/PerformanceAnalysisPage.tsx` | `PerfEmployee` | `weights` object | ***No change*** — the `weights` object shape expands (adds 2 new fields). Existing code only reads `source` from weights. |

### No-Impact Consumers

The following pages read only the **flat fields** (targets, actuals, percentages) and are **completely unaffected** by the weights change:

| File | What it reads |
|------|--------------|
| `TargetRuntimePage.tsx` | `employee_name`, `employee_code`, `sales_target`, `effective_sales`, `orders_target`, `effective_orders`, `visits_target`, `visits_actual`, `new_customers_target`, `new_customers_actual`, `overall_achievement_score`, `has_target`, `has_activity` |
| `EmployeeProfilePage.tsx` | Same flat fields + `collections_target` |
| `CompanyTargetsPage.tsx` | `best_employee.*`, `overall_achievement_score`, `sales_weight_percent` (company level) |
| `ModuleLauncherPage.tsx` | `has_target`, `overall_achievement_score`, `has_activity` |
| `UpperManagementDashboard.tsx` | `company.sales_target`, `company.overall_achievement_pct` |
| `SalesManagerCCPage.tsx` | Flat fields only |
| `HistoricalPerformancePanel.tsx` | Flat fields only |

### Potentially Affected

| File | Risk | Mitigation |
|------|------|-----------|
| `PerformanceAnalysisPage.tsx` | Reads `weights.source` — changes from `"hardcoded_v1"` to `"config"`/`"override"`/`"default"`. Any code switching on this string value must handle the new values. | Review usage of `source` in this file before deployment. |
| `TargetRuntimePage.tsx` | Declares `sales_weight_percent` etc. as flat fields on `EmployeePerfRow` and `CompanyInfo`, but the RPC returns them nested under `weights`. Currently works because of `as PerformanceData` cast (TypeScript bypassed). No runtime impact. | Consider removing unused fields from interface for clarity (optional). |

---

## 6. Verification Plan (After Execution)

1. Run `get_governed_target_performance` for the same test case (May 2026, حسن بكر)
2. Confirm `weights.source` is `"config"` (since no override exists for this employee/month)
3. Confirm `weights.sales_weight_percent` = config value (not 75)
4. Confirm all flat fields identical to pre-change values
5. Confirm `overall_achievement_score` changes to reflect new weights
6. Run company-level check to confirm company weights read from config

---

## 7. Pre-Approval Checklist

| # | Item | Status |
|---|------|--------|
| 1 | Confirm `orders_weight_percent` should be added to `performance_weights_config` | ❓ Open |
| 2 | Confirm initial `orders_weight_percent` value | ❓ Open |
| 3 | Confirm company section weights approach (config direct or keep hardcoded) | ❓ Open |
| 4 | Review `PerformanceAnalysisPage.tsx` `weights.source` usage | ❓ Open |
| 5 | Approval to execute Phase C | ❓ Open |

---

## Appendix: Current vs Target JSON Comparison

### Current Employee `weights` Object
```json
{
  "sales_weight_percent": 75,
  "visits_weight_percent": 7.5,
  "orders_weight_percent": 7.5,
  "new_customers_weight_percent": 10,
  "source": "hardcoded_v1"
}
```

### Target Employee `weights` Object (Phase C)
```json
{
  "sales_weight_percent": 35,
  "visits_weight_percent": 15,
  "orders_weight_percent": 10,
  "new_customers_weight_percent": 15,
  "collections_weight_percent": 20,
  "attendance_weight_percent": 15,
  "source": "config"
}
```

**Note:** Actual numeric values depend on the `performance_weights_config` data and any employee-level overrides.
