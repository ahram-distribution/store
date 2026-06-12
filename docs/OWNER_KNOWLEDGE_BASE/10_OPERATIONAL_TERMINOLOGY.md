# Operational Terminology

> **Status:** Placeholder — ready to receive owner clarification.  
> **Verification Status:** `OWNER_DEFINED` (terminology rules from NEW_CHAT_BOOTSTRAP.md and verified documentation)

---

## Known Context (from verified documentation)

### Required Arabic Terminology

| Preferred Term | Avoid | Context |
|----------------|-------|---------|
| طلب / طلبات (order/orders) | فاتورة / فواتير (invoice) | General operational context |
| فاتورة / فواتير | — | Financial/tax documents only |

### Authentication

| Rule | Detail | Source |
|------|--------|--------|
| Primary login method | Phone number (`identities.phone`) | VERIFIED_IN_CODE |
| Email status | `customers.email` column exists but is NULLABLE; removed from all UIs | VERIFIED_IN_CODE |

### Business Model

| Term | Usage |
|------|-------|
| B2B Distribution | Official business model |
| Distributor-mediated | Sales reps visit customers |
| Governed Operational Distribution Runtime | Official system classification |

### Customer Types

| Type | Usage |
|------|-------|
| Direct Customer | One of exactly two customer types |
| Managed Customer | One of exactly two customer types |

**Sources:** PROJECT_STATE_HANDOFF.md §1, §3, NEW_CHAT_BOOTSTRAP.md

---

## Owner Clarifications

| Date | Topic | Owner Statement | Business Meaning | Related System Areas | Verification Status |
|------|-------|-----------------|------------------|---------------------|-------------------|
| — | — | — | — | — | — |

---

## Open Questions for Owner

1. Are there any additional terminology rules that should be enforced in the codebase?
2. Should the English UI also use specific terminology consistently?
3. Are there any terms used in the system that conflict with your business language?
4. Should the word "عميل" (customer) apply to both customer types, or should there be different terminology for each?

---

*End of 10_OPERATIONAL_TERMINOLOGY.md*
