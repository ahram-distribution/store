# Ahram Distribution — Documentation Index

**Welcome.** This directory organizes all project documentation.  
Open this file first to understand what exists and where to go.

---

## Quick Start

| You want to... | Open this |
|---|---|
| Understand current project state | `docs/business/CURRENT_STATE.md` |
| See what's broken or at risk | `docs/business/KNOWN_ISSUES.md` |
| Check what's planned | `docs/business/ROADMAP.md` |
| Understand business rules | `docs/business/BUSINESS_RULES.md` |
| See what changed recently | `docs/business/CHANGELOG.md` |
| Understand system architecture | `docs/technical/SYSTEM_BLUEPRINT.md` |
| Understand database structure | `docs/technical/DATABASE_ARCHITECTURE.md` |
| Understand access control | `docs/technical/GOVERNANCE.md` |
| See migration order | `docs/technical/MIGRATION_HISTORY.md` |
| Read historical reports | `docs/archive/` |

---

## Document Map

### `/docs/business/` — For Business Owners & Stakeholders

| Document | What it is | Source of Truth? |
|---|---|---|
| `CURRENT_STATE.md` | Current project status, what's built, key metrics | **YES** — consolidated from SYSTEM_BLUEPRINT + changelog |
| `KNOWN_ISSUES.md` | All known bugs, risks, and technical debt | **YES** — consolidated from verification reports |
| `ROADMAP.md` | Completed phases, future priorities | **YES** — consolidated from changelog + blueprint |
| `BUSINESS_RULES.md` | Domain rules (orders, credit, auctions, etc.) | **YES** — consolidated from source + blueprint |
| `CHANGELOG.md` | Abbreviated change history | Summary — full history in `PROJECT_CHANGELOG.md` |

### `/docs/technical/` — For Developers & Technical Staff

| Document | What it is | Source of Truth? |
|---|---|---|
| `SYSTEM_BLUEPRINT.md` | Architecture overview (copy from root) | **ROOT** `SYSTEM_BLUEPRINT.md` is authoritative |
| `DATABASE_ARCHITECTURE.md` | Schema, tables, types, dependencies | **YES** — consolidated from migration analysis + Phase 3 |
| `GOVERNANCE.md` | Access control model, capabilities, bypasses | **YES** — consolidated from Phase 2 + blueprint |
| `MIGRATION_HISTORY.md` | Migration order, file listing, stats | **YES** — consolidated from migration files |

### `/docs/archive/` — Historical Reports (Reference Only)

These documents contain detailed findings from past verification and review cycles. They are preserved as-is for traceability but may contain stale information.

#### `/docs/archive/verification/`
- `PHASE2_VERIFICATION_REPORT.md` — DB vs migration drift analysis (2026-06-05)
- `PHASE3_RECOVERY_REPORT.md` — Database recovery completion report (2026-06-05)
- `MASTER_FEATURE_AUDIT.md` — Feature-level audit (2026-06-03, **stale** — pre-dates governance additions)
- `RUNTIME_UI_REVIEW_REPORT.md` — UI/UX review
- `BUSINESS_RUNTIME_VERIFICATION_REPORT.md` — Business flow verification
- `ORDER_GOVERNANCE_HARDENING_REPORT.md` — Order governance audit
- `RUNTIME_INTEGRITY_AUDIT_REPORT.md` — Runtime integrity audit
- `USER_ACCEPTANCE_RUNTIME_REVIEW_REPORT.md` — UAT review

#### `/docs/archive/runtime-extraction/`
- `INVOICE_REFERENCE.md` — Invoice flow reference
- `MY_CUSTOMERS_REFERENCE.md` — Customer list reference
- `MY_ORDERS_REFERENCE.md` — Order list reference
- `NEW_CUSTOMER_REFERENCE.md` — New customer flow reference
- `ORDER_FLOW_REFERENCE.md` — Order flow reference
- `WHATSAPP_ORDER_REFERENCE.md` — WhatsApp order reference

#### `/docs/archive/project-state/`
- `MASTER_PROJECT_STATE.md` — Comprehensive project state (205 KB)
- `CURRENT_RUNTIME_IMPLEMENTATION.md` — Runtime implementation detail

---

## Source of Truth Hierarchy

1. **`SYSTEM_BLUEPRINT.md`** (repository root) — authoritative architecture
2. **`PROJECT_CHANGELOG.md`** (repository root) — authoritative history
3. **`docs/business/`** — consolidated for business stakeholders
4. **`docs/technical/`** — consolidated for technical stakeholders
5. **`docs/archive/`** — historical, reference only

When in doubt, consult `SYSTEM_BLUEPRINT.md` and `PROJECT_CHANGELOG.md` at the repository root.

## Original Files at Repository Root

The following original documentation files remain at the repository root (not deleted):

| File | Archived To |
|---|---|
| `SYSTEM_BLUEPRINT.md` | `docs/technical/SYSTEM_BLUEPRINT.md` (copy) |
| `PROJECT_CHANGELOG.md` | (stays at root) |
| `MASTER_FEATURE_AUDIT.md` | `docs/archive/verification/MASTER_FEATURE_AUDIT.md` (copy) |
| `PHASE2_VERIFICATION_REPORT.md` | `docs/archive/verification/PHASE2_VERIFICATION_REPORT.md` (copy) |
| `PHASE3_RECOVERY_REPORT.md` | `docs/archive/verification/PHASE3_RECOVERY_REPORT.md` (copy) |
| `RUNTIME_UI_REVIEW_REPORT.md` | `docs/archive/verification/RUNTIME_UI_REVIEW_REPORT.md` (copy) |
