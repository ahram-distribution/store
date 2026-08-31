-- ============================================================================
-- PRODUCTS — Bulk Stock + Carton Price Import (from Excel)
-- ----------------------------------------------------------------------------
-- governed_bulk_update_product_stock_price: applies a batch of product
-- updates ({code, cartons, carton_price}) matched by legacy_code, atomically
-- in ONE transaction (single network call, no N+1).
--
-- Reuses the application's authoritative business rules:
--   * Stock: SET/REPLACE semantics identical to governed_set_product_stock.
--     The Excel "carton" quantity is converted to pieces using the product's
--     existing carton_quantity (supports fractional cartons). No hard-coded
--     units-per-carton value is invented.
--   * Pricing: identical to governed_update_product_pricing — sets carton_price
--     and regenerates piece_price / dozen_price in the same statement.
--   * "نفذت الكمية" (out-of-stock): NOT invented here. The existing inventory
--     trigger trg_auto_out_of_stock_from_inventory (authoritative governed
--     model: is_active = true AND inventory.quantity <= 0 → products
--     is_out_of_stock = true, oos_source = 'inventory') fires automatically on
--     the stock writes below and sets the status for active products.
--
-- STOCK EXHAUSTION RULE:
--   The Excel file is treated as the COMPLETE CURRENT STOCK LIST. Therefore
--   any existing DB product whose legacy_code is absent from the Excel file is
--   considered not present in current stock:
--     - its inventory is zeroed (SET/REPLACE to 0)
--     - the inventory auto-OOS trigger marks it "نفذت الكمية"
--   Products are never created or deleted by this import. Absent products that
--   already have zero stock AND are already "نفذت الكمية" are skipped (no
--   unnecessary write) but still counted.
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
  v_absent_oos integer := 0;
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

  -- 3) STOCK EXHAUSTION: existing DB products whose legacy_code is absent from
  --    the Excel file are treated as not present in current stock → zeroed.
  IF v_had_codes THEN
    FOR v_abs IN
      SELECT
        p.id,
        p.legacy_code,
        p.is_active,
        p.is_out_of_stock,
        COALESCE(inv.quantity, 0) AS qty
      FROM public.products p
      LEFT JOIN public.inventory inv ON inv.product_id = p.id
      WHERE NOT (p.legacy_code = ANY(v_codes))
    LOOP
      v_absent_total := v_absent_total + 1;

      -- Active products represent "نفذت الكمية" after the batch.
      IF v_abs.is_active = true THEN
        v_absent_oos := v_absent_oos + 1;
      END IF;

      -- Skip unnecessary writes: already zero stock AND already out-of-stock.
      IF v_abs.qty > 0 OR v_abs.is_out_of_stock IS DISTINCT FROM true THEN
        -- Zero stock (SET/REPLACE). The inventory trigger auto-sets
        -- is_out_of_stock = true (oos_source 'inventory') for active products.
        INSERT INTO public.inventory (product_id, quantity, updated_at)
        VALUES (v_abs.id, 0, now())
        ON CONFLICT (product_id) DO UPDATE
        SET quantity = 0, updated_at = now();

        v_absent_zeroed := v_absent_zeroed + 1;
        v_absents := v_absents || jsonb_build_object(
          'code', v_abs.legacy_code,
          'zeroed', true,
          'status', CASE WHEN v_abs.is_active = true THEN 'نفذت الكمية' ELSE 'غير نشط' END
        );
      ELSE
        v_absent_skipped := v_absent_skipped + 1;
        v_absents := v_absents || jsonb_build_object(
          'code', v_abs.legacy_code,
          'zeroed', false,
          'status', 'نفذت الكمية'
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
    'absent_out_of_stock', v_absent_oos,
    'results', v_results,
    'absents', v_absents
  );
END;
$$;

COMMENT ON FUNCTION public.governed_bulk_update_product_stock_price IS
  'تحديث جماعي للمخزون (بالكراتين) وسعر الكرتونة لكل منتج مطابق بـ legacy_code، مع قواعد النفاد: منتجات القاعدة غير الموجودة في ملف Excel تُصفّر مخزونها وتصبح "نفذت الكمية" — كل ذلك في معاملة واحدة (لا يطبق جزئياً في حالة أي خطأ)';
