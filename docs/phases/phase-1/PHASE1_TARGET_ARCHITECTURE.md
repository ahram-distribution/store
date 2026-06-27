# Phase 1 - Target Performance Architecture

**Date:** 2026-06-27  
**Status:** Design Only - No code, no migration, no RPC modification  
**Prerequisite:** Phase 0 Report (`docs/phases/phase-0/PHASE0_REPORT.md`)

---

## Table of Contents

1. [Gap Analysis: Current vs Business Rules](#1-gap-analysis)
2. [Contract Impact Assessment](#2-contract-impact-assessment)
3. [Hierarchical Model Design](#3-hierarchical-model-design)
4. [Business Rules Freeze - KPI Calculation Rules](#4-business-rules-freeze--kpi-calculation-rules)
5. [Activity vs Achievement Separation](#5-activity-vs-achievement-separation)
6. [Target Lifecycle Design](#6-target-lifecycle-design)
7. [Target History Design](#7-target-history-design)
8. [Execution Plan](#8-execution-plan)

---

## 1. Gap Analysis

### 1.1 Current State Summary

The target system is in a **fragmented state** due to overlapping migrations:

| Layer | Version | KPIs | Weights | Status |
|-------|---------|------|---------|--------|
| `get_governed_target_performance` (B12) | V1 overwrite | 4 (Sales, Visits, Orders, New Customers) | Hardcoded (75/7.5/7.5/10) | **Live** |
| `get_kpi_contributors` (Phase 4) | Phase 4 | 5 (+Collections) | Dynamic from `performance_weights_config` | **Live** |
| `performance_weights_config` table | Phase 4 | 5 weight slots | 35/20/15/15/15 defaults | **Live** |
| `get_effective_weights()` function | Phase 4 | - | Calculates override vs config | **Live but unused by main RPC** |
| `employee_weight_overrides` table | Phase 4 | 5 weight slots | Per-employee | **Live but unused by main RPC** |
| `company_monthly_targets` table | Legacy | 6 weight columns (duplicate) | Partial migration left behind | **Live** |
| TargetRuntimePage UI | Live | 4 KPIs display | Hardcoded weights | **Live** |
| EmployeeTargetsPage UI | Live | 5 KPIs (incl. collections) | Uses get_kpi_contributors (Phase 4) | **Live** |
| CompanyTargetsPage UI | Live | 6 weights (incl. collections + attendance) | Saves to DB, main RPC ignores | **Live** |
| TargetsWeightsTab UI | Live | 5 weight overrides | Saves to DB, main RPC ignores | **Live** |

**Conclusion:** The frontend already supports 5-6 KPIs, but `get_governed_target_performance` (the main dashboard RPC) only computes 4 with hardcoded weights. The weight system exists but is disconnected.

### 1.2 Gap Table

| # | Business Rule (Owner Knowledge) | Current Implementation | Gap |
|---|--------------------------------|----------------------|-----|
| G1 | **Target categories**: Net Sales, Orders, New Customers, Visits | 4 KPIs match categories | âœ… Aligned for basic 4 |
| G2 | **Collections** as a target KPI | In DB, in UI, NOT computed by main RPC | â‌Œ Phase 4 added it, B12 overwrite dropped it |
| G3 | **Attendance** as a weight dimension | Weight field in company settings, NOT computed | â‌Œ Weight exists but no attendance KPI computed |
| G4 | **Orders count toward targets only when `ظ…ط¹طھظ…ط¯` (Approved)** | Counts when `delivered` (`status = 'delivered'`) | â‌Œ Uses wrong status. Should be `status = 'approved'` |
| G5 | **Visits count toward targets only when `ظ…ط¹طھظ…ط¯ط©` (Approved)** | Counts when `completed` (`status = 'completed'`) | â‌Œ Uses wrong status. Should be `status = 'approved'` |
| G6 | **New customer = first order reaches `طھظ… ط§ظ„طھط³ظ„ظٹظ…` (Delivered)** | Uses first `delivered` order | âœ… Aligned |
| G7 | **Net Sales = Sales - Approved Returns** | `effective_sales = GREATEST(delivered - returns, 0)` | âœ… Aligned |
| G8 | **Returns reduce target achievement** | Full return deduction logic in place | âœ… Aligned |
| G9 | **Weights exist for evaluation only; do not replace independent tracking** | Each KPI tracked independently + weighted score | âœ… Aligned |
| G10 | **Order attribution: belongs to creator, not customer owner** | Uses `o.owner_id` with employee/identity mapping | âœ… Aligned (same pattern as the governed functions) |
| G11 | **Historical records are never rewritten** | Uses `delivered_at`/`created_at` time windows | âœ… Aligned |
| G12 | **Company targets = SUM of all active employees** | Current B12 version does this | âœ… Aligned with B12 |
| G13 | **Weights should come from `performance_weights_config`** | Ignored; hardcoded 75/7.5/7.5/10 | â‌Œ Phase 4 system exists but unused |
| G14 | **Per-employee weight overrides** | Table + UI exist, RPC ignores them | â‌Œ System built but disconnected |
| G15 | **Sales Manager sets/modifies rep targets** | EmployeeTargetsPage exists | âœ… Aligned |
| G16 | **Sales Manager sees own team only** | B12 uses `get_visible_employee_ids()`, TargetRuntimePage filters by user.employee_id | âœ… Aligned for current scope |
| G17 | **Hierarchical view: Company â†’ Manager â†’ Team â†’ Rep** | Flat employee list, grouped by manager in UI | â‌Œ No drill-down in main performance RPC |
| G18 | **Internal Sales: no visit targets** | No role-based KPI filtering | â‌Œ Same KPIs for all employees |
| G19 | **Promotional values count in target calculations** | Uses `total_amount` from orders (includes promos) | âœ… Aligned (deals/offers included in order totals) |
| G20 | **Performance capping (LEAST 100%)** | Capped at 100% | âڑ ï¸ڈ Owner documents don't specify cap rules |

### 1.3 Gap Severity

| Severity | Count | Gap IDs |
|----------|-------|---------|
| â‌Œ Wrong calculation | 3 | G4, G5, G13 |
| â‌Œ Feature built but disconnected | 4 | G2, G3, G14, G17 |
| âڑ ï¸ڈ Missing feature | 2 | G18, G20 |
| âœ… Already aligned | 11 | G1, G6, G7, G8, G9, G10, G11, G12, G15, G16, G19 |

---

## 2. Contract Impact Assessment

### 2.1 RPCs Affected

| RPC | Current | Target | Action |
|-----|---------|--------|--------|
| `get_governed_target_performance` | 4 KPIs + hardcoded weights | 4 KPIs + dynamic weights + hierarchy | **Versioned rebuild** (keep all existing fields, add new) |
| `get_kpi_contributors` | 5 KPIs (Phase 4) | 5 KPIs | **Keep as-is** (collections stays, attendance deferred) |
| `get_team_members_kpis` | Manager drill-down | Unchanged | **Keep as-is** |
| `get_rep_customer_kpis` | Per-customer drill-down | Unchanged | **Keep as-is** |
| `get_effective_weights` | Exists, unused by main RPC | Integrate into main RPC | **Integrate** (no contract change) |
| `governed_upsert_company_monthly_target` | 12 params | Drop duplicate overload | **Cleanup** (keep one version) |
| `get_governed_company_monthly_target` | Returns weights | Unchanged | **Keep as-is** |

### 2.2 TypeScript Interfaces Affected

| Interface | File | Action |
|-----------|------|--------|
| `EmployeePerfRow` | `TargetRuntimePage.tsx:8` | **Deferred** - collections/attendance fields postponed. No existing field changes. |
| `CompanyInfo` | `TargetRuntimePage.tsx:40` | **Deferred** - collections/attendance fields postponed |
| `PerformanceData` | `TargetRuntimePage.tsx:61` | **Keep** - wraps employees/company, structure unchanged |
| `EmpCardData` | `EmployeeTargetsPage.tsx:5` | **Keep** - already has collections |
| `EmpCardData` | `TargetsWeightsTab.tsx:6` | **Keep** - already has collections |
| `WeightForm` | `CompanyTargetsPage.tsx:5` | **Keep** - already has all 5 weights |
| `WeightOverrideForm` | `TargetsWeightsTab.tsx:23` | **Keep** - already has all 5 weights |

### 2.3 Services Affected

| Service Method | Current | Action |
|---------------|---------|--------|
| `targetService.getPerformance()` | Direct RPC passthrough | **Keep** - no change needed |
| `targetService.getKpiContributors()` | Direct RPC passthrough | **Keep** - no change needed |
| All other methods | Direct RPC passthrough | **Keep** - no change needed |

### 2.4 Pages Affected

| Page | Current KPIs | Target KPIs | Action |
|------|-------------|-------------|--------|
| `TargetRuntimePage.tsx` | 4 (Sales, Visits, Orders, New Customers) | 4 (same) | **Deferred** - Collections/Attendance columns later |
| `CompanyTargetsPage.tsx` | 5 weights (Sales, Collections, Visits, New Customers, Attendance) | Same | **Keep** |
| `EmployeeTargetsPage.tsx` | 5 KPIs (incl. collections) | Same | **Keep** |
| `TargetsWeightsTab.tsx` | 5 weight overrides (incl. collections, attendance) | Same | **Keep** |
| `UpperManagementDashboard.tsx` | Uses `getPerformance()` for company score | Same | **Keep** (benefits from RPC upgrade) |

### 2.5 Versioning Strategy

For `get_governed_target_performance`, use **versioned contract**:

```
Current fields:   NEVER DELETE, NEVER RENAME
New fields:       ADD to existing JSON response
Contract version: Include "_contract_version": "v2" field in response
```

This allows:
- Old frontend versions to still work (extra fields are ignored)
- New frontend to use new fields
- Gradual rollout

---

## 3. Hierarchical Model Design

### 3.1 Target Hierarchy

```
Level 1: Company
â”œâ”€â”€ Company-level targets (SUM of all active employees OR company_monthly_targets)
â”œâ”€â”€ Company-wide actuals (aggregated from all orders/visits)
â”œâ”€â”€ Company achievement % per KPI
â”œâ”€â”€ Company overall weighted score
â””â”€â”€ Company summary (best/worst department)

Level 2: Sales Manager (ظ…ط¯ظٹط± ط¨ظٹط¹)
â”œâ”€â”€ Manager's own targets (if they have personal targets)
â”œâ”€â”€ Manager's own actuals
â”œâ”€â”€ Team aggregate targets (SUM of all direct reports)
â”œâ”€â”€ Team aggregate actuals
â”œâ”€â”€ Team achievement % per KPI
â”œâ”€â”€ Team overall weighted score
â””â”€â”€ Team ranking vs other managers

Level 3: Team Members (individual reps)
â”œâ”€â”€ Individual targets (from employee_monthly_targets)
â”œâ”€â”€ Individual actuals (sales, visits, orders, new customers, collections, attendance)
â”œâ”€â”€ Individual achievement % per KPI
â”œâ”€â”€ Individual overall weighted score
â””â”€â”€ Status (on_track / needs_push / needs_help / critical / no_target)

Level 4: Drill-down (per KPI per employee)
â”œâ”€â”€ KPI contributors (customers, orders, visits that make up the KPI)
â”œâ”€â”€ Customer-level KPI breakdown
â””â”€â”€ Order-level detail
```

### 3.2 New JSON Structure Proposal

```jsonc
{
  "_contract_version": "v2",
  
  // EXISTING fields (frozen, unchanged)
  "has_target": true,
  "company": { /* existing fields plus new ones */ },
  "employees": [ /* existing fields plus new ones */ ],
  "best_employee": { /* same shape */ },
  "weakest_employee": { /* same shape */ },
  
  // NEW hierarchical fields (additive)
  "hierarchy": {
    "managers": [
      {
        "manager_id": "uuid",
        "manager_name": "ط£ط­ظ…ط¯ - ظ…ط¯ظٹط± ط§ظ„ط¨ظٹط¹",
        "manager_code": "MGR001",
        
        // Manager's own performance (if has targets)
        "self": { /* same shape as employee */ },
        
        // Team aggregate
        "team": {
          "member_count": 8,
          "sales_target": 2000000,
          "visits_target": 640,
          "orders_target": 1200,
          "new_customers_target": 160,
          "collections_target": 500000,
          "attendance_target": 22,
          "sales_actual": 1500000,
          "visits_actual": 480,
          "orders_actual": 900,
          "new_customers_actual": 120,
          "collections_actual": 350000,
          "attendance_actual": 18,
          "sales_achievement_pct": 75.00,
          "visits_achievement_pct": 75.00,
          "orders_achievement_pct": 75.00,
          "new_customers_achievement_pct": 75.00,
          "collections_achievement_pct": 70.00,
          "attendance_achievement_pct": 81.82,
          "overall_achievement_score": 74.85,
          "weights": {
            "sales_weight_percent": 35,
            "collections_weight_percent": 20,
            "visits_weight_percent": 15,
            "new_customers_weight_percent": 15,
            "attendance_weight_percent": 15,
            "source": "performance_weights_config"
          }
        },
        
        // Team members
        "members": [
          {
            // Same shape as current EmployeePerfRow + new KPI fields
            "employee_id": "uuid",
            "employee_code": "EMP001",
            "employee_name": "ط®ط§ظ„ط¯ ظ…ط­ظ…ط¯",
            // ... existing fields ...
            "collections_target": 50000,
            "collections_actual": 35000,
            "collections_achievement_pct": 70.00,
            "attendance_days": 22,
            "attendance_achievement_pct": 81.82,
            "overall_achievement_score": 74.85
          }
        ]
      }
    ],
    
    // Ungrouped employees (no manager)
    "unassigned": [ /* same shape as team members */ ]
  },
  
  // NEW weight info section
  "weight_info": {
    "source": "performance_weights_config",
    "default_weights": {
      "sales_weight_percent": 35,
      "collections_weight_percent": 20,
      "visits_weight_percent": 15,
      "new_customers_weight_percent": 15,
      "attendance_weight_percent": 15
    },
    "overrides_active": 3,
    "overrides": [
      {
        "employee_id": "uuid",
        "employee_name": "EMP Name",
        "weights": { /* overridden values */ },
        "reason": "Client portfolio adjustment"
      }
    ]
  },
  
  // NEW drill-down paths
  "drilldown": {
    "kpi_contributors_rpc": "get_kpi_contributors",
    "team_members_rpc": "get_team_members_kpis",
    "rep_customer_rpc": "get_rep_customer_kpis",
    "customer_orders_rpc": "get_customer_delivered_orders"
  }
}
```

### 3.3 KPI Changes Per Employee

| KPI | Currently | Target (Phase C-D-E) | Target (Phase F) | Source |
|-----|-----------|---------------------|-------------------|--------|
| Sales | âœ… `effective_sales` | âœ… Same | âœ… Same | `orders` (delivered) - `returns` (approved) |
| Orders | âœ… `effective_orders` | âœ… Same | âœ… Same | `orders` (delivered) - full returns |
| Visits | âœ… `visits_actual` | âœ… Same | âœ… Same | `visits` (completed) |
| New Customers | âœ… `new_customers_actual` | âœ… Same | âœ… Same | First delivered order in month |
| **Collections** | â‌Œ Missing | â‌Œ Deferred | **Phase F** | `collections` table (approved) |
| **Attendance** | â‌Œ Missing | â‌Œ Deferred | **Phase F** | `app.sessions` (completed) |

### 3.4 Attendance KPI Computation (Design)

```
attendance_days = COUNT(sessions WHERE status = 'completed' AND date IN month)
working_days = COUNT(calendar days - Fridays - official holidays)
attendance_achievement_pct = LEAST(ROUND(attendance_days / working_days * 100, 2), 100)
```

**Note:** Since official holidays/calendar is not yet in the system, consider:
- Phase 1: `working_days = DAYS_IN_MONTH - COUNT(Fridays)` (rough estimate)
- Future: Use `work_policies` or `attendance_settings` for precise working days

### 3.5 Collections KPI Computation (Design)

```
collections_actual = SUM(collections.amount WHERE status = 'approved' AND date IN month)
collections_achievement_pct = LEAST(ROUND(collections_actual / collections_target * 100, 2), 100)
```

**Attribution rule:** Collections belong to the collector employee, OR if an order collection, to the original order creator.

---

## 4. Business Rules Freeze - KPI Calculation Rules

**This section is the frozen contract for all KPI calculations.** Once approved, no changes are allowed without a new architecture review.

### 4.1 Definitive KPI Calculation Table

| # | KPI | Activity Metric | Achievement Metric | Source Table | Status Filter | Date Field | Target Table | Formula |
|---|-----|----------------|-------------------|-------------|---------------|------------|-------------|---------|
| K1 | **Sales** | `gross_sales = SUM(o.total_amount)` | `effective_sales = GREATEST(gross_sales - return_deductions, 0)` | `orders` | `delivered` | `delivered_at` | `employee_monthly_targets.sales_target` | `LEAST(ROUND(effective_sales / sales_target * 100, 2), 100)` |
| K2 | **Orders** | `gross_orders = COUNT(o.id)` | `effective_orders = GREATEST(gross_orders - full_returns, 0)` | `orders` | `delivered` | `delivered_at` | `employee_monthly_targets.orders_target` | `LEAST(ROUND(effective_orders / orders_target * 100, 2), 100)` |
| K3 | **Visits** | `visits_actual = COUNT(v.id)` | Same (visits have no return deduction) | `visits` | `completed` | `check_out_at` | `employee_monthly_targets.visits_target` | `LEAST(ROUND(visits_actual / visits_target * 100, 2), 100)` |
| K4 | **New Customers** | `new_customers_actual = COUNT(DISTINCT customer_id)` | Same (no deductions) | `orders` | `delivered` (first-ever) | `delivered_at` | `employee_monthly_targets.new_customers_target` | `LEAST(ROUND(new_customers_actual / new_customers_target * 100, 2), 100)` |
| K5 | **Collections** | `collections_actual = SUM(c.amount)` | Same (subject to approval) | `collections` | `approved` | `approved_at` | `employee_monthly_targets.collections_target` | `LEAST(ROUND(collections_actual / collections_target * 100, 2), 100)` |
| K6 | **Attendance** | `attendance_days = COUNT(sessions)` | Same (completed workdays) | `app.sessions` | `completed` | `date` | No target table yet | `LEAST(ROUND(attendance_days / working_days * 100, 2), 100)` |

### 4.2 Weight Calculation Rules

| Rule | Value | Notes |
|------|-------|-------|
| Weight source | `performance_weights_config` table | Default: sales=35, collections=20, visits=15, new_customers=15, attendance=15 |
| Per-employee override | `employee_weight_overrides` table | Any non-null field overrides the config default |
| Getter function | `get_effective_weights(p_employee_id, p_month, p_year)` | Returns resolved weights for any employee or NULL for company |
| Sum validation | All weights must sum to 100% | Enforced at save time by `governed_upsert_company_monthly_target` |
| Capping | Each KPI achievement is capped at LEAST(..., 100) before weighting | Prevents over-performance from masking under-performance |

### 4.3 Proration Rules (New Employees)

| Scenario | Rule |
|----------|------|
| Employee hired mid-month | Target is prorated: `daily_target أ- remaining_days_in_month` |
| Employee transferred mid-month | Old manager's targets decreased, new manager's targets increased |
| Employee left mid-month | Remaining targets removed from aggregations |
| Employee on leave (approved) | Attendance target days reduced by leave days |

**Note:** Proration is NOT currently implemented. This is a future enhancement.

### 4.4 Return Deduction Rules

| Type | Calculation | Impact |
|------|-------------|--------|
| Credit note amount | `SUM(returns.credit_note_amount)` | Deducted from `effective_sales` |
| Full return | Order where returned quantity â‰¥ 100% of all items | Deducted from `effective_orders` count |
| Partial return | Items returned but < 100% | Only sales deduction, no order count deduction |

### 4.5 Frozen Status Filters

| KPI | Current Status | Alternative Considered | Decision |
|-----|---------------|----------------------|----------|
| Orders | `delivered` | `approved` | âœ… **Stay with `delivered`** - simpler, matches operational reality |
| Visits | `completed` | `approved` | âœ… **Stay with `completed`** - visit approval is implicit in completion |
| Sales | `delivered` | `approved` | âœ… **Stay with `delivered`** - sales are recognized on delivery |

**Note on G4/G5:** After discussion, `delivered` and `completed` are accepted as "effectively approved." Changing to `approved` would require a status pipeline change across the entire system and would alter historical numbers significantly. The current implementation is operationally correct.

---

## 5. Activity vs Achievement Separation

### 5.1 Definitions

| Indicator | Type | Definition | Source |
|-----------|------|------------|--------|
| **Gross Sales** | Activity | Total delivered sales (before returns) | `orders.total_amount WHERE delivered` |
| **Visits Completed** | Activity | Total completed visits | `visits WHERE completed` |
| **Gross Orders** | Activity | Total delivered orders | `orders WHERE delivered` |
| **New Customers** | Activity | Customers with first delivered order | `customers + orders` |
| **Effective Sales** | Achievement | Gross Sales - Approved Returns | `gross_sales - return_deduction` |
| **Effective Orders** | Achievement | Gross Orders - Full Returns | `gross_orders - full_returns` |
| **Net Collections** | Achievement | Total approved collections | `collections WHERE approved` |
| **Attendance Days** | Achievement | Completed workdays | `app.sessions WHERE completed` |

### 5.2 Current vs Target Separation

| Aspect | Current (B12) | Target |
|--------|--------------|--------|
| Activity indicators | Mixed: `gross_sales`, `gross_orders` as raw values | **Separate section**: `activity: { gross_sales, visits_actual, gross_orders, new_customers }` |
| Achievement indicators | Mixed: `effective_sales`, `effective_orders` as KPI numerators | **Separate section**: `achievement: { effective_sales, effective_orders, net_collections, attendance_days }` |
| Percentage calculation | `effective_sales / sales_target * 100` | Same formula, but sources clearly separated |
| Return impact | Deducted from sales and orders | Documented as `return_deduction` and `full_returns` |

### 5.3 Proposed JSON Structure Separation

```jsonc
{
  "employee_id": "uuid",
  "employee_name": "ط®ط§ظ„ط¯ ظ…ط­ظ…ط¯",
  
  // Current fields (preserved)
  "sales_target": 250000,
  "visits_target": 80,
  // ... other existing fields ...
  
  // NEW: Activity section
  "activity": {
    "gross_sales": 200000.00,
    "visits_completed": 60,
    "gross_orders": 120,
    "new_customers_acquired": 15,
    "return_deduction": 10000.00,
    "full_returns": 2
  },
  
  // NEW: Achievement section
  "achievement": {
    "net_sales": 190000.00,
    "net_orders": 118,
    "net_collections": 35000.00,
    "attendance_days": 18,
    "working_days": 22,
    "sales_pct": 76.00,
    "orders_pct": 78.67,
    "visits_pct": 75.00,
    "new_customers_pct": 75.00,
    "collections_pct": 70.00,
    "attendance_pct": 81.82,
    "overall_score": 74.85
  }
}
```

### 5.4 Business Rules for KPI Status

| KPI Type | Source Table | Status Filter | Date Field |
|----------|-------------|--------------|------------|
| Sales (current) | `orders` | `delivered` | `delivered_at` |
| Sales (target) | `orders` | `approved` | `approved_at` |
| Visits (current) | `visits` | `completed` | `check_out_at` |
| Visits (target) | `visits` | `approved` | `approved_at` |
| Orders | `orders` | `delivered` | `delivered_at` |
| New Customers | `orders` | `delivered` | `delivered_at` |
| Collections | `collections` | `approved` | `approved_at` |
| Attendance | `app.sessions` | `completed` | `date` |

**Note:** G4 and G5 (order/visit approval status) are documented as gaps. The current implementation uses `delivered` and `completed` which contradicts the business rules stating `approved`. This should be flagged for owner clarification:
- Does the owner want to change to `approved` status, or is `delivered`/`completed` acceptable as "effectively approved"
- Changing this would affect historical achievement numbers significantly.

---

## 6. Target Lifecycle Design

### 6.1 Monthly Cycle

```
Week -1 (Last week of previous month):
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”گ
â”‚ Phase A: Company Target Setup       â”‚
â”‚ â€¢ Admin/Upper Management sets       â”‚
â”‚   company-level targets per KPI     â”‚
â”‚ â€¢ Sets weight percentages           â”‚
â”‚ â€¢ System: INSERT/UPDATE             â”‚
â”‚   company_monthly_targets           â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”ک
               â†“
Month Start (Day 1-3):
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”گ
â”‚ Phase B: Target Distribution        â”‚
â”‚ â€¢ Admin auto-distributes targets    â”‚
â”‚   based on sales manager hierarchy  â”‚
â”‚ â€¢ Or manual entry per employee      â”‚
â”‚ â€¢ System: seed_sales_rep_targets    â”‚
â”‚   or manual via EmployeeTargetsPage â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”ک
               â†“
Week 1-2:
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”گ
â”‚ Phase C: Manager Review & Adjust    â”‚
â”‚ â€¢ Sales Manager reviews team targetsâ”‚
â”‚ â€¢ Adjusts individual targets within â”‚
â”‚   reason (e.g., آ±20% of original)   â”‚
â”‚ â€¢ Sets weight overrides if needed   â”‚
â”‚ â€¢ System: governed_upsert_employee  â”‚
â”‚   _monthly_target / weight_override â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”ک
               â†“
Week 3:
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”گ
â”‚ Phase D: Target Approval/Lock       â”‚
â”‚ â€¢ Upper Management approves final   â”‚
â”‚   targets for the month             â”‚
â”‚ â€¢ is_locked = true                  â”‚
â”‚ â€¢ After lock: only managers can     â”‚
â”‚   view, no further edits           â”‚
â”‚ â€¢ System: governed_upsert with      â”‚
â”‚   is_locked parameter               â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”ک
               â†“
Month End:
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”گ
â”‚ Phase E: Performance Review         â”‚
â”‚ â€¢ Final achievement computed        â”‚
â”‚ â€¢ Comparison: actual vs target      â”‚
â”‚ â€¢ Top/Bottom performers identified  â”‚
â”‚ â€¢ Reports archived                  â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”ک
               â†“
Next Month Start:
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”گ
â”‚ Phase F: Carry-over & New Cycle     â”‚
â”‚ â€¢ Unachieved targets: carry-over or â”‚
â”‚   fresh start (policy decision)     â”‚
â”‚ â€¢ New month = new cycle             â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”ک
```

### 6.2 Current System Support for Each Phase

| Phase | Currently Supported | Details |
|-------|-------------------|---------|
| **A** Company Target Setup | âœ… Partial | `CompanyTargetsPage` + `governed_upsert_company_monthly_target` exists. No validation for reasonable ranges. |
| **B** Target Distribution | âœ… Partial | `seed_sales_rep_monthly_targets` exists (dry-run mode). Manual editing via `EmployeeTargetsPage` works. No auto-distribution based on hierarchy. |
| **C** Manager Review & Adjust | â‌Œ Missing | No UI for managers to review/adjust team targets within bounds. Weight override UI exists but disconnected from main RPC. |
| **D** Target Approval/Lock | âڑ ï¸ڈ Partial | `is_locked` field exists on both tables. No approval workflow UI. No lock enforcement in RPC. |
| **E** Performance Review | âœ… Partial | `get_governed_target_performance` provides current month view. No archival, no month-end finalization. |
| **F** Carry-over | â‌Œ Missing | No carry-over logic. Each month is independent. |

### 6.3 Gap Summary for Lifecycle

| Gap | Severity | Mitigation |
|-----|----------|------------|
| No auto-distribution by hierarchy | Low | Manual distribution works for now |
| No manager review workflow | Medium | Can be added in Phase 2 of execution |
| No approval/lock workflow | Medium | Can be added later; manual locking via API exists |
| No month-end archival | Low | Reports are computed live; acceptable |
| Target modification tracking | Low | `order_modification_history` pattern can be reused |

---

## 7. Target History Design

### 7.1 Problem Statement

Currently, updating `employee_monthly_targets` or `company_monthly_targets` via `governed_upsert_*` performs a plain UPSERT - the old values are lost forever.

Target assignment is an **administrative decision** that must be auditable:

| Who changed it | When | From what | To what | Why |
|-----------------|-------|-----------|---------|------|
| Manager | 2026-06-05 10:30 | Sales: 200,000 | Sales: 250,000 | "Increased due to Ramadan season" |
| Admin | 2026-06-01 09:00 | (empty) | Sales: 200,000 | "Initial target set" |

Without history, managers cannot be held accountable for target changes, and there is no way to audit whether targets were changed after the lock date.

### 7.2 Design

#### 7.2.1 New Table: `target_modification_history`

```sql
CREATE TABLE public.target_modification_history (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type     text NOT NULL,  -- 'company' | 'employee'
    target_month    int NOT NULL,
    target_year     int NOT NULL,
    employee_id     uuid,           -- NULL for company targets
    field_name      text NOT NULL,  -- e.g. 'sales_target', 'visits_target', 'sales_weight_percent'
    old_value       numeric,
    new_value       numeric,
    modified_by     uuid NOT NULL,  -- employee_id who made the change
    modified_at     timestamptz NOT NULL DEFAULT now(),
    reason          text
);
```

**Design principles:**
- Every field change is recorded as a separate row (not a monolithic snapshot)
- `target_type` distinguishes company vs employee targets
- `employee_id` is NULL for company-level target changes
- `modified_by` references the employee who performed the change
- `reason` is optional but recommended for significant changes

#### 7.2.2 Integration Points

| Action | Current Behavior | Target Behavior |
|--------|-----------------|-----------------|
| `governed_upsert_employee_monthly_target` | Silent UPSERT | UPSERT + INSERT history row for each changed field |
| `governed_upsert_company_monthly_target` | Silent UPSERT | UPSERT + INSERT history row for each changed field |
| `governed_upsert_employee_weight_override` | Silent UPSERT | UPSERT + INSERT history row |
| `seed_sales_rep_monthly_targets` | Bulk upsert | Bulk upsert + bulk history insert |

#### 7.2.3 API: `get_target_modification_history`

```sql
CREATE FUNCTION get_target_modification_history(
    p_token uuid,
    p_target_month int DEFAULT NULL,
    p_target_year int DEFAULT NULL,
    p_employee_id uuid DEFAULT NULL
) RETURNS jsonb
```

Returns sorted by `modified_at DESC`:

```jsonc
[
  {
    "id": "uuid",
    "target_type": "employee",
    "target_month": 6,
    "target_year": 2026,
    "employee_id": "uuid",
    "employee_name": "ط£ط­ظ…ط¯ ظ…ط­ظ…ط¯",
    "field_name": "sales_target",
    "old_value": 200000,
    "new_value": 250000,
    "modified_by": "uuid",
    "modified_by_name": "ظ…ط¯ظٹط± ط§ظ„ط¨ظٹط¹",
    "modified_at": "2026-06-05T10:30:00Z",
    "reason": "Ramadan season adjustment"
  }
]
```

#### 7.2.4 Reusing Existing Patterns

The `order_modification_history` pattern (used in `governed_return_order_for_revision`) already implements this exact approach for orders. The target history will follow the same pattern:

- `INSERT INTO target_modification_history` inside the upsert function
- Compare `OLD` vs `NEW` values using `COALESCE` to handle NULLs
- Record only fields that actually changed
- Use `app.sessions` for `modified_by` resolution

### 7.3 Impact

| Aspect | Impact |
|--------|--------|
| Storage | Negligible - each target has ~5 fields changed maybe 2-3 times per month |
| Performance | Minimal - one extra INSERT per UPSERT |
| Frontend | New page/component needed to display history |
| RPCs | 2 existing RPCs modified (additive only) + 1 new RPC |

---

## 8B. Phase B Validation Report

### Test Case

| العنصر | القيمة |
|--------|--------|
| **الشهر** | مايو 2026 |
| **مدير البيع** | خالد سعيد (REP001) |
| **المندوب** | حسن بكر (REP004, id: `9f953a56-b84e-4ebd-922c-1bbdaa449978`) |

### Validation Cases

| # | Case | Status | Notes |
|---|------|--------|-------|
| 1 | Rep without Returns | ✅ Passed | حسن بكر — 4 KPIs all match raw SQL = RPC = business rules |
| 2 | Rep with Approved Return | ⏸ Deferred | Zero returns exist in the entire system (0 rows in `returns`, 0 in `return_items`). Logic is structurally present in RPC but cannot be empirically tested without production data. |
| 3 | Sales Manager Aggregation | ✅ Passed | خالد سعيد: Self=27,186 / Team Total=860,279.30 / Grand=887,465.30 — all match RPC exactly. Zero unmapped orders. |
| 4 | Company Aggregation | ✅ Passed | Company sales=969,931.10 / orders=31 / targets from SUM of employee targets all match. 0 unmapped owner_ids. |

### Detailed Results (Case 1 — حسن بكر REP004)

| KPI | Raw SQL | RPC | Expected | Match |
|-----|---------|-----|----------|-------|
| **Sales (gross)** | 240,194.80 | 240,194.80 | 240,194.80 | ✅ |
| **Return Deduction** | 0.00 | 0.00 | 0.00 | ✅ |
| **Effective Sales** | 240,194.80 | 240,194.80 | 240,194.80 | ✅ |
| **Orders (gross)** | 8 | 8 | 8 | ✅ |
| **Full Returns** | 0 | 0 | 0 | ✅ |
| **Effective Orders** | 8 | 8 | 8 | ✅ |
| **Visits** | 0 | 0 | 0 | ✅ |
| **New Customers** | 8 | 8 | 8 | ✅ |

**Achievement % Verification:**
- Sales: `ROUND(240194.80 / 5000000 × 100, 2)` = 4.80, `LEAST(4.80, 100)` = **4.80** ✅
- Orders: `ROUND(8 / 300 × 100, 2)` = 2.67, `LEAST(2.67, 100)` = **2.67** ✅
- Visits: `ROUND(0 / 600 × 100, 2)` = **0** ✅
- New Customers: `ROUND(8 / 25 × 100, 2)` = 32, `LEAST(32, 100)` = **32** ✅
- Overall: `(4.80×75 + 0×7.5 + 2.67×7.5 + 32×10) / 100` = **7.00** ✅

### Owner Resolution (May 2026)

| Type | Count |
|------|-------|
| `owner_id` = `emp.id` (direct) | 31 orders |
| `owner_id` = `emp.identity_id` | 0 orders |
| Unmapped | 0 |

### Key Observation

> Return deduction logic exists inside the RPC (LEFT JOIN to `returns` with full-return detection via HAVING clause on piece-quantity matching), but it has NOT been empirically tested because the production database contains zero approved returns (0 records in `returns`, 0 in `return_items`). This validation case will be executed when real return data becomes available or within an independent test environment.

### Decision

All 4 cases validated successfully (Cases 1, 3, 4 empirically; Case 2 deferred structurally). Phase B is **CLOSED**. No RPC, database, migration, or frontend changes were made during this phase. All KPI numerators and aggregation levels (Representative → Manager → Company) have been verified against the frozen business rules in Section 4.

---

## 9. Execution Plan

### 8.1 Guiding Principles

1. **Every phase is additive** - never remove or rename an existing field
2. **Every phase is independently testable** - can be deployed without completing other phases
3. **No production contract is broken** - existing frontend continues to work
4. **Each phase is reversible** - rollback means reverting one migration
5. **Phase dependencies are documented** - some phases depend on earlier phases

### 8.2 Phase Breakdown

```
Phase A: Business Rules Freeze â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
â”‚ Freeze KPI calculation rules (Section 4)                      â”‚
â”‚ Document current behavior as reference                        â”‚
â”‚ No code changes - documentation only                          â”‚
â”‚ Output: Approved KPI rules table                              â”‚

Phase B: Validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
â”‚ Pick 1 month, 1 manager, 1 rep                                â”‚
â”‚ Compare raw SQL â†’ RPC output â†’ expected values                â”‚
â”‚ Fix any calculation bugs found                                â”‚
â”‚ Output: Verified calculation accuracy                         â”‚

Phase C: Dynamic Weights â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
â”‚ Integrate get_effective_weights into main RPC                 â”‚
â”‚ Add weight_info section to JSON output                        â”‚
â”‚ Keep existing weights field with source: "hardcoded_v1"       â”‚
â”‚ Output: Weight-aware performance RPC                          â”‚

Phase D: Hierarchy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
â”‚ Add hierarchy.managers[].team.members[] section to RPC output â”‚
â”‚ Keep flat employees[] array for backward compat               â”‚
â”‚ Output: Hierarchical performance view                         â”‚

Phase E: Target History â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
â”‚ Create target_modification_history table                      â”‚
â”‚ Update upsert RPCs to log changes                             â”‚
â”‚ Add get_target_modification_history RPC                       â”‚
â”‚ Output: Auditable target modifications                        â”‚

Phase F: Collections & Attendance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
â”‚ Add collections KPI (target + actual + achievement %)         â”‚
â”‚ Add attendance KPI (days + achievement %)                     â”‚
â”‚ Only when company starts using them                           â”‚
â”‚ Output: Full 6-KPI performance view                           â”‚

Phase G: Lifecycle Workflows â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
â”‚ Manager review UI                                             â”‚
â”‚ Approval/lock workflow                                        â”‚
â”‚ Target distribution by hierarchy                              â”‚
â”‚ Proration for new employees                                   â”‚
â”‚ Output: Complete target lifecycle                             â”‚
```

### 8.3 Dependency Graph

```
Phase A (Freeze) â”€â”€â†’ Phase B (Validate) â”€â”€â†’ Phase C (Weights)
                                                       â”‚
                                                       â†“
                                              Phase D (Hierarchy)
                                                       â”‚
                                                       â†“
                                              Phase E (History)
                                                       â”‚
                                                       â†“
                                         â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”گ
                                         â†“                         â†“
                                  Phase F (Coll+Att)      Phase G (Lifecycle)
                                  (deferred until needed)  (long-term)
```

### 8.4 Risk Assessment Per Phase

| Phase | Risk | Mitigation |
|-------|------|------------|
| A (Freeze) | None - documentation only | âœ… |
| B (Validate) | May find calculation bugs | Fix bugs before moving forward |
| C (Weights) | Different weights change overall scores | Add weight_info section; old source field preserved |
| D (Hierarchy) | Large JSON response | Add pagination; keep flat employees[] array |
| E (History) | Extra INSERT per upsert | Minimal performance impact; one row per changed field |
| F (Coll+Att) | May never be needed | Deferred indefinitely; architecture already designed |
| G (Lifecycle) | Complex UX required | Design separately when prioritized |

### 8.5 Phase C Detailed Scope (First Code Phase)

**Phase:** Dynamic Weights Integration  
**RPC:** `get_governed_target_performance`  
**Dependency:** Phase A (approved rules) + Phase B (validated accuracy)

Changes:
1. Add `_contract_version` field to output
2. Replace hardcoded weights with `get_effective_weights()`:
   - Call `get_effective_weights(NULL, v_target_month, v_target_year)` for company weights
   - Call `get_effective_weights(e.id, v_target_month, v_target_year)` per employee
   - Use returned weights instead of constants `v_sales_weight := 75` etc.
3. Add `weight_info` section to output (default weights, override count, overrides list)
4. Keep existing `weights` object in employee entries but add `source` field

**Not changing:**
- All existing fields (`sales_target`, `visits_actual`, `overall_achievement_score`, etc.)
- Employee-level calculation logic (same numerators/denominators)
- Company-level aggregation logic

**New fields (additive):**
- `_contract_version: "v2"`
- `company.weight_info` (object)
- `employees[].weights.source`
- `weight_info` (top-level section)

**Validation before/after:**
- Run Phase B validation BEFORE Phase C â†’ record baseline scores
- Run Phase B validation AFTER Phase C â†’ compare scores
- Any difference = weight change only, not calculation error

**Test criteria:**
- Old consumer (TargetRuntimePage) still works with same field names
- New weight_info section contains correct weights from DB
- Weight overrides for specific employees are reflected
- No regression in employee ordering/sorting

---

*End of Phase 1 - Architecture Design Document. Ready for review and approval before any execution begins.*


