# Cleanup Report — ahram-distribution

**Generated:** 2026-06-08
**Source:** E:\joker\ahram-distribution
**Clean copy:** E:\ahram-distribution-clean

---

## Repository Inventory

### src/ — Source Code (52 files, ~30 TypeScript/TSX)

| Layer | Files | Description |
|---|---|---|
| **Entry** | `main.tsx`, `App.tsx`, `style.css` | App bootstrap, root component, Tailwind styles |
| **Types** | `types/database.ts`, `types/storefront.ts` (in use), `types/order-display.ts` (in use), `types/domain.ts` (UNUSED), `types/index.ts` (UNUSED barrel) | Database, storefront, and unified display types |
| **Engine** | `engine/pricing.ts` (in use), `engine/index.ts` (UNUSED barrel) | Pricing calculations, tier discounts |
| **Utils** | `utils/format.ts` (in use), `utils/codes.ts` (UNUSED), `utils/index.ts` (UNUSED barrel) | Currency/date formatting, code generators |
| **Lib** | `lib/supabase.ts`, `lib/whatsapp.ts`, `lib/diag.ts` | Supabase client, WhatsApp builder, GPS diagnostics |
| **Services** | `services/auth.ts`, `services/location.ts`, `services/targets.ts`, `services/credit.ts`, `services/auctions.ts`, `services/flashOffers.ts`, `services/dailyDeals.ts`, `services/deals.ts`, `services/tiers.ts`, `services/products.ts` (in use), `services/employees.ts` (UNUSED), `services/customers.ts` (UNUSED), `services/orders.ts` (UNUSED), `services/visits.ts` (UNUSED), `services/collections.ts` (UNUSED), `services/returns.ts` (UNUSED), `services/index.ts` (UNUSED barrel) | Data access layer via Supabase RPCs |
| **Stores** | `store/auth.ts`, `store/cart.ts`, `store/account.ts`, `store/visits.ts`, `store/orders.ts` (in use), `store/collections.ts` (UNUSED) | Zustand state management |
| **Hooks** | `hooks/useAuth.ts`, `hooks/useCapability.ts` (both in use), `hooks/index.ts` (UNUSED barrel) | Auth and capability hooks |
| **Routes** | `routes/index.tsx` | Main router with 50+ routes |
| **Layouts** | `layouts/AppLayout.tsx` | Shell with TopBar, BottomNav |
| **Components** | 25 component files across `auth/`, `orders/`, `shared/`, `visits/`, `splash/`, `storefront/` | UI components |
| **Pages** | 55+ page files across 20+ directories | Route-level pages |

### Root — Non-Source Files

| Category | Count | Gitignored? | Essential? |
|---|---|---|---|
| Config files (`package.json`, `tsconfig.json`, `vite.config.ts`) | 3 | No | YES |
| Source directories (`src/`, `public/`, `supabase/`, `docs/`) | 4 | No | YES |
| Debug/test scripts (`_test_*`, `debug-*`, `uat-*`, `query_*`, `test_prep`, `*_verify*`) | 17 | 9 yes, 8 no | No |
| Generated reports (`*.md` root level) | 11 | 1 yes | No (docs/ has canonical copies) |
| Log files (`*.log`) | 6 | All yes | No |
| Screenshots (root `*.png`) | 7 | No | No |
| `screenshots/` directory | 12 PNGs | No | No |
| `uat-screenshots/` directory | 47 PNGs | No | No |
| `design-reference/` | 1 PNG | No | Maybe (move to docs/) |
| Empty placeholder files (`node`, `npm`, `cd`, `@0.0.0`) | 4 | No | No |
| One-off utility scripts | 13 | No | No |
| `workspace/` directory | 52 files | Yes | No |
| `scripts/` directory | 13 files | Yes | Already gitignored |
| `pwa/` directory | 6 PNGs | No | No (duplicates `public/icons/`) |
| `dist/` (build output) | ~11 files | Yes | No (rebuildable) |
| `node_modules/` | N/A | Yes | No (reinstallable) |
| `.certs/` | 2 files | Yes | No |
| `test123/` | Empty dir | No | No |
| `_backup_live_functions.sql` | 1 file | Yes | No |

