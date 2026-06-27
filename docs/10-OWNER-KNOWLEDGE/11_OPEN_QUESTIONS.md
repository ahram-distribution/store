# Open Questions

> **Status:** Active — catalog of all questions requiring owner clarification.  
> **Verification Status:** `UNKNOWN` (all questions are unresolved)

---

## How to Use

This file consolidates all open questions from across the knowledge base. As the owner provides answers, they should be:
1. Recorded in the relevant topic file with date, owner statement, and business meaning.
2. Removed from this open questions list once answered and filed.

---

## Strategic Questions

| # | Question | Related File | Priority |
|---|----------|-------------|----------|
| SQ1 | What is the long-term vision for Ahram Distribution? (Growth targets, geographic expansion, new categories?) | `01_COMPANY_VISION.md` | Medium |
| SQ2 | Is the system intended to remain B2B-only, or is B2C planned for the future? | `01_COMPANY_VISION.md` | Medium |
| SQ3 | What is the desired timeline for achieving production stability (resolving all 7 blockers)? | `01_COMPANY_VISION.md` | High |
| SQ4 | Are there specific compliance or regulatory requirements (tax authority, CBE, etc.)? | `01_COMPANY_VISION.md` | High |

---

## Organizational Questions

| # | Question | Related File | Priority |
|---|----------|-------------|----------|
| OQ1 | Is the hierarchy exactly: Manager → Supervisor → Sales Rep → Customer? Any additional roles/layers? | `02_ORGANIZATIONAL_MODEL.md` | High |
| OQ2 | Is multi-role support (one employee having multiple roles) planned? | `02_ORGANIZATIONAL_MODEL.md` | Low |
| OQ3 | How should employee activity tracking be used operationally? | `02_ORGANIZATIONAL_MODEL.md` | Low |
| OQ4 | What is the reporting structure for supervisors? | `02_ORGANIZATIONAL_MODEL.md` | Medium |

---

## Ownership Questions

| # | Question | Related File | Priority |
|---|----------|-------------|----------|
| OW1 | Can a customer change owner via self-service, or must it always be admin? | `03_OWNERSHIP_RULES.md` | Medium |
| OW2 | Should ownership changes require approval from the losing owner's manager? | `03_OWNERSHIP_RULES.md` | Medium |
| OW3 | Is there a business rule about min/max customers per sales rep? | `03_OWNERSHIP_RULES.md` | Low |
| OW4 | Should customers of terminated/inactive employees be auto-reassigned? | `03_OWNERSHIP_RULES.md` | High |

---

## Customer Questions

| # | Question | Related File | Priority |
|---|----------|-------------|----------|
| CQ1 | What is the exact operational distinction between Direct and Managed Customer? | `04_CUSTOMER_RULES.md` | High |
| CQ2 | Can a customer switch between Direct and Managed types? | `04_CUSTOMER_RULES.md` | Medium |
| CQ3 | Should self-registered customers be auto-assigned to a default owner? | `04_CUSTOMER_RULES.md` | Medium |
| CQ4 | What is the full customer onboarding workflow? | `04_CUSTOMER_RULES.md` | High |
| CQ5 | Should customer email be completely removed from the system? | `04_CUSTOMER_RULES.md` | Low |
| CQ6 | What are the minimum mandatory fields for customer registration? | `04_CUSTOMER_RULES.md` | Medium |

---

## Order Questions

| # | Question | Related File | Priority |
|---|----------|-------------|----------|
| ORQ1 | Should inventory be deducted immediately on order approval? (Blocker B1) | `05_ORDER_RULES.md` | **Critical** |
| ORQ2 | Should credit invoices be created on order approval for credit customers? (Blocker B2) | `05_ORDER_RULES.md` | **Critical** |
| ORQ3 | What is the correct business process for order rejection? | `05_ORDER_RULES.md` | High |
| ORQ4 | What does `ready_for_dispatch` status mean and how is it reached? | `05_ORDER_RULES.md` | Medium |
| ORQ5 | Can orders be modified after submission? Under what conditions? | `05_ORDER_RULES.md` | Medium |
| ORQ6 | Should the system show snapshot data or live data for completed orders? | `05_ORDER_RULES.md` | Low |

---

## Collection Questions

| # | Question | Related File | Priority |
|---|----------|-------------|----------|
| CLQ1 | What triggers collection creation? (Order completion? Schedule? Manual?) | `06_COLLECTION_RULES.md` | High |
| CLQ2 | Should partial payments be allowed against a single collection? | `06_COLLECTION_RULES.md` | Medium |
| CLQ3 | What is the collections lifecycle beyond create/approve? (Follow-up, escalation, write-off?) | `06_COLLECTION_RULES.md` | Medium |
| CLQ4 | Are there collection aging rules or escalation policies? | `06_COLLECTION_RULES.md` | Low |
| CLQ5 | Should collections be order-level or customer-level? | `06_COLLECTION_RULES.md` | Medium |

