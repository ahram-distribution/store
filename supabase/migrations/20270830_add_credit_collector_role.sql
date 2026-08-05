-- ============================================================================
-- Migration: add Credit Collector role (معتمد ائتماني)
--
-- Creates the real database role "معتمد ائتماني" using the existing roles
-- system (public.roles + employee_roles assignment) so it can be assigned to
-- employees from the roles admin UI exactly like any other role.
-- ============================================================================

INSERT INTO public.roles (name, description, is_system)
SELECT 'معتمد ائتماني', 'يتولى متابعة فواتير الائتمان وتسجيل تحصيلاتها ميدانياً مع إحداثيات الموقع', false
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'معتمد ائتماني');

COMMENT ON TABLE public.roles IS 'Dynamic role definitions. Roles are stored as data, not hardcoded.';
