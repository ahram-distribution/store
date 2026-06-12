# Customer Rules

> **Status:** Active — contains owner-defined knowledge.  
> **Verification Status:** `PARTIALLY_VERIFIED` (customer model verified; exact business rules need owner confirmation); `OWNER_DEFINED` (customer creation and ownership rules)

---

## Known Context (from verified documentation)

### Customer Types

Only two customer types exist. No additional types may be created.

**Direct Customer:**
- Owned directly by Upper Management (represented operationally by Super Admin).

**Managed Customer:**
- Owned by a Sales Representative or Sales Manager.

---

## CUSTOMER_TYPE_TRANSITION_RULE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Customer type is determined by current ownership.

Direct Customer:

- Owned directly by Upper Management / Super Admin.

Managed Customer:

- Owned by a Sales Manager or Sales Representative.

When a Direct Customer is reassigned to a Sales Manager or Sales Representative:

- Customer becomes Managed Customer.

---

### Customer Model

| Component | Table | Status |
|-----------|-------|--------|
| Identity (login) | `identities` | GREEN — phone is the unique login key |
| Profile | `customers` | GREEN |
| Address (canonical) | `unified_locations` | RED — dual SOT with customer_addresses |
| Address (legacy) | `customer_addresses` | RED — dual SOT |
| GPS coordinates | `unified_locations.geom` | RED — dual SOT with customers.lat/lng |
| Contact | `customer_contacts` | YELLOW — denormalized to customers.phone_1/phone_2 |
| Ownership | `customers.owner_id` | GREEN |
| Credit account | `customer_credit_accounts` | RED — dual SOT with customers.credit_limit/credit_days |

### Customer Creation

| Path | RPC | Page | Purpose |
|------|-----|------|---------|
| Managed | `governed_create_customer` | NewCustomerPage | Employee creates customer |
| Self-registration | `register_customer` | RegistrationPage | Customer self-registers |

### Customers Count

~25 active customers (source-verified).

**Sources:** PROJECT_STATE_HANDOFF.md §1, §3, FINAL_CANONICAL_MASTER_REFERENCE_V2.md §2, 16_RUNTIME_SOURCE_OF_TRUTH_MAP.md §1–5, NEW_CHAT_BOOTSTRAP.md

---

## CREDIT_PROGRAM_RULES

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

### Rules

1. Customers are not automatically credit customers.

2. Registered customers may submit a credit request.

3. Upper Management reviews and approves or rejects the request.

4. Approved customers receive:
   - Credit limit
   - Payment period

### Current Credit Programs

**Program A:**
- Credit Limit: 100,000 EGP
- Payment Period: 15 Days

**Program B:**
- Credit Limit: 300,000 EGP
- Payment Period: 30 Days

### Credit Activation Requirements

- Contract execution
- Required guarantees received

Credit terms should be displayed within the credit section.

---

## CREDIT_LIMIT_EXCEEDED_RULE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

When a customer exceeds credit limits:

- Customer may still create and submit orders.
- Order requires Upper Management review.
- Upper Management may:
  - Approve.
  - Record settlement.
  - Grant exception.

---

## CREDIT_PROGRAM_SETTLEMENT_RULE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Credit invoices are settled in full.

Partial settlement does not release credit capacity.

Customer must fully settle the oldest outstanding credit order before that credit obligation is considered closed.

Credit control is based on:

- Total unpaid invoices.
- Credit limit.
- Credit period.
- Age of first unpaid invoice.

---

## CREDIT_START_DATE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Credit obligation begins on delivery.

Credit aging and credit tracking start when the order reaches delivered status (تم الاستلام).

Credit is not activated on approval.

---

## CREDIT_REQUEST_REJECTION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

If a credit request is rejected:

- Customer remains a cash customer.
- Customer may apply again later.

---

## CREDIT_CUSTOMER_ACCOUNT

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Credit customers should have a dedicated account section.

Visible only to approved credit customers.

Purpose:

- Display credit information and account status.

Credit customer may view in this section:

- Credit program name
- Credit limit
- Credit period
- Current usage
- Remaining available credit

---

## PAYMENT_REMINDER_MODEL

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

System should remain simple.

Do not create complex banking workflows.

Administrative notes/reminders are sufficient.

Examples of reminder fields:

- Customer name
- Reminder date
- Check number
- Bank name
- Free notes

---

## PRE_DUE_REMINDERS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

System may send reminder notifications before due date.

Example:

- One day before payment due date.

---

## CREDIT_EXPIRY_ACTION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

If customer exceeds the credit period:

- New orders become blocked.
- Upper Management receives an alert.
- Administrative action is required to resolve.

---

## CREDIT_ENFORCEMENT

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Credit control focuses on:

- Credit limit
- Credit period

No advanced financial workflow is required at the current project stage.

