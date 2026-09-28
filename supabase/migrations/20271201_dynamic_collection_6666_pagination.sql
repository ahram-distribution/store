-- =============================================================================
-- Dynamic Collection 6666 ("وصل حديثًا" / Recently Available)
-- server-side pagination, search, count and governorate visibility
-- =============================================================================
--
-- WHY
-- ----
-- get_recently_available_products(p_token) had exactly ONE parameter and no
-- LIMIT/OFFSET, so opening Dynamic Collection 6666 downloaded the ENTIRE
-- result set in a single request, with no search, no count and no server-side
-- governorate filtering. StorefrontPage then derived its total from
-- data.length and applied search + geographic visibility entirely in the
-- browser on top of that full download.
--
-- That is the same "fetch everything, then page/filter client-side" pattern
-- that was removed from the other four screens. This adds a dedicated
-- governed, paginated path for the collection.
--
-- WHAT DOES NOT CHANGE
-- --------------------
-- The business rule for "recently available" is copied VERBATIM from
-- get_recently_available_products (20270801_fix_recently_available_out_of_stock.sql):
--     is_active = true
--     is_visible = true
--     is_out_of_stock = false
--     carton_price IS NOT NULL AND carton_price > 0
--     recently_available_at IS NOT NULL
--     recently_available_at >= now() - (recently_available_days || ' days')::interval
--     ORDER BY recently_available_at DESC
-- including the app.app_settings 'recently_available_days' lookup and its
-- 7-day fallback. Which products qualify is unchanged.
--
-- The projected row shape is also identical to the existing RPC, so
-- StorefrontPage's mapCatalogRows keeps working untouched.
--
-- WHAT IS NEW
-- -----------
--   p_governorate_id  server-side geographic visibility, using the SAME
--                     predicate as get_governed_products, so the redundant
--                     client-side pass can be removed without losing the rule
--   p_search          server-side search on product_name / legacy_code /
--                     company_name (same columns get_governed_products uses)
--   p_page/p_per_page  data mode is mandatory and returns only that page
--   p_count_only      authoritative server total
--
-- The old single-argument get_recently_available_products is left in place,
-- untouched, so the Desktop local DB and any other caller keep working.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_recently_available_products_paged(
  p_token text,
  p_governorate_id uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text,
  p_page integer DEFAULT NULL::integer,
  p_per_page integer DEFAULT NULL::integer,
  p_count_only boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_token uuid;
  v_days int;
  v_limit integer;
  v_offset integer;
  v_total bigint;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END;

  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END IF;

  -- Un-paginated data reads are refused so the full-collection download
  -- cannot be reintroduced (same guard as get_governed_bonus_products).
  IF NOT p_count_only AND (p_page IS NULL OR p_per_page IS NULL) THEN
    RETURN jsonb_build_object('error', 'PAGINATION_REQUIRED');
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_per_page, 20), 1), 200);
  v_offset := GREATEST(COALESCE(p_page, 1), 1) - 1;
  v_offset := v_offset * v_limit;

  -- Business rule: identical to get_recently_available_products.
  SELECT COALESCE((value #>> '{}')::int, 7) INTO v_days
  FROM app.app_settings
  WHERE key = 'recently_available_days';

  IF v_days IS NULL OR v_days < 1 THEN v_days := 7; END IF;

  IF p_count_only THEN
    SELECT count(*) INTO v_total
    FROM products p
    JOIN companies comp ON comp.id = p.company_id
    WHERE p.is_active = true
      AND p.is_visible = true
      AND p.is_out_of_stock = false
      AND (p.carton_price IS NOT NULL AND p.carton_price > 0)
      AND p.recently_available_at IS NOT NULL
      AND p.recently_available_at >= now() - (v_days || ' days')::interval
      AND (
        p_search IS NULL
        OR p.product_name ILIKE '%' || p_search || '%'
        OR p.legacy_code ILIKE '%' || p_search || '%'
        OR comp.company_name ILIKE '%' || p_search || '%'
      )
      AND (
        p_governorate_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM geographic_visibility_rules gvr
          WHERE gvr.is_active = true
            AND (gvr.product_ids @> ARRAY[p.id] OR gvr.company_ids @> ARRAY[p.company_id])
            AND (
                 gvr.scope = 'all'
              OR (gvr.scope = 'governorates' AND gvr.governorate_ids @> ARRAY[p_governorate_id])
              OR (
                   gvr.scope = 'sectors'
                   AND EXISTS (
                     SELECT 1 FROM sector_governorates sg
                     WHERE sg.governorate_id = p_governorate_id
                       AND gvr.sector_ids @> ARRAY[sg.sector_id]
                   )
                 )
            )
        )
      );
    RETURN jsonb_build_object('count', v_total);
  END IF;

  -- Deterministic ordering: recently_available_at DESC is the business order,
  -- with p.id as the tie-break so a page boundary can never duplicate or skip
  -- a row when several products share the same timestamp.
  WITH filtered AS (
    SELECT
      p.id,
      p.product_name,
      p.legacy_code,
      p.description,
      p.company_id,
      comp.company_name,
      p.is_active,
      p.is_visible,
      p.is_out_of_stock,
      p.image_url,
      p.carton_price,
      p.carton_quantity,
      p.piece_price,
      p.dozen_price,
      p.created_at,
      p.recently_available_at,
      row_number() OVER (ORDER BY p.recently_available_at DESC, p.id) AS ord
    FROM products p
    JOIN companies comp ON comp.id = p.company_id
    WHERE p.is_active = true
      AND p.is_visible = true
      AND p.is_out_of_stock = false
      AND (p.carton_price IS NOT NULL AND p.carton_price > 0)
      AND p.recently_available_at IS NOT NULL
      AND p.recently_available_at >= now() - (v_days || ' days')::interval
      AND (
        p_search IS NULL
        OR p.product_name ILIKE '%' || p_search || '%'
        OR p.legacy_code ILIKE '%' || p_search || '%'
        OR comp.company_name ILIKE '%' || p_search || '%'
      )
      AND (
        p_governorate_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM geographic_visibility_rules gvr
          WHERE gvr.is_active = true
            AND (gvr.product_ids @> ARRAY[p.id] OR gvr.company_ids @> ARRAY[p.company_id])
            AND (
                 gvr.scope = 'all'
              OR (gvr.scope = 'governorates' AND gvr.governorate_ids @> ARRAY[p_governorate_id])
              OR (
                   gvr.scope = 'sectors'
                   AND EXISTS (
                     SELECT 1 FROM sector_governorates sg
                     WHERE sg.governorate_id = p_governorate_id
                       AND gvr.sector_ids @> ARRAY[sg.sector_id]
                   )
                 )
            )
        )
      )
  )
  SELECT COALESCE(jsonb_agg(sub.data ORDER BY sub.ord), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', f.id,
      'product_name', f.product_name,
      'legacy_code', f.legacy_code,
      'description', f.description,
      'company_id', f.company_id,
      'company_name', f.company_name,
      'is_active', f.is_active,
      'is_visible', f.is_visible,
      'is_out_of_stock', f.is_out_of_stock,
      'image_url', f.image_url,
      'carton_price', f.carton_price,
      'carton_quantity', f.carton_quantity,
      'piece_price', f.piece_price,
      'dozen_price', f.dozen_price,
      'created_at', f.created_at,
      'recently_available_at', f.recently_available_at,
      'product_units', COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object('id', pu.id, 'unit_type', pu.unit_type, 'is_active', pu.is_active)
          ORDER BY pu.unit_type
        ) FROM product_units pu WHERE pu.product_id = f.id),
        '[]'::jsonb
      ),
      'inventory', (SELECT jsonb_build_object('quantity', inv.quantity) FROM inventory inv WHERE inv.product_id = f.id LIMIT 1)
    ) AS data,
    f.ord
    FROM filtered f
    WHERE f.ord > v_offset AND f.ord <= v_offset + v_limit
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_recently_available_products_paged(text, uuid, text, integer, integer, boolean) TO authenticated;

COMMENT ON FUNCTION public.get_recently_available_products_paged IS
  'Dynamic Collection 6666 (وصل حديثًا) — same recently-available business rule as get_recently_available_products, with mandatory server-side pagination, search, count and governorate visibility';

NOTIFY pgrst, 'reload schema';
