# Ownership Rules

> **Status:** Placeholder — ready to receive owner clarification.  
> **Verification Status:** `VERIFIED_IN_CODE` (ownership model confirmed in schema and code)

---

## Known Context (from verified documentation)

### Core Rules

| Rule | Detail | Source |
|------|--------|--------|
| Source of truth | `customers.owner_id` | Every customer has exactly one owner |
| Owner type | Employee (FK → employees.id) | A sales representative or responsible person |
| Audit trail | `customer_ownership_history` | Full history of ownership changes |
| Change mechanism | `governed_change_customer_ownership` RPC | Operational RPC with frontend callers |
| Alternate RPC | `governed_reassign_customer_ownership` | Not found in SQL migrations (may exist in live DB) |

### What is NOT Allowed (per bootstrap)

- No alternative ownership model may be proposed unless explicitly requested.
- No modification to ownership logic without full impact report and approval.

**Sources:** PROJECT_STATE_HANDOFF.md §1, §3, §5, NEW_CHAT_BOOTSTRAP.md, 16_RUNTIME_SOURCE_OF_TRUTH_MAP.md §6

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| — | — | — | — | — | — |

---

## Open Questions for Owner

1. Can a customer change owner via self-service, or must it always be an admin action?
2. Should ownership changes require approval from the losing owner's manager?
3. Is there a business rule about minimum/maximum customers per sales representative?
4. Should the system enforce that a customer cannot be owned by a terminated/inactive employee?

---

*End of 03_OWNERSHIP_RULES.md*
