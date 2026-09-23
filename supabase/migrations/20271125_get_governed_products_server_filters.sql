-- ----------------------------------------------------------------------------
-- get_governed_products — SERVER-SIDE FILTERS / PAGINATION EXTENSION
--
-- Extends the canonical single-overload (text token) get_governed_products with
-- additive DEFAULT params so Web screens paginate/search/filter server-side
-- instead of downloading the full governed catalog (1,411 rows / ~2.6 MB).
--
-- New params (all DEFAULT; existing callers unaffected):
--   p_ids uuid[]                targeted rows by id (cart/tier refresh, order
--                               edit & restore) — independent of active/visible
--   p_governorate_id uuid       exclude geo-hidden products for a governorate
--   p_sector_id uuid            exclude geo-hidden products for a sector
--   p_inactive_only             !is_active OR !is_visible
--   p_out_of_stock_only         is_out_of_stock = true AND is_active = true
--   p_exclude_out_of_stock      exclude is_out_of_stock = true
--   p_active_status_only        is_active = true AND is_visible = true AND
--                               is_out_of_stock IS NOT TRUE  (admin "active")
--   p_no_price                  carton_price IS NULL OR <= 0
--   p_no_image                  image_url IS NULL OR ''
--   p_no_stock                  no inventory row with quantity > 0
--
-- IMPORTANT: MUST stay a single overload. The uuid-token overload previously
-- caused PostgREST ambiguity errors (PGRST203); we keep ONE text-token function
-- and extend it in place. The geo-visibility exclusion mirrors
-- get_geographic_visibility_hidden_products (_for_sector) exactly.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  -- Guarantee ONE canonical overload: drop EVERY existing get_governed_products
  -- signature (uuid-token legacy AND any earlier text-token variant such as the
  -- 8-arg one). CREATE OR REPLACE alone cannot merge a different arity, so any
  -- leftover overload would trigger PostgREST PGRST203 ambiguity again.
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_governed_products'
  LOOP
    EXECUTE format('DROP FUNCTION public.%s', r.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_governed_products(
  p_token text,
  p_active_only boolean DEFAULT false,
  p_visible_only boolean DEFAULT false,
  p_search text DEFAULT NULL::text,
  p_company_id uuid DEFAULT NULL::uuid,
  p_count_only boolean DEFAULT false,
  p_page integer DEFAULT NULL::integer,
  p_per_page integer DEFAULT NULL::integer,
  p_ids uuid[] DEFAULT NULL::uuid[],
  p_governorate_id uuid DEFAULT NULL::uuid,
  p_sector_id uuid DEFAULT NULL::uuid,
  p_inactive_only boolean DEFAULT false,
  p_out_of_stock_only boolean DEFAULT false,
  p_exclude_out_of_stock boolean DEFAULT false,
  p_active_status_only boolean DEFAULT false,
  p_no_price boolean DEFAULT false,
  p_no_image boolean DEFAULT false,
  p_no_stock boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_offset integer;
  v_limit integer;
  v_token uuid;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END;

  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF p_count_only THEN
    SELECT jsonb_build_object('count', COUNT(*)) INTO v_result
    FROM products p
    WHERE (NOT p_active_only OR p.is_active = true)
      AND (NOT p_visible_only OR p.is_visible = true)
      AND (NOT p_active_only OR (p.carton_price IS NOT NULL AND p.carton_price > 0))
      AND (
        p_search IS NULL
        OR p.product_name ILIKE '%' || p_search || '%'
        OR p.legacy_code ILIKE '%' || p_search || '%'
        OR EXISTS (
          SELECT 1 FROM companies c
          WHERE c.id = p.company_id AND c.company_name ILIKE '%' || p_search || '%'
        )
      )
      AND (p_company_id IS NULL OR p.company_id = p_company_id)
      AND (p_ids IS NULL OR p.id = ANY(p_ids))
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
      AND (
        p_sector_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM geographic_visibility_rules gvr
          WHERE gvr.is_active = true
            AND (gvr.product_ids @> ARRAY[p.id] OR gvr.company_ids @> ARRAY[p.company_id])
            AND (
                 gvr.scope = 'all'
              OR (gvr.scope = 'sectors' AND gvr.sector_ids @> ARRAY[p_sector_id])
              OR (
                   gvr.scope = 'governorates'
                   AND EXISTS (
                     SELECT 1 FROM sector_governorates sg
                     WHERE sg.sector_id = p_sector_id
                       AND gvr.governorate_ids @> ARRAY[sg.governorate_id]
                   )
                 )
            )
        )
      )
      AND (NOT p_inactive_only OR (p.is_active = false OR p.is_visible = false))
      AND (NOT p_out_of_stock_only OR (p.is_out_of_stock = true AND p.is_active = true))
      AND (NOT p_exclude_out_of_stock OR (NOT COALESCE(p.is_out_of_stock, false)))
      AND (NOT p_active_status_only OR (p.is_active = true AND p.is_visible = true AND NOT COALESCE(p.is_out_of_stock, false)))
      AND (NOT p_no_price OR (p.carton_price IS NULL OR p.carton_price <= 0))
      AND (NOT p_no_image OR (p.image_url IS NULL OR p.image_url = ''))
      AND (
        NOT p_no_stock
        OR NOT EXISTS (SELECT 1 FROM inventory i WHERE i.product_id = p.id AND i.quantity > 0)
      );
    RETURN v_result;
  END IF;

  v_limit := COALESCE(p_per_page, 1000000);
  v_offset := COALESCE((p_page - 1) * v_limit, 0);

  SELECT jsonb_agg(sub.data)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', p.id,
      'product_name', p.product_name,
      'legacy_code', p.legacy_code,
      'description', p.description,
      'company_id', p.company_id,
      'company_name', comp.company_name,
      'company_legacy_code', comp.legacy_code,
      'company_bonus_enabled', comp.bonus_enabled,
      'bonus_enabled', p.bonus_enabled,
      'is_active', p.is_active,
      'is_visible', p.is_visible,
      'is_out_of_stock', p.is_out_of_stock,
      'image_url', p.image_url,
      'carton_price', p.carton_price,
      'carton_quantity', p.carton_quantity,
      'piece_price', p.piece_price,
      'dozen_price', p.dozen_price,
      'recently_available_at', p.recently_available_at,
      'created_at', p.created_at,
      'negative_selling_allowed', p.negative_selling_allowed,
      'inventory_deduction_status', p.inventory_deduction_status,
      'oos_source', p.oos_source,
      'product_units', COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object('id', pu.id, 'unit_type', pu.unit_type, 'is_active', pu.is_active)
          ORDER BY pu.unit_type
        ) FROM product_units pu WHERE pu.product_id = p.id),
        '[]'::jsonb
      ),
      'inventory', (SELECT jsonb_build_object('quantity', inv.quantity) FROM inventory inv WHERE inv.product_id = p.id LIMIT 1)
    ) AS data
    FROM products p
    JOIN companies comp ON comp.id = p.company_id
    WHERE (NOT p_active_only OR p.is_active = true)
      AND (NOT p_visible_only OR p.is_visible = true)
      AND (NOT p_active_only OR (p.carton_price IS NOT NULL AND p.carton_price > 0))
      AND (
        p_search IS NULL
        OR p.product_name ILIKE '%' || p_search || '%'
        OR p.legacy_code ILIKE '%' || p_search || '%'
        OR comp.company_name ILIKE '%' || p_search || '%'
      )
      AND (p_company_id IS NULL OR p.company_id = p_company_id)
      AND (p_ids IS NULL OR p.id = ANY(p_ids))
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
      AND (
        p_sector_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM geographic_visibility_rules gvr
          WHERE gvr.is_active = true
            AND (gvr.product_ids @> ARRAY[p.id] OR gvr.company_ids @> ARRAY[p.company_id])
            AND (
                 gvr.scope = 'all'
              OR (gvr.scope = 'sectors' AND gvr.sector_ids @> ARRAY[p_sector_id])
              OR (
                   gvr.scope = 'governorates'
                   AND EXISTS (
                     SELECT 1 FROM sector_governorates sg
                     WHERE sg.sector_id = p_sector_id
                       AND gvr.governorate_ids @> ARRAY[sg.governorate_id]
                   )
                 )
            )
        )
      )
      AND (NOT p_inactive_only OR (p.is_active = false OR p.is_visible = false))
      AND (NOT p_out_of_stock_only OR (p.is_out_of_stock = true AND p.is_active = true))
      AND (NOT p_exclude_out_of_stock OR (NOT COALESCE(p.is_out_of_stock, false)))
      AND (NOT p_active_status_only OR (p.is_active = true AND p.is_visible = true AND NOT COALESCE(p.is_out_of_stock, false)))
      AND (NOT p_no_price OR (p.carton_price IS NULL OR p.carton_price <= 0))
      AND (NOT p_no_image OR (p.image_url IS NULL OR p.image_url = ''))
      AND (
        NOT p_no_stock
        OR NOT EXISTS (SELECT 1 FROM inventory i WHERE i.product_id = p.id AND i.quantity > 0)
      )
    ORDER BY p.product_name
    LIMIT v_limit
    OFFSET v_offset
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.get_governed_products(text, boolean, boolean, text, uuid, boolean, integer, integer, uuid[], uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean) IS
  'قائمة المنتجات المحكومة مع فلاتر ترقيم الصفحات والبحث والفلاتر الإدارية والظهور الجغرافي من جهة السيرفر.';