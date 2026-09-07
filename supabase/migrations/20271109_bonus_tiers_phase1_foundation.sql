-- ============================================================================
-- BONUS TIERS — PHASE 1: ADDITIVE DATABASE FOUNDATION
-- Companion: docs\Bonus Tiers — Final Implementation Design Review.md (approved)
--            docs\Bonus Tiers — بونص الشرائح.md (v2.2, locked business spec)
--
-- SCOPE (Phase 1 ONLY — design Section Q/M):
--   1. Global Bonus Mode setting            (app.app_settings key: bonus_mode_enabled, default false)
--   2. Bonus eligibility                    (companies.bonus_enabled + products.bonus_enabled + partial indexes)
--   3. Dedicated Bonus company              ("هدايا و بونص", legacy code 7000) — verified, no duplicates,
--                                           bonus_enabled = true, NEVER reassigns any product's company_id
--   4. Order snapshot foundation            (orders.bonus_* + order_items.is_bonus/bonus_applied_amount)
--   5. Return identification                (return_items.is_bonus)
--   6. Bonus mode audit                     (public.bonus_mode_audit — append-only)
--   7. Governed RPC foundation              (get_governed_bonus_config, governed_set_bonus_mode)
--   8. Authorization                        (mode toggle = is_upper_management ONLY; tiers.manage never toggles)
--
-- ADDITIVE-ONLY. No destructive DDL. No data rewrites. Existing orders untouched.
-- OFF-mode isolation: every new column defaults to false/NULL so direct-discount
-- behavior is byte-identical while bonus_mode_enabled = false.
-- ============================================================================

-- ============================================================================
-- 1. GLOBAL BONUS MODE SETTING
--    Default = false (existing "خصم مباشر على المنتجات" direct-discount mode).
--    Value shape follows the existing app.app_settings jsonb pattern
--    (e.g. inventory_global_policies: {"value": <bool>}).
-- ============================================================================

INSERT INTO app.app_settings (key, value, description)
VALUES (
  'bonus_mode_enabled',
  '{"value": false}'::jsonb,
  'Global bonus mode: false = direct discount (default / خصم مباشر على المنتجات), true = bonus tiers mode (بونص شرائح)'
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 2. BONUS ELIGIBILITY FLAGS (OQ-B — column-flag representation, approved)
--    Eligibility predicate (read at order creation in later phases):
--      product.bonus_enabled OR company.bonus_enabled   (via products.company_id)
--    Flag semantics are OR-only and entirely independent of Tier / Payment /
--    Shipping discount exceptions.
-- ============================================================================

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS
  bonus_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.companies.bonus_enabled IS
  'Bonus eligibility: when true, ALL products of this company are Bonus-eligible (تضاف إلى الهدايا والبونص). OR-only, independent of discount exceptions.';

CREATE INDEX IF NOT EXISTS idx_companies_bonus_enabled
  ON public.companies (bonus_enabled)
  WHERE bonus_enabled;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS
  bonus_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.products.bonus_enabled IS
  'Bonus eligibility: when true, this product is Bonus-eligible (يضاف إلى الهدايا والبونص) regardless of its company. OR-only, independent of discount exceptions.';

CREATE INDEX IF NOT EXISTS idx_products_bonus_enabled
  ON public.products (bonus_enabled)
  WHERE bonus_enabled;

-- ============================================================================
-- 3. DEDICATED BONUS COMPANY — "هدايا و بونص", legacy code 7000
--    RUNTIME VERIFIED: never creates a duplicate.
--      * If a company already exists with legacy_code '7000' (or the reserved
--        name), only bonus_enabled is set to true — nothing else is touched.
--      * Otherwise an additive row is created HIDDEN from the storefront
--        (is_visible = false) so customer-facing behavior stays unchanged
--        until the Bonus catalog is live (Phase 2+).
--    Products are NEVER physically reassigned into company 7000.
-- ============================================================================

DO $$
DECLARE
  v_company_id uuid;
  v_target_name text := 'هدايا و بونص';
  v_target_code text := '7000';
BEGIN
  -- 1) primary check by immutable legacy code
  SELECT id INTO v_company_id
  FROM public.companies
  WHERE legacy_code = v_target_code
  LIMIT 1;

  -- 2) fallback check by the reserved name (never introduce a second row)
  IF v_company_id IS NULL THEN
    SELECT id INTO v_company_id
    FROM public.companies
    WHERE company_name = v_target_name
    LIMIT 1;
  END IF;

  IF v_company_id IS NULL THEN
    -- Does not exist yet -> additive INSERT, hidden until the Bonus catalog is live.
    INSERT INTO public.companies (company_name, legacy_code, is_active, is_visible, bonus_enabled, updated_at)
    VALUES (v_target_name, v_target_code, true, false, true, now());
  ELSE
    -- Already exists -> ONLY set the eligibility flag. No rename, no re-mapping.
    UPDATE public.companies
    SET bonus_enabled = true, updated_at = now()
    WHERE id = v_company_id;
  END IF;
END;
$$;

