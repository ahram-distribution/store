# Enforcement Strategy — Permanent Identity Integrity

**Date:** 2026-07-14  
**Purpose:** Evaluate approaches for permanently enforcing that polymorphic `owner_id` columns store only valid business PKs (not Auth UUIDs), and recommend the best strategy for Phase 5.

---

## Problem Statement

Six columns in the schema lack referential integrity constraints (from `SCHEMA_CONSTRAINT_AUDIT.md`):

| Table | Column | FK? | Issue |
|-------|--------|-----|-------|
| `orders` | `owner_id` | ❌ | Polymorphic (employee/customer), no FK |
| `collections` | `owner_id` | ❌ | Polymorphic, no FK |
| `returns` | `owner_id` | ❌ | Polymorphic, no FK |
| `orders` | `created_by` | ✅ | Has FK to `employees(identity_id)` — correct |
| `orders` | `changed_by` | ✅ | Has FK to `employees(identity_id)` — correct |
| (3 more polymorphic) | | ❌ | Same pattern |

The core challenge: `owner_id` is **polymorphic** — it can reference `employees.id` (when `owner_type IS NULL` or `'employee'`) or `customers.id` (when `owner_type = 'customer'`). A simple FK cannot handle conditional references.

Additionally, the Auth UUID (`employees.identity_id`) and the Business PK (`employees.id`) are both valid UUIDs in the `employees` table. A FK to `employees.id` alone would prevent `identity_id` values (since they are different UUIDs), but cannot handle the customer case.

---

## Option Comparison

### Option 1: Trigger-Based Enforcement (Recommended)

A `BEFORE INSERT OR UPDATE` trigger on each polymorphic table that validates `owner_id` based on `owner_type`.

**Mechanism:**
```sql
CREATE OR REPLACE FUNCTION enforce_owner_id_ref()
RETURNS trigger AS $$
BEGIN
  IF NEW.owner_type IS NULL OR NEW.owner_type = 'employee' THEN
    IF NOT EXISTS (SELECT 1 FROM employees WHERE id = NEW.owner_id) THEN
      RAISE EXCEPTION 'owner_id % is not a valid employees.id', NEW.owner_id;
    END IF;
  ELSIF NEW.owner_type = 'customer' THEN
    IF NOT EXISTS (SELECT 1 FROM customers WHERE id = NEW.owner_id) THEN
      RAISE EXCEPTION 'owner_id % is not a valid customers.id', NEW.owner_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_enforce_owner_id
  BEFORE INSERT OR UPDATE OF owner_id, owner_type ON orders
  FOR EACH ROW EXECUTE FUNCTION enforce_owner_id_ref();
```

**Pros:**
- Handles polymorphic FK semantics natively
- Immediate error on violation (atomic with the DML)
- No schema change needed
- Can be `CREATE OR REPLACE` for idempotent deployment
- Can log violations or auto-resolve (e.g., auto-convert identity_id → id)
- Deployable per-table independently

**Cons:**
- Not visible in `\d orders` output (need to check triggers separately)
- Slight per-row overhead (one existence check)
- Requires `plpgsql` function (already available)
- Violations produce PostgreSQL errors — must handle in application

**Overhead:** ~0.1–0.5ms per row (indexed lookup on `employees.id`)

**Risk of false positives:** ZERO — employees.id and employees.identity_id are disjoint UUID sets. No valid identity_id will be mistaken for a valid id.

**Migration safety:** HIGH — can be deployed as a `CREATE OR REPLACE` migration. Existing data is already clean, so no existing rows will fail the trigger.

---

### Option 2: Simple Foreign Key (Not Feasible Alone)

`FOREIGN KEY (owner_id) REFERENCES employees(id)` cannot handle:
- Customer-owned orders (`owner_type = 'customer'`)
- Polymorphic semantics

A partial FK is not supported in PostgreSQL (no `WHERE` clause on FK).

**Composite check (FK + CHECK) would be:**
```sql
ALTER TABLE orders ADD CONSTRAINT fk_orders_owner_employee
  FOREIGN KEY (owner_id) REFERENCES employees(id);
ALTER TABLE orders ADD CONSTRAINT fk_orders_owner_customer
  FOREIGN KEY (owner_id) REFERENCES customers(id);
```

This fails — a single column cannot have two FKs referencing different tables. One of them will always fail.

**Verdict:** ❌ Not feasible for polymorphic columns.

---

### Option 3: Two-Column Approach (Cleanest but Largest Change)

Replace single `owner_id` with two nullable columns:
- `employee_owner_id UUID REFERENCES employees(id)`
- `customer_owner_id UUID REFERENCES customers(id)`

Remove `owner_type` entirely — presence of a value in either column determines ownership.

**Pros:**
- True FK enforcement with no trigger overhead
- Self-documenting schema
- No polymorphism ambiguity at the DB level
- Works with ERD tools, ORMs, query planners

**Cons:**
- Schema migration: ALTER TABLE, backfill, code changes everywhere
- All read paths, write paths, views, RLS, mappers, frontend filters must change
- Risk of both columns being set (application invariant)
- Risk of both columns being null (application invariant)
- Large diff across frontend + backend + DB
- High regression surface

**Migration difficulty:** VERY HIGH — affects every layer of the stack.

**Verdict:** ❌ Over-engineered for the current problem. Consider only if a major refactor is planned anyway.

---

### Option 4: CHECK Constraint with Function

PostgreSQL allows CHECK constraints to call functions. A STABLE function can validate the reference:

