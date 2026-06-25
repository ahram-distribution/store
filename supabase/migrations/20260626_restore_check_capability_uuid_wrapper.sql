-- Fix PostgREST ambiguity: use p_uu_id (not p_token) so PostgREST sees
-- check_capability(p_token text, p_code text) as the ONLY public RPC contract.
-- The internal overload check_capability(p_uu_id uuid, p_code text) uses
-- a different parameter name, so PostgREST never confuses the two.
--
-- All 138 uuid-based internal functions resolve by argument TYPE (not param name),
-- so they still match check_capability(p_uu_id uuid, p_code text) correctly.

DROP FUNCTION IF EXISTS public.check_capability(p_token uuid, p_code text);

CREATE OR REPLACE FUNCTION public.check_capability(p_uu_id uuid, p_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  RETURN public.check_capability(p_uu_id::text, p_code);
END;
$function$;

NOTIFY pgrst, 'reload schema';
