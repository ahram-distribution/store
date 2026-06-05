# GOVERNANCE — Ahram Distribution Access Control Architecture

**Last updated:** 2026-06-05  
**Source:** Phase 2 Verification Report, SYSTEM_BLUEPRINT.md, migration analysis

---

## Design Philosophy

The system uses **capability-based governance** implemented at the database layer via SECURITY DEFINER RPCs, NOT via PostgreSQL Row-Level Security (RLS). RLS policies exist (86 of them) but are dormant — `rowsecurity = false` on all `public` tables except `unified_locations`.

## Governance Chain

```
Frontend Route (ProtectedRoute)
  → useCapability hook (5-min client-side cache)
    → authService.checkCapability()
      → check_capability(p_token, p_code) [SECURITY DEFINER RPC]
        → validates session in app.sessions
          → checks employee_capabilities (direct grant/deny)
            → checks role_capabilities (via employee_roles)
              → returns boolean
```

## Three Layers

### 1. Database Layer (RPC Governance)
- **118+ governed RPCs** — all `SECURITY DEFINER` with `search_path = public, extensions`
- Every RPC validates the session token against `app.sessions`
- Every RPC calls `check_capability()` internally to verify authorization
- Only `deals.ts` bypasses this (direct `supabase.from('packages').select('*')`)

### 2. Route-Level Guards (ProtectedRoute)
- `requireCapability` — checks specific capability code (e.g., `orders.update`, `credit.manage`)
- `employeeOnly` — restricts to employee identities
- `customerOnly` — restricts to customer identities

### 3. Component-Level Guards (useCapability Hook)
- Client-side cache with 5-minute TTL
- Superadmin shortcut: if user roles contain `superadmin`, ALL capabilities return true

## Capability Model

| Aspect | Detail |
|---|---|
| Storage | `employee_capabilities` (employee_id, capability_id, grant_type) + `role_capabilities` (role_id, capability_id) |
| Grant Types | `grant` or `deny` |
| Priority | Direct grants/denies override role-based capabilities |
| Check Order | 1. Direct deny → 2. Direct grant → 3. Role-based capabilities |
| Format | Dot-notation codes: `orders.update`, `credit.manage`, `employees.manage` |

## Bypasses

| Location | Type | Risk |
|---|---|---|
| `src/services/deals.ts` | Direct table access | HIGH — no governance at all |
| `src/services/auctions.ts` | Realtime subscriptions (read-only) | LOW — read bypass for live updates |

## RLS Policy Gap

| Table Set | RLS Enabled? | Policies? |
|---|---|---|
| `public.*` (except unified_locations) | **NO** | 86 defined but dormant |
| `unified_locations` | YES | 0 policies (default-deny) |

The 86 defined policies follow patterns:
- `p_select`: gated by `app.current_identity_id() IS NOT NULL`
- `p_insert`/`p_update`/`p_delete`: gated by `app.has_capability('...')`
- `p_all`: admin-only specific capabilities

If RLS were enabled, these policies would activate. Currently they are inert.