### supabase/ — SQL Migrations

| File | Functions Defined | In TS? |
|---|---|---|
| `20260602_register_customer.sql` | `register_customer`, `login_customer` | Partial (`login_customer` unused) |
| `20260602_p1_operational_completion.sql` | `governed_create_order`, `governed_get_order_items`, `get_governed_products`, `get_governed_customers` | YES |
| `20260602_runtime_screen_completion.sql` | `governed_update_product_pricing`, `governed_update_product_units` | YES |
| `20260603_flash_offers.sql` | CRUD for flash offers | Partial (`update`, `delete` unused) |
| `20260603_daily_deals.sql` | CRUD for daily deals | Partial (`update` unused) |
| `20260604_unified_identity_location.sql` | `governed_login`, `governed_create_customer`, `governed_create_employee`, `login_employee`, `check_capability`, `update_customer_location`, `get_governed_current_session` | Partial (`governed_login`, `update_customer_location`, `get_governed_current_session` unused) |
| `20260604_governance_rpcs.sql` | `get_governed_employees`, `get_governed_orders`, `get_governed_order`, order history, customer contacts/addresses | YES |
| `20260605_customer_direct_ownership.sql` | Ownership change RPCs | YES |
| `20260607_recovery_missing_functions.sql` | `governed_update_company_profile`, `register_customer_v2` | YES |
| `20260607_upper_management_dashboard_rpc.sql` | Dashboard RPC | YES |
| `20260608_customer_reality_gap_closure.sql` | `governed_create_customer_v2`, `governed_update_customer_v2` | YES |
| `20260608_schema_alignment.sql` | `get_governed_companies_v2` | YES |
| `20260609_employee_reality_gap_closure.sql` | Employee update v2, capabilities | YES |
| `20260610_fix_order_status_history_check.sql` | Status transition functions, `governed_dispatch_decision`, `governed_reject_order`, `governed_reopen_cancelled` | Partial (3 functions unused) |
| `20260612_monthly_targets_*.sql` | Target management RPCs (5 functions) | YES |
| `20260612_drilldown_performance_rpcs.sql` | KPI drill-down RPCs | YES |
| `20260614_management_rpcs.sql` | `governed_update_product_visibility`, `governed_update_product_inventory` | NO |
| `20260615_identity_rules_final.sql` | `register_customer_v3`, `get_governed_employees_v3`, `get_governed_identity` | YES |

**Unused SQL functions (12 total):** `login_customer`, `governed_login`, `get_governed_current_session`, `update_customer_location`, `governed_dispatch_decision`, `governed_reject_order`, `governed_reopen_cancelled`, `governed_update_product_visibility`, `governed_update_product_inventory`, `governed_update_flash_offer`, `governed_delete_flash_offer`, `governed_update_daily_deal`

---

## Dependency Report

### Unused Imports/Exports (Zero-Dependency Dead Code)

These items are exported but NEVER imported by any other file:

#### SAFE_DELETE — Services (never imported)
| File | Exports | Why Safe |
|---|---|---|
| `src/services/employees.ts` | `employeeService` | No file imports from it |
| `src/services/customers.ts` | `customerService` | No file imports from it |
| `src/services/orders.ts` | `orderService` | No file imports from it |
| `src/services/visits.ts` | `visitService` | No file imports from it |
| `src/services/collections.ts` | `collectionService` | No file imports from it |
| `src/services/returns.ts` | `returnService` | No file imports from it |

All six wrap Supabase RPC calls that other pages call directly via `supabase.rpc(...)`. The services appear to be from an earlier architecture before direct RPC calls became the pattern.

#### SAFE_DELETE — Store (never imported)
| File | Exports | Why Safe |
|---|---|---|
| `src/store/collections.ts` | `useCollectionsStore` | No file imports from it |

#### SAFE_DELETE — Types (never imported, content duplicated)
| File | Exports | Why Safe |
|---|---|---|
| `src/types/domain.ts` | `EmployeeRole`, `OrderStatus`, `VisitStatus`, `CollectionMethod`, `UnitType`, `DealType`, `AuctionStatus` | All these types are already defined in `src/types/storefront.ts` which IS used everywhere |

