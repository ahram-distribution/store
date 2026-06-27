# BUSINESS RUNTIME VERIFICATION REPORT

> **Project:** Ahram Distribution  
> **Verification Date:** 2026-06-02  
> **Method:** Real Supabase DB queries (service_role via Management API) + runtime code analysis  
> **Tests Executed:** 10  
> **PASS:** 5 | **FAIL:** 3 | **SKIP:** 2  

---

## 1 — EXECUTIVE SUMMARY

**Overall: 3 BUSINESS-CRITICAL FAILURES identified.**

Products and Customers are correctly bound to the database. However, the **Order Pricing pipeline has a complete break in data integrity** — the `governed_create_order` RPC accepts client-submitted prices without validation, and **no orders in the database have GPS data**, rendering location tracking non-functional.

| Area | Status | Verification |
|---|---|---|
| Product Prices | ✅ PASS | UI pricing logic correctly derives from DB |
| Product Availability | ✅ PASS | Zero-price products correctly blocked |
| Order Creation | ⚠️ SKIP | 41 orders exist in DB, items sum check deferred |
| Order Price Validation | ❌ **FAIL** | RPC stores client prices without DB validation |
| Warehouse Flow | ✅ PASS | 4 orders in pipeline, status history tracked |
| Delivery Flow | ⚠️ SKIP | No orders reached delivery stage |
| Customer Profiles | ✅ PASS | Orders, sales, status computable from DB |
| Dashboard Counters | ✅ PASS | DB counters available via RPCs |
| GPS Capture | ❌ **FAIL** | 0 of 41 orders have GPS data |
| DB Source of Truth | ❌ **FAIL** | Order prices submitted by client, not validated by DB |

---

## 2 — PASS RESULTS

### TEST 1: Product Price Truth — ✅ PASS (5/5)

| Product | DB carton_price | DB carton_qty | UI Piece | UI Dozen | UI Carton | Active Types |
|---|---|---|---|---|---|---|
| 1454 | 33122.00 | 192 | — | 2070.13 | 33122 | carton, dozen |
| 1455 | 27501.00 | 192 | — | 1718.81 | 27501 | carton, dozen |
| 853 | 23500.80 | 144 | 163.20 | 1958.40 | — | piece, dozen |
| 1254 | 23460.00 | 600 | — | 469.20 | 23460 | carton, dozen |
| 892 | 22521.60 | 144 | 156.40 | 1876.80 | — | piece, dozen |

**Verdict:** All UI computed prices match DB-derived prices. `mapProduct` logic produces correct results for all pricing profiles (carton-only, piece+dozen, carton+dozen).

### TEST 2: Product Availability Truth — ✅ PASS (20/20)

- **20 products checked**: 5 with DB price > 0 (show in UI), 15 with DB price = 0 (blocked by UI)
- Zero-price products are correctly sales-blocked even when they have active unit types
- DB-inactive products are filtered out by StorefrontPage's `.eq('is_active', true)` query — UI never sees them
- **No false positives or false negatives**

### TEST 5: Warehouse Flow — ✅ PASS

- **Order status distribution:** submitted: 31, approved: 4, draft: 3, reviewing: 3
- **4 orders in warehouse pipeline** (approved status)
- **Status history tracked:** 12 entries recorded in `order_status_history` (3 → draft, 5 → approved, 4 → preparing)
- DB-driven status transitions verified

### TEST 7: Customer Profile — ✅ PASS

| Customer | Orders | Total Sales | Computed Status |
|---|---|---|---|
| Customer A | 17 | 129,719.60 EGP | جديد (< 7 days since created) |
| Customer B | 3 | 16,697.40 EGP | جديد |
| Customer C | 2 | 62,420.40 EGP | جديد |

**Verdict:** Customer data in DB is complete. Status computation logic works. Sales totals and order counts match DB. Credit limits present.

### TEST 8: Dashboard Counters — ✅ PASS

| Counter | DB Value |
|---|---|
| Pending Orders | 31 |
| Approved Orders | 4 |
| Warehouse Active | 0 |
| Out for Delivery | 0 |
| Delivered Today | 0 |
| Inactive Customers | 0 |

**Verdict:** Counter values computable from DB. Dashboards use `get_dashboard_*` RPCs which read from these tables.

