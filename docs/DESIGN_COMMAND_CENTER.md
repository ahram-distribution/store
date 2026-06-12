# Upper Management Command Center — Design Proposal (Revised)

## Objective

Replace the hardcoded `UpperManagementDashboard.tsx` + `ModuleLauncherPage.tsx` with a self-maintaining operational C2 screen that discovers, tracks, and reports on every module in the system — without the owner manually maintaining cards.

---

## 0. Source of Truth Architecture

### Principle

`system_modules` is a **projection / cache / registry** — never the source of truth.

The three irreducible sources of truth are:

| Source | Role | Immutable By System |
|--------|------|---------------------|
| `docs/OWNER_KNOWLEDGE_BASE/` | Owner intent, business rules, decisions, approvals | The sync script READS only |
| Runtime code (`src/`) | Actual implementation, routes, components, services | The sync script READS only |
| Database entities (tables, RPCs, enums) | Actual schema, functions, constraints | The sync script READS only |

### Data Flow

```
OWNER_KNOWLEDGE_BASE  +  Runtime Code (src/)  +  Database (pg_proc, tables)
        │                        │                          │
        └────────────────────────┼──────────────────────────┘
                                 │
                          [Sync Script]
                                 │
                          (READ-ONLY for discovery)
                                 │
                          ┌──────┴──────┐
                          │  system_modules  │  ← Projection, CAN be dropped+rebuilt
                          │  owner_decisions │  ← Extracted from KB
                          │  owner_requests  │  ← Extracted from KB
                          │  module_pipelines│  ← Inferred from RPC patterns
                          └──────┬──────┘
                                 │
                          [Command Center UI]
                                 │
                          (display only)
```

### Rules

1. **`system_modules` is disposable.** Dropping and re-running sync must produce an equivalent registry. No manual data entry is ever required.

2. **The sync script is the sole writer** of routes, RPCs, tables, pages, services, pipeline steps, health status, readiness score, implementation level. The owner never touches these fields.

3. **The owner may only write:** `owner_approved`, `business_priority`, manual status override (when auto-detected status is wrong). All other fields are read-only from the UI.

4. **If a module disappears from all three sources** (KB removed, routes deleted, tables dropped), the sync script marks it `status = 'deprecated'` — it never auto-deletes rows.

5. **KB always wins.** If KB says "status: validated" but code is missing, the C2 shows a warning: "KB claims validated but 0 routes found."

---

## 1. Module Registry

### 1.1 Table: `system_modules`

```sql
CREATE TABLE system_modules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    module_key   varchar(100) UNIQUE NOT NULL,      -- 'orders', 'credit', 'returns', etc.

    -- Identity
    display_name jsonb NOT NULL,                     -- { "ar": "الطلبات", "en": "Orders" }
    description  jsonb,                              -- { "ar": "...", "en": "..." }
    icon         varchar(50) DEFAULT 'package',       -- Lucide icon name

    -- Lifecycle (owner MAY override auto-detected value)
    status varchar(20) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned','partial','implemented','validated','broken','deprecated')),

    implementation_level integer DEFAULT 0,          -- 0–100, always auto-computed
    validated_at    timestamptz,
    broken_since    timestamptz,
    deprecated_at   timestamptz,
    owner_approved  boolean DEFAULT false,

    -- ---- Everything below is SYNC-ONLY (read-only from UI) ----
    -- Discovery metadata (populated by sync script, never manual)
    routes       jsonb DEFAULT '[]'::jsonb,           -- ["/orders", "/orders/new", ...]
    core_rpcs    jsonb DEFAULT '[]'::jsonb,           -- ["governed_create_order", ...]
    core_tables  jsonb DEFAULT '[]'::jsonb,           -- ["orders", "order_items", ...]
    services     jsonb DEFAULT '[]'::jsonb,           -- ["src/services/orders.ts"]
    page_dirs    jsonb DEFAULT '[]'::jsonb,           -- ["src/pages/orders/"]

    -- Pipeline health (see Section 4)
    pipeline_steps jsonb DEFAULT '[]'::jsonb,          -- [{"step":"create","status":"pass"}, ...]
    pipeline_health_pct integer DEFAULT 0,             -- 0–100

    -- Health (sync-computed)
    last_health_check timestamptz,
    health_status varchar(20) DEFAULT 'unknown'
        CHECK (health_status IN ('healthy','degraded','down','unknown')),

    -- Business (owner MAY override)
    readiness_score   integer DEFAULT 0,              -- 0–100, computed
    business_priority varchar(20) DEFAULT 'medium'
        CHECK (business_priority IN ('critical','high','medium','low','icebox')),

    -- Knowledge base link (sync-computed)
    kb_file varchar(255),                              -- '05_ORDER_RULES.md'

    -- Decisions coverage (sync-computed, see Section 2)
    decisions_total    integer DEFAULT 0,
    decisions_verified integer DEFAULT 0,
    decisions_pct      integer DEFAULT 0,              -- 0–100

    -- Dependencies
    depends_on varchar(100)[] DEFAULT '{}',

    -- Audit
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

COMMENT ON TABLE system_modules IS
'PROJECTION. Not source of truth. Can be dropped and rebuilt from KB + code + DB.';
COMMENT ON COLUMN system_modules.routes IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.core_rpcs IS 'SYNC-ONLY. Do not edit manually.';
COMMENT ON COLUMN system_modules.pipeline_steps IS 'SYNC-ONLY. Do not edit manually.';
```

