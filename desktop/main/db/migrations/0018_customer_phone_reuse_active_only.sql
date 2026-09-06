-- Desktop migration 18: Customer phone reuse — uniqueness scoped to CURRENT (active) identities
-- Applied to production as the effective definition.
--
-- PROBLEM: A phone previously assigned to a customer stayed unavailable after that customer
-- changed their phone or was deleted.
--
-- ROOT CAUSE: identities.phone carried a FULL-TABLE UNIQUE constraint (schema.sql:664
-- `phone varchar(20) UNIQUE`). Every phone had to be unique across ALL identity rows regardless
-- of is_active. When a customer was deleted (governed_delete_customer, hard delete of the
-- customers row only) or deactivated (governed_deactivate_customer, sets customers.is_active
-- = false only), its identities row was left behind with is_active = true and the phone still
-- populated. The non-partial UNIQUE constraint therefore reserved the number forever, and a new
-- identity using that phone failed with a 23505 unique violation (and the RPC check
-- `i.is_active = true` in governed_update_customer also blocked it because the orphan stayed active).
--
-- FIX (smallest safe, database-level, concurrency-safe, preserves the soft-delete model):
--   1) Replace the full-table UNIQUE on identities.phone with a PARTIAL UNIQUE INDEX limited to
--      is_active = true. Two CURRENT (active) identities can never share a phone (enforced
--      atomically by the partial unique index => safe against concurrent assignment), while
--      inactive / historical identities no longer reserve a number.
--   2) Release the number when its owner stops using it:
--        - governed_delete_customer   -> mark the identities row is_active = false before the hard delete
--        - governed_deactivate_customer -> mark the identities row is_active = false (mirrors the
--          existing governed_deactivate_employee behaviour).
--
-- Historical identity records are preserved (no row deletion, no phone-history table): the
-- number simply becomes reusable because uniqueness is now scoped to active identities only.
-- Format validation (^01[0-9]{9}$) and the RPC duplicate message ("رقم الهاتف موجود بالفعل")
-- are unchanged. No migration below this one re-creates the old full-table constraint.

-- -----------------------------------------------------------------------------
-- 1) Uniqueness scoped to CURRENT (active) identities only
-- -----------------------------------------------------------------------------
-- Drop any full-table unique mechanism on identities.phone (covers both the auto-named
-- column constraint and any explicit index/constraint from prior environments).
ALTER TABLE public.identities DROP CONSTRAINT IF EXISTS uq_identities_phone;
ALTER TABLE public.identities DROP CONSTRAINT IF EXISTS identities_phone_key;
DROP INDEX IF EXISTS public.uq_identities_phone;
DROP INDEX IF EXISTS public.identities_phone_key;

-- Partial unique index: two current (active) identities can never share a phone.
CREATE UNIQUE INDEX IF NOT EXISTS uq_identities_phone
  ON public.identities (phone) WHERE is_active = true;

-- -----------------------------------------------------------------------------
-- 2) Delete: release the phone by deactivating the identity (hard delete of customers row)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_delete_customer(p_token uuid, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions', 'pg_catalog'
AS $function$
    DECLARE
      v_session app.sessions;
      v_customer public.customers;
      v_visible uuid[];
    BEGIN
      SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
      IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_SESSION'; END IF;
      IF NOT public.check_capability(p_token, 'customers.delete') THEN RAISE EXCEPTION 'MISSING_CAPABILITY: customers.delete'; END IF;

      SELECT * INTO v_customer FROM public.customers WHERE id = p_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;

      IF v_session.identity_type = 'employee' THEN
        v_visible := public.get_visible_employee_ids(p_token);
        IF NOT (v_customer.owner_id = ANY(v_visible)) THEN RAISE EXCEPTION 'FORBIDDEN: customer not in visibility scope'; END IF;
      ELSE
        IF v_customer.identity_id IS DISTINCT FROM v_session.identity_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
      END IF;

      -- Release the phone: deactivate the identity so the (now-)historical number is reusable
      -- under uq_identities_phone (WHERE is_active = true). No change to uniqueness otherwise.
      IF v_customer.identity_id IS NOT NULL THEN
        UPDATE public.identities SET is_active = false WHERE id = v_customer.identity_id;
      END IF;

      DELETE FROM public.customers WHERE id = p_id;
      RETURN true;
    END;
    $function$
;

-- -----------------------------------------------------------------------------
-- 3) Deactivate: release the phone by deactivating the identity (soft delete)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.governed_deactivate_customer(p_token uuid, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_session app.sessions;
  v_identity_id uuid;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  PERFORM check_capability(p_token, 'customers.manage');

  SELECT identity_id INTO v_identity_id FROM public.customers WHERE id = p_id;

  UPDATE public.customers SET is_active = false, updated_at = now() WHERE id = p_id;
  IF v_identity_id IS NOT NULL THEN
    UPDATE public.identities SET is_active = false WHERE id = v_identity_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$
;