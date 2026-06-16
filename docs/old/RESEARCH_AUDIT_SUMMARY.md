# Research Audit: Owner Knowledge Base vs System Implementation

## Rule 1: Unified Identity (phones unique, employees + customers)

**Status: IMPLEMENTED**

- `identities` table with `identity_type ENUM(employee,customer)`, unique phone constraint
- `app.sessions` table tracks sessions by identity_id, customer_id, employee_id
- `register_customer` creates identity + customer
- `governed_create_employee` creates identity + employee
- `check_capability(token, code)` resolves via `app.sessions`

## Rule 2: Customer Ownership by Employee (customers.owner_id FK → employees.id)

**Status: IMPLEMENTED**

- `customers.owner_id uuid NOT NULL REFERENCES employees(id)`
- `customers.owner_type varchar(20) DEFAULT 'employee'`
- All governed RPCs validate ownership chains
- REG-* (self-registered) customers assigned to SUPER_ADMIN employee

## Rule 3: Customer Ownership Audit Trail (customer_ownership_history)

**Status: IMPLEMENTED**

- `customer_ownership_history` table: customer_id, previous_owner_id, new_owner_id, changed_by, reason
- `governed_change_customer_ownership` INSERTs history record before UPDATE
- Only `customers.manage` capability grants access

## Rule 4: Sales Rep Isolation (subtree visibility)

**Status: IMPLEMENTED (DB-level, some hardcoded exceptions)**

- `get_visible_employee_ids(p_token)` uses recursive CTE from session employee down
- `get_governed_customers` filters via `c.owner_id = ANY(v_visible)`
- Hardcoded WRQ1002/WRQ1004 special case: they see sibling subtrees (same manager_id level)
- SUPER_ADMIN/CHAIRMAN/ADMIN bypass: see all employees
- Customer session: sees only own customers

## Rule 5: Capability-Based Permissions (not role-name checks)

**Status: PARTIALLY_IMPLEMENTED**

- Newer RPCs (governed_*) use `check_capability(p_token, 'code')` — correct pattern
- Older RPCs (recovery_missing_functions, attendance, etc.) still use hardcoded `r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')` role-name checks — **BROKEN pattern** per owner principle
- `check_capability` (20260604) supports: direct employee grants/denies + role_capabilities (role → capability junction)
- Frontend `useCapability` hook wraps `check_capability` RPC correctly
- `ProtectedRoute` checks capabilities for route access

## Rule 6: Role-Based Access (Dynamic Roles via employee_roles)

**Status: IMPLEMENTED**

- `roles` table: name, description, is_system
- `employee_roles` junction table: supports multiple roles per employee
- Session user object includes `roles[]` array from auth store
- DashboardPage dispatches workspace by normalized role names
- Role management RPCs: governed_create_role, _update_role, _delete_role, _update_role_capabilities

## Rule 7: Direct vs Managed Customer Types

**Status: NOT_IMPLEMENTED**

- Owner docs 04_CUSTOMER_RULES.md specifies Direct (العميل المباشر) and Managed (العميل المتابع) customer types
- `customers` table has no `customer_type` or equivalent column
- `owner_type` only distinguishes 'employee' vs other (no business meaning)
- No type transition logic implemented
- No UI distinction between Direct/Managed customers

## Rule 8: Self-Registration (register_customer)

**Status: IMPLEMENTED**

- `register_customer` RPC creates identity + customer + unified_location + customer_contact
- Assigns SUPER_ADMIN as owner (20260615 final logic)
- Returns session token for immediate login
- Phone validation: `^01[0-9]{9}$`, password: `^\d{6}$`
- `governed_create_customer` for employee-initiated creation

## Rule 9: Customer Create with GPS/Text Address

**Status: IMPLEMENTED (with fixes across 4 migrations)**

- `governed_create_customer` creates `unified_locations` record
- GPS present → store lat/lng + formatted_address
- GPS absent + formatted_address → address-only record (20260621 fix)
- `customers.location_id` FK → `unified_locations(id)`
- Address text in `customer_addresses` table (existing data path)

## Rule 10: Employee Management RPCs (CRUD + activation)

**Status: IMPLEMENTED**

