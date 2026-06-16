# RUNTIME INTEGRITY AUDIT REPORT

> **Project:** Ahram Distribution  
> **Audit Date:** 2026-06-02  
> **Method:** Runtime behavior analysis — trace user action → DB impact → UI result  
> **Scope:** Violations only. Code structure, styling, and patterns excluded.  

---

## V1 — Cart Price Drift (Storefront → Cart → Order Submit)

| Field | Detail |
|---|---|
| **Screen** | StorefrontPage → CartPage → OrderNewPage |
| **User action** | (1) Add product X to cart. (2) Wait. (3) Admin updates `products.carton_price` in DB. (4) View cart or submit order without re-visiting StorefrontPage. |
| **DB object** | `products.carton_price`, `products.carton_quantity` |
| **Expected result** | Cart item prices match current `products.carton_price`. Order total submitted to DB reflects current prices. |
| **Actual result** | Cart item `unitPrice` and `totalPrice` are captured at `addItem()` time (`src/store/cart.ts:62-88`) and stored in localStorage via Zustand persist (`ahram-cart`). `recalculateAll()` is called **only** on `selectTier()` (line 40), not on page mount, not on `setProducts()`, not before order submit. User submits `governed_create_order` with stale prices (`OrderNewPage.tsx:207-212`). |
| **Reproduce** | `1. Open product A (price=100). Add to cart. 2. In Supabase, update products set carton_price = 150 where id = 'A'. 3. Navigate to cart → price still shows 100. 4. Submit order → DB receives items at price=100.` |

---

## V2 — Dashboard Counters Never Refresh After Page Load

| Field | Detail |
|---|---|
| **Screen** | SalesDashboard, WarehouseDashboard, TransportDashboard |
| **User action** | (1) Open dashboard → sees "5 orders waiting preparation". (2) Warehouse prepares 3 of those orders. (3) Still viewing same dashboard tab. |
| **DB object** | RPC results: `get_dashboard_sales`, `get_dashboard_warehouse`, `get_dashboard_transport` |
| **Expected result** | Dashboard counters update to reflect current DB state (2 waiting). |
| **Actual result** | All dashboards fetch via `useEffect` with empty/stable dependency arrays → fire once on mount, never again. |
| **Reproduce** | `1. Open SalesDashboard → "10 pending orders". 2. Another user cancels 3 of those orders via OrderEditPage. 3. Same browser still shows "10 pending orders". 4. F5 → shows "7 pending orders".` |
| **Evidence** | SalesDashboard.tsx:29 `useEffect(() => { ... }, [])`, WarehouseDashboard.tsx:42 `useEffect(() => { ... }, [token])`, TransportDashboard.tsx:26 `useEffect(() => { ... }, [])` |

---

## V3 — WhatsApp Button Sends to Hardcoded Number

| Field | Detail |
|---|---|
| **Screen** | InvoiceView (order detail / invoice print page) |
| **User action** | Click "واتساب" button to share invoice with customer |
| **DB object** | None (should be config or DB-driven) |
| **Expected result** | WhatsApp message targets the company's actual WhatsApp Business number |
| **Actual result** | Hardcoded `'201040880002'` used as recipient (`InvoiceView.tsx:187`). If company phone changes, every invoice sent via WhatsApp goes to the wrong number. |
| **Reproduce** | `1. Open any order. 2. Click "واتساب". 3. WhatsApp opens with recipient 201040880002 regardless of company settings.` |

---

## V4 — OrderNewPage Submits Order Without GPS Location