### 1.2 Ownership

| Field | Writer | Editable in UI |
|-------|--------|----------------|
| `module_key`, `display_name`, `icon` | Sync script (from KB/code) | No |
| `routes`, `core_rpcs`, `core_tables`, `services`, `page_dirs` | Sync script | No |
| `pipeline_steps`, `pipeline_health_pct`, `health_status` | Sync script | No |
| `last_health_check`, `readiness_score`, `implementation_level` | Sync script | No |
| `kb_file`, `depends_on`, `decisions_*` | Sync script | No |
| `status` | Auto-detected + owner override | Yes (override) |
| `owner_approved`, `validated_at`, `broken_since` | Owner | Yes |
| `business_priority` | Owner | Yes |
| `deprecated_at` | Owner | Yes |

### 1.3 Lifecycle

```
planned ──▶ partial ──▶ implemented ──▶ validated
                  │                        │
                  └── broken ◀──────────────┘
                  │
                  └── deprecated
```

- **planned**: Idea in KB, no code
- **partial**: Some code exists (e.g. routes but no RPCs)
- **implemented**: Core workflow complete
- **validated**: Owner-tested and confirmed
- **broken**: Previously worked, now has defect
- **deprecated**: Replaced, no longer maintained

---

## 2. Status Model — Clear Criteria

| Status     | Routes | RPCs | Tables | KB File | Owner Says | Criteria                                 |
|------------|--------|------|--------|---------|------------|------------------------------------------|
| PLANNED    | 0      | 0    | 0      | exists  | —          | Only a knowledge base file exists        |
| PARTIAL    | ≥1     | ≥1   | ≥1     | exists  | —          | Some code but missing critical paths     |
| IMPLEMENTED| ≥3     | ≥3   | ≥2     | exists  | —          | CRUD workflow complete, front-end works  |
| VALIDATED  | ≥3     | ≥3   | ≥2     | exists  | approved   | Owner confirmed + health check passes    |
| BROKEN     | exists | >0   | exists | exists  | —          | Pipeline health < 100% OR tests fail     |
| DEPRECATED | —      | —    | —      | —       | deprecated | Owner marked deprecated                  |

The sync script infers a **suggested** status from code structure. The owner overrides via the C2 screen (one click).

---

## 3. Readiness Score (0–100)

Computed entirely by the system. Weighted factors:

| Factor                         | Weight | How                                  |
|--------------------------------|--------|--------------------------------------|
| Routes implemented vs expected | 15     | count(routes) / expected_routes × 15 |
| Core RPCs present              | 15     | count(rpcs) / expected_rpcs × 15     |
| Pipeline health                | 20     | pipeline_health_pct × 0.20          |
| Core tables exist              | 10     | count(tables) / expected_tables × 10 |
| KB file exists                 | 5      | 5 if kb_file is set, else 0         |
| Owner validated                | 15     | 15 if owner_approved, else 0         |
| Business rule coverage         | 10     | decisions_pct × 0.10                |
| Test coverage exists           | 5      | 5 if test file found in sync         |
| Health check passing           | 5      | 5 if health_status = 'healthy'       |

**Formula:** `SUM(weight_i × earned_i) / SUM(weight_i) × 100`

Each module declares `expected_routes`, `expected_rpcs`, `expected_tables` in a companion JSON file or in the KB frontmatter. If not declared, defaults apply (e.g. 3 routes, 4 RPCs, 2 tables).

### Scoring tiers

| Score  | Label         | Color  |
|--------|---------------|--------|
| 90–100 | Production    | Green  |
| 65–89  | Nearly Ready  | Yellow |
| 30–64  | In Progress   | Orange |
| 0–29   | Early Stage   | Red    |

---

## 4. Pipeline Health

### 4.1 Concept