#### SAFE_DELETE — Utility (never imported)
| File | Exports | Why Safe |
|---|---|---|
| `src/utils/codes.ts` | 8 code generator functions | No file imports from it. Code generation likely handled by DB sequences or RPCs |

#### SAFE_DELETE — Partial function (exported but unused)
| File | Unused Export | Why Safe |
|---|---|---|
| `src/lib/diag.ts` | `gpsOperationRace` | Only `gpsOperation` is used. After GPS→WhatsApp decoupling, `gpsOperationRace` is dead and was kept only for backward compat |

#### SAFE_DELETE — Dead component (never imported)
| File | Exports | Why Safe |
|---|---|---|
| `src/components/shared/InvoiceView.tsx` | `InvoiceView` component | 443 lines, never imported by any consumer. Possibly superseded by `OrderDetailView.tsx` |

#### SAFE_DELETE — Barrel files (all directories have direct imports)
| File | Re-exports | Why Safe |
|---|---|---|
| `src/services/index.ts` | All 12 services | No file imports from `'../services'` or `'../../services'` |
| `src/types/index.ts` | database + domain | No file imports from `'../types'` or `'../../types'` |
| `src/utils/index.ts` | codes + format | No file imports from `'../utils'` or `'../../utils'` |
| `src/hooks/index.ts` | useAuth | No file imports from `'../hooks'` or `'../../hooks'` |
| `src/engine/index.ts` | pricing | No file imports from `'../engine'` or `'../../engine'` |
| `src/components/shared/shared.ts` | GuidedError, StatusBadge, InvoiceView, OrderCard, OrderDetailView | No file imports from it |
| `src/components/storefront/index.ts` | 8 storefront components | No file imports from it |
| `src/components/orders/index.ts` | OrderCard, OrderDetailView | No file imports from it |

#### SAFE_DELETE — Empty barrel directories
| Directory | Contents |
|---|---|
| `src/pages/admin/` | `index.ts` (empty) |
| `src/pages/chairman/` | `index.ts` (empty) |
| `src/pages/customer/` | `index.ts` (empty) |
| `src/pages/manager/` | `index.ts` (empty) |
| `src/pages/supervisor/` | `index.ts` (empty) |
| `src/pages/sales-supervisor/` | `index.ts` (empty) |

---

### Duplicate Implementations

#### HIGH PRIORITY — Unit Label Maps (13 copies)
| Location | Lines | Action |
|---|---|---|
| `src/types/order-display.ts` (canonical) | 117-121 | KEEP |
| `src/components/shared/InvoiceView.tsx` | 35 | NEEDS_REVIEW — replace with import |
| `src/components/orders/OrderDetailView.tsx` | 14 | NEEDS_REVIEW — replace with import |
| `src/pages/orders/OrderNewPage.tsx` | 261 | NEEDS_REVIEW — replace with import |
| `src/pages/orders/OrderEditPage.tsx` | 12 | NEEDS_REVIEW — replace with import |
| `src/pages/storefront/OrderReviewPage.tsx` | 29-33 | NEEDS_REVIEW — replace with import |
| `src/pages/checkout/CheckoutPage.tsx` | 31-33 | NEEDS_REVIEW — replace with import |
| `src/pages/products/ProductManagerPage.tsx` | 11 | NEEDS_REVIEW — replace with import |
| `src/pages/products/ProductProfilePage.tsx` | 10 | NEEDS_REVIEW — replace with import |
| `src/components/storefront/ProductCard.tsx` | 14-17 | NEEDS_REVIEW — replace with import |
| `src/components/storefront/CartItem.tsx` | 10-14 | NEEDS_REVIEW — replace with import |
| `src/services/products.ts` (inline ternary) | 41 | NEEDS_REVIEW — replace with import |
| `src/pages/returns/ReturnDetailPage.tsx` (inline ternary) | 88 | NEEDS_REVIEW — replace with import |

