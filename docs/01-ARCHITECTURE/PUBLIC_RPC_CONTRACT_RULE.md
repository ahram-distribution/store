# Public RPC Contract Rule — Architectural Decision Record

## Status

**Adopted: 2026-07-06** · Enforced from migration `20270101_fix_get_unified_order_contract.sql`

---

## The Rule

Any RPC exposed through PostgREST (i.e., called from the Frontend via `supabase.rpc()`) **must** accept:

```sql
p_token text
```

**NOT** `p_token uuid`.

### Why

PostgREST sends all parameters as JSON strings (`text`). When a function expects `p_token uuid`, PostgREST either:

- Fails with `404 "Could not find the function"` if it cannot resolve overloads
- Fails with `400` if the type cast is ambiguous

This was documented in migration `20260626_unify_p_token_text_contract.sql`:

> PostgREST يُرسل جميع الباراميترات كنصوص (JSON → text)
> الدوال التي تنتظر p_token uuid كانت تسبب 404/400

### The Pattern

```sql
CREATE OR REPLACE FUNCTION public.some_rpc(
  p_token text,      -- Public API: text from PostgREST
  p_other_params ...
)
RETURNS jsonb AS $$
DECLARE
  v_token uuid := p_token::uuid;   -- Boundary: cast ONCE
  ...
BEGIN
  -- Internal logic uses v_token (uuid) everywhere
  SELECT * INTO v_session FROM app.sessions WHERE token = v_token;
  v_visible := get_visible_employee_ids(v_token);
  ...
END;
$$;
```

### What is Prohibited

```sql
-- 🔴 PROHIBITED — p_token uuid directly in Public API
CREATE OR REPLACE FUNCTION public.some_rpc(p_token uuid, ...)

-- 🔴 PROHIBITED — scattered casts inside the body
WHERE token = p_token::uuid    -- cast at call site, not at boundary
```

---

## Technical Debt Register

As of `20270101_fix_get_unified_order_contract.sql`, the following RPCs violate the rule. They are **not** to be fixed in bulk. Instead, each RPC **must** be corrected when it is next modified for any other reason (incremental cleanup).

### Category A: `p_token uuid` Only (105 RPCs)

These have **no** `text` overload at all. Their latest definition uses `(p_token uuid)`:

