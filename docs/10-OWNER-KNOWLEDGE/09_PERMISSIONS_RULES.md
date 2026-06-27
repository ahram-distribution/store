# Permissions Rules

> **Status:** Placeholder — ready to receive owner clarification.  
> **Verification Status:** `VERIFIED_IN_CODE` (permissions model confirmed in schema and code)

---

## Known Context (from verified documentation)

### Permissions Model

| Component | Table | Purpose |
|-----------|-------|---------|
| Roles | `roles` | Role definitions (name_ar, name_en, priority) |
| Capabilities | `capabilities` | Individual permission codes (~80+ defined) |
| Role-Capability mapping | `role_capabilities` | Which capabilities each role has |
| Employee role | `employees.role_id` | Current role assignment (single role) |
| Employee overrides | `employee_capabilities` | Per-employee capability additions/removals |

### Runtime Evaluation

- `fn_get_employee_capabilities(employee_id)` — computes effective capabilities at runtime
- `app.has_capability` — session-level capability check
- `app.requires_auth` — middleware-style auth enforcement in RPCs

### Governance Architecture

- All write operations go through `governed_*` PostgreSQL functions
- These functions enforce authentication (`app.requires_auth`) and capability checks
- 20 governance bypasses exist across 10 files (direct `supabase.from()` calls)

### Dead Schema

- `employee_roles` junction table is defined but unused in any code path

**Sources:** PROJECT_STATE_HANDOFF.md §1, §7, FINAL_CANONICAL_MASTER_REFERENCE_V2.md §2, §3.3, §8.3, 16_RUNTIME_SOURCE_OF_TRUTH_MAP.md §9, §47

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| 2026-06-10 | Defined Roles | "System roles: UPPER_MANAGEMENT (الإدارة العليا), SALES_MANAGER (مدير مبيعات), SALES_REPRESENTATIVE (مندوب), INTERNAL_SALES (سيلز داخلي), WAREHOUSE_MANAGER (مدير المخزن), WAREHOUSE_WORKER (عامل مخزن), GENERAL_SUPERVISOR (المشرف العام). Supervisor role is retired." | Seven active system roles. Supervisor no longer exists as a distinct role. | Roles, Employees, Permissions | OWNER_DEFINED |
| 2026-06-10 | Hierarchy | "UPPER_MANAGEMENT → SALES_MANAGER → SALES_REPRESENTATIVE → CUSTOMER. Internal Sales reports directly to Upper Management. Warehouse/General Supervisor are operational roles outside this hierarchy." | The sales hierarchy is a straight chain from UM down to Customer. Internal Sales is parallel to this chain (reports to UM directly). | Hierarchy, Organizational Model, Employees | OWNER_DEFINED |
| 2026-06-10 | Authority to Modify Roles | "Upper Management may grant/revoke permissions for any employee from Employee Management. No other role may grant/revoke permissions." | Exclusive permission authority belongs to Upper Management. | Permissions, Employee Management, Roles | OWNER_DEFINED |

---

## Open Questions for Owner

1. What capabilities should each role have?
2. Is single-role-per-employee the correct model, or should multi-role support be built?
3. Should the governance bypasses (20 instances in 10 files) be resolved by creating governed RPCs?
4. Are there any capabilities that should be restricted to specific roles only?

---

*End of 09_PERMISSIONS_RULES.md*
