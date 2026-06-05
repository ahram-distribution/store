-- ============================================================
-- Phase 2A: Missing Governed RPCs (Highest Business Impact)
-- Priority 1: get_governed_products
-- Priority 2: get_governed_customer_contacts
-- Priority 3: get_governed_roles
-- ============================================================

-- ============================================================
-- 1. get_governed_products
-- Returns products with company name, units, and inventory.
-- Supports filtering: active/visible, search, company_id, count-only.
-- Scope: any authenticated user (employees see governed scope,
--        customers see visible products).
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_governed_products(
  p_token uuid,
  p_active_only boolean DEFAULT true,
  p_visible_only boolean DEFAULT true,
  p_search text DEFAULT NULL::text,
  p_company_id uuid DEFAULT NULL::uuid,
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
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF p_count_only THEN
    SELECT jsonb_build_object('count', COUNT(*)) INTO v_result
    FROM products p
    WHERE (NOT p_active_only OR p.is_active = true)
      AND (NOT p_visible_only OR p.is_visible = true)
      AND (p_search IS NULL OR p.product_name ILIKE '%' || p_search || '%' OR p.legacy_code ILIKE '%' || p_search || '%')
      AND (p_company_id IS NULL OR p.company_id = p_company_id);
    RETURN v_result;
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'product_name', p.product_name,
      'legacy_code', p.legacy_code,
      'description', p.description,
      'company_id', p.company_id,
      'company_name', comp.company_name,
      'is_active', p.is_active,
      'is_visible', p.is_visible,
      'image_url', p.image_url,
      'carton_price', p.carton_price,
      'carton_quantity', p.carton_quantity,
      'created_at', p.created_at,
      'product_units', COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            'id', pu.id,
            'unit_type', pu.unit_type,
            'is_active', pu.is_active
          )
          ORDER BY pu.unit_type
        ) FROM product_units pu WHERE pu.product_id = p.id),
        '[]'::jsonb
      ),
      'inventory', (SELECT jsonb_build_object('quantity', inv.quantity) FROM inventory inv WHERE inv.product_id = p.id LIMIT 1)
    )
    ORDER BY p.product_name
  ) INTO v_result
  FROM products p
  JOIN companies comp ON comp.id = p.company_id
  WHERE (NOT p_active_only OR p.is_active = true)
    AND (NOT p_visible_only OR p.is_visible = true)
    AND (p_search IS NULL OR p.product_name ILIKE '%' || p_search || '%' OR p.legacy_code ILIKE '%' || p_search || '%')
    AND (p_company_id IS NULL OR p.company_id = p_company_id);

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_governed_products IS 'المنتجات مع دعم البحث والتصفية';

