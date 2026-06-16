# Upper Management Authority Audit

## Objective
Grant ياسر توفيق / محمد سعيد / علي سعيد / محمود سعيد unconditional full authority across all system layers — frontend, backend, RPCs, RLS, storage, schema grants, function execution — without weakening security for other users.

---

## UM Employees

| Name | Employee Code | Supabase Auth UID (identity_id) |
|------|--------------|-------------------------------|
| ياسر توفيق | `ADMIN-001` / `WRQ1006` | Resolved via `employees.identity_id` |
| محمد سعيد | `WRQ1003` | Resolved via `employees.identity_id` |
| علي سعيد | `WRQ1002` | Resolved via `employees.identity_id` |
| محمود سعيد | `WRQ1004` | Resolved via `employees.identity_id` |

---

## Detection Mechanism

### `public.is_upper_management(p_employee_id UUID DEFAULT NULL)`
- **File**: `supabase/migrations/20260706_role_normalization.sql:27`
- **Security**: `SECURITY DEFINER`, `SET search_path = public, extensions`
- **Logic**:
  1. If `p_employee_id` is NULL (RLS context): resolve `auth.uid()` → `employees.identity_id` → `employees.id`
  2. Check employee code against hardcoded list: `ADMIN-001`, `WRQ1006`, `WRQ1003`, `WRQ1002`, `WRQ1004`
  3. Fallback: check role name against `SUPER_ADMIN`, `ADMIN`, `CHAIRMAN`, `EXECUTIVE_MANAGER`

---

## Layer-by-Layer Audit

### LAYER 1: Frontend (React/TypeScript)

| File | Status | Mechanism |
|------|--------|-----------|
| `src/hooks/useCapability.ts` | ✅ | `isUpperManagementUser()` checks code OR role via `roleNormalization.ts` |
| `src/utils/roleNormalization.ts` | ✅ | `UM_CODES` + `isUpperManagement()` checks by code, then role name |
| `src/pages/dashboard/DashboardPage.tsx` | ✅ | Route protection via hierarchy over 7 target roles |
| `src/components/attendance/AttendanceRouter.tsx` | ✅ | UM can access attendance |
| `src/pages/dashboard/ModuleLauncherPage.tsx` | ✅ | UM sees all modules |

### LAYER 2: RPC Functions (SECURITY DEFINER)

All governed RPCs are `SECURITY DEFINER` and access `app.sessions` via `p_token`:

| RPC Group | File | UM Bypass |
|-----------|------|-----------|
| `check_capability()` | `20260706_role_normalization.sql:136` | ✅ Returns `true` for UM employees |
| `get_visible_employee_ids()` | `20260706_role_normalization.sql:186` | ✅ Returns ALL employees for UM |
| `governed_create_*` / `governed_update_*` / `governed_delete_*` | Various | ✅ Call `check_capability()` which bypasses for UM |
| `get_governed_*` read RPCs | Various | ✅ Call `check_capability()` or check visibility |
| Attendance RPCs | Various | ✅ All SECURITY DEFINER, work via session token |

### LAYER 3: GRANT USAGE ON SCHEMA

| Schema | GRANTed Role | Status | Fix |
|--------|-------------|--------|-----|
| `public` | `authenticated` | ✅ | `20260610_attendance_module.sql:1616` |
| `public` | `anon` | ✅ **FIXED** | `20260706_role_normalization.sql:250` |
| `app` | `authenticated` | ✅ **FIXED** | `20260706_role_normalization.sql:249` |
| `app` | `anon` | ❌ NOT NEEDED | No anon code accesses app schema |

### LAYER 4: DML GRANTs (Table-level)

| Table | SELECT | INSERT/UPDATE/DELETE | Status |
|-------|--------|---------------------|--------|
| `companies` | ✅ `anon, authenticated` | ✅ `authenticated` | ✅ |
| `orders` | ❌ | ✅ `authenticated` | ✅ (DML via RPCs) |
| `customers` | ❌ | ✅ `authenticated` | ✅ |
| `products` | ✅ `anon, authenticated` | ✅ `authenticated` | ✅ |
| `employees` | ❌ | ✅ `authenticated` | ✅ |
| `collections` | ❌ | ✅ `authenticated` | ✅ |
| `returns` | ❌ | ✅ `authenticated` | ✅ |
| `visits` | ❌ | ✅ `authenticated` | ✅ |
| `order_items` | ❌ | ✅ `authenticated` | ✅ |
| `credit_applications` | ❌ | ✅ `authenticated` | ✅ |
| `credit_contracts` | ❌ | ✅ `authenticated` | ✅ |
| `credit_programs` | ❌ | ✅ `authenticated` | ✅ |
| `delivery_tracking` | ❌ | ✅ `authenticated` | ✅ |
| `unified_locations` | ✅ `authenticated` | ✅ `authenticated` | ✅ |
| `product_units` | ✅ `anon, authenticated` | ❌ | ⚠️ Only SELECT needed |
| `inventory` | ✅ `anon, authenticated` | ❌ | ⚠️ Only SELECT needed |