```sql
CREATE OR REPLACE FUNCTION is_valid_owner_id(owner_id uuid, owner_type text)
RETURNS boolean STABLE AS $$
BEGIN
  IF owner_type IS NULL OR owner_type = 'employee' THEN
    RETURN EXISTS (SELECT 1 FROM employees WHERE id = owner_id);
  ELSIF owner_type = 'customer' THEN
    RETURN EXISTS (SELECT 1 FROM customers WHERE id = owner_id);
  END IF;
  RETURN false;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE orders ADD CONSTRAINT chk_orders_owner_id
  CHECK (is_valid_owner_id(owner_id, owner_type));
```

**Pros:**
- Visible in `\d orders` output
- Standard PostgreSQL constraint mechanism
- Enforced on all writes, even direct SQL

**Cons:**
- CHECK constraints referencing other tables are **not recommended** by PostgreSQL docs. The function must be STABLE, but the lookup is VOLATILE (table data changes). PostgreSQL may optimize the CHECK away or produce inconsistent results.
- Cannot call `EXISTS (SELECT ...)` in a true STABLE function if the referenced table changes within the same transaction.
- PG has a history of bugs with cross-table CHECK constraints.

**Verdict:** ⚠️ Technically possible but fragile. Not recommended for production enforcement.

---

### Option 5: Domain Type

```sql
CREATE DOMAIN employee_business_id AS UUID
  CHECK (VALUE = ...);  -- Cannot reference another table here
```

Domain CHECK constraints in PostgreSQL cannot reference other tables (they must be immutable). This only works for format validation (e.g., `VALUE IS NOT NULL`), not referential integrity.

**Verdict:** ❌ Not applicable for referential enforcement.

---

### Option 6: RLS-Only Enforcement

Trust the application layer (RPC functions) and RLS policies to enforce correctness. This is the **current approach** — `governed_create_order` resolves identity_id → employees.id before writing.

**Pros:**
- Zero schema changes
- No trigger overhead
- Application logic is flexible

**Cons:**
- Does NOT protect against direct SQL inserts by privileged users
- Does NOT protect against bugs in other RPC functions
- Does NOT protect against future migration code
- The current incident proves this approach failed once

**Verdict:** ❌ Already failed once. Must be supplemented with DB-level enforcement.

---

## Recommendation

### Primary: Trigger-Based Enforcement

Deploy BEFORE INSERT/UPDATE triggers on all 6 polymorphic columns:

| Priority | Table | Column | Owner Type Column |
|----------|-------|--------|-------------------|
| Immediate | `orders` | `owner_id` | `owner_type` |
| Immediate | `collections` | `owner_id` | `owner_type` |
| Immediate | `returns` | `owner_id` | `owner_type` |
| Follow-up | (next 3) | (same pattern) | |

The trigger validates `owner_id` against the correct table based on `owner_type`. It prevents any `identity_id` value from being stored in `owner_id` because `identity_id` values do not exist in the `id` column of the target table.

### Secondary: CREATE OR REPLACE Function

Make the enforcement function replaceable so future improvements don't require DROP/CREATE cycles.

### Not Recommended: Two-Column Refactor

The two-column approach is architecturally cleaner but carries disproportionate risk and effort for the current state. Revisit if a major schema refactor is ever undertaken.

---

## Draft Migration — Phase 5

```sql
-- ============================================================================
-- Phase 5: Add trigger-based enforcement for polymorphic owner_id columns
-- ============================================================================

-- Enforcement function (shared by all polymorphic tables)
CREATE OR REPLACE FUNCTION enforce_owner_id_ref()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_type IS NULL OR NEW.owner_type = 'employee' THEN
    IF NOT EXISTS (SELECT 1 FROM employees WHERE id = NEW.owner_id) THEN
      RAISE EXCEPTION 'owner_id % is not a valid employees.id', NEW.owner_id;
    END IF;
  ELSIF NEW.owner_type = 'customer' THEN
    IF NOT EXISTS (SELECT 1 FROM customers WHERE id = NEW.owner_id) THEN
      RAISE EXCEPTION 'owner_id % is not a valid customers.id', NEW.owner_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Apply trigger to orders
CREATE TRIGGER trg_orders_enforce_owner_id
  BEFORE INSERT OR UPDATE OF owner_id, owner_type ON orders
  FOR EACH ROW
  EXECUTE FUNCTION enforce_owner_id_ref();

-- Apply trigger to collections
CREATE TRIGGER trg_collections_enforce_owner_id
  BEFORE INSERT OR UPDATE OF owner_id, owner_type ON collections
  FOR EACH ROW
  EXECUTE FUNCTION enforce_owner_id_ref();

-- Apply trigger to returns
CREATE TRIGGER trg_returns_enforce_owner_id
  BEFORE INSERT OR UPDATE OF owner_id, owner_type ON returns
  FOR EACH ROW
  EXECUTE FUNCTION enforce_owner_id_ref();

-- Repeat for remaining polymorphic columns after audit
```

---

## Rollback Strategy

```sql
DROP TRIGGER IF EXISTS trg_orders_enforce_owner_id ON orders;
DROP TRIGGER IF EXISTS trg_collections_enforce_owner_id ON collections;
DROP TRIGGER IF EXISTS trg_returns_enforce_owner_id ON returns;
DROP FUNCTION IF EXISTS enforce_owner_id_ref();
```

Rollback is instantaneous — no data loss, no backfill needed.

---

## Summary

| Approach | Feasibility | Risk | Effort | Recommendation |
|----------|-------------|------|--------|----------------|
| Trigger | ✅ High | Low | Low (1 function + 3 triggers) | **PRIMARY** |
| FK | ❌ Low | N/A | N/A | Not feasible (polymorphic) |
| Two-Column | ✅ High | Very High | Very High | Revisit if major refactor |
| CHECK | ⚠️ Medium | Medium | Low | Not recommended |
| Domain | ❌ Low | N/A | N/A | Cannot reference other tables |
| RLS-only | ✅ High | High | Zero | Already failed once |
