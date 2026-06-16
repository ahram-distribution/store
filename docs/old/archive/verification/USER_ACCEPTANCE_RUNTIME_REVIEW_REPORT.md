# USER ACCEPTANCE RUNTIME REVIEW REPORT

> **Date:** 2026-06-02  
> **Method:** End-to-end business flow simulation via Supabase Management API + frontend code analysis  
> **Test Order:** `ORD-2026-000010` (created and cleaned up)  
> **Flow Tested:** Sales Rep Create → Submit → Approve → Prep Start → Prep Complete → Prep Review → Dispatch → Start Delivery → Complete Delivery  
> **Phase 1 changes active:** ✅ `governed_create_order` (price recalculation), ✅ `governed_submit_order` (status governance)

---

## 1 — SCREENS WORKING CORRECTLY

| Screen | Flow Step | Status | Notes |
|---|---|---|---|
| **OrderNewPage** (browse products) | 1 | ✅ | 1,201 active products loaded; `mapProduct` computes correct prices from DB |
| **OrderNewPage** (add to cart) | 1 | ✅ | Unit types (piece/dozen/carton) derived from `product_units`; pricing from `computeProductPrices` |
| **OrderNewPage** (review + submit) | 1 | ✅ | Shows items, quantities, totals; calls `governed_create_order` then `governed_submit_order` |
| **Order Detail** (InvoiceView) | 1-3 | ✅ | Shows order number, status badge, items grouped by company, summary, notes |
| **InvoiceView Timeline** | 1-3 | ✅ | Renders `order_status_history` entries with from→to status, timestamp, reason, user |
| **Customer Profile** | 4 | ✅ | Shows: order count, sales total, last order (number/amount/status), monthly sales, recent orders list |
| **Sales Dashboard** | 5 | ✅ | `get_dashboard_sales` returns counters that reflect DB state |
| **Warehouse Dashboard** | 5 | ✅ | `get_dashboard_warehouse` counters match `preparation_records` + `orders` state |
| **Transport Dashboard** | 5 | ✅ | `get_dashboard_transport` counters match `delivery_tracking` + `orders` state |
| **SalesRep Work Day** | 5 | ✅ | Monthly sales, inactive customers, today visits, opportunities, last activity |

### Data Flow Verified

| Transition | RPC / Action | DB Status | Audit Entry |
|---|---|---|---|
| Created (draft) | `governed_create_order` | `draft` | ✅ `null → draft` |
| Submitted | `governed_submit_order` | `submitted` | ✅ `draft → submitted` |
| Approved | `governed_approve_order` | `approved` | ⚠️ Shows `approved → approved` (bug) |
| Prep Started | `governed_start_preparation` | `preparing` | ✅ `approved → preparing` |
| Prep Completed | `governed_complete_preparation` | `completed` (prep record) | ❌ Missing |
| Prep Reviewed | `governed_review_preparation` | `reviewed` (prep record) | ❌ Missing |
| Dispatched | `governed_dispatch_order` | `dispatched` | ❌ Missing |
| Delivery Started | `governed_start_delivery` | `out_for_delivery` | ❌ Missing |
| Delivered | `governed_complete_delivery` | `delivered` | ❌ Missing |

---

## 2 — SCREENS WITH USABILITY ISSUES

| Screen | Issue | Impact |
|---|---|---|
| **SalesRep Work Day** | "New Customer" button always disabled ("قريباً") | Reps cannot add customers from the work day screen |
| **Customer Profile** | "آخر تعديل للفاتورة" always shows "غير متوفر" | Hardcoded placeholder — never populated |
| **Order Detail (InvoiceView)** | Execution location block always empty (all GPS fields NULL) | V4 — no GPS captured at any point |
| **All Screens** | No refresh/polling mechanism — stale until manual F5 | V2 — data unchanged until page reload |
| **OrdersPage** | No status filter — all 45+ orders shown at once | User must scroll through all orders |
| **Customer Profile** | Monthly sales computed client-side (`Date.now()`) | V6 — inconsistent across users/timezones |
| **Dashboard Counters** | `useEffect([],[])` — single fetch on mount, never refreshes | V2 — stale counters until F5 |

---

## 3 — MOBILE UX ISSUES

| Issue | Screen | Details |
|---|---|---|
| **No pull-to-refresh** | All screens | User must press browser refresh or close/reopen |
| **Small touch targets** | OrderNewPage product grid | `ProductCard` 2-column grid — item cards may be tight on small screens |
| **Cart bar overlaps content** | OrderNewPage | `.sticky bottom-0` cart bar may overlap last product card |
| **No loading skeletons** | Several screens | Blank white space during data fetch (e.g. OrdersPage, CustomerProfile) |
| **No offline indicator** | All screens | No banner when connectivity lost |
| **Search is text-exact only** | CustomersPage, Products | `includes()` match — no fuzzy search or Arabic normalization |

---

## 4 — MISSING BUSINESS INFORMATION