COMMENT ON TABLE public.companies IS
  'Product manufacturers or brands. Company "هدايا و بونص" (legacy code 7000) is a Bonus/Gift catalog concept ONLY — products are never physically reassigned to it.';

-- ============================================================================
-- 4. ORDER SNAPSHOT FOUNDATION (additive, all nullable/NULL in OFF mode)
--    Written at order creation (Phase 2+ integration). Existing rows stay NULL.
-- ============================================================================

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bonus_mode_used boolean;

COMMENT ON COLUMN public.orders.bonus_mode_used IS
  'Frozen at creation: true when the order was created under Bonus mode (نظام بونص الشرائح). NULL for direct-discount orders.';

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bonus_credit numeric(12,2);

COMMENT ON COLUMN public.orders.bonus_credit IS
  'Frozen Bonus Credit entitlement (per main product: Tier + Payment + Shipping). NULL for direct-discount orders.';

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bonus_products_total numeric(12,2);

COMMENT ON COLUMN public.orders.bonus_products_total IS
  'Frozen sum of selected Bonus-product base prices in Bonus mode. NULL for direct-discount orders.';

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bonus_applied numeric(12,2);

COMMENT ON COLUMN public.orders.bonus_applied IS
  'Frozen portion of Bonus products covered by Bonus Credit (MIN(credit, bonus_products_total)). Never refunded as cash.';

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bonus_unused numeric(12,2);

COMMENT ON COLUMN public.orders.bonus_unused IS
  'Frozen unused Bonus Credit (credit - applied; expires with the order, never carried over).';

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS bonus_overflow numeric(12,2);

COMMENT ON COLUMN public.orders.bonus_overflow IS
  'Frozen overflow of Bonus products beyond Credit; payable only with explicit customer approval. NULL/non-positive when none.';

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS main_base_total numeric(12,2);

COMMENT ON COLUMN public.orders.main_base_total IS
  'Frozen geo-adjusted base total of the main (non-bonus) items — the basis Bonus Credit is computed from.';

-- ============================================================================
-- 5. ORDER ITEMS — bonus line identification + per-line covered amount
-- ============================================================================

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS
  is_bonus boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.order_items.is_bonus IS
  'True for Bonus-product lines. Authoritative identification for returns/inventory/export (reason bonus_credit tagging). Defaults false — existing lines unaffected.';

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS
  bonus_applied_amount numeric(12,2);

COMMENT ON COLUMN public.order_items.bonus_applied_amount IS
  'Frozen Bonus Credit applied to this line. Cash portion actually paid = unit_price derived total_price - bonus_applied_amount. NULL for non-bonus lines.';

-- ============================================================================
-- 6. RETURN IDENTIFICATION
-- ============================================================================

ALTER TABLE public.return_items ADD COLUMN IF NOT EXISTS
  is_bonus boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.return_items.is_bonus IS
  'Mirrors the returned order line: true when the returned item was a Bonus line. Defaults false — existing lines unaffected.';

-- ============================================================================
-- 7. BONUS MODE AUDIT (OQ-I — append-only change log)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.bonus_mode_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_by uuid NOT NULL,
  changed_by_name text,
  old_mode text,
  new_mode text NOT NULL,
  reason text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bonus_mode_audit DROP CONSTRAINT IF EXISTS fk_bonus_mode_audit_changed_by;
ALTER TABLE public.bonus_mode_audit ADD CONSTRAINT fk_bonus_mode_audit_changed_by
  FOREIGN KEY (changed_by) REFERENCES public.employees (id);

ALTER TABLE public.bonus_mode_audit DROP CONSTRAINT IF EXISTS ck_bonus_mode_audit_old;
ALTER TABLE public.bonus_mode_audit ADD CONSTRAINT ck_bonus_mode_audit_old
  CHECK (old_mode IN ('direct_discount', 'bonus_tiers') OR old_mode IS NULL);

ALTER TABLE public.bonus_mode_audit DROP CONSTRAINT IF EXISTS ck_bonus_mode_audit_new;
ALTER TABLE public.bonus_mode_audit ADD CONSTRAINT ck_bonus_mode_audit_new
  CHECK (new_mode IN ('direct_discount', 'bonus_tiers'));

