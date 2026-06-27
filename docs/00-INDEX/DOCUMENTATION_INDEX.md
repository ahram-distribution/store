# DOCUMENTATION INDEX — Single Source of Truth

**Location:** `docs/00-INDEX/DOCUMENTATION_INDEX.md`
**Status:** Active (2026-06-16)
**Governance:** All new docs MUST be created inside the appropriate `docs/` subdirectory. See `.opencode/AGENTS.md`.

---

## Directory Structure

```text
docs/
├── 00-INDEX/               Index, summaries, master reference
├── 01-ARCHITECTURE/        System maps, screen/RPC catalogs, architecture decisions
├── 02-DATABASE/            Database usage, schemas, integrity
├── 03-RPCS-FUNCTIONS/      RPC catalogs, function documentation
├── 04-SECURITY/            Role models, access control
├── 05-RUNTIME/             Runtime behavior, tracking analysis
├── 06-FRONTEND/            Frontend UI documentation
├── 07-AUDITS/              Truth audits, integrity verification
├── 08-FIXES-HISTORY/       Fix history, regression guards, hotfix reports
├── 08-CHANGELOG/           Changelogs
├── 09-REPORTS/             Phase reports, status summaries
├── 10-OWNER-KNOWLEDGE/     Owner knowledge base
└── archive/                Historical docs, duplicates (never delete)
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
| `ACTIVE_SCREEN_CATALOG.md` | Screen catalog — all screens, routes, and permissions |

### 02-runtime/

| File | Description |
|------|-------------|
| `TRACKING_RUNTIME_IMPLEMENTATION.md` | GPS tracking engine detail — `gpsService`, `trackingEngine`, `location` |

### 03-database/

*(No standalone database doc — current state is in `docs/07-AUDITS/SYSTEM_REFERENCE_CURRENT_STATE.md` Section 1)*

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

### `docs/archive/duplicates/` — Duplicate files (22 files)

All 22 files from `docs/new/` are SHA256-identical to files formerly in `docs/good/`. They are archived in `docs/archive/duplicates/`.

### `docs/archive/historical/` — Historical documentation (76+ entries)

All files from `docs/old/` and `docs/old/` subdirectories are archived in `docs/archive/historical/`. Topic overlaps exist:

| Current doc | Historical overlap | Notes |
|------------|-------------------|-------|
| `docs/04-SECURITY/ACTIVE_ROLE_MODEL.md` | `docs/archive/historical/CURRENT_ROLE_MAP.md`, `docs/archive/historical/TARGET_ROLE_MODEL.md` | Old role docs superseded by active role model |
| `docs/01-ARCHITECTURE/ACTIVE_SCREEN_CATALOG.md` | `docs/archive/historical/SCREENS_AND_UI_BLUEPRINT.md`, `docs/archive/historical/ATTENDANCE_*` | Old UI blueprints superseded by active catalog |
| `docs/05-RUNTIME/TRACKING_RUNTIME_IMPLEMENTATION.md` | `docs/archive/historical/BACKGROUND_TRACKING_ANALYSIS.md`, `docs/archive/historical/DESIGN_WORKDAY_TRACKING.md`, `docs/archive/historical/DESIGN_WORKDAY_TRACKING_V2.md` | Old tracking design docs superseded by runtime implementation |
| `docs/09-REPORTS/COMMERCIAL_RUNTIME_STATUS.md` | `docs/archive/historical/SESSION_STATUS.md` | Old session status superseded by commercial runtime status |
| Various audit docs (docs/07-AUDITS/) | `docs/archive/historical/ATTENDANCE_RUNTIME_AUDIT.md`, `docs/archive/historical/RESEARCH_AUDIT_SUMMARY.md`, `docs/archive/historical/UPPER_MANAGEMENT_AUTHORITY_AUDIT.md`, `docs/archive/historical/ORGANIZATIONAL_NORMALIZATION_REPORT.md` | Old audits — superseded by Project Truth Audit |
| `docs/05-RUNTIME/ACTIVE_RUNTIME_ONLY.md` | `docs/archive/historical/ATTENDANCE_RUNTIME_AUDIT.md`, `docs/archive/historical/ATTENDANCE_RUNTIME_SCREEN_SPEC.md`, `docs/archive/historical/DESIGN_WORKDAY_RUNTIME_GAP_ANALYSIS.md` | Old runtime docs superseded by active runtime analysis |

---

## Archive

Located under `docs/archive/`:
- `duplicates/` — SHA256-identical copies (from `docs/new/`)
- `historical/` — historical documentation (from `docs/old/`)
- `business/` — old business docs
- `technical/` — old technical docs
- `reports/` — old reports
- `system-blueprint/` — system blueprint (canonical)
- `verification/` — old verification docs
- `runtime-extraction/` — old runtime extraction
- `project-state/` — old project state docs

---

## Governance Rule

**All new documentation** of these types MUST be created inside the appropriate `docs/` subdirectory:

- Report → `docs/09-REPORTS/`
- Audit → `docs/07-AUDITS/`
- Analysis → `docs/01-ARCHITECTURE/` or `docs/09-REPORTS/`
- Architecture → `docs/01-ARCHITECTURE/`
- Governance → `docs/00-INDEX/`
- Fix History → `docs/08-FIXES-HISTORY/`
- Runtime Documentation → `docs/05-RUNTIME/`
- Database Documentation → `docs/02-DATABASE/` or `docs/03-RPCS-FUNCTIONS/`

**Prohibited:** Creating any of the above at project root or in `src/`.
**When editing:** If a doc exists outside its proper subdirectory, move it to the correct subdirectory first.

See full rules in `.opencode/AGENTS.md`.