---

## SIMPLICITY_PRINCIPLE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Credit management should remain operationally simple.

Future expansion is allowed.

Current implementation should avoid unnecessary financial complexity.

---

## CUSTOMER_VISIBILITY

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Customers may view:

- Responsible owner name
- Historical orders since account creation
- Search
- Filters
- Order details
- Order statuses
- Order change history

Credit-specific visibility (program name, limit, period, usage, remaining credit) is documented in CREDIT_CUSTOMER_ACCOUNT section.

Customers do not see inventory quantities.

Customers may only see:

- Available
- Out Of Stock

---

## CUSTOMER_DATA_MAINTENANCE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Customers do not modify their own master data.

Examples:

- Name
- Phone
- Address
- Location
- Business information

Customer data is maintained by the responsible owner.

Responsible owner may be:

- Sales Representative
- Sales Manager
- Upper Management

---

## SELF_REGISTRATION_ACTIVATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Self-registration is immediate.

No approval workflow is required.

No manual review is required.

Self-registered customers:

- Account becomes active immediately.
- May browse products immediately.
- May create orders immediately.
- Can log in immediately.
- Can view prices immediately.
- Are initially assigned to Super Admin ownership.

No waiting period exists.

---

## REGISTRATION_REQUIREMENTS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Customer registration should remain simple.

No mandatory:

- National ID upload
- Commercial registration upload
- Store photos
- Additional verification documents

---

## ONBOARDING_SIMPLICITY_PRINCIPLE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Customer onboarding should remain frictionless.

Future enhancements may be added later.

Current phase prioritizes:

- Fast registration
- Immediate ordering

---

## CUSTOMER_CREATED_DURING_VISIT

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

If a sales representative creates a customer during a visit:

- Customer becomes owned by that representative automatically.

---

## CUSTOMER_CREATED_BY_SALES_REPRESENTATIVE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

When a Sales Representative creates a customer:

- Customer is activated immediately.
- Customer can log in immediately.
- Customer can create orders immediately.
- Customer ownership is assigned automatically to the creating representative.

---

## CUSTOMER_CREATION_AND_OWNERSHIP

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

### Rules

1. Customers may self-register from the public interface.

2. Self-registered customers are initially assigned to Super Admin as the default ownership destination.

3. The assigned owner may keep the customer or redistribute ownership later.

4. If a customer is created by an employee or sales representative, ownership is assigned to the creator.

5. A customer created during a visit is automatically owned by that representative.

6. Customer ownership may be reassigned by authorized users higher in the organizational hierarchy.

---

## CUSTOMER_REASSIGNMENT

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Sales Managers may:

- Move customers between representatives in their own team.
- Move customers from representatives to themselves.

Upper Management may:

- Reassign any customer anywhere in the organization.

---

## EMPLOYEE_DEPARTURE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

If an employee leaves or is deactivated:

- Customer ownership is reassigned by Super Admin.
- Historical visits remain attributed to the original performer.
- Historical orders remain attributed to the original creator.
- New activity after reassignment belongs to the new owner.

---

## NEW_CUSTOMER_TARGET_COUNTING

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

A customer counts as a new customer achievement only when:

The customer's first order reaches "تم التسليم".

Customer registration alone does not count toward new customer targets.

---

## CUSTOMER_OWNERSHIP_HISTORY

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

When customer ownership changes:

- Historical performance remains attributed to the owner who held the customer at the time of activity.
- Sales history is not reassigned retroactively.

---

## CUSTOMER_INTERNAL_NOTES

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Customer records support internal notes.

Examples:

- Customer prefers cash payment
- Customer closes on Fridays
- Customer unavailable before specific time

Notes are operational only.

Customer does not see these notes.

Visible only to authorized employees.

---

## CUSTOMER_ADDRESS_MODEL

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Customer has one operational address.

