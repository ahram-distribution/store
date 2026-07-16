# Canonical Identity Standard

**Permanent architecture document — Version 1.0**  
**Date:** 2026-07-14  
**Status:** Ratified  
**Supersedes:** All prior implicit identity conventions

---

## 1. The Three-Layer Identity Model

The platform manages three distinct identity domains. Each serves a different purpose and MUST NOT be substituted for another.

```
┌─────────────────────────────────────────────────────────┐
│                 AUTH SYSTEM (invisible)                  │
│                    auth.users.id                        │
│         Supabase Auth internal — NEVER stored           │
│              in application tables                      │
├────────────────────────┬────────────────────────────────┤
│   BUSINESS LAYER       │      AUDIT / SESSION LAYER     │
│   employees.id         │      employees.identity_id     │
│   customers.id         │      (→ identities.id)         │
│                        │                                │
│   Stable business PK   │      Auth UUID from Supabase   │
│   Used in FK refs      │      Used in audit trails      │
│   Never changes        │      Changes if auth reset     │
└────────────────────────┴────────────────────────────────┘
```

### Layer 1: Business Primary Key (`employees.id`)

Stable, permanent identifier assigned to each employee record. This is the canonical key for all business relationships.

### Layer 2: Auth UUID (`employees.identity_id`)

Supabase Auth identity UUID, maps to `identities.id` and `auth.users.id`. Used to identify who performed an action in audit contexts.

### Layer 3: Auth System Internal (`auth.users.id`)

Supabase internal identifier. **Never stored in application tables.**

---

## 2. Complete Field Classification

### 2.1 Business Foreign Key Fields → MUST contain `employees.id`

These fields represent business ownership, assignment, or hierarchy relationships. They MUST always reference `employees.id`.

| Table | Column | Purpose | Verified |
|-------|--------|---------|----------|
| `employees` | `id` | Primary key of employees table | ✅ System PK |
| `employees` | `manager_id` | Employee's manager (hierarchy) | ✅ 33/33 clean |
| `visits` | `employee_id` | Sales rep who performed visit | ✅ 467/467 clean |
| `tracking_points` | `employee_id` | Employee whose location was tracked | ✅ 3826/3826 clean |
| `workday_sessions` | `employee_id` | Employee who clocked in/out | ✅ 229/229 clean |
| `workday_breaks` | `employee_id` | Employee who took break | ✅ 24/24 clean |
| `attendance_audit_log` | `employee_id` | Employee whose attendance changed | ✅ 412/412 clean |
| `deletion_audit_log` | `employee_id` | Employee who performed deletion | ✅ 36/36 clean |
| `session_recovery_log` | `employee_id` | Employee who recovered session | ✅ 2/2 clean |
| `tracking_cleanup_log` | `employee_id` | Employee who triggered cleanup | ✅ 0 rows (empty) |
| `employee_monthly_targets` | `employee_id` | Employee being targeted | ✅ 36/36 clean |
| `employee_roles` | `employee_id` | Employee assigned to role | ✅ 34/34 clean |
| `employee_work_policies` | `employee_id` | Employee under policy | ✅ 31/31 clean |
| `employee_weight_overrides` | `employee_id` | Employee with weight override | ✅ 1/1 clean |
| `employee_capabilities` | `employee_id` | Employee with capabilities | ✅ 0 rows (empty) |
| `employee_advances` | `employee_id` | Employee receiving advance | ✅ 0 rows (empty) |
| `delivery_tracking` | `assigned_to` | Delivery person assigned | ✅ 3/3 clean |
| `orders` | `owner_id` | Business owner of order | ❌ **127/164 CONTAMINATED** |
| `collections` | `owner_id` | Business owner of collection | ✅ 0 rows (empty) |
| `returns` | `owner_id` | Business owner of return | ✅ 0 rows (empty) |
| `customers` | `owner_id` | Sales rep who owns customer | ✅ 401/401 clean |
| `customer_ownership_history` | `previous_owner_id` | Prior owner of customer | ✅ (no audit data) |
| `customer_ownership_history` | `new_owner_id` | New owner of customer | ✅ (no audit data) |

**Owner-type discrimination:** When `owner_type = 'employee'`, the corresponding `owner_id` contains `employees.id`. When `owner_type = 'customer'`, `owner_id` contains `customers.id`. Tables with this pattern: `orders`, `collections`, `returns`, `customers`.

### 2.2 Audit Trail Fields → MUST contain `employees.identity_id`

These fields record which auth identity performed an action. They MUST contain the Auth UUID (`employees.identity_id`), NOT the business PK (`employees.id`).

