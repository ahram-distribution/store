import { supabase } from '../lib/supabase'

/* Non-Negotiable Rule #9 — Sales is never a separate entity.
   Sales KPI reuses orders data. The drill-down for Sales
   resolves to the same orders records. */

export interface BusinessDetailParams {
  employeeId: string
  kpiType: string
  from: string
  to: string
  token: string
}

export interface BusinessDetailResult {
  records: any[]
  recordType: string
}

export async function getBusinessDetailData(params: BusinessDetailParams): Promise<BusinessDetailResult> {
  const recordType = params.kpiType === 'sales' ? 'orders' : params.kpiType

  const { data, error } = await supabase.rpc('get_employee_detail_data', {
    p_token: params.token,
    p_employee_id: params.employeeId,
    p_from: params.from,
    p_to: params.to,
  })

  if (error) {
    return { records: [], recordType }
  }

  return {
    records: (data as any)?.[recordType] || [],
    recordType,
  }
}
