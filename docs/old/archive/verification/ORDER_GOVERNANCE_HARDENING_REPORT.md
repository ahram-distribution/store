# ORDER GOVERNANCE HARDENING REPORT — PHASE 1

> **Date:** 2026-06-02  
> **Scope:** Make the database the final authority for order pricing, status transitions, and audit trail  
> **Method:** PL/pgSQL RPC rewrite + frontend migration from direct table access to governed RPCs

---

## 1 — ORIGINAL FAILURES (from BUSINESS_RUNTIME_VERIFICATION_REPORT.md)

| Test | Area | Status | Root Cause |
|---|---|---|---|
| TEST 4 | Order Price Validation | ❌ FAIL | `governed_create_order` accepted client-submitted `unit_price`/`total_price` without DB validation |
| TEST 9 | GPS Capture | ❌ FAIL | No `navigator.geolocation` call — deferred to Phase 2 |
| TEST 10 | DB Source of Truth — Prices | ❌ FAIL | Client prices stored verbatim, no lookup against `products.carton_price` |
| TEST 10 | DB Source of Truth — Status | ❌ FAIL | Browser called `orders.update({ status: 'submitted' })` directly |
| TEST 10 | DB Source of Truth — Audit | ❌ FAIL | Browser inserted `order_status_history` with arbitrary values |

---

## 2 — ROOT CAUSES

### governed_create_order (price pass-through)
```sql
-- OLD: client-submitted prices stored without validation
INSERT INTO public.order_items (..., unit_price, total_price)
VALUES (..., (v_item->>'unit_price')::numeric, (v_item->>'total_price')::numeric);
```

### Order submission bypass
```typescript
// OLD: browser directly wrote order status + audit trail
await supabase.from('orders').update({ status: 'submitted', ... }).eq('id', orderId);
await supabase.from('order_status_history').insert({ ... });
```

### Token type mismatch
`app.sessions.token` is `uuid` but initial rewritten function used `p_token text`, causing `operator does not exist: uuid = text` at runtime.

---

## 3 — DATABASE OBJECTS MODIFIED

### Function: `public.governed_create_order`
- **Signature:** `(p_token uuid, p_customer_id uuid, p_notes text DEFAULT NULL, p_items jsonb DEFAULT '[]')`
- **Returns:** `public.orders`
- **Changes:**
  - Calls `check_capability(p_token, 'orders.create')`
  - For each item: looks up `products.carton_price` and `carton_quantity`
  - Computes unit_price by `unit_type`:
    - `'piece'` → `ROUND(carton_price / carton_quantity, 2)`
    - `'dozen'` → `ROUND(carton_price / carton_quantity * 12, 2)`
    - `'carton'` → `ROUND(carton_price, 2)`
  - Rejects with `PRODUCT_NOT_FOUND` if product missing
  - Rejects with `PRICE_NOT_CONFIGURED` if carton_price ≤ 0 or carton_quantity ≤ 0
  - Rejects with `INVALID_UNIT_TYPE` for unknown unit types
  - Ignores client-submitted `unit_price` and `total_price` in `p_items`
  - Updates `orders.subtotal` and `orders.total_amount` from recalculated item totals
  - Inserts `order_status_history` with `from_status NULL, to_status 'draft'`

### Function: `public.governed_submit_order`
- **Signature:** `(p_token uuid, p_order_id uuid)`
- **Returns:** `public.orders`
- **Behavior:**
  - Validates session, rejects `identity_type = 'customer'`
  - Checks `orders.update` capability
  - Enforces `status = 'draft'` — rejects with `INVALID_STATE` otherwise
  - Transitions order to `'submitted'`, sets `submitted_at = now()`
  - Inserts `order_status_history` with `from_status 'draft', to_status 'submitted'`

---

## 4 — FRONTEND FILES MODIFIED

### `src/pages/orders/OrderNewPage.tsx`

