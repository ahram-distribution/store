# RUNTIME_UI_REVIEW_REPORT

**Date**: 2026-06-01
**Target**: Database `gbcbejejgpvltuhbztbx`, Repository `D:\Ahram Distribution\ahram-distribution`
**Type**: Mobile-First UI Review — No code changes implemented

---

## 1. Login Page

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | ✅ Ready | Centered card layout, full-width inputs, proper tap targets |
| Layout issues | None | Single-column, max-width-sm constrained, clean RTL form |
| Overflow issues | None | No horizontal overflow; form is compact |
| Navigation issues | None | Submit navigates to `/dashboard` or `/storefront` based on identity type |
| Button usability | ✅ Good | Full-width button, disabled state with reduced opacity, loading text |
| Data density | ✅ Good | Minimal — 2 inputs + 1 button |

**Recommended UI corrections**: None.

---

## 2. Dashboard (ManagementDashboard)

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | ✅ Ready | 2-column widget grid, gradient header, scroll-free viewport |
| Layout issues | Minor | Credit stats use `grid-cols-3` — on very small screens (<360px) text wraps |
| Overflow issues | None | Everything fits within viewport |
| Navigation issues | None | All widgets use `navigate()`; clean routing |
| Button usability | ✅ Good | Each widget is a tappable card (40px icon area, padding) |
| Data density | Moderate | 4 primary + 5 secondary widgets + credit stats — reasonable |

**Recommended UI corrections**: Change credit stats grid from `grid-cols-3` to `grid-cols-2` on mobile to prevent text wrapping.

---

## 3. Dashboard (WarehouseDashboard)

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | ✅ Ready | 2-column grid on mobile (responsive: `grid-cols-2 md:grid-cols-3 lg:grid-cols-5`) |
| Layout issues | Minor | Uses old `<a href>` instead of React Router `Link`/`navigate` — causes full-page reloads |
| Overflow issues | None | Cards wrap cleanly |
| Navigation issues | Minor | Only 3 of 5 counters link to warehouse; `prepared_today` and `delayed_preps` have no links |
| Button usability | ✅ Good | Card tap targets are adequately sized |
| Data density | ✅ Good | 5 counters only |

**Recommended UI corrections**: Replace `<a href>` with React Router `<Link>` or `navigate()`; add links for remaining counters.

---

## 4. Dashboard (SalesDashboard / TransportDashboard)

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | ✅ Ready | 2-column widget grid, clean, minimal |
| Layout issues | None | Well-proportioned |
| Navigation issue | **⚠️ Blocking** | Both dashboards are **never routed from DashboardPage** — it only routes to WarehouseDashboard (WRQ1001) or ManagementDashboard (everyone else). Sales/Transport roles see the wrong dashboard |
| Button usability | ✅ Good | Same card pattern |

**Recommended UI corrections**: Route SalesDashboard and TransportDashboard to their respective roles in `DashboardPage.tsx`.

---

## 5. Customers (CustomersPage)

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | ✅ Ready | Flat card list, simple layout |
| Layout issues | None | Proper spacing, RTL |
| Overflow issues | None | No overflow |
| Navigation issues | None | Tapping a customer does nothing — no detail page exists. Filter chips work via URL params |
| Button usability | ✅ Good | Minimal buttons (back, analytics) |
| Data density | ✅ Good | Single card per customer, minimal info |

**Recommended UI corrections**: Add customer detail navigation or link to existing detail view.

---

## 6. Orders (OrdersPage)

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | ✅ Ready | Card list with order info, status badges, amounts |
| Layout issues | Minor | `order.status` filter values are **incorrect** for `preparing` and `delivering` filters — status filtering needs logic audit |
| Overflow issues | None | Cards wrapped in `space-y-2`, no horizontal overflow |
| Navigation issues | Minor | No pagination — all orders loaded at once; may lag with 1000+ orders |
| Button usability | ✅ Good | Each card is tappable (full width); "new order" button is well placed |
| Data density | ✅ Good | 4 lines per card: number+status, date+count, revision, amount |

**Recommended UI corrections**: Fix status filter logic; add pagination or virtual scrolling for long lists.

---

## 7. OrderDetailPage

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | ✅ Ready | Info panel, product list, totals section, history section |
| Layout issues | None | Well-spaced sections |
| Overflow issues | None | Product items wrap properly |
| Navigation issues | None | Back button, edit button when `returned_for_revision` |
| Button usability | ✅ Good | Full-width edit button |
| Data density | ✅ Good | 3 sections (info, products, totals, history), each scannable |

**Recommended UI corrections**: None.

---

