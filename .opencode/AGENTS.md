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
1. Read `PROJECT_TRUTH_AUDIT.md` — understand current state first
2. Read `FIX_HISTORY.md` — check if this issue is already tracked
3. Read `ACTIVE_RUNTIME_ONLY.md` — know what actually runs

### During changes
4. NO deleting any code, tables, or RPCs — only mark as deprecated
5. NO refactoring or new features — only fixes and documentation
6. Record EVERY change in `FIX_HISTORY.md`
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
- Docs: `docs/` (use `docs/README.md` as index)
- Fix records: `FIX_HISTORY.md` (root)

### Naming
- Arabic-first for user-facing strings
- English for code identifiers (camelCase)
- SQL migrations: `YYYYMMDD_description.sql`

## Verification
- Always run type check after changes: `npx tsc --noEmit`
- Always check for console.log before committing
- Verify RPCs still return expected data shapes
