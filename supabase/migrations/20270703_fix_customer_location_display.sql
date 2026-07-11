-- ============================================================================
-- FIX: Customer Location Display Chain
--
-- Problems fixed:
--   1. fn_enrich_customer_location — no latitude/longitude in customer_addresses
--   2. get_unified_order — no fallback to unified_locations when
--      customer_addresses.latitude is NULL
--   3. Existing customers have GPS in unified_locations but not in
--      customer_addresses → backfill migration
-- ============================================================================

-- ============================================================================
-- 1. fn_enrich_customer_location — add latitude + longitude to UPSERT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_enrich_customer_location(
  p_customer_id  uuid,
  p_latitude     numeric DEFAULT NULL,
  p_longitude    numeric DEFAULT NULL,
  p_accuracy_meters numeric DEFAULT NULL,
  p_formatted_address text DEFAULT NULL,
  p_accuracy_level location_accuracy_level DEFAULT 'GPS'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_cur_location_id   uuid;
  v_cur_lat           numeric;
  v_cur_lng           numeric;
  v_cur_fmt_addr      text;

  v_addr_id           uuid;
  v_ex_city           varchar(100);
  v_ex_gov            varchar(100);
  v_ex_city_id        uuid;
  v_ex_gov_id         uuid;
  v_ex_lat            numeric;
  v_ex_lng            numeric;

  v_new_location_id   uuid;
  v_fmt               text;

  v_city_id           uuid;
  v_city_name         varchar(200);
  v_gov_id_from_city  uuid;
  v_gov_id            uuid;
  v_gov_name          varchar(200);
BEGIN
  -- ── Read current customer state ──
  SELECT location_id INTO v_cur_location_id
  FROM customers WHERE id = p_customer_id;

  SELECT city, governorate, city_id, governorate_id, id, latitude, longitude
  INTO v_ex_city, v_ex_gov, v_ex_city_id, v_ex_gov_id, v_addr_id, v_ex_lat, v_ex_lng
  FROM customer_addresses
  WHERE customer_id = p_customer_id AND is_default = true;

  -- ========================================================================
  -- GPS ENRICHMENT (customers.location_id → unified_locations)
  -- ========================================================================
  IF p_latitude IS NOT NULL AND p_longitude IS NOT NULL THEN
    IF v_cur_location_id IS NULL THEN
      v_new_location_id := gen_random_uuid();
      INSERT INTO unified_locations (id, latitude, longitude, accuracy_meters, formatted_address, captured_at)
      VALUES (v_new_location_id, p_latitude, p_longitude, p_accuracy_meters, p_formatted_address, now());
      UPDATE customers SET location_id = v_new_location_id, updated_at = now()
      WHERE id = p_customer_id;
    ELSE
      SELECT latitude, longitude, formatted_address
      INTO v_cur_lat, v_cur_lng, v_cur_fmt_addr
      FROM unified_locations WHERE id = v_cur_location_id;

      UPDATE unified_locations
      SET
        latitude         = COALESCE(NULLIF(latitude, 0), p_latitude),
        longitude        = COALESCE(NULLIF(longitude, 0), p_longitude),
        accuracy_meters  = CASE WHEN accuracy_meters IS NULL THEN p_accuracy_meters ELSE accuracy_meters END,
        formatted_address = COALESCE(formatted_address, p_formatted_address)
      WHERE id = v_cur_location_id;
    END IF;
  END IF;

  -- ── Resolve the formatted_address for city/gov matching ──
  v_fmt := p_formatted_address;
  IF v_fmt IS NULL THEN
    SELECT formatted_address INTO v_fmt
    FROM unified_locations
    WHERE id = COALESCE(v_cur_location_id, v_new_location_id);
  END IF;

  -- ========================================================================
  -- CITY / GOVERNORATE + COORDINATES ENRICHMENT (customer_addresses)
  -- ========================================================================
  IF (v_ex_city IS NULL OR v_ex_city = '' OR v_ex_gov IS NULL OR v_ex_gov = ''
      OR v_ex_lat IS NULL OR v_ex_lng IS NULL)
    AND (v_fmt IS NOT NULL AND v_fmt != ''
         OR p_latitude IS NOT NULL AND p_longitude IS NOT NULL)
  THEN
    -- ── Attempt 1: word-boundary match on city → infer governorate ──
    SELECT rc.id, rc.name_ar, rc.governorate_id
    INTO v_city_id, v_city_name, v_gov_id_from_city
    FROM reference_cities rc
    WHERE v_fmt ~* '\m' || rc.name_ar || '\M'
    ORDER BY rc.display_order
    LIMIT 1;

    IF v_city_id IS NOT NULL THEN
      SELECT rg.id, rg.name_ar INTO v_gov_id, v_gov_name
      FROM reference_governorates rg WHERE rg.id = v_gov_id_from_city;
    END IF;

    -- ── Attempt 2: word-boundary match on governorate ──
    IF v_gov_id IS NULL THEN
      SELECT rg.id, rg.name_ar INTO v_gov_id, v_gov_name
      FROM reference_governorates rg
      WHERE v_fmt ~* '\m' || rg.name_ar || '\M'
      ORDER BY rg.display_order
      LIMIT 1;
    END IF;

    -- ── Attempt 3: ILIKE fallback on city ──
    IF v_city_id IS NULL THEN
      SELECT rc.id, rc.name_ar INTO v_city_id, v_city_name
      FROM reference_cities rc
      WHERE (v_gov_id IS NULL OR rc.governorate_id = v_gov_id)
        AND v_fmt ILIKE '%' || rc.name_ar || '%'
      ORDER BY rc.display_order
      LIMIT 1;

      IF v_city_id IS NOT NULL AND v_gov_id IS NULL THEN
        SELECT rg.id, rg.name_ar INTO v_gov_id, v_gov_name
        FROM reference_governorates rg
        WHERE rg.id = (SELECT governorate_id FROM reference_cities WHERE id = v_city_id);
      END IF;
    END IF;

    -- ── Attempt 4: ILIKE fallback on governorate ──
    IF v_gov_id IS NULL THEN
      SELECT rg.id, rg.name_ar INTO v_gov_id, v_gov_name
      FROM reference_governorates rg
      WHERE v_fmt ILIKE '%' || rg.name_ar || '%'
      ORDER BY rg.display_order
      LIMIT 1;
    END IF;

    -- ── UPSERT default address with latitude/longitude ──
    INSERT INTO customer_addresses (
      customer_id, address_line1,
      city, governorate, city_id, governorate_id,
      latitude, longitude,
      address_source, location_accuracy, address_updated_at,
      is_default
    ) VALUES (
      p_customer_id,
      COALESCE(NULLIF(v_fmt, ''), ''),
      COALESCE(NULLIF(v_city_name, ''), v_ex_city, ''),
      COALESCE(NULLIF(v_gov_name, ''), v_ex_gov, ''),
      COALESCE(v_city_id, v_ex_city_id),
      COALESCE(v_gov_id, v_ex_gov_id),
      COALESCE(v_ex_lat, p_latitude),
      COALESCE(v_ex_lng, p_longitude),
      p_accuracy_level, p_accuracy_level, now(),
      true
    )
    ON CONFLICT (customer_id) WHERE is_default = true
    DO UPDATE SET
      city             = COALESCE(NULLIF(customer_addresses.city, ''), EXCLUDED.city),
      governorate      = COALESCE(NULLIF(customer_addresses.governorate, ''), EXCLUDED.governorate),
      city_id          = COALESCE(customer_addresses.city_id, EXCLUDED.city_id),
      governorate_id   = COALESCE(customer_addresses.governorate_id, EXCLUDED.governorate_id),
      latitude         = COALESCE(customer_addresses.latitude, EXCLUDED.latitude),
      longitude        = COALESCE(customer_addresses.longitude, EXCLUDED.longitude),
      address_source   = CASE WHEN customer_addresses.address_source IS NULL THEN EXCLUDED.address_source ELSE customer_addresses.address_source END,
      location_accuracy = CASE WHEN customer_addresses.location_accuracy IS NULL THEN EXCLUDED.location_accuracy ELSE customer_addresses.location_accuracy END,
      address_updated_at = now(),
      street_address   = COALESCE(customer_addresses.street_address,
                           CASE WHEN EXCLUDED.address_line1 IS NOT NULL AND EXCLUDED.address_line1 != ''
                           THEN LEFT(EXCLUDED.address_line1, 255) END);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fn_enrich_customer_location IS
  'إثراء بيانات العميل (الموقع GPS والمحافظة والمدينة والإحداثيات) من بيانات متاحة — لا يتم الكتابة فوق البيانات الموجودة';

-- ============================================================================
-- 2. get_unified_order — add COALESCE fallback to unified_locations
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_unified_order(
  p_token text,
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token uuid := p_token::uuid;
  v_session app.sessions;
  v_order public.orders;
  v_visible uuid[];
  v_is_super boolean;
  v_customer_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'NOT_FOUND'); END IF;

  IF v_session.identity_type = 'customer' THEN
    IF v_order.customer_id != v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  ELSE
    v_is_super := public.is_upper_management(v_session.employee_id);
    IF NOT v_is_super THEN
      v_visible := COALESCE(public.get_visible_employee_ids(v_token), '{}'::uuid[]);
      IF NOT EXISTS (
        SELECT 1 FROM public.customers c
        WHERE c.id = v_order.customer_id AND c.owner_id = ANY(v_visible)
      ) THEN
        RETURN jsonb_build_object('error', 'FORBIDDEN');
      END IF;
    END IF;
  END IF;

  v_customer_id := v_order.customer_id;

  RETURN (
    SELECT jsonb_build_object(
      'order', jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'status', o.status,
        'delivery_mode', o.delivery_mode,
        'payment_method', o.payment_method,
        'subtotal', o.subtotal,
        'discount_amount', o.discount_amount,
        'tax_amount', o.tax_amount,
        'total_amount', o.total_amount,
        'notes', o.notes,
        'revision_number', o.revision_number,
        'last_revised_at', o.last_revised_at,
        'customer_id', o.customer_id,
        'owner_type', o.owner_type,
        'owner_id', o.owner_id,
        'created_by', o.created_by,
        'submitted_at', o.submitted_at,
        'approved_at', o.approved_at,
        'delivered_at', o.delivered_at,
        'cancelled_at', o.cancelled_at,
        'created_at', o.created_at,
        'updated_at', o.updated_at,
        'deferred_until', o.deferred_until,
        'defer_reason', o.defer_reason,
        'cancel_reason', o.cancel_reason,
        'execution_latitude', o.execution_latitude,
        'execution_longitude', o.execution_longitude,
        'execution_accuracy_meters', o.execution_accuracy_meters,
        'execution_captured_at', o.execution_captured_at,
        'execution_location_id', o.execution_location_id,
        'tier_id', o.tier_id,
        'effective_discount_percent', o.effective_discount_percent,
        'snapshot_customer_name', o.snapshot_customer_name,
        'snapshot_customer_phone', o.snapshot_customer_phone,
        'snapshot_customer_address', o.snapshot_customer_address,
        'snapshot_customer_code', o.snapshot_customer_code,
        'snapshot_owner_name', o.snapshot_owner_name,
        'snapshot_owner_phone', o.snapshot_owner_phone,
        'snapshot_owner_address', o.snapshot_owner_address,
        'snapshot_sender_name', o.snapshot_sender_name,
        'snapshot_sender_phone', o.snapshot_sender_phone,
        'snapshot_sender_address', o.snapshot_sender_address,
        'customer_owner_name', COALESCE(co_emp.full_name, ''),
        'customer_owner_role', COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = c.owner_id LIMIT 1), ''),
        'order_creator_name', COALESCE(oc_emp.full_name, oc_cust.company_name, ''),
        'order_creator_role', CASE
          WHEN oc_i.identity_type = 'employee' THEN COALESCE((SELECT r.name FROM public.employee_roles er2 JOIN public.roles r ON r.id = er2.role_id WHERE er2.employee_id = oc_emp.id LIMIT 1), '')
          ELSE NULL
        END,
        'customer_owner_id', c.owner_id,
        'order_creator_id', CASE
          WHEN oc_i.identity_type = 'employee' THEN oc_emp.id
          WHEN oc_i.identity_type = 'customer' THEN oc_cust.id
          ELSE NULL
        END,
        'order_creator_type', oc_i.identity_type
      ),
      'customer', (
        SELECT jsonb_build_object(
          'id', c2.id,
          'code', c2.code,
          'company_name', c2.company_name,
          'phone', i.phone,
          'address_line1', ca.address_line1,
          'address_line2', ca.address_line2,
          'city', ca.city,
          'governorate', ca.governorate,
          'address_latitude', COALESCE(ca.latitude, ul.latitude),
          'address_longitude', COALESCE(ca.longitude, ul.longitude),
          'display_address', COALESCE(
            NULLIF(concat_ws(' - ', ca.address_line1, ca.city, ca.governorate), ''),
            v_order.snapshot_customer_address
          )
        )
        FROM public.customers c2
        LEFT JOIN public.identities i ON i.id = c2.identity_id
        LEFT JOIN public.customer_addresses ca ON ca.customer_id = c2.id AND ca.is_default = true
        LEFT JOIN unified_locations ul ON ul.id = c2.location_id
        WHERE c2.id = v_customer_id
        LIMIT 1
      ),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'product_name', p.product_name,
          'legacy_code', p.legacy_code,
          'image_url', p.image_url,
          'company_id', p.company_id,
          'company_name', comp.company_name,
          'unit_type', oi.unit_type,
          'unit_quantity', oi.unit_quantity,
          'piece_quantity', oi.piece_quantity,
          'unit_price', oi.unit_price,
          'total_price', oi.total_price
        ) ORDER BY oi.id)
        FROM public.order_items oi
        LEFT JOIN public.products p ON p.id = oi.product_id
        LEFT JOIN public.companies comp ON comp.id = p.company_id
        WHERE oi.order_id = o.id
      ), '[]'::jsonb),
      'status_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', osh.id,
          'from_status', osh.from_status,
          'to_status', osh.to_status,
          'changed_by', osh.changed_by,
          'changed_at', osh.changed_at
        ) ORDER BY osh.changed_at)
        FROM public.order_status_history osh
        WHERE osh.order_id = o.id
      ), '[]'::jsonb),
      'modification_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', omh.id,
          'revision_number', omh.revision_number,
          'field_name', omh.field_name,
          'old_value', omh.old_value,
          'new_value', omh.new_value,
          'old_order_items', omh.old_order_items,
          'new_order_items', omh.new_order_items,
          'old_daily_deals', omh.old_daily_deals,
          'new_daily_deals', omh.new_daily_deals,
          'old_flash_offers', omh.old_flash_offers,
          'new_flash_offers', omh.new_flash_offers,
          'modified_by', omh.modified_by,
          'reason', omh.reason,
          'modified_at', omh.modified_at
        ) ORDER BY omh.modified_at DESC)
        FROM public.order_modification_history omh
        WHERE omh.order_id = o.id
      ), '[]'::jsonb),
      'current_delivery', (
        SELECT jsonb_build_object(
          'id', dt.id,
          'status', dt.status,
          'attempt_number', dt.attempt_number,
          'assigned_to', dt.assigned_to,
          'assigned_by', dt.assigned_by,
          'assigned_at', dt.assigned_at,
          'started_at', dt.started_at,
          'completed_at', dt.completed_at,
          'failure_reason', dt.failure_reason,
          'failure_notes', dt.failure_notes,
          'notes', dt.notes,
          'returned_at', dt.returned_at,
          'external_carrier_id', dt.external_carrier_id,
          'waybill_number', dt.waybill_number,
          'tracking_url', dt.tracking_url,
          'delivery_mode', o.delivery_mode,
          'assigned_to_name', ast.code,
          'external_carrier_name', ec.name,
          'updated_at', dt.updated_at
        )
        FROM public.delivery_tracking dt
        LEFT JOIN public.employees ast ON ast.id = dt.assigned_to
        LEFT JOIN public.external_carriers ec ON ec.id = dt.external_carrier_id
        WHERE dt.order_id = o.id AND dt.is_active = true
        LIMIT 1
      ),
      'delivery_history', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', dt.id,
          'status', dt.status,
          'attempt_number', dt.attempt_number,
          'is_active', dt.is_active,
          'assigned_to', dt.assigned_to,
          'assigned_by', dt.assigned_by,
          'assigned_at', dt.assigned_at,
          'started_at', dt.started_at,
          'completed_at', dt.completed_at,
          'failure_reason', dt.failure_reason,
          'failure_notes', dt.failure_notes,
          'notes', dt.notes,
          'returned_at', dt.returned_at,
          'external_carrier_id', dt.external_carrier_id,
          'waybill_number', dt.waybill_number,
          'tracking_url', dt.tracking_url,
          'assigned_to_name', ast.code,
          'external_carrier_name', ec.name
        ) ORDER BY dt.attempt_number)
        FROM public.delivery_tracking dt
        LEFT JOIN public.employees ast ON ast.id = dt.assigned_to
        LEFT JOIN public.external_carriers ec ON ec.id = dt.external_carrier_id
        WHERE dt.order_id = o.id
      ), '[]'::jsonb),
      'preparation', (
        SELECT jsonb_build_object(
          'id', pr.id,
          'status', pr.status,
          'started_by', pr.started_by,
          'started_at', pr.started_at,
          'completed_by', pr.completed_by,
          'completed_at', pr.completed_at,
          'reviewed_by', pr.reviewed_by,
          'reviewed_at', pr.reviewed_at,
          'cancelled_by', pr.cancelled_by,
          'cancelled_at', pr.cancelled_at,
          'notes', pr.notes
        )
        FROM public.preparation_records pr
        WHERE pr.order_id = o.id
        ORDER BY pr.created_at DESC
        LIMIT 1
      ),
      'returns', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', r.id,
          'code', r.code,
          'status', r.status,
          'credit_note_amount', r.credit_note_amount,
          'notes', r.notes,
          'created_at', r.created_at
        ) ORDER BY r.created_at)
        FROM public.returns r
        WHERE r.order_id = o.id
      ), '[]'::jsonb),
      'collections', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', col.id,
          'code', col.code,
          'method', col.method,
          'amount', col.amount,
          'status', col.status,
          'reference_number', col.reference_number,
          'collected_at', col.collected_at,
          'order_id', col.order_id
        ) ORDER BY col.created_at)
        FROM public.collections col
        WHERE col.order_id = o.id
           OR (col.customer_id = v_customer_id AND col.order_id IS NULL)
      ), '[]'::jsonb)
    )
    FROM public.orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.employees co_emp ON co_emp.id = c.owner_id
    LEFT JOIN public.identities oc_i ON oc_i.id = o.created_by
    LEFT JOIN public.employees oc_emp ON oc_emp.identity_id = oc_i.id AND oc_i.identity_type = 'employee'
    LEFT JOIN public.customers oc_cust ON oc_cust.identity_id = oc_i.id AND oc_i.identity_type = 'customer'
    WHERE o.id = p_id
  );
