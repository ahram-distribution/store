# CHANGELOG — Ahram Distribution Management System

**Last updated:** 2026-06-05  
**Full history:** PROJECT_CHANGELOG.md (907 lines) — the authoritative historical record.

---

## 2026-06-05 — Phase 3 Database Recovery
- Created `20260603_recovery_missing_tables.sql`: 9 tables (1 app + 8 public), 3 enums, 25 constraints, 8 indexes
- Created `20260607_recovery_missing_functions.sql`: 92 functions recovered from live DB
- Database is now fully reproducible from migrations
- See: `docs/archive/verification/PHASE3_RECOVERY_REPORT.md`

## 2026-06-05 — Phase 2 System Verification
- Verified live DB against 30 migration files and all source code
- Identified 17+ tables and 83 functions missing from migrations
- Documented governance bypass in `deals.ts`
- See: `docs/archive/verification/PHASE2_VERIFICATION_REPORT.md`

## 2026-06-04 — Unified Identity & Location Standard
- `20260604_unified_identity_location.sql`: business_type ENUM, unified_locations table
- Shared location service (`src/services/location.ts`)
- Customer UI updates (GPS capture, business_type dropdown)

## 2026-06-04 — Credit Program Module V2
- 3 new tables: customer_credit_accounts, credit_invoices, credit_invoice_cheques
- 10 new governed RPCs for credit management
- Full credit dashboard UI (CustomerCreditPage, CreditManagementPage)

## 2026-06-03 — Auction Module V2
- 6 V2 tables with realtime support
- 7 governed RPCs (list, detail, participate, bid, approve, end)

## 2026-06-03 — Daily Deals & Flash Offers
- Full lifecycle management with governed RPCs
- Order integration (add deals/offers to orders)

## 2026-06-03 — Tier System
- Tier pricing enforcement with company/product exceptions
- 10 governed RPCs

## 2026-06-02 — Operational Completion
- Employee management, visit lifecycle, order approval workflow
- Customer governance (create/update/activate/deactivate)

## 2026-05-31 — Foundation Phases
- Phase 1: Identity & Governance
- Phase 2-4: Customers, Products, Tiers
- Phase 5: Orders
- Phase 6: Collections & Treasury
- Phase 7: Returns
- Phase 8: Visits
- Phase 9: Packages
- Phase 10: Auctions V1