## 8. OrderEditPage

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | ✅ Ready | Form layout, tier selector, product list |
| Layout issues | Minor | Number input `w-16` is small on mobile — tapping to type may be imprecise |
| Overflow issues | None |  |
| Navigation issues | None | Back link present |
| Button usability | ✅ Good | Full-width submit |
| Data density | ✅ Good |  |
| **Functional issue** | **⚠️ Blocking** | Uses **hardcoded mock data** (`items` state hardcoded) — does NOT load actual order items from the DB. Page is non-functional for real orders |

**Recommended UI corrections**: Load real order items from the API instead of hardcoded mock data.

---

## 9. Visits (VisitsPage / VisitDetailPage / NewVisitPage)

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | ✅ Ready | All three pages are card/form-based, mobile-optimized |
| Layout issues | None | Proper spacing, flex-wrap on result buttons |
| Overflow issues | None |  |
| Navigation issues | None | Clear navigation hierarchy with back buttons |
| Button usability | ✅ Good | Full-width action buttons, proper touch targets |
| Data density | ✅ Good | Concise information per card |
| **VisitsPage** | Minor | Customer name shows `customer_id` (UUID) instead of customer name — DB may not return the name |

**Recommended UI corrections**: Resolve display of `customer_id` to customer name in visit list.

---

## 10. Credit (CreditProgramsPage / CreditApplicationsPage / CreditReviewPage / CustomerCreditPage)

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | ✅ Ready | All pages use card-based layouts, full-width forms, and responsive grids |
| Layout issues | None | Consistent RTL support |
| Overflow issues | None | Filter chips use `overflow-x-auto` — properly handled |
| Navigation issues | None | All pages link correctly |
| Button usability | ✅ Good | Action buttons are full-width or adequately sized (approve/reject side-by-side) |
| Data density | ✅ Good | Per-card layout with scannable status badges |

**Recommended UI corrections**: None.

---

## 11. Warehouse (WarehousePage — **CRITICAL**)

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | **⚠️ Poor** | Uses `<table>` HTML elements instead of card-based mobile layout. Tables force horizontal scrolling on every tab |
| Layout issues | **Multiple** | `p-6` instead of standard `px-4`; `text-2xl` title vs `text-lg` elsewhere; no `mobile-container` constraint |
| Overflow issues | **Yes** | Every tab uses `overflow-x-auto` on tables — requires horizontal scroll for basic data |
| Navigation issues | None | Tab bar, links to detail/review pages work correctly |
| Button usability | **⚠️ Poor** | Buttons inside table cells use `px-2 py-1` (very small touch targets, ~24px height). 4+ buttons per row in `in_progress` tab are cramped |
| Data density | **High — problematic** | Tables show 4-6 columns of data. On mobile (<480px) users must scroll horizontally to see all columns |
| Form fields | Minor | Notes input uses `w-full p-2 border rounded` instead of styled inputs like other pages |

**Recommended UI corrections**: Replace all `<table>` elements with card-based mobile layout (one card per prep record). Increase button touch targets to minimum 40px height. Use `px-4` consistent with AppLayout. Apply `mobile-container` constraint.

---

## 12. Warehouse (WarehouseReviewPage)

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | **⚠️ Poor** | Same table-based layout as WarehousePage |
| Layout issues | Same as WarehousePage | `p-6`, no mobile-container, inconsistent padding |
| Overflow issues | **Yes** | Table forces horizontal scroll |
| Navigation issues | None | Back button present |
| Button usability | **⚠️ Poor** | Side-by-side approve/return buttons in table cells are small targets |

**Recommended UI corrections**: Same as WarehousePage — replace table with cards. 

---

## 13. Warehouse (WarehousePrepDetail)

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | ✅ Good | Uses responsive grid (`grid-cols-1 md:grid-cols-2`), cards, proper spacing |
| Layout issues | Minor | `p-6` instead of `px-4` — inconsistent with AppLayout |
| Overflow issues | None | History sections use `max-h-64 overflow-y-auto` — properly contained |
| Navigation issues | None | Back button, inline exception form |
| Button usability | ✅ Good | Buttons adequately sized |
| Data density | ✅ Moderate | 4 info cards, exceptions list, 2 history panels — well organized |

**Recommended UI corrections**: Change `p-6` to `px-4` to match AppLayout.

---

## 14. Delivery (DeliveryPage / DeliveryDetailPage)

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | ✅ Ready | Card-based list in DeliveryPage; clean form in DeliveryDetailPage |
| Layout issues | None | Gradient header, filter pills, status badges — all well-adapted |
| Overflow issues | None | Filter pills use `overflow-x-auto` — correct |
| Navigation issues | None | Each card navigable, detail page has back button |
| Button usability | ✅ Good | Flex-1 buttons for assign/start/complete; inline assign select replaces button |
| Data density | ✅ Good | Per-card layout with status, order info, action buttons |