---

## 3 — FAIL RESULTS

### TEST 4: Order Price Validation — ❌ FAIL (Critical)

**What was tested:** Do submitted order item prices match current DB product prices?

**Method:** Queried 10 order_items with positive prices, compared `unit_price` (submitted at order creation) against `products.carton_price` (current DB value).

**Result: 10/10 items FAILED — all submitted prices differ from current DB prices.**

| Order | Unit Type | Submitted Price | Current DB Price | Ratio | Issue |
|---|---|---|---|---|---|
| May 19 | carton | 738.00 | 2952.00 | 0.25× | Exactly 1/4 of current price |
| May 19 | carton | 432.00 | 3240.00 | 0.13× | Fraction of current price |
| May 17 | carton | 1860.00 | 7440.00 | 0.25× | Exactly 1/4 of current price |
| May 17 | carton | 1860.00 | 7440.00 | 0.25× | Exactly 1/4 of current price |
| May 19 | carton | 1860.00 | 7440.00 | 0.25× | Exactly 1/4 of current price |
| (5 more) | carton | 1860.00 | 7440.00 | 0.25× | Same pattern |

**Root cause confirmed — `governed_create_order` RPC source code (obtained from DB):**

```
INSERT INTO public.order_items (order_id, product_id, unit_type, unit_quantity,
    piece_quantity, unit_price, total_price)
VALUES (
  v_order.id,
  (v_item->>'product_id')::uuid,
  v_item->>'unit_type',
  (v_item->>'unit_quantity')::int,
  COALESCE((v_item->>'piece_quantity')::int, 0),
  (v_item->>'unit_price')::numeric,      ← CLIENT SUBMITTED
  (v_item->>'total_price')::numeric      ← CLIENT SUBMITTED
);
```

**The RPC does NOT query `products.carton_price` anywhere.** It takes `unit_price` and `total_price` directly from the JSON object passed by the client (`p_items`). No validation, no recalculation.

**Compounding factor — Cart Price Drift (Audit V1):** The 1/4 ratio pattern (1860 vs 7440) suggests prices were correct at order creation time but the DB prices changed afterward. Combined with the fact that client prices are never validated by the RPC, a user with a stale localStorage cart can submit arbitrary prices.

**Impact:** If an attacker or buggy client submits `unit_price: 0` for all items, the RPC stores it. If the cart store has stale prices ($100 instead of $150), the RPC stores the stale price. **The DB has no defense against incorrect client-submitted pricing.**

### TEST 9: GPS Verification — ❌ FAIL

**What was tested:** Do orders in the database have GPS location data?

**Method:** Queried all 41 orders for `execution_latitude`, `execution_longitude`, `execution_accuracy_meters`, `execution_captured_at`.

**Result: 0 of 41 orders have any GPS data. All GPS fields are NULL.**

| Field | Orders with Data | Orders NULL |
|---|---|---|
| execution_latitude | 0 | 41 |
| execution_longitude | 0 | 41 |
| execution_accuracy_meters | 0 | 41 |
| execution_captured_at | 0 | 41 |
| execution_source | 0 | 41 |

**Root cause:** `OrderNewPage.handleSubmit()` (verified from source) calls `governed_create_order` with parameters: `p_token`, `p_customer_id`, `p_notes`, `p_items`. No `navigator.geolocation.getCurrentPosition()` call exists. The RPC itself has no GPS parameters either.

**Impact:** No location data is captured for any order. The `InvoiceView` component has execution info display logic (maps URL, source, accuracy, capture time) — this section will always be empty because no data is ever captured.

### TEST 10: Database Source of Truth — ❌ FAIL

| Area | Source of Truth | Verdict |
|---|---|---|
| **Products** | DB (`products.carton_price`, `product_units`) | ✅ PASS — UI reads from DB, mapProduct derives prices correctly |
| **Customers** | DB (`get_governed_customers` RPC) | ✅ PASS — RLS-enforced, read-only from DB |
| **Order Prices** | **Client (browser)** | ❌ **FAIL** — RPC accepts client-submitted prices without validation |
| **Order Status** | **Client (browser)** | ❌ **FAIL** — After RPC creates order, client updates status directly: `orders.update({ status: 'submitted' })` |
| **Order Audit** | **Client (browser)** | ❌ **FAIL** — Client inserts `order_status_history` with arbitrary `from_status`, `to_status`, `reason` |
| **Warehouse** | DB | ✅ PASS — Status transitions via DB queries |
| **Delivery** | DB | ✅ PASS — Status transitions via DB queries |

