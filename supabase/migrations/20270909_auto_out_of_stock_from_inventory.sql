-- ============================================================================
-- AUTO "نفذت الكمية" FROM INVENTORY — 20270909
--
-- Business rule (approved):
--   is_active = true  +  inventory.quantity <= 0
--     → products.is_out_of_stock = true, products.oos_source = 'inventory'
--
--   inventory quantity returns to quantity > 0
--     → products.is_out_of_stock = false
--       ONLY when products.oos_source = 'inventory'
--       (manual/other-source OOS is never auto-cleared)
--
-- Implementation: ONE trigger on public.inventory covering
--   INSERT / UPDATE OF quantity / DELETE.
-- products.is_active is NEVER modified; inactive products are untouched.
-- No change to deduction logic, negative-selling policy, or any status.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_auto_out_of_stock_from_inventory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- INSERT / UPDATE: quantity <= 0 → automatic OOS flagged as 'inventory' source.
  -- quantity > 0 → auto-clear ONLY when the current OOS came from inventory.
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.quantity <= 0 THEN
      UPDATE public.products
      SET is_out_of_stock = true,
          oos_source = 'inventory',
          updated_at = now()
      WHERE id = NEW.product_id
        AND is_active = true
        AND (is_out_of_stock IS DISTINCT FROM true
             OR oos_source IS DISTINCT FROM 'inventory');
    ELSE
      UPDATE public.products
      SET is_out_of_stock = false,
          updated_at = now()
      WHERE id = NEW.product_id
        AND is_active = true
        AND oos_source = 'inventory'
        AND is_out_of_stock IS DISTINCT FROM false;
    END IF;
  END IF;

  -- DELETE: inventory row removed → no stock → automatic OOS.
  IF TG_OP = 'DELETE' THEN
    UPDATE public.products
    SET is_out_of_stock = true,
        oos_source = 'inventory',
        updated_at = now()
    WHERE id = OLD.product_id
      AND is_active = true
      AND (is_out_of_stock IS DISTINCT FROM true
           OR oos_source IS DISTINCT FROM 'inventory');
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.trg_auto_out_of_stock_from_inventory IS
  'تلقائي: مخزون <= 0 مع منتج نشط → نفذت الكمية (المصدر inventory). عودة المخزون إلى موجب → إلغاء نفاد الكمية فقط إذا كان مصدرها inventory. لا يمسح حالة يدوية (oos_source <> inventory).';

DROP TRIGGER IF EXISTS trg_auto_out_of_stock_inventory ON public.inventory;

CREATE TRIGGER trg_auto_out_of_stock_inventory
  AFTER INSERT OR UPDATE OF quantity OR DELETE ON public.inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_auto_out_of_stock_from_inventory();

-- ============================================================================
-- END
-- ============================================================================