#### HIGH PRIORITY — Status Label Maps (5 copies)
| Location | Lines | Notes | Action |
|---|---|---|---|
| `src/types/order-display.ts` (canonical) | 101-115 | Full map, 14 statuses | KEEP |
| `src/components/orders/OrderDetailView.tsx` | 43-49 | Identical to canonical | NEEDS_REVIEW |
| `src/components/orders/OrderStatusManager.tsx` | 12-18 | Identical to canonical | NEEDS_REVIEW |
| `src/components/shared/InvoiceView.tsx` | 196-210 | Different Arabic labels + icons | NEEDS_REVIEW (icons differ) |
| `src/components/shared/StatusBadge.tsx` | 6-26 | Same labels + colors, extra non-order keys | NEEDS_REVIEW (colors needed) |

#### MEDIUM PRIORITY — PDF HTML Renderers (2 implementations)
| Location | Lines | Notes | Action |
|---|---|---|---|
| `src/components/shared/InvoiceView.tsx` | 39-179 | Groups items by company, supports A4/A5, has timeline | NEEDS_REVIEW |
| `src/components/orders/OrderDetailView.tsx` | 52-133 | Inline items, no company grouping, no A5 | NEEDS_REVIEW |
| Both have identical `printInvoice` function | 181-189 / 135-144 | **Identical code** | SAFE_DELETE (extract shared) |

#### MEDIUM PRIORITY — Helper Duplicates
| Helper | Files | Action |
|---|---|---|
| `money()` formatting | InvoiceView.tsx (13-16) + OrderDetailView.tsx (38-41) | **Identical** — both should use `formatCurrencyShort` from utils |
| `esc()` HTML escaping | InvoiceView.tsx (6-11) + OrderDetailView.tsx (7-12) | **Identical** — extract to shared util |
| `formatDateTime` | whatsapp.ts (18-28, private) + VisitCard.tsx (3-10, private) + utils/format.ts (canonical) | **3 implementations** — whatsapp.ts variant produces `yyyy-MM-dd HH:mm`, canonical produces locale-aware Arabic format |

#### MEDIUM PRIORITY — Company Grouping (3 implementations)
| Location | Lines | Data path | Action |
|---|---|---|---|
| `src/components/shared/InvoiceView.tsx` (groupItems) | 24-33 | `products.companies.company_name` | KEEP (if InvoiceView kept) |
| `src/components/orders/OrderDetailView.tsx` (inline) | 200-210 | `products.companies.company_name` | NEEDS_REVIEW |
| `src/lib/whatsapp.ts` (inline) | 76-81 | `companyName` (from OrderDisplayItem) | KEEP (different data model) |

#### LOW PRIORITY — Inline Price Calculation
| Location | Lines | Duplicates | Action |
|---|---|---|---|
| `src/pages/products/ProductsPage.tsx` | 210-211 | `computePiecePrice` / `computeDozenPrice` from engine/pricing.ts | NEEDS_REVIEW |
| `src/pages/products/ProductProfilePage.tsx` | ~107-119 | Same inline piece/dozen/carton price display | NEEDS_REVIEW |

### Legacy Code Paths

| Path | Status | Notes |
|---|---|---|
| `sendFullOrderToWhatsApp` → `buildFullWhatsAppMessage` (old) | **ALREADY REMOVED** | All 4 screens now use `sendWhatsAppFromDisplay` |
| `gpsOperationRace` in WhatsApp flows | **ALREADY REMOVED** | GPS completely separated from WhatsApp |
| `FreshLocation` import in whatsapp.ts | **ALREADY REMOVED** | Old type import no longer needed |
| `buildAddress` helper | **ALREADY REMOVED** | Old address builder removed with old WhatsApp code |
| 6 services not imported | SAFE_DELETE | employees, customers, orders, visits, collections, returns |
| `useCollectionsStore` | SAFE_DELETE | Never imported |
| 12 SQL functions without TS reference | SAFE_DELETE | Listed in SQL section above |

---

## Cleanup Plan

### SAFE_DELETE — Zero risk, not referenced by any code

#### Source files

