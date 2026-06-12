# Owner Principles

> **Status:** Active — contains owner-defined knowledge.

---

## PERMISSION_VISIBILITY_PRINCIPLE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

If a user lacks permission:

Hide the feature completely.

Do not display inaccessible actions.

Users should not see:

- Screens outside their authority.
- Actions outside their authority.
- Data outside their authority.

---

## SINGLE_SOURCE_OF_TRUTH_PRINCIPLE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

The system should maintain a single source of truth whenever possible.

Reducing duplicate data sources is a strategic objective.

---

## PERFORMANCE_PRINCIPLE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Owner priorities:

- Fast loading
- Fast navigation
- Fast search
- Minimal user friction

---

## DIGITAL_SALES_REPRESENTATIVE_PRINCIPLE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

The storefront should behave as a digital sales representative.

Expected behaviors include:

- Guidance
- Suggestions
- Recommendations
- User assistance

### Specific Behaviors

- Recommend products
- Remind customer of missing products
- Reference previous orders
- Assist purchasing decisions

---

## GUIDED_ERROR_PRINCIPLE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Errors should not only explain what failed.

Errors should also explain:

- Why it failed
- What the user should do next

---

## INTELLIGENT_SEARCH_PRINCIPLE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Search should support:

- Arabic names
- English names
- Partial names
- Product codes
- Customer names
- Order numbers
- Sales representative names

Search results must respect visibility permissions.

### Search Normalization

Search normalization should tolerate:

- Spacing differences
- Hamza variations
- Minor spelling variations
- Word order differences

Examples:

الأهرام
الاهرام
اهرام

شامبو جونسون
جونسون شامبو

---

## UPPER_MANAGEMENT_ABSOLUTE_AUTHORITY

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Upper Management is the highest authority in the system.

### Default Interpretation Rule

Whenever an operational question exists regarding:

- Create
- Edit
- Delete
- Approve
- Reject
- Reassign
- Transfer
- Override
- Status Changes
- Workflow Intervention

Upper Management always possesses authority.

### Scope

Other roles may receive limited operational permissions.

However:

Upper Management retains full authority regardless of workflow stage.

### Allowed Actions

Upper Management may:

- Move workflow states forward
- Move workflow states backward
- Override operational decisions
- Correct records
- Transfer ownership
- Perform administrative intervention

All actions must continue to respect audit logging requirements.

### Permission Authority

Upper Management may:

- Grant permissions to any employee.
- Revoke permissions from any employee.

Permission changes are performed from Employee Management.

No other role may grant or revoke permissions.

---

---

## FUTURE_MODULE_PRESERVATION_PRINCIPLE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Owner Decision:

Modules planned for future operational phases should not be removed solely because they are not currently active.

Examples:

- Collections
- Treasury / Cashbox

Preferred approach:

- Keep data structures.
- Keep implementation assets.
- Hide modules from normal operational users until activation is required.

Future modules may be activated later without rebuilding them from scratch.

---

## VISIBILITY_RULE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

A user may only see:

- Their own records
- Records owned by subordinates within their hierarchy

Users must not see peer data or higher-level data.

### Per-Role Examples

Customer:

- Sees only his own data.

Sales Representative:

- Sees only his customers.

Sales Manager:

- Sees only his team and team customers.

Upper Management:

- Sees all operational data (highest authority, no higher level).

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| 2026-06-09 | Permission Visibility Principle | "If a user lacks permission: hide the feature completely. Do not display inaccessible actions. Users should not see screens, actions, or data outside their authority." | Complete access restriction — hidden features, not disabled/visible features. | Permissions, UI, Access Control | OWNER_DEFINED |
| 2026-06-09 | Single Source of Truth Principle | "The system should maintain a single source of truth whenever possible. Reducing duplicate data sources is a strategic objective." | Strategic priority to eliminate data duplication and dual SOTs. | Architecture, Data Model | OWNER_DEFINED |
| 2026-06-09 | Performance Principle | "Fast loading, fast navigation, fast search, minimal user friction." | Performance is a top-level owner priority. | Performance, UX, Search | OWNER_DEFINED |
| 2026-06-09 | Digital Sales Representative Principle | "The storefront should behave as a digital sales representative with guidance, suggestions, recommendations, and user assistance. Specific behaviors: recommend products, remind customer of missing products, reference previous orders, assist purchasing decisions." | The customer-facing interface should be proactive and assistive, not just a catalog. | Storefront, UX, Recommendations | OWNER_DEFINED |
| 2026-06-09 | Guided Error Principle | "Errors should explain what failed, why it failed, and what the user should do next." | Errors must be actionable, not just descriptive. | Error Handling, UX | OWNER_DEFINED |
| 2026-06-09 | Intelligent Search Principle | "Search should support Arabic/English names, partial names, product codes, customer names, order numbers, sales rep names. Results must respect visibility permissions." | Universal cross-entity search with permission-aware results. | Search, Permissions, UX | OWNER_DEFINED |
| 2026-06-09 | Search Normalization | "Search should tolerate spacing differences, hamza variations, minor spelling variations, and word order differences." | Arabic-tolerant fuzzy search added to search principle. | Search, UX, Arabic | OWNER_DEFINED |
| 2026-06-09 | Ownership Visibility Principle | "Customer sees own data. Sales Rep sees his customers. Sales Manager sees his team and their customers. Upper Management sees all operational data." | Hierarchical data visibility based on ownership and organizational position. | Permissions, Data Visibility, Customers | OWNER_DEFINED |
| 2026-06-09 | Future Module Preservation Principle | "Modules planned for future operational phases should not be removed solely because they are not currently active. Keep data structures and implementation assets. Hide from normal users until activation." | Future modules (collections, treasury/cashbox) should be preserved and hidden, not deleted. | Collections, Treasury, Cashbox, Architecture | OWNER_DEFINED |
| 2026-06-09 | Upper Management Absolute Authority | "Upper Management is the highest authority. Default interpretation rule: for any create/edit/delete/approve/reject/reassign/transfer/override/status change/workflow intervention, Upper Management always possesses authority. Other roles may receive limited permissions, but UM retains full authority regardless of stage. UM may move states forward/backward, override decisions, correct records, transfer ownership, perform administrative intervention. All actions must respect audit logging." | UM has universal override authority across all system operations. This is a default interpretation rule — when in doubt, UM has the authority. Audit logging still applies. | All system areas, Governance, Permissions | OWNER_DEFINED |
| 2026-06-09 | UM Permission Authority | "Upper Management may grant or revoke permissions for any employee. Permission changes are performed from Employee Management. No other role may grant or revoke permissions." | UM has exclusive authority over employee permissions. Permission management is done through Employee Management module. | Employees, Permissions, Employee Management | OWNER_DEFINED |
| 2026-06-09 | Visibility Rule | "A user may only see: their own records, records owned by subordinates within their hierarchy. Users must not see peer data or higher-level data." | Hierarchical data visibility with explicit prohibition of peer and higher-level data access. Refines the earlier per-role examples into a general rule. | Permissions, Data Visibility, All Entities | OWNER_DEFINED |
 
---

*End of 12_OWNER_PRINCIPLES.md*
