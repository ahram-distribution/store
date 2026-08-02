-- ============================================================================
-- PHASE A — PHYSICAL INVENTORY ENGINE (Frozen Business Contract)
-- ============================================================================
-- The Physical Inventory engine is the ONLY authority over warehouse stock:
--   • Cart blocks ONLY when requested quantity exceeds physical inventory.
--   • Inventory is deducted ONLY when an order enters Approved.
--   • Inventory is restored IMMEDIATELY whenever an Approved order leaves
--     Approved for ANY reason:
--         Approved → Submitted / Draft / Cancelled / Returned for Revision /
--                    Deleted / any other non-approved status (preparing,
--                    prepared, ready_for_dispatch, sent_to_delivery,
--                    dispatched, deferred, delivered, reviewing, stock_review).
--   • Reservation NEVER influences inventory (out of scope in this phase).
--
-- The earlier draft trigger only restored for a fixed status list
-- (draft/submitted/reviewing/returned_for_revision/stock_review/cancelled) and
-- missed every forward/other non-approved exit. This redefinition is
-- contract-complete: ANY exit from Approved triggers the restore, and the
-- exactly-once guard in governed_inventory_restore makes every call safe.
-- Idempotent: DROP + CREATE so it supersedes the draft in any apply order.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_restore_inventory_before_approved_order_exit ON public.orders;

DROP FUNCTION IF EXISTS public.restore_inventory_before_approved_order_exit();

CREATE OR REPLACE FUNCTION public.restore_inventory_before_approved_order_exit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Contract: restore whenever an Approved order leaves Approved for ANY reason.
  -- governed_inventory_restore's exactly-once guard (inventory_deducted_at)
  -- makes redundant calls no-ops, so overlapping RPC-level restores are safe.
  IF OLD.status = 'approved'
     AND NEW.status <> 'approved'
     AND OLD.inventory_deducted_at IS NOT NULL THEN
    PERFORM public.governed_inventory_restore(
      OLD.id,
      'ORDER_APPROVED_EXIT_RESTORE',
      'تمت إعادة الكمية لأن الطلب غادر حالة الاعتماد.'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_restore_inventory_before_approved_order_exit
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.restore_inventory_before_approved_order_exit();
