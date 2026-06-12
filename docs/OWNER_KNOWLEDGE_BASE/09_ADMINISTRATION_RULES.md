# Administration Rules

> **Status:** Active — contains owner-defined knowledge.

---

## UPPER_MANAGEMENT_ADMINISTRATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Official term: الإدارة العليا

Upper Management (الإدارة العليا) is responsible for managing:

- Products
- Companies
- Employees
- Employee permissions
- Employee roles
- Employee assignment

Upper Management requires administrative interfaces for managing these operational entities.

---

## OWNER_VISION_ANALYTICS

> **Status:** `OWNER_VISION`
> **Date:** 2026-06-09
> **Not yet considered implemented.**

Owner Vision:

Future system should provide behavioral analytics including:

- Customer purchasing patterns
- Most requested products
- Most requested companies
- Time between orders
- Monthly purchasing analysis
- Product recommendation capabilities
- Customer-level behavioral insights

---

## TARGET_STRUCTURE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Targets are not a single combined score.

Each target category is tracked independently.

Examples:

- Net Sales Target
- Orders Target
- New Customers Target
- Visits Target

Each category has:

- Target value
- Achievement value
- Achievement percentage

---

## TARGET_CALCULATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Sales targets use:

Net Sales = Sales - Approved Returns

---

## WEIGHTS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Weights may exist for evaluation purposes.

Weights do not replace independent target tracking.

---

## INVENTORY_VISIBILITY

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Current inventory quantities and balances are visible only to Upper Management.

Non-management users should not see inventory quantities.

---

## INVENTORY_DEPLETION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

When inventory reaches zero:

- Selling remains allowed.
- Negative inventory is allowed.
- Warning should be displayed.

---

## BRANDS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Brand controls are independent.

Upper Management may:

- Hide Brand
- Stop Selling Brand

These are separate controls.

---

## BRANDS_VS_COMPANY_DISTINCTION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-10

Two different concepts must not be mixed.

### 1. Product Brands / Manufacturers

Examples:

- Johnson
- Nivea
- L'Oreal

These are catalog brands.

Brands may support:

- Visibility control
- Sales enable/disable
- Tier exceptions
- Brand discounts
- Reporting and analytics

Brands DO NOT have operational targets.

### 2. Al Ahram Trading & Distribution

This is the operating business entity.

Company-level targets and performance measurements belong here.

Examples:

- Net Sales
- Orders Count
- New Customers
- Visits
- Performance Weights

These targets belong to:

- Company level
- Employees
- Sales teams

Not to product brands.

---

## PRODUCT_STATUS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Product may be:

- Active
- Temporarily Stopped
- Out Of Stock

---

## PRODUCT_UNITS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Not all products use the same unit structure.

Some products may support:

- Carton
- Dozen
- Piece

Other products may support only a single unit.

Allowed units are controlled by Upper Management.

---

## INVENTORY_STORAGE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Inventory may be maintained across carton and lower-unit representations.

System may perform automatic conversion between units.

---

## PRODUCT_CREATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Only Upper Management may create products.

---

## BRAND_CREATION

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Only Upper Management may create brands.

---

## EMPLOYEE_MANAGEMENT

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Only Upper Management may:

- Create employees
- Edit employees
- Disable employees

---

## EMPLOYEE_DISABLING

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Disabling an employee:

- Prevents login access
- Preserves historical records
- Preserves ownership history
- Preserves activity history

---

## ROLE_CHANGES

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

When an employee changes role:

- Historical records remain preserved
- Historical activity remains preserved

---

## EMPLOYEE_AUDIT_TRAIL

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Employee administration must maintain history.

Examples:

- Who changed permissions
- Who changed role
- Who disabled employee
- Who enabled employee

Store:

- User
- Date
- Time

---

## HIDDEN_PRODUCTS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

When a product is hidden:

- It disappears from storefront selling surfaces.
- Historical orders remain unchanged.
- Historical reports remain unchanged.

Hidden products continue to exist historically.

---

## PRODUCT_AND_COMPANY_CONTROL

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Upper Management may:

Company Level:

- Show company
- Hide company
- Apply company-level exceptional discount

Product Level:

- Show product
- Hide product
- Stop product sales
- Control allowed sales units
- Set manual pricing
- Use automatic pricing calculations
- Apply product-level exceptional discount

---

## SEARCH_AND_FILTER_PRINCIPLE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Owner Requirement:

Screens that manage large datasets should provide:

- Search
- Context-appropriate filters

Examples may include:

- Date filters
- Company filters
- Value filters

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| 2026-06-09 | Upper Management Administration | "Upper Management manages products, companies, employees, permissions, roles, and assignment. Requires administrative interfaces." | Defines the scope of Upper Management's administrative responsibilities. | Products, Companies, Employees, Permissions, Roles | OWNER_DEFINED |
| 2026-06-09 | Owner Vision Analytics | "Future system should provide behavioral analytics: purchasing patterns, most requested products/companies, time between orders, monthly analysis, recommendations, customer insights." | Forward-looking vision for analytics capabilities. Not yet implemented. | Analytics, Reports, Customers, Products | OWNER_VISION |
| 2026-06-09 | Search and Filter Principle | "Screens managing large datasets should provide search and context-appropriate filters such as date, company, or value filters." | Core UX principle for all list/management screens. | General UX, All Management Screens | OWNER_DEFINED |
| 2026-06-09 | Inventory Depletion | "When inventory reaches zero: selling remains allowed, negative inventory is allowed, warning should be displayed." | Inventory is not a hard constraint; warning instead of block. | Products, Inventory, Orders | OWNER_DEFINED |
| 2026-06-09 | Product and Company Control | "Upper Management may: at company level — show/hide company, apply exceptional discount. At product level — show/hide, stop sales, control sales units, set manual or automatic pricing, apply exceptional discount." | Defines Upper Management's visibility and pricing control over companies and products, including fine-grained controls at both levels. | Products, Companies, Pricing | OWNER_DEFINED |
| 2026-06-09 | Target Structure | "Targets are not a single combined score. Each category is tracked independently. Examples: Net Sales, Orders, New Customers, Visits. Each has target value, achievement value, achievement percentage." | Targets are multi-dimensional per category, not a single composite score. | Targets, Performance | OWNER_DEFINED |
| 2026-06-09 | Target Calculation | "Sales targets use Net Sales = Sales - Approved Returns" | Sales targets use net sales after deducting approved returns. | Targets, Sales, Returns | OWNER_DEFINED |
| 2026-06-09 | Weights | "Weights may exist for evaluation purposes. Weights do not replace independent target tracking." | Weights are for evaluation only; each target category retains independent tracking regardless. | Targets, Weights, Evaluation | OWNER_DEFINED |
| 2026-06-09 | Inventory Visibility | "Current inventory quantities and balances are visible only to Upper Management. Non-management users should not see inventory quantities." | Inventory data is restricted to Upper Management only. | Products, Inventory, Permissions | OWNER_DEFINED |
| 2026-06-09 | Target Calculation Rule | "Net Sales = Sales - Approved Returns" | Targets use net sales after deducting approved returns. | Targets, Sales, Returns | OWNER_DEFINED |
| 2026-06-09 | Brands | "Brand controls are independent. Upper Management may: Hide Brand, Stop Selling Brand. These are separate controls." | Brand visibility and selling are independently controlled by Upper Management. | Brands, Products, Permissions | OWNER_DEFINED |
| 2026-06-09 | Product Status | "Product may be: Active, Temporarily Stopped, Out Of Stock." | Three distinct product availability states. | Products, Inventory | OWNER_DEFINED |
| 2026-06-09 | Product Units | "Not all products use the same unit structure. Some products support Carton/Dozen/Piece. Allowed units controlled by Upper Management." | Unit structure is product-specific and configurable by Upper Management. | Products, Units, Pricing | OWNER_DEFINED |
| 2026-06-09 | Inventory Storage | "Inventory may be maintained across carton and lower-unit representations. System may perform automatic conversion between units." | Multi-unit inventory tracking with automatic conversion support. | Inventory, Products, Units | OWNER_DEFINED |
| 2026-06-09 | Product Creation | "Only Upper Management may create products." | Product creation restricted to Upper Management. | Products, Permissions | OWNER_DEFINED |
| 2026-06-09 | Brand Creation | "Only Upper Management may create brands." | Brand creation restricted to Upper Management. | Brands, Permissions | OWNER_DEFINED |
| 2026-06-09 | Hidden Products | "Hidden products disappear from storefront selling surfaces. Historical orders and reports remain unchanged. Hidden products continue to exist historically." | Hiding is a future-facing visibility control; historical data is preserved. | Products, Storefront, Reports | OWNER_DEFINED |
| 2026-06-09 | Employee Management | "Only Upper Management may: create employees, edit employees, disable employees." | Full employee lifecycle controlled by Upper Management. | Employees, Permissions | OWNER_DEFINED |
| 2026-06-09 | Employee Disabling | "Disabling an employee: prevents login access, preserves historical records, preserves ownership history, preserves activity history." | Disabling is access revocation only; all historical data preserved. | Employees, Permissions, History | OWNER_DEFINED |
| 2026-06-09 | Role Changes | "When an employee changes role: historical records remain preserved, historical activity remains preserved." | Role changes do not retroactively alter historical attribution. | Employees, Roles, History | OWNER_DEFINED |
| 2026-06-09 | Employee Audit Trail | "Employee administration must maintain history: who changed permissions, who changed role, who disabled/enabled employee. Store: user, date, time." | Full audit trail for all employee administration actions. | Employees, Audit, Permissions, Roles | OWNER_DEFINED |
| 2026-06-10 | Brands vs Company Distinction | "Two different concepts must not be mixed. 1) Product Brands/Manufacturers (Johnson, Nivea, L'Oreal): catalog brands; support visibility control, sales enable/disable, tier exceptions, brand discounts, reporting/analytics; DO NOT have operational targets. 2) Al Ahram Trading & Distribution: operating business entity; company-level targets (Net Sales, Orders, New Customers, Visits, Weights) belong to company/employees/teams, not to brands." | Clear separation between product brands (catalog entities with no targets) and the operating company (entity with employee/team targets). | Brands, Company, Targets, Products | OWNER_DEFINED |
 
---

*End of 09_ADMINISTRATION_RULES.md*
