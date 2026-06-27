# Phase C2 — Business Weight Policy

**Status:** Design — Awaiting Owner Approval
**Prerequisite:** Phase C1 (Infrastructure) — closed.
**Goal:** Document the company's official KPI weight policy before any technical implementation.

---

## 1. KPI Registry

### K1 — Sales (المبيعات)

| Property | Value |
|----------|-------|
| **Status** | ✅ Active |
| **In evaluation** | ✅ Yes |
| **Source** | `orders.total_amount` WHERE `status = 'delivered'` |
| **Adjustment** | `- return_deduction` (approved credit notes) → `effective_sales` |
| **Target table** | `employee_monthly_targets.sales_target` |
| **Target data** | 3 reps @ 5,000,000 / manager @ 20,000,000 (May 2026) |
| **Business meaning** | Total value of goods delivered to customers. The primary revenue driver. |

### K2 — Orders (الطلبات)

| Property | Value |
|----------|-------|
| **Status** | ✅ Active |
| **In evaluation** | ✅ Yes |
| **Source** | `COUNT(orders.id)` WHERE `status = 'delivered'` |
| **Adjustment** | `- full_returns` (orders where 100% of items returned) → `effective_orders` |
| **Target table** | `employee_monthly_targets.orders_target` |
| **Target data** | 300 per rep / 1,200 per manager (May 2026) |
| **Business meaning** | Number of invoices issued. Reflects sales activity volume and customer reach — distinct from value. |

### K3 — Visits (الزيارات)

| Property | Value |
|----------|-------|
| **Status** | ✅ Active |
| **In evaluation** | ✅ Yes |
| **Source** | `COUNT(visits.id)` WHERE `status = 'completed'` |
| **Adjustment** | None |
| **Target table** | `employee_monthly_targets.visits_target` |
| **Target data** | 600 per rep / 2,500 per manager (May 2026) |
| **Business meaning** | Field visits to customers. Measures field activity and customer engagement effort. |
| **Note** | Data exists only from June 2026 onward (158 visits, 7 employees). Zero visits in earlier months. |

### K4 — New Customers (عملاء جدد)

| Property | Value |
|----------|-------|
| **Status** | ✅ Active |
| **In evaluation** | ✅ Yes |
| **Source** | Customers whose **first-ever** delivered order falls within the target month |
| **Attribution** | Assigned to the employee whose `owner_id` matches the order (via `COALESCE(emp.id, emp2.identity_id)`) |
| **Target table** | `employee_monthly_targets.new_customers_target` |
| **Target data** | 25 per rep / 100 per manager (May 2026) |
| **Business meaning** | New customer acquisition. Measures business development and market expansion. |

### K5 — Collections (التحصيل)

| Property | Value |
|----------|-------|
| **Status** | 🔶 Deferred to Phase F |
| **In evaluation** | ❌ No |
| **Source** | `collections.amount` WHERE `status = 'approved'` |
| **Target table** | `employee_monthly_targets.collections_target` (column exists) |
| **Current data** | 0 approved collections in the entire system |
| **Business meaning** | Cash collection from credit sales. Measures receivables management and cash flow performance. |
| **Phase F trigger** | When the company actively uses the collections module and has approved collection records. |

### K6 — Attendance (الحضور)

| Property | Value |
|----------|-------|
| **Status** | 🔶 Deferred to Phase F |
| **In evaluation** | ❌ No |
| **Source** | To be determined (currently `app.sessions` tracks logins, not workdays) |
| **Target table** | Does not exist yet |
| **Current data** | `app.sessions` has 428 records (all time), but no attendance/absence tracking |
| **Business meaning** | Employee attendance and punctuality. Measures workforce discipline and availability. |
| **Phase F trigger** | When the company defines attendance policy (workdays per month, absence rules) and implements the attendance module. |

---

## 2. Weight Distribution

### Current State (Hardcoded — Phase C0 / B12)

| KPI | Weight | Sum |
|-----|--------|-----|
| Sales | 75 | |
| Orders | 7.5 | |
| Visits | 7.5 | |
| New Customers | 10 | |
| **Active total** | | **100** |
| Collections | — | (deferred) |
| Attendance | — | (deferred) |

### Current Config (performance_weights_config — Phase 4)

| KPI | Weight | Sum |
|-----|--------|-----|
| Sales | 35 | |
| Collections | 20 | |
| Visits | 15 | |
| New Customers | 15 | |
| Attendance | 15 | |
| **Total** | | **100** |
| Orders | 7.5 | (new, via C1 COALESCE) |