| Field | Detail |
|---|---|
| **Screen** | OrderNewPage |
| **User action** | Sales rep selects customer, adds products, reviews order, clicks "إرسال الطلب" |
| **DB object** | `governed_create_order` RPC → `orders` row (contains `execution_latitude`, `execution_longitude`, `execution_source`, `execution_accuracy_meters`, `execution_captured_at` fields) |
| **Expected result** | Order created with GPS coordinates captured at submission time (location where the rep placed the order) |
| **Actual result** | `handleSubmit()` (`OrderNewPage.tsx:193-252`) calls `governed_create_order` with only `p_token, p_customer_id, p_notes, p_items`. No `navigator.geolocation.getCurrentPosition()` call exists anywhere in the file. GPS fields remain NULL in the orders row. |
| **Reproduce** | `1. Open OrderNewPage for any customer. 2. Add products, submit. 3. Query DB: SELECT execution_latitude FROM orders WHERE id = '<new order id>' → NULL` |

---

## V5 — Customer Status Depends on Browser Clock + Employee RLS

| Field | Detail |
|---|---|
| **Screen** | CustomerProfilePage |
| **User action** | Sales rep views a customer's profile → sees status badge (جديد/نشط/يحتاج متابعة/متوقف) |
| **DB object** | `runtime_order_visibility` (returned by `get_governed_orders`, may have RLS per employee) |
| **Expected result** | Same customer has the same status for all users viewing at the same moment |
| **Actual result** | Status is computed client-side (`CustomerProfilePage.tsx:86-96`): `lastOrderDays = Math.floor((Date.now() - new Date(lastOrder.created_at).getTime()) / 86400000)`. `Date.now()` is **browser clock** — two reps with different system times see different status. The `orders` array is filtered client-side from `get_governed_orders` results (line 49: `.filter(o => o.customer_id === id)`) — but `get_governed_orders` RPC may apply **RLS per employee**, meaning Rep A may see a different set of orders than Rep B for the same customer. |
| **Reproduce** | `1. Customer X's last order was 9 days ago. 2. Rep A (browser clock 1:00 PM) sees "يحتاج متابعة" (lastOrderDays=9). 3. Rep B (browser clock set 2 days behind) sees "نشط" (lastOrderDays=7). 4. Same DB, same customer, different UI status.` |
| **Evidence** | `Date.now()` at line 78, client-side status at lines 86-96, client-side filter at line 49. No DB status field exists. |

---

## V6 — Customer Monthly Sales Uses `Date.now()` Instead of DB-Precomputed Range

| Field | Detail |
|---|---|
| **Screen** | CustomerProfilePage (monthly sales display) |
| **User action** | View customer profile → "مبيعات الشهر" |
| **DB object** | `runtime_order_visibility.created_at` |
| **Expected result** | Monthly sales is consistent across all employees viewing at the same moment |
| **Actual result** | `MONTH_START` is computed client-side at module load: `const MONTH_START = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()` (`CustomerProfilePage.tsx:20`). This uses **browser clock**. Monthly sales are computed client-side by filtering `orders` array where `created_at >= MONTH_START` (line 66-68). Same issue as V5 — browser clock drift + RLS filtering cause different values for different employees. |
| **Reproduce** | `1. Rep A (browser time correct) sees monthly sales = 5000 EGP. 2. Rep B (browser time 2 days behind previous month) sees monthly sales = 8000 EGP (includes last month's orders).` |

---

## V7 — CompaniesPage Product Count Uses Two Non-Atomic Queries

| Field | Detail |
|---|---|
| **Screen** | CompaniesPage |
| **User action** | View company list → sees product count per company |
| **DB object** | `companies` (query 1) then `products` (query 2) |
| **Expected result** | Product count for each company is internally consistent for a single point in time |
| **Actual result** | Two separate `supabase.from(...).select(...)` calls (`CompaniesPage.tsx:20-44`). Between query 1 (companies) and query 2 (product counts), a product can be inserted or deleted. The product count shown may not match the actual number of products belonging to those companies at query 1 time. |
| **Reproduce** | `1. Company A has 5 products. 2. CompaniesPage query 1 returns [A]. 3. Admin adds product to A. 4. Query 2 returns count=6 for A. 5. User sees "6 منتج" but at query 1 moment there were only 5.` |

---

## V8 — OrderNewPage Cart Totals Are Not Recalculated on Quantity Update