| Function | Latest Migration |
|---|---|
| `delete_module` | `20260720_unify_upper_management_role.sql` |
| `get_alerts` | `20260719_fix_attendance_rpc_scoping.sql` |
| `get_all_capabilities` | `20260609_employee_reality_gap_closure.sql` |
| `get_attendance_analysis` | `20260617_fix_e_dot_name_to_full_name.sql` |
| `get_auto_closed_sessions_month` | `20260617_fix_e_dot_name_to_full_name.sql` |
| `get_auto_closed_sessions_today` | `20260617_fix_e_dot_name_to_full_name.sql` |
| `get_collection_followup_queue` | `20260720_unify_upper_management_role.sql` |
| `get_command_center` | `20260720_unify_upper_management_role.sql` |
| `get_command_center_v2` | `20260720_unify_upper_management_role.sql` |
| `get_company_profile` | `20260607_recovery_missing_functions.sql` |
| `get_completed_workdays_history` | `20261001_f2_canonical_kpi_unification.sql` |
| `get_coverage_map` | `20260801_phase_a_tracking_fix.sql` |
| `get_credit_dashboard_stats` | `20260720_unify_upper_management_role.sql` |
| `get_customer_analytics_list` | `20260720_unify_upper_management_role.sql` |
| `get_customer_brands` | `20260720_unify_upper_management_role.sql` |
| `get_customer_card` | `20260720_unify_upper_management_role.sql` |
| `get_customer_products` | `20260720_unify_upper_management_role.sql` |
| `get_customer_sales_ranking` | `20260720_unify_upper_management_role.sql` |
| `get_dashboard_sales` | `20261001_f2_canonical_kpi_unification.sql` |
| `get_dashboard_transport` | `20260720_unify_upper_management_role.sql` |
| `get_dashboard_warehouse` | `20260720_unify_upper_management_role.sql` |
| `get_delivery_dashboard_stats` | `20260720_unify_upper_management_role.sql` |
| `get_employee_capabilities` | `20260609_employee_reality_gap_closure.sql` |
| `get_employee_current_location` | `20260720_unify_upper_management_role.sql` |
| `get_employee_day_map` | `20260722_fix_attendance_rpcs_visibility.sql` |
| `get_employee_day_timeline` | `20260722_fix_attendance_rpcs_visibility.sql` |
| `get_employee_detail_data` | `20261231_fix_kpi_detail_add_uuids.sql` |
| `get_employee_workday_history` | `20260802_phase_c_followup_schedule_type_rpcs.sql` |
| `get_governed_active_daily_deals` | `20260603_daily_deals.sql` |
| `get_governed_active_employees` | `20260720_unify_upper_management_role.sql` |
| `get_governed_active_flash_offers` | `20260603_flash_offers.sql` |
| `get_governed_auctions` | `20260603_auction_v2.sql` |
| `get_governed_collections` | `20260720_unify_upper_management_role.sql` |
| `get_governed_companies` | `20260608_schema_alignment.sql` |
| `get_governed_credit_application` | `20260720_unify_upper_management_role.sql` |
| `get_governed_credit_applications` | `20260720_unify_upper_management_role.sql` |
| `get_governed_credit_dashboard` | `20260604_credit_programs_v2.sql` |
| `get_governed_customer_addresses` | `20260720_unify_upper_management_role.sql` |
| `get_governed_customer_contacts` | `20260720_unify_upper_management_role.sql` |
| `get_governed_customer_credit_account` | `20260604_credit_programs_v2.sql` |
| `get_governed_daily_deals` | `20260603_daily_deals.sql` |
| `get_governed_deliveries` | `20260720_unify_upper_management_role.sql` |
| `get_governed_employee` | `20260608_get_governed_employee_address.sql` |
| `get_governed_employees` | `20260618_fix_governance_leak.sql` |
| `get_governed_executive_kpis` | `20260805_executive_workspace.sql` |
| `get_governed_external_carriers` | `20260805_executive_workspace.sql` |
| `get_governed_flash_offers` | `20260603_flash_offers.sql` |
| `get_governed_order` | `20260720_unify_upper_management_role.sql` |
| `get_governed_preparation_queue` | `20260720_unify_upper_management_role.sql` |
| `get_governed_return` | `20260720_unify_upper_management_role.sql` |
| `get_governed_return_items` | `20260720_unify_upper_management_role.sql` |
| `get_governed_returns` | `20260720_unify_upper_management_role.sql` |
| `get_governed_target_performance` | `20261231_fix_weights_canonical_source.sql` |
| `get_governed_tiers` | `20260603_tier_system.sql` |
| `get_governed_visit` | `20260720_unify_upper_management_role.sql` |
| `get_governed_visits` | `20260720_unify_upper_management_role.sql` |
| `get_governed_waiting_preparations` | `20260720_unify_upper_management_role.sql` |
| `get_live_activity_center` | `20260618_live_activity_center_v2.sql` |
| `get_module_detail` | `20260720_unify_upper_management_role.sql` |
| `get_my_work_policy` | `20260630_work_policies_phase1.sql` |
| `get_my_workday_status` | `20260802_phase_c_followup_schedule_type_rpcs.sql` |
| `get_sales_manager_cc` | `20261001_f2_canonical_kpi_unification.sql` |
| `get_team_map` | `20260801_phase_a_tracking_fix.sql` |
| `get_unified_orders` | `20260729_orders_unification_phase2.sql` |
| `get_upper_management_dashboard` | `20261001_f2_canonical_kpi_unification.sql` |
| `get_visible_customer_ids` | `20260720_unify_upper_management_role.sql` |
| `get_visible_employees` | `20260720_unify_upper_management_role.sql` |
| `get_warehouse_analytics` | `20260720_unify_upper_management_role.sql` |
| `get_work_policies_report` | `20260720_unify_upper_management_role.sql` |
| `get_workday_cleanup_log` | `20260720_unify_upper_management_role.sql` |
| `get_workday_report` | `20260617_fix_e_dot_name_to_full_name.sql` |
| `get_workday_settings` | `20260720_unify_upper_management_role.sql` |
| `governed_approve_credit` | `20260607_recovery_missing_functions.sql` |
| `governed_approve_return` | `20260720_unify_upper_management_role.sql` |
| `governed_assign_delivery` | `20260607_recovery_missing_functions.sql` |
| `governed_cancel_preparation` | `20260607_recovery_missing_functions.sql` |
| `governed_check_order_over_limit` | `20260623_credit_lifecycle_wiring.sql` |
| `governed_complete_preparation` | `20260610_fix_order_status_history_check.sql` |
| `governed_confirm_documents` | `20260607_recovery_missing_functions.sql` |
| `governed_create_credit_application` | `20260607_recovery_missing_functions.sql` |
| `governed_create_credit_program` | `20260607_recovery_missing_functions.sql` |
| `governed_create_return` | `20260607_recovery_missing_functions.sql` |
| `governed_create_visit` | `20260607_recovery_missing_functions.sql` |
| `governed_delete_collection` | `20260607_recovery_missing_functions.sql` |
| `governed_delete_customer` | `20260607_recovery_missing_functions.sql` |
| `governed_delete_order` | `20260623_credit_lifecycle_wiring.sql` |
| `governed_dispatch_decision` | `20260720_unify_upper_management_role.sql` |
| `governed_fail_preparation` | `20260610_fix_order_status_history_check.sql` |
| `governed_get_contract_by_application` | `20260607_recovery_missing_functions.sql` |
| `governed_get_contract_template` | `20260607_recovery_missing_functions.sql` |
| `governed_get_credit_programs` | `20260607_recovery_missing_functions.sql` |
| `governed_global_search` | `20260720_unify_upper_management_role.sql` |
| `governed_reactivate_credit` | `20260607_recovery_missing_functions.sql` |
| `governed_record_exception` | `20260607_recovery_missing_functions.sql` |
| `governed_reject_credit` | `20260607_recovery_missing_functions.sql` |
| `governed_reject_return` | `20260720_unify_upper_management_role.sql` |
| `governed_reopen_cancelled` | `20260720_unify_upper_management_role.sql` |
| `governed_replace_order_contents` | `20260801_fix_order_creation_capability.sql` |
| `governed_return_to_preparation` | `20260720_unify_upper_management_role.sql` |
| `governed_review_credit` | `20260607_recovery_missing_functions.sql` |
| `governed_sign_contract` | `20260607_recovery_missing_functions.sql` |
| `governed_start_preparation` | `20260610_fix_order_status_history_check.sql` |
| `governed_submit_credit_application` | `20260607_recovery_missing_functions.sql` |
| `governed_suspend_credit` | `20260607_recovery_missing_functions.sql` |
| `governed_toggle_credit_program` | `20260607_recovery_missing_functions.sql` |
| `governed_update_company_profile` | `20260607_recovery_missing_functions.sql` |
| `governed_update_contract_template` | `20260607_recovery_missing_functions.sql` |
| `governed_update_credit_program` | `20260607_recovery_missing_functions.sql` |
| `governed_update_return` | `20260607_recovery_missing_functions.sql` |
| `list_employees_without_policies` | `20260630_work_policies_phase1.sql` |
| `list_work_policies` | `20260630_work_policies_phase1.sql` |
| `logout` | `20260607_recovery_missing_functions.sql` |
| `test_report` | `20260617_fix_e_dot_name_to_full_name.sql` |
| `test_rpc` | `20260607_recovery_missing_functions.sql` |
| `update_module_owner_field` | `20260720_unify_upper_management_role.sql` |
| `update_workday_settings` | `20260720_unify_upper_management_role.sql` |
| `validate_session` | `20260607_recovery_missing_functions.sql` |