A module's pipeline is the ordered sequence of workflow steps an operator performs. Each step has a verifiable check. Pipeline health measures whether the chain is unbroken.

### 4.2 Per-Module Pipelines (examples)

```
Orders:     Create → Submit → Review → Approve → Prepare → Dispatch → Deliver → Collect
Returns:    Create → Inspect → Approve → Restore Inventory → Generate CN
Credit:     Apply → Submit → Review → Document → Approve → Sign → Reserve → Convert → Collect
Visits:     Plan → Check-in → Execute → Check-out → Report
```

### 4.3 Step Verification

Each step has one or more verifiable checks:

| Check Type | What It Tests | Example |
|------------|---------------|---------|
| `rpc_exists` | The governing RPC exists | `governed_create_order` exists |
| `rpc_responds` | The RPC returns successfully (mock params) | `governed_create_order` with test data returns a row |
| `route_exists` | A front-end route handles this step | `/orders/new` resolves to a component |
| `ui_import` | The page component is importable | `ReturnNewPage.tsx` exists and exports default |
| `capability_gated` | The step checks permissions | `governed_approve_order` calls `check_capability` |
| `history_recorded` | The step writes to an audit table | Approval inserts into `order_status_history` |
| `state_transition_valid` | The status transition follows rules | `delivered` can only follow `dispatched` |

### 4.4 Pipeline Discovery

The sync script infers pipeline steps from naming patterns:

```
governed_create_order     → step: "create"
governed_submit_order     → step: "submit"
governed_approve_order    → step: "approve"
governed_reject_order     → step: "reject"
governed_dispatch_order   → step: "dispatch"
governed_deliver_order    → step: "deliver"
```

The verb extracted from `governed_{verb}_{module}` defines the step.

For modules without explicit RPC verbs, the sync script checks standard verbs:
`create`, `submit`, `approve`, `reject`, `cancel`, `update`, `delete`, `dispatch`, `deliver`, `activate`, `deactivate`, `suspend`, `review`, `checkin`, `checkout`, `sign`, `reserve`, `convert`, `release`, `pay`

### 4.5 Pipeline Health Calculation

```
pipeline_health_pct = count(steps with status = 'pass') / count(total steps) × 100
```

Step statuses:

| Status  | Meaning | Color |
|---------|---------|-------|
| `pass`  | All checks for this step succeed | Green |
| `fail`  | A check fails (RPC errors, 404 route) | Red |
| `missing` | Expected step has no code (KB describes it, no RPC exists) | Yellow |
| `unknown` | Step discovered but not yet checked | Gray |

### 4.6 Storage

Pipelines are stored in `system_modules.pipeline_steps` as JSON:

```json
[
  {"step": "create",  "status": "pass",    "checks": {"rpc_exists": true, "route_exists": true}},
  {"step": "submit",  "status": "pass",    "checks": {"rpc_exists": true}},
  {"step": "approve", "status": "pass",    "checks": {"rpc_exists": true, "capability_gated": true}},
  {"step": "reject",  "status": "pass",    "checks": {"rpc_exists": true}},
  {"step": "dispatch","status": "fail",    "checks": {"rpc_exists": false}},
  {"step": "deliver", "status": "missing", "checks": {}}
]
```

---

## 5. Business Rule Coverage

### 5.1 Concept

Readiness score measures "does the code exist?" — Business Rule Coverage measures "do the owner's decisions actually work as intended?"

For example, Orders could have 100% of code paths implemented but 0% of the owner's pricing rules enforced. Business Rule Coverage reveals that gap.

### 5.2 Table: `owner_decisions` (Revised)

```sql
CREATE TABLE owner_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    module_key varchar(100) NOT NULL,                    -- REFERENCES system_modules

    decision_text text NOT NULL,                          -- The rule/decision verbatim
    rationale text,                                       -- Why it was decided
    category varchar(50) DEFAULT 'business_rule'
        CHECK (category IN ('business_rule','financial_rule','authorization_rule',
                            'architectural_decision','workflow_rule')),

    -- Source
    source_file varchar(255),                             -- '07_RETURN_RULES.md'
    source_line integer,                                  -- Line number in KB file

    -- Verification (see 5.4)
    verifiable boolean DEFAULT true,                      -- Can this rule be automatically checked?
    verification_method varchar(50) DEFAULT 'rpc_check'
        CHECK (verification_method IN ('rpc_check','table_check','capability_check',
                                       'code_search','enum_check','manual_only')),
    verification_query text,                              -- SQL to run for verification
    verified boolean DEFAULT false,                       -- PASS / FAIL
    verified_at timestamptz,
    failure_reason text,                                  -- Why verification failed

    -- Lifecycle
    decided_at timestamptz,
    superseded_by uuid REFERENCES owner_decisions(id),    -- If this decision was replaced
    tags varchar(50)[] DEFAULT '{}',

    -- Audit
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
```

