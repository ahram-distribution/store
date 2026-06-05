# CURRENT STATE — Ahram Distribution Management System

**Last updated:** 2026-06-05  
**Source of truth:** SYSTEM_BLUEPRINT.md, PROJECT_CHANGELOG.md

---

## Project Status

The system is in **controlled execution phase** — post-discovery, actively implementing modules against a live Supabase production database.

| Attribute | Value |
|---|---|
| Project | Ahram Distribution Management System |
| Database | Supabase PostgreSQL 17.6.1.127 (eu-west-1) |
| Frontend | React 18 + Vite 5 + TypeScript 5.6 |
| Auth | Custom bcrypt-based (phone + password) with session tokens |
| Status | ACTIVE_HEALTHY |

## What Has Been Built

### Core Infrastructure
- Custom authentication system (identity/session management, capability-based access control)
- 30 database migrations covering identity, customers, products, orders, collections, returns, visits, deals, flash offers, auctions, credit, and governance
- 118+ governed RPC functions (SECURITY DEFINER with session validation)
- Full role/capability system with hierarchical employee management

### Business Modules
- **Customers**: Registration, profiles, analytics, ownership management, contacts, addresses
- **Products**: Multi-company products with flexible units (carton/piece), inventory tracking
- **Orders**: Full lifecycle (create → submit → approve → prepare → dispatch → deliver), tier-based pricing, daily deal/flash offer integration
- **Collections**: Payment collection with follow-up queue
- **Returns**: Return management with inspection workflow
- **Visits**: Sales rep visit tracking with check-in/check-out
- **Daily Deals**: Time-limited fixed-price deals
- **Flash Offers**: Time-limited discount offers
- **Auctions V2**: Live bidding with realtime updates, deposits, participant management
- **Credit Module V2**: Credit programs, applications, contracts, accounts (limits/reservations), invoices/cheques, auto-suspension
- **Delivery Tracking**: Assignment, dispatch, completion with status tracking
- **Warehouse**: Preparation workflow with exception handling
- **Company Profile**: Single-row company branding/config
- **Tier System**: Customer tier-based pricing with company/product exceptions

### Governance
- All data access routed through SECURITY DEFINER RPCs (session validation + capability check)
- Route-level capability guards in frontend (ProtectedRoute)
- Component-level capability checks (useCapability hook with 5-min TTL)
- RLS policies defined but dormant (architectural choice to rely on RPC authorization)

## Recent Milestones

| Date | Milestone |
|---|---|
| 2026-06-04 | Unified Identity & Location Standard — completed location service, customer location UX |
| 2026-06-04 | Credit Program Module V2 — accounts, invoices, cheques, reservation flow |
| 2026-06-03 | Auction Module V2 — realtime bidding, governed RPCs, deposits |
| 2026-06-03 | Daily Deals & Flash Offers — governed RPCs, order integration |
| 2026-06-03 | Tier System — pricing enforcement with company/product exceptions |
| 2026-06-02 | Operational completion — employee management, visit/customer/order governance |
| 2026-06-02 | Phase 1 & 2 — identity governance, customer CRUD |
| 2026-06-05 | Phase 2 Verification — DB vs migration drift analysis |
| 2026-06-05 | Phase 3 Recovery — 92 functions and 9 tables recovered to migrations |

## Key Metrics

| Metric | Value |
|---|---|
| Database tables | ~57 (public) + 1 (app) |
| Governed RPCs | 118+ |
| Migration files | 32 (30 original + 2 recovery) |
| Frontend routes | 50+ |
| Frontend pages | 76 components |
| Custom types/enums | 14 |

## Architecture

```
Frontend (React + Zustand)
  → Service Layer (12 services)
    → RPC Layer (SECURITY DEFINER functions)
      → Database (PostgreSQL + RLS dormant)
```

## Ownership & Contacts

- **Database**: `gbcbejejgpvltuhbztbx` (Supabase project "alahram Project")
- **Source**: `D:\Ahram Distribution\ahram-distribution`