| # | File | Reason | Dependency Trace |
|---|---|---|---|
| 1 | `src/services/employees.ts` | Never imported; all consumers call `supabase.rpc('get_governed_employees', ...)` directly | **Chain:** `src/services/index.ts` (unused barrel) → no importers |
| 2 | `src/services/customers.ts` | Never imported | Same as above |
| 3 | `src/services/orders.ts` | Never imported | Same as above |
| 4 | `src/services/visits.ts` | Never imported | Same as above |
| 5 | `src/services/collections.ts` | Never imported | Same as above |
| 6 | `src/services/returns.ts` | Never imported | Same as above |
| 7 | `src/services/index.ts` | Barrel, never imported | **Dependency:** re-exports all 12 services; removing requires deleting individual service files too |
| 8 | `src/store/collections.ts` | `useCollectionsStore` never imported | **Chain:** no file imports from it |
| 9 | `src/types/domain.ts` | All types duplicated in `storefront.ts` which IS used | **Chain:** re-exported by `types/index.ts` (unused barrel) |
| 10 | `src/types/index.ts` | Barrel, never imported | No file imports from `'../types'` or `'../../types'` |
| 11 | `src/utils/codes.ts` | 8 generators never imported | **Chain:** re-exported by `utils/index.ts` (unused barrel) |
| 12 | `src/utils/index.ts` | Barrel, never imported | No file imports from `'../utils'` or `'../../utils'` |
| 13 | `src/hooks/index.ts` | Barrel, never imported | No file imports from `'../hooks'` or `'../../hooks'` |
| 14 | `src/engine/index.ts` | Barrel, never imported | No file imports from `'../engine'` or `'../../engine'` |
| 15 | `src/components/shared/shared.ts` | Barrel, never imported | No file imports from it |
| 16 | `src/components/storefront/index.ts` | Barrel, never imported | No file imports from it |
| 17 | `src/components/orders/index.ts` | Barrel, never imported | No file imports from it |
| 18 | `src/components/shared/InvoiceView.tsx` | Component never imported; 443 lines dead | **Chain:** re-exported by `shared.ts` (unused barrel) → no importers |
| 19-24 | `src/pages/admin/index.ts` through `src/pages/sales-supervisor/index.ts` (6 empty dirs) | Empty barrels, no pages | No files exist in these directories |

#### SQL functions (no TS reference)

| # | Function | File |
|---|---|---|
| 25 | `login_customer` | `20260602_register_customer.sql` |
| 26 | `governed_login` | `20260604_unified_identity_location.sql` |
| 27 | `get_governed_current_session` | `20260604_unified_identity_location.sql` |
| 28 | `update_customer_location` | `20260604_unified_identity_location.sql` |
| 29 | `governed_dispatch_decision` | `20260610_fix_order_status_history_check.sql` |
| 30 | `governed_reject_order` | `20260610_fix_order_status_history_check.sql` |
| 31 | `governed_reopen_cancelled` | `20260610_fix_order_status_history_check.sql` |
| 32 | `governed_update_product_visibility` | `20260614_management_rpcs.sql` |
| 33 | `governed_update_product_inventory` | `20260614_management_rpcs.sql` |
| 34 | `governed_update_flash_offer` | `20260603_flash_offers.sql` |
| 35 | `governed_delete_flash_offer` | `20260603_flash_offers.sql` |
| 36 | `governed_update_daily_deal` | `20260603_daily_deals.sql` |

#### Root files (never needed for build/dev)