### Category B: Both Overloads Exist (13 RPCs)

These have a `(text)` AND a `(uuid)` overload simultaneously, causing PostgREST ambiguity:

| Function | Latest `uuid` Def | Latest `text` Def |
|---|---|---|
| `check_capability` | `20260706_role_normalization.sql` | `20260625_fix_check_capability_overload.sql` |
| `get_dashboard_management` | `20261001_f2_canonical_kpi_unification.sql` | `20260626_unify_p_token_text_contract.sql` |
| `get_live_workday_overview` | `20260802_phase_c_followup_schedule_type_rpcs.sql` | `20260626_fix_remaining_p_token_text.sql` |
| `get_unified_order` | `20260730_phase3_order_revision_system.sql` | **FIXED** in `20270101_fix_get_unified_order_contract.sql` |
| `get_visible_employee_ids` | `20260720_unify_upper_management_role.sql` | `20260626_fix_remaining_p_token_text.sql` |
| `governed_complete_delivery` | `20260623_credit_lifecycle_wiring.sql` | `20260626_unify_p_token_text_contract.sql` |
| `governed_fail_delivery` | `20260607_recovery_missing_functions.sql` | `20260626_unify_p_token_text_contract.sql` |
| `governed_get_delivery` | `20260607_recovery_missing_functions.sql` | `20260626_unify_p_token_text_contract.sql` |
| `governed_reject_order` | `20260623_credit_lifecycle_wiring.sql` | `20260626_fix_check_capability_uuid_wrapper.sql` |
| `governed_return_delivery` | `20260607_recovery_missing_functions.sql` | `20260626_unify_p_token_text_contract.sql` |
| `governed_return_order_for_revision` | `20260807_fix_order_modification_history_contract.sql` | `20260626_fix_check_capability_uuid_wrapper.sql` |
| `governed_start_delivery` | `20260607_recovery_missing_functions.sql` | `20260626_unify_p_token_text_contract.sql` |
| `governed_submit_order` | `20260801_fix_order_creation_capability.sql` | `20260626_fix_check_capability_uuid_wrapper.sql` |

