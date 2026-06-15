# DOCUMENTATION INDEX — Single Source of Truth

**Location:** `docs/good/`
**Status:** Active (2026-06-16)
**Governance:** All new docs MUST be created inside `docs/good/`. See `.opencode/AGENTS.md`.

---

## Directory Structure

```text
docs/good/
├── 00-governance/          Policies, governance rules, compliance
├── 01-architecture/        System maps, screen/RPC catalogs
├── 02-runtime/             Runtime behavior, tracking analysis
├── 03-database/            Database usage, schemas, integrity
├── 04-security/            Role models, access control
├── 05-fixes/               Fix history, regression guards, hotfix reports
├── 06-reports/             Phase reports, status summaries
├── 07-audits/              Truth audits, integrity verification
├── 08-operations/          Removal candidates, consolidation, cleanup
├── 09-reference/           Summaries, session anchors
└── archive/                Old/duplicate docs (never delete)
```

---

## All Documents

### 00-governance/

| File | Description |
|------|-------------|
| `GOVERNANCE_COMPLIANCE_REPORT.md` | Compliance audit against governance rules |
| `SYSTEM_OF_TRUTH_ENFORCEMENT_REPORT.md` | Enforcement results for system-of-truth violations |
| `DOCUMENTATION_INDEX.md` | **This file** — documentation master index |

### 01-architecture/

| File | Description |
|------|-------------|
| `SYSTEM_OF_TRUTH_MAP.md` | The mandatory architecture reference — 9 sections (GPS, Orders, Customers, WhatsApp, Auth, Attendance, Dashboard, Dependency Map, Future Rules) |
| `ACTIVE_RPC_CATALOG.md` | Complete RPC catalog — 187 RPCs documented |
| `ACTIVE_SCREEN_CATALOG.md` | Screen catalog — all screens, routes, and permissions |

### 02-runtime/

| File | Description |
|------|-------------|
| `ACTIVE_RUNTIME_ONLY.md` | What actually runs in production — code paths verified |
| `TRACKING_RUNTIME_IMPLEMENTATION.md` | GPS tracking engine detail — `gpsService`, `trackingEngine`, `location` |

### 03-database/

| File | Description |
|------|-------------|
| `ACTIVE_DATABASE_USAGE.md` | Database tables used, their sources, and access patterns |

### 04-security/

| File | Description |
|------|-------------|
| `ACTIVE_ROLE_MODEL.md` | Current role/permission model — admin hierarchy and RPC access |

### 05-fixes/

| File | Description |
|------|-------------|
| `FIX_HISTORY.md` | Complete fix history — 15 issues (FIX-001 to FIX-015) |
| `REGRESSION_GUARD.md` | Regression guard records — 65 issues (RG-001 to RG-065) across 18 categories |
| `REGRESSION_RISK_REPORT.md` | Risk assessment per fix — 18 HIGH, 22 MEDIUM, 20 LOW, 5 UNKNOWN |
| `REGRESSION_ENFORCEMENT_REPORT.md` | Final enforcement sweep results — 0 open violations |
| `PRODUCTION_HOTFIX_REPORT.md` | 3 production hotfixes — 404 routing, RangeError, WhatsApp snapshot |

### 06-reports/

| File | Description |
|------|-------------|
| `COMMERCIAL_RUNTIME_STATUS.md` | Commercial runtime status summary |

### 07-audits/

| File | Description |
|------|-------------|
| `PROJECT_TRUTH_AUDIT.md` | Project truth audit — corrected RPC counts, verified state |
| `data-integrity-audit.md` | Data integrity verification across tables |
| `final-creation-audit.md` | Final creation audit |
| `logo_audit_report.md` | Logo and branding audit |

### 08-operations/

| File | Description |
|------|-------------|
| `REMOVAL_CANDIDATES.md` | Deprecated/removable code paths (Section 9 skips governance) |
| `REPOSITORY_CONSOLIDATION_REPORT.md` | Git remote analysis — origin vs store, consolidation plan |

### 09-reference/

| File | Description |
|------|-------------|
| `_ANCHORED_SUMMARY.md` | Session anchor — full conversation summary with key decisions |

---

## Related Directories (Historical)

### `docs/new/` — Staging area (22 files)

All 22 files are now classified and copied into `docs/good/`. This directory is kept intact as a staging record.

### `docs/old/` — Historical documentation (34 entries)

No files from `docs/old/` were moved into `docs/good/` — they remain as historical reference. Topic overlaps exist:

| docs/good/ | docs/old/ overlap | Notes |
|------------|-------------------|-------|
| `ACTIVE_ROLE_MODEL.md` | `CURRENT_ROLE_MAP.md`, `TARGET_ROLE_MODEL.md` | Old role docs superseded by active role model |
| `ACTIVE_SCREEN_CATALOG.md` | `SCREENS_AND_UI_BLUEPRINT.md`, `ATTENDANCE_*` | Old UI blueprints superseded by active catalog |
| `TRACKING_RUNTIME_IMPLEMENTATION.md` | `BACKGROUND_TRACKING_ANALYSIS.md`, `DESIGN_WORKDAY_TRACKING.md`, `DESIGN_WORKDAY_TRACKING_V2.md` | Old tracking design docs superseded by runtime implementation |
| `COMMERCIAL_RUNTIME_STATUS.md` | `SESSION_STATUS.md` | Old session status superseded by commercial runtime status |
| Various audit docs (07-audits/) | `ATTENDANCE_RUNTIME_AUDIT.md`, `RESEARCH_AUDIT_SUMMARY.md`, `UPPER_MANAGEMENT_AUTHORITY_AUDIT.md`, `ORGANIZATIONAL_NORMALIZATION_REPORT.md` | Old audits — superseded by Project Truth Audit |
| `ACTIVE_RUNTIME_ONLY.md` | `ATTENDANCE_RUNTIME_AUDIT.md`, `ATTENDANCE_RUNTIME_SCREEN_SPEC.md`, `DESIGN_WORKDAY_RUNTIME_GAP_ANALYSIS.md` | Old runtime docs superseded by active runtime analysis |

---

## Archive

`docs/good/archive/` is reserved for future archival needs. Currently empty.

---

## Governance Rule

**All new documentation** of these types MUST be created inside `docs/good/`:

- Report
- Audit
- Analysis
- Architecture
- Governance
- Fix History
- Runtime Documentation
- Database Documentation

**Prohibited:** Creating any of the above at project root or in `src/`.
**When editing:** If a doc exists outside `docs/good/`, move it to the appropriate subdirectory first.

See full rules in `.opencode/AGENTS.md`.