| # | File/Directory | Reason |
|---|---|---|
| 37-53 | 17 debug/test scripts (`_test_*`, `debug-*`, `uat-*`, `query_*`, `test_prep`, `*_verify*`, etc.) | One-off utilities, 9 already gitignored |
| 54-64 | 11 root `*.md` reports | Generated reports; canonical docs in `docs/` |
| 65 | `dist/` | Build output, gitignored, rebuildable |
| 66 | `test123/` | Empty artifact directory |
| 67-70 | 4 empty placeholder files (`node`, `npm`, `cd`, `ahram-distribution@0.0.0`) | 0-byte files, completely useless |
| 71-83 | 13 one-off utility scripts (`bulk-deliver.mjs`, `gencert*`, `mk*`, `investigate*`, `post-correction-report.mjs`, `check-supervisors.mjs`, `create-may-targets.mjs`) | One-off tools never needed for app |
| 84 | `index.html` (root) | Test HTML page, not the app entry |
| 85-91 | 7 root `*.png` screenshots | Debug images, non-essential |
| 92 | `screenshots/` (12 PNGs) | Screenshots directory |
| 93 | `uat-screenshots/` (47 PNGs) | UAT test output |
| 94 | `pwa/` (6 PNGs) | PWA icon sources; `public/icons/` has the built copies |
| 95 | `workspace/` | Already gitignored |
| 96 | `.certs/` | Already gitignored; certificates are dev-only |
| 97 | `_backup_live_functions.sql` | Gitignored, backup dump |
| 98 | `scripts/` | Already gitignored |

#### Partial SAFE_DELETE (function-level)

| # | Symbol | File | Reason |
|---|---|---|---|
| 99 | `gpsOperationRace` export | `src/lib/diag.ts` | Exported but never imported. Only `gpsOperation` is used |

---

### NEEDS_REVIEW — Requires code changes, not simple delete

#### Source deduplication (consolidate to canonical sources)

| # | Pattern | Files Involved | Suggested Action |
|---|---|---|---|
| 100 | Unit label maps (12 redundant copies) | 12 files across components/pages | Replace each inline map with `import { UNIT_LABELS } from '../../types/order-display'` |
| 101 | Status label maps (4 redundant copies) | OrderDetailView.tsx, OrderStatusManager.tsx, InvoiceView.tsx, StatusBadge.tsx | Import `ORDER_STATUS_LABELS` from order-display.ts; keep StatusBadge.tsx's color config but reference labels from canonical |
| 102 | PDF renderers (2 implementations) | InvoiceView.tsx + OrderDetailView.tsx | Merge into shared utility; the InvoiceView version is more feature-rich (company grouping, A4/A5, timeline) |
| 103 | `money()` helper (2 copies) | InvoiceView.tsx + OrderDetailView.tsx | Replace both with `formatCurrencyShort` from `src/utils/format.ts` |
| 104 | `esc()` helper (2 copies) | InvoiceView.tsx + OrderDetailView.tsx | Extract to shared utility (e.g., `src/utils/format.ts`) |
| 105 | `formatDateTime` private copies | whatsapp.ts (private) + VisitCard.tsx (private) | Replace with `formatDateTime` from `src/utils/format.ts` (note: format differs — canonical uses Arabic locale, WhatsApp needs `yyyy-MM-dd HH:mm`) |
| 106 | `groupItems()` company grouping (2 copies) | InvoiceView.tsx (exported but only used internally) + OrderDetailView.tsx (inline IIFE) | Extract `groupItems` to shared utility |
| 107 | Inline piece/dozen price calc | ProductsPage.tsx + ProductProfilePage.tsx | Replace with `computePiecePrice`/`computeDozenPrice` from `src/engine/pricing.ts` |

#### SQL function version consolidation

| # | RPC Name | Versions | Suggested Action |
|---|---|---|---|
| 108 | `register_customer` | v1 (original), v2 (+email), v3 (+SUPER_ADMIN) | Keep only latest (v3) in migration; script intermediate versions as comments |
| 109 | `governed_create_customer` | 2 versions | Keep only latest |
| 110 | `governed_update_customer` | 2 versions | Keep only latest |
| 111 | `get_governed_employees` | 3 versions | Keep only latest (v3 with identity_type in `20260615_identity_rules_final.sql`) |
| 112 | `get_governed_orders` | 2 versions | Keep only latest |
| 113 | `get_governed_order` | 2 versions | Keep only latest |
| 114 | Monthly targets functions | 2 versions each | Keep only latest (with `new_customers` column) |

#### Root file cleanup

| # | Item | Suggested Action |
|---|---|---|
| 115 | `design-reference/` | Move to `docs/design/` |
| 116 | `docs/` duplication with root `*.md` | Archive root reports in `docs/archive/verification/` |
| 117 | `.gitignore` | Add patterns for root files not yet covered (PNGs, debug scripts, empty placeholders, `pwa/`) |

