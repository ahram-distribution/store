-- ============================================================================
-- get_saleslist_products — SalesListPage-specific governed products RPC
--
-- WHY: SalesListPage currently downloads the FULL governed active+visible
-- catalog (614 rows / ~1.42 MB identity / ~734 KB gzip at measurement time) and
-- performs eligibility, search, company, and geo-hidden filtering on the client.
-- get_governed_products already exposes server-side search/company/pagination
-- (20271125) but it always returns the full 24-field row and does NOT enforce
-- the storefront company-visibility business rule (companies.is_visible).
--
-- This adds a NEW function (distinct name → cannot overload/ambiguate
-- get_governed_products, per the PGRST203 lesson) that:
--   * validates the session EXACTLY like get_governed_products (app.sessions),
--   * hard-enforces SalesListPage eligibility **server-side**:
--       - products.is_active = true
--       - products.is_visible = true
--       - NOT products.is_out_of_stock
--       - carton_price > 0            (same available-for-sale guard the screen
--                                      already applied client-side)
--       - company visible in the storefront: companies.is_visible = true
--   * server-side search on product_name / legacy_code / company_name
--     (mirrors get_governed_products so company-name search is preserved),
--   * server-side company filter (p_company_id),
--   * server-side geo-hidden exclusion for p_governorate_id / p_sector_id
--     (identical visibility-rule EXCEPT blocks from get_governed_products)
--     plus p_hidden_ids (the employee-context hidden ids computed by the same
--     geographic visibility RPCs the Web app already uses for the basic list),
--   * 20-product pagination (p_page / p_per_page) with a TOTAL count,
--   * slim 10-field projection (id, product_name, legacy_code, company_id,
--     company_name, piece_price, carton_price, is_active, is_visible,
--     is_out_of_stock) — NO dozen_price / carton_quantity / inventory /
--     image_url / description / oos_source / units / bonus / etc.
--   * unbounded mode (p_per_page <= 0) for Excel / PDF / Print export fetches.
--
-- Ordering preserves the screen's grouping look: company display_order then
-- product_name (the current client sorts within groups by product_name).
--
-- Governance: identical to get_governed_products (session token + SECURITY
-- DEFINER + search_path pinned). No RLS change. No read of employee tables.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_saleslist_products(
  p_token text,
  p_search text DEFAULT NULL::text,
  p_company_id uuid DEFAULT NULL::uuid,
  p_hidden_ids uuid[] DEFAULT NULL::uuid[],
  p_governorate_id uuid DEFAULT NULL::uuid,
  p_sector_id uuid DEFAULT NULL::uuid,
  p_page integer DEFAULT 1,
  p_per_page integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_token uuid;
  v_total bigint;
  v_page integer;
  v_limit integer;
  v_offset integer;
  v_rows jsonb;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END;

  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  v_page := GREATEST(COALESCE(p_page, 1), 1);
  v_limit := CASE WHEN p_per_page IS NULL OR p_per_page <= 0 THEN NULL ELSE p_per_page END;
  v_offset := (v_page - 1) * COALESCE(v_limit, 0);

  -- Total matching count (identical WHERE to the rows query below).
  SELECT COUNT(*) INTO v_total
  FROM products p
  JOIN companies comp ON comp.id = p.company_id AND comp.is_visible = true
  WHERE p.is_active = true
    AND p.is_visible = true
    AND NOT COALESCE(p.is_out_of_stock, false)
    AND (p.carton_price IS NOT NULL AND p.carton_price > 0)
    AND (
      p_search IS NULL
      OR p.product_name ILIKE '%' || p_search || '%'
      OR p.legacy_code ILIKE '%' || p_search || '%'
      OR comp.company_name ILIKE '%' || p_search || '%'
    )
    AND (p_company_id IS NULL OR p.company_id = p_company_id)
    AND (p_hidden_ids IS NULL OR NOT (p.id = ANY(p_hidden_ids)))
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
    );

  -- Slim paged rows in the SAME eligibility/search/filter scope.
  SELECT COALESCE(
    (SELECT jsonb_agg(sub.row_obj)
     FROM (
       SELECT jsonb_build_object(
         'id', p.id,
         'product_name', p.product_name,
         'legacy_code', p.legacy_code,
         'company_id', p.company_id,
         'company_name', comp.company_name,
         'piece_price', p.piece_price,
         'carton_price', p.carton_price,
         'is_active', p.is_active,
         'is_visible', p.is_visible,
         'is_out_of_stock', p.is_out_of_stock
       ) AS row_obj
       FROM products p
       JOIN companies comp ON comp.id = p.company_id AND comp.is_visible = true
       WHERE p.is_active = true
         AND p.is_visible = true
         AND NOT COALESCE(p.is_out_of_stock, false)
         AND (p.carton_price IS NOT NULL AND p.carton_price > 0)
         AND (
           p_search IS NULL
           OR p.product_name ILIKE '%' || p_search || '%'
           OR p.legacy_code ILIKE '%' || p_search || '%'
           OR comp.company_name ILIKE '%' || p_search || '%'
         )
         AND (p_company_id IS NULL OR p.company_id = p_company_id)
         AND (p_hidden_ids IS NULL OR NOT (p.id = ANY(p_hidden_ids)))
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
       ORDER BY comp.display_order NULLS LAST, p.product_name
       LIMIT v_limit
       OFFSET v_offset
     ) sub),
    '[]'::jsonb
  ) INTO v_rows;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_saleslist_products(text, text, uuid, uuid[], uuid, uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_saleslist_products(text, text, uuid, uuid[], uuid, uuid, integer, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_saleslist_products(text, text, uuid, uuid[], uuid, uuid, integer, integer) TO service_role;

COMMENT ON FUNCTION public.get_saleslist_products(text, text, uuid, uuid[], uuid, uuid, integer, integer) IS
  'قائمة أسعار البيع: منتجات محكومة مؤهلة من جهة السيرفر (نشط + ظاهر + غير نافد + شركة ظاهرة) مع بحث/شركة/إخفاء وباجنيز وبروجكشن خفيف؛ p_per_page <= 0 يُرجع الكل للتصدير/الطباعة.';