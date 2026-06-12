# Owner Knowledge Base — Index

> **Purpose:** Permanent preservation of business knowledge from the company owner for Ahram Distribution.  
> **Established:** 2026-06-09  
> **Basis:** PROJECT_STATE_HANDOFF.md, FINAL_CANONICAL_MASTER_REFERENCE_V2.md, FINAL_EXECUTIVE_SUMMARY_V2.md, 15_BLUEPRINT_VERIFICATION_AUDIT.md, 16_RUNTIME_SOURCE_OF_TRUTH_MAP.md  
> **Rule:** This knowledge base captures owner-defined business rules. When technical documentation contradicts this knowledge base, the owner's statement is authoritative.

---

## Structure

| File | Topic | Status |
|------|-------|--------|
| `00_CHANGELOG.md` | Change log | Active |
| `01_COMPANY_VISION.md` | Company vision and strategic direction | Placeholder |
| `02_ORGANIZATIONAL_MODEL.md` | Organizational hierarchy and structure | Placeholder |
| `03_OWNERSHIP_RULES.md` | Customer ownership model | Placeholder |
| `04_CUSTOMER_RULES.md` | Customer types, lifecycle, rules | Placeholder |
| `05_ORDER_RULES.md` | Order lifecycle and business rules | Placeholder |
| `06_VISIT_RULES.md` | Visit rules and field activity | Active |
| `06_COLLECTION_RULES.md` | Collection / receivables rules | Placeholder |
| `07_PROMOTIONAL_SYSTEMS.md` | Daily deals and flash offers | Active |
| `07_RETURN_RULES.md` | Return processing rules | Placeholder |
| `08_PRICING_AND_TIERS_RULES.md` | Pricing, discounts, tier rules | Placeholder |
| `09_PERMISSIONS_RULES.md` | Roles, capabilities, access control | Placeholder |
| `10_OPERATIONAL_TERMINOLOGY.md` | Required terminology and naming | Placeholder |
| `11_OPEN_QUESTIONS.md` | Questions requiring owner clarification | Placeholder |
| `12_OWNER_PRINCIPLES.md` | Cross-cutting owner principles and design philosophy | Active |
| `13_STOREFRONT_EXPERIENCE.md` | Storefront purchase experience (button, quantity input/rules) | Active |
| `14_REPORTING_AND_ANALYTICS.md` | Reporting, analytics, rankings, smart alerts | Active |
| `15_UI_AND_UX_STANDARDS.md` | UI/UX standards, mobile, cards, search, filters, colors, notifications | Active |
| `16_SMART_COMMERCE.md` | Recommendation engine, smart commerce, reorder reminders, alerts | Active |
| `17_WORKDAY_TRACKING_SYSTEM.md` | Workday tracking, location monitoring, tracking modes, offline support | Future Module |

---

## How to Use

1. When the owner provides business clarification, update the relevant file(s).
2. Each entry must include: Date, Topic, Owner Statement, Business Meaning, Related System Areas, Verification Status.
3. Cross-reference canonical technical documents where applicable.
4. Never convert assumptions into facts — mark unknown items as `UNKNOWN`.

---

## Verification Status Reference

| Status | Meaning |
|--------|---------|
| `OWNER_DEFINED` | Stated directly by the company owner |
| `VERIFIED_IN_CODE` | Confirmed by source code analysis |
| `VERIFIED_IN_DATABASE` | Confirmed by live database query |
| `PARTIALLY_VERIFIED` | Confirmed in some sources but not all |
| `UNKNOWN` | Not yet verified from any source |

---

## Cross-Reference to Canonical Documents

| Document | Location | Scope |
|----------|----------|-------|
| PROJECT_STATE_HANDOFF.md | `docs/system-blueprint/PROJECT_STATE_HANDOFF.md` | Executive handoff, risks, blockers, dead assets |
| FINAL_CANONICAL_MASTER_REFERENCE_V2.md | `docs/system-blueprint/FINAL_CANONICAL_MASTER_REFERENCE_V2.md` | Complete system reference, tables, RPCs, workflows |
| FINAL_EXECUTIVE_SUMMARY_V2.md | `docs/system-blueprint/FINAL_EXECUTIVE_SUMMARY_V2.md` | High-level summary, V1 vs V2 corrections |
| 15_BLUEPRINT_VERIFICATION_AUDIT.md | `docs/system-blueprint/15_BLUEPRINT_VERIFICATION_AUDIT.md` | Independent audit of all claims in V1 |
| 16_RUNTIME_SOURCE_OF_TRUTH_MAP.md | `docs/system-blueprint/16_RUNTIME_SOURCE_OF_TRUTH_MAP.md` | Canonical sources, dual SOTs, migration roadmap |

---

*End of OWNER_KNOWLEDGE_INDEX.md*
