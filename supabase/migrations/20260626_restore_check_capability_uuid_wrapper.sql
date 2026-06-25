-- Quick fix: restore check_capability(uuid, text) overload
-- All 138 uuid-based callers need this until the UUID→TEXT migration project converts them.
-- This is a pure delegation wrapper — no business logic.

CREATE OR REPLACE FUNCTION public.check_capability(p_token uuid, p_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN public.check_capability(p_token::text, p_code);
END;
$function$;

NOTIFY pgrst, 'reload schema';