| Table | Column | Purpose | Verified |
|-------|--------|---------|----------|
| `orders` | `created_by` | Who created the order | ✅ 164/164 clean |
| `order_status_history` | `changed_by` | Who changed order status | ✅ 513/513 clean |
| `collections` | `created_by` | Who recorded the collection | ✅ 0 rows (empty) |
| `collections` | `approved_by` | Who approved the collection | ✅ 0 rows (empty) |
| `returns` | `created_by` | Who created the return | ✅ 0 rows (empty) |
| `return_status_history` | `changed_by` | Who changed return status | ✅ 0 rows (empty) |
| `customer_ownership_history` | `changed_by` | Who changed customer owner | ✅ 28/28 clean |
| `employee_work_policies` | `updated_by` | Who updated the policy | ✅ 30/30 clean |
| `workday_settings` | `updated_by` | Who updated settings | ✅ 1/1 clean |
| `employee_advances` | `created_by` | Who created the advance | ✅ 0 rows (empty) |
| `employee_advances` | `approved_by` | Who approved the advance | ✅ 0 rows (empty) |
| `credit_applications` | `created_by` | Who submitted the application | ✅ 0 rows (empty) |
| `credit_applications` | `approved_by` | Who approved the application | ✅ 0 rows (empty) |
| `customer_credit_ledger` | `created_by` | Who recorded the ledger entry | ✅ 0 rows (empty) |
| `daily_deals` | `created_by` | Who created the deal | ✅ 10/10 clean |
| `flash_offers` | `created_by` | Who created the offer | ✅ 9/9 clean |
| `auctions` | `created_by` | Who created the auction | ✅ 7/7 clean |
| `auction_participants` | `approved_by` | Who approved participant | ✅ 5/5 clean |
| `expenses` | `created_by` | Who submitted the expense | ✅ 0 rows (empty) |
| `expenses` | `approved_by` | Who approved the expense | ✅ 0 rows (empty) |
| `preparation_exceptions` | `created_by` | Who logged the exception | ✅ 2/2 clean |
| `preparation_records` | `cancelled_by` | Who cancelled the preparation | ✅ 2/2 clean |
| `treasury_transactions` | `created_by` | Who initiated the transaction | ✅ 0 rows (empty) |

### 2.3 Auth UUID Fields → Contain `identities.id`

| Table | Column | Purpose | Notes |
|-------|--------|---------|-------|
| `employees` | `identity_id` | Maps employee to auth identity | FK to `identities.id` |
| `customers` | `identity_id` | Maps customer to auth identity | FK to `identities.id` |
| `identities` | `id` | Auth identity primary key | System PK |
| `app.sessions` | `identity_id` | Session auth identity | Login identity |

### 2.4 Discriminator Fields

| Table | Column | Values | Purpose |
|-------|--------|--------|---------|
| `orders` | `owner_type` | `'employee'` or `'customer'` | Determines if owner_id references employees.id or customers.id |
| `collections` | `owner_type` | `'employee'` or `'customer'` | Same |
| `returns` | `owner_type` | `'employee'` or `'customer'` | Same |
| `customers` | `owner_type` | `'employee'` or `'customer'` | Same |
| `identities` | `identity_type` | `'employee'` or `'customer'` | Determines identity type |
| `app.sessions` | `identity_type` | `'employee'` or `'customer'` | Session type |

---

## 3. Class Definitions

### Class: BUSINESS_FK (`employees.id`)

| Attribute | Value |
|-----------|-------|
| **Purpose** | Establish business ownership, assignment, or hierarchy between employees and business entities |
| **Owner** | `employees` table — the `id` column |
| **Allowed usage** | `owner_id`, `employee_id`, `manager_id`, `assigned_to`, and all other FK columns linking a business entity to an employee |
| **Forbidden usage** | Audit trail columns (`created_by`, `changed_by`, etc.). Session auth UUID (`app.sessions.identity_id`). Any column that records "who performed an action" rather than "who owns/is assigned this entity" |
| **Business justification** | `employees.id` is stable. It never changes. Business relationships (who owns which customer, who manages which employee) must survive auth provider migrations, password resets, and identity changes. Using the auth UUID would break these relationships if the auth system is reseeded. |
| **Resolution function** | `SELECT id FROM employees WHERE identity_id = $1` — maps auth UUID to business PK |

### Class: AUDIT_TRAIL (`employees.identity_id`)

| Attribute | Value |
|-----------|-------|
| **Purpose** | Record which auth identity performed an action for audit/history purposes |
| **Owner** | `identities` table — the `id` column (sourced from Supabase Auth) |
| **Allowed usage** | `created_by`, `changed_by`, `updated_by`, `approved_by`, `cancelled_by`, and all other `*_by` columns |
| **Forbidden usage** | Business FK columns (`owner_id`, `employee_id`, `manager_id`, etc.). The auth UUID is NOT a substitute for business relationships. |
| **Business justification** | Audit trails need to link back to the authenticated identity that performed an action. If an employee's auth identity changes (new phone number, auth reset), the audit trail still correctly identifies who performed the action at that time. The business `employees.id` can change on identity reseeding, but the audit log must be immutable. |
| **Resolution function** | Auth UUID is used directly — no resolution needed |

