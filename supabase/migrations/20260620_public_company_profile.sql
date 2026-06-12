-- ============================================================================
-- Public company profile RPC — accessible without authentication
-- Used by LoginPage and unauthenticated storefront visitors
-- Source: public.company_profile table (single-row, id=1)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_public_company_profile()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_row public.company_profile;
BEGIN
  SELECT * INTO v_row FROM public.company_profile WHERE id = 1;
  IF NOT FOUND THEN RETURN json_build_object('success', false, 'error', 'NOT_FOUND'); END IF;

  RETURN json_build_object(
    'success', true,
    'data', json_build_object(
      'company_name', v_row.company_name,
      'company_banner_url', v_row.company_banner_url,
      'facebook_url', v_row.facebook_url,
      'sales_phone_1', v_row.sales_phone_1,
      'sales_phone_2', v_row.sales_phone_2,
      'sales_whatsapp_1', v_row.sales_whatsapp_1,
      'sales_whatsapp_2', v_row.sales_whatsapp_2,
      'technical_support_phone', v_row.technical_support_phone,
      'is_active', v_row.is_active,
      'updated_at', v_row.updated_at
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_public_company_profile() TO anon;
