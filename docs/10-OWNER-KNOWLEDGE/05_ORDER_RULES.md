# Order Rules

> **Status:** Active — contains owner-defined knowledge.  
> **Verification Status:** `PARTIALLY_VERIFIED` (order lifecycle documented but 2 critical workflows broken); `OWNER_DEFINED` (order modification rules, official order statuses, customer order permissions)

---

## Known Context (from verified documentation)

### Order Lifecycle

```
pending → submitted → approved → preparing → delivering → completed
                 ↘ rejected          ↘ cancelled
```

### Order Status Transitions

| Transition | RPC Used | Correct RPC? | Status |
|------------|----------|-------------|--------|
| pending → submitted | `governed_submit_order` | ✅ | Operational |
| submitted → approved | `governed_change_order_status` (generic) | ❌ Should be `governed_approve_order` | **Broken** — inventory never deducted, credit invoices never created |
| submitted → rejected | `governed_change_order_status` (generic) | ❌ `governed_deny_order` not in SQL migrations | **Broken** |
| approved → preparing | `governed_start_preparation` | ✅ | Operational |
| preparing → delivering | `governed_dispatch_order` | ✅ | Operational |
| delivering → completed | `governed_confirm_delivery` | ✅ | Operational |

### Key Tables

| Table | Purpose |
|-------|---------|
| `orders` | Order header (status, totals, customer, employee, snapshots) |
| `order_items` | Line items (product, quantity, price) |
| `order_status_history` | Status transition audit trail |
| `order_modification_history` | Admin modification audit trail |

### Key RPCs

| RPC | Purpose | Called From |
|-----|---------|-------------|
| `governed_create_order` | Create new order | Order creation page |
| `governed_submit_order` | Submit order for approval | Order submission |
| `governed_change_order_status` | Generic status transition | OrderStatusManager.tsx:88 (ALL transitions) |
| `governed_approve_order` | Approved-specific logic with inventory deduction | **ORPHANED** — never called |
| `governed_deny_order` | Denial-specific logic | **NOT IN SQL MIGRATIONS** |

### Production Blocker B1/B2

`governed_approve_order` contains inventory deduction logic and credit invoice creation. Since all approvals go through the generic `governed_change_order_status`, this business logic never executes. Stock levels never decrease. Credit customers never invoiced.

**Sources:** PROJECT_STATE_HANDOFF.md §4, §8, §9, FINAL_CANONICAL_MASTER_REFERENCE_V2.md §6, 15_BLUEPRINT_VERIFICATION_AUDIT.md §1

---

## OFFICIAL_ORDER_STATUSES

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Owner-defined official order statuses representing the current real-world operational workflow:

| # | Status (Arabic) | Status (English) |
|---|-----------------|------------------|
| 1 | طلب مقدم | — |
| 2 | جارى المراجعة | — |
| 3 | معتمد | — |
| 4 | جارى التجهيز | — |
| 5 | تم التجهيز | — |
| 6 | تم الشحن | — |
| 7 | تم الاستلام | — |
| 8 | ملغى | — |
| 9 | مؤجل | — |

---

## STATUS_TRANSITIONS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

### مقدم → جارى المراجعة

Authority:

- Sales Manager
- Upper Management

### جارى المراجعة → معتمد

Authority:

- Upper Management only

### معتمد → جارى التجهيز

Authority:

- Upper Management only

### جارى التجهيز → تم التجهيز

Authority:

- Warehouse Manager
- General Supervisor
- Upper Management

### تم التجهيز → تم الشحن

Authority:

- General Supervisor
- Upper Management

### تم الشحن → تم الاستلام

Authority:

- General Supervisor
- Upper Management

---

## ORDER_MODIFICATION_RULES

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

### Rules

1. Order creator may:
   - Return order to cart.
   - Add products.
   - Remove products.
   - Modify quantities.
   - Resubmit the same order.

2. These modifications are allowed only before order status becomes "جاري المراجعة".

3. Sales Manager may:
   - Change order status to "جاري المراجعة".
   - Return order to cart and modify it before approval.

4. Once order becomes "معتمد", Sales Manager loses modification authority.

5. Customer cannot change order status.

6. Sales Representative cannot change order status.

7. Every order modification or status change must be logged with:
   - User
   - Action
   - Date
   - Time

---

## ORDER_STATUS_AUDIT_RULE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

For every status change:

- A note/comment is required.
- Store changer name.
- Store date.
- Store time.
- Record in order history.

---

## UNIFIED_ORDER_CARD_STANDARD

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Owner Requirement:

Order cards should be visually and functionally consistent across all system screens.

External Card Information:

- Order number
- Customer name
- Customer owner name
- Order creator name
- Order status
- Order value

Internal Card Information:

- Customer details
- Customer owner details
- Order creator details
- Phone numbers
- Address
- Customer location link
- Order contents
- Order status
- Order history
- Status transition history

---

## INVENTORY_DEDUCTION_RULE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Inventory is deducted when an order becomes "معتمد".

---

## ORDER_SUBMISSION_NOTIFICATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

When an order is submitted:

1. Order is stored in the database.
2. A copy of the order is sent to company WhatsApp.

---

## ORDER_DELETION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Physical deletion is allowed only for Upper Management.

---

## ORDER_CANCELLATION_AUTHORITY

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Only Upper Management may cancel orders.

---

## ORDER_CANCELLATION_INVENTORY_RULE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

If inventory was previously deducted:

- Cancelling the order automatically restores inventory quantities.

---

## COMPLETED_SALE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

A sale is considered fully completed when:

Order Status = "تم الاستلام"

Completed sales:

- Appear in final reports
- Count as completed business activity

---

## DEFERRED_ORDERS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Deferred orders retain their previous status.

Example:

تم الشحن → مؤجل → تم الشحن

The order returns to the same operational stage it had before deferment.

---

## ORDER_NUMBER

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Order number never changes.

Even if:

- Order is returned to cart
- Order is edited
- Quantities change
- Products change

The same order number remains.

---

## ORDER_TARGET_COUNTING

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Orders contribute to target achievement only when:

Order Status = "معتمد"

Orders that are merely created or submitted do not count toward order targets.

---

## ORDER_ATTRIBUTION_RULE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Orders belong to the creator.

If a Sales Manager creates an order for a customer owned by a representative:

- Order performance is attributed to the Sales Manager.

Historical records are never rewritten.

When ownership changes:

- Historical visits remain attributed to the original performer.
- Historical orders remain attributed to the original creator.

---

## ORDER_PRICE_SNAPSHOT

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Orders preserve historical pricing.

If product prices change later:

- Existing orders keep their original prices.

Historical orders are never recalculated.

---

## PRODUCT_STOPPED_AFTER_ORDER_CREATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

If a product becomes stopped or unavailable before order approval:

- The product may be rejected from the order during operational review.

---

## ORDER_REJECTION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

When an order is rejected:

- Rejection reason is mandatory.
- Customer can see rejection reason.
- Order remains permanently in history.
- Customer may create a new order afterward.
- Customer receives notification.

---

## CUSTOMER_ORDER_PERMISSIONS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

### Rules

1. Customers may create orders.

2. Customers may submit orders.

3. Customers may modify their own orders.

4. Customer modifications are allowed only before order status becomes "جارى المراجعة".