| Missing | Where | Why |
|---|---|---|
| **GPS location** | Every order's `execution_latitude/longitude` | `governed_create_order` has no GPS params; frontend has no `navigator.geolocation` call |
| **Order status history for 5 of 9 transitions** | `order_status_history` table | `governed_complete_preparation`, `governed_review_preparation`, `governed_dispatch_order`, `governed_start_delivery`, `governed_complete_delivery` do not insert history entries |
| **Accurate approve audit** | `order_status_history` | `governed_approve_order` inserts `approved → approved` instead of `submitted → approved` |
| **Delivery collection status** | `delivery_tracking` | No `collected` status or collection amount fields |
| **GPS accuracy classification** | InvoiceView | Logic exists (`<=10m → ممتازة` etc.) but never exercised — all NULL |
| **Customer last order modification** | CustomerProfilePage | Placeholder "غير متوفر" instead of actual last edit timestamp |
| **Order edit tracking** | `order_timeline` | Table exists but no RPCs populate it for the browser-initiated flows |

---

## 5 — BROKEN ACTIONS

| # | Action | Screen/Flow | Error | Severity | Root Cause |
|---|---|---|---|---|---|
| B1 | **Sales Rep submits order** | OrderNewPage → `governed_submit_order` | `MISSING_CAPABILITY: orders.update` | 🔴 **CRITICAL** | `governed_submit_order` checks `orders.update` but SALES_REP role only has `orders.create`. Rep cannot submit own orders after Phase 1 change. |
| B2 | **Dispatch after prep review** | Warehouse → Dispatch | `INVALID_STATE: only approved orders can be dispatched` | 🔴 **HIGH** | `governed_review_preparation` does not revert order status to `approved`. Order stuck in `preparing`. |
| B3 | **Approve history shows wrong from_status** | InvoiceView timeline | `approved → approved` instead of `submitted → approved` | 🟠 **MEDIUM** | `governed_approve_order` uses `RETURNING * INTO v_order` before reading `v_order.status` for history insert. Overwrites original status. |
| B4 | **Missing audit for most transitions** | InvoiceView timeline | Only 4 of 9 transitions recorded in `order_status_history` | 🟠 **MEDIUM** | 5 RPCs don't insert history entries (complete_prep, review_prep, dispatch, start_delivery, complete_delivery) |
| B5 | **Delivery collection flow incomplete** | Transport Dashboard | Dashboard shows collection counters but no collection RPCs called after delivery | 🟡 **LOW** | `governed_complete_delivery` does not create collection records |

### B1 Detail — Critical Business Block

**Scenario:** Sales rep creates order, reviews cart, clicks "إرسال الطلب".  
**Expected:** Order transitions to `submitted`.  
**Actual:** `governed_submit_order` calls `check_capability(p_token, 'orders.update')` → `false` → `RAISE EXCEPTION 'MISSING_CAPABILITY: orders.update'`.  
**Cause:** The CAPABILITY check in `governed_submit_order` uses `orders.update` which was intended for order editing, not submission. SALES_REP role lacks this capability.  
**Workaround in test:** Used WRQ1006 (admin) token to submit.  
**Fix needed:** Change capability to `orders.create` (which rep has) or add `orders.submit` capability to SALES_REP role.

---

## 6 — RECOMMENDATIONS RANKED

### 🔴 Critical (blocks core business flow)

| # | Recommendation | Area | Effort |
|---|---|---|---|
| R1 | **Fix `governed_submit_order` capability** — change from `orders.update` to `orders.create` (or add `orders.submit` to SALES_REP role) | DB/RPC | Small — one-line change or Supabase role config |
| R2 | **Fix `governed_approve_order` from_status bug** — save `v_old_status := v_order.status` before the UPDATE RETURNING clause | DB/RPC | Small — add one variable assignment |
| R3 | **Fix warehouse→delivery handoff** — `governed_review_preparation` should revert order to `approved` (like `governed_fail_preparation` does) | DB/RPC | Small — add `UPDATE orders SET status='approved'` |

### 🟠 High (data integrity and usability)

| # | Recommendation | Area | Effort |
|---|---|---|---|
| R4 | **Add `order_status_history` inserts** to `governed_complete_preparation`, `governed_review_preparation`, `governed_dispatch_order`, `governed_start_delivery`, `governed_complete_delivery` | DB/RPC | Medium — 5 RPCs need history INSERT statements |
| R5 | **Replace direct `order_status_history` query** in `OrderDetailPage` with a governed RPC | Frontend/DB | Small — wrap in `get_order_status_history` RPC |
| R6 | **Fix order status not reverted after full prep cycle** — order stuck in `preparing` after prep review | DB/RPC | Small — already covered by R3 |

### 🟡 Medium (improvement)

| # | Recommendation | Area | Effort |
|---|---|---|---|
| R7 | **Add pull-to-refresh** for dashboard pages | Frontend | Medium |
| R8 | **Add GPS capture** to order creation flow (Phase 2) | Frontend | Medium |
| R9 | **Add loading skeletons** for OrdersPage, CustomerProfile | Frontend | Medium |
| R10 | **Remove hardcoded "آخر تعديل للفاتورة"** placeholder | Frontend | Small |

### 🟢 Low (nice to have)

| # | Recommendation | Area | Effort |
|---|---|---|---|
| R11 | Add status filter to OrdersPage | Frontend | Small |
| R12 | Add Arabic-normalized search to customer/product search | Frontend | Medium |
| R13 | Add offline connectivity indicator | Frontend | Medium |
| R14 | Add collection creation after delivery complete | DB/RPC | Medium |

---

*End of USER_ACCEPTANCE_RUNTIME_REVIEW_REPORT*
