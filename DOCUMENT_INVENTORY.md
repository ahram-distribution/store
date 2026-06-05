# DOCUMENT INVENTORY — Ahram Distribution

**Last updated:** 2026-06-05  
**Purpose:** Every documentation file in the repository and its location.

---

## Repository Root Documents

| Original File | Size | New Location | Action |
|---|---|---|---|
| `SYSTEM_BLUEPRINT.md` | 57 KB | `docs/technical/SYSTEM_BLUEPRINT.md` | Copied |
| `PROJECT_CHANGELOG.md` | 50 KB | *(stays at root)* | Record-only |
| `MASTER_FEATURE_AUDIT.md` | 39 KB | `docs/archive/verification/MASTER_FEATURE_AUDIT.md` | Copied |
| `PHASE2_VERIFICATION_REPORT.md` | 20 KB | `docs/archive/verification/PHASE2_VERIFICATION_REPORT.md` | Copied |
| `PHASE3_RECOVERY_REPORT.md` | 17 KB | `docs/archive/verification/PHASE3_RECOVERY_REPORT.md` | Copied |
| `RUNTIME_UI_REVIEW_REPORT.md` | 15 KB | `docs/archive/verification/RUNTIME_UI_REVIEW_REPORT.md` | Copied |

## New Consolidated Documents

| File | Size | Purpose |
|---|---|---|
| **`docs/INDEX.md`** | < 10 KB | Document map — start here |
| **`docs/business/CURRENT_STATE.md`** | < 10 KB | Current project state for stakeholders |
| **`docs/business/KNOWN_ISSUES.md`** | < 10 KB | Known problems and risks |
| **`docs/business/ROADMAP.md`** | < 10 KB | Completed and planned work |
| **`docs/business/BUSINESS_RULES.md`** | < 10 KB | Domain business rules |
| **`docs/business/CHANGELOG.md`** | < 10 KB | Abbreviated change history |
| **`docs/technical/SYSTEM_BLUEPRINT.md`** | < 10 KB | Architecture reference copy |
| **`docs/technical/DATABASE_ARCHITECTURE.md`** | < 10 KB | Schema, tables, types, dependencies |
| **`docs/technical/GOVERNANCE.md`** | < 10 KB | Access control architecture |
| **`docs/technical/MIGRATION_HISTORY.md`** | < 10 KB | Migration order and stats |

## Archived Reports

### `/docs/archive/verification/`

| File | Original Location | Size |
|---|---|---|
| `PHASE2_VERIFICATION_REPORT.md` | Repository root | 20 KB |
| `PHASE3_RECOVERY_REPORT.md` | Repository root | 17 KB |
| `MASTER_FEATURE_AUDIT.md` | Repository root | 39 KB |
| `RUNTIME_UI_REVIEW_REPORT.md` | Repository root | 15 KB |
| `BUSINESS_RUNTIME_VERIFICATION_REPORT.md` | `workspace/tools/master-project-state/` | 12 KB |
| `ORDER_GOVERNANCE_HARDENING_REPORT.md` | `workspace/tools/master-project-state/` | 7 KB |
| `RUNTIME_INTEGRITY_AUDIT_REPORT.md` | `workspace/tools/master-project-state/` | 12 KB |
| `USER_ACCEPTANCE_RUNTIME_REVIEW_REPORT.md` | `workspace/tools/master-project-state/` | 10 KB |

### `/docs/archive/runtime-extraction/`

| File | Original Location | Size |
|---|---|---|
| `INVOICE_REFERENCE.md` | `workspace/tools/runtime-extraction/` | 7 KB |
| `MY_CUSTOMERS_REFERENCE.md` | `workspace/tools/runtime-extraction/` | 5 KB |
| `MY_ORDERS_REFERENCE.md` | `workspace/tools/runtime-extraction/` | 7 KB |
| `NEW_CUSTOMER_REFERENCE.md` | `workspace/tools/runtime-extraction/` | 6 KB |
| `ORDER_FLOW_REFERENCE.md` | `workspace/tools/runtime-extraction/` | 10 KB |
| `WHATSAPP_ORDER_REFERENCE.md` | `workspace/tools/runtime-extraction/` | 5 KB |

### `/docs/archive/project-state/`

| File | Original Location | Size |
|---|---|---|
| `MASTER_PROJECT_STATE.md` | `workspace/tools/master-project-state/` | 205 KB |
| `CURRENT_RUNTIME_IMPLEMENTATION.md` | `workspace/tools/project-state/` | 20 KB |

## Other Documentation

| File | Location | Notes |
|---|---|---|
| `README.md` | `supabase/migrations/README.md` | Migration usage notes |
| `README.md` | `supabase/seed/README.md` | Seed directory placeholder |

## Files Not Moved

The following files remain at their original locations and were NOT moved to `/docs/`:

| File | Reason |
|---|---|
| `PROJECT_CHANGELOG.md` | Authoritative history, stays at root per convention |
| `supabase/migrations/README.md` | Migration-adjacent documentation |
| `supabase/seed/README.md` | Seed-adjacent documentation |
| All `workspace/tools/*` originals | Originals preserved per "do not delete" rule |

## Statistics

| Category | Count |
|---|---|
| Total documentation files inventoried | 30 |
| New consolidated docs created | 10 |
| Files archived to `/docs/archive/` | 16 |
| Files remaining at original location | 4 |
| Total files in `/docs/` | 26 (10 new + 16 archived) |
