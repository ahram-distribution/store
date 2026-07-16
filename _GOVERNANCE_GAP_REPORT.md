# Governance Gap Analysis Report

## Hierarchy Subsystem vs Canonical Business Rules

---

## Rule 1: SYSTEM OWNERSHIP

> Upper Management is the owner of the system.
> Upper Management has unrestricted authority over every module.
> Upper Management NEVER derives authority from the employee hierarchy.
> Authority comes from governance, not from manager_id.

### Current Implementation

| Aspect | Current State |
|--------|--------------|
| **UM authority grant** | UM bypass in `check_capability()` — UM passes all checks automatically. ✅ Correct. |
| **UM role detection** | `is_upper_management()` checks `employee_roles` joined to `roles` where `r.name = 'الإدارة العليا'`. ✅ Correct (no hardcoded codes). |
| **`is_supreme_management()`** | Also checks `r.name = 'الإدارة العليا'` (`20270108_purge_old_role_references.sql`). ✅ Correct. |
| **Hardcoded UM codes** | Removed from `is_upper_management()` ✅ but still present in comments (`20260706_role_normalization.sql`). |
| **`get_dashboard_management`** | Still uses OLD auth model: checks `SUPER_ADMIN/CHAIRMAN/ADMIN` role names + hardcoded WRQ1002/WRQ1004 employees. Does NOT use `is_upper_management()`. ❌ Mismatch. |

### Mismatches

**M1 — `get_dashboard_management` uses legacy authorization**: The production version still checks `SUPER_ADMIN`, `CHAIRMAN`, `ADMIN` role names (old terminology). This was never updated to use `is_upper_management()`. It also has hardcoded WRQ1002/WRQ1004 bypasses.

**M2 — No UM label in UI**: The frontend has multiple workspace components (`SuperAdminWorkspace`, `AdminWorkspace`, `ChairmanWorkspace`, `ManagementDashboard`, `UpperManagementDashboard`) that map to old role names. These need to be unified under `الإدارة العليا`.

---

## Rule 2: EMPLOYEE HIERARCHY

> The employee hierarchy exists ONLY for operational reporting.
> Its purpose is: team visibility, reporting, activity, customers, assignments.
> It is NOT the ownership hierarchy.

### Current Implementation

| Aspect | Current State |
|--------|--------------|
| **Visibility scoping** | Uses hierarchy to scope what data an employee sees. ✅ Correct use. |
| **Reporting** | Uses hierarchy for reporting rollups (`get_drilldown_performance`, `get_upper_management_dashboard`). ✅ Correct use. |
| **Customer ownership transfer** | `governed_change_customer_ownership` only checks `customers.manage` capability. Does NOT check that the caller's hierarchy covers the customer's current owner or the new owner. ❌ Overreach — allows hierarchy-based scope to be bypassed. |

### Mismatches

**M3 — `governed_change_customer_ownership` allows cross-hierarchy transfers**: Any employee with `customers.manage` capability can transfer any customer to any owner, regardless of hierarchy. This means a Sales Manager could transfer customers owned by a different branch's manager to their own team.

---

## Rule 3: PERMISSIONS

> No employee below Upper Management may:
> - grant themselves any permission
> - increase their own visibility
> - modify the organizational hierarchy
> - modify manager_id

### Current Implementation

| Constraint | Checked? | Details |
|------------|----------|---------|
| Self-grant permission | ❌ No | `governed_change_employee_role` only checks `employees.manage` capability. No check prevents self-target. |
| Self-increase visibility | ❌ No | No function prevents an employee from granting themselves capabilities that expand visibility scope. |
| Modify org hierarchy | ❌ No | `governed_change_employee_manager` only checks `employees.manage`. No hierarchy-scope validation. |
| Modify manager_id | ❌ No | Same function — no restriction on which employee's manager_id can be changed. |

### Mismatches

**M4 — `governed_change_employee_role` has no self-target prevention**: An employee with `employees.manage` can change their OWN role, potentially granting themselves `الإدارة العليا`.

**M5 — `governed_change_employee_role` has no hierarchy-scope check**: A manager can change the role of an employee in a completely different hierarchy branch.

**M6 — `governed_change_employee_manager` has no hierarchy-scope check**: A manager can reassign any employee's manager, including moving employees into/out of other branches.