CREATE INDEX IF NOT EXISTS idx_bonus_mode_audit_changed_at
  ON public.bonus_mode_audit (changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_bonus_mode_audit_changed_by
  ON public.bonus_mode_audit (changed_by);

COMMENT ON TABLE public.bonus_mode_audit IS
  'Append-only audit of global Bonus-mode toggles (actor, old mode, new mode, reason, timestamp). Records may never be updated or deleted.';
COMMENT ON COLUMN public.bonus_mode_audit.changed_by IS 'employees.id of the upper-management actor';
COMMENT ON COLUMN public.bonus_mode_audit.changed_by_name IS 'Actor full_name snapshot at toggle time';
COMMENT ON COLUMN public.bonus_mode_audit.old_mode IS 'Prior mode: direct_discount | bonus_tiers (NULL only if never recorded)';
COMMENT ON COLUMN public.bonus_mode_audit.new_mode IS 'New mode: direct_discount | bonus_tiers';
COMMENT ON COLUMN public.bonus_mode_audit.reason IS 'Obligatory admin reason for the change';

CREATE OR REPLACE FUNCTION public._prevent_bonus_mode_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RAISE EXCEPTION 'BONUS_MODE_AUDIT_IS_APPEND_ONLY';
END;
$$;

DROP TRIGGER IF EXISTS trg_bonus_mode_audit_append_only ON public.bonus_mode_audit;
CREATE TRIGGER trg_bonus_mode_audit_append_only
  BEFORE UPDATE OR DELETE ON public.bonus_mode_audit
  FOR EACH ROW EXECUTE FUNCTION public._prevent_bonus_mode_audit_mutation();

-- ============================================================================
-- 8. GOVERNED RPC FOUNDATION
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 8a. get_governed_bonus_config — read the global mode + last audit entry.
--     Read-only, any valid session. Output includes is_upper_management so the
--     admin UI can render the control correctly; the write RPC enforces auth.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_governed_bonus_config(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_mode boolean;
  v_last jsonb;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  SELECT COALESCE((value->>'value')::boolean, false)
  INTO v_mode
  FROM app.app_settings
  WHERE key = 'bonus_mode_enabled';

  SELECT jsonb_build_object(
    'old_mode', b.old_mode,
    'new_mode', b.new_mode,
    'reason', b.reason,
    'changed_by', b.changed_by,
    'changed_by_name', b.changed_by_name,
    'changed_at', b.changed_at
  )
  INTO v_last
  FROM public.bonus_mode_audit b
  ORDER BY b.changed_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'bonus_mode_enabled', COALESCE(v_mode, false),
    'mode', CASE WHEN v_mode THEN 'bonus_tiers' ELSE 'direct_discount' END,
    'last_change', v_last,
    'is_upper_management', public.is_upper_management(v_session.employee_id)
  );
END;
$$;

COMMENT ON FUNCTION public.get_governed_bonus_config IS
  'قراءة وضع بونص الشرائح العام (مفعل/مغلق) وآخر تغيير مسجل. للقراءة فقط.';

-- ----------------------------------------------------------------------------
-- 8b. governed_set_bonus_mode — toggle the global mode.
--     AUTHORIZATION: is_upper_management ONLY (role "الإدارة العليا").
--     tiers.manage MUST NOT grant this capability. Customers always FORBIDDEN.
--     Audited append-only; a no-op toggle records nothing.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.governed_set_bonus_mode(
  p_token uuid,
  p_enabled boolean,
  p_reason text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, extensions
AS $$
DECLARE
  v_session app.sessions;
  v_old_mode boolean;
  v_actor_name text;
BEGIN
  SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

  IF v_session.employee_id IS NULL OR NOT public.is_upper_management(v_session.employee_id) THEN
    RETURN jsonb_build_object('error', 'FORBIDDEN');
  END IF;

  SELECT COALESCE((value->>'value')::boolean, false)
  INTO v_old_mode
  FROM app.app_settings
  WHERE key = 'bonus_mode_enabled';

  IF v_old_mode IS NOT DISTINCT FROM p_enabled THEN
    RETURN jsonb_build_object('success', true, 'bonus_mode_enabled', p_enabled, 'changed', false);
  END IF;

  INSERT INTO app.app_settings (key, value, description, updated_at)
  VALUES (
    'bonus_mode_enabled',
    jsonb_build_object('value', p_enabled),
    'Global bonus mode: false = direct discount (default / خصم مباشر على المنتجات), true = bonus tiers mode (بونص شرائح)',
    now()
  )
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  SELECT full_name INTO v_actor_name
  FROM public.employees
  WHERE id = v_session.employee_id;

  INSERT INTO public.bonus_mode_audit (changed_by, changed_by_name, old_mode, new_mode, reason)
  VALUES (
    v_session.employee_id,
    COALESCE(v_actor_name, ''),
    CASE WHEN v_old_mode THEN 'bonus_tiers' ELSE 'direct_discount' END,
    CASE WHEN p_enabled THEN 'bonus_tiers' ELSE 'direct_discount' END,
    p_reason
  );

  RETURN jsonb_build_object('success', true, 'bonus_mode_enabled', p_enabled, 'changed', true);
END;
$$;

COMMENT ON FUNCTION public.governed_set_bonus_mode IS
  'تبديل وضع بونص الشرائح العام — صلاحية الإدارة العليا فقط. يسجل التغيير في سجل التدقيق (للإلحاق فقط).';

-- ============================================================================
-- 9. GRANTS (see 20260708_governed_rpc_execute_grants.sql rationale)
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.get_governed_bonus_config(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.governed_set_bonus_mode(uuid, boolean, text) TO authenticated, service_role;

-- ============================================================================
-- END OF PHASE 1 — BONUS TIERS ADDITIVE DATABASE FOUNDATION
-- ============================================================================