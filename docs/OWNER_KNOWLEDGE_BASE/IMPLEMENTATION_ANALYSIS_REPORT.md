# Implementation Analysis Report — 3 Critical Pipelines

> **Date:** 2026-06-10
> **Scope:** Analysis only — no fixes, no code changes, no migrations, no refactors
> **Source code verified:** OrderStatusManager, ApprovalQueuePage, DeliveryDetailPage, routes, credit.ts, governed_* RPC definitions

---

## Pipeline 1: Order Approval — ✅ RESOLVED (Phase 1)

> **Phase 1 completed and validated 2026-06-10.**  
> `governed_approve_order` wired from frontend for `submitted → approved` transition.  
> Daily Deal / Flash Offer inventory deduction at approval verified.  
> Audit trail (order_status_history) verified.  
> identity_id / employee_id issue fixed.  
> The analysis below is preserved for historical reference but the pipeline is no longer an open blocker.

### Why `governed_change_order_status` instead of `governed_approve_order`

The component `OrderStatusManager.tsx` (line 88) was built as a **generic status state machine**. It takes `canManage` / `canReview` / `canCompletePreparation` / `canSendToDelivery` flags and builds a list of allowed target statuses. Every transition — regardless of direction, significance, or side effects — is dispatched through the same RPC call:

```
src/components/orders/OrderStatusManager.tsx:88-93
supabase.rpc('governed_change_order_status', {
  p_token, p_order_id, p_new_status, p_reason
})
```

The design treats `submitted → approved` as equivalent to `approved → preparing` or `prepared → sent_to_delivery`. It has no concept of "this specific transition needs special handling."

`ApprovalQueuePage.tsx` (line 71) renders `OrderStatusManager` with `canManage` flag for users holding `orders.manage`. These users get a dropdown of ALL statuses, including `approved`. Selecting it triggers the same generic RPC.

The RPC called — `governed_change_order_status` — is defined in `20260610_fix_order_status_history_check.sql:35-116`. It does **exactly three things**:
1. Validates session + capability
2. `UPDATE orders SET status = p_new_status`
3. `INSERT INTO order_status_history`

That's it. No inventory, no deals, no credit.

`governed_approve_order` exists separately (defined in `20260603_flash_offers.sql:404-515`) but was never wired into any frontend component. It's dead code — defined, migrated, commented, but zero call sites in any `.ts`/`.tsx` file.

### Impact

| Resource | What `governed_approve_order` does | Current state |
|----------|-----------------------------------|---------------|
| **Product inventory** | `UPDATE inventory SET quantity = GREATEST(quantity - piece_quantity, 0)` per `order_items` | **Never deducted.** Products show pre-order quantities indefinitely. |
| **Daily Deal inventory** | Iterates `order_daily_deals`, deducts `available_quantity`, marks deal `sold_out` when depleted | **Never deducted.** Daily deals show stale availability. |
| **Flash Offer inventory** | Iterates `order_flash_offers`, deducts `available_quantity`, marks offer `sold_out` when depleted | **Never deducted.** Flash offers show stale availability. |
| **Credit reservation → outstanding** | `governed_approve_order` does NOT handle credit. Dedicated RPC `governed_convert_credit_reservation_to_outstanding` exists but is never called from anywhere (see Pipeline 3). | **No pipeline at all.** Credit customers never invoiced on approval (nor on delivery). |

### Owner-rule mismatch

- Owner: inventory deducted at **معتمد** (approved) — Not happening
- Owner: **Upper Management only** may approve جارى المراجعة → معتمد — Current system grants approval to any role with `orders.manage` (which includes roles like Sales Manager who should NOT approve per owner rules)

---

## Pipeline 2: Return Creation

### The broken navigation

```
ReturnsPage.tsx:44 →
  <button onClick={() => navigate('/returns/new')}>
    + مرتجع جديد
  </button>

routes/index.tsx:102-103 →
  /returns                  → ReturnsPage
  /returns/:id              → ReturnDetailPage
  /returns/new              → ❌ NO MATCHING ROUTE

routes/index.tsx:146 →
  <Route path="*" element={<Navigate to="/dashboard" replace />} />
```

The button navigates to `/returns/new`. No route exists for this path. The wildcard fallback (line 146) catches it and redirects to `/dashboard`. The user sees the dashboard instead of a return creation form.

### Route table gap

