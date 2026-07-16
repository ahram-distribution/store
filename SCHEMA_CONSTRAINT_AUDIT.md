# Schema Constraint Audit — orders.owner_id

## Current State

**`orders.owner_id` has NO foreign key constraint.**

This was verified by querying `pg_constraint` on the live database. The `orders` table has these FK constraints:

| Column | FK Target | Exists? |
|--------|-----------|---------|
| `customer_id` | `customers(id)` | ✅ `fk_orders_customer` |
| `created_by` | `identities(id)` | ✅ `fk_orders_created_by` |
| `tier_id` | `tiers(id)` | ✅ `orders_tier_id_fkey` |
| `execution_location_id` | `unified_locations(id)` | ✅ `orders_execution_location_id_fkey` |
| **`owner_id`** | **NONE** | **❌ NO FK CONSTRAINT** |

## Root Cause

`orders.owner_id` is a polymorphic foreign key — it references either `employees.id` or `customers.id` depending on the `owner_type` discriminator column. PostgreSQL does not support conditional foreign keys natively. This design choice allowed the contamination to propagate without database-level rejection.

By contrast:
- `customers.owner_id` → HAS FK `fk_customers_owner` → `employees(id)` → **401/401 clean** ✅
- `visits.employee_id` → HAS FK `fk_visits_employee` → `employees(id)` → **467/467 clean** ✅
- `workday_sessions.employee_id` → HAS FK `fk_wds_employee` → `employees(id)` → **229/229 clean** ✅

Every non-polymorphic identity column has an FK constraint. Only the polymorphic `owner_id` columns are unconstrained.

## Other Unconstrained Owner Columns

| Table | Column | Current Data | Risk |
|-------|--------|-------------|------|
| `orders` | `owner_id` | 164 rows, 127 contaminated | HIGH — active contamination |
| `collections` | `owner_id` | 0 rows | LOW — no data |
| `returns` | `owner_id` | 0 rows | LOW — no data |
| `preparation_exceptions` | `created_by` | 0 rows | LOW — no data |
| `tracking_cleanup_log` | `employee_id` | 0 rows | LOW — no data |
| `workday_settings` | `updated_by` | 1 row, clean | LOW — 1 row, existing data correct |

## Recommended Hardening Strategy

Since `owner_type = 'employee'` implies `owner_id` must be `employees.id`, and `owner_type = 'customer'` implies `owner_id` must be `customers.id`, the constraint cannot be a simple FK. Three options exist:

### Option A: Trigger-Based Constraint (Recommended for Phase 5)

```sql
CREATE OR REPLACE FUNCTION assert_valid_owner() RETURNS trigger AS $$
BEGIN
  IF NEW.owner_type = 'employee' THEN
    IF NOT EXISTS (SELECT 1 FROM employees WHERE id = NEW.owner_id) THEN
      RAISE EXCEPTION 'owner_id % is not a valid employees.id for owner_type=employee', NEW.owner_id;
    END IF;
  ELSIF NEW.owner_type = 'customer' THEN
    IF NOT EXISTS (SELECT 1 FROM customers WHERE id = NEW.owner_id) THEN
      RAISE EXCEPTION 'owner_id % is not a valid customers.id for owner_type=customer', NEW.owner_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_assert_valid_owner
  AFTER INSERT OR UPDATE OF owner_id, owner_type ON orders
  FOR EACH ROW EXECUTE FUNCTION assert_valid_owner();
```

**Pros:** Correct semantics, validates against the right table per discriminator value.  
**Cons:** Trigger overhead on every write. Requires careful deployment (must be `NOT VALID` initially for existing data).  
**When:** Phase 5 — after data migration verified AND production observed for ≥ 2 weeks.

### Option B: NOT VALID FK + Application Enforcement (Simpler)

After data migration, add a FK that only covers `owner_type = 'employee'` rows:

```sql
-- Not directly possible — PostgreSQL FK cannot be conditional
```

This doesn't work natively. A partial FK is not a PostgreSQL feature.

### Option C: Schema Normalization (Cleanest, Most Invasive)

Split polymorphic `owner_id` into two nullable FK columns:

```sql
ALTER TABLE orders ADD COLUMN employee_owner_id UUID REFERENCES employees(id);
ALTER TABLE orders ADD COLUMN customer_owner_id UUID REFERENCES customers(id);
ALTER TABLE orders ADD COLUMN owner_type TEXT
  CHECK (owner_type IN ('employee', 'customer'))
  CHECK ((employee_owner_id IS NULL) <> (customer_owner_id IS NULL));  -- exactly one
ALTER TABLE orders DROP COLUMN owner_id;
```

**Pros:** Proper relational design. Database enforces referential integrity.  
**Cons:** Massive migration (all queries, views, RPCs, frontend code must change). Not practical for current phase.  

### Recommendation

**Do Option A (trigger) in Phase 5**, after production has stabilized for 2+ weeks post-migration. The trigger:
1. Is deployed as `NOT VALID` initially (doesn't check existing rows)
2. Is manually validated against existing data after deployment
3. Blocks any future writes with wrong owner_id at the database level
4. Is easily removable if performance issues arise

**Do NOT attempt Option C** until a major schema refactoring cycle.
