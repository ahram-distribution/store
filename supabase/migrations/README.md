# Database Migrations

Migration execution order:

| File | Phase | Tables |
|------|-------|--------|
| `000_schema.sql` | Placeholder | — |
| `20260531_phase1_identity_governance.sql` | Phase 1 | identities, employees, roles, capabilities, employee_roles, role_capabilities, employee_capabilities, code_sequences |
| `20260531_phase2_customers.sql` | Phase 2 | customers, customer_addresses, customer_contacts, customer_ownership_history, customer_credit_ledger |
| `20260531_phase3_customers.sql` | Phase 3 | companies, products, product_units, inventory |
| `20260531_phase4_customers.sql` | Phase 4 | tiers, tier_exceptions |
| `20260531_phase4b_tier_attributes.sql` | Phase 4b | ALTER tiers (discount_percent, minimum_order_amount, icon_url, color, is_visible, starts_at, ends_at, updated_at) |
| `20260531_phase5_orders.sql` | Phase 5 | orders, order_items, order_status_history, order_modification_history |
| `20260531_phase6_collections_treasury.sql` | Phase 6 | collections, treasury_transactions, expenses, employee_advances |
| `20260531_phase7_returns.sql` | Phase 7 | returns, return_items, return_inspection |
| `20260531_phase8_visits.sql` | Phase 8 | visits |
| `20260531_phase9_packages.sql` | Phase 9 | packages, package_items, package_orders |
| `20260531_phase10_auctions.sql` | Phase 10 | auctions, auction_participants, auction_bids, auction_awards |

Remaining work (deferred):
- RLS policies (Master Technical Blueprint)
- Seed data
- Authorization evaluation engine
- Index review and performance tuning
