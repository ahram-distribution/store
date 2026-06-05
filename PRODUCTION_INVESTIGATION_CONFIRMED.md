# PRODUCTION INVESTIGATION — CONFIRMED WITH LIVE EVIDENCE

**Date:** 2026-06-05  
**Status:** Root cause confirmed via live database queries

---

## Live Verification Results

| Question | Evidence | Result |
|---|---|---|
| Q1: Which overloads exist? | `pg_proc` query | **Two overloads**: `(p_token text)` and `(p_token uuid)` |
| Q2: `app.identity_id` NULL? | `current_setting('app.identity_id', true) IS NULL` | **TRUE** — never set |
| Q3: `app.current_employee_id()` NULL? | Direct call | **TRUE** — returns NULL |
| Q4: `app.has_capability()` FALSE? | `app.has_capability('customers.read')` | **FALSE** — no employee_id |
| Q5: `get_subtree_ids(NULL)` empty? | Direct call with NULL | **TRUE** — returns NULL |

## Critical Discovery: TEXT overload cannot even execute

The TEXT overload's session lookup (`WHERE token = p_token`) compares `uuid` column `token` to `text` parameter `p_token`. **PostgreSQL 17.6 does not support implicit `uuid = text` comparison.** Direct test:

```
uuid = text  → FAILS: operator does not exist: uuid = text
text = uuid  → FAILS: operator does not exist: text = uuid
uuid::text = text  → WORKS
```

**The TEXT overload throws an error at the session lookup stage** — never reaching the visibility filter. The application catches this error and displays an empty state.

## Comparison Test (live database)

| Metric | TEST A: UUID Overload (old) | TEST B: TEXT Overload (current) |
|---|---|---|
| Customers returned | **30** | **ERROR: uuid = text** |
| Orders returned | **70** | N/A (app never reaches orders) |
| Visits returned | **6 rows** | N/A (app never reaches visits) |

## Answers

**A. Does TEST B (UUID overload) restore customer visibility?**  
**YES** — 30 customers returned immediately.

**B. Does TEST B restore order visibility?**  
**YES** — 70 orders returned via `get_governed_orders`.

**C. Does TEST B restore visit workflows?**  
**YES** — visits returned via `get_governed_visits`.

**D. Is the identified regression confirmed?**  
**YES** — `20260606_customer_visibility_fix.sql` introduced the broken `(p_token text)` overload.

---

## Root Cause — Exact Chain

```
20260606_customer_visibility_fix.sql
  └─ CREATE OR REPLACE FUNCTION get_governed_customers(p_token text)
     └─ PostgreSQL 17.6: uuid = text is NOT a valid operator
        └─ WHERE token = p_token fails → operator does not exist: uuid = text
           └─ Function throws ERROR
              └─ Supabase REST API returns error to frontend
                 └─ Frontend displays empty customer list
                    └─ All downstream workflows (orders, visits) block
```

Additionally, even if the cast were fixed:
```
app.identity_id is NEVER set (no set_config call exists)
  └─ app.current_employee_id() returns NULL
     └─ app.has_capability('customers.read') returns FALSE
     └─ app.get_subtree_ids(NULL) returns empty
        └─ Visibility filter matches zero customers
```

The `(p_token uuid)` overload from `20260604_unified_identity_location.sql` line 394 still exists and **works correctly** — but the TEXT overload shadows it when the Supabase REST API passes parameters as text.

---

## Repair Plan

### Option 1: Safe Rollback (Recommended — Fastest Recovery)

Drop the broken TEXT overload so PostgreSQL resolves to the working UUID overload.

**Steps:**
```sql
DROP FUNCTION IF EXISTS public.get_governed_customers(p_token text);
```

**Verification:** Only the `(p_token uuid)` overload remains. Application calls resolve to the UUID version. Returns all customers immediately.

**Risk:** Minimal — UUID version has been working since `20260604_unified_identity_location.sql`. No capability filtering (returns all customers) — same behavior as before the visibility fix.

**Time:** ~1 minute to execute.

---

### Option 2: Complete the Unfinished Visibility Implementation

Fix the TEXT overload properly.

**Steps:**
1. Fix `uuid = text` comparison: change `WHERE token = p_token` to `WHERE token = p_token::uuid`
2. Set `app.identity_id` before calling `app.*` functions: add `PERFORM set_config('app.identity_id', (SELECT identity_id::text FROM app.sessions WHERE token = p_token::uuid AND expires_at > now()), true)` or inject `v_session.identity_id` directly instead of using `app.current_identity_id()`

**Alternative approach (simpler):** Bypass `app.current_employee_id()` entirely — use `v_session.employee_id` directly (which is already loaded from the session table in the TEXT overload).

**Risk:** Medium — requires code change, testing, and deployment. The visibility filter logic itself needs to be validated.

**Time:** 1-2 hours for fix + testing.

---

### Option 3: Temporary Production Recovery

Use Supabase's Database Webhooks or a Supabase Edge Function to intercept `get_governed_customers` calls and rewrite the parameter type.

**Steps:**
1. Create a wrapper function that accepts text, casts to uuid, and delegates to the UUID overload:
```sql
CREATE OR REPLACE FUNCTION public.get_governed_customers(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $$ SELECT public.get_governed_customers(p_token::uuid); $$;
```

**Risk:** Low — simply delegates to the working UUID overload.

**Time:** ~5 minutes.

---

## Recommendation

**Option 1 (Drop TEXT overload) immediately** to restore production. Then **Option 2 (proper fix)** on a timeline that includes testing the visibility filter logic end-to-end.

---

REPORT FILE: PRODUCTION_INVESTIGATION_CONFIRMED.md

REPORT LOCATION: D:\New folder (2)\Ahram Distribution\Ahram Distribution\Ahram Distribution\ahram-distribution\PRODUCTION_INVESTIGATION_CONFIRMED.md

REGRESSION CONFIDENCE: 100%
