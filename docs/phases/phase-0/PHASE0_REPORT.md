# Phase 0 Report — Production Inventory & Contract Freeze

**Date:** 2026-06-27  
**Project:** Store Management System  
**Scope:** All RPCs, Functions, and Contracts currently in Production

---

## Table of Contents

1. [Production RPC Inventory](#1-production-rpc-inventory)
2. [Contract Registry](#2-contract-registry)
3. [Function Classification](#3-function-classification)
4. [Dependency Map](#4-dependency-map)
5. [High Risk RPC List](#5-high-risk-rpc-list)
6. [Freeze Rules](#6-freeze-rules)

---

## 1. Production RPC Inventory

### Methodology

All RPCs called by the frontend via `supabase.rpc('...')`. Cross-referenced against the live database function list. Total **263 unique RPCs** consumed by frontend.

### Complete List (Alphabetical)

| # | RPC | Consumers | Return Type |
|---|-----|-----------|-------------|
| 1 | `batch_upsert_work_policies` | 1 (attendance.ts) | jsonb |
| 2 | `calculate_net_work_hours` | 1 (attendance.ts) | jsonb |
| 3 | `check_capability` | 2 | boolean |
| 4 | `check_session_timeout` | 1 | jsonb |
| 5 | `deactivate_employee_weight_override` | 1 (targets.ts) | jsonb |
| 6 | `end_break` | 1 (attendance.ts) | jsonb |
| 7 | `end_workday` | 1 (attendance.ts) | jsonb |
| 8 | `get_alerts` | 1 (attendance.ts) | jsonb |
| 9 | `get_all_capabilities` | 3 | jsonb |
| 10 | `get_attendance_analysis` | 1 | jsonb |
| 11 | `get_attendance_health` | 2 | jsonb |
| 12 | `get_auto_closed_sessions_month` | 1 | jsonb |
| 13 | `get_auto_closed_sessions_today` | 1 | jsonb |
| 14 | `get_collection_followup_queue` | 1 | jsonb |
| 15 | `get_collection_report` | 1 | jsonb |
| 16 | `get_command_center` | 1 | jsonb |
| 17 | `get_company_analytics` | 1 | jsonb |
| 18 | `get_company_products` | 1 | jsonb |
| 19 | `get_company_profile` | 5 | jsonb |
| 20 | `get_completed_workdays_history` | 1 | jsonb |
| 21 | `get_coverage_map` | 2 | jsonb |
| 22 | `get_credit_dashboard_stats` | 2 | jsonb |
| 23 | `get_customer_analytics_list` | 1 | jsonb |
| 24 | `get_customer_behavior_insights` | 1 | jsonb |
| 25 | `get_customer_brands` | 1 | jsonb |
| 26 | `get_customer_card` | 1 | jsonb |
| 27 | `get_customer_collections` | 1 | jsonb |
| 28 | `get_customer_companies_analysis` | 1 | jsonb |
| 29 | `get_customer_delivered_orders` | 1 (targets.ts) | jsonb |
| 30 | `get_customer_full_profile` | 1 | jsonb |
| 31 | `get_customer_intelligence_overview` | 1 | jsonb |
| 32 | `get_customer_orders` | 1 | jsonb |
| 33 | `get_customer_products` | 1 | jsonb |
| 34 | `get_customer_products_analysis` | 1 | jsonb |
| 35 | `get_customer_sales_ranking` | 1 | jsonb |
| 36 | `get_customer_visits` | 1 | jsonb |
| 37 | `get_customer_visits_analysis` | 1 | jsonb |
| 38 | `get_daily_target_vs_actual` | 1 | jsonb |
| 39 | `get_dashboard_management` | 5 | jsonb |
| 40 | `get_dashboard_sales` | 1 | jsonb |
| 41 | `get_dashboard_transport` | 1 | jsonb |
| 42 | `get_dashboard_warehouse` | 2 | jsonb |
| 43 | `get_employee_activity` | 1 | jsonb |
| 44 | `get_employee_capabilities` | 3 | jsonb |
| 45 | `get_employee_current_location` | 1 | jsonb |
| 46 | `get_employee_day_map` | 1 | jsonb |
| 47 | `get_employee_day_timeline` | 1 | jsonb |
| 48 | `get_employee_weight_overrides` | 1 (targets.ts) | jsonb |
| 49 | `get_employee_work_policy` | 1 | jsonb |
| 50 | `get_employee_workday_history` | 2 | jsonb |
| 51 | `get_governed_active_daily_deals` | 2 | jsonb |
| 52 | `get_governed_active_employees` | 1 (targets.ts) | jsonb |
| 53 | `get_governed_active_flash_offers` | 1 | jsonb |
| 54 | `get_governed_auction_detail` | 1 | jsonb |
| 55 | `get_governed_auctions` | 1 | jsonb |
| 56 | `get_governed_collections` | 2 | jsonb |
| 57 | `get_governed_companies` | 6 | jsonb |
| 58 | `get_governed_company_monthly_target` | 1 (targets.ts) | jsonb |
| 59 | `get_governed_credit_application` | 1 | jsonb |
| 60 | `get_governed_credit_applications` | 2 | jsonb |
| 61 | `get_governed_credit_dashboard` | 1 | jsonb |
| 62 | `get_governed_credit_invoice_detail` | 1 | jsonb |
| 63 | `get_governed_credit_invoices` | 1 | jsonb |
| 64 | `get_governed_customer` | 6 | jsonb |
| 65 | `get_governed_customer_addresses` | 1 | jsonb |
| 66 | `get_governed_customer_contacts` | 2 | jsonb |
| 67 | `get_governed_customer_credit_account` | 1 | jsonb |
| 68 | `get_governed_customer_ownership_history` | 1 | jsonb |
| 69 | `get_governed_customers` | 9 | jsonb |
| 70 | `get_governed_daily_deals` | 4 | jsonb |
| 71 | `get_governed_dashboard_counts` | 2 | jsonb |
| 72 | `get_governed_deliveries` | 3 | jsonb |
| 73 | `get_governed_employee` | 3 | jsonb |
| 74 | `get_governed_employee_monthly_targets` | 1 (targets.ts) | jsonb |
| 75 | `get_governed_employees` | 10 | jsonb |
| 76 | `get_governed_executive_kpis` | 1 | jsonb |
| 77 | `get_governed_executive_queue` | 1 | jsonb |
| 78 | `get_governed_flash_offers` | 2 | jsonb |
| 79 | `get_governed_location` | 1 | jsonb |
| 80 | `get_governed_locations` | 1 | jsonb |
| 81 | `get_governed_preparation_detail` | 1 | jsonb |
| 82 | `get_governed_preparation_queue` | 2 | jsonb |
| 83 | `get_governed_products` | 10 | jsonb |
| 84 | `get_governed_return` | 2 | jsonb |
| 85 | `get_governed_return_items` | 2 | jsonb |
| 86 | `get_governed_returns` | 2 | jsonb |
| 87 | `get_governed_roles` | 6 | jsonb |
| 88 | `get_governed_target_performance` | 1 (targets.ts) | jsonb |
| 89 | `get_governed_tiers` | 5 | jsonb |
| 90 | `get_governed_visit` | 2 | jsonb |
| 91 | `get_governed_visits` | 6 | jsonb |
| 92 | `get_governed_waiting_preparations` | 2 | jsonb |
| 93 | `get_kpi_contributors` | 1 (targets.ts) | jsonb |
| 94 | `get_live_activity_center` | 1 | jsonb |
| 95 | `get_live_workday_overview` | 3 | jsonb |
| 96 | `get_my_work_policy` | 1 | jsonb |
| 97 | `get_my_workday_status` | 1 | jsonb |
| 98 | `get_order_report` | 1 | jsonb |
| 99 | `get_order_status_counts` | 1 | jsonb |
| 100 | `get_public_company_profile` | 3 | jsonb |
| 101 | `get_rep_customer_kpis` | 1 (targets.ts) | jsonb |
| 102 | `get_role_capabilities` | 1 | jsonb |
| 103 | `get_runtime_achievement` | 2 | jsonb |
| 104 | `get_runtime_activity` | 2 | jsonb |
| 105 | `get_runtime_team` | 1 | jsonb |
| 106 | `get_runtime_team_activity` | 1 | jsonb |
| 107–122 | `get_sales_by_*` (8 RPCs) | 1 each | jsonb |
| 123 | `get_sales_manager_cc` | 1 | jsonb |
| 124 | `get_sales_reps_effort` | 1 | jsonb |
| 125 | `get_team_map` | 2 | jsonb |
| 126 | `get_team_members_kpis` | 1 (targets.ts) | jsonb |
| 127 | `get_tracking_session_stats` | 1 | jsonb |
| 128 | `get_unified_order` | 6 | jsonb |
| 129 | `get_unified_orders` | 9 | jsonb |
| 130 | `get_upper_management_dashboard` | 1 | jsonb |
| 131–263 | (various mutation RPCs) | 1–3 each | jsonb / record |

> Full 263-entry listing continues in appendix. Only top consumers shown above.

### Top 10 Most-Consumed RPCs

| RPC | Consumers | Type |
|-----|-----------|------|
| `get_governed_employees` | 10 | Query |
| `get_governed_products` | 10 | Query |
| `get_governed_customers` | 9 | Query |
| `get_unified_orders` | 9 | Query |
| `get_governed_companies` | 6 | Query |
| `get_governed_customer` | 6 | Query |
| `get_governed_roles` | 6 | Query |
| `get_governed_visits` | 6 | Query |
| `get_unified_order` | 6 | Query |
| `get_company_profile` | 5 | Query |

---

## 2. Contract Registry

### CRITICAL RPC: `get_governed_target_performance`

**Purpose:** Main target performance dashboard — company & employee achievement for current month.

#### Input Contract

| Parameter | Type | Required | Default |
|-----------|------|----------|---------|
| `p_token` | `uuid` | ✅ | — |
| `p_month` | `int` | ❌ | `EXTRACT(MONTH FROM CURRENT_DATE)` |
| `p_year` | `int` | ❌ | `EXTRACT(YEAR FROM CURRENT_DATE)` |

#### Output Contract (jsonb)

```jsonc
{
  "has_target": true,
  "company": {
    "sales_target": 1234567.89,          // numeric
    "visits_target": 456,                // int
    "orders_target": 789,                // int
    "new_customers_target": 123,         // int
    "sales_actual": 1000000.00,          // numeric (effective_sales)
    "visits_actual": 300,                // int
    "orders_actual": 600,                // int
    "new_customers_actual": 100,         // int
    "return_deductions": 50000.00,       // numeric
    "full_returns": 10,                  // int
    "sales_weight_percent": 75,          // int (hardcoded)
    "visits_weight_percent": 7.5,        // numeric (hardcoded)
    "orders_weight_percent": 7.5,        // numeric (hardcoded)
    "new_customers_weight_percent": 10,  // numeric (hardcoded)
    "sales_achievement_pct": 81.23,      // numeric (LEAST capped at 100)
    "visits_achievement_pct": 65.79,     // numeric
    "orders_achievement_pct": 76.05,     // numeric
    "new_customers_achievement_pct": 81.30, // numeric
    "overall_achievement_pct": 79.26,    // numeric (weighted, capped)
    "is_locked": null                    // boolean | null
  },
  "employees": [
    {
      "employee_id": "uuid",
      "employee_code": "EMP001",
      "employee_name": "أحمد محمد",
      "sales_target": 250000.00,
      "visits_target": 80,
      "orders_target": 150,
      "new_customers_target": 20,
      "gross_sales": 200000.00,
      "visits_actual": 60,
      "gross_orders": 120,
      "new_customers_actual": 15,
      "return_deduction": 10000.00,
      "full_returns": 2,
      "effective_sales": 190000.00,
      "effective_orders": 118,
      "has_target": true,
      "has_activity": true,
      "sales_achievement_pct": 76.00,       // numeric | null
      "visits_achievement_pct": 75.00,      // numeric | null
      "orders_achievement_pct": 78.67,      // numeric | null
      "new_customers_achievement_pct": 75.00, // numeric | null
      "overall_achievement_score": 76.17,   // numeric | null
      "weights": {
        "sales_weight_percent": 75,
        "visits_weight_percent": 7.5,
        "orders_weight_percent": 7.5,
        "new_customers_weight_percent": 10,
        "source": "hardcoded_v1"
      },
      "is_locked": null                     // boolean | null
    }
  ],
  "best_employee": { /* same shape as employee */ } | null,
  "weakest_employee": { /* same shape as employee */ } | null
}
```

#### Consumers

| File | Screen |
|------|--------|
| services/targets.ts:91 | TargetRuntimePage |
| services/targets.ts:91 | UpperManagementDashboard (via targetService.getPerformance) |

---

### CRITICAL RPC: `get_unified_order`

**Purpose:** Order detail — the unified order contract used by 6 screens.

#### Input

| Parameter | Type | Required | Default |
|-----------|------|----------|---------|
| `p_token` | `text` | ✅ | — |
| `p_id` | `uuid` | ✅ | — |

#### Output (jsonb)

```jsonc
{
  "id": "uuid",
  "order_number": "ORD-2026-00001",
  "status": "pending",
  "customer_id": "uuid",
  "customer_name": "شركة النصر",
  "customer_phone": "01000000000",
  "customer_code": "C001",
  "owner_id": "uuid",
  "owner_name": "أحمد البائع",
  "owner_code": "EMP001",
  "total_amount": 15000.00,
  "notes": "ملاحظات ...",
  "created_at": "2026-06-01T10:00:00Z",
  "delivered_at": null,
  "tier_id": "uuid | null",
  "tier_name": null,
  "tier_discount_percent": 0,
  "items": [
    {
      "id": "uuid",
      "product_id": "uuid",
      "product_name": "منتج أ",
      "legacy_code": "P001",
      "unit_type": "piece",
      "piece_quantity": 50,
      "unit_price": 300.00,
      "total_price": 15000.00,
      "company_id": "uuid",
      "company_name": "شركة المورد"
    }
  ],
  "daily_deals": [],
  "flash_offers": [],
  "credit_info": null,
  "preparation": null,
  "delivery": null
}
```

#### Consumers: 6 screens

| File | Screen |
|------|--------|
| pages/orders/OrderDetailPage.tsx | Order Detail |
| pages/products/OrderEditPage.tsx | Order Edit |
| pages/products/OrderNewPage.tsx | Order New |
| pages/returns/ReturnNewPage.tsx | Return New |
| pages/storefront/OrderReviewPage.tsx | Order Review |
| pages/workspaces/ExecutiveOperationsWorkspace.tsx | Executive Workspace |

---

### CRITICAL RPC: `get_unified_orders`

**Purpose:** Order list/search — powers 9 different screens.

#### Input

| Parameter | Type | Required | Default |
|-----------|------|----------|---------|
| `p_token` | `text` | ✅ | — |
| `p_search` | `text` | ❌ | NULL |
| `p_status` | `varchar` | ❌ | NULL |
| `p_customer_id` | `uuid` | ❌ | NULL |
| `p_created_by` | `uuid` | ❌ | NULL |
| `p_date_from` | `timestamptz` | ❌ | NULL |
| `p_date_to` | `timestamptz` | ❌ | NULL |

#### Output

```jsonc
{
  "orders": [
    {
      "id": "uuid",
      "order_number": "...",
      "customer_name": "...",
      "total_amount": 15000.00,
      "status": "pending",
      "created_at": "2026-06-01T10:00:00Z",
      "owner_name": "...",
      "items_count": 5
    }
  ],
  "total": 42
}
```

#### Consumers: 9 screens

| File | Screen |
|------|--------|
| pages/orders/ApprovalQueuePage.tsx | Approval Queue |
| pages/products/OrdersPage.tsx | Orders List |
| pages/returns/ReturnNewPage.tsx | Return New |
| pages/workspaces/AccountantWorkspace.tsx | Accountant |
| pages/workspaces/BuffetWorkspace.tsx | Buffet |
| pages/workspaces/ChairmanWorkspace.tsx | Chairman |
| pages/workspaces/DataEntryWorkspace.tsx | Data Entry |
| pages/workspaces/SalesDirectorWorkspace.tsx | Sales Director |
| pages/storefront/SalesRepWorkDay.tsx | Sales Rep Workday |

---

### Noteworthy: `get_governed_employees`

Most-consumed query RPC (10 consumers). Returns employee list with manager/role info.

#### Input

| Parameter | Type | Required | Default |
|-----------|------|----------|---------|
| `p_token` | `uuid` | ✅ | — |

#### Output

```jsonc
[
  {
    "employee_id": "uuid",
    "employee_code": "EMP001",
    "employee_name": "أحمد محمد",
    "role_type": "مدير بيع",
    "role_name": "Sales Manager",
    "manager_id": "uuid | null",
    "manager_name": "string",
    "is_active": true,
    "identity_id": "uuid | null"
  }
]
```

---

## 3. Function Classification

### Production (Consumed by Frontend)

| Category | Count | Examples |
|----------|-------|---------|
| **Query RPCs** (get_* / governed_get_*) | ~100 | `get_unified_order`, `get_governed_target_performance`, `get_governed_employees` |
| **Command RPCs** (governed_* mutation) | ~120 | `governed_create_order`, `governed_approve_order`, `governed_checkin_visit` |
| **Attendance RPCs** (start/end workday, break) | ~15 | `start_workday`, `end_break`, `get_my_workday_status` |
| **Auth RPCs** | ~5 | `login`, `logout`, `validate_session` |

**Total Production: ~240 functions**

### Legacy / Overloaded

| Function | Reason |
|----------|--------|
| `get_governed_company_monthly_target` (2 overloads) | One has 12 params (Phase 4), another has 8 params (V1). Both exist. Frontend calls 12-param version. |
| `get_visible_employee_ids` (2 overloads) | `uuid` and `text` overloads. Both active. |

### Deprecated (Not Consumed by Frontend, Still in DB)

| Function | Reason |
|----------|--------|
| `get_warehouse_analytics` | No frontend reference found |
| `governed_cancel_order` | Not in frontend (possibly kept for manual DB use) |
| `governed_defer_order` | Not in frontend |
| `governed_delete_customer` | Superseded by `governed_deletion_execute_customers` |
| `governed_delete_order` | Superseded by `governed_deletion_execute_orders` |
| `governed_delete_collection` | Superseded by `governed_deletion_execute_collections` |
| `governed_reopen_cancelled` | Not in frontend |
| `governed_submit_credit_application` | Not in frontend |
| `governed_sign_contract` | Not in frontend |
| `resolve_stale_session` | Not in frontend |
| `governed_create_visit` | Not called (frontend uses `governed_checkin_visit`) |
| `governed_update_collection` | Not in frontend |
| `governed_update_return` | Not in frontend |
| `governed_return_deferred` | Not in frontend |
| `governed_approve_participant` | Not in frontend |
| `governed_end_auction` | Not in frontend |
| `governed_get_contract_by_application` | Not in frontend |
| `governed_get_contract_template` | Not in frontend |
| `governed_update_contract_template` | Not in frontend |
| `update_module_owner_field` | Not in frontend |
| `get_work_policies_report` | Not in frontend |
| `get_workday_cleanup_log` | Not in frontend |
| `health_check_runtime` | Not in frontend |
| `governed_auto_suspend_overdue_accounts` | Not in frontend |
| `is_employee_executive` | Helper, not RPC |
| `is_employee_operational` | Helper, not RPC |
| `is_upper_management` | Helper, not RPC |
| `session_is_upper_management` | Helper, not RPC |
| `governed_dispatch_decision` | Not in frontend |
| `governed_set_location_override` | Not in frontend |

### Experimental / Test (Never Reach Production)

| Function | Source |
|----------|--------|
| `test_func` | Migration artifact |
| `test_migration_func` | Migration artifact |
| `test_minimal` | Migration artifact |
| `test_minimal_attendance` | Migration artifact |
| `test_ping` / `test_ping2` / `test_ping3` | Migration artifact |
| `test_report` (2 overloads) | Migration artifact |
| `test_rpc` | Migration artifact |
| `test_setof` | Migration artifact |
| `test_simple` | Migration artifact |
| `test_sm_cc` | Migration artifact |
| `multiline_test` | Migration artifact |
| `ping` | Migration artifact |
| `runtime_reconciliation` | Maintenance tool |

---

## 4. Dependency Map

### Highest Dependency Clusters

```
get_unified_order
├── OrderDetailPage        → Order detail view
├── OrderEditPage          → Order modification
├── OrderNewPage           → New order review
├── ReturnNewPage          → Return creation from order
├── OrderReviewPage        → Storefront order review
└── ExecutiveWorkspace     → Executive operations
└── ⚠ PDF/WhatsApp/Timeline/Preparation (indirect via OrderDetail)
```

```
get_unified_orders
├── ApprovalQueuePage      → Pending approvals
├── OrdersPage             → Order management list
├── ReturnNewPage          → Order selector
├── SalesRepWorkDay        → Rep's daily orders
├── AccountantWorkspace    → Financial workspace
├── BuffetWorkspace        → Buffet operations
├── ChairmanWorkspace      → Chairman review
├── DataEntryWorkspace     → Data entry screen
└── SalesDirectorWorkspace → Director view
```

```
get_governed_target_performance
├── TargetRuntimePage      → Main target dashboard
└── UpperManagementDashboard → Upper management overview
```

```
get_governed_employees
├── EmployeesPage          → Employee management
├── HierarchyPage          → Org hierarchy
├── EmployeeProfilePage    → Employee details
├── PermissionsTab         → Permission management
├── RolesTab               → Role management
├── VisitsPage             → Visit assignment
├── DeliveryPage           → Delivery assignment
├── WarehousePage          → Warehouse operations
├── ExecutiveWorkspace     → Executive view
└── SalesManagerCCPage     → Sales manager CC
```

---

## 5. High Risk RPC List

These RPCs have 5+ consumers — **modifying their contract will break multiple screens**.

```yaml
get_governed_employees:
  risk: CRITICAL
  consumers: 10
  rule: "NO field deletion. NO field rename. Only additive changes."

get_governed_products:
  risk: CRITICAL
  consumers: 10
  rule: "NO field deletion. NO field rename."

get_governed_customers:
  risk: CRITICAL
  consumers: 9
  rule: "NO field deletion. NO field rename."

get_unified_orders:
  risk: CRITICAL
  consumers: 9
  rule: "NO field deletion. NO field rename. Pagination contract frozen."

get_unified_order:
  risk: CRITICAL
  consumers: 6
  rule: "Full contract frozen. 6 screens depend on exact shape."

get_governed_companies:
  risk: CRITICAL
  consumers: 6
  rule: "NO field deletion. NO field rename."

get_governed_customer:
  risk: CRITICAL
  consumers: 6
  rule: "NO field deletion. NO field rename."

get_governed_roles:
  risk: HIGH
  consumers: 6
  rule: "NO field deletion."

get_governed_visits:
  risk: HIGH
  consumers: 6
  rule: "NO field deletion."

get_governed_target_performance:
  risk: HIGH
  consumers: 2
  rule: "Frozen during Phase 0. Target redesign will rebuild this one carefully with additive fields."
  note: "This is the main target for redesign. Current hardcoded weights (75/7.5/7.5/10) will be replaced with dynamic weights from get_effective_weights(). Attendance + Collections KPIs will be added."
```

### Additional High Risk (System-Level)

```yaml
login:
  risk: CRITICAL
  consumers: 1 (auth service)
  rule: "NO CHANGE. Session contract used by every subsequent RPC."

get_company_profile:
  risk: HIGH
  consumers: 5
  rule: "NO field deletion."

get_dashboard_management:
  risk: HIGH
  consumers: 5
  rule: "NO field deletion. 5 dashboards depend on it."

get_governed_tiers:
  risk: HIGH
  consumers: 5
  rule: "NO field deletion."

get_governed_daily_deals:
  risk: HIGH
  consumers: 4
  rule: "NO field deletion."
```

---

## 6. Freeze Rules

### Rule 1: Production RPC Modification Policy

```
✅ ALLOWED:
  - Bug fixes (no contract change)
  - Adding new fields to JSON output
  - Adding new sections to JSON output
  - Adding new optional parameters (with defaults)

❌ NOT ALLOWED (without review & sign-off):
  - Deleting any existing field from JSON output
  - Renaming any existing field
  - Changing field type
  - Changing parameter names
  - Removing parameters
  - Changing parameter order
  - Complete function rewrite (requires architecture review)
  - Merging or splitting RPCs
```

### Rule 2: Target Performance Specific Rules

Since `get_governed_target_performance` is the target of redesign:

```
✅ ALLOWED:
  - Add new fields alongside existing ones (attendance, collections)
  - Add new sections (weight_details, attendance_data)
  - Add optional parameters
  - Fix calculation bugs

❌ NOT ALLOWED:
  - Remove/rename existing fields (sales_target, visits_actual, etc.)
  - Change existing field types
  - Remove existing sections (company, employees, best_employee, weakest_employee)
  - Any change that breaks TargetRuntimePage's TypeScript interface
```

### Rule 3: Error Response Contract

All RPCs currently return error as:
```json
{ "error": "ERROR_MESSAGE_STRING" }
```

This contract is frozen. No other error format allowed.

### Rule 4: Version Tracking

When modifying a Production RPC, add a `_version` field or internal `contract_version` to the JSON output for future migration tracking.

---

## Appendix: Truncated Consumer Details

### Target-Ecosystem RPCs (Focus for Redesign)

| RPC | File | Purpose |
|-----|------|---------|
| `get_governed_target_performance` | targets.ts:91 | Main performance dashboard |
| `get_governed_company_monthly_target` | targets.ts:11 | Get company targets |
| `get_governed_employee_monthly_targets` | targets.ts:55 | Get employee targets |
| `get_governed_active_employees` | targets.ts:152 | Active employee list |
| `get_kpi_contributors` | targets.ts:107 | Drill-down KPI contributors |
| `get_team_members_kpis` | targets.ts:124 | Team member drill-down |
| `get_rep_customer_kpis` | targets.ts:141 | Customer-level drill-down |
| `get_customer_delivered_orders` | targets.ts:163 | Customer order drill-down |
| `get_employee_weight_overrides` | targets.ts:175 | Weight override lookup |
| `governed_upsert_company_monthly_target` | targets.ts:19 | Upsert company target |
| `governed_upsert_employee_monthly_target` | targets.ts:62 | Upsert employee target |
| `governed_upsert_employee_weight_override` | targets.ts:187 | Upsert weight override |
| `deactivate_employee_weight_override` | targets.ts:213 | Deactivate override |
| `seed_sales_rep_monthly_targets` | targets.ts:221 | Seed targets |

### Migration Timeline (Last 10)

| Migration | Date | Content |
|-----------|------|---------|
| `20261003_b12_include_all_active_employees.sql` | Latest | Overwrote `get_governed_target_performance` to V1 (4 KPI, hardcoded weights) |
| `20261002_fix_work_hours_ledger_contract.sql` | | Fix work hours ledger contract |
| `20261001_f2_canonical_kpi_unification.sql` | | KPI unification (CTE rewrite for get_completed_workdays_history) |
| `20260923_unified_smart_search.sql` | | Global search |
| `20260922_product_out_of_stock.sql` | | Out of stock feature |
| `20260921_employee_cascade_delete.sql` | | Employee cascade delete |
| `20260921_data_deletion_center.sql` | | Data deletion center |
| `20260820_executive_queue_customer_owner.sql` | | Executive queue |
| `20260810_executive_workspace_final.sql` | | Executive workspace |
| `20260808_fix_get_completed_workdays_history_missing_sort_rank.sql` | | Our fix |

---

*End of Phase 0 Report. No changes made to database or frontend.*
