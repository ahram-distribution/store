-- ============================================================================
-- get_governed_bonus_products — minimal Bonus-specific payload + mandatory
-- server-side pagination (Web-only Bonus catalog optimization)
--
-- WHY (measured on production, 20-row page, all filters clear):
--     38,587 B JSON / 19,660 B gzip for 20 products  = 983 B gzip/product
--   ~15x heavier per product than the optimized get_saleslist_products page
--   (6,868 B / 1,294 B for 20 rows = 65 B/product).
--
-- Per-field byte cost measured across one 20-row Bonus page (1,929 B/row):
--     image_url                    1,148 B/row  (59.5%)   <-- dominant
--     product_units                  243 B/row  (12.6%)
--     product_name                    82 B/row  ( 4.3%)
--     company_id                      51 B/row
--     id                              43 B/row
--     geo_adjustment_percent          29 B/row
--     company_legacy_code             28 B/row
--     company_bonus_enabled           28 B/row
--     company_name                    27 B/row
--     is_out_of_stock                 23 B/row
--     bonus_enabled                   21 B/row
--     carton_quantity                 20 B/row
--     legacy_code                     20 B/row
--     carton_price / dozen_price / piece_price   17-19 B/row
--     is_visible / is_active          16-17 B/row
--
-- ROOT CAUSE of the image_url cost: products.image_url is not always a URL.
-- 95 of 613 active+visible products (and 92 of 568 Bonus-eligible ones) store
-- an inline base64 **data URI** as their image. On a typical 20-row Bonus page
-- 3 of 20 rows are data URIs consuming 20,457 of the 22,965 image_url bytes;
-- the largest single product image is 19,131 characters. Those bytes are raw
-- image binary embedded in a catalog list response, which is what makes the
-- Bonus payload heavy and poorly compressible (gzip ratio only ~51%).
--
-- WHAT CHANGES (data mode only):
--   1. Minimal projection — only the fields PROVEN to be read by the Bonus
--      flow are returned (see the consumer audit below). The generic
--      get_governed_products contract is NOT touched.
--   2. image_url returns real URLs only; inline data URIs are omitted so the
--      card falls back to its existing <Gift> placeholder. The UI already
--      handles a missing image, so nothing breaks structurally.
--   3. product_units entries drop the nested `id` (never read).
--   4. Pagination is MANDATORY in data mode and p_per_page is clamped, so the
--      previously-possible unbounded read (p_page/p_per_page NULL defaulted to
--      1,000,000 rows) is now structurally impossible.
--   5. Deterministic ordering: jsonb_agg now carries an explicit ORDER BY
--      (product_name, id). Previously jsonb_agg() had no ORDER BY while the
--      subquery did, so cross-page ordering was not guaranteed. Numbered
--      pagination REQUIRES a stable total order, otherwise pages can repeat
--      or drop rows.
--
-- WHAT DOES NOT CHANGE (business rules preserved verbatim):
--   * session validation (app.sessions + expires_at) and INVALID_SESSION shape
--   * p_group_by_company mode — identical object, identical ordering
--   * p_count_only mode — identical {count} object
--   * eligibility rule: is_active AND is_visible AND
--       (products.bonus_enabled OR companies.bonus_enabled OR legacy_code 7000)
--   * search predicate: product_name / legacy_code / company_name ILIKE
--   * p_company_ids / p_ids targeting (targeted bonus reads stay targeted)
--   * get_effective_geographic_adjustment lateral join and geo_adjustment_percent
--   * response envelope: jsonb array (data), {count} (count), array (group)
--
-- BONUS CONSUMER AUDIT — why each field is kept or dropped
-- (traced through BonusCatalogPage -> utils/catalog.toProductWithPrice ->
--  store/cart.ts addBonusItem/mergeProducts/ensureGeoItemAdjustments ->
--  engine/pricing.computeProductPrices + engine/bonusEligibility):
--
--   KEPT  id                    card key, checkCartAvailability, cart item id
--   KEPT  product_name          card title, <img alt>, cart item name
--   KEPT  company_id            p_company_ids filter, ensureGeoItemAdjustments,
--                               buildLookup tier-exception resolution
--   KEPT  company_name          card subtitle, cart item
--   KEPT  is_active             card `disabled`, addBonusItem guard
--   KEPT  is_visible            read by store/cart.ts on the MERGED shared
--                               catalog (mergeProducts overwrites by id, so
--                               the field must survive the Bonus merge)
--   KEPT  is_out_of_stock       card `disabled`, addBonusItem guard
--   KEPT  image_url             rendered by the Bonus card (<img src>)
--   KEPT  piece_price
--         dozen_price
--         carton_price          computeBonusCatalogBasePrices (display) and
--                               computeProductPrices (cart base unit price)
--   KEPT  carton_quantity       computePieceQuantity in addBonusItem + 5 cart paths
--   KEPT  geo_adjustment_percent  geo-adjusted BASE display price
--   KEPT  product_units[]       sellable-unit display
--          .unit_type
--          .is_active           product_units.is_active honored for all roles
--
--   DROPPED legacy_code           only ever read by utils/smartSearch.ts, which
--                                 has no importers. Search stays server-side
--                                 (legacy_code is still matched in the WHERE
--                                 clause), so the value is not needed in the row.
--   DROPPED bonus_enabled         read only by engine/bonusEligibility
--   DROPPED company_bonus_enabled  isProductBonusEligible, which the Bonus
--   DROPPED company_legacy_code    catalog never calls (it is server-enforced
--                                 by the identical WHERE clause above) and
--                                 recomputeBonus operates on CartItems, not on
--                                 these catalog rows. Retained here only as a
--                                 defense-in-depth parity field; the server
--                                 filter is the single source of truth.
--   DROPPED product_units[].id    never read by any Bonus consumer
--
-- BONUS PRICING RULE UNCHANGED: no tier, payment, shipping, or any other
-- commercial discount is applied anywhere in this function. It returns raw
-- base unit prices plus the geographic adjustment, exactly as before. The
-- base-only rule is enforced client-side by getUnitBasePrice() /
-- computeBonusCatalogBasePrices() and is unaffected by this change.
--
-- Follows the established repo pattern of replacing the function in place
-- (see 20271126_quota_customers_visits_bonus_pagination.sql). The name and
-- signature are unchanged, so no PGRST203 overload ambiguity is introduced and
-- no other caller needs updating.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_governed_bonus_products(
  p_token text,
  p_governorate_id uuid DEFAULT NULL::uuid,
  p_company_ids uuid[] DEFAULT NULL::uuid[],
  p_search text DEFAULT NULL::text,
  p_page integer DEFAULT NULL::integer,
  p_per_page integer DEFAULT NULL::integer,
  p_count_only boolean DEFAULT false,
  p_group_by_company boolean DEFAULT false,
  p_ids uuid[] DEFAULT NULL::uuid[]
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
  v_limit integer;
  v_offset integer;
BEGIN
  BEGIN
    v_token := p_token::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END;

  SELECT * INTO v_session
  FROM app.sessions
  WHERE token = v_token AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'INVALID_SESSION');
  END IF;

  -- Level-1 company cards: id + name + available-product count. p_page/p_per_page/
  -- p_count_only/p_ids do not apply in this mode.
  IF p_group_by_company THEN
    SELECT jsonb_agg(x.row ORDER BY (x.row ->> 'company_name'))
    INTO v_result
    FROM (
      SELECT jsonb_build_object(
        'company_id', comp.id,
        'company_name', comp.company_name,
        'count', COUNT(*)::bigint
      ) AS row
      FROM products p
      JOIN companies comp ON comp.id = p.company_id
      WHERE p.is_active = true
        AND p.is_visible = true
        AND (
          COALESCE(p.bonus_enabled, false)
          OR COALESCE(comp.bonus_enabled, false)
          OR comp.legacy_code = '7000'
        )
        AND (
          p_search IS NULL
          OR p.product_name ILIKE '%' || p_search || '%'
          OR p.legacy_code ILIKE '%' || p_search || '%'
          OR comp.company_name ILIKE '%' || p_search || '%'
        )
      GROUP BY comp.id, comp.company_name
    ) x;
    RETURN COALESCE(v_result, '[]'::jsonb);
  END IF;

  IF p_count_only THEN
    SELECT jsonb_build_object('count', COUNT(*)) INTO v_result
    FROM products p
    JOIN companies comp ON comp.id = p.company_id
    WHERE p.is_active = true
      AND p.is_visible = true
      AND (
        COALESCE(p.bonus_enabled, false)
        OR COALESCE(comp.bonus_enabled, false)
        OR comp.legacy_code = '7000'
      )
      AND (p_company_ids IS NULL OR p.company_id = ANY(p_company_ids))
      AND (p_ids IS NULL OR p.id = ANY(p_ids))
      AND (
        p_search IS NULL
        OR p.product_name ILIKE '%' || p_search || '%'
        OR p.legacy_code ILIKE '%' || p_search || '%'
        OR comp.company_name ILIKE '%' || p_search || '%'
      );
    RETURN v_result;
  END IF;

  -- Server-side pagination is MANDATORY for catalog rows. Previously NULL
  -- p_page/p_per_page silently defaulted to 1,000,000 rows, which is how the
  -- unbounded Bonus read was possible. Refuse it instead of clamping it, so a
  -- caller that forgets paging gets a loud error rather than the full catalog.
  IF p_page IS NULL OR p_per_page IS NULL THEN
    RETURN jsonb_build_object('error', 'PAGINATION_REQUIRED');
  END IF;

  -- Clamp the page size so no caller can turn "paginated" back into "full dump".
  v_limit := LEAST(GREATEST(p_per_page, 1), 200);
  v_offset := (p_page - 1) * v_limit;

  SELECT jsonb_agg(sub.data ORDER BY sub.ord) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'id', p.id,
      'product_name', p.product_name,
      'company_id', p.company_id,
      'company_name', comp.company_name,
      'is_active', p.is_active,
      'is_visible', p.is_visible,
      'is_out_of_stock', p.is_out_of_stock,
      -- Real URLs only. Inline data URIs are raw image binary (up to ~19 KB
      -- per product) and are not part of a catalog list payload; the card
      -- renders its placeholder when image_url is absent.
      'image_url', CASE
        WHEN p.image_url ~ '^https?://' OR p.image_url ~ '^/' THEN p.image_url
        ELSE NULL
      END,
      'piece_price', p.piece_price,
      'dozen_price', p.dozen_price,
      'carton_price', p.carton_price,
      'carton_quantity', p.carton_quantity,
      'geo_adjustment_percent', CASE
        WHEN p_governorate_id IS NULL THEN NULL::numeric
        ELSE g.adjustment_percent
      END,
      'product_units', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'unit_type', pu.unit_type,
              'is_active', pu.is_active
            )
            ORDER BY pu.unit_type
          )
          FROM product_units pu
          WHERE pu.product_id = p.id
        ),
        '[]'::jsonb
      )
    ) AS data,
    -- Deterministic total order: the previous ORDER BY lived only in the
    -- subquery while jsonb_agg() itself was unordered, so cross-page ordering
    -- was not guaranteed. Numbered pagination needs a stable tiebreaker.
    row_number() OVER (ORDER BY p.product_name, p.id) AS ord
    FROM products p
    JOIN companies comp ON comp.id = p.company_id
    LEFT JOIN LATERAL public.get_effective_geographic_adjustment(
      p_governorate_id,
      p.company_id,
      p.id
    ) g ON true
    WHERE p.is_active = true
      AND p.is_visible = true
      AND (
        COALESCE(p.bonus_enabled, false)
        OR COALESCE(comp.bonus_enabled, false)
        OR comp.legacy_code = '7000'
      )
      AND (p_company_ids IS NULL OR p.company_id = ANY(p_company_ids))
      AND (p_ids IS NULL OR p.id = ANY(p_ids))
      AND (
        p_search IS NULL
        OR p.product_name ILIKE '%' || p_search || '%'
        OR p.legacy_code ILIKE '%' || p_search || '%'
        OR comp.company_name ILIKE '%' || p_search || '%'
      )
    ORDER BY p.product_name, p.id
    LIMIT v_limit OFFSET v_offset
  ) sub;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;