### 5.3 Verification Methods

| Method | What It Does | Example |
|--------|-------------|---------|
| `rpc_check` | Run an RPC with test params, expect success/error | `SELECT governed_approve_return(token, id)` — expect specific error for wrong status |
| `table_check` | Query a table, assert state | `SELECT COUNT(*) FROM customer_credit_ledger WHERE source = 'return'` — expect 0 |
| `capability_check` | Verify an RPC calls `check_capability` | `SELECT prosrc FROM pg_proc WHERE proname = 'governed_approve_return'` — search for `check_capability` |
| `code_search` | Search front-end source for a pattern | Search for `credit_note_amount` in return service |
| `enum_check` | Verify an enum/check constraint exists | `SELECT conname FROM pg_constraint WHERE conrelid = 'returns'::regclass AND consrc LIKE '%approved%'` |
| `manual_only` | Cannot be automated; owner must confirm | UX flow validation |

### 5.4 Example Decision Verifications

| Decision | Source | Verification | Expected |
|----------|--------|-------------|----------|
| Returns do not modify customer credit accounts | `07_RETURN_RULES.md` | `table_check`: `SELECT COUNT(*) FROM customer_credit_ledger WHERE source_type = 'return'` | 0 |
| Credit note amount auto-calculated from order prices | `07_RETURN_RULES.md` | `rpc_check`: Call `governed_approve_return` and check `credit_note_amount` equals expected | amount matches |
| Only Upper Management can approve orders | `05_ORDER_RULES.md` | `capability_check`: Search `governed_approve_order` for `check_capability('orders.approve')` | found |
| Customer can create returns | `07_RETURN_RULES.md` | `capability_check`: `governed_create_return` does NOT require capability for customers | customer block absent |
| Inventory restore only for saleable items | `07_RETURN_RULES.md` | `code_search`: `governed_approve_return` filters `inspection.condition = 'saleable'` | found |

### 5.5 Coverage Calculation

```
decisions_pct = count(verified = true) / count(verifiable = true) × 100

Module-level:   decisions_pct for that module_key
Global:         SUM(verified) / SUM(verifiable) across ALL modules
```

---