### Class: AUTH_UUID (`identities.id`)

| Attribute | Value |
|-----------|-------|
| **Purpose** | Link application entities to Supabase Auth identities |
| **Owner** | Supabase Auth system |
| **Allowed usage** | Only in `employees.identity_id` and `customers.identity_id` FK columns. Only in `app.sessions.identity_id` for session tracking. |
| **Forbidden usage** | Any business FK or audit trail column. Only the dedicated `identity_id` columns on `employees` and `customers` may store this value. |
| **Business justification** | The auth UUID is the Supabase-level identifier. It must be kept separate from business keys to allow auth provider changes without affecting business operations. |

### Class: DISCRIMINATOR

| Attribute | Value |
|-----------|-------|
| **Purpose** | Determine which entity type an `owner_id` references |
| **Owner** | Application logic |
| **Allowed usage** | `owner_type` columns that sit alongside `owner_id` to indicate whether the owner is an employee or customer |
| **Forbidden usage** | Using discriminator alone without the corresponding ID field |
| **Business justification** | Enables polymorphic ownership (both employees and customers can own orders) |

---

## 4. Enforcement Rules

### Rule 1: Code Reviews
Every new column or field that stores an employee/user reference MUST be classified as one of the three identity types before code review. The classification MUST be documented in the schema definition.

### Rule 2: No Direct `auth.users.id` in Application Tables
The value `auth.users.id` from Supabase Auth MUST NEVER be stored in any application table. Only `employees.identity_id` (which maps through `identities.id`) may be stored.

### Rule 3: Write-Path Validation
Every INSERT or UPDATE of a BUSINESS_FK field MUST validate that the value is an `employees.id`, not an `employees.identity_id`. The canonical resolution function:
```sql
SELECT id FROM employees WHERE identity_id = v_session.identity_id;
```
MUST be used whenever a session identity needs to be resolved to a business PK.

### Rule 4: Read-Path Simplification
Read paths MUST join on `employees.id` only. The workaround pattern:
```sql
LEFT JOIN employees emp ON o.owner_id = emp.id OR o.owner_id = emp.identity_id
```
Is a TEMPORARY compatibility measure that MUST be removed after data migration.

### Rule 5: Migration Validation
Every database migration that touches identity columns MUST include a verification step that checks referential integrity.

### Rule 6: Monitoring
A periodic monitoring query MUST check that no BUSINESS_FK field contains an `employees.identity_id` value. Any violation triggers an alert.

---

## 5. Canonical Resolution Functions

```sql
-- Map Auth UUID → Business PK
CREATE OR REPLACE FUNCTION public.resolve_employee_id(p_identity_id uuid)
RETURNS uuid LANGUAGE sql STABLE AS
$$
  SELECT id FROM employees WHERE identity_id = p_identity_id;
$$;

-- Validate that a value is a business FK (not auth UUID)
CREATE OR REPLACE FUNCTION public.assert_business_fk(p_value uuid)
RETURNS boolean LANGUAGE sql STABLE AS
$$
  SELECT EXISTS (SELECT 1 FROM employees WHERE id = p_value);
$$;
```

---

## 6. Code Review Checklist

For every code change involving employee/user identity:

- [ ] Is the field classified as BUSINESS_FK, AUDIT_TRAIL, or AUTH_UUID?
- [ ] If BUSINESS_FK: does the value come from `employees.id` (NOT `employees.identity_id`)?
- [ ] If BUSINESS_FK: is the session identity resolved through `SELECT id FROM employees WHERE identity_id = ...`?
- [ ] If AUDIT_TRAIL: does the value come from `employees.identity_id` (NOT `employees.id`)?
- [ ] If AUTH_UUID: is it only stored in a dedicated `identity_id` column?
- [ ] Does any join use `OR` between `employees.id` and `employees.identity_id`? (temporary only)
- [ ] Does any frontend filter compare `owner_id` against `user?.identity_id` instead of `user?.employee_id`?

---

## 7. Migration & Compliance History

| Date | Event |
|------|-------|
| 2026-07-14 | Standard ratified |
| [Future] | Data migration: `orders.owner_id` 127 contaminated rows fixed |
| [Future] | Write-path hardening: `SupabaseSalesOrderProvider.placeNewOrder()` fixed |
| [Future] | Read-path simplification: OR joins removed from `runtime.get_team_activity` |
| [Future] | Read-path simplification: OR joins removed from `runtime_event_views` |
| [Future] | Frontend correction: `OrdersPage.tsx` filter uses `employee_id` |
| [Future] | Frontend correction: `EmployeeAnalysisPage.tsx` uses `employees.id` |

---

*This standard is the definitive reference for identity field usage across the platform. All future development MUST comply with the classifications and rules defined herein.*
