# Owner Gap Analysis

> **Purpose:** Compare owner-defined knowledge against existing documented system knowledge to identify gaps, conflicts, and unclarified areas.  
> **Date:** 2026-06-09  
> **Sources:** OWNER_KNOWLEDGE_BASE, PROJECT_STATE_HANDOFF.md, FINAL_CANONICAL_MASTER_REFERENCE_V2.md, FINAL_EXECUTIVE_SUMMARY_V2.md, 15_BLUEPRINT_VERIFICATION_AUDIT.md, 16_RUNTIME_SOURCE_OF_TRUTH_MAP.md

---

## 1. OWNER KNOWLEDGE ALREADY MATCHES DOCUMENTED SYSTEM

Items where owner statements align with existing documentation or system evidence.

| # | Topic | Owner Statement | Documented System Evidence |
|---|-------|-----------------|---------------------------|
| 1 | Two customer types only | Direct Customer and Managed Customer — exactly two types | NEW_CHAT_BOOTSTRAP.md, PROJECT_STATE_HANDOFF.md §1 (verification count: ~25 customers) |
| 2 | Phone is primary login | Phone is primary login method; email is not part of daily operations | PROJECT_STATE_HANDOFF.md §1, §3 (identities table, email NULLABLE, removed from UIs) |
| 3 | Customer ownership model | Customers owned by creator; reassignable by hierarchy | PROJECT_STATE_HANDOFF.md §3 (customers.owner_id GREEN), governed_change_customer_ownership exists |
| 4 | Order modification audit | All changes must be logged with user, action, date, time | order_status_history + order_modification_history tables exist (dual SOT noted) |
| 5 | Order approval = status معتمد | Inventory deducted when order reaches معتمد | governed_approve_order RPC exists (but orphaned — never called). System intent matches owner rule; execution is broken |
| 6 | Upper Management manages employees, roles, permissions | Upper Management handles employee admin | governed_create_employee, governed_change_employee_role, governed_change_employee_manager, role_capabilities + employee_capabilities exist |
| 7 | Sales Manager manages his team only | Visibility limited to own team | employees.manager_id hierarchy supports this; system architecture matches intent |
| 8 | Inventory management by Upper Management | Upper Management manages inventory values | ProductManagerPage writes to inventory table (bypass #6 at line 177) |
| 9 | Targets and weights by Upper Management | Upper Management controls targets/weights | company_monthly_targets + employee_monthly_targets tables exist; targetService operational |
| 10 | Search across entities | Search supports Arabic/English names, codes, orders, customers | governed_global_search RPC exists and is operational |
| 11 | Price types exist | System has three price fields | products.carton_price, unit_price, wholesale_price + productPricing.ts engine |
| 12 | Daily deals are standalone packages | Not tied to catalog pricing or inventory | daily_deals + daily_deal_items tables; governed_create_daily_deal exists |
| 13 | Flash offers are time-limited | Short-duration promotional packages | flash_offers + flash_offer_items tables exist |
| 14 | Visit location tracking | Capture location on start and end | visits table has check_in_lat/lng, check_out_lat/lng, unified_locations for named reference |
| 15 | Warehouse Manager role | بسام manages preparation stage only | warehouse workflow (governed_start_preparation → governed_complete_preparation → governed_review_preparation) supports this scope |
| 16 | General Supervisor role | محمد عبد الباسط oversees order execution post-preparation | System has governed_dispatch_order, governed_assign_delivery, governed_confirm_delivery — post-preparation status managers |

---

## 2. OWNER KNOWLEDGE NOT FOUND IN DOCUMENTATION

Owner-defined rules that do not appear in any system documentation, blueprint, or migration.

| # | Owner Rule | Where Defined | Significance |
|---|-----------|---------------|-------------|
| 1 | Supreme Board (ياسر توفيق, محمد سعيد, علي سعيد, محمود سعيد) as highest authority | 02_ORGANIZATIONAL_MODEL.md | No Supreme Board concept exists in any blueprint or schema. No role/table for board members |
| 2 | Tiers are NOT permanent customer assignments — they are selectable during order creation | 08_PRICING_AND_TIERS_RULES.md | **Major conflict.** System treats tiers as customer-level assignments; owner says they are transient order-level selections with no permanent link |
| 3 | Unified registration principle — all user types share same core fields | 03_USER_TYPES.md | System has separate registration paths: register_customer for customers, governed_create_employee for employees, RegistrationPage for self-registration. No unified core |
| 4 | Order submission sends copy to company WhatsApp | 05_ORDER_RULES.md | No WhatsApp integration mentioned anywhere in blueprints, code analysis, or migration files |
| 5 | Inventory quantities visible ONLY to Upper Management | 09_ADMINISTRATION_RULES.md | System has no inventory visibility restriction. ProductManagerPage (any employee with role) can view/edit inventory |
| 6 | Storefront should behave as digital sales representative (guidance, suggestions, recommendations, assistance) | 12_OWNER_PRINCIPLES.md | Storefront is a basic catalog with tier selection and cart. No guidance/suggestion/recommendation behavior |
| 7 | Errors should explain what failed, why it failed, and what user should do next | 12_OWNER_PRINCIPLES.md | No guided error principle documented in blueprints. Current error handling approach unknown |
| 8 | Future modules should be preserved and hidden, not removed (collections, treasury/cashbox) | 12_OWNER_PRINCIPLES.md | Blueprints recommend cleanup of dead assets. Owner prefers preservation + hide |
| 9 | Two credit programs: A (100k/15d) and B (300k/30d) | 04_CUSTOMER_RULES.md | credit_programs table exists but no specific programs A/B documented in blueprints. System's program data unknown |
| 10 | Credit activation requires contract execution + guarantees | 04_CUSTOMER_RULES.md | credit_contracts table exists (0 rows) but activation requirements not documented in blueprints |
| 11 | Participation flow: request → Upper Management approval → bidding enabled | 08_AUCTION_RULES.md | No participation request/approval workflow exists. auctions use raw supabase.from() |
| 12 | Bid increments are predefined and configured by Upper Management | 08_AUCTION_RULES.md | auctions table has bid_increment column (default 1). No increment configuration UI or Upper Management control |
| 13 | Realtime visibility of participant names, current bid values, live activity | 08_AUCTION_RULES.md | System publishes auction_bids and auction_activity to realtime. But participant names visibility not restricted per owner's approval flow |
| 14 | Order cards: external (order#, customer, owner, creator, status, value) vs internal (all details + history) | 05_ORDER_RULES.md | No unified order card standard documented in blueprints. Multiple card implementations likely inconsistent |
| 15 | Search results must respect visibility permissions | 12_OWNER_PRINCIPLES.md | governed_global_search RPC exists but its permission enforcement is not documented |

---

## 3. DOCUMENTED SYSTEM KNOWLEDGE NOT YET DISCUSSED BY OWNER

Modules, workflows, and features that exist in documentation but have not been addressed in OWNER_KNOWLEDGE_BASE.

| # | Topic | Documented Evidence | Owner Status |
|---|-------|-------------------|-------------|
| 1 | Returns workflow | governed_create_return (exists, orphaned), governed_approve_return, governed_reject_return. 07_RETURN_RULES.md is a placeholder. Return Creation is Production Blocker B3 | Not yet defined by owner |
| 2 | Collections workflow | governed_create_collection, governed_approve_collection. collections table. 06_COLLECTION_RULES.md is a placeholder. Collection readiness score: 70/100 | Not yet defined by owner |
| 3 | Delivery workflow | governed_assign_delivery, governed_confirm_delivery. delivery_tracking table. Readiness score: 85/100 | Not yet defined by owner |
| 4 | Warehouse preparation workflow | governed_start_preparation, governed_complete_preparation, governed_review_preparation. preparation_records table (0 rows). Readiness score: 95/100 | Owner defined Warehouse Manager role scope but not preparation workflow details |
| 5 | Credit subsystem beyond programs | governed_suspend_credit, governed_release_credit_reservation, governed_suspend_credit_account, governed_record_credit_payment, governed_record_cheque. credit_invoices, customer_credit_ledger tables. B4/B5 blockers | Owner defined credit programs A/B but not: suspension rules, ledger operations, cheque handling, credit reservation timing, invoice lifecycle |
| 6 | Employee role/capability system | roles table, role_capabilities, employee_capabilities. governed_change_employee_role exists. 09_PERMISSIONS_RULES.md is a placeholder | Owner mentioned roles/permissions management but not the actual role structure, capability codes, or assignment rules |
| 7 | Storefront (customer-facing) | StorefrontPage, StorefrontCompaniesPage. Tier selection, product browsing. Readiness: 70/100 | Owner said it should be a "digital sales representative" but no detailed rules on catalog browsing, product display, ordering flow for customers |
| 8 | Dashboards and workspaces | SuperAdminWorkspace, 26+ workspace screens, 15+ aggregate RPCs. Readiness: 85/100 | Not yet discussed by owner |
| 9 | Reporting and analytics | governed reports RPC (dynamic supabase.rpc), 38 reports (Partial). Customer analytics: get_customer_card/products/brands (Operational) | Owner mentioned analytics vision (OWNER_VISION) but not specific reporting requirements or dashboard preferences |
| 10 | Target system | company_monthly_targets, employee_monthly_targets. targetService with bypasses. Readiness: Operational | Owner said Upper Management controls targets/weights but no details on target types, periods, calculation rules |
| 11 | Customer onboarding workflow | Two creation paths (managed + self-registration). No documented onboarding workflow | Owner not asked about: verification steps, document collection, welcome process, initial credit setup |
| 12 | Order snapshot system | orders.snapshot_items + snapshot_totals (JSONB) frozen at finalization. snapshot_owner_name/phone/address | Not yet discussed by owner |
| 13 | Preparation exceptions | preparation_exceptions table for handling missing/unavailable items during warehouse prep | Not yet discussed by owner |
| 14 | Treasury and cashbox | treasury_transactions + expenses tables exist (likely 0 rows). Listed as future module in owner principles | Owner said preserve + hide. No business rules defined |
| 15 | Code sequence system | code_sequences table for auto-generating operational codes | Not yet discussed by owner |
| 16 | System configuration | system_config table for system-level settings | Not yet discussed by owner |
| 17 | Employee activity tracking | employee_activity table (9465 rows) | Not yet discussed by owner |
| 18 | Multi-role support or single-role | employee_roles table is dead schema, employees.role_id is single-role | Open question exists in 02_ORGANIZATIONAL_MODEL.md. Owner has not answered |

---

## 4. POSSIBLE OWNER BLIND SPOTS

Items that appear important in the documented system but have not yet been clarified by the owner.

| # | Topic | Why It Matters | Documented Status |
|---|-------|---------------|-------------------|
| 1 | Self-registration path currently assigns to ياسر توفيق; no verification that these are real customers | Security and data quality risk. Anyone with a phone can register as a customer. No identity verification | register_customer RPC exists; no verification workflow documented |
| 2 | governed_approve_order exists but is never called — critical business logic (inventory deduction + credit invoice creation) never executes | Owner said inventory deducts at معتمد. This is the most impactful production blocker (B1/B2). Owner may not know the fix requires code change to OrderStatusManager.tsx:88 | 100% verified. governed_change_order_status handles ALL transitions at line 88 |
| 3 | governed_deny_order does not exist in any migration file | Owner defined 9 statuses (including ملغى) but rejection/denial process is undefined. Current rejection uses generic RPC with no denial-specific logic | 0 grep hits across 52 migration files |
| 4 | 20 governance bypasses violate owner's own PERMISSION_VISIBILITY_PRINCIPLE | Auctions (bypass), Daily Deals (bypass), Products (direct update), Companies (direct update), Employees (direct read) — all bypass auth/validation | 20 bypasses across 10 files. HIGH risk for 3 (auctions create/update, daily deals update) |
| 5 | 4 active dual SOTs (address, GPS, credit limit, credit days) with zero sync for 2 and one-directional sync for 1 | Owner wants SINGLE_SOURCE_OF_TRUTH_PRINCIPLE — the current state directly contradicts this principle | 3 RED dual SOTs documented in 16_RUNTIME_SOURCE_OF_TRUTH_MAP.md |
| 6 | 13 dead tables, 19 orphaned RPCs, 8 dead columns exist in the database | Owner's FUTURE_MODULE_PRESERVATION_PRINCIPLE says preserve planned modules. But dead assets like packages, package_items, package_orders, activity_log, sync_log may not be "planned future modules" — they may be truly abandoned code | 13 tables verified dead (0 code references). Owner has not weighed in on true dead assets vs preserved future modules |
| 7 | Customer creation dual path (managed vs self-registration) has different ownership rules | Owner defined both paths but not the business rules for when each path is appropriate. Who qualifies for managed? What prevents a customer from self-registering twice? | Two paths exist; no documented distinction rules |
| 8 | Credit reservation during order placement never executes (B5) | Owner defined credit limits (100k/300k). Without reservation, credit customers can exceed limits unchecked. Financial risk | governed_reserve_credit_for_order RPC exists but zero frontend call sites |
| 9 | Return creation has no UI (B3) | governed_create_return exists but cannot be used from any screen. RPC has been defined for hypothetical future use | 0 frontend call sites for governed_create_return |
| 10 | The term "Governed Operational Distribution Runtime" or system name is not defined by the owner | Owner may have a preferred name/identity for the system. All current names are analyst-created | No owner-defined system name in knowledge base |

---

## 5. FUTURE MODULES

Modules that exist in documentation/code but appear inactive, unfinished, hidden, or planned for later activation.

| # | Module | Evidence | Owner Status |
|---|--------|----------|-------------|
| 1 | Collections | collections table (existing data: 6 rows), governed_create_collection + governed_approve_collection operational. 06_COLLECTION_RULES.md = placeholder. Readiness: 70/100 | Owner listed as future module in FUTURE_MODULE_PRESERVATION_PRINCIPLE. Preserve + hide |
| 2 | Treasury / Cashbox | treasury_transactions + expenses tables. ActivityPage shows "coming in future updates". No governed RPCs | Owner listed as future module in FUTURE_MODULE_PRESERVATION_PRINCIPLE. Preserve + hide |
| 3 | Flash Offers | flash_offers + flash_offer_items tables (0 rows). flashOfferService exists. Flash Offer Manage workflow = Orphaned (no page integration). Readiness: untracked | Owner defined flash offers as time-limited packages. No activation timeline |
| 4 | Returns (UI missing) | governed_create_return RPC exists but 0 frontend callers. Returns Readiness: 40/100. B3 blocker | Not yet defined by owner. 07_RETURN_RULES.md = placeholder |
| 5 | Credit (partially built) | Payment UI exists (CreditManagementPage). Ledger, cheque, reservation, activation/suspension UIs missing. 6 of 9 credit service methods unused. 35/100 readiness | Owner defined two programs and activation requirements. Full UI not built |
| 6 | Daily Deals (partially built) | daily_deals table (0 rows). governed_create_daily_deal exists. Partial — mix of governed RPC + bypass. Readiness: partial | Owner defined daily deals as standalone packages. No activation timeline |
| 7 | Auctions (partially built) | 6-table design complete. Read + bid + participate workflows operational via RPC. Create/update = bypass. Ownership/approval flow not implemented | Owner defined participation flow but existing code has no request/approval mechanism |
| 8 | ActivityPage | Placeholder with "coming in future updates" message. Empty/near-empty page | Not yet discussed by owner |
| 9 | Packages system | packages, package_items, package_orders tables = dead (0 references). May be an abandoned feature | Not yet discussed by owner |

---

## 6. QUESTIONS FOR OWNER

High-value questions prioritizing missing business knowledge. Maximum 25.

### Order Lifecycle (3)

1. What is the business process for order rejection/denial? Should there be specific rejection reasons, and what follow-up actions are needed (customer notification, restocking, alternative offer)?
2. Should credit invoices be created automatically when an order is approved for credit customers? (Currently it does not happen — blocker B2.)
3. What does the status "مؤجل" (deferred/postponed) mean operationally? What triggers it? Who can set it? How does an order return from مؤجل to active flow?

### Returns (2)

4. What is the complete business process for returns? Who initiates a return (customer or rep)? What are valid return reasons? How is inventory restocked after a return?
5. Can a return be partial (only some items from an order)? Can a return reference an order that was never delivered?

### Collections (2)

6. What triggers a collection record? Is it created automatically on order delivery for credit customers, or manually when a rep collects payment?
7. What is the collections lifecycle? Does the system need aging rules, late payment alerts, escalation workflow?

### Pricing and Tiers (3)

8. How do daily deal discounts and tier discounts interact? Do they stack, or does whichever is greater apply? Same question for flash offers.
9. What is the default pricing mode when no tier is selected — base pricing with no discount, or some default tier?
10. Is the three-price model (carton, unit, wholesale) sufficient for all business needs, or are additional price types needed?

### Permissions and Roles (3)

11. What are the exact named roles in the system (beyond Sales Manager, Warehouse Manager, General Supervisor, Sales Representative)? What capabilities does each role have?
12. Can an employee hold multiple roles simultaneously, or is single-role the intended model?
13. Who has authority to create and manage daily deals and flash offers? Any employee? Manager only? Upper Management only?

### Customers (3)

14. What is the operational distinction between Direct Customer and Managed Customer? When is a customer created as Direct vs Managed?
15. What is the expected customer onboarding process after registration? Are there verification steps, document collection requirements, or a welcome workflow?
16. What happens to a customer's ownership when their assigned employee leaves the company or is terminated?

### Governance and Data (3)

17. Should the 20 governance bypasses (direct supabase.from() calls) be converted to governed RPCs as a priority, given the PERMISSION_VISIBILITY_PRINCIPLE?
18. The system has 4 dual sources of truth (addresses, GPS, credit limit, credit days). Should data migration to single SOT be prioritized to align with the SINGLE_SOURCE_OF_TRUTH_PRINCIPLE?
19. The database contains 13 tables with zero code references (dead tables). Should these be removed, or might they serve future purposes?

### Future Modules (2)

20. What is the priority order for activating future modules (collections, treasury/cashbox, flash offers, returns UI)? Which module should be built first?
21. Should flash offers be completed and activated, or is this feature deprioritized in favor of other modules?

### Vision and Strategy (3)

22. Is the long-term vision to keep the system B2B-only, or is there a future plan to support B2C or retail?
23. Should the storefront's "digital sales representative" behavior include AI-powered product recommendations, or rule-based suggestions configured by management?
24. What is the preferred name for this system? (Current analyst-created names: "Governed Operational Distribution Runtime", "Ahram Distribution System")
25. What is the acceptable timeframe for addressing production blockers B1 (inventory deduction) and B2 (credit invoices)? Are these blocking go-live or acceptable for current operations?

---

*End of OWNER_GAP_ANALYSIS.md*