## 6. Command Center Screen Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  UPPER MANAGEMENT COMMAND CENTER                [sync] [refresh]    │
│  آخر تحديث: منذ 5 دقائق                                               │
├──────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │  STATUS BAR                                                      ││
│  │  ● 8 healthy  ● 2 degraded  ● 1 down  ● 1 broken                ││
│  │  Production-ready: 6/14  |  Rules covered: 78%  |  Pilot: ⚠     ││
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │  Section A: SYSTEM MODULES                                       ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           ││
│  │  │ طلبات    │ │ ائتمان   │ │ مرتجعات  │ │ عملاء    │           ││
│  │  │ ⬤⬤⬤ IMP  │ │ ⬤⬤⬤ PAR │ │ ⬤⬤⬤ VAL │ │ ⬤⬤⬤ IMP │           ││
│  │  │ 85%  🟢  │ │ 45%  🟡  │ │ 92%  🟢  │ │ 78%  🟡  │           ││
│  │  │ ━━━━━━━  │ │ ━━━━━    │ │ ━━━━━━━  │ │ ━━━━━━   │           ││
│  │  │ Pipeline:│ │ Pipeline:│ │ Pipeline:│ │ Pipeline:│           ││
│  │  │ ✅✅✅❌  │ │ ✅❌❌❌  │ │ ✅✅✅✅  │ │ ✅✅❌   │           ││
│  │  │ Rules:   │ │ Rules:   │ │ Rules:   │ │ Rules:   │           ││
│  │  │ 80%      │ │ 100%     │ │ 100%     │ │ 50%      │           ││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘           ││
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                       │
│  ┌───────────────────────────┐ ┌─────────────────────────────────────┐│
│  │ Section B: READINESS       │ │ Section C: BROKEN PIPELINES        ││
│  │                           │ │                                     ││
│  │ PRODUCTION-READY:         │ │ ⚠ Orders: Dispatch step BROKEN     ││
│  │   Orders ✅ (85%, +owner) │ │   governed_dispatch_order missing   ││
│  │   Returns ✅ (92%, +owner)│ │ ⚠ Inventory: Dead route            ││
│  │   Targets ✅ (90%, +owner)│ │   /inventory/old → 404             ││
│  │                           │ │ ⚠ Credit: Reserve step BROKEN      ││
│  │ BLOCKERS:                 │ │   governed_reserve_credit errors   ││
│  │   Credit ⏳ needs pipeline│ │                                     ││
│  │   Auctions ⏳ needs owner  │ └─────────────────────────────────────┘│
│  │   Visits ⏳ needs RPCs    │                                        │
│  └───────────────────────────┘                                        │
│                                                                       │
│  ┌───────────────────────────┐ ┌─────────────────────────────────────┐│
│  │ Section D: RULE COVERAGE  │ │ Section E: APPROVED NOT YET BUILT  ││
│  │                           │ │                                     ││
│  │ Module        Rules  Cov  │ │ 🥇 Workday Tracking  (Approved)    ││
│  │ Orders          5/7  71%  │ │    KB: 17_WORKDAY_TRACKING.md      ││
│  │ Credit          3/3  100% │ │    Priority: Critical              ││
│  │ Returns         3/3  100% │ │    Approved: 2026-05-15            ││
│  │ Permissions     2/6  33%  │ │                                     ││
│  │ Workday Track   0/4   0%  │ │ 🥈 Live Maps         (Deferred)    ││
│  │ Visits          1/3  33%  │ │ 🥉 Smart Recs        (Planned)     ││
│  │                           │ │ 📌 Internal Sales     (Future)     ││
│  │ ⚠ 3 rules FAIL verification││                                     ││
│  │   → "Only Upper Mgmt approve" ORDER_RULES.md:42                  ││
│  │   → "Auto-calc credit note" ORDER_RULES.md:18                   ││
│  └───────────────────────────┘ └─────────────────────────────────────┘│
│                                                                       │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │ Section F: OWNER DECISIONS LOG                                   ││
│  │                                                                  ││
│  │ 📜 RETURNS: No credit offset → ✅ Verified (2026-06-10)         ││
│  │    "Returns do not modify customer_credit_accounts..."           ││
│  │    07_RETURN_RULES.md:44                                         ││
│  │                                                                  ││
│  │ 📜 ORG: Upper Management unified → ✅ Verified (2026-06-01)     ││
│  │    "All upper management roles share identical permissions"      ││
│  │    00_CHANGELOG.md:12                                            ││
│  │                                                                  ││
│  │ 📜 ORDERS: Only Upper Mgmt + Sales Mgr approve → ❌ FAILS        ││
│  │    "Only Upper Management and Sales Manager can approve orders"  ││
│  │    05_ORDER_RULES.md:42 — Missing capability check on submit    ││
│  └──────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
```

### A. System Modules Grid

Each card shows:
- Module icon (from KB or inferred from module_key)
- Arabic name
- Status badge (VAL=green, IMP=blue, PAR=yellow, PLN=gray, BRK=red, DEP=strikethrough)
- Readiness score + progress bar
- Health dot (green/yellow/red)
- Pipeline health (row of step dots: green/red/yellow)
- Business rule coverage percentage

Filtering: by status, by priority, by pipeline health
Sorting: broken first → by readiness ascending

### B. Operational Readiness

- **Production-ready**: readiness ≥ 90 AND owner_approved AND pipeline_health = 100 AND no failing rules
- **Blockers**: sorted by biggest gap, each showing specific blocker text

### C. Broken Pipelines

Auto-detected by sync script:
- **Dead routes**: Routes that 404 (HTTP check)
- **Unused RPCs**: Functions never called by any route/page
- **Orphaned pages**: Page directories not linked to any route
- **Pipeline step FAIL**: Step with `status = 'fail'`
- **Pipeline step MISSING**: Step described in KB but no code exists
- **Disconnected workflows**: Module A depends on B, B is broken
- **Missing knowledge base**: Module has code but no KB file

### D. Business Rule Coverage

Per-module table showing:
- Module name
- Total decisions count
- Verified count + percentage
- FAILED rules listed with links to source file + line

Global summary: "X of Y business rules verified (Z%)"

### E. Owner Requested / Not Yet Built

Dedicated section tracking owner-approved features not yet implemented:

```sql
CREATE TABLE owner_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,                               -- "Workday Tracking"
    description text,                                   -- What the feature entails
    status varchar(30) NOT NULL DEFAULT 'approved'
        CHECK (status IN ('approved','deferred','planned','future','in_progress','cancelled')),
    priority varchar(20) DEFAULT 'medium'
        CHECK (priority IN ('critical','high','medium','low','icebox')),
    module_key varchar(100),                            -- Optional, if maps to a module

    -- Source
    source_file varchar(255),                           -- KB file reference
    source_line integer,
    approved_at timestamptz,                            -- When owner approved

    -- Dependencies
    depends_on varchar(100)[] DEFAULT '{}',

    -- Notes
    notes text,
    tags varchar(50)[] DEFAULT '{}',

    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
