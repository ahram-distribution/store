-- Fix: governed_transfer_order_owner
-- Root cause: FK on order_modification_history.modified_by REFERENCES identities(id)
-- was passing v_session.employee_id (employee UUID) instead of v_session.identity_id (identity UUID).
-- Also fixed: COALESCE(revision_number, 0) -> GREATEST(COALESCE(revision_number, 1), 1)
-- because ck_order_mod_revision requires revision_number >= 1.

CREATE OR REPLACE FUNCTION public.governed_transfer_order_owner(
  p_token text,
  p_order_id uuid,
  p_new_owner_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_token uuid := p_token::uuid;
  v_session app.sessions;
  v_order RECORD;
  v_old_owner_id uuid;
  v_old_owner_name text;
  v_new_owner_name text;
  v_is_super boolean;
  v_new_owner_exists boolean;
  v_visible uuid[];
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = v_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;
  IF v_session.identity_type != 'employee' THEN RETURN jsonb_build_object('error', 'NOT_EMPLOYEE'); END IF;

  SELECT o.id, o.owner_id, o.revision_number, o.order_number, o.status
  INTO v_order
  FROM public.orders o
  WHERE o.id = p_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'ORDER_NOT_FOUND'); END IF;

  v_old_owner_id := v_order.owner_id;

  v_is_super := public.is_upper_management(v_session.employee_id);
  IF NOT v_is_super THEN
    IF NOT (
      v_old_owner_id = v_session.employee_id
      OR EXISTS (
        SELECT 1 FROM public.employees
        WHERE id = v_old_owner_id AND manager_id = v_session.employee_id
      )
    ) THEN
      RETURN jsonb_build_object('error', 'FORBIDDEN');
    END IF;
  END IF;

  IF v_is_super THEN
    SELECT EXISTS(SELECT 1 FROM public.employees WHERE id = p_new_owner_id AND is_active = true)
    INTO v_new_owner_exists;
  ELSE
    v_visible := COALESCE(public.get_visible_employee_ids(v_token), '{}'::uuid[]);
    v_new_owner_exists := (p_new_owner_id = ANY(v_visible));
  END IF;
  IF NOT v_new_owner_exists THEN
    RETURN jsonb_build_object('error', 'NEW_OWNER_NOT_IN_SCOPE');
  END IF;

  IF v_old_owner_id = p_new_owner_id THEN
    RETURN jsonb_build_object('error', 'SAME_OWNER');
  END IF;

  v_old_owner_name := COALESCE(
    (SELECT full_name FROM public.employees WHERE id = v_old_owner_id),
    'غير محدد'
  );
  v_new_owner_name := COALESCE(
    (SELECT full_name FROM public.employees WHERE id = p_new_owner_id),
    'غير محدد'
  );

  UPDATE public.orders
  SET owner_id = p_new_owner_id,
      updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.order_modification_history (
    order_id, revision_number, field_name, old_value, new_value,
    modified_by, reason, modified_at
  ) VALUES (
    p_order_id,
    GREATEST(COALESCE(v_order.revision_number, 1), 1),
    'OWNER_TRANSFER',
    v_old_owner_name,
    v_new_owner_name,
    v_session.identity_id,
    COALESCE(p_reason, 'نقل ملكية الطلب'),
    now()
  );

  RETURN jsonb_build_object(
    'success', true,
    'order_id', p_order_id,
    'order_number', v_order.order_number,
    'old_owner_id', v_old_owner_id,
    'new_owner_id', p_new_owner_id,
    'old_owner_name', v_old_owner_name,
    'new_owner_name', v_new_owner_name
  );
END;
$$;
