# PAGE HEALTH REPORT

**Last generated:** 2026-06-16

## Summary

| Metric | Value |
|--------|-------|
| Total routes | 64 |
| Public routes | 11 |
| Protected routes (employee) | ~53 |
| Protected routes (customer) | ~14 |
| ✅ Routes OK | — |
| ❌ Routes with errors | — |
| 💥 Crashes / White Screen | — |

## Per-Page Status

### Public Routes (Unauthenticated)

| # | Route | Status | Errors | Missing Data | Notes |
|---|-------|--------|--------|-------------|-------|
| 1 | `/login` | ⏳ | — | — | |
| 2 | `/register` | ⏳ | — | — | |
| 3 | `/storefront` | ⏳ | — | ⚠️ CompaniesPage uses `supabase.from('companies')` — blocked | V-002 violation, returns empty |
| 4 | `/storefront/products` | ⏳ | — | — | |
| 5 | `/daily-deals` | ⏳ | — | — | |
| 6 | `/daily-deals/:id` | ⏳ | — | — | |
| 7 | `/flash-offers` | ⏳ | — | — | |
| 8 | `/flash-offers/:id` | ⏳ | — | — | |
| 9 | `/tiers` | ⏳ | — | — | |
| 10 | `/auctions` | ⏳ | — | — | |
| 11 | `/auctions/:id` | ⏳ | — | — | |

### Protected Routes (Employee)

| # | Route | Status | Errors | Missing Data | Notes |
|---|-------|--------|--------|-------------|-------|
| 1 | `/dashboard` | ⏳ | — | — | |
| 2 | `/dashboard/performance` | ⏳ | — | — | |
| 3 | `/dashboard/company-targets` | ⏳ | — | — | |
| 4 | `/dashboard/employee-targets` | ⏳ | — | — | |
| 5 | `/dashboard/employee-analysis` | ⏳ | — | ⚠️ `supabase.from('customers')` — blocked | Returns 0 for customer count |
| 6 | `/visits` | ⏳ | — | — | |
| 7 | `/visits/screen` | ⏳ | — | — | |
| 8 | `/visits/new` | ⏳ | — | — | |
| 9 | `/visits/:id` | ⏳ | — | — | |
| 10 | `/customers` | ⏳ | — | — | |
| 11 | `/customers/new` | ⏳ | — | — | |
| 12 | `/customers/:id` | ⏳ | — | '—' fallbacks in display | |
| 13 | `/customers/:id/analytics` | ⏳ | — | — | |
| 14 | `/analytics/customers` | ⏳ | — | — | |
| 15 | `/collections` | ⏳ | — | — | |
| 16 | `/collections/new` | ⏳ | — | — | |
| 17 | `/collections/followup` | ⏳ | — | — | |
| 18 | `/returns` | ⏳ | — | — | |
| 19 | `/returns/new` | ⏳ | — | — | |
| 20 | `/returns/:id` | ⏳ | — | — | |
| 21 | `/products` | ⏳ | — | — | |
| 22 | `/products/:id` | ⏳ | — | — | |
| 23 | `/products/manage` | ⏳ | — | — | |
| 24 | `/deals` | ⏳ | — | — | |
| 25 | `/daily-deals/manage` | ⏳ | — | — | |
| 26 | `/flash-offers/manage` | ⏳ | — | — | |
| 27 | `/tiers/manage` | ⏳ | — | — | |
| 28 | `/auctions/manage` | ⏳ | — | — | |
| 29 | `/credit/manage` | ⏳ | — | — | |
| 30 | `/credit/programs` | ⏳ | — | — | |
| 31 | `/credit/programs/manage` | ⏳ | — | — | |
| 32 | `/credit/applications` | ⏳ | — | — | |
| 33 | `/credit/applications/:id` | ⏳ | — | — | |
| 34 | `/warehouse` | ⏳ | — | '—' fallbacks | |
| 35 | `/warehouse/review` | ⏳ | — | '—' fallbacks | |
| 36 | `/warehouse/prep/:id` | ⏳ | — | '—' fallbacks | |
| 37 | `/delivery` | ⏳ | — | — | |
| 38 | `/delivery/:id` | ⏳ | — | — | |
| 39 | `/employees` | ⏳ | — | — | |
| 40 | `/employees/:id` | ⏳ | — | — | |
| 41 | `/hierarchy` | ⏳ | — | — | |
| 42 | `/companies` | ⏳ | — | — | |
| 43 | `/companies/:id` | ⏳ | — | — | |
| 44 | `/companies/manage` | ⏳ | — | — | |
| 45 | `/reports` | ⏳ | — | — | |
| 46 | `/activity` | ⏳ | — | — | |
| 47 | `/settings/company` | ⏳ | — | — | |
| 48 | `/launcher/:module` | ⏳ | — | — | |
| 49 | `/account/profile` | ⏳ | — | — | |
| 50 | `/account/permissions` | ⏳ | — | — | |
| 51 | `/command-center` | ⏳ | — | — | |
| 52 | `/command-center/modules/:moduleKey` | ⏳ | — | — | |
| 53 | `/attendance` | ⏳ | — | — | |
| 54 | `/attendance/runtime` | ⏳ | — | — | |
| 55 | `/attendance/settings` | ⏳ | — | — | |
| 56 | `/attendance/team-map` | ⏳ | — | — | |
| 57 | `/attendance/employee/:employeeId/:date` | ⏳ | — | — | |
| 58 | `/attendance/operations` | ⏳ | — | — | |
| 59 | `/sales-manager-cc` | ⏳ | — | — | |
| 60 | `/ops/gps-test` | ⏳ | — | — | |

