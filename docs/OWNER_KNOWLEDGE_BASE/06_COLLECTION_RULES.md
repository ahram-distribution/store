# Collection Rules

> **Status:** Placeholder — ready to receive owner clarification.  
> **Verification Status:** `PARTIALLY_VERIFIED` (collection workflow operational; business rules need owner confirmation)

---

## Known Context (from verified documentation)

### Collection Workflow

| Step | RPC | Status |
|------|-----|--------|
| Creation | `governed_create_collection` | Operational |
| Approval | `governed_approve_collection` | Operational |

### Key Tables

| Table | Purpose |
|-------|---------|
| `collections` | Collection/receivable record (amount, paid_amount, status, due_date) |

### Business Logic

- Remaining balance is computed as `amount - paid_amount` (not stored — computed in `governed_get_customer_collections` RPC)
- Collections are linked to customers and optionally to orders

### Known Counts

- 6 collection records exist in the database
- Collections readiness score: 70/100 (Create + approve work)

**Sources:** PROJECT_STATE_HANDOFF.md §8, FINAL_CANONICAL_MASTER_REFERENCE_V2.md §1.3, §6, 16_RUNTIME_SOURCE_OF_TRUTH_MAP.md §26

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| — | — | — | — | — | — |

---

## Open Questions for Owner

1. What is the business trigger for creating a collection? (On order completion? On a schedule? Manually?)
2. Should partial payments be allowed against a single collection?
3. What is the collections lifecycle beyond create/approve? (Follow-up, escalation, write-off?)
4. Are there collection aging rules or escalation policies for overdue collections?
5. Should collections be linked specifically to orders, or are they customer-level?

---

*End of 06_COLLECTION_RULES.md*
