# Visit Rules

> **Status:** Active — contains owner-defined knowledge.  
> **Verification Status:** `OWNER_DEFINED`

---

## VISIT_TYPES

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Official Visit Types:

- Existing Customer Visit
- New Customer Visit
- Follow-up Visit

---

## VISIT_OUTCOMES

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Official Visit Outcomes:

- Order Created
- New Customer Created
- Customer Not Present
- Customer Closed
- Collection Deferred
- Follow-up Required
- Next Visit Scheduled

### Manual Notes

Manual outcome notes are allowed.

Free-text notes may be added by the visitor.

---

## VISIT_RESULTS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

A visit may generate:

- Order only
- New customer only
- Both order and customer

Within the same visit.

---

## VISIT_ACTIONS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

During an active visit, the representative may:

- Create a new customer.
- Create a new order.
- Close the visit.
- Select a visit outcome.
- Enter manual notes.

---

## VISIT_DURATION_MONITORING

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Visit duration should be monitored.

System should support duration alerts and operational review.

---

## LIVE_FIELD_ACTIVITY_TRACKING

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Sales Manager and Upper Management may view:

- Last known representative location
- Last known representative timestamp
- Location link

Purpose: Field activity monitoring.

---

## VISIT_LINKED_RECORDS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

If an order is created during the visit:

- The created order must be linked to the visit record.

If a new customer is created during the visit:

- The created customer must be linked to the visit record.

---

## VISIT_LOCATION_TRACKING

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

When a visit starts:

- Capture current location.
- Store visit start location link.
- Derive and store readable address from location data when possible.

When a visit ends:

- Capture current location.
- Store visit end location link.
- Derive and store readable address from location data when possible.

---

## ACTIVE_VISIT_STATUS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

When a representative has an open visit:

Display: "زيارة نشطة"

This is considered an important operational indicator.

---

## VISIT_CARD_OUTER_VIEW

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Visit card should display:

- Customer name
- Visitor name
- Visit type
- Visit outcome
- Visit status
- Open time
- Close time

---

## VISIT_CARD_DETAIL_VIEW

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Visit detail should display:

- Open location link
- Open address
- Close location link
- Close address
- Visit duration
- Generated order
- Generated customer
- Visitor information
- Customer information

---

## ACTIVE_VISIT_RULE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Only one active visit is allowed per representative.

Representative must close the current visit before starting another.

### Application Interruption

If application closes during active visit:

- Visit remains active
- Visit resumes when user returns

---

## VISIT_STATUSES

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Official Visit Statuses:

1. مقدمة
2. معتمدة
3. مرفوضة

---

## VISIT_APPROVAL

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Sales Representative closes and submits the visit.

Sales Manager may:

- Approve visits for his own team only.
- Reject visits for his own team only.

Upper Management may:

- Approve any visit.
- Reject any visit.

---

## VISIT_REJECTION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Rejected visits:

- Require comment
- Remain closed
- Cannot be edited and resubmitted

---

## VISIT_TARGET_COUNTING

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Visits contribute to target achievement only when:

Visit Status = "معتمدة"

Submitted or closed visits do not count toward visit targets.

---

## VISIT_VISIBILITY

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Visit records are operational records.

Customers do not view visit history.

Visit history is visible only to authorized employees.

---

## CUSTOMER_VISIT_INSIGHTS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Within visit details:

- Monthly visit count for customer.
- Link to customer visit history.
- Link to customer orders.

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| 2026-06-09 | Visit Rules | "A visit is the primary field activity unit. Used to prove field activity, track work, visit/acquisition customers, create orders. Representative can create customer/order, close visit, select outcome, enter notes. Linked records for orders and customers created during visit. Location tracking on start/end. Active visit shows 'زيارة نشطة'. Card shows customer/rep/start-end time externally; full details inside." | Defines the visit as the core field operation unit with full lifecycle: start → actions → end. Orders and customers created during a visit must be linked. Location tracking at start and end. Active visit indicator is operationally important. | Visits, Orders, Customers, Locations | OWNER_DEFINED |
| 2026-06-09 | Visit Concurrency Rule | "A sales representative may have only one active visit at a time. A new visit cannot start until the current visit is closed." | Prevents concurrent active visits for the same rep. | Visits, Concurrency | OWNER_DEFINED |
| 2026-06-09 | Visit Statuses | "Official visit statuses: مقدمة, معتمدة, مرفوضة" | Three Arabic statuses defining the visit lifecycle. | Visits, Status | OWNER_DEFINED |
| 2026-06-09 | Visit Approval | "Sales Rep closes and submits visit. Sales Manager or Upper Management may approve or reject." | Visit submission goes through review by Sales Manager or Upper Management. | Visits, Approvals | OWNER_DEFINED |
| 2026-06-09 | Visit Approval Authority | "Sales Manager: approve/reject visits for his own team only. Upper Management: approve/reject any visit." | Sales Manager authority is scoped to own team; Upper Management has cross-team authority. | Visits, Approvals, Hierarchy | OWNER_DEFINED |
| 2026-06-09 | Visit Rejection | "Rejected visits require comment/note and decision history." | Rejection requires justification and audit trail. | Visits, Audit | OWNER_DEFINED |
| 2026-06-09 | Visit Target Counting | "Visits contribute to target achievement only when status is معتمدة. Submitted or closed visits do not count." | Only approved (معتمدة) visits count toward targets. | Visits, Targets | OWNER_DEFINED |
| 2026-06-09 | Visit Types | "Official Visit Types: Existing Customer Visit, New Customer Visit, Follow-up Visit." | Three categorized visit types for different field scenarios. | Visits, Types | OWNER_DEFINED |
| 2026-06-09 | Visit Outcomes | "Official Visit Outcomes: Order Created, New Customer Created, Customer Not Present, Customer Closed, Collection Deferred, Follow-up Required, Next Visit Scheduled. Manual outcome notes allowed." | Seven official outcomes with free-text notes support. | Visits, Outcomes | OWNER_DEFINED |
| 2026-06-09 | Visit Results | "A visit may generate: order only, new customer only, or both order and customer within the same visit." | Visit can produce order, customer, or both as result. | Visits, Orders, Customers | OWNER_DEFINED |
| 2026-06-09 | Visit Duration Monitoring | "Visit duration should be monitored. System should support duration alerts and operational review." | Duration tracking with alerting and review capabilities. | Visits, Monitoring, Alerts | OWNER_DEFINED |
| 2026-06-09 | Live Field Activity Tracking | "Sales Manager and Upper Management may view: last known representative location, timestamp, and location link. Purpose: field activity monitoring." | Managerial live tracking of rep locations during field work. | Visits, Locations, Field Activity, Permissions | OWNER_DEFINED |
| 2026-06-09 | Active Visit Rule | "Only one active visit per rep. Must close current before starting another. If app closes during active visit: visit remains active and resumes when user returns." | Single active visit with resilience to app interruption. | Visits, Concurrency, Mobile | OWNER_DEFINED |
| 2026-06-09 | Visit Rejection | "Rejected visits: require comment, remain closed, cannot be edited and resubmitted." | Rejection is final; no resubmission allowed. | Visits, Rejection, Audit | OWNER_DEFINED |
| 2026-06-09 | Visit Card Outer View | "Visit card should display: customer name, visitor name, visit type, visit outcome, visit status, open time, close time." | Standardized outer visit card fields. | Visits, UI, Cards | OWNER_DEFINED |
| 2026-06-09 | Visit Card Detail View | "Visit detail should display: open/close location links and addresses, visit duration, generated order/customer, visitor and customer information." | Standardized detail view fields. | Visits, UI, Details | OWNER_DEFINED |
| 2026-06-09 | Visit Visibility | "Visit records are operational records. Customers do not view visit history. Visit history visible only to authorized employees." | Visit data restricted to employee-side; not customer-facing. | Visits, Customers, Permissions | OWNER_DEFINED |
 
---

*End of 06_VISIT_RULES.md*