**The `governed_create_order` RPC is a pass-through for pricing data.** It creates the order and items correctly but never validates:
- That `unit_price` matches `products.carton_price` / quantity
- That `total_price` equals `unit_price * unit_quantity`
- That any price is > 0

The `from_status` and `to_status` fields in `order_status_history` are also client-submitted, allowing arbitrary status transitions in the audit trail.

---

## 4 — DATABASE TRUTH RISKS

| Risk | Area | Mechanism | Severity |
|---|---|---|---|
| **Stale Price Submission** | Orders | Cart store persists prices in localStorage → submitted to RPC without validation → stored in DB | 🔴 **HIGH** |
| **Arbitrary Price Submission** | Orders | RPC accepts `unit_price` and `total_price` from client without checking against DB | 🔴 **HIGH** |
| **Client-Set Order Status** | Orders | After RPC, client does `orders.update({ status: 'submitted' })` — no RPC validates this transition | 🟠 **MEDIUM** |
| **Client-Fabricated Audit Trail** | Orders | `order_status_history` insert with arbitrary `from_status`, `to_status`, `reason` from client | 🟠 **MEDIUM** |
| **No GPS Capture** | Orders | `execution_latitude` etc. always NULL — feature non-functional | 🟠 **MEDIUM** |

---

## 5 — BUSINESS RISKS

### 🔴 BUSINESS RISK 1: Order Pricing Can Be Wrong
**Probability: HIGH. Impact: HIGH.**

**Scenario:** A sales rep adds items to cart on their phone at 10:00 AM. At 11:00 AM, the pricing manager updates `products.carton_price` in the DB. The rep submits the order at 11:30 AM. The order_items show the 10:00 AM prices, not the 11:00 AM prices. The DB stores these as-is.

**Why this happens:**
1. `useCartStore` captures prices at `addItem()` time (cart.ts:62)
2. Prices are stored in localStorage via Zustand persist
3. `recalculateAll()` only runs on tier change, never on page load
4. `governed_create_order` RPC inserts whatever `unit_price` the client sends
5. **No DB-side validation exists**

### 🟠 BUSINESS RISK 2: No Order Location Data
**Probability: CERTAIN. Impact: MEDIUM.**

**Scenario:** Every order in the database has NULL GPS fields. No manager can verify where orders were placed. Route optimization, territory compliance, and delivery planning cannot use location data.

### 🟠 BUSINESS RISK 3: Inflated/Deflated Order Values
**Probability: LOW. Impact: HIGH.**

**Scenario:** A client-side bug (or intentional manipulation) submits `unit_price: 0` or `unit_price: 100000` for items. The RPC stores it. The order total reflects the manipulated price. No DB check exists to catch this.

---

## 6 — FIX PRIORITY ORDER

| Priority | Fix | Area | Current State | Target State |
|---|---|---|---|---|
| **P0 🔴** | `governed_create_order` RPC: reject or recalculate client-submitted prices against `products.carton_price` | DB/RPC | Pass-through of client prices | RPC validates `unit_price` against `products.carton_price / carton_quantity`, rejects if > 1% deviation |
| **P1 🔴** | `useCartStore`: re-validate prices against DB on page mount and before order submit | Cart | Prices captured at addItem(), never refreshed | `recalculateAll()` called on `setProducts()` + before submit |
| **P2 🟠** | `OrderNewPage.handleSubmit`: capture GPS before calling RPC | Frontend | No GPS capture | `navigator.geolocation.getCurrentPosition()` → pass to RPC |
| **P3 🟠** | Add RPC for order status updates with validation | DB/RPC | Client does `orders.update()` directly | Validated RPC for status transitions |
| **P4 🟠** | Add RPC for order status history with validation | DB/RPC | Client inserts arbitrary audit entries | Validated RPC with restricted `from_status`/`to_status` pairs |

---

*End of BUSINESS_RUNTIME_VERIFICATION_REPORT*