---

## Return Questions

| # | Question | Related File | Priority |
|---|----------|-------------|----------|
| RQ1 | What is the business process for creating a return? (Who initiates? Conditions?) | `07_RETURN_RULES.md` | High |
| RQ2 | Should returns be linked to a specific order or customer-level? | `07_RETURN_RULES.md` | Medium |
| RQ3 | What are the valid reasons for a return? | `07_RETURN_RULES.md` | High |
| RQ4 | Should return creation involve inventory re-stocking? | `07_RETURN_RULES.md` | Medium |
| RQ5 | What is the inspection process for returns? | `07_RETURN_RULES.md` | Medium |
| RQ6 | Should partial returns be supported? | `07_RETURN_RULES.md` | Low |

---

## Pricing Questions

| # | Question | Related File | Priority |
|---|----------|-------------|----------|
| PQ1 | How should pricing work for customers without a tier assignment? | `08_PRICING_AND_TIERS_RULES.md` | Medium |
| PQ2 | How do daily deals interact with tier discounts? (Stack? Override?) | `08_PRICING_AND_TIERS_RULES.md` | Medium |
| PQ3 | How do flash offers interact with tiers and daily deals? | `08_PRICING_AND_TIERS_RULES.md` | Low |
| PQ4 | Is the 3-price model (carton/unit/wholesale) sufficient? | `08_PRICING_AND_TIERS_RULES.md` | Low |
| PQ5 | Who has authority to manage daily deals and flash offers? | `08_PRICING_AND_TIERS_RULES.md` | Medium |
| PQ6 | Should flash offers be implemented fully or deprioritized? | `08_PRICING_AND_TIERS_RULES.md` | Medium |

---

## Permissions Questions

| # | Question | Related File | Priority |
|---|----------|-------------|----------|
| PMQ1 | What are the defined roles and their hierarchy? | `09_PERMISSIONS_RULES.md` | High |
| PMQ2 | What capabilities should each role have? | `09_PERMISSIONS_RULES.md` | High |
| PMQ3 | Single-role or multi-role model? | `09_PERMISSIONS_RULES.md` | Medium |
| PMQ4 | Should 20 governance bypasses be resolved? | `09_PERMISSIONS_RULES.md` | Medium |
| ~~PMQ5~~ | ~~Who has authority to create/modify roles and capabilities?~~ | ~~`09_PERMISSIONS_RULES.md`~~ | ~~High~~ |
| | **ANSWERED (2026-06-09):** Upper Management has exclusive authority to grant/revoke permissions for any employee from Employee Management. No other role may grant or revoke permissions. See `12_OWNER_PRINCIPLES.md` — Permission Authority. | | |
| PMQ6 | Are there capabilities restricted to specific managers only? | `09_PERMISSIONS_RULES.md` | Medium |

---

## Terminology Questions

| # | Question | Related File | Priority |
|---|----------|-------------|----------|
| TQ1 | Are there additional terminology rules to enforce? | `10_OPERATIONAL_TERMINOLOGY.md` | Low |
| TQ2 | Should English UI also follow specific terminology? | `10_OPERATIONAL_TERMINOLOGY.md` | Low |
| TQ3 | Are there any terms in the system that conflict with business language? | `10_OPERATIONAL_TERMINOLOGY.md` | Low |
| TQ4 | Should terminology differ between Direct Customer and Managed Customer? | `10_OPERATIONAL_TERMINOLOGY.md` | Low |

---

## Technical Questions (From Audit Gaps)

| # | Question | Source | Priority |
|---|----------|--------|----------|
| TCQ1 | Do `governed_deny_order`, `governed_create_auction`, and `governed_reassign_customer_ownership` exist in the live database? (Not found in any of 52 SQL migrations.) | 15_BLUEPRINT_VERIFICATION_AUDIT.md §3, PROJECT_STATE_HANDOFF.md §14 | High |
| TCQ2 | Exactly how many customers have NULL `location_id` (estimated ~15/25)? | PROJECT_STATE_HANDOFF.md §4 | High |
| TCQ3 | Are the 8 empty tables (daily_deals, flash_offers, preparation_records, etc.) intentional placeholders or sign of broken workflows? | PROJECT_STATE_HANDOFF.md §13 | Medium |
| TCQ4 | Should `ActivityPage` be implemented or removed? | PROJECT_STATE_HANDOFF.md §6.5 | Low |
| TCQ5 | Is the full credit subsystem (ledger, cheques, reservations, statements, activation/suspension) planned for completion? | PROJECT_STATE_HANDOFF.md §9 | High |

---

*End of 11_OPEN_QUESTIONS.md*