**M7 — `governed_create_employee` has no hierarchy-scope check**: The `p_manager_id` parameter accepts any employee. A manager could create a new employee under a manager in a different branch.

**M8 — `governed_update_employee_capabilities` has no hierarchy-scope check**: Direct capabilities can be granted/denied for any employee. An employee with this capability could increase their own visibility by granting themselves scoping capabilities.

---

## Rule 4: EMPLOYEE CREATION

> Sales Representatives may NOT create employees.
> Sales Managers may create only employees that belong under their own hierarchy.
> A Sales Manager may NEVER create:
> - another Sales Manager
> - an employee at the same level
> - an Upper Management member
> Only Upper Management may create employees at any level.

### Current Implementation

| Constraint | Checked? | Details |
|------------|----------|---------|
| Sales Rep cannot create | ❌ No | `governed_create_employee` checks `employees.manage` capability, not role. A Sales Rep with this capability (unlikely but possible) could create employees. |
| Only in own hierarchy | ❌ No | No hierarchy validation on `p_manager_id`. |
| Cannot create another Sales Manager | ❌ No | No check prevents assigning a `مدير البيع` role to a newly created employee. |
| Cannot create same-level employee | ❌ No | No check prevents assigning a role equal to or higher than the creator's. |
| Cannot create UM member | ❌ No | No check prevents assigning the `الإدارة العليا` role during creation. |
| Only UM creates at any level | ❌ No | The function gates on `employees.manage` capability, not `is_upper_management()`. |

### Mismatches

**M9 — `governed_create_employee` lacks role-level restrictions**: The canonical rule says only UM may create employees at any level, and Sales Managers may only create subordinates. The function has no role-level enforcement.

**M10 — `governed_create_employee` allows creating employees above the creator's level**: A Sales Manager could create an employee with the `مدير البيع` role — same level — which violates the rule "may never create an employee at the same level."

**M11 — `governed_create_employee` allows creating Upper Management**: The `employees.manage` capability (non-UM bypass) allows creating employees with the `الإدارة العليا` role.

---

## Rule 5: CUSTOMER OWNERSHIP

> Employees may create only customers that belong to their own operational scope.
> No employee may assign customers outside their own hierarchy.
> Only Upper Management may override ownership.

### Current Implementation

| Constraint | Checked? | Details |
|------------|----------|---------|
| Create customers in own scope | ❌ Partial | `governed_create_customer` sets `owner_id = v_session.employee_id`. The employee owns what they create. But no validation that the customer's operational scope matches. |
| Assign customers within hierarchy | ❌ No | `governed_change_customer_ownership` only checks `customers.manage` capability. No hierarchy validation. |
| Only UM overrides ownership | ❌ No | The `customers.manage` capability can be assigned to non-UM roles. The function does not call `is_upper_management()`. |

### Mismatches

**M12 — `governed_change_customer_ownership` lacks UM-only override**: The canonical rule says "Only Upper Management may override ownership." But the function is gated on `customers.manage`, not `is_upper_management()`.

**M13 — `governed_create_customer` in SalesManagerOperations**: The `SalesManagerOperations.tsx` creates a customer then immediately transfers ownership to a target sales rep. This transfer is gated only on `customers.manage`, not on hierarchy scope.

---

## Rule 6: SECURITY

> The system must reject any operation that attempts to:
> - create a hierarchy cycle
> - create self-reference
> - move an employee outside the permitted hierarchy
> - assign a manager outside the permitted hierarchy
> - elevate privileges through hierarchy manipulation

### Current Implementation

| Constraint | Checked? | Details |
|------------|----------|---------|
| Cycle creation | ❌ No | `governed_change_employee_manager` has no cycle detection beyond the self-reference check. |
| Self-reference | ✅ Yes | `IF p_id = p_manager_id THEN RETURN error('SELF_MANAGER')`. |
| Move outside hierarchy | ❌ No | No hierarchy-scope validation. |
| Assign outside-hierarchy manager | ❌ No | No check that new manager is in caller's visible subtree. |
| Privilege elevation via hierarchy | ❌ No | No check prevents assigning a higher-level role. |

### Mismatches

**M14 — No cycle detection in `governed_change_employee_manager`**: A single UPDATE can create a cycle between any two employees. After the WRQ1003/WRQ1006 incident, this is the most critical gap.

