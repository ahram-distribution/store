-- ============================================================================
-- SEED: Auto-create monthly targets for sales reps without targets
-- DATE: 2026-06-24
-- Creates default targets for active sales reps who don't have targets
-- for the current month. Skips الإدارة العليا, مدير البيع, and supervisor
-- roles.
-- Default values: sales=5,000,000, orders=250, visits=250, new_customers=30
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_sales_rep_monthly_targets(
    p_token uuid,
    p_month int DEFAULT NULL,
    p_year int DEFAULT NULL,
    p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_session app.sessions;
    v_target_month int;
    v_target_year int;
    v_rep record;
    v_created int := 0;
    v_skipped int := 0;
    v_already_had int := 0;
    v_created_names text[] := '{}'::text[];
    v_skipped_names text[] := '{}'::text[];
    v_already_names text[] := '{}'::text[];
    v_total_reps int := 0;
    v_reps_with_targets int := 0;
    v_reps_without_targets int := 0;
BEGIN
    SELECT * INTO v_session FROM app.sessions WHERE token = p_token AND expires_at > now();
    IF NOT FOUND THEN RETURN jsonb_build_object('error', 'INVALID_SESSION'); END IF;

    v_target_month := COALESCE(p_month, EXTRACT(MONTH FROM CURRENT_DATE)::int);
    v_target_year := COALESCE(p_year, EXTRACT(YEAR FROM CURRENT_DATE)::int);

    FOR v_rep IN
        WITH rep_candidates AS (
            SELECT e.id, e.code, e.full_name
            FROM public.employees e
            WHERE e.is_active = true
              AND EXISTS (
                  SELECT 1 FROM public.employee_roles er
                  JOIN public.roles r ON r.id = er.role_id
                  WHERE er.employee_id = e.id AND r.name = 'مندوب مبيعات'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM public.employee_roles er
                  JOIN public.roles r ON r.id = er.role_id
                  WHERE er.employee_id = e.id
                    AND r.name IN (
                        'الإدارة العليا', 'SUPER_ADMIN', 'ADMIN',
                        'مدير البيع', 'مدير تنفيذي',
                        'مشرف مبيعات', 'مشرف تنفيذي', 'مشرف عام',
                        'مدير عمليات تنفيذية'
                    )
              )
        )
        SELECT rc.*,
               CASE WHEN et.id IS NOT NULL THEN true ELSE false END AS has_target
        FROM rep_candidates rc
        LEFT JOIN public.employee_monthly_targets et
            ON et.employee_id = rc.id
            AND et.target_month = v_target_month
            AND et.target_year = v_target_year
        ORDER BY rc.full_name
    LOOP
        v_total_reps := v_total_reps + 1;

        IF v_rep.has_target THEN
            v_reps_with_targets := v_reps_with_targets + 1;
            v_already_had := v_already_had + 1;
            v_already_names := array_append(v_already_names, v_rep.full_name || ' (' || v_rep.code || ')');
        ELSE
            v_reps_without_targets := v_reps_without_targets + 1;

            IF NOT p_dry_run THEN
                INSERT INTO public.employee_monthly_targets
                    (employee_id, target_month, target_year,
                     sales_target, visits_target, orders_target, new_customers_target)
                VALUES
                    (v_rep.id, v_target_month, v_target_year,
                     5000000, 250, 250, 30)
                ON CONFLICT (employee_id, target_month, target_year)
                DO NOTHING;

                IF FOUND THEN
                    v_created := v_created + 1;
                    v_created_names := array_append(v_created_names, v_rep.full_name || ' (' || v_rep.code || ')');
                ELSE
                    v_skipped := v_skipped + 1;
                    v_skipped_names := array_append(v_skipped_names, v_rep.full_name || ' (' || v_rep.code || ')');
                END IF;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'dry_run', p_dry_run,
        'month', v_target_month,
        'year', v_target_year,
        'total_sales_reps', v_total_reps,
        'reps_with_targets', v_reps_with_targets,
        'reps_without_targets', v_reps_without_targets,
        'created', CASE WHEN p_dry_run THEN 0 ELSE v_created END,
        'skipped', CASE WHEN p_dry_run THEN 0 ELSE v_skipped END,
        'missing_list', COALESCE(CASE WHEN p_dry_run THEN
            (SELECT array_agg(full_name || ' (' || code || ')') FROM (
                SELECT e2.full_name, e2.code
                FROM public.employees e2
                WHERE e2.is_active = true
                  AND EXISTS (
                      SELECT 1 FROM public.employee_roles er2
                      JOIN public.roles r2 ON r2.id = er2.role_id
                      WHERE er2.employee_id = e2.id AND r2.name = 'مندوب مبيعات'
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM public.employee_roles er2
                      JOIN public.roles r2 ON r2.id = er2.role_id
                      WHERE er2.employee_id = e2.id
                        AND r2.name IN (
                            'الإدارة العليا', 'SUPER_ADMIN', 'ADMIN',
                            'مدير البيع', 'مدير تنفيذي',
                            'مشرف مبيعات', 'مشرف تنفيذي', 'مشرف عام',
                            'مدير عمليات تنفيذية'
                        )
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM public.employee_monthly_targets et2
                      WHERE et2.employee_id = e2.id
                        AND et2.target_month = v_target_month
                        AND et2.target_year = v_target_year
                  )
            ) missing
        ) ELSE v_created_names END, '{}'::text[]),
        'already_list', COALESCE(v_already_names, '{}'::text[]),
        'message', CASE
            WHEN p_dry_run THEN 'وضع المعاينة: ' || v_reps_without_targets || ' مندوب بدون هدف — جاهز للإنشاء'
            WHEN v_created > 0 THEN 'تم إنشاء ' || v_created || ' هدف للمناديب'
            ELSE 'جميع المناديب لديهم أهداف بالفعل'
        END
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.seed_sales_rep_monthly_targets TO authenticated;