-- ============================================================
-- 2. get_governed_customer_contacts
-- Returns customer contact records with scope-based filtering.
-- Employees: contacts for owned/visible customers only.
-- Customers: own contacts only.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_governed_customer_contacts(
  p_token uuid,
  p_customer_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.identity_type = 'customer' THEN
    IF p_customer_id IS NOT NULL AND p_customer_id != v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
    SELECT jsonb_agg(
      jsonb_build_object('id', cc.id, 'customer_id', cc.customer_id, 'phone', cc.phone, 'full_name', cc.full_name, 'is_primary', cc.is_primary, 'email', cc.email, 'role', cc.role)
      ORDER BY cc.is_primary DESC NULLS LAST
    ) INTO v_result
    FROM customer_contacts cc
    WHERE cc.customer_id = COALESCE(p_customer_id, v_session.customer_id);
  ELSE
    WITH v_visible_customers AS (
      SELECT c.id FROM customers c
      WHERE (p_customer_id IS NULL OR c.id = p_customer_id)
        AND (
          EXISTS (SELECT 1 FROM employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN', 'CHAIRMAN', 'ADMIN'))
          OR c.owner_id = v_session.employee_id
          OR c.owner_id IN (
            WITH RECURSIVE sub AS (
              SELECT e.id FROM employees e WHERE e.manager_id = v_session.employee_id
              UNION ALL
              SELECT e.id FROM employees e JOIN sub s ON e.manager_id = s.id
            )
            SELECT id FROM sub
          )
        )
    )
    SELECT jsonb_agg(
      jsonb_build_object('id', cc.id, 'customer_id', cc.customer_id, 'phone', cc.phone, 'full_name', cc.full_name, 'is_primary', cc.is_primary, 'email', cc.email, 'role', cc.role)
      ORDER BY cc.is_primary DESC NULLS LAST
    ) INTO v_result
    FROM customer_contacts cc
    WHERE cc.customer_id IN (SELECT id FROM v_visible_customers);

    IF v_result IS NULL AND p_customer_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id) THEN
        RETURN jsonb_build_object('error', 'CUSTOMER_NOT_FOUND');
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_governed_customer_contacts IS 'جهات اتصال العميل مع التحكم بالصلاحيات';

-- ============================================================
-- 3. get_governed_roles
-- Returns all roles. Employees only.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_governed_roles(
  p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN
    RETURN jsonb_build_object('error', 'NOT_EMPLOYEE');
  END IF;
  SELECT jsonb_agg(
    jsonb_build_object('id', r.id, 'name', r.name, 'description', r.description, 'created_at', r.created_at)
    ORDER BY r.name
  ) INTO v_result FROM roles r;
  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_governed_roles IS 'قائمة الأدوار مع التحكم بالصلاحيات';

-- ============================================================
-- Phase 2B: Governance Closure RPCs
-- ============================================================

-- ============================================================
-- 4. get_governed_order_history
-- Returns status history for a given order.
-- Employee only. No customer access to order audit trails.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_governed_order_history(
  p_token uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_order_exists boolean;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT EXISTS (SELECT 1 FROM orders WHERE id = p_order_id) INTO v_order_exists;
  IF NOT v_order_exists THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', osh.id,
      'order_id', osh.order_id,
      'from_status', osh.from_status,
      'to_status', osh.to_status,
      'changed_by', osh.changed_by,
      'reason', osh.reason,
      'changed_at', osh.changed_at
    )
    ORDER BY osh.changed_at ASC
  ) INTO v_result
  FROM order_status_history osh
  WHERE osh.order_id = p_order_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_governed_order_history IS 'سجل حالة الطلب مع التحكم بالصلاحيات';

-- ============================================================
-- 5. get_governed_customer_addresses
-- Returns addresses for a customer with scope-based filtering.
-- Employees: addresses for owned/visible customers only.
-- Customers: own addresses only.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_governed_customer_addresses(
  p_token uuid,
  p_customer_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.identity_type = 'customer' THEN
    IF p_customer_id IS NOT NULL AND p_customer_id != v_session.customer_id THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', ca.id, 'customer_id', ca.customer_id, 'label', ca.label,
        'address_line1', ca.address_line1, 'address_line2', ca.address_line2,
        'city', ca.city, 'governorate', ca.governorate, 'postal_code', ca.postal_code,
        'latitude', ca.latitude, 'longitude', ca.longitude, 'is_default', ca.is_default
      )
      ORDER BY ca.is_default DESC
    ) INTO v_result
    FROM customer_addresses ca
    WHERE ca.customer_id = COALESCE(p_customer_id, v_session.customer_id);
  ELSE
    WITH v_visible_customers AS (
      SELECT c.id FROM customers c
      WHERE (p_customer_id IS NULL OR c.id = p_customer_id)
        AND (
          EXISTS (SELECT 1 FROM employee_roles er JOIN roles r ON r.id = er.role_id WHERE er.employee_id = v_session.employee_id AND r.name IN ('SUPER_ADMIN', 'CHAIRMAN', 'ADMIN'))
          OR c.owner_id = v_session.employee_id
          OR c.owner_id IN (
            WITH RECURSIVE sub AS (
              SELECT e.id FROM employees e WHERE e.manager_id = v_session.employee_id
              UNION ALL
              SELECT e.id FROM employees e JOIN sub s ON e.manager_id = s.id
            )
            SELECT id FROM sub
          )
        )
    )
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', ca.id, 'customer_id', ca.customer_id, 'label', ca.label,
        'address_line1', ca.address_line1, 'address_line2', ca.address_line2,
        'city', ca.city, 'governorate', ca.governorate, 'postal_code', ca.postal_code,
        'latitude', ca.latitude, 'longitude', ca.longitude, 'is_default', ca.is_default
      )
      ORDER BY ca.is_default DESC
    ) INTO v_result
    FROM customer_addresses ca
    WHERE ca.customer_id IN (SELECT id FROM v_visible_customers);

    IF v_result IS NULL AND p_customer_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM customers WHERE id = p_customer_id) THEN
        RETURN jsonb_build_object('error', 'CUSTOMER_NOT_FOUND');
      END IF;
    END IF;
  END IF;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_governed_customer_addresses IS 'عناوين العميل مع التحكم بالصلاحيات';

