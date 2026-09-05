-- ============================================================================
-- CUSTOMER FOLLOW-UP ROLE: "متابعة العملاء"
-- ----------------------------------------------------------------------------
-- Ensures the real, assignable system role "متابعة العملاء" exists and is
-- connected to the Customer Follow-up capabilities introduced by migration
-- 0020 (followups.manage / followups.complete / followups.read / contacts.log).
--
-- This migration does NOT modify migration 0020, does NOT touch any existing
-- role, any employee-role assignment, ownership (customers.owner_id /
-- customers.created_by), sales attribution, order or inventory logic.
--
-- The role is added with the SAME lifecycle as the existing built-in roles
-- (مدير البيع / مشرف تنفيذي / مندوب مبيعات / ...): is_system = true (protected
-- from deletion by governed_delete_role, matching every existing role) and
-- attendance_classification = 'operational' (matching the operational roles).
--
-- Grant resolution mirrors the 0020 / 0016 convention: capability rows are
-- resolved by code and skipped if absent, so this migration stays idempotent
-- and order-safe (it may run before or after 0020 lands in a target DB).
--
-- OWNER ≠ FOLLOW-UP ASSIGNEE: this role grants capability-based access to the
-- Customer Follow-up module ONLY. It grants no customer-ownership or sales
-- attribution capability.
-- ============================================================================

-- 1. ROLE ----------------------------------------------------------------
-- Idempotent: only inserts when the role does not already exist.
INSERT INTO public.roles (id, name, description, is_system, created_at, attendance_classification)
SELECT
    gen_random_uuid(),
    'متابعة العملاء',
    'دور متابعة العملاء — متابعة العملاء وتتبع حالة التواصل معهم',
    true,
    now(),
    'operational'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'متابعة العملاء');

-- 2. ROLE → CAPABILITIES ------------------------------------------------
-- Grants the four Customer Follow-up capabilities to the role.
-- Mirrors the convention in 0020/0016 (resolve by code, skip if missing,
-- ON CONFLICT DO NOTHING for idempotency). Do NOT duplicate capabilities.
DO $$
DECLARE
    v_role_id uuid;
    v_cap_id uuid;
    v_code text;
    v_codes text[] := ARRAY['followups.manage','followups.complete','followups.read','contacts.log'];
BEGIN
    SELECT id INTO v_role_id FROM public.roles WHERE name = 'متابعة العملاء' LIMIT 1;
    IF v_role_id IS NULL THEN RETURN; END IF;

    FOREACH v_code IN ARRAY v_codes LOOP
        SELECT id INTO v_cap_id FROM public.capabilities WHERE code = v_code;
        IF v_cap_id IS NOT NULL THEN
            INSERT INTO public.role_capabilities (role_id, capability_id)
            VALUES (v_role_id, v_cap_id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
END $$;