5. Once order enters review stage, customer modification rights end.

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| 2026-06-09 | Order Modification Rules | "Order creator can return to cart, add/remove products, modify quantities, resubmit before جاري المراجعة. Sales Manager can change status to جاري المراجعة, return to cart before approval. Once معتمد, Sales Manager loses modification authority. Customer and Sales Rep cannot change status. All changes must be logged with user, action, date, time." | Defines modification authority boundaries at each order stage. Order creator has full edit control before review. Sales Manager has gatekeeping authority at the review stage. Authority ends at approval. Full audit trail required. | Orders, Order Items, Order Status History | OWNER_DEFINED |
| 2026-06-09 | Customer Order Permissions | "Customers may create, submit, and modify their own orders. Modifications allowed only before جارى المراجعة. Once order enters review stage, customer modification rights end." | Customers have self-service order capabilities (create, submit, modify) limited to pre-review stage. After review begins, modification authority transfers to Sales Manager. | Orders, Order Items, Customers | OWNER_DEFINED |
| 2026-06-09 | Unified Order Card Standard | "Order cards should be visually and functionally consistent across all screens. External: order number, customer name, customer owner, creator, status, value. Internal: customer/owner/creator details, phones, address, location link, contents, status, history, transitions." | Defines a consistent order card specification for internal and external (customer-facing) views. | Orders, UI, Customer Portal | OWNER_DEFINED |
| 2026-06-09 | Inventory Deduction Rule | "Inventory is deducted when an order becomes معتمد." | Inventory deduction happens at the approval/معتمد status, not at submission or any earlier stage. Resolves blocker B1. | Orders, Inventory, Products | OWNER_DEFINED |
| 2026-06-09 | Order Submission Notification | "When an order is submitted: stored in database, and a copy is sent to company WhatsApp." | Order submission triggers external notification via WhatsApp. | Orders, Notifications, WhatsApp | OWNER_DEFINED |
| 2026-06-09 | Order Status Audit Rule | "For every status change: a note/comment is required. Store changer name, date, time. Record in order history." | All status changes require a comment/note plus full audit trail. | Orders, Status, Audit | OWNER_DEFINED |
| 2026-06-09 | Order Cancellation Authority | "Only Upper Management may cancel orders." | Cancellation authority restricted to Upper Management. | Orders, Status, Permissions | OWNER_DEFINED |
| 2026-06-09 | Order Cancellation Inventory Rule | "If inventory was previously deducted, cancelling the order automatically restores inventory quantities." | Cancellation reverses previous inventory deduction. | Orders, Inventory | OWNER_DEFINED |
| 2026-06-09 | Order Attribution Rule | "Orders belong to the creator. Historical records are never rewritten. When ownership changes, historical visits/orders remain attributed to original performer/creator." | Attribution is immutable; historical records are never reassigned. | Orders, Performance, Attribution, Visits | OWNER_DEFINED |
| 2026-06-09 | Order Target Counting | "Orders contribute to target achievement only when status is معتمد. Created or submitted orders do not count." | Only approved (معتمد) orders count toward targets. | Orders, Targets | OWNER_DEFINED |
| 2026-06-09 | Status Transitions | "مقدم→جارى المراجعة: Sales Manager or Upper Management. جارى المراجعة→معتمد: Upper Management only. معتمد→جارى التجهيز: Upper Management only. جارى التجهيز→تم التجهيز: Warehouse Manager, General Supervisor, or Upper Management. تم التجهيز→تم الشحن: General Supervisor or Upper Management. تم الشحن→تم الاستلام: General Supervisor or Upper Management." | Explicit authority per status transition. Upper Management has full control; other roles have scoped transition authority. | Orders, Status, Permissions | OWNER_DEFINED |
| 2026-06-09 | Completed Sale | "A sale is fully completed when order status is تم الاستلام. Completed sales appear in final reports and count as completed business activity." | Defines the terminal completed status for reporting. | Orders, Reports, Sales | OWNER_DEFINED |
| 2026-06-09 | Deferred Orders | "Deferred orders retain their previous status. The order returns to the same operational stage it had before deferment." | مؤجل is a temporary pause; order resumes from the status it had before deferral. | Orders, Status | OWNER_DEFINED |
| 2026-06-09 | Order Deletion | "Physical deletion is allowed only for Upper Management." | Deletion authority restricted to Upper Management. | Orders, Permissions | OWNER_DEFINED |
| 2026-06-09 | Order Number | "Order number never changes even if order is returned to cart, edited, quantities or products change." | Order number is immutable throughout the order lifecycle. | Orders | OWNER_DEFINED |
| 2026-06-10 | Order Price Snapshot | "Orders preserve historical pricing. If product prices change later: existing orders keep their original prices. Historical orders are never recalculated." | Pricing is snapshotted at order creation; future price changes do not affect existing orders. | Orders, Pricing | OWNER_DEFINED |
| 2026-06-10 | Product Stopped After Order Creation | "If a product becomes stopped or unavailable before order approval: the product may be rejected from the order during operational review." | Product unavailability between creation and approval allows rejection during operational review. | Orders, Products, Inventory | OWNER_DEFINED |
| 2026-06-10 | Order Rejection | "When an order is rejected: rejection reason is mandatory; customer can see rejection reason; order remains permanently in history; customer may create a new order afterward; customer receives notification." | Full order rejection workflow defined: mandatory reason with customer visibility, permanent history retention, new order allowed, notification sent. | Orders, Notifications, Customers | OWNER_DEFINED |
 
---

## Open Questions for Owner

1. Should credit invoices be created on order approval for credit customers? (Currently they are not — blocker B2.)
2. What does the `ready_for_dispatch` status mean, and how should an order reach that state?
3. Is the snapshot system (freezing order items/totals at finalization) correct, or should the system always show live data?

---

*End of 05_ORDER_RULES.md*