---

## The Origin of the Problem

| Date | Migration | What Happened |
|---|---|---|
| 2026-06-26 | `unify_p_token_text_contract.sql` | ✅ Unified all order RPCs to `p_token text` |
| 2026-06-26 | `fix_remaining_p_token_text.sql` | ✅ Fixed `get_visible_employee_ids` + more |
| 2026-07-06 | `role_normalization.sql` | 🔴 Reverted `check_capability` + `get_visible_employee_ids` to `uuid` |
| 2026-07-20 | `unify_upper_management_role.sql` | 🔴 Reverted **75+ RPCs** to `uuid` (overwrote the text contract) |
| 2026-07-29 | `orders_unification_phase1.sql` | 🔴 Reverted `get_unified_order` + `get_unified_orders` to `uuid` |
| 2026-07-30 | `phase3_order_revision_system.sql` | 🔴 Reverted `get_unified_order` to `uuid` again |
| 2026-08-01 | `fix_order_creation_capability.sql` | 🔴 Reverted `governed_submit_order` to `uuid` |
| 2026-08-07 | `fix_order_modification_history_contract.sql` | 🔴 Reverted `governed_return_order_for_revision` to `uuid` |

All later migrations that used `CREATE OR REPLACE FUNCTION ... (p_token uuid, ...)` created **new overloads** instead of replacing the `text` version, because `(uuid)` and `(text)` are different parameter types in PostgreSQL.

---

## Cleanup Strategy

1. **`20270101_fix_get_unified_order_contract.sql`** — First fix (this migration)
2. **Incremental cleanup** — Each RPC in the registers above is corrected when it is next modified for any other reason
3. **Gate** — No new RPC may be created with `p_token uuid`; code review must enforce this
4. **Verification** — After each fix, run a scan to confirm no `p_token uuid` definitions remain