| Field | Detail |
|---|---|
| **Screen** | OrderNewPage (review step, quantity adjustment) |
| **User action** | In review step, click +/− to change item quantity |
| **DB object** | None directly — but affects `total_price` submitted to `governed_create_order` |
| **Expected result** | Item `totalPrice` correctly recalculated from fresh `unitPrice * unitQuantity` |
| **Actual result** | `handleUpdateQty` (`OrderNewPage.tsx:183-191`) recalculates `totalPrice` as `(i.totalPrice / i.unitQuantity) * newQty` using the OLD ratio, NOT `unitPrice * newQty`. This works correctly for integer quantities but can drift due to floating-point rounding when the old `totalPrice` was already a rounded value. More critically, if the item's `unitPrice` was stale (see V1), changing the quantity compounds the stale price issue. |
| **Reproduce** | `1. Add item at price=100, qty=1 → totalPrice=100. 2. Click + twice → qty=3. 3. totalPrice = (100/1)*3 = 300. Correct in this case. BUT: 1b. Add item at price=33.33, qty=3 → totalPrice=99.99. 2b. Change qty to 4. 3b. totalPrice = (99.99/3)*4 = 133.32. But correct price should be 33.33*4 = 133.32. Works here too. Issue is WITH price drift: 1c. Stale price 100, actual price 120, qty=1 → totalPrice=100. 2c. Click +. 3c. totalPrice = (100/1)*2 = 200. Should be 120*2 = 240.` |

---

## SUMMARY TABLE

| # | Violation | Screen | User Action Triggers | DB Impact | Root Cause | Severity |
|---|---|---|---|---|---|---|
| **V1** | Cart price drift | Storefront → Cart | Add to cart → price change in DB | Wrong `unit_price` in `order_items` | Prices captured at add-time, not re-validated | 🔴 **HIGH** |
| **V2** | Dashboard counters stale | All dashboards | Open dashboard → DB changes | Stale counters displayed | `useEffect([],[])` — single fetch, no refresh | 🟡 **MEDIUM** |
| **V3** | WhatsApp hardcoded | InvoiceView | Click WhatsApp | None (config issue) | String literal `201040880002` | 🟡 **MEDIUM** |
| **V4** | No GPS on order submit | OrderNewPage | Submit order | `execution_latitude` = NULL | `handleSubmit` lacks geolocation call | 🟡 **MEDIUM** |
| **V5** | Customer status inconsistent | CustomerProfilePage | View profile | None (computed client-side) | `Date.now()` + client-side filter from RLS-limited orders | 🟡 **MEDIUM** |
| **V6** | Monthly sales inconsistent | CustomerProfilePage | View profile | None (computed client-side) | `MONTH_START` from browser clock + RLS-limited data | 🟢 **LOW** |
| **V7** | Companies product count race | CompaniesPage | View companies | Misleading count briefly | Two non-atomic queries | 🟢 **LOW** |
| **V8** | Qty update compounds stale price | OrderNewPage | Adjust qty in review | Wrong `total_price` submitted | Ratio-based recalculation on stale price | 🟢 **LOW** |

---

## VIOLATIONS REQUIRING DB RPC VERIFICATION

The following areas could not be fully verified because the Supabase RPC implementations were not inspected. If the RPCs do not validate/override client-submitted data, these become additional violations:

| Area | RPC | Client Passes | Risk |
|---|---|---|---|
| Order creation | `governed_create_order` | `p_items` serialized as JSON with `unit_price` and `total_price` | ⚠️ Client-submitted prices accepted as-is |
| Order status update | Direct `orders.update()` | `status`, `subtotal`, `total_amount` | ⚠️ After `governed_create_order`, page does `.update({ status: 'submitted' })` — client decides status |
| Order status history insert | Direct `order_status_history.insert()` | `from_status`, `to_status`, `reason` | ⚠️ Client-submitted audit trail can be fabricated |
| Customer data | `get_governed_customers` | Token only | ✅ Read-only RPC |

---

*End of RUNTIME_INTEGRITY_AUDIT_REPORT*