Multiple customer addresses are not required.

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| 2026-06-09 | Customer Creation and Ownership | "Customers may self-register. Default owner for self-registered is ياسر توفيق. Assigned owner may keep or redistribute. Employee/rep-created customers owned by creator. Ownership reassignable by authorized users higher in hierarchy." | Defines default ownership path for self-registration, creator-ownership for managed creation, and hierarchy-based reassignment authority. | Customers, Employees, Customer Ownership History | OWNER_DEFINED |
| 2026-06-09 | Credit Program Rules | "Customers are not automatically credit customers. Registered customers may submit a credit request. Upper Management reviews and approves/rejects. Approved customers receive credit limit and payment period. Two programs: A (100k EGP, 15 days) and B (300k EGP, 30 days). Requires contract execution and guarantees." | Credit is opt-in, not automatic. Two-tier credit program with explicit activation requirements (contract + guarantees). Upper Management controls approval. | Customers, Credit, Orders | OWNER_DEFINED |
| 2026-06-09 | Direct vs Managed Customers | "Direct Customer: owned by Upper Management / Super Admin. Managed Customer: owned by a Sales Representative or Sales Manager." | Defines customer types by ownership: Direct = Upper Management, Managed = field employees. | Customers, Ownership, Hierarchy | OWNER_DEFINED |
| 2026-06-09 | Customer Type Transition Rule | "Customer type is determined by current ownership. When a Direct Customer is reassigned to a Sales Manager or Sales Representative, the customer becomes Managed Customer." | Customer type is dynamic based on current owner, not a fixed designation. | Customers, Ownership | OWNER_DEFINED |
| 2026-06-09 | Customer Credit Visibility | "Customers may view: credit limit, available credit, outstanding unpaid invoices, credit period/due info, current credit status." | Customers have read-only access to their credit account information. | Customers, Credit, UI | OWNER_DEFINED |
| 2026-06-09 | Customer Visibility | "Customers may view: responsible owner name, historical orders with search/filters/details/statuses/change history, credit limit, available credit, outstanding invoices, credit period, credit status." | Consolidated customer visibility covering ownership info, order history, and credit account details. | Customers, Orders, Credit, UI | OWNER_DEFINED |
| 2026-06-09 | Customer Inventory Visibility | "Customers do not see inventory quantities. Customers may only see: Available, Out Of Stock." | Customers see binary availability status, not inventory numbers. | Customers, Products, Inventory | OWNER_DEFINED |
| 2026-06-09 | Customer Data Maintenance | "Customers do not modify their own master data (name, phone, address, location, business info). Data maintained by responsible owner (Sales Rep, Sales Manager, or Upper Management)." | Master data is owner-managed, not customer-self-service. | Customers, Data Management | OWNER_DEFINED |
| 2026-06-09 | Self Registration Activation | "Self-registered customers are activated immediately, can log in immediately, view prices immediately, create orders immediately. Initially assigned to Super Admin ownership." | No approval delay for self-registration. Immediate full access. | Customers, Registration, Orders | OWNER_DEFINED |
| 2026-06-09 | Customer Created During Visit | "If a sales rep creates a customer during a visit, that customer becomes owned by that rep automatically." | Visit-created customers auto-assign to the creating rep. | Customers, Visits, Ownership | OWNER_DEFINED |
| 2026-06-09 | Customer Created by Sales Representative | "When a Sales Rep creates a customer: activated immediately, can log in immediately, can create orders immediately, ownership assigned automatically to the creating rep." | Same self-registration activation rules apply to rep-created customers — no approval delay, immediate access. | Customers, Registration, Orders | OWNER_DEFINED |
| 2026-06-09 | Customer Reassignment | "Sales Managers may move customers between reps in their team or from reps to themselves. Upper Management may reassign any customer anywhere in the organization." | Hierarchical reassignment authority: Sales Manager within team, Upper Management globally. | Customers, Ownership, Hierarchy | OWNER_DEFINED |
| 2026-06-09 | Employee Departure | "If employee leaves or is deactivated: Super Admin reassigns ownership. Historical visits/orders remain attributed to original performer/creator. New activity belongs to new owner." | Clean separation of historical vs future attribution on employee departure. | Customers, Employees, Ownership, Visits, Orders | OWNER_DEFINED |
| 2026-06-09 | Credit Limit Exceeded Rule | "When credit limits exceeded: customer may still create/submit orders. Order requires Upper Management review. Upper Management may approve, record settlement, or grant exception." | Credit over-limit does not block order creation but triggers mandatory Upper Management review. | Credit, Orders, Upper Management | OWNER_DEFINED |
| 2026-06-09 | Credit Program Settlement Rule | "Credit invoices are settled in full. Partial settlement not part of current business process. Credit control based on total unpaid invoices, credit limit, credit period, and age of first unpaid invoice." | Full settlement only. Credit control uses four metrics. | Credit, Invoices, Settlement | OWNER_DEFINED |
| 2026-06-09 | New Customer Target Counting | "A customer counts as new customer achievement only when the customer's first order reaches تم التسليم. Registration alone does not count." | New customer targets require first delivered order, not just registration. | Customers, Targets, Orders | OWNER_DEFINED |
| 2026-06-10 | Credit Start Date | "Credit obligation begins on delivery. Credit aging and tracking start when order reaches delivered status (تم الاستلام). Credit is not activated on approval." | Credit activation moved from approval to delivery. Aging starts at delivered status, not at approval or first unpaid order. | Credit, Orders, Aging | OWNER_DEFINED |
| 2026-06-10 | Credit Customer Account | "Credit customers should have a dedicated account section. Visible only to approved credit customers. Displays credit information and account status. Credit customer may view: program name, credit limit, credit period, current usage, remaining available credit." | New dedicated credit account UI visible only to approved credit customers. Refines earlier customer credit visibility into specific fields. | Credit, Customers, UI | OWNER_DEFINED |
| 2026-06-10 | Payment Reminder Model | "System should remain simple. Do not create complex banking workflows. Administrative notes/reminders are sufficient. Examples: customer name, reminder date, check number, bank name, free notes." | Credit payment reminders are administrative notes, not an automated financial workflow. | Credit, Payments, Reminders | OWNER_DEFINED |
| 2026-06-10 | Pre-Due Reminders | "System may send reminder notifications before due date. Example: one day before payment due date." | Optional notification-based reminder before credit period expires. | Credit, Notifications | OWNER_DEFINED |
| 2026-06-10 | Credit Expiry Action | "If customer exceeds credit period: new orders become blocked, Upper Management receives alert, administrative action required to resolve." | Credit period expiry blocks ordering and triggers UM alert. Differs from credit limit exceed (which allows orders with UM review). | Credit, Orders, Upper Management | OWNER_DEFINED |
| 2026-06-10 | Credit Enforcement | "Credit control focuses on: credit limit and credit period. No advanced financial workflow required at current project stage." | Two-pillar credit enforcement. Explicit avoidance of complex financial workflows. | Credit, Enforcement | OWNER_DEFINED |
| 2026-06-10 | Simplicity Principle | "Credit management should remain operationally simple. Future expansion allowed. Current implementation should avoid unnecessary financial complexity." | Overarching design principle for the credit subsystem: keep it simple now, extensible later. | Credit, Architecture | OWNER_DEFINED |
| 2026-06-10 | Customer Visibility Update | "Credit-specific visibility items moved to dedicated CREDIT_CUSTOMER_ACCOUNT section. Customer Visibility now covers non-credit items (owner name, order history, search/filters)." | Restructured customer visibility to separate general visibility from credit-specific visibility. | Customers, Credit, UI | OWNER_DEFINED |
| 2026-06-10 | Credit Settlement All-or-Nothing | "Credit settlement is all-or-nothing. Partial settlement does not release credit capacity. Customer must fully settle the oldest outstanding credit order before that obligation is closed." | Full settlement required per oldest order; partial payments do not free credit capacity. Refines earlier full-settlement rule. | Credit, Settlement | OWNER_DEFINED |
| 2026-06-10 | Credit Request Rejection | "If a credit request is rejected: customer remains a cash customer. Customer may apply again later." | Rejection does not permanently bar the customer from re-applying. | Credit, Customers | OWNER_DEFINED |
| 2026-06-10 | Customer Ownership History | "When customer ownership changes: historical performance remains attributed to owner who held the customer at time of activity. Sales history is not reassigned retroactively." | Historical attribution is immutable on ownership change. | Customers, Ownership, Performance | OWNER_DEFINED |
| 2026-06-10 | Customer Internal Notes | "Customer records support internal notes. Examples: customer prefers cash payment, closes on Fridays, unavailable before specific time. Notes are operational only. Customer does not see these notes. Visible only to authorized employees." | Internal annotation system for customer records with employee-only visibility. | Customers, Notes | OWNER_DEFINED |
| 2026-06-10 | Customer Address Model | "Customer has one operational address. Multiple customer addresses are not required." | Single-address model simplifies customer data structure. | Customers, Address | OWNER_DEFINED |
| 2026-06-10 | Self Registration Activation (Updated) | "Customer self-registration is immediate. No approval workflow is required. No manual review is required." | Clarifies that self-registration has zero approval steps. Confirms no review gate. | Customers, Registration | OWNER_DEFINED |
| 2026-06-10 | Registration Requirements | "Customer registration should remain simple. No mandatory: National ID upload, commercial registration upload, store photos, additional verification documents." | Registration requires no document uploads or verification steps. | Customers, Registration | OWNER_DEFINED |
| 2026-06-10 | Post Registration Access | "Immediately after registration: account becomes active, customer may browse products, may create orders. No waiting period exists." | Zero-delay access to all customer features on registration. | Customers, Registration, Orders | OWNER_DEFINED |
| 2026-06-10 | Onboarding Simplicity Principle | "Customer onboarding should remain frictionless. Future enhancements may be added later. Current phase prioritizes fast registration and immediate ordering." | Overarching design principle: keep onboarding simple now, extensible later. | Customers, Registration, Onboarding | OWNER_DEFINED |
 
---

## Open Questions for Owner

1. Can a customer switch between Direct and Managed types? If so, what is the process?
2. What are the minimum data requirements for customer registration (mandatory fields beyond phone)?
3. Should customer email be completely removed from the system, or kept for non-operational use?

---

*End of 04_CUSTOMER_RULES.md*