**Recommended UI corrections**: None.

---

## 15. Collections (CollectionsPage / NewCollectionPage / CollectionFollowupPage)

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | ✅ Ready | Card-based, clean forms |
| Layout issues | None | Consistent spacing |
| Overflow issues | None |  |
| Navigation issues | None | Clear hierarchy with back buttons |
| Button usability | ✅ Good | Full-width or flex-wrap button patterns |
| Data density | ✅ Good | Minimal per-card, scannable |

**Recommended UI corrections**: None.

---

## 16. Storefront (StorefrontPage / CartPage / OrderReviewPage)

| Aspect | Status | Details |
|--------|--------|---------|
| Mobile usability | ✅ Ready | Responsive product grid (`grid-cols-1 sm:grid-cols-2`), sticky cart bar, clean cart layout |
| Layout issues | Minor | Sticky cart bar uses `-mb-24` offset to clear BottomNav — may leave gap on some devices |
| Overflow issues | None |  |
| Navigation issues | None | Clear flow: Storefront → Cart → OrderReview |
| Button usability | ✅ Good | Full-width CTAs with proper disabled states |
| Data density | ✅ Good | Product cards are compact, cart is scrollable |

**Recommended UI corrections**: Validate sticky cart bar bottom offset against actual BottomNav height (64px + safe area).

---

## Summary

### Pages Not Ready for User Testing

| Page | Reason | Severity |
|------|--------|----------|
| **WarehousePage** | Table-based layout on mobile; small touch targets; inconsistent padding; no mobile-container; horizontal scroll required | **Blocking** |
| **WarehouseReviewPage** | Same table-based layout issues as WarehousePage | **Blocking** |
| **OrderEditPage** | Hardcoded mock data — cannot be used with real orders | **Blocking** |
| **DashboardPage (routing)** | SalesDashboard and TransportDashboard never routed; wrong roles see wrong dashboards | **High** |
| **VisitsPage** | Shows raw UUID for customer_id instead of customer name | **High** |
| **WarehouseDashboard** | Uses `<a href>` causing page reloads; 2 of 5 counters have no links | **Medium** |

### Pages Ready for Real Operation

| Page | Status |
|------|--------|
| **Login** | ✅ Ready |
| **ManagementDashboard** | ✅ Ready |
| **SalesDashboard** | ✅ Ready (requires routing fix in DashboardPage) |
| **TransportDashboard** | ✅ Ready (requires routing fix in DashboardPage) |
| **CustomersPage** | ✅ Ready (minor — no detail page) |
| **OrdersPage** | ✅ Ready (needs filter logic fix for some statuses) |
| **OrderDetailPage** | ✅ Ready |
| **VisitDetailPage** | ✅ Ready |
| **NewVisitPage** | ✅ Ready |
| **CreditProgramsPage** | ✅ Ready |
| **CreditApplicationsPage** | ✅ Ready |
| **CreditReviewPage** | ✅ Ready |
| **CustomerCreditPage** | ✅ Ready |
| **WarehousePrepDetail** | ✅ Ready (inconsistent padding only) |
| **DeliveryPage** | ✅ Ready |
| **DeliveryDetailPage** | ✅ Ready |
| **CollectionsPage** | ✅ Ready |
| **NewCollectionPage** | ✅ Ready |
| **CollectionFollowupPage** | ✅ Ready |
| **StorefrontPage** | ✅ Ready |
| **CartPage** | ✅ Ready |
| **OrderReviewPage** | ✅ Ready |

### Cross-Page Issues

1. **No global RTL `dir`** — AppLayout does not set `dir="rtl"` at the root; pages rely on individual elements. Arabic text alignment may break in some components.
2. **No pagination anywhere** — All list pages load complete datasets. Over 500+ records will cause performance degradation and scrolling issues.
3. **Loading states** — All pages use basic "جاري التحميل..." text. No skeleton loaders or shimmer placeholders for perceived performance.
4. **Error handling** — Pages use basic `toast.error()` or console.error. No retry buttons or offline indicators.
5. **BottomNav icons** — Use single-letter characters (H, S, O, V, M) instead of proper SVG icons. Renders as plain text on all devices.
6. **Horizontal scroll patterns** — 3 different patterns used across the app: `overflow-x-auto` on tables (Warehouse), `flex-wrap` (Visits, Collections), `overflow-x-auto` on filter pills (Credit, Delivery). Inconsistent.
7. **No consistent `pb-24` in main content** — `AppLayout` has `pb-24` but Warehouse pages override padding with their own `p-6`, breaking the bottom nav clearance.

---

*Report type: Review only — no corrections implemented.*