### Protected Routes (Customer)

| # | Route | Status | Errors | Missing Data | Notes |
|---|-------|--------|--------|-------------|-------|
| 1 | `/storefront` | ⏳ | — | ⚠️ same as public | |
| 2 | `/storefront/products` | ⏳ | — | — | |
| 3 | `/cart` | ⏳ | — | — | |
| 4 | `/order-review` | ⏳ | — | — | |
| 5 | `/checkout` | ⏳ | — | — | |
| 6 | `/order-success` | ⏳ | — | — | |
| 7 | `/orders` | ⏳ | — | — | |
| 8 | `/orders/:id` | ⏳ | — | '—' fallbacks | |
| 9 | `/credit` | ⏳ | — | — | |
| 10 | `/tiers` | ⏳ | — | — | |
| 11 | `/auctions` | ⏳ | — | — | |
| 12 | `/auctions/:id` | ⏳ | — | — | |
| 13 | `/daily-deals` | ⏳ | — | — | |
| 14 | `/flash-offers` | ⏳ | — | — | |
| 15 | `/account` | ⏳ | — | — | |

## Known Issues

### Issue #1 — V-002: CompaniesPage uses blocked `supabase.from('companies')`
- **File:** `src/pages/storefront/CompaniesPage.tsx:22-28`
- **Effect:** Companies list always empty (returns ENFORCEMENT_BLOCK)
- **Fix:** Replace with governed RPC (e.g. `get_governed_companies`)
- **Priority:** Medium

### Issue #2 — V-002: EmployeeAnalysisPage uses blocked `supabase.from('customers')`
- **File:** `src/pages/dashboard/EmployeeAnalysisPage.tsx:209-213`
- **Effect:** Customer count always 0
- **Fix:** Replace with governed RPC
- **Priority:** Low

### Issue #3 — '—' fallback strings used instead of "غير متوفر"
- **Scope:** 40+ files use `|| '—'` pattern
- **Fix:** Use `displayValue()` from `src/utils/safeValue.ts`
- **Priority:** Low (cosmetic)

### Issue #4 — ProtectedRoute capability check race condition
- **Effect:** Flash of spinner before redirect when capability check fails
- **Priority:** Low

## Health Check System

The health check system (`src/utils/pageHealthCheck.ts`) provides:

- **`healthMonitor`** — Singleton that monitors `console.error`, `window.onerror`, and `unhandledrejection`
- **`ROUTE_MANIFEST`** — Complete list of all routes for scanning
- **`runDiagnostic()`** — Trigger route scan from dev console (`window.__runDiagnostic()`)
- **`ErrorBoundary`** — Catches render errors and shows fallback UI instead of white screen
- **`NotFoundPage`** — Custom 404 page for unknown routes
- **`displayValue()`** — Replaces `—`/null/undefined with "غير متوفر"

To run a diagnostic:
```js
// In browser dev console:
window.__runDiagnostic().then(report => console.table(report.records))
```
