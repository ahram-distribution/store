-- =============================================================================
-- 20271202_remove_returns_module_rpcs.sql
--
-- Removes the sales Returns module from the Web application and retires the
-- Returns-only RPC surface that is no longer reachable from any caller.
--
-- WHAT IS REMOVED (Web)
--   src/pages/returns/{ReturnsPage,ReturnDetailPage,ReturnNewPage}.tsx
--   src/services/returns.ts
--   src/components/orders/OrderReturnsSection.tsx
--   Routes /returns, /returns/new, /returns/:id
--   Every navigation, launcher, dashboard tile and storefront entry point
--   OrderDetailView render + order-detail.utils timeline + UnifiedOrder.returns
--
-- WHAT IS REMOVED (Database)
--   The 8 functions below. Each was proven to have NO remaining caller:
--     - no PostgREST/RPC caller in src/ after src/services/returns.ts removal
--     - no other database function body references them
--     - no view, trigger or other pg_depend object references them
--   EXECUTE grants to anon/authenticated disappear with the functions, which
--   is intended: these were publicly exposed but unreachable.
--
-- WHAT IS DELIBERATELY RETAINED (do not "clean these up" later)
--
--   1. governed_approve_return(p_token uuid, p_return_id uuid)
--      EXPLICIT EXCEPTION - retained byte-for-byte unchanged, including its
--      known p_id/p_return_id argument mismatch with its former caller. It now
--      has no Web caller and is effectively orphaned, but removal was
--      explicitly out of scope for this migration. Any future removal is a
--      separate owner decision (see master tracker).
--
--   2. The four sales-Returns tables: returns, return_items,
--      return_inspection, return_status_history.
--      They are NOT Returns-isolated. 16 retained functions depend on them:
--
--        governed_approve_return              (UPDATE returns SET status)
--        get_unified_order                    (returns array in every order)
--        governed_delete_order                (DELETE returns WHERE order_id)
--        governed_supreme_delete_cancelled_order
--        governed_delete_employee_with_transfer (transfers + counts returns)
--        get_dashboard_management             (pending_returns KPI)
--        get_command_center_v2                (pending-returns tile)
--        get_governed_target_performance      (return_deduction, full_returns)
--        get_kpi_contributors, get_team_members_kpis
--        governed_deletion_* (7 functions)    (data deletion cascades)
--        sync_get_table_allowlist             (mobile sync allowlist)
--
--      Dropping the tables would break Orders deletion, employee transfer,
--      dashboards, KPI/target attainment, the Data Deletion Center and mobile
--      sync - all out of scope here. Tables are empty (0 rows) but emptiness
--      does not make a depended-on table safe to drop.
--
--   3. Name-similar functions that are NOT the Returns module. They operate on
--      delivery / orders / warehouse and never touch any returns table:
--        governed_return_delivery            (Delivery)
--        governed_return_journey             (Delivery)
--        governed_return_to_preparation      (Warehouse)
--        governed_return_order_for_revision  (Orders)
--        governed_return_deferred            (Orders)
--
--   4. purchase_returns / purchase_return_items / generate_purchase_return_number
--      Purchasing module (FK to suppliers), unrelated to sales Returns.
--
-- BACKWARD COMPATIBILITY
--   This migration only removes objects. Removing objects cannot break the
--   queries issued by code that no longer exists.
-- =============================================================================

BEGIN;

-- Helper first: referenced only by governed_create_return, dropped below.
DROP FUNCTION IF EXISTS public._return_qty_to_pieces(integer, text, integer);

-- Number generator: no callers anywhere (DB or Web).
DROP FUNCTION IF EXISTS public.generate_sales_return_number();

-- Read RPCs: sole consumer was src/services/returns.ts (get_governed_returns).
DROP FUNCTION IF EXISTS public.get_governed_returns(uuid);
DROP FUNCTION IF EXISTS public.get_governed_return(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_governed_return_items(uuid, uuid);

-- Write RPCs: sole consumer was src/services/returns.ts.
DROP FUNCTION IF EXISTS public.governed_create_return(uuid, uuid, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.governed_reject_return(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.governed_update_return(uuid, uuid, text);

-- NOTE: governed_approve_return is intentionally NOT dropped.
-- See the header block: explicit owner exception, retained unchanged.

COMMIT;