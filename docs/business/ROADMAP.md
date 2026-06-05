# ROADMAP — Ahram Distribution Management System

**Last updated:** 2026-06-05  
**Source:** PROJECT_CHANGELOG.md, SYSTEM_BLUEPRINT.md

---

## Completed Phases

| Phase | Date | Description |
|---|---|---|
| Identity & Governance | 2026-05-31 | Identity schema, employees, roles, capabilities, sessions |
| Customers | 2026-05-31 | Customer CRUD, addresses, contacts, ownership, credit ledger |
| Products | 2026-05-31 | Multi-company products, flexible units, inventory |
| Orders | 2026-05-31 | Order lifecycle, items, status history, modifications |
| Collections & Treasury | 2026-05-31 | Collections, treasury transactions, expenses, advances |
| Returns | 2026-05-31 | Return management, items, inspection |
| Visits | 2026-05-31 | Visit check-in/check-out, tracking |
| Packages | 2026-05-31 | Package deals (legacy, tables removed from live) |
| Auctions V1 | 2026-05-31 | Legacy auction system (deprecated by V2) |
| Tier System | 2026-06-03 | Tier pricing, company/product exceptions |
| Daily Deals | 2026-06-03 | Time-limited fixed-price deals with governed RPCs |
| Flash Offers | 2026-06-03 | Time-limited discount offers with governed RPCs |
| Auctions V2 | 2026-06-03 | Realtime bidding, deposits, governed RPCs |
| Unified Identity & Location | 2026-06-04 | Location service, business_type, customer location UX |
| Credit Module V2 | 2026-06-04 | Accounts, invoices, cheques, reservations, auto-suspension |
| Phase 2 Verification | 2026-06-05 | DB vs migration drift analysis |
| Phase 3 Recovery | 2026-06-05 | Database reproducibility restoration |

## Future Work

### High Priority
- Fix legacy `deals.ts` governance bypass (migrate to governed RPCs)
- Remove unused services and dead code
- Update SYSTEM_BLUEPRINT.md version claims (Vite 8 → 5, React 19 → 18)

### Medium Priority
- Consider enabling RLS on key tables for defense-in-depth
- Consolidate duplicate auth functions (`api` schema vs `public` schema)
- Replace hardcoded employee codes in `get_collection_followup_queue`
- Regenerate MASTER_FEATURE_AUDIT.md

### Low Priority
- Remove empty stub directories or implement workspace-specific dashboards
- The remaining 6 workspace stubs (admin, chairman, customer, manager, supervisor, sales-supervisor)

## Guiding Principles

1. **No architecture redesign** unless explicitly requested
2. **Governance first** — all data access through governed RPCs
3. **DB reproducibility** — all database objects must have a migration source
4. **Documentation currency** — every task updates SYSTEM_BLUEPRINT.md and PROJECT_CHANGELOG.md
