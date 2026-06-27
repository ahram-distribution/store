# Organizational Model

> **Status:** Active — contains owner-defined knowledge.  
> **Verification Status:** `VERIFIED_IN_CODE` (employee hierarchy confirmed in schema); `OWNER_DEFINED` (Supreme Board, Sales Manager, Warehouse Manager, General Supervisor)

---

## Known Context (from verified documentation)

### Hierarchy

```
UPPER_MANAGEMENT (الإدارة العليا)
↓
SALES_MANAGER (مدير مبيعات)
↓
SALES_REPRESENTATIVE (مندوب)
↓
CUSTOMER (عميل)
```

Internal Sales (سيلز داخلي / سكرتارية) reports directly to Upper Management — NOT under Sales Manager.

**Note:** The former "Manager" tier has been removed. Upper Management is directly above Sales Manager, with no intermediate layer.

### Verified Structure

| Element | Source | Details |
|---------|--------|---------|
| Employees table | `employees` | 16 employees, self-referencing `manager_id` for hierarchy |
| Roles | `roles` table | Dynamic, data-driven role definitions |
| Manager assignment | `governed_change_employee_manager` | RPC for changing employee manager |
| Role assignment | `governed_change_employee_role` | RPC for changing employee role |
| Dead schema | `employee_roles` | Junction table for multi-role (defined but unused in code) |

**Sources:** PROJECT_STATE_HANDOFF.md §1, FINAL_CANONICAL_MASTER_REFERENCE_V2.md §1.3, 16_RUNTIME_SOURCE_OF_TRUTH_MAP.md §8

---

## UPPER_MANAGEMENT

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

### Official Term

الإدارة العليا

### Unified System Role

The following operational titles are unified into a single system role `UPPER_MANAGEMENT`:

- Super Admin
- Executive Manager
- Sales Director
- Chairman
- Any equivalent top-level management title

**No operational distinction exists between them inside the system.**

### Current Members

| Name |
|------|
| ياسر توفيق |
| محمد سعيد |
| علي سعيد |
| محمود سعيد |

### Authority

All members have identical:

- Permissions
- Visibility
- Authority
- Governance powers

No hierarchy exists between members.

### Scope

Upper Management can **create, edit, delete, approve, reject, transfer, and reassign** any operational entity in the system. This is the highest governance authority.

---

## SUPER_ADMIN

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Super Admin is **not a separate authority level.**

Super Admin is one of the unified titles within `UPPER_MANAGEMENT` (الإدارة العليا).

No operational distinction exists between Super Admin and any other Upper Management member.

---

## SALES_MANAGER

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

### System Role

`SALES_MANAGER`

### Business Title

مدير مبيعات (formerly مدير بيع)

### Supervisor Replacement

The **Supervisor (مسؤول)** role is **retired**.

Official replacement: **SALES_MANAGER** (مدير مبيعات).

Any existing Supervisor users are treated as Sales Managers.

### Responsibilities

- Leads a sales team.
- Owns personal customers.
- Owns a team of sales representatives.
- Responsible for team performance.

### Visibility Scope

Sales Manager can view only:

- Himself
- His sales representatives
- His personal customers
- Customers owned by his team
- Team orders
- Team visits
- Team reports
- Team analytics

### Restrictions

Sales Manager cannot view:

- Other sales teams
- Other managers' customers
- Other managers' orders
- Other managers' visits
- Other managers' reports

### Allowed Actions

- Create sales representative within his team
- Create customer for himself
- Create customer for one of his representatives
- Set representative targets
- Modify representative targets
- Reassign customers between representatives within his team
- Reassign customers from representatives to himself
- Create orders for his direct customers
- Create orders for any customer within his team
- Perform visits for his direct customers
- Perform visits for any customer within his team
- Monitor team visits
- Approve visits for his team
- Reject visits for his team

---

## SALES_MANAGER_CUSTOMER_ADMINISTRATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Within his team scope, a Sales Manager may:

- View customer information.
- Update customer information.
- Create customers.
- Create orders.
- Perform visits.
- Review visits.
- Approve visits.
- Reject visits.

This authority applies to:

- Direct customers owned by the Sales Manager.
- Customers owned by representatives within the Sales Manager's team.

---

## CUSTOMER_OWNERSHIP_REASSIGNMENT_INSIDE_SALES_TEAM

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Sales Managers may:

- Reassign customers between representatives within their team.
- Reassign customers from representatives to themselves.

---

## SALES_MANAGER_DEPARTURE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

If a Sales Manager leaves the company:

- Team ownership transfers to Upper Management.
- Upper Management may keep ownership.
- Upper Management may redistribute ownership to another Sales Manager.

---

## SALES_REPRESENTATIVE_ISOLATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Sales Representatives may not view:

- Other representatives' customers.
- Other representatives' orders.
- Other representatives' visits.
- Other representatives' reports.