### LAYER 5: RLS Policies

| Table | RLS Enabled | UM All Policy | Public Read Policy |
|-------|------------|---------------|-------------------|
| `companies` | ✅ (existing) | ✅ `upper_management_all_companies` | ✅ `Companies are publicly readable` |
| `orders` | ✅ **FIXED** | ✅ `upper_management_all_orders` | ❌ |
| `customers` | ✅ **FIXED** | ✅ `upper_management_all_customers` | ❌ |
| `products` | ✅ **FIXED** | ✅ `upper_management_all_products` | ❌ |
| `employees` | ✅ **FIXED** | ✅ `upper_management_all_employees` | ❌ |
| `collections` | ✅ **FIXED** | ✅ `upper_management_all_collections` | ❌ |
| `returns` | ✅ **FIXED** | ✅ `upper_management_all_returns` | ❌ |
| `visits` | ✅ **FIXED** | ✅ `upper_management_all_visits` | ❌ |
| `order_items` | ✅ **FIXED** | ✅ `upper_management_all_order_items` | ❌ |
| `credit_applications` | ✅ **FIXED** | ✅ `upper_management_all_credit_applications` | ❌ |
| `credit_contracts` | ✅ **FIXED** | ✅ `upper_management_all_credit_contracts` | ❌ |
| `credit_programs` | ✅ **FIXED** | ✅ `upper_management_all_credit_programs` | ❌ |
| `delivery_tracking` | ✅ **FIXED** | ✅ `upper_management_all_delivery_tracking` | ❌ |
| `unified_locations` | ✅ (existing) | ✅ `upper_management_all_unified_locations` | ✅ `unified_locations_read_all` |

### LAYER 6: Storage Buckets

| Bucket | Status | Note |
|--------|--------|------|
| None configured | 🟡 Not needed | Logo URLs stored as text strings, not file uploads |

### LAYER 7: Functions (GRANT EXECUTE)

All functions that need public access already have `GRANT EXECUTE TO authenticated` or `anon` in their respective migration files.

**Remaining gap**: No global `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;` — each function must be individually granted. This is the existing pattern.

### LAYER 8: `unified_locations` — RLS Enabled But No Policy (FIXED)

**Before fix**: `unified_locations` had `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` but zero policies → ALL access blocked.
**Fix**: Added `upper_management_all_unified_locations` (UM full access) + `unified_locations_read_all` (all authenticated read).

---

## Migration Summary

All fixes are in `supabase/migrations/20260706_role_normalization.sql`:

```sql
-- Schema grants
GRANT USAGE ON SCHEMA app TO authenticated;         -- Fix "permission denied for schema app"
GRANT USAGE ON SCHEMA public TO anon;                -- Fix storefront access

-- DML grants (new tables added)
GRANT INSERT, UPDATE, DELETE ON delivery_tracking TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON unified_locations TO authenticated;

-- RLS enable on tables with UM policies
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_tracking ENABLE ROW LEVEL SECURITY;

-- RLS policies for unified_locations
CREATE POLICY "upper_management_all_unified_locations" ON unified_locations ...;
CREATE POLICY "unified_locations_read_all" ON unified_locations FOR SELECT USING (true);
```

---

## Verification Checklist

- [ ] Apply migration to Supabase project
- [ ] Verify UM can PATCH companies (logo_url, is_visible, etc.)
- [ ] Verify UM can CREATE/UPDATE/DELETE products, orders, customers, employees
- [ ] Verify UM can access attendance, all modules
- [ ] Verify non-UM users are still restricted by existing governance
- [ ] Verify anon (unauthenticated) can still read companies/products/product_units/inventory
- [ ] Verify `unified_locations` is now accessible
- [ ] Check for any remaining "permission denied for schema app" errors

---

## Root Cause Analysis: "permission denied for schema app"

### Symptoms
Error `42501: permission denied for schema app` occurs when authenticated user performs certain operations (e.g., PATCH on companies).

### Root Cause
The `app` schema (created in `20260603_recovery_missing_tables.sql:17`) was never granted `USAGE` to any database role:

```sql
-- Was missing:
GRANT USAGE ON SCHEMA app TO authenticated;
```

### Why It Happened
- `app` schema was recovered from the live DB in a recovery migration
- The migration correctly created the schema and its objects (tables, functions)
- But the standard Supabase pattern of `GRANT USAGE ON SCHEMA ... TO authenticated` was omitted
- All functions that access `app.sessions` are `SECURITY DEFINER` (run as owner), so they worked
- However, any SECURITY INVOKER context (e.g., some RLS policy evaluation paths, internal PostgREST checks) that touches `app` schema would fail

### Fix
Added `GRANT USAGE ON SCHEMA app TO authenticated;` at `20260706_role_normalization.sql:249`.