Of the 60+ routes registered in `routes/index.tsx`, patterns following `/{entity}/new` exist for:
- `/orders/new` (line 86)
- `/visits/new` (line 93)
- `/customers/new` (line 96)
- `/collections/new` (line 101)

`/returns/new` is the only missing `new` creation route among CRUD entities.

### What exists but is unreachable

The RPC `governed_create_return` is fully defined in `20260607_recovery_missing_functions.sql:1299` with proper governance:
```sql
governed_create_return(p_token uuid, p_order_id uuid, p_customer_id uuid, 
                       p_notes text DEFAULT NULL, p_items jsonb DEFAULT '[]')
```
- Requires capability: `returns.create`
- Enforces session validity
- Links to order (`p_order_id` is required — owner rule: "returns must link to previously purchased order")
- Accepts items array for partial returns (owner rule: "returns may include specific products or partial quantities")

The `returns` directory contains 3 files: `index.ts`, `ReturnsPage.tsx`, `ReturnDetailPage.tsx`. No `NewReturnPage.tsx` exists.

### What is missing to make it reachable

1. A **page component** (`NewReturnPage.tsx`) with a form:
   - Order selector (fetch customer's delivered orders)
   - Item picker (select which items + quantities)
   - Notes field
   - Submit handler calling `governed_create_return`
2. A **route registration** in `routes/index.tsx`:
   - `/returns/new` → NewReturnPage (with `requireCapability="returns.create"`)
3. An **export** in `src/pages/returns/index.ts`

---

## Pipeline 3: Credit — 3 Orphaned RPCs

All three RPCs follow the same pattern: **defined in SQL, wrapped in `creditService`, zero frontend call sites.**

```
src/services/credit.ts         → defines reserveCreditForOrder, releaseCreditReservation, convertReservationToOutstanding
src/**/*.ts, src/**/*.tsx      → zero imports of any of these three methods
grep across entire frontend    → only match is the definition in credit.ts itself
```

### 3a. `governed_reserve_credit_for_order`

**Defined:** `20260604_credit_programs_v2.sql:505-545`  
**Wrapped:** `credit.ts:89-96`  
**Called from frontend:** **Never** (zero call sites)

**What it does:**
- Validates session + order exists
- Loads customer credit account (must be `active`)
- Checks `available_credit = limit - outstanding - reserved`
- If `order.total > available`: returns error `INSUFFICIENT_CREDIT` with available/required values
- If sufficient: increments `reserved_credit`, sets `payment_method = 'credit'`
- **Does NOT** enforce owner rule: "orders still creatable/submittable when over limit" — it hard-blocks with error; would need modification to flag for UM review instead of blocking

**Where it SHOULD be called (per owner rules):**
| Owner rule | Says | Implication |
|------------|------|-------------|
| CREDIT_LIMIT_EXCEEDED_RULE | "Customer may still create and submit orders. Order requires UM review." | Reservation should flag over-limit, not hard-block |
| CREDIT_ENFORCEMENT | "Credit limit and credit period." | Reservation validates limit at order time |
| CREDIT_START_DATE | "Obligation begins on delivery." | Reservation is a **pre-check** before delivery, not the start of obligation |

**Recommended insertion point:** During order submission. When a credit customer submits an order, call this RPC to:
- Check available credit
- Reserve the amount (flag if over limit, don't block)
- Set payment_method = 'credit' on the order

### 3b. `governed_convert_credit_reservation_to_outstanding`

**Defined:** `20260604_credit_programs_v2.sql:583-637`  
**Wrapped:** `credit.ts:107-114`  
**Called from frontend:** **Never** (zero call sites)

**What it does:**
- Moves `reserved_credit → outstanding_credit` on the account
- Generates invoice number `CI-YYYYMMDD-N`
- Creates `credit_invoices` record with `issue_date`, `due_date` (= today + payment_term_days), status `open`
- Inserts debit entry in `customer_credit_ledger`

**Where it SHOULD be called (per owner rules):**
| Owner rule | Says | Implication |
|------------|------|-------------|
| CREDIT_START_DATE | "Credit obligation begins on delivery (تم الاستلام). Credit aging starts when order reaches delivered status." | **At delivery confirmation** |
| CREDIT_CUSTOMER_ACCOUNT | "Show current usage, remaining available credit." | After conversion, outstanding increases → usage reflects correctly |

**Recommended insertion point:** Inside `governed_complete_delivery` (`20260607_recovery_missing_functions.sql:1187`). Currently this RPC only updates delivery_tracking status and order status to `delivered`. It should also call the credit conversion for credit orders.

Currently `governed_complete_delivery`:
1. Updates delivery_tracking → `delivered`, sets `completed_at`
2. Updates orders → `delivered`, sets `delivered_at`
3. Returns success

Missing: credit conversion + invoice creation.

### 3c. `governed_release_credit_reservation`

**Defined:** `20260604_credit_programs_v2.sql:551-577`  
**Wrapped:** `credit.ts:98-105`  
**Called from frontend:** **Never** (zero call sites)  
**Called from any other RPC:** **Never** (not wired into cancellation/rejection flows)

**What it does:**
- Decrements `reserved_credit` by order total (floor at 0)

**Where it SHOULD be called (per owner rules):**
| Owner rule | Says | Implication |
|------------|------|-------------|
| ORDER_CANCELLATION_AUTHORITY | "Only UM may cancel orders." | Cancelled orders release reserved credit |
| INVENTORY_DEDUCTION_RULE | "Inventory deducted at معتمد." | If order reversed before delivery, reservation should be released |

**Recommended insertion points:**
- Inside `governed_change_order_status` when status moves to `cancelled`
- Inside `governed_reject_order` (which already exists but is never called)
- Called from frontend when user cancels a credit order before delivery

### Summary: Credit lifecycle as-implemented vs as-defined

| Stage | Owner-expected action | Current implementation |
|-------|----------------------|----------------------|
| Order creation (credit customer) | Check credit limit, reserve amount | **Nothing** — no credit check or reservation |
| Order submission (over limit) | Flag for UM review, don't block | **Nothing** — no check at all |
| Order approval (معتمد) | Deduct inventory (separate from credit) | `governed_change_order_status` — status only, no inventory |
| Order delivery (تم الاستلام) | Convert reservation → outstanding, create invoice | `governed_complete_delivery` — status only, no credit action |
| Order cancellation (before delivery) | Release reservation | `governed_change_order_status` — status only, no credit release |

### All call sites (proven zero)

```
grep 'reserveCreditForOrder' src/**/*.{ts,tsx}     → only src/services/credit.ts:89 (definition)
grep 'releaseCreditReservation' src/**/*.{ts,tsx}   → only src/services/credit.ts:98 (definition)
grep 'convertReservationToOutstanding' src/**/*.{ts,tsx} → only src/services/credit.ts:107 (definition)
grep 'governed_approve_order' src/**/*.{ts,tsx}     → zero matches
grep 'governed_reject_order' src/**/*.{ts,tsx}      → zero matches
grep 'governed_create_return' src/**/*.{ts,tsx}     → zero matches
grep 'governed_reserve_credit_for_order' src/**/*.{ts,tsx} → zero matches
grep 'governed_convert_credit_reservation_to_outstanding' src/**/*.{ts,tsx} → zero matches
grep 'governed_release_credit_reservation' src/**/*.{ts,tsx} → zero matches
```

---

## Summary of Required Fixes (what, not how)

| Pipeline | Problem | What needs to change |
|----------|---------|---------------------|
| 1. Order approval | `OrderStatusManager` sent all transitions through generic RPC that did no inventory/credit work | ✅ **RESOLVED (Phase 1)** — `governed_approve_order` wired for `submitted → approved`. Inventory/DD/FO deduction verified. |
| 1. Order rejection | `governed_reject_order` exists but unused | Rejection path needs to call `governed_reject_order` (or equivalent) for cancelled/rejected transitions, with reason and customer notification |
| 2. Return creation | `/returns/new` route missing + no page component | Create `NewReturnPage.tsx` (order selector, items picker, notes, `governed_create_return` call), register route at `/returns/new` |
| 3. Credit reservation | `governed_reserve_credit_for_order` never called | Call during order submission flow for credit customers; make it soft-check (flag over-limit for UM review, don't hard-block) |
| 3. Credit conversion | `governed_convert_credit_reservation_to_outstanding` never called | Call inside `governed_complete_delivery` or from frontend after delivery confirmed |
| 3. Credit release | `governed_release_credit_reservation` never called | Call inside cancellation/rejection flow (either in `governed_change_order_status` or frontend-side), only for orders with active credit reservation |
