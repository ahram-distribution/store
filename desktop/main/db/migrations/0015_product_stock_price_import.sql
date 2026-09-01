-- ============================================================================
-- PRODUCTS — Bulk Stock + Carton Price Import (from Excel)
-- ----------------------------------------------------------------------------
-- governed_bulk_update_product_stock_price: applies a batch of product
-- updates ({code, cartons, carton_price}) matched by legacy_code, atomically
-- in ONE transaction (single network call, no N+1).
--
-- The Excel file represents the COMPLETE CURRENT PRODUCT STOCK STATE. The
-- import determines the final stock, the carton price AND the final product
-- status. Previous product status (hidden / out-of-stock / inactive) never
-- prevents the import from establishing the correct new status:
--
--   * quantity > 0 + valid (positive) price → stock = Excel pieces,
--     carton_price = Excel price, product status = "نشط"
--     (is_active=true, is_visible=true, is_out_of_stock=false, oos_source=NULL).
--     Applies even if the product was previously "مخفي" or "نفذت الكمية".
--   * quantity = 0 → stock = 0, product status = "نفذت الكمية".
--   * Product absent from the Excel code set → stock = 0, status = "مخفي"
--     (is_active=true, is_visible=false, is_out_of_stock=false, oos_source=NULL).
--
-- Active-status invariant: a product must NOT be "نشط" unless it has BOTH a
-- valid (positive) price AND stock > 0. A positive-quantity row whose carton
-- price is missing / non-positive is REJECTED (RAISE) — never silently given
-- an invented price, never set active.
--
-- Implementation notes (reusing the application's authoritative rules):
--   * Stock: SET/REPLACE semantics identical to governed_set_product_stock.
--     The Excel "carton" quantity is converted to pieces using the product's
--     existing carton_quantity (supports fractional cartons). No hard-coded
--     units-per-carton value is invented.
--   * Pricing: identical to governed_update_product_pricing — sets carton_price
--     and regenerates piece_price / dozen_price in the same statement.
--   * Status: set explicitly by this function (so hidden/inactive products are
--     covered too). The existing inventory trigger
--     trg_auto_out_of_stock_from_inventory still runs, but the explicit status
--     writes below are the final authority for these rows.
--
-- Atomicity: the whole batch (Excel updates + absent-product zeroing) is one
-- PL/pgSQL function (== one transaction). If any part fails the function
-- RAISEs -> the ENTIRE batch is rolled back (none applied / none zeroed).
--
-- Unknown Excel codes (no legacy_code match) are skipped and counted
-- (Unmatched), never created.
--
-- Performance: absent products are resolved in a single set-based SELECT and
-- zeroed with bulk upserts — no N+1 requests.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.governed_bulk_update_product_stock_price(
  p_token uuid,
  p_rows jsonb DEFAULT NULL,
  p_excel_codes jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_row record;
  v_product record;
  v_abs record;
  v_pieces integer;
  v_piece_price numeric;
  v_dozen_price numeric;
  v_num_rows integer;
  v_applied integer := 0;
  v_unmatched integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_codes text[] := '{}'::text[];
  v_had_codes boolean := false;
  v_absent_total integer := 0;
  v_absent_zeroed integer := 0;
  v_absent_skipped integer := 0;
  v_absents jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF NOT public.check_capability(p_token, 'products.manage') THEN
    RETURN jsonb_build_object('error', 'MISSING_CAPABILITY: products.manage');
  END IF;

  -- The batch is valid if it has Excel rows to apply OR an Excel code set that
  -- can drive the stock-exhaustion pass (or both).
  IF (p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0)
     AND (p_excel_codes IS NULL OR jsonb_typeof(p_excel_codes) <> 'array' OR jsonb_array_length(p_excel_codes) = 0)
  THEN
    RETURN jsonb_build_object('error', 'EMPTY_BATCH');
  END IF;

  v_num_rows := CASE WHEN p_rows IS NULL THEN 0 ELSE jsonb_array_length(p_rows) END;

  -- 1) Collect the complete set of normalized codes present in the Excel file
  --    (drives the absent-from-Excel detection below).
  IF p_excel_codes IS NOT NULL AND jsonb_typeof(p_excel_codes) = 'array' THEN
    SELECT ARRAY_AGG(t.v) INTO v_codes
    FROM (
      SELECT DISTINCT BTRIM(elem #>> '{}') AS v
      FROM jsonb_array_elements(p_excel_codes) AS elem
      WHERE BTRIM(elem #>> '{}') <> ''
    ) t;
    v_had_codes := v_codes IS NOT NULL AND array_length(v_codes, 1) > 0;
  END IF;

  -- 2) Apply matched Excel rows (stock + carton price), matched by legacy_code.
  IF p_rows IS NOT NULL AND jsonb_typeof(p_rows) = 'array' THEN
    FOR v_row IN
      SELECT
        BTRIM(COALESCE(elem->>'code', '')) AS code,
        (elem->>'cartons')::numeric AS cartons,
        (elem->>'carton_price')::numeric AS carton_price
      FROM jsonb_array_elements(p_rows) AS elem
    LOOP
      IF v_row.code = '' THEN
        CONTINUE;
      END IF;

      SELECT id, carton_quantity INTO v_product
      FROM public.products
      WHERE legacy_code = v_row.code
      LIMIT 1;

      IF NOT FOUND THEN
        v_unmatched := v_unmatched + 1;
        v_results := v_results || jsonb_build_object(
          'code', v_row.code, 'applied', false, 'reason', 'UNMATCHED'
        );
        CONTINUE;
      END IF;

      IF v_product.carton_quantity IS NULL OR v_product.carton_quantity <= 0 THEN
        RAISE EXCEPTION 'CARTON_QUANTITY_NOT_CONFIGURED: %', v_row.code;
      END IF;

      IF v_row.carton_price IS NULL OR v_row.carton_price < 0 THEN
        RAISE EXCEPTION 'INVALID_CARTON_PRICE: %', v_row.code;
      END IF;

      v_pieces := ROUND((v_row.cartons * v_product.carton_quantity)::numeric);

      -- Active-status invariant: positive stock may only become "نشط" with a
      -- strictly positive price. Nothing is invented here — the row is rejected.
      IF v_pieces > 0 AND v_row.carton_price <= 0 THEN
        RAISE EXCEPTION 'INVALID_CARTON_PRICE: %', v_row.code;
      END IF;

      INSERT INTO public.inventory (product_id, quantity, updated_at)
      VALUES (v_product.id, v_pieces, now())
      ON CONFLICT (product_id) DO UPDATE
      SET quantity = v_pieces, updated_at = now();

      v_piece_price := ROUND((v_row.carton_price / v_product.carton_quantity)::numeric, 2);
      v_dozen_price := ROUND((v_row.carton_price / v_product.carton_quantity * 12)::numeric, 2);

      UPDATE public.products
      SET carton_price = v_row.carton_price,
          piece_price = v_piece_price,
          dozen_price = v_dozen_price,
          updated_at = now()
      WHERE id = v_product.id;

      -- Excel decides the final status. Previous status does not matter.
      --   quantity > 0 (+ valid price) → "نشط" (hidden / out-of-stock cleared).
      --   quantity = 0 → "نفذت الكمية".
      IF v_pieces > 0 THEN
        UPDATE public.products
        SET is_active = true,
            is_visible = true,
            is_out_of_stock = false,
            oos_source = NULL,
            updated_at = now()
        WHERE id = v_product.id;
      ELSE
        UPDATE public.products
        SET is_active = true,
            is_visible = true,
            is_out_of_stock = true,
            oos_source = 'inventory',
            updated_at = now()
        WHERE id = v_product.id;
      END IF;

      v_applied := v_applied + 1;
      v_results := v_results || jsonb_build_object(
        'code', v_row.code,
        'applied', true,
        'product_id', v_product.id,
        'cartons', v_row.cartons,
        'quantity_pieces', v_pieces,
        'carton_price', v_row.carton_price,
        'piece_price', v_piece_price,
        'dozen_price', v_dozen_price
      );
    END LOOP;
  END IF;

  -- 3) ABSENT PRODUCTS: existing DB products whose legacy_code is absent from
  --    the Excel file are treated as not present in current stock → zeroed and
  --    hidden ("مخفي") regardless of previous status.
  IF v_had_codes THEN
    FOR v_abs IN
      SELECT
        p.id,
        p.legacy_code,
        p.is_visible,
        COALESCE(inv.quantity, 0) AS qty
      FROM public.products p
      LEFT JOIN public.inventory inv ON inv.product_id = p.id
      WHERE NOT (p.legacy_code = ANY(v_codes))
    LOOP
      v_absent_total := v_absent_total + 1;

      -- Skip unnecessary writes: already zero stock AND already hidden (مخفي).
      IF v_abs.qty > 0 OR v_abs.is_visible IS NOT DISTINCT FROM true THEN
        -- Zero stock (SET/REPLACE).
        INSERT INTO public.inventory (product_id, quantity, updated_at)
        VALUES (v_abs.id, 0, now())
        ON CONFLICT (product_id) DO UPDATE
        SET quantity = 0, updated_at = now();

        -- Hide the product: absent from Excel → no current stock → "مخفي".
        -- is_out_of_stock=false / oos_source=NULL keep the label "مخفي"
        -- (the auto-OOS trigger may set OOS state on the inventory write
        -- above; this explicit status write is the final authority).
        UPDATE public.products
        SET is_active = true,
            is_visible = false,
            is_out_of_stock = false,
            oos_source = NULL,
            updated_at = now()
        WHERE id = v_abs.id;

        v_absent_zeroed := v_absent_zeroed + 1;
        v_absents := v_absents || jsonb_build_object(
          'code', v_abs.legacy_code,
          'zeroed', true,
          'status', 'مخفي'
        );
      ELSE
        v_absent_skipped := v_absent_skipped + 1;
        v_absents := v_absents || jsonb_build_object(
          'code', v_abs.legacy_code,
          'zeroed', false,
          'status', 'مخفي'
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'total', v_num_rows,
    'applied', v_applied,
    'unmatched', v_unmatched,
    'excel_codes', CASE WHEN v_had_codes THEN array_length(v_codes, 1) ELSE 0 END,
    'absent_total', v_absent_total,
    'absent_zeroed', v_absent_zeroed,
    'absent_skipped', v_absent_skipped,
    'results', v_results,
    'absents', v_absents
  );
END;
$$;

COMMENT ON FUNCTION public.governed_bulk_update_product_stock_price IS
  'تحديث جماعي للمخزون (بالكراتين) وسعر الكرتونة لكل منتج مطابق بـ legacy_code. Excel هو الحالة الكاملة الحالية للمخزون: كمية>0 مع سعر صحيح → المنتج "نشط" (حتى لو كان مخفياً/نفذت الكمية)؛ كمية=0 → "نفذت الكمية"؛ منتجات القاعدة غير الموجودة في الملف تُصفّر مخزونها وتصبح "مخفي" — كل ذلك في معاملة واحدة (لا يطبق جزئياً في حالة أي خطأ)';

-- ============================================================================
-- END
-- ============================================================================