---

### KEEP — Essential files (no action)

#### Source files (required for the app to function)

| Layer | Files |
|---|---|
| **Entry** | `src/main.tsx`, `src/App.tsx`, `src/style.css` |
| **Runtime config** | `src/ambient.d.ts`, `src/vite-env.d.ts` |
| **Types (in use)** | `src/types/storefront.ts`, `src/types/order-display.ts`, `src/types/database.ts` |
| **Engine** | `src/engine/pricing.ts` |
| **Utils** | `src/utils/format.ts` |
| **Lib** | `src/lib/supabase.ts`, `src/lib/whatsapp.ts`, `src/lib/diag.ts` (keep `gpsOperation`, can remove `gpsOperationRace`) |
| **Services (in use)** | `src/services/auth.ts`, `src/services/location.ts`, `src/services/targets.ts`, `src/services/credit.ts`, `src/services/auctions.ts`, `src/services/products.ts`, `src/services/deals.ts`, `src/services/flashOffers.ts`, `src/services/dailyDeals.ts`, `src/services/tiers.ts` |
| **Stores (in use)** | `src/store/auth.ts`, `src/store/cart.ts`, `src/store/account.ts`, `src/store/visits.ts`, `src/store/orders.ts` |
| **Hooks** | `src/hooks/useAuth.ts`, `src/hooks/useCapability.ts` |
| **Routes** | `src/routes/index.tsx` |
| **Layout** | `src/layouts/AppLayout.tsx` |
| **Components (in use)** | ProtectedRoute, BottomNav, TopBar, GlobalSearch, StatusBadge, GuidedError, SplashScreen, OfflinePage, InstallBanner, OrderCard, OrderStatusManager, all storefront components, VisitCard |
| **Pages** | All 55+ page files (every page is referenced in routes or imported by another page) |
| **OrderDisplayData builder** | `src/types/order-display.ts` `buildOrderDisplayData()` — canonical display builder |
| **WhatsApp** | `src/lib/whatsapp.ts` `buildWhatsAppMessageFromDisplay`, `sendWhatsAppFromDisplay`, `copyWhatsAppFromDisplay` |

#### Root config files

| File | Purpose |
|---|---|
| `package.json` | Project manifest, scripts, dependencies |
| `package-lock.json` | Dependency lock file |
| `tsconfig.json` | TypeScript configuration |
| `vite.config.ts` | Vite build configuration |
| `.env` / `.env.example` | Environment variables |
| `.gitignore` | Git ignore rules |
| `index.html` (in project root) | **This IS the app entry HTML — KEEP** (it loads `src/main.tsx`) |
| `public/` | Static assets (favicon, PWA icons, manifest) |
| `supabase/` | SQL migrations (keep all with cleanup of unused functions) |
| `docs/` | Core project documentation |

---

## Summary

| Classification | Items | Impact |
|---|---|---|
| **SAFE_DELETE** | 99 items (18 source files, 12 SQL functions, 69 root files) | Zero runtime impact. All are dead code or artifacts. |
| **NEEDS_REVIEW** | 18 items (12 deduplication tasks, 6 version consolidation tasks) | Improves maintainability but requires code changes |
| **KEEP** | ~80+ files (all active source, config, and essential assets) | No action needed |

### Recommended Phase 2 Order

1. **Delete** 18 source files (services, stores, types, barrels, empty dirs, dead component) + `gpsOperationRace` export
2. **Remove** 69 root artifacts (debug scripts, reports, screenshots, placeholders)
3. **Drop** 12 unused SQL functions from migration files
4. **Consolidate** duplicate maps (unit labels → 1 canonical source, status labels → 1 canonical source)
5. **Extract** shared utilities (`esc`, `groupItems`, shared PDF renderer)
6. **Replace** `money()` with `formatCurrencyShort`; replace inline `formatDateTime` with canonical import
7. **Merge** PDF renderers from InvoiceView and OrderDetailView
8. **Clean** .gitignore to cover remaining loose files
