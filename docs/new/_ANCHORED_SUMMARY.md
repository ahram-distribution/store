## Goal
Build a permanent Owner Knowledge Documentation System preserving all business knowledge from the company owner for the Ahram Distribution system across all future sessions.

## Constraints & Preferences
- Do NOT modify code, database schema, or existing system documentation unless explicitly tasked
- Do NOT infer additional rules, permissions, or hierarchy beyond what the owner explicitly states
- Do NOT redesign workflows or refactor unrelated modules when implementing fixes
- Verification Status: OWNER_DEFINED, VERIFIED_IN_CODE, VERIFIED_IN_DATABASE, PARTIALLY_VERIFIED, UNKNOWN, OWNER_VISION
- Every owner clarification stored with date, topic, owner statement, business meaning, related system areas, verification status

## Progress
### Done
- Created 24-file OWNER_KNOWLEDGE_BASE directory with index, changelog, open questions, gap analysis, consolidation report, and 19+ topic files
- Completed **KNOWLEDGE_TO_SYSTEM_GAP_REPORT.md** — 27% alignment (14/51 items), 19 broken/missing, 3 broken pipelines, 6 critical blockers
- Completed **IMPLEMENTATION_ANALYSIS_REPORT.md** — deep-dive analysis of 3 critical operational blockers
- **Phase 1: Fixed & Validated Order Approval Pipeline**
  - Migration: `governed_approve_order` now accepts `submitted` + `reviewing`; uses `v_session.identity_id` (not `employee_id`) for `changed_by` FK compliance
  - Frontend: `OrderStatusManager.tsx:89-107` routes `target === 'approved'` to `governed_approve_order`
  - **E2E validation PASSED**: draft → submitted → reviewing → approved; Daily Deal inventory 20→19; 3 audit entries recorded
- Created **17_WORKDAY_TRACKING_SYSTEM.md** — future module spec (4 modes, offline support, visibility rules)

### In Progress
None

### Blocked
- `governed_deny_order` RPC does not exist — owner defines rejection path but system has no dedicated RPC
- `governed_create_auction` RPC does not exist — auctions created via direct `supabase.from('auctions').insert()` bypassing governance
- `/returns/new` route missing — return creation button navigates to dead route; `governed_create_return` exists in DB but is unreachable
- Credit pipeline broken: `governed_reserve_credit_for_order`, `governed_convert_credit_reservation_to_outstanding`, `governed_release_credit_reservation` all exist in DB and wrapped in `creditService` but have zero frontend call sites
- No UM bypass check in governance RPCs — UM absolute authority not reflected in code
- UM cannot grant/revoke permissions via UI — no dynamic permission management interface
- Inventory table is empty in production DB — deduction logic uses `IF FOUND THEN` so no error but no visible effect

## Key Decisions
- Order approval fix uses existing `governed_approve_order` RPC with minimal modification (accept `reviewing` status + use `identity_id` for FK compliance) — no new RPC created, no workflow redesigned
- `governed_change_order_status` inserts with `v_session.identity_id` (correct FK); `governed_approve_order` was using `employee_id` (FK violation) — now fixed

## Next Steps
- Phase 2 (return creation pipeline fix) when instructed
- Phase 3 (credit pipeline fix) when instructed

## Critical Context
- System is B2B cosmetics distribution in Egypt — NOT retail; ~25 customers, ~700 products, ~16 employees; phone-based login
- Supabase project ref: `gbcbejejgpvltuhbztbx`; management token available for direct SQL queries
- Session token for test user ياسر توفيق (UM): `ae48bbbe-8c69-4bff-8f98-a7912fc99109`; identity UUID: `d6ab46a7-88b3-46c9-8404-469e5627c260`; employee UUID: `af3ddd9b-f992-49fc-a0cd-18b29c6a031e`
- `identities` table PK used for `orders.created_by` and `order_status_history.changed_by` FKs — `employees` table has separate `identity_id` column linking to `identities`
- Inventory table exists but is empty — product inventory deduction is a no-op (IF FOUND check prevents error)
- Knowledge Readiness Score: 27% system alignment (14/51 items aligned), 6 critical blockers identified

## Relevant Files
- `docs/OWNER_KNOWLEDGE_BASE/` — full knowledge base (index, changelog, 19+ topic files)
- `docs/OWNER_KNOWLEDGE_BASE/KNOWLEDGE_TO_SYSTEM_GAP_REPORT.md` — 51-item gap analysis
- `docs/OWNER_KNOWLEDGE_BASE/IMPLEMENTATION_ANALYSIS_REPORT.md` — 3 critical pipeline deep-dives
- `supabase/migrations/20260622_fix_order_approval_pipeline.sql` — Phase 1 migration (baked: accepts `submitted`/`reviewing`, uses `identity_id`)
- `src/components/orders/OrderStatusManager.tsx` — routes `* → approved` to `governed_approve_order`
- `docs/OWNER_KNOWLEDGE_BASE/17_WORKDAY_TRACKING_SYSTEM.md` — future module spec