This restriction applies even within the same Sales Manager team.

---

## SALES_REPRESENTATIVE_CUSTOMER_MANAGEMENT

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Within their owned customer base, Sales Representatives may:

- View customer details.
- Update customer information.
- View customer order history.
- View customer visit history.
- Create orders.
- Create visits.
- Create new customers.

---

## INTERNAL_SALES

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

### Official Role

سيلز داخلي / سكرتارية

### Purpose

Phone-based sales and customer service operations.

### Responsibilities

- Answer customer calls
- Create customers
- Update owned customers
- Create orders
- Follow customer requests

### Allowed Actions

- Customer creation
- Customer management
- Order creation

### Prohibited Actions

- Customer visits
- Visit creation
- Visit closure
- Field activity operations

### Management Structure

Internal Sales staff are managed directly by Upper Management.

Upper Management:

- Creates employees
- Assigns permissions
- Enables/disables accounts

### Operational Relationship

Internal Sales role is operationally similar to a Sales Representative.

Difference:

Sales Representatives perform field visits.

Internal Sales does not perform visits.

### Customer Ownership

When Internal Sales creates a customer:

- Customer ownership belongs to the Internal Sales employee.
- Customer is not automatically assigned to Upper Management.

### Customer Ownership Transfer

Customers owned by Internal Sales may be reassigned.

Possible destinations:

- Sales Representative
- Sales Manager
- Another Internal Sales employee

Ownership reassignment follows existing ownership governance rules.

### Organizational Position

Internal Sales is outside Sales Manager team structure.

Sales Managers do not automatically manage Internal Sales customer portfolios.

### Performance Attribution

Orders created by Internal Sales are attributed to the Internal Sales employee.

Customer growth is attributed to the Internal Sales employee.

Sales performance is attributed to the Internal Sales employee.

Orders created by Internal Sales count toward:

- Net Sales
- Orders Count

Using the same attribution principles applied to Sales Representatives.

### User Experience

Internal Sales uses the same customer and order workspaces used by Sales Representatives.

No dedicated alternative workspace is required.

### Targets

Internal Sales employees have targets similar to Sales Representatives.

Examples:

- Net Sales
- Orders Count
- New Customers

Note: No visit targets (Internal Sales does not perform visits).

### Role Model Summary

Internal Sales is a sales channel equivalent to a Sales Representative.

Primary difference:

- No visits
- No field operations
- No GPS tracking
- No visit targets

---

## WAREHOUSE_MANAGER

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

### Current Known User

بسام

### Business Role

مدير المخزن

### Responsibilities

- Manage order preparation stage.
- Process orders assigned to warehouse preparation.

### Visibility Scope

Can view only orders that reached "جاري التجهيز".

Warehouse Manager may view:

- Order contents
- Customer name
- Sales representative name

### Allowed Actions

- Review preparation queue.
- Prepare orders.
- Change order status from "جاري التجهيز" to "تم التجهيز".

### Responsibility Boundary

Warehouse manager responsibility ends once order status becomes "تم التجهيز".

---

## GENERAL_SUPERVISOR

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

### Current User

محمد عبد الباسط

### Business Role

المشرف العام

### Role Type

General Supervisor is not a sales management role.

Role scope is operational order execution.

### Primary Responsibility

Order operations after approval until delivery completion.

### Responsibilities

- Oversees order execution after warehouse preparation begins.
- Supervises order progression from "جاري التجهيز" until "تم التسليم".
- Monitors operational execution of orders.

### Visibility Scope

Can view all orders whose status is between:

- جاري التجهيز
- تم التجهيز
- تم التسليم

General Supervisor may also:

- View operational order pipeline
- Manage order progress after approval

### Allowed Actions

- Update order statuses during post-preparation operational stages.
- Manage order progression until delivery completion.
- Change statuses within assigned operational stages.

---

## MULTI_ROLE_SUPPORT

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Employees may hold multiple roles simultaneously.

Examples:

- Sales Manager + General Supervisor
- Sales Representative + Internal Sales
- Other combinations as required

Owner confirmation:

Technically allowed.

Current operational need:

Not currently required.

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| 2026-06-09 | Upper Management | "Official term: الإدارة العليا. Members: ياسر توفيق, محمد سعيد, علي سعيد, محمود سعيد. All members have identical permissions, screens, authority, and operational capabilities. No hierarchy exists between members." | Upper Management is a flat authority body of four equal members with full system access. | Employees, Customers, Orders, all operational modules | OWNER_DEFINED |
| 2026-06-09 | Sales Manager (مدير بيع) | "Previous references to Supervisor are historical. The preferred title is مدير بيع. Leads a sales team, owns personal customers, owns a team of sales reps, responsible for team performance." | Sales Manager has visibility and action scope limited to his own team, his customers, and his team's customers. Cannot view other teams or managers. Can create reps, customers, orders, and manage visits within his team. | Employees, Customers, Orders, Visits, Reports, Analytics | OWNER_DEFINED |
| 2026-06-09 | Sales Manager Operational Authority | "Sales Manager may: create orders for his direct customers, create orders for any customer within his team, perform visits for his direct customers, perform visits for any customer within his team." | Sales Manager has order and visit creation authority across his entire domain (personal + team customers). | Orders, Visits, Customers | OWNER_DEFINED |
| 2026-06-09 | Sales Manager Customer Administration | "Within his team scope, Sales Manager may: view/update customer info, create customers, create orders, perform/review/approve/reject visits. Applies to direct customers and team customers." | Full customer and visit administration authority over both direct and team customer base. | Customers, Visits, Orders | OWNER_DEFINED |
| 2026-06-09 | Customer Ownership Reassignment Inside Sales Team | "Sales Managers may reassign customers between representatives within their team, and reassign customers from representatives to themselves." | Sales Manager has intra-team customer reassignment authority. | Customers, Ownership, Hierarchy | OWNER_DEFINED |
| 2026-06-09 | Sales Representative Isolation | "Sales Reps may not view other reps' customers, orders, visits, or reports. This applies even within the same Sales Manager team." | Full data isolation between sales representatives at the same level. | Customers, Orders, Visits, Reports, Permissions | OWNER_DEFINED |
| 2026-06-09 | Sales Representative Customer Management | "Within their owned customer base, Sales Reps may: view/update customer details, view order/visit history, create orders, create visits, create new customers." | Sales Reps have full operational authority over their owned customers. | Customers, Orders, Visits | OWNER_DEFINED |
| 2026-06-09 | Warehouse Manager (مدير المخزن) | "Warehouse manager is بسام. Manages order preparation stage. Processes orders assigned to warehouse preparation. Can view only orders at 'جاري التجهيز' status. Can prepare orders and change status to 'تم التجهيز'. Responsibility ends once status is 'تم التجهيز'." | Warehouse Manager scope is limited to the preparation stage only. No shipping or delivery responsibilities. Visibility restricted to orders in preparation queue. | Orders (preparation stage), Warehouse | OWNER_DEFINED |
| 2026-06-09 | General Supervisor (المشرف العام) | "General supervisor is محمد عبد الباسط. Oversees order execution after warehouse preparation begins. Supervises order progression from جاري التجهيز until تم التسليم. Can update order statuses during post-preparation stages." | General Supervisor bridges warehouse and delivery stages. Can view and manage orders in preparation, prepared, and delivered statuses. Responsible for end-to-end execution from preparation onward. | Orders, Warehouse, Delivery | OWNER_DEFINED |
| 2026-06-09 | Super Admin Not Separate | "Super Admin is not a separate authority level. Super Admin is simply a member of Upper Management." | Clarifies that Super Admin is a label within Upper Management, not a distinct hierarchical level. | Employees, Permissions | OWNER_DEFINED |
| 2026-06-09 | General Supervisor Role Type | "General Supervisor is not a sales management role. Primary responsibility: order operations after approval until delivery completion. Role scope is operational order execution. May view operational pipeline, manage progress, change statuses within assigned stages." | General Supervisor is purely operational (order execution), distinct from sales management functions. | Orders, General Supervisor | OWNER_DEFINED |
| 2026-06-09 | Warehouse Manager Visibility | "Warehouse Manager may view: order contents, customer name, sales representative name." | Additional visibility details for Warehouse Manager beyond preparation queue. | Warehouse, Orders, Customers | OWNER_DEFINED |
| 2026-06-09 | Multi-Role Support | "Employees may hold multiple roles simultaneously. Examples: Sales Manager + General Supervisor, other combinations as required." | System must support one employee having multiple concurrent roles. | Employees, Roles, Permissions | OWNER_DEFINED |
| 2026-06-09 | Internal Sales / Secretariat | "Official role: سيلز داخلي / سكرتارية. Purpose: phone-based sales and customer service. Responsibilities: answer calls, create/update customers, create orders, follow requests. Prohibited: visits, field activity. Managed directly by Upper Management. Operationally similar to Sales Rep but no visits." | New role for phone-based operations. Same customer/order capabilities as Sales Rep but no field visit functionality. Reports directly to Upper Management. | Employees, Customers, Orders, Visits, Permissions | OWNER_DEFINED |
| 2026-06-09 | Internal Sales Customer Ownership | "When Internal Sales creates a customer: customer ownership belongs to the Internal Sales employee, not automatically assigned to Upper Management." | Internal Sales owns customers they create; same ownership model as Sales Rep. | Customers, Ownership, Internal Sales | OWNER_DEFINED |
| 2026-06-09 | Internal Sales Performance Attribution | "Orders, customer growth, and sales performance attributed to the Internal Sales employee." | Full performance attribution to Internal Sales for their created orders and customers. | Orders, Customers, Performance, Internal Sales | OWNER_DEFINED |
| 2026-06-09 | Internal Sales Targets | "Internal Sales employees have targets similar to Sales Representatives: Net Sales, Orders Count, New Customers. No visit targets." | Same target categories as Sales Rep minus visits (since no field activity). | Targets, Performance, Internal Sales | OWNER_DEFINED |
| 2026-06-09 | Internal Sales Role Model | "Internal Sales is a sales channel equivalent to a Sales Representative. Primary difference: no visits, no field operations, no GPS tracking, no visit targets." | Internal Sales is a parallel sales channel with identical capabilities except field/visit operations. | Internal Sales, Sales Rep, Visits, Field Operations | OWNER_DEFINED |
| 2026-06-09 | Internal Sales Customer Management | "Internal Sales may: create customers, edit owned customers, manage owned customers." | Internal Sales has full customer lifecycle management for their owned customers. | Customers, Internal Sales | OWNER_DEFINED |
| 2026-06-09 | Customer Ownership Transfer | "Customers owned by Internal Sales may be reassigned to Sales Representative, Sales Manager, or another Internal Sales employee. Follows existing ownership governance rules." | Standard ownership reassignment rules apply to Internal Sales-owned customers. | Customers, Ownership, Internal Sales | OWNER_DEFINED |
| 2026-06-09 | Internal Sales Organizational Position | "Internal Sales is outside Sales Manager team structure. Sales Managers do not automatically manage Internal Sales customer portfolios." | IS operates independently of SM hierarchy; SM authority does not extend to IS customers. | Internal Sales, Sales Manager, Hierarchy | OWNER_DEFINED |
| 2026-06-09 | Internal Sales Performance Attribution | "Orders created by Internal Sales count toward Net Sales and Orders Count using the same attribution principles applied to Sales Representatives." | Standard attribution rules apply to Internal Sales performance. | Performance, Attribution, Internal Sales | OWNER_DEFINED |
| 2026-06-09 | Internal Sales User Experience | "Internal Sales uses the same customer and order workspaces used by Sales Representatives. No dedicated alternative workspace is required." | Existing Sales Rep workspaces serve Internal Sales needs; no new UI required. | UI, Workspaces, Internal Sales | OWNER_DEFINED |
| 2026-06-09 | Multi-Role Clarification | "Technically allowed (e.g., Sales Representative + Internal Sales). Current operational need: not currently required." | Multi-role is architecturally supported but not yet operationally needed. | Employees, Roles | OWNER_DEFINED |
| 2026-06-10 | Sales Manager Departure | "If a Sales Manager leaves the company: team ownership transfers to Upper Management. Upper Management may keep ownership or redistribute to another Sales Manager." | SM departure triggers team ownership transfer to UM; UM has discretion to keep or reassign. | Sales Manager, Employees, Ownership | OWNER_DEFINED |
| 2026-06-10 | Upper Management Unification | "Super Admin, Executive Manager, Sales Director, Chairman, and any equivalent top-level title are unified into a single system role UPPER_MANAGEMENT (الإدارة العليا). No operational distinction exists between them inside the system." | All top-level management titles map to identical permissions, visibility, authority, and governance powers. A single UPPER_MANAGEMENT role in the system. | Employees, Roles, Permissions, Governance | OWNER_DEFINED |
| 2026-06-10 | Supervisor Removal | "The Supervisor (مسؤول) role is retired. Official replacement: SALES_MANAGER (مدير مبيعات). Any existing Supervisor users should be treated as Sales Managers." | Supervisor is eliminated as a distinct role. All Supervisor users are reclassified as Sales Managers. | Employees, Roles, Permissions, Sales Manager | OWNER_DEFINED |
| 2026-06-10 | Simplified Hierarchy | "The Manager tier between Upper Management and Sales Manager is removed. Hierarchy: UPPER_MANAGEMENT → SALES_MANAGER → SALES_REPRESENTATIVE → CUSTOMER. Internal Sales reports directly to Upper Management." | Removed the intermediate Manager layer. Sales Managers report directly to Upper Management. | Organizational Model, Hierarchy, Employees | OWNER_DEFINED |
| 2026-06-10 | Upper Management Authority | "Upper Management can create, edit, delete, approve, reject, transfer, reassign any operational entity in the system. This remains the highest governance authority." | UM has absolute authority over all operational entities with no restrictions. No entity is outside UM authority scope. | Governance, Permissions, All operational modules | OWNER_DEFINED |

---

## Open Questions for Owner

1. How should employee activity tracking (9,465 rows in `employee_activity`) be used operationally?

---

*End of 02_ORGANIZATIONAL_MODEL.md*
