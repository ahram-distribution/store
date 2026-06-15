# AGENTS.md — OpenCode Rules for Ahram Distribution

## Project Identity
- **Name:** Ahram Distribution Management System
- **Stack:** React 19 + TypeScript 6 + Vite 5 + Tailwind v4
- **Backend:** Supabase + Governed RPCs (no direct table access)
- **State:** Zustand
- **Routing:** React Router v7
- **Mobile:** Capacitor v8 (Android + iOS)
- **Direction:** RTL / Arabic first
- **Admin Structure:** الإدارة العليا ← مدير بيع ← مندوب ← عميل

## Mandatory Rules

### Before ANY change
1. Read `docs/good/07-audits/PROJECT_TRUTH_AUDIT.md` — understand current state first
2. Read `docs/good/05-fixes/FIX_HISTORY.md` — check if this issue is already tracked
3. Read `docs/good/02-runtime/ACTIVE_RUNTIME_ONLY.md` — know what actually runs

### During changes
4. NO deleting any code, tables, or RPCs — only mark as deprecated
5. NO refactoring or new features — only fixes and documentation
6. Record EVERY change in `docs/good/05-fixes/FIX_HISTORY.md`
7. Use `is_upper_management()` instead of hardcoded role names
8. Never hardcode employee codes (`WRQ1002`, `WRQ1004`)
9. Route all DB access through governed RPCs — never `supabase.from()` directly
10. Add Arabic documentation for any new feature or fix

### Prohibited
- Direct table access (`supabase.from('table').select('*')`)
- New npm packages without documented need
- Hardcoded role names or employee codes
- console.log in production code
- Modifying database tables directly (RPCs only)

## File Conventions

### New files location
- SQL migrations: `supabase/migrations/`
- Services: `src/services/`
- Pages: `src/pages/<module>/`
- Components: `src/components/`
- Types: `types/` or `src/types/`
- Docs: `docs/good/` (use `docs/good/00-governance/DOCUMENTATION_INDEX.md` as index)
- Fix records: `docs/good/05-fixes/FIX_HISTORY.md`

### Naming
- Arabic-first for user-facing strings
- English for code identifiers (camelCase)
- SQL migrations: `YYYYMMDD_description.sql`

## Documentation Governance
- **ALL new documentation** (reports, audits, analysis, architecture, governance, fix history, runtime docs, database docs) MUST be created inside `docs/good/`
- NO documentation files at project root — ever
- When editing an existing doc outside `docs/good/`, move it to the appropriate subdirectory inside `docs/good/` first
- Classification follows the `docs/good/` directory structure:
  - `00-governance/` — policies, governance rules
  - `01-architecture/` — system maps, screen/RPC catalogs
  - `02-runtime/` — runtime behavior analysis
  - `03-database/` — database usage, schemas
  - `04-security/` — role models, access control
  - `05-fixes/` — fix history, regression guards, hotfix reports
  - `06-reports/` — phase reports, status reports
  - `07-audits/` — truth audits, integrity audits
  - `08-operations/` — removal candidates, consolidation reports
  - `09-reference/` — summaries, reference material
  - `archive/` — old/duplicate docs (never delete)
- `docs/new/` and `docs/old/` are staging areas only — reference them but create new content in `docs/good/`
- Violation: any doc created outside `docs/good/` must be moved immediately

## Verification
- Always run type check after changes: `npx tsc --noEmit`
- Always check for console.log before committing
- Verify RPCs still return expected data shapes