END;
$$;

COMMENT ON FUNCTION public.get_unified_order IS 'مصدر الحقيقة الموحد للطلب — مع fallback للموقع من unified_locations';

-- ============================================================================
-- 3. DATA MIGRATION — Backfill existing customers
--
-- For customers who have customers.location_id set but no GPS coordinates in
-- customer_addresses, copy from unified_locations.
-- ============================================================================

DO $$
DECLARE
  v_rec record;
  v_ul record;
  v_addr_id uuid;
  v_count_updated bigint := 0;
  v_count_inserted bigint := 0;
BEGIN
  FOR v_rec IN
    SELECT c.id AS customer_id, c.location_id
    FROM customers c
    WHERE c.location_id IS NOT NULL
  LOOP
    SELECT id, latitude, longitude, formatted_address
    INTO v_ul
    FROM unified_locations
    WHERE id = v_rec.location_id;

    IF v_ul.latitude IS NOT NULL AND v_ul.longitude IS NOT NULL THEN
      -- Check if customer has a default address
      SELECT id INTO v_addr_id
      FROM customer_addresses
      WHERE customer_id = v_rec.customer_id AND is_default = true;

      IF v_addr_id IS NOT NULL THEN
        -- Update existing default address (only if lat/lng missing)
        UPDATE customer_addresses
        SET
          latitude = COALESCE(customer_addresses.latitude, v_ul.latitude),
          longitude = COALESCE(customer_addresses.longitude, v_ul.longitude),
          address_source = CASE WHEN customer_addresses.address_source IS NULL
                            THEN COALESCE(
                              (SELECT address_source FROM customer_addresses WHERE id = v_addr_id),
                              CASE WHEN v_ul.formatted_address IS NOT NULL THEN 'mixed' ELSE 'gps' END::text::address_source_type
                            )
                            ELSE customer_addresses.address_source END,
          location_accuracy = CASE WHEN customer_addresses.location_accuracy IS NULL
                              THEN 'GPS'::location_accuracy_level
                              ELSE customer_addresses.location_accuracy END,
          address_updated_at = now(),
          address_line1 = COALESCE(NULLIF(customer_addresses.address_line1, ''), COALESCE(v_ul.formatted_address, ''))
        WHERE id = v_addr_id
          AND (customer_addresses.latitude IS NULL OR customer_addresses.longitude IS NULL);

        IF FOUND THEN
          v_count_updated := v_count_updated + 1;
        END IF;
      ELSE
        -- No default address → insert one
        INSERT INTO customer_addresses (
          customer_id, address_line1, latitude, longitude,
          address_source, location_accuracy, address_updated_at, is_default
        ) VALUES (
          v_rec.customer_id,
          COALESCE(v_ul.formatted_address, ''),
          v_ul.latitude,
          v_ul.longitude,
          CASE WHEN v_ul.formatted_address IS NOT NULL THEN 'mixed' ELSE 'gps' END::address_source_type,
          'GPS'::location_accuracy_level,
          now(),
          true
        );
        v_count_inserted := v_count_inserted + 1;
      END IF;
    END IF;
  END LOOP;

  RAISE NOTICE 'Backfill complete: % customer_addresses updated, % customer_addresses inserted', v_count_updated, v_count_inserted;
END;
$$;

-- ============================================================================
-- END OF FIX
-- ============================================================================
