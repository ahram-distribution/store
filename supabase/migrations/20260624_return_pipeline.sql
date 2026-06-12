-- ============================================================================
-- RETURN PIPELINE — Phase 3
-- Wires the return RPCs into the order lifecycle:
--   1. return_status_history table for audit trail
--   2. Unit conversion helper for quantity enforcement
--   3. governed_create_return — customers allowed, cumulative quantity check
--   4. governed_approve_return — auto-calc credit note, inventory restore
--   5. governed_reject_return — reason parameter
--   6. UNIQUE constraint on return_items (return_id, product_id)
-- ============================================================================

-- ============================================================================
-- 1. return_status_history
--    Same pattern as order_status_history but scoped to returns
-- ============================================================================

CREATE TABLE IF NOT EXISTS return_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    return_id uuid NOT NULL,
    from_status varchar(20),
    to_status varchar(20) NOT NULL,
    changed_by uuid NOT NULL,
    reason text,
    changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE return_status_history ADD CONSTRAINT fk_return_status_history_return
    FOREIGN KEY (return_id) REFERENCES returns (id) ON DELETE CASCADE;
ALTER TABLE return_status_history ADD CONSTRAINT fk_return_status_history_changed_by
    FOREIGN KEY (changed_by) REFERENCES identities (id);

ALTER TABLE return_status_history ADD CONSTRAINT ck_return_status_from
    CHECK (from_status IN ('pending', 'inspecting', 'approved', 'rejected') OR from_status IS NULL);