- governed_create_employee (with address via 20260608)
- governed_update_employee
- governed_activate_employee / governed_deactivate_employee
- governed_reset_employee_password
- governed_change_employee_manager
- governed_change_employee_role
- governed_update_employee_capabilities
- get_employee_activity
- All guarded by `check_capability(p_token, 'employees.manage')`

## Rule 11: Sales Hierarchy (مدير البيع → مندوب → مشرف)

**Status: IMPLEMENTED (DB level, no Supervisor UI role)**

- `مدير البيع` role created in 20260611 phase2
- REP001 (خالد سعيد) assigned to مدير البيع
- `مشرف مبيعات`, `مشرف تنفيذي` used in attendance/targets RPCs
- `سوبر فايزر` (supervisor) resolved by role name check in RPCs
- SupervisorPage.tsx exists as frontend component
- `مندوب مبيعات` referenced in RPC role-name checks
- Hierarchy: UPPER_MANAGEMENT → مدير البيع → مشرف/سوبر فايزر → مندوب مبيعات/مشرف مبيعات

## Rule 12: Internal Sales (سيلز داخلي) Reports Directly to Upper Management

**Status: UNCLEAR / PARTIALLY_IMPLEMENTED**

- Owner doc 02_ORGANIZATIONAL_MODEL.md specifies Internal Sales reports directly to UM
- Code WRQ1005 referenced in some RPCs (`v_emp_code IN ('REP-001', ...)`)
- No explicit `سيلز داخلي` role found in seed data
- `مدير البيع` is the defined sales management role
- Hierarchy position of WRQ1005 is unclear from migration code

## Rule 13: Unified Registration Principle (one source for customers + employees)

**Status: IMPLEMENTED**

- `identities` table is single source for authentication
- `register_customer` and `governed_create_employee` both use identities
- `app.sessions` unified session system
- 20260615 identity_rules_final enforces: customers.owner_id is single source, orders.created_by is single source

## Rule 14: Upper Management Unification (4 employees = same capabilities)

**Status: IMPLEMENTED**

- ADMIN-001/WRQ1006 (ياسر توفيق), WRQ1003 (محمد سعيد), WRQ1002 (علي سعيد), WRQ1004 (محمود سعيد)
- All 4 granted identical attendance capabilities in 20260611 phase1
- All treated as `r.name IN ('SUPER_ADMIN','CHAIRMAN','ADMIN')` in RPC checks
- DashboardPage routes WRQ1006 to UpperManagementDashboard; WRQ1002/WRQ1004 also get UM dashboard

## Rule 15: Warehouse Manager (بسام WRQ1001) — Separate Workspace

**Status: IMPLEMENTED**

- WRQ1001 (بسام) referenced in code
- DashboardPage checks `empCode === 'WRQ1001'` to route to WarehouseDashboard
- WarehouseManagerWorkspace component exists
- WRQ1001 has `warehouse.manage` capability via role or direct grant

## Rule 16: Customer Credit System (credit_limit, credit_days)

**Status: PARTIALLY_IMPLEMENTED**

- `customers.credit_limit decimal, credit_days integer` columns exist
- `governed_create_customer` accepts p_credit_limit, p_credit_days parameters
- `governed_update_customer` updates credit fields
- Frontend CustomerProfilePage shows credit info
- Full credit lifecycle (applications, programs, contracts, collections) implemented in later migrations
- `credit.view`, `credit.manage` capabilities exist (20260604_credit_programs_v2)

## Summary of Gaps

| Gap | Severity | Details |
|-----|----------|---------|
| Direct/Managed customer types | HIGH | Entire feature missing per 04_CUSTOMER_RULES.md |
| Role-name checks in old RPCs | MEDIUM | ~20+ RPCs use hardcoded `r.name IN (...)` instead of `check_capability()` |
| Employee seeds not in migrations | MEDIUM | Key employees (ADMIN-001, WRQ1001-1006, REP001) are referenced but never INSERTed in migration files |
| Internal Sales role undefined | LOW | WRQ1005 existence unclear, no explicit role name |
| Supervisor role fragmentation | LOW | Mix of `مشرف مبيعات`, `مشرف تنفيذي`, `سوبر فايزر` across RPCs |
| governed_change_customer_ownership lacks scope check | LOW | Doesn't verify p_new_owner_id is within the changer's subtree |