**M15 — No manager_id validation trigger**: No `BEFORE UPDATE` trigger on `employees.manager_id` validates that the update doesn't create a cycle, self-reference (beyond the RPC check), or invalid hierarchy.

**M16 — No preventive constraint**: No `CHECK` constraint or exclusion constraint prevents circular `manager_id` references at the database level.

---

## Summary Table — All Mismatches

| ID | Rule | Violation | Current Behavior | Required Change | Risk |
|----|------|-----------|-----------------|-----------------|------|
| M1 | 1 | `get_dashboard_management` uses legacy auth | Checks old role names + hardcoded codes | Rewrite to use `is_upper_management()` + `get_visible_employee_ids()` | **High** — wrong UM detection on production |
| M2 | 1 | Frontend uses old role labels | SuperAdminWorkspace, AdminWorkspace, ChairmanWorkspace | Unify to `الإدارة العليا` workspace | **Low** — cosmetic |
| M3 | 2 | Customer ownership transfer ignores hierarchy | `governed_change_customer_ownership` only checks capability | Add hierarchy verification + UM-only override | **High** — ownership violation |
| M4 | 3 | No self-target prevention on role change | Employee can change own role | Reject if `p_id = v_session.employee_id` for non-UM | **Critical** — privilege escalation |
| M5 | 3 | No hierarchy scope on role change | Any manager can change any employee's role | Verify target is in caller's visible subtree | **Critical** — privilege escalation |
| M6 | 3 | No hierarchy scope on manager change | Any manager can move any employee | Verify target is in caller's visible subtree | **Critical** — hierarchy integrity |
| M7 | 3 | No hierarchy scope on employee creation | New employee can be placed under any manager | Verify `p_manager_id` is in caller's visible subtree | **High** — hierarchy integrity |
| M8 | 3 | No hierarchy scope on capability change | Direct capabilities can be set for any employee | Verify target is in caller's visible subtree | **Critical** — privilege escalation |
| M9 | 4 | No role-level restriction on creation | Non-UM can create employees at any level | Require `is_upper_management()` for creating UM or same-level employees | **High** — governance violation |
| M10 | 4 | Same-level creation allowed | Sales Manager can create another Sales Manager | Reject if new role equals creator's role level | **High** — governance violation |
| M11 | 4 | UM creation allowed by non-UM | `employees.manage` enables creating UM members | Require `is_upper_management()` to assign UM role | **Critical** — governance violation |
| M12 | 5 | Customer ownership override not UM-only | `customers.manage` capability bypasses UM exclusivity | Require `is_upper_management()` for override | **High** — ownership violation |
| M13 | 5 | Cross-hierarchy ownership transfer | No hierarchy validation on transfer target | Verify new owner is in caller's visible subtree | **High** — ownership violation |
| M14 | 6 | No cycle detection | `governed_change_employee_manager` can create cycles | Validate no cycle before UPDATE | **Critical** — data integrity |
| M15 | 6 | No trigger validation on manager_id | UPDATE can set any manager_id | Add `BEFORE UPDATE` trigger with cycle check | **High** — defense in depth |
| M16 | 6 | No DB constraint against cycles | No CHECK constraint on `employees` | Add constraint via trigger or exclusion | **Medium** — defense in depth |

---

## Counts

| Category | Count |
|----------|-------|
| **Critical** (privilege escalation, data integrity) | **6** |
| **High** (governance violation, ownership breach) | **7** |
| **Medium** (defense in depth) | **2** |
| **Low** (cosmetic) | **1** |
| **Total** | **16** |

---

## Root Cause

The `check_capability()` function gates all employee management operations on the `employees.manage` capability. The problem is:

1. **`employees.manage` is binary** — either you have it or you don't. It grants ALL employee management powers: create, update, delete, role change, manager change, capability change.
2. **No hierarchy scope** — The capability checker never verifies the target employee is within the caller's operational scope.
3. **No level check** — The system never verifies that the caller is creating/assigning a role that is BELOW their own level.
4. **No cycle protection** — The only integrity check is the self-reference guard (`p_id != p_manager_id`).

The current model assumes that only UM (who bypass capability checks entirely) will ever have `employees.manage`. If a non-UM role is granted this capability (e.g., through a `role_capabilities` assignment), the entire security model collapses.
