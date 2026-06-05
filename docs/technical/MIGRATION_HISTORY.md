# MIGRATION HISTORY — Ahram Distribution

**Last updated:** 2026-06-05  
**Full history:** PROJECT_CHANGELOG.md  

---

## Applicable by Order

When deploying to a new Supabase project, apply migrations in this order (alphabetical by filename):

```
### Phase 1: Foundation
000_schema.sql                          # Placeholder
20260531_phase1_identity_governance.sql # Identities, employees, roles, capabilities
20260531_phase2_customers.sql           # Customers, addresses, contacts, ledger
20260531_phase3_customers.sql           # Companies, products, units, inventory
20260531_phase3b_flexible_units.sql     # Flexible unit enhancements
20260531_phase4_customers.sql           # Tiers, tier exceptions
20260531_phase4b_tier_attributes.sql    # Tier attribute enhancements
20260531_phase5_orders.sql              # Orders, order items, status history
20260531_phase6_collections_treasury.sql# Collections, treasury, expenses, advances
20260531_phase7_returns.sql             # Returns, return items, inspections
20260531_phase8_visits.sql              # Visits
20260531_phase9_packages.sql            # Package deals (legacy)
20260531_phase10_auctions.sql           # Auctions V1 (legacy)

### Phase 2: Operational Completion
20260602_p1_operational_completion.sql  # Order approval, collection governance
20260602_p2_runtime_usability_fixes.sql # Order defer/cancel/dispatch/reopen
20260602_register_customer.sql          # Customer registration RPC
20260602_runtime_screen_completion.sql  # Employee management, visit/customer governance

### Phase 3: Deals, Tiers, Auctions V2
20260603_auction_v2.sql                 # Auction V2 tables + RPCs + realtime
20260603_auction_v2_seed.sql            # Auction V2 seed data
20260603_daily_deals.sql                # Daily deals tables + RPCs
20260603_flash_offers.sql               # Flash offers tables + RPCs
20260603_tier_enforcement.sql           # Tier pricing enforcement in orders
20260603_tier_system.sql                # Tier system management RPCs

### RECOVERY: Missing base tables (runs before credit V2)
20260603_recovery_missing_tables.sql    # app.sessions, credit_programs, etc.

### Phase 4: Identity, Credit, Governance
20260604_credit_programs_v2.sql         # Credit V2 accounts, invoices, cheques
20260604_governance_rpcs.sql            # Product/contact/address/dashboard RPCs
20260604_tier_runtime_remediation.sql   # Tier enforcement fixes
20260604_unified_identity_location.sql  # Location system, identity consolidation

### Phase 5: Customer Ownership Fixes
20260605_customer_direct_ownership.sql  # Customer ownership refinements

### Phase 6: Visibility Fixes
20260606_customer_visibility_fix.sql    # Customer visibility corrections

### RECOVERY: Missing functions
20260607_recovery_missing_functions.sql # 92 functions restored from live DB
```

## Migration Stats

| Metric | Value |
|---|---|
| Total files | 32 |
| Recovery files | 2 (tables + functions) |
| Tables created | ~57 public + 1 app |
| Types created | 14 enums |
| Functions created | 205+ (public) + 9 (app) |
| Total SQL lines | ~8,500 |
| Largest file | `20260602_runtime_screen_completion.sql` (1,668 lines) |
| Smallest | `000_schema.sql` (10 lines) |
