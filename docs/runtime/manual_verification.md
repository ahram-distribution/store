# Manual Verification — RPC vs Raw Data Trace

**Date:** 2026-06-30
**Scope:** Source-code analysis of each KPI's data derivation chain
**Note:** Full verification requires live DB queries. This doc traces the SQL logic from source code.

---

## 1. Orders — Sales KPIs

### KPI: Effective Sales (used by targets/achievement)

**RPC:** `get_governed_target_performance`

**Trace:**
```
orders (status='delivered', delivered_at IN month)
  → LEFT JOIN employees ON owner_id = emp.id OR owner_id = emp.identity_id
  → SUM(total_amount) = gross_sales

returns (status='approved', created_at IN month)
  → JOIN return_items + products
  → SUM(credit_note_amount) = return_deduction
  → Full return detection: SUM(pieces) >= order total_pieces

effective_sales = GREATEST(gross_sales - return_deduction, 0)
```

**Verified from code:** ✅ Logic is correct. Uses `delivered` status, applies return deductions, caps at 0.

**RPC:** `get_completed_workdays_history`

**Trace:**
```
orders (status NOT IN ('draft','cancelled'))
  → JOIN by created_by (identity_id) + submitted_at::date = session date
  → SUM(total_amount) = sales_value per session/day
```

**Verified from code:** ⚠️ Uses `submitted_at::date` not `delivered_at`. Different definition from target RPC (all non-draft/cancelled orders vs delivered only).

### KPI: Effective Orders

**RPC:** `get_governed_target_performance`

**Trace:**
```
gross_orders = COUNT(DISTINCT order_id) where status='delivered' IN month
full_returns = COUNT(DISTINCT order_id) where returned pieces >= total pieces
effective_orders = GREATEST(gross_orders - full_returns, 0)
```

**Verified from code:** ✅ Logic correct.

---

## 2. Visits

### KPI: Completed Visits

**RPC:** `get_governed_target_performance`
```
visits WHERE status='completed' AND check_out_at IN month
GROUP BY employee_id → COUNT(*) = visits_actual
```

**Verified from code:** ✅ Straight count of completed visits.

---

## 3. Customers

### KPI: New Customers (First Delivery)

**RPC:** `get_governed_target_performance`
```
employee_orders (delivered orders)
  → For each customer, find MIN(delivered_at)
  → COUNT(DISTINCT customer_id) where their first delivery falls in month
```

**Verified from code:** ✅ Correct definition (first delivery = new customer).

**RPC:** `get_completed_workdays_history`
```
customers WHERE owner_id = employee_id AND created_at::date = session date
  → COUNT(*) = new_customer_count per day
```

**Verified from code:** ⚠️ Uses `created_at` of customer record, not first delivery. Different definition.

---

## 4. Collections

### KPI: Collection Amount

**RPC:** `get_governed_target_performance`
```
collections WHERE created_at IN month
  → resolve_employee_id(owner_id)
  → SUM(amount) regardless of status
```

**Verified from code:** ⚠️ No status filter — includes uncollected amounts.

**RPC:** `get_completed_workdays_history`
```
collections WHERE collected_at::date = session date
  → SUM(amount) FILTER(WHERE status='collected') = collected_amount
  → COUNT(*) regardless of status = collection_count
```

**Verified from code:** ✅ Properly separates count (all) from amount (collected only).

---

## 5. Attendance KPIs

### KPI: Working Hours (Net Minutes)

**RPC:** `get_completed_workdays_history`
```
duration = GREATEST(0, EPOCH(end_time - start_time) / 60)
net_minutes = GREATEST(duration - (CASE fixed_shift THEN break_minutes ELSE 0), 0)
```

**Verified from code:** ✅ Schedule-aware calculation.

### KPI: Active Days

**RPC:** `get_completed_workdays_history`
```
COUNT(*) of workday_sessions WHERE status='completed' AND date IN range
```

**Verified from code:** ✅ Simple count of completed session days.

---

## 6. Achievement KPIs

### KPI: Overall Achievement Score

**RPC:** `get_governed_target_performance`
```
Per KPI: LEAST((actual / target) * 100, 100)
Overall = Σ(kpi_achievement_pct * weight / 100)
Weights from get_effective_weights() per employee
```

**Verified from code:** ✅ Correct weighted average with individual weights. Capped at 100%.

---

## 7. Missing Runtime RPCs

The following are called from frontend but have NO definition in any migration file:

| RPC | Used By | What it should do (from context) |
|-----|---------|--------------------------------|
| `get_runtime_activity` | ActivityScreen, SalesRepActivity | Per-employee activity KPIs (sales, orders, visits, customers) |
| `get_runtime_team_activity` | UpperManagementDashboard, ActivityScreen | Team-level activity KPIs aggregated |
| `get_runtime_achievement_with_targets` | SalesRepAchievement | Achievement with target data per employee |
| `get_runtime_team` | TeamAchievement | Team-level achievement data |

**Impact:** These 4 RPCs form the current runtime layer used by the dashboard screens. Without definitions, their logic cannot be verified.

---

## 8. Summary of Data Source Differences

| KPI | Target RPC (get_governed_target_performance) | Activity RPC (get_completed_workdays_history) | Match? |
|-----|----------------------------------------------|----------------------------------------------|--------|
| Sales | Delivered only, after return deductions | All non-draft/cancelled, no return deductions | ❌ Differs |
| Orders | Delivered only, after full-return deductions | All non-draft/cancelled | ❌ Differs |
| New Customers | First delivery date | Customer creation date | ❌ Differs |
| Collections | All collections (any status) | Amount only when status='collected' | ❌ Differs |
| Activity days | Not calculated | Based on completed sessions | N/A |
| Targets | company_monthly_targets | Prorated employee_monthly_targets | ❌ Differs |
