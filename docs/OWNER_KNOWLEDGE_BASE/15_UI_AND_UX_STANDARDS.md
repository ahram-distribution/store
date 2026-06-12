# UI and UX Standards

> **Last Updated:** 2026-06-09

---

## PRIMARY_PLATFORM

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Mobile First.

Mobile experience is the primary platform.

Desktop is secondary.

---

## HOME_EXPERIENCE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

### Customer

Customer Landing Page: Storefront

### Sales Representative

Current representative workspace remains the operational starting point.

### Sales Manager

Preferred landing experience should focus on:

- Team performance
- Team activity
- Team customers
- Team visits
- Team orders

### Upper Management

Operational command center with access to all business domains.

---

## CUSTOMER_CARD

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Card summary should display:

- Customer name
- Responsible owner
- Last order
- Last visit
- Total sales

---

## PRODUCT_CARD

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Card summary should display:

- Product image
- Product name
- Brand
- Unit
- Price
- Availability status

---

## SEARCH_EXPERIENCE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Search should support:

- Arabic
- English
- Partial matches
- Product code
- Product name
- Customer name
- Order number
- Representative name

### Normalization

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

## FILTERS

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Filters should remain visible and fixed at the top of relevant screens.

---

## NOTIFICATION_CENTER

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

System should provide a unified notification center.

Examples:

- New orders
- Order approvals
- Visit approvals
- Credit alerts
- Auction events

---

## COLOR_LANGUAGE

> **Verification Status:** `OWNER_DEFINED`
> **Date:** 2026-06-09

Operational color conventions:

- Green = Success
- Red = Problem
- Yellow = Action Required
- Blue = Information

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| 2026-06-09 | Primary Platform | "Mobile First. Mobile experience is the primary platform. Desktop is secondary." | Mobile is the primary design target; desktop is secondary. | UX, Mobile, Desktop, Platform | OWNER_DEFINED |
| 2026-06-09 | Home Experience | "Customer: storefront. Sales Rep: current workspace. Sales Manager: team performance/activity/customers/visits/orders. Upper Management: operational command center with access to all business domains." | Role-specific landing pages tailored to each user type's primary function. | UX, Navigation, Home Screen, Roles | OWNER_DEFINED |
| 2026-06-09 | Customer Card | "Card summary should display: customer name, responsible owner, last order, last visit, total sales." | Standardized customer card fields for list views. | Customers, UI, Cards | OWNER_DEFINED |
| 2026-06-09 | Product Card | "Card summary should display: product image, product name, brand, unit, price, availability status." | Standardized product card fields for storefront and management screens. | Products, UI, Cards, Storefront | OWNER_DEFINED |
| 2026-06-09 | Search Experience | "Search should support: Arabic, English, partial matches, product code/name, customer name, order number, representative name." | Cross-entity search with broad match capabilities. | Search, UX, All Entities | OWNER_DEFINED |
| 2026-06-09 | Search Normalization | "Search should tolerate spacing differences, hamza variations, minor spelling variations, and word order differences. Examples: الأهرام/الاهرام/اهرام, شامبو جونسون/جونسون شامبو." | Arabic-tolerant fuzzy search with normalization for common linguistic variations. | Search, UX, Arabic | OWNER_DEFINED |
| 2026-06-09 | Filters | "Filters should remain visible and fixed at the top of relevant screens." | Fixed filter bars for consistent UX across list screens. | UX, Filters, UI | OWNER_DEFINED |
| 2026-06-09 | Notification Center | "System should provide a unified notification center. Examples: new orders, order approvals, visit approvals, credit alerts, auction events." | Centralized notification hub for all operational events. | Notifications, UX, All Modules | OWNER_DEFINED |
| 2026-06-09 | Color Language | "Green = Success, Red = Problem, Yellow = Action Required, Blue = Information." | Standardized semantic color conventions across all screens. | UX, Colors, UI | OWNER_DEFINED |

---

*End of 15_UI_AND_UX_STANDARDS.md*
