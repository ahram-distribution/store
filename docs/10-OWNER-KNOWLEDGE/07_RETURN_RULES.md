# Return Rules

> **Status:** Active — contains owner-defined knowledge.  
> **Verification Status:** `OWNER_DEFINED` (return creation, statuses, acceptance effects, audit trail)

---

## RETURN_CREATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

A return request may be created by:

- Customer
- Sales Representative
- Original Order Creator

---

## OFFICIAL_RETURN_STATUSES

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Official return statuses:

1. مقدم
2. جارى المراجعة
3. مقبول
4. مرفوض

---

## RETURN_ACCEPTANCE_EFFECTS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

When a return is approved:

1. Returned quantities are added back to inventory.
2. Return value is deducted from related sales calculations.

---

## RETURNS_IMPACT

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Approved returns affect:

- Net Sales
- Targets

Returns reduce both reporting sales values and target achievement values.

---

## RETURNS_ARE_PARTIAL

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Returns may include:

- Entire order.
- Specific products only.
- Partial quantities.

When approved:

- Returned quantities go back to inventory.
- Returned value reduces net sales.

---

## RETURN_AUDIT_TRAIL

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Each return must maintain:

- Status history
- Action history
- User history
- Date and time tracking

---

## RETURNS_SOURCE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Returns must be linked to a previously purchased order.

Returns are not created directly against a customer without referencing an original order.

---

## RETURN_FINANCIAL_RULE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

### Method

**Option B — Record only.** No customer financial credit from returns in V1.

### Effects

When a return is approved:

1. Return remains linked to the original order.
2. Inventory is restored only for items marked `saleable`.
3. Net Sales are reduced.
4. Targets are reduced.
5. Effective Sales calculations continue using approved return values.

### Excluded (V1)

The following are **explicitly excluded** in V1:

- Customer return balance or wallet
- Reusable customer credit from returns
- Customer credit increase from returns
- Automatic offset against future orders
- Credit note wallet system

### Implementation

- `credit_note_amount` remains the official accounting value
- No entry in `customer_credit_ledger` for return credit
- `customer_credit_accounts` is not modified by returns
- The `customer_credit_ledger.reference_type = 'credit_note'` path is NOT activated for returns in V1

---

## RETURN_VALUE_CALCULATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

### Source of Truth

Original order pricing snapshot.

### Formula

```
Return Value = SUM(return_item_quantity × original_order_unit_price)
```

Where:

- `original_order_unit_price` = `order_items.total_price / order_items.piece_quantity` (effective per-piece price at order submission time)
- Quantity converted to pieces via multiplier: piece=1, dozen=12, carton=product.carton_quantity

### Excluded

- Current product price (not used)
- Manual pricing (not used)
- Employee-entered value (not used)

### Official Value

The calculated amount becomes the official value used by:

- Returns
- Reporting
- Target calculations
- Effective sales calculations

---

## RETURN_AND_CREDIT_SEPARATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Returns and Credit Programs remain **completely separate systems** in V1.

Approved returns must NOT modify:

- `customer_credit_accounts`
- `outstanding_credit`
- `reserved_credit`
- `customer_credit_ledger`

---

## RETURN_REVIEW_AUTHORITY

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Return review authority belongs to Upper Management only.

Upper Management decides:

- Accept
- Reject

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| 2026-06-09 | Return Creation | "A return request may be created by Customer, Sales Representative, or Original Order Creator." | Three roles authorized to initiate returns. | Returns, Orders, Customers, Employees | OWNER_DEFINED |
| 2026-06-09 | Official Return Statuses | "مقدم, جارى المراجعة, مقبول, مرفوض" | Four Arabic statuses defining the return lifecycle from submission through review to acceptance or rejection. | Returns, Status | OWNER_DEFINED |
| 2026-06-09 | Return Acceptance Effects | "When approved: returned quantities added back to inventory. Return value deducted from related sales calculations." | Two business effects on acceptance: inventory restock and sales adjustment. | Returns, Inventory, Sales, Reports | OWNER_DEFINED |
| 2026-06-09 | Return Audit Trail | "Each return must maintain status history, action history, user history, date and time tracking." | Full audit trail required for every return. | Returns, Audit | OWNER_DEFINED |
| 2026-06-09 | Returns Are Partial | "Returns may include entire order, specific products only, or partial quantities. When approved: quantities go back to inventory, value reduces net sales." | Partial returns explicitly supported. Acceptance effects updated from "related sales calculations" to "net sales". | Returns, Inventory, Sales | OWNER_DEFINED |
| 2026-06-10 | Returns Impact | "Approved returns affect Net Sales and Targets. Returns reduce both reporting sales values and target achievement values." | Returns reduce both reported sales numbers and target progress. | Returns, Targets, Reporting | OWNER_DEFINED |
| 2026-06-10 | Returns Source | "Returns must be linked to a previously purchased order. Returns are not created directly against a customer without referencing an original order." | Returns always reference a specific original order; no customer-level returns without order. | Returns, Orders | OWNER_DEFINED |
| 2026-06-10 | Return Review Authority | "Return review authority belongs to Upper Management only. Upper Management decides: Accept or Reject." | Only Upper Management may review and decide on return requests. | Returns, Permissions | OWNER_DEFINED |
| 2026-06-10 | Return Financial Handling | "Option B — Record only. No customer financial credit from returns in V1. Returns and Credit Programs remain separate systems." | Return approved = inventory restore (saleable only) + Net Sales reduction + Target reduction. No credit balance, no wallet, no offset. | Returns, Inventory, Targets, Credit, Reporting | OWNER_DEFINED |
| 2026-06-10 | Return Value Calculation | "Source of truth: original order pricing snapshot. Formula: Returned Quantity × Original Order Unit Price. Do not use current product price, manual pricing, or employee-entered value." | Auto-calculated from `return_items.quantity × order_items.piece_price`. Becomes official value for returns, reporting, targets, effective sales. | Returns, Orders, Pricing, Reporting, Targets | OWNER_DEFINED |
| 2026-06-10 | Returns and Credit Separation | "Returns and Credit Programs remain completely separate systems. Approved returns must NOT modify customer_credit_accounts, outstanding_credit, reserved_credit, or customer_credit_ledger." | Returns have zero financial impact on credit system. Accounting is record-only. | Returns, Credit, Accounting | OWNER_DEFINED |

---

## Open Questions for Owner

1. What are the valid reasons for a return? (Damaged goods, wrong product, customer dissatisfaction, etc.)
2. What is the inspection process for returns? (Who inspects? What are the possible outcomes?)

---

*End of 07_RETURN_RULES.md*