**Observation:** The existing config uses a 5-KPI model (excluding orders), while the current RPC uses a 4-KPI model. These must be reconciled.

### Proposed Weight Structure (for Owner Decision)

When Collections and Attendance are deferred, the **active KPI set** has 4 KPIs (Sales, Orders, Visits, New Customers). Their weights must sum to 100.

| KPI | Option A: Sales-Weighted | Option B: Balanced | Option C: Activity-Weighted |
|-----|------------------------|-------------------|---------------------------|
| **Sales** | **50** | **40** | **35** |
| **Orders** | **20** | **25** | **20** |
| **Visits** | **15** | **20** | **25** |
| **New Customers** | **15** | **15** | **20** |
| **Total** | **100** | **100** | **100** |

---

## 3. Weight Justification (Business Rationale)

### Why Sales Gets the Largest Weight

Sales (total value) is the primary business metric because:
- Revenue is the company's top-line performance indicator
- Sales value directly impacts profitability
- All other KPIs (orders, visits, new customers) are leading indicators that ultimately drive sales

**Weight range:** 35–50

| If you choose... | It means... |
|-----------------|-------------|
| **50** | Sales is the dominant metric; other KPIs are secondary. Best if the company prioritizes revenue above all else. |
| **40** | Sales is primary but other activities matter significantly. A balanced revenue + activity approach. |
| **35** | Sales is important but not dominant. Best if non-sales activities (field work, acquisition) are equally valued. |

### Why Orders Should Not Be Negligible

- Orders count reflects **breadth** of customer base (vs sales value reflecting **depth**)
- A rep who sells many small orders is different from one who sells few large orders
- Protects against "lazy large order" behavior

**Suggested range:** 15–25

### Why Visits Matter

- Visits are a **leading indicator** — more visits → more orders → more sales
- Measures field discipline and customer engagement effort
- Prevents "desk-bound" sales behavior

**Suggested range:** 15–25

### Why New Customers Have Strategic Weight

- New customers = future recurring revenue
- Prevents reps from only serving existing accounts
- Aligns with business growth objectives

**Suggested range:** 10–20

---

## 4. When Collections & Attendance Are Activated (Phase F)

When Phase F activates Collections and Attendance, the weight distribution must be restructured to accommodate 6 KPIs summing to 100.

### Example Transition Plan

| Phase | Sales | Orders | Visits | New Cust | Collections | Attendance | Total |
|-------|-------|--------|--------|----------|-------------|------------|-------|
| **Now (C0)** | 75 | 7.5 | 7.5 | 10 | — | — | 100 |
| **C2 (4 KPIs)** | Owner decision | | | | — | — | 100 |
| **F (6 KPIs)** | Reduce to allocate for collections + attendance |

**Example shift from 4-KPI to 6-KPI:**
| KPI | 4-KPI (C2) | 6-KPI (F) | Notes |
|-----|-----------|-----------|-------|
| Sales | 40 | 35 | Reduced to make room |
| Orders | 25 | 20 | Reduced slightly |
| Visits | 20 | 15 | Reduced slightly |
| New Customers | 15 | 10 | Reduced |
| Collections | — | **10** | New |
| Attendance | — | **10** | New |
| **Total** | **100** | **100** | |

---

## 5. Implementation Plan (Phase C2 Execution)

Once owner approves the weight values:

| Step | What | How |
|------|------|-----|
| 1 | Update `performance_weights_config` | `UPDATE ... SET sales_weight_percent=X, orders_weight_percent=X, ...` (single row) |
| 2 | Update `get_governed_target_performance` | Replace hardcoded weights with `get_effective_weights()` per employee; company section reads from config |
| 3 | Verify with same test case | Confirm scores change as expected per new weights |

**Result:** After Phase C2, weight values become dynamic and configurable. Any future weight change is done via:
```
UPDATE performance_weights_config SET sales_weight_percent = <new_value> WHERE target_year = <year>;
```
No migration needed. The RPC picks up the change immediately.

---

## 6. Decision Form

Please fill the following to approve Phase C2:

| KPI | Weight (sum must = 100) |
|-----|------------------------|
| Sales | `___` |
| Orders | `___` |
| Visits | `___` |
| New Customers | `___` |
| **Active Total** | **`___`** |
| Collections | (deferred to Phase F — reserve `___` when activated) |
| Attendance | (deferred to Phase F — reserve `___` when activated) |

---

**Prepared for owner review and decision.**
