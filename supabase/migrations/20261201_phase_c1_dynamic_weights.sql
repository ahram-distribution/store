-- ============================================================================
-- Phase C1: Dynamic Weights Infrastructure (Infrastructure Only)
-- DATE: 2026-12-01
--
-- SCOPE:
--   1. Add orders_weight_percent to performance_weights_config (NULLABLE)
--   2. Add orders_weight_percent to employee_weight_overrides (NULLABLE)
--   3. Update get_effective_weights to include orders_weight_percent
--
-- EXPLICITLY NOT IN SCOPE:
--   - No change to get_governed_target_performance
--   - No change to any score/achievement/overall calculation
--   - No change to any visible business result
--
-- Phase C2 will:
--   - Set business-approved weight values in performance_weights_config
--   - Update get_governed_target_performance to use get_effective_weights
-- ============================================================================

-- ============================================================================
-- STEP 1: Add orders_weight_percent to performance_weights_config
-- NULLABLE — no DEFAULT. No existing data is modified.
-- The COALESCE in get_effective_weights uses a transitional value (7.5)
-- until Phase C2 sets the final business-approved value.
-- ============================================================================
ALTER TABLE public.performance_weights_config
  ADD COLUMN orders_weight_percent numeric;

COMMENT ON COLUMN public.performance_weights_config.orders_weight_percent
  IS 'NULL = use transitional COALESCE default (7.5). Phase C2 will set final business-approved value.';

-- ============================================================================
-- STEP 2: Add orders_weight_percent to employee_weight_overrides (nullable)
-- ============================================================================
ALTER TABLE public.employee_weight_overrides
  ADD COLUMN orders_weight_percent numeric;

COMMENT ON COLUMN public.employee_weight_overrides.orders_weight_percent
  IS 'Per-employee override. NULL = use config default or transitional COALESCE default.';

-- ============================================================================
-- STEP 3: Update get_effective_weights to include orders_weight_percent
--
-- This function is updated to be aware of the new column, but NO consumer
-- calls it for scoring yet. The transitional COALESCE value (7.5) matches
-- the current hardcoded behavior to ensure zero behavior change.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_effective_weights(
    p_employee_id uuid,
    p_target_month int,
    p_target_year int
)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_config public.performance_weights_config;
    v_override public.employee_weight_overrides;
    v_result jsonb;
    v_orders_default numeric := 7.5;
BEGIN
    -- TRANSITIONAL DEFAULT: orders_weight_percent defaults to 7.5 via COALESCE.
    -- This value is NOT stored in the database — it exists only in this function.
    -- Phase C2 will:
    --   1. UPDATE performance_weights_config SET orders_weight_percent = <business_value>
    --   2. This COALESCE default becomes unused once config has a non-null value

    -- First check for an active override
    SELECT * INTO v_override
    FROM public.employee_weight_overrides
    WHERE employee_id = p_employee_id
        AND target_month = p_target_month
        AND target_year = p_target_year
        AND is_active = true;

    IF FOUND THEN
        v_result := jsonb_build_object(
            'source', 'override',
            'sales_weight_percent', COALESCE(v_override.sales_weight_percent, 35),
            'collections_weight_percent', COALESCE(v_override.collections_weight_percent, 20),
            'visits_weight_percent', COALESCE(v_override.visits_weight_percent, 15),
            'orders_weight_percent', COALESCE(v_override.orders_weight_percent, v_orders_default),
            'new_customers_weight_percent', COALESCE(v_override.new_customers_weight_percent, 15),
            'attendance_weight_percent', COALESCE(v_override.attendance_weight_percent, 15)
        );
        RETURN v_result;
    END IF;

    -- Fall back to year-level config
    SELECT * INTO v_config
    FROM public.performance_weights_config
    WHERE target_year = p_target_year;

    IF FOUND THEN
        v_result := jsonb_build_object(
            'source', 'config',
            'sales_weight_percent', v_config.sales_weight_percent,
            'collections_weight_percent', v_config.collections_weight_percent,
            'visits_weight_percent', v_config.visits_weight_percent,
            'orders_weight_percent', COALESCE(v_config.orders_weight_percent, v_orders_default),
            'new_customers_weight_percent', v_config.new_customers_weight_percent,
            'attendance_weight_percent', v_config.attendance_weight_percent
        );
        RETURN v_result;
    END IF;

    -- Hardcoded defaults (no config row found at all)
    RETURN jsonb_build_object(
        'source', 'default',
        'sales_weight_percent', 35,
        'collections_weight_percent', 20,
        'visits_weight_percent', 15,
        'orders_weight_percent', v_orders_default,
        'new_customers_weight_percent', 15,
        'attendance_weight_percent', 15
    );
END;
$function$;

COMMENT ON FUNCTION public.get_effective_weights
  IS 'Infrastructure only. Returns orders_weight_percent via COALESCE(column, 7.5). No consumer uses this function for scoring until Phase C2.';