ALTER TABLE return_status_history ADD CONSTRAINT ck_return_status_to
    CHECK (to_status IN ('pending', 'inspecting', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_return_status_history_return_id ON return_status_history (return_id);
CREATE INDEX IF NOT EXISTS idx_return_status_history_changed_at ON return_status_history (changed_at);

COMMENT ON TABLE return_status_history IS 'Audit trail of every status change in a return lifecycle.';
COMMENT ON COLUMN return_status_history.from_status IS 'Null for initial creation';

-- ============================================================================
-- 2. Helper: convert return quantity unit to pieces
--    Same conversion logic as targets system
-- ============================================================================

CREATE OR REPLACE FUNCTION public._return_qty_to_pieces(
    p_quantity integer,
    p_unit_type text,
    p_carton_quantity integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_unit_type = 'piece' THEN
        RETURN p_quantity;
    ELSIF p_unit_type = 'dozen' THEN
        RETURN p_quantity * 12;
    ELSIF p_unit_type = 'carton' THEN
        RETURN p_quantity * COALESCE(p_carton_quantity, 0);
    ELSE
        RETURN 0;
    END IF;
END;
$$;

-- ============================================================================
-- 3. UNIQUE constraint on return_items (return_id, product_id)
--    Prevents duplicate product entries within a single return
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_return_items_return_product
    ON return_items (return_id, product_id);

-- ============================================================================
-- 4. governed_create_return — rewrite
--    * Allow customers to create returns (remove FORBIDDEN block)
--    * Validate order exists and is delivered
--    * Validate customer matches order
--    * Cumulative quantity protection
--    * Insert return_status_history entry
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_create_return(uuid, uuid, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.governed_create_return(
    p_token uuid,
    p_order_id uuid,
    p_customer_id uuid,
    p_notes text DEFAULT NULL::text,
    p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
DECLARE
    v_session app.sessions;
    v_order public.orders;
    v_return public.returns;
    v_code text;
    v_seq int;
    v_item jsonb;
    v_employee_id uuid;
    v_already_returned_pieces int;
    v_requested_pieces int;
    v_product_carton_qty int;
    v_oi record;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;

    IF v_session.identity_type = 'employee' THEN
        IF NOT public.check_capability(p_token, 'returns.create') THEN
            RAISE EXCEPTION 'MISSING_CAPABILITY: returns.create';
        END IF;
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'RETURN_ITEMS_REQUIRED';
    END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
    IF v_order.status != 'delivered' THEN RAISE EXCEPTION 'INVALID_ORDER_STATUS'; END IF;
    IF v_order.customer_id != p_customer_id THEN RAISE EXCEPTION 'CUSTOMER_MISMATCH'; END IF;

    IF v_session.identity_type = 'employee' THEN
        v_employee_id := v_session.employee_id;
    ELSE
        SELECT owner_id INTO v_employee_id FROM public.customers
        WHERE id = p_customer_id AND owner_type = 'employee';
        IF v_employee_id IS NULL THEN
            SELECT e.id INTO v_employee_id FROM public.employees e
            WHERE e.identity_id = v_order.created_by LIMIT 1;
        END IF;
        IF v_employee_id IS NULL THEN
            RAISE EXCEPTION 'NO_RESPONSIBLE_EMPLOYEE';
        END IF;
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        SELECT oi.id, oi.piece_quantity
        INTO v_oi
        FROM public.order_items oi
        WHERE oi.order_id = p_order_id AND oi.product_id = (v_item->>'product_id')::uuid;
        IF NOT FOUND THEN RAISE EXCEPTION 'PRODUCT_NOT_IN_ORDER'; END IF;

        SELECT COALESCE(carton_quantity, 1) INTO v_product_carton_qty
        FROM public.products WHERE id = (v_item->>'product_id')::uuid;

        SELECT COALESCE(SUM(
            CASE WHEN ri.unit_type = 'piece' THEN ri.quantity
                 WHEN ri.unit_type = 'dozen' THEN ri.quantity * 12
                 WHEN ri.unit_type = 'carton' THEN ri.quantity * v_product_carton_qty
            END
        ), 0) INTO v_already_returned_pieces
        FROM public.return_items ri
        JOIN public.returns r ON r.id = ri.return_id
        WHERE r.order_id = p_order_id
          AND ri.product_id = (v_item->>'product_id')::uuid
          AND r.status != 'rejected';

        v_requested_pieces := public._return_qty_to_pieces(
            (v_item->>'quantity')::int,
            v_item->>'unit_type',
            v_product_carton_qty
        );

        IF v_already_returned_pieces + v_requested_pieces > v_oi.piece_quantity THEN
            RAISE EXCEPTION 'RETURN_QUANTITY_EXCEEDS_ORDERED';
        END IF;
    END LOOP;

    SELECT last_sequence + 1 INTO v_seq FROM public.code_sequences
    WHERE code_type = 'return' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
    IF NOT FOUND THEN v_seq := 1; END IF;
    v_code := 'RET-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_seq::text, 6, '0');

    INSERT INTO public.returns (code, order_id, customer_id, owner_type, owner_id, created_by, notes)
    VALUES (v_code, p_order_id, p_customer_id, 'employee', v_employee_id, v_employee_id, p_notes)
    RETURNING * INTO v_return;

    INSERT INTO public.code_sequences (code_type, year, last_sequence)
    VALUES ('return', EXTRACT(year FROM now())::int, v_seq)
    ON CONFLICT (code_type, year) DO UPDATE SET last_sequence = v_seq;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        INSERT INTO public.return_items (return_id, product_id, unit_type, quantity, reason)
        VALUES (
            v_return.id,
            (v_item->>'product_id')::uuid,
            v_item->>'unit_type',
            (v_item->>'quantity')::int,
            v_item->>'reason'
        );
    END LOOP;

    INSERT INTO public.return_status_history (return_id, from_status, to_status, changed_by, reason)
    VALUES (v_return.id, NULL, 'pending', v_session.identity_id, 'Return created');

    RETURN v_return;
END;
$function$;

-- ============================================================================
-- 5. governed_approve_return — rewrite
--    * Auto-calculate credit_note_amount from return_items × order_items prices
--    * Auto-generate credit_note_number (CN-YYYY-NNNNNN)
--    * Restore inventory for items with return_inspection.condition = 'saleable'
--    * Insert return_status_history entry
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_approve_return(uuid, uuid, text, numeric);

CREATE OR REPLACE FUNCTION public.governed_approve_return(
    p_token uuid,
    p_id uuid
)
RETURNS returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
DECLARE
    v_session app.sessions;
    v_return public.returns;
    v_old_status varchar(20);
    v_total_amount numeric;
    v_cn_seq int;
    v_cn_code text;
    v_item record;
    v_piece_qty int;
    v_piece_price numeric;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF v_session.identity_type = 'customer' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF NOT public.check_capability(p_token, 'returns.approve') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: returns.approve'; END IF;

    SELECT * INTO v_return FROM public.returns WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF v_return.status IN ('approved', 'rejected') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

    v_old_status := v_return.status;

    -- Auto-calculate credit_note_amount from return_items × original order prices
    v_total_amount := 0;
    FOR v_item IN
        SELECT ri.product_id, ri.unit_type, ri.quantity,
               oi.total_price, oi.piece_quantity,
               p.carton_quantity
        FROM public.return_items ri
        JOIN public.order_items oi ON oi.order_id = v_return.order_id AND oi.product_id = ri.product_id
        JOIN public.products p ON p.id = ri.product_id
        WHERE ri.return_id = p_id
    LOOP
        v_piece_qty := public._return_qty_to_pieces(
            v_item.quantity, v_item.unit_type, COALESCE(v_item.carton_quantity, 1)
        );
        v_piece_price := v_item.total_price / NULLIF(v_item.piece_quantity, 0);
        v_total_amount := v_total_amount + (v_piece_qty * COALESCE(v_piece_price, 0));
    END LOOP;

    -- Generate credit note number
    SELECT last_sequence + 1 INTO v_cn_seq FROM public.code_sequences
    WHERE code_type = 'credit_note' AND year = EXTRACT(year FROM now())::int FOR UPDATE;
    IF NOT FOUND THEN v_cn_seq := 1; END IF;
    v_cn_code := 'CN-' || EXTRACT(year FROM now())::int || '-' || LPAD(v_cn_seq::text, 6, '0');

    INSERT INTO public.code_sequences (code_type, year, last_sequence)
    VALUES ('credit_note', EXTRACT(year FROM now())::int, v_cn_seq)
    ON CONFLICT (code_type, year) DO UPDATE SET last_sequence = v_cn_seq;

    -- Restore inventory for saleable inspected items
    FOR v_item IN
        SELECT ri.product_id, ri.quantity, ri.unit_type, p.carton_quantity
        FROM public.return_items ri
        JOIN public.return_inspection rinsp ON rinsp.return_item_id = ri.id
        JOIN public.products p ON p.id = ri.product_id
        WHERE ri.return_id = p_id AND rinsp.condition = 'saleable'
    LOOP
        v_piece_qty := public._return_qty_to_pieces(
            v_item.quantity, v_item.unit_type, COALESCE(v_item.carton_quantity, 1)
        );
        INSERT INTO public.inventory (product_id, quantity)
        VALUES (v_item.product_id, v_piece_qty)
        ON CONFLICT (product_id) DO UPDATE SET
            quantity = inventory.quantity + v_piece_qty,
            updated_at = now();
    END LOOP;

    -- Update return record
    UPDATE public.returns SET
        status = 'approved',
        credit_note_number = v_cn_code,
        credit_note_amount = v_total_amount,
        updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_return;

    INSERT INTO public.return_status_history (return_id, from_status, to_status, changed_by, reason)
    VALUES (p_id, v_old_status, 'approved', v_session.identity_id,
            'Approved. Credit note: ' || v_cn_code || ', Amount: ' || v_total_amount);

    RETURN v_return;
END;
$function$;

-- ============================================================================
-- 6. governed_reject_return — rewrite
--    * Add p_reason parameter (stored in notes)
--    * Insert return_status_history entry
-- ============================================================================

DROP FUNCTION IF EXISTS public.governed_reject_return(uuid, uuid);

CREATE OR REPLACE FUNCTION public.governed_reject_return(
    p_token uuid,
    p_id uuid,
    p_reason text DEFAULT NULL::text
)
RETURNS returns
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
DECLARE
    v_session app.sessions;
    v_return public.returns;
    v_old_status varchar(20);
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
    IF v_session.identity_type = 'customer' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF NOT public.check_capability(p_token, 'returns.approve') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: returns.approve'; END IF;

    SELECT * INTO v_return FROM public.returns WHERE id = p_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF v_return.status IN ('approved', 'rejected') THEN RAISE EXCEPTION 'INVALID_STATE'; END IF;

    v_old_status := v_return.status;

    UPDATE public.returns SET
        status = 'rejected',
        notes = COALESCE(p_reason, notes),
        updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_return;

    INSERT INTO public.return_status_history (return_id, from_status, to_status, changed_by, reason)
    VALUES (p_id, v_old_status, 'rejected', v_session.identity_id, p_reason);

    RETURN v_return;
END;
$function$;

-- ============================================================================
-- END OF RETURN PIPELINE
-- ============================================================================