| Change | Before | After |
|---|---|---|
| Order submission | `supabase.from('orders').update({ status: 'submitted', ... })` | `supabase.rpc('governed_submit_order', { p_token, p_order_id })` |
| Audit trail | `supabase.from('order_status_history').insert({ ... })` | Handled by `governed_submit_order` RPC |
| Unused imports | `useAuthStore` import + `user` destructure | Removed |
| Unused variables | `subtotal`, `totalAmount` computed client-side | Removed (computed by RPC) |

---

## 5 — VALIDATION SCENARIOS EXECUTED

| # | Scenario | Expected | Actual | Status |
|---|---|---|---|---|
| 1 | `governed_create_order` with invalid UUID token | `INVALID_SESSION` exception | `INVALID_SESSION` raised | ✅ PASS |
| 2 | `governed_create_order` with client `unit_price=1` | DB stores recalculated price (89.00) | `unit_price = 89.00` stored | ✅ PASS |
| 3 | Order `subtotal` and `total_amount` after creation | Match recalculated item totals | `subtotal = 445, total_amount = 445` | ✅ PASS |
| 4 | `governed_submit_order` on draft order | Status changes to `submitted`, audit trail created | Status `submitted`, history `draft→submitted` | ✅ PASS |
| 5 | `governed_submit_order` on non-draft order | `INVALID_STATE` exception | `INVALID_STATE` raised | ✅ PASS |
| 6 | Client `unit_price=0.01` for carton with DB price 6408 | DB stores 6408 (ignores client) | `unit_price = 6408` stored | ✅ PASS |

---

## 6 — VALIDATION RESULTS

| Metric | Value |
|---|---|
| Tests executed | 6 |
| PASS | 6 |
| FAIL | 0 |
| TypeScript check | `tsc --noEmit` — 0 errors |

### Verified assertions
- `governed_create_order` is the **only** variant (single function, `p_token uuid`)
- Source contains `v_calculated_unit_price`, `FROM public.products WHERE id =`, `total_amount` — no client unit_price usage
- `governed_submit_order` is the **only** variant (single function, `p_token uuid`)
- No ungoverned `%order%` functions exist in `public` schema
- `OrderNewPage.tsx` has zero instances of `orders.update()` or `order_status_history.insert()`

---

## 7 — REMAINING RISKS

| Risk | Severity | Notes |
|---|---|---|
| RLS policies allow direct table writes | 🟠 MEDIUM | `orders` has INSERT/UPDATE policies, `order_status_history` has ALL policy — other clients or future code could bypass RPCs |
| Cart price drift (stale localStorage) | 🟠 MEDIUM | `useCartStore` captures prices at `addItem()` time, never refreshes from DB — but RPC now enforces DB prices on submit, so stale client prices are overridden |
| GPS capture | 🔴 **Phase 2** | Zero orders have GPS data — requires `navigator.geolocation` integration in creation flow |
| 1/4 price ratio anomaly | 🟡 LOW | Historical orders show prices at 1/4 of current DB prices — prices were apparently correct at creation time but DB changed afterward |
| Token type coupling | 🟡 LOW | `p_token uuid` matches `sessions.token` column type; any schema change to token type would require RPC updates |

---

## 8 — DEFERRED ITEMS (PHASE 2)

| Item | Description |
|---|---|
| **GPS Capture** | Add `navigator.geolocation.getCurrentPosition()` before `governed_create_order` call; pass `execution_latitude`, `execution_longitude`, `execution_accuracy_meters`, `execution_captured_at` |
| **Cart Price Freshness** | Re-validate `useCartStore` prices against DB on page mount and before submit; call `recalculateAll()` on `setProducts()` |
| **RLS Hardening** | Remove direct INSERT/UPDATE policies on `orders` and `order_status_history`; enforce all mutations through governed RPCs |
| **Historical Audit** | Consider adding `governed_*` RPCs for all remaining status transitions (cancel, edit, etc.) |
| **Unit Test Suite** | Add automated tests for `governed_create_order` and `governed_submit_order` edge cases |
