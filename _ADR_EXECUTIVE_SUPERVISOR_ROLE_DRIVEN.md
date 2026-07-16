# Architecture Decision Record: Executive Supervisor Role-Driven Architecture

**Date:** 2026-07-15
**Status:** Accepted
**Scope:** Executive Supervisor operational role
**Related Tasks:** Rule 3 governance purge, Executive Supervisor standardization

---

## Context

Mohamed Abdel Baset (REP-001) was the sole holder of the Executive Supervisor role. Over time, the runtime accumulated dependencies on his employee identity rather than on the role itself:

- `DashboardPage.tsx` routed by `empCode === 'REP-001'` instead of by role
- `StatusBar.tsx` displayed a hardcoded `REP-001` label
- The role normalization entry `'مشرف تنفيذي' → 'مشرف عام'` masked the fact that the role was not recognized directly

## Decision

**The runtime must never depend on employee identity.**

Employee identity (employee_id, employee_code, employee_name) must never be used to determine:

- Dashboard
- Workspace
- Navigation
- Permissions
- Capabilities
- Runtime behavior
- Feature availability

**Employee identity is data. Business roles are behavior.**

### Executive Supervisor

Executive Supervisor is a first-class canonical operational role. The runtime recognizes it directly:

```
raw role 'مشرف تنفيذي' → DashboardPage direct check → ExecutiveOperationsWorkspace
```

Mohamed Abdel Baset is simply one employee assigned to this role. He is not a special case, not a reference implementation, and not the architecture.

### Removed Dependencies

Two employee-specific dependencies were identified and removed:

| Location | Before | After |
|---|---|---|
| `src/pages/dashboard/DashboardPage.tsx:45` | `if (empCode === 'REP-001')` | `if (roles.includes('مشرف تنفيذي'))` |
| `src/desktop/layout/StatusBar.tsx:84` | Hardcoded `<span>REP-001</span>` | `<span>{user?.code \|\| '---'}</span>` |

### Compatibility Layer (Technical Debt)

The normalization entry `'مشرف تنفيذي': 'مشرف عام'` in `roleNormalization.ts:36` is retained as a temporary compatibility layer. It exists because seven callers of `normalizeEmployeeRole()` would produce different return values without it, and those callers are outside the current scope.

**Future cleanup:** When all dependencies on `normalizeEmployeeRole()` have been audited and refactored, this compatibility entry must be deleted. No new code may depend on it.

## Consequences

### Positive

1. Any employee assigned to `مشرف تنفيذي` immediately receives the exact same dashboard, workspace, permissions, and runtime experience
2. No additional roles, manual permissions, or configuration required
3. Changing employee code or ID does not change runtime behavior
4. Only removing the role changes the runtime
5. The runtime is officially role-driven instead of employee-driven

### Negative

1. The compatibility normalization entry remains as technical debt
2. A future cleanup phase is required to remove it safely

## Future Rule

Any future feature added to Executive Supervisor must be:

- Assigned to the role itself via `role_capabilities`
- Checked by the raw role name `'مشرف تنفيذي'`
- Never dependent on employee-specific conditions

Never introduce:

- New hardcoded employee IDs or employee codes
- New role aliases for Executive Supervisor
- New normalization targets that map Executive Supervisor to another role

## References

- `src/pages/dashboard/DashboardPage.tsx` — workspace routing entry point
- `src/desktop/layout/StatusBar.tsx` — status bar display
- `src/utils/roleNormalization.ts:36` — compatibility mapping (temp)
- `supabase/migrations/20260715e_governance_purge_legacy_roles.sql` — related governance cleanup