-- ============================================================
-- 6. get_governed_customer_ownership_history
-- Returns ownership change audit trail for a customer.
-- Employee only. Ownership history is internal data.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_governed_customer_ownership_history(
  p_token uuid,
  p_customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', coh.id, 'customer_id', coh.customer_id,
      'previous_owner_id', coh.previous_owner_id,
      'new_owner_id', coh.new_owner_id,
      'changed_by', coh.changed_by,
      'reason', coh.reason,
      'changed_at', coh.changed_at
    )
    ORDER BY coh.changed_at DESC
  ) INTO v_result
  FROM customer_ownership_history coh
  WHERE coh.customer_id = p_customer_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_governed_customer_ownership_history IS 'سجل تغيير ملكية العميل مع التحكم بالصلاحيات';

-- ============================================================
-- 7. get_governed_preparation_detail
-- Returns a complete preparation detail bundle:
--   - Preparation record
--   - Associated order (via get_governed_order)
--   - Order status history
--   - Order modification history
--   - Preparation exceptions
-- Employee only. Warehouse capability required.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_governed_preparation_detail(
  p_token uuid,
  p_preparation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_prep_rec record;
  v_order_data jsonb;
  v_status_history jsonb;
  v_modification_history jsonb;
  v_exceptions jsonb;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT * INTO v_prep_rec FROM preparation_records WHERE id = p_preparation_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'PREPARATION_NOT_FOUND'); END IF;

  SELECT jsonb_build_object(
    'id', o.id, 'order_number', o.order_number, 'customer_id', o.customer_id,
    'customer_name_snapshot', c.company_name, 'owner_id', o.owner_id,
    'status', o.status, 'total_amount', o.total_amount,
    'subtotal', o.subtotal, 'discount_amount', o.discount_amount,
    'created_at', o.created_at, 'updated_at', o.updated_at
  ) INTO v_order_data
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  WHERE o.id = v_prep_rec.order_id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', osh.id, 'order_id', osh.order_id, 'from_status', osh.from_status,
      'to_status', osh.to_status, 'changed_by', osh.changed_by,
      'reason', osh.reason, 'changed_at', osh.changed_at
    )
    ORDER BY osh.changed_at ASC
  ) INTO v_status_history
  FROM order_status_history osh
  WHERE osh.order_id = v_prep_rec.order_id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', omh.id, 'order_id', omh.order_id, 'revision_number', omh.revision_number,
      'field_name', omh.field_name, 'old_value', omh.old_value, 'new_value', omh.new_value,
      'modified_by', omh.modified_by, 'reason', omh.reason, 'modified_at', omh.modified_at
    )
    ORDER BY omh.modified_at ASC
  ) INTO v_modification_history
  FROM order_modification_history omh
  WHERE omh.order_id = v_prep_rec.order_id;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', pe.id, 'preparation_id', pe.preparation_id,
      'exception_type', pe.exception_type, 'notes', pe.notes, 'created_at', pe.created_at
    )
    ORDER BY pe.created_at DESC
  ) INTO v_exceptions
  FROM preparation_exceptions pe
  WHERE pe.preparation_id = p_preparation_id;

  SELECT jsonb_build_object(
    'id', v_prep_rec.id,
    'order_id', v_prep_rec.order_id,
    'status', v_prep_rec.status,
    'started_at', v_prep_rec.started_at,
    'completed_at', v_prep_rec.completed_at,
    'reviewed_at', v_prep_rec.reviewed_at,
    'cancelled_at', v_prep_rec.cancelled_at,
    'notes', v_prep_rec.notes,
    'order', v_order_data,
    'status_history', COALESCE(v_status_history, '[]'::jsonb),
    'modification_history', COALESCE(v_modification_history, '[]'::jsonb),
    'exceptions', COALESCE(v_exceptions, '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_governed_preparation_detail IS 'تفاصيل التجهيز كاملة مع سجل الطلب والاستثناءات';

-- ============================================================
-- Phase 3: Final Governance Closure RPCs
-- ============================================================

-- ============================================================
-- 8. get_governed_order_items
-- Returns order items with product name, company name for an order.
-- Employee only. Order data is internal.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_governed_order_items(
  p_token uuid,
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_result jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id', oi.id,
      'order_id', oi.order_id,
      'product_id', oi.product_id,
      'unit_type', oi.unit_type,
      'unit_quantity', oi.unit_quantity,
      'piece_quantity', oi.piece_quantity,
      'unit_price', oi.unit_price,
      'total_price', oi.total_price,
      'product_name', p.product_name,
      'legacy_code', p.legacy_code,
      'image_url', p.image_url,
      'company_id', p.company_id,
      'company_name', comp.company_name
    )
  ) INTO v_result
  FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  JOIN companies comp ON comp.id = p.company_id
  WHERE oi.order_id = p_order_id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

COMMENT ON FUNCTION public.get_governed_order_items IS 'عناصر الطلب مع اسم المنتج والشركة';

-- ============================================================
-- 9. get_governed_dashboard_counts
-- Returns employee and company counts for dashboard tiles.
-- Employee only.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_governed_dashboard_counts(
  p_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_emp_count bigint;
  v_comp_count bigint;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT COUNT(*) INTO v_emp_count FROM employees;
  SELECT COUNT(*) INTO v_comp_count FROM companies;

  RETURN jsonb_build_object(
    'employees_count', v_emp_count,
    'companies_count', v_comp_count
  );
END;
$function$;

COMMENT ON FUNCTION public.get_governed_dashboard_counts IS 'إحصائيات لوحة التحكم (الموظفين والشركات)';

-- ============================================================
-- 10. governed_global_search
-- Global search across orders, companies, collections, visits.
-- Returns unified search results with type, label, sublabel, path.
-- Employee only. Respects ownership scoping.
-- ============================================================
CREATE OR REPLACE FUNCTION public.governed_global_search(
  p_token uuid,
  p_query text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_result jsonb;
  v_ql text;
  v_emp_id uuid;
  v_is_super boolean;
  v_sub_ids uuid[];
  v_orders jsonb;
  v_companies jsonb;
  v_collections jsonb;
  v_visits jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  v_ql := '%' || p_query || '%';
  v_emp_id := v_session.employee_id;

  SELECT EXISTS (
    SELECT 1 FROM employee_roles er JOIN roles r ON r.id = er.role_id
    WHERE er.employee_id = v_emp_id AND r.name IN ('SUPER_ADMIN', 'CHAIRMAN', 'ADMIN')
  ) INTO v_is_super;

  WITH RECURSIVE sub AS (
    SELECT e.id FROM employees e WHERE e.manager_id = v_emp_id
    UNION ALL
    SELECT e.id FROM employees e JOIN sub s ON e.manager_id = s.id
  )
  SELECT COALESCE(ARRAY_AGG(id), '{}'::uuid[]) INTO v_sub_ids FROM sub;

  SELECT jsonb_agg(jsonb_build_object('type','order','id',o.id,'label',o.order_number,'sublabel',COALESCE(cust.company_name,'')||' | '||COALESCE(o.total_amount::text,'0'),'path','/orders/'||o.id)) INTO v_orders
  FROM orders o LEFT JOIN customers cust ON cust.id = o.customer_id
  WHERE o.order_number ILIKE v_ql OR cust.company_name ILIKE v_ql
  LIMIT 5;

  SELECT jsonb_agg(jsonb_build_object('type','company','id',comp.id,'label',comp.company_name,'sublabel',COALESCE(comp.legacy_code,''),'path','/storefront/products?company='||comp.id)) INTO v_companies
  FROM companies comp WHERE comp.company_name ILIKE v_ql OR comp.legacy_code ILIKE v_ql LIMIT 5;

  SELECT jsonb_agg(jsonb_build_object('type','collection','id',col.id,'label',col.code,'sublabel',COALESCE(cust2.company_name,'')||' | '||COALESCE(col.amount::text,'0'),'path','/collections')) INTO v_collections
  FROM collections col LEFT JOIN customers cust2 ON cust2.id = col.customer_id
  WHERE (col.code ILIKE v_ql OR cust2.company_name ILIKE v_ql)
    AND (v_is_super OR col.created_by = v_emp_id)
  LIMIT 5;

  SELECT jsonb_agg(jsonb_build_object('type','visit','id',v.id,'label',COALESCE(cust3.company_name,''),'sublabel',COALESCE(v.status,''),'path','/visits/'||v.id)) INTO v_visits
  FROM visits v LEFT JOIN customers cust3 ON cust3.id = v.customer_id
  WHERE cust3.company_name ILIKE v_ql
    AND (v_is_super OR v.employee_id = v_emp_id OR v.employee_id = ANY(v_sub_ids))
  LIMIT 5;

  v_result := COALESCE(v_orders, '[]'::jsonb) || COALESCE(v_companies, '[]'::jsonb) || COALESCE(v_collections, '[]'::jsonb) || COALESCE(v_visits, '[]'::jsonb);
  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.governed_global_search IS 'بحث عام شامل مع التحكم بالصلاحيات';