```

Status definitions for this section:

| Status | Meaning | Example |
|--------|---------|---------|
| Approved | Owner approved, work not started | Workday Tracking |
| Deferred | Approved but postponed | Live Maps |
| Planned | In roadmap, not yet approved timeline | Smart Recommendations |
| Future | Vision-stage, no concrete plan | Internal Sales Expansion |
| In Progress | Being actively worked on | (N/A — would appear as module) |
| Cancelled | No longer pursuing | — |

Displayed as a ranked list sorted by priority + approval date. Each request shows:
- Title + status badge
- KB file reference
- Priority
- How long since approval
- Dependency warnings (if depends_on module is not validated)

### F. Owner Decisions Log

Extracted from knowledge base markdown files by a parser that looks for:
- `**Decision:**` or `**Rule:**` patterns
- `RETURN_FINANCIAL_RULE` style constant declarations
- List items starting with "Returns do not"
- Sections titled "Key Decisions"

Each decision shows:
- Decision text (verbatim from KB)
- Verification status: ✅ PASS / ❌ FAIL / ⏳ Manual Only / ❓ Unknown
- Source file + line number (clickable → opens KB)
- Category badge (financial, auth, workflow, architectural)
- Tags

---

## 7. Auto-Discovery — Sync Script

### 7.1 Mechanism

A Node.js script `scripts/sync-module-registry.mjs` runs:
- On each deployment (CI/CD hook)
- On demand from C2 "Sync Now" button
- Scheduled via Supabase cron (daily)

The script is the **sole writer** of discovery fields. It never accepts manual input.

### 7.2 Discovery Sources

| Source | What it discovers | How |
|--------|-------------------|-----|
| `src/routes/index.tsx` | Route paths → module grouping | Parse `<Route path="...">` patterns; group by first path segment |
| `src/pages/*/` | Page directories → module | Each subdirectory under `src/pages/` is a module candidate |
| `src/services/*.ts` | Service files → module | File name maps to module key |
| `pg_proc` (SQL) | RPC functions → module + pipeline steps | Query `proname LIKE 'governed_%'`; extract domain + verb |
| `information_schema.tables` | Tables → module | Map table names to module keys |
| `docs/OWNER_KNOWLEDGE_BASE/*.md` | KB files, decisions, approved features, requests | Parse frontmatter, markdown structure, patterns |
| `scripts/test_*.mjs` | Test files → module | File name prefix maps to module |

### 7.3 Algorithm

```
Phase 1 — DISCOVER
  For each module_key from routes + pages + services + RPCs + tables + KB:
    Upsert system_modules row (discovery fields only, never overwrite owner fields)

Phase 2 — INFER STATUS
  For each module in system_modules:
    Compute suggested_status from code presence
    If owner has NOT manually overridden: set status = suggested_status

Phase 3 — COMPUTE PIPELINE
  For each module:
    Extract pipeline steps from RPC verbs (governed_{step}_{module})
    Cross-reference with KB-described workflow
    Test each step (RPC exists? Route exists? Responds?)
    Update pipeline_steps JSON and pipeline_health_pct

Phase 4 — VERIFY DECISIONS
  For each decision in owner_decisions where verifiable = true:
    Run verification_query against the database
    Update verified = true/false, failure_reason, verified_at
  Compute decisions_pct per module

Phase 5 — COMPUTE READINESS
  For each module:
    Calculate readiness_score from weighted factors
    Update implementation_level
    
Phase 6 — DETECT BROKEN
  Dead routes: HTTP HEAD on each route in system_modules.routes
  Unused RPCs: Cross-reference pg_proc with front-end imports
  Orphaned pages: Page dirs without matching route
  Report as system_alerts

Phase 7 — EXTRACT KB
  For each KB markdown file:
    Extract decisions → upsert owner_decisions
    Extract approved-but-not-built → upsert owner_requests
    Extract module metadata → update system_modules display fields
```

---

## 8. Module Detail View (Drill-down)

Clicking a module card opens:

```
┌──────────────────────────────────────────────────────────────────┐
│  Orders ● IMPLEMENTED ● Readiness: 85%   [Validate] [Report Bug] │
│  الطلبات                                                          │
├──────────────────────────────────────────────────────────────────┤
│  Status:   Implemented  [Override → Validated]                   │
│  Priority: Critical    [Override → High/Medium/Low/Icebox]       │
│  Owner OK: ✅ Approved on 2026-06-01  [Revoke]                  │
├──────────────────────────────────────────────────────────────────┤
│  ROUTES (5)        RPCS (12)       TABLES (3)       KB FILE ✅   │
│  /orders ✓         create ✓        orders           05_ORDER_    │
│  /orders/new ✓     submit ✓        order_items       RULES.md    │
│  /orders/:id ✓     approve ✓       order_status_     Line 12     │
│  /orders/:id/edit ✓ reject ✓       history                       │
│  /orders/approve ✓ cancel  ✓                                     │
├──────────────────────────────────────────────────────────────────┤
│  PIPELINE HEALTH: 86% (6/7 steps)                                │
│  ⬤ create    PASS  → governed_create_order ✓                    │
│  ⬤ submit    PASS  → governed_submit_order ✓                    │
│  ⬤ review    PASS  → routes exist, UI renders                   │
│  ⬤ approve   PASS  → governed_approve_order ✓ + capability ✓    │
│  ⬤ dispatch  FAIL  → governed_dispatch_order NOT FOUND          │
│  ⬤ deliver   PASS  → governed_complete_delivery ✓               │
│  ⬤ collect   PASS  → governed_create_collection ✓               │
├──────────────────────────────────────────────────────────────────┤
│  BUSINESS RULES: 5/7 verified (71%)                              │
│  ✅ Only Upper Mgmt can approve   → capability check found       │
│  ✅ Orders start as "draft"       → status default verified      │
│  ✅ Credit reservation on order   → reserve RPC exists          │
│  ❌ "No manual price override"    → update RPC allows override   │
│  ❌ "Auto-calc totals"           → front-end not yet implemented │
│  ⏳ Approval SLA < 24h           → manual, no timestamp yet      │
├──────────────────────────────────────────────────────────────────┤
│  BLOCKERS                                                        │
│  ⚠ governed_dispatch_order missing — Dispatch pipeline BROKEN   │
│  ⚠ Rule "No manual price override" FAILS — see ORDER_RULES.md:18│
└──────────────────────────────────────────────────────────────────┘
```

---

## 9. Knowledge Base Parser

The sync script parses KB markdown files to extract:

### Frontmatter (if present)
```yaml
---
module: orders
status: implemented
priority: critical
owner_approved: true
---
```

### Decisions and Rules

Pattern-matched from the markdown:
- Lines matching `^### .*Decision|Rule|Principle`
- Blockquote lines starting with `> **`
- Lines containing `**Key Decision:**` or `**Financial Rule:**`
- Section headers containing "Decisions" or "Rules"
- Lines with `_RULE` or `_DECISION` suffix patterns

### Approved Features Detection

Patterns that indicate a feature is approved but not built:
- `**Future Module:**` in document titles
- `**Status:** Placeholder` or `Implementation: Not Started`
- Sections titled "Future" or "Roadmap"
- Lines matching `^## .*Future Module` or `^## .*Planned`

### Verification Query Generation

For certain patterns, the parser suggests verification queries:
- `*does not modify*` → `table_check` on affected tables
- `*only X can Y*` → `capability_check` on the governing RPC
- `*auto-calculated*` or `*auto-generated*` → `rpc_check` on the calculation
- `*must be*` → `enum_check` or `constraint_check`

---

## 10. Owner Experience

### 10.1 When Upper Management Opens the Dashboard

They immediately know:

| Question | Answer | Where |
|----------|--------|-------|
| What works? | Green modules in Section A + production-ready list in Section B | Status bar + Sections A/B |
| What is broken? | Red modules + Section C broken pipelines list | Section A (red) + Section C |
| What is partially implemented? | Yellow/orange modules in Section A | Section A |
| What was approved but not built? | Section E ranked list | Section E |
| Which owner decisions are unimplemented? | ❌ items in Section D | Section D + Section F |
| Is the system ready for pilot? | "Pilot: ⚠" or "Pilot: ✅" in status bar | Status bar |

### 10.2 Pilot Readiness Indicator

The status bar shows a single computed indicator based on:

| Condition | Result |
|-----------|--------|
| All critical modules validated (Orders, Returns, Customers, Inventory) | ✅ Ready |
| Critical modules implemented but not owner-validated | ⚠ Needs Validation |
| A critical module is BROKEN | ❌ Blocked |
| A critical module is PARTIAL with pipeline health < 50% | ❌ Blocked |
| Major business rules (return/credit separation, auth rules) fail verification | ❌ Rules Broken |
| Above 80% readiness across all modules, no blocking issues | ✅ Ready |

### 10.3 Actions the Owner Takes from This Screen

| Action | How |
|--------|-----|
| Validate a module | Click "Mark as Validated" → sets owner_approved + status = validated |
| Override auto-detected status | Status dropdown → choose from VALIDATED/BROKEN/DEPRECATED |
| Change priority | Priority dropdown in module detail |
| Report a broken module | Click "Report Bug" → adds note, sets broken_since, flags for developer |
| Review unimplemented decisions | Section D shows failing rules with file links |
| Add a future request | "Add Request" → title, KB reference, priority |
| Approve a pending request | Click "Approve" on a planned feature |
| Defer/cancel a request | Status dropdown on the request card |
| Run sync | "Sync Now" re-scans everything |
| Run health check | "Check Health" runs per-module or globally |
| Open KB file | Click source_file link → opens the KB doc |
| View pipeline detail | Click a module card → pipeline steps with pass/fail per step |

### 10.4 What the Owner Should NOT Do

- Manually add route paths, RPC names, or table names
- Create module cards manually
- Remember which modules exist
- Track why a module is broken (pipeline health shows it)
- Search for past decisions (they are extracted and displayed)
- Create cards for new features (KB parser extracts them)

### 10.5 Highlighting Rules

- **Broken modules** (status = broken OR pipeline < 50%) always appear first, sorted by priority
- **Modules needing owner action** (newly suggested status change, unverified rules) get a badge
- **Production-ready count** is prominently displayed in the status bar with trend
- **Failing business rules** are highlighted in red in Section D
- **Unhealthy pipelines** show a red step dot at the failed step
- **Approved-but-stale** requests (approved > 30d, not started) get a time-warning badge

### 10.6 Notification Triggers

| Event | Notification |
|-------|-------------|
| Module health changes from healthy → degraded/down | Alert |
| New module discovered by sync | Info |
| Module pipeline health drops below 50% | Alert |
| Business rule verification fails for previously-passing rule | Alert |
| New owner decision extracted from KB | Info |
| Approved request has been pending > 30 days | Reminder |

---

## 11. Implementation Roadmap

### Phase 1 — Registry & Sync
1. Create `system_modules` table migration (projection, with SYNC-ONLY comments)
2. Create `owner_decisions` table migration (with verification columns)
3. Create `owner_requests` table migration
4. Write `scripts/sync-module-registry.mjs` — discovery, pipeline inference, decision extraction
5. Create `get_command_center(p_token uuid)` RPC — returns all projection data for the C2 screen
6. Create `get_module_detail(p_token uuid, p_module_key)` RPC

### Phase 2 — Command Center Page
1. Create `src/pages/command-center/CommandCenterPage.tsx` — reads from `get_command_center`
2. Render Section A: System Modules Grid (dynamic, no hardcoded cards)
3. Render Section B: Operational Readiness
4. Render Section C: Broken Pipelines
5. Render Section D: Business Rule Coverage
6. Render Section E: Owner Requested / Not Yet Built
7. Render Section F: Owner Decisions Log
8. Render Status Bar with pilot readiness indicator

### Phase 3 — Health & Interaction
1. Create pipeline step verification RPCs
2. Create decision verification RPCs
3. Add "Validate Module" action (updates owner_approved + status)
4. Add "Report Broken" action
5. Add "Change Priority" action
6. Add module detail drill-down (Section 8)
7. Add "Sync Now" button that invokes sync script
8. Add "Add/Approve/Defer Request" actions for Section E

### Phase 4 — Automation
1. Schedule daily sync via Supabase cron
2. Configure notifications on health/decision changes
3. Add stale-request reminders
4. Add pilot readiness auto-evaluation

---

## 12. Summary

The system replaces hardcoded module management with a database-driven projection that automatically discovers and tracks system components. The owner gets a living command center that always reflects the actual state of the system.

**Key architecture change from V1:** `system_modules` is explicitly a **disposable projection**, not a source of truth. Sources of truth remain: `OWNER_KNOWLEDGE_BASE`, runtime code, and database entities.

**Key innovations:**
| Feature | What It Solves |
|---------|---------------|
| Routes/RPCs/Tables → auto-discovered modules | No manual registry maintenance |
| KB → decisions + requests extraction | No duplicate entry, no forgotten rulings |
| Pipeline health (step-by-step) | Not just "does code exist" but "does the workflow work" |
| Business rule coverage | Not just "module implemented" but "owner intent implemented" |
| Approved-but-not-built tracking | Owner never forgets approved features |
| Disposable registry | Can rebuild from sources at any time |
| Pilot readiness | Single indicator answers "can we go live?" |
