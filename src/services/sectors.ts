import { supabase } from '../lib/supabase'
import type { Sector, SectorGovernorate, GeographicPriceRule, EmployeeGeographicAssignment, GeographicCustomerCount } from '../types/sectors'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

async function rpc<T>(fn: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, params)
  if (error) throw error
  return data as T
}

export const sectorsService = {
  async getSectors(search?: string): Promise<Sector[]> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    return rpc<Sector[]>('get_governed_sectors', { p_token: token, p_search: search || null })
  },

  async createSector(name: string, nameAr?: string, description?: string): Promise<string> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    return rpc<string>('governed_create_sector', {
      p_token: token, p_name: name, p_name_ar: nameAr || null, p_description: description || null,
    })
  },

  async updateSector(id: string, patch: { name?: string; name_ar?: string; description?: string; is_active?: boolean }): Promise<boolean> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    return rpc<boolean>('governed_update_sector', {
      p_token: token, p_sector_id: id,
      p_name: patch.name ?? null, p_name_ar: patch.name_ar ?? null,
      p_description: patch.description ?? null, p_is_active: patch.is_active ?? null,
    })
  },

  async deleteSector(id: string): Promise<boolean> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    return rpc<boolean>('governed_delete_sector', { p_token: token, p_sector_id: id })
  },

  async setSectorGovernorates(sectorId: string, governorateIds: string[]): Promise<number> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    return rpc<number>('governed_set_sector_governorates', {
      p_token: token, p_sector_id: sectorId, p_governorate_ids: governorateIds,
    })
  },

  async getSectorGovernorates(sectorId: string): Promise<SectorGovernorate[]> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    return rpc<SectorGovernorate[]>('get_sector_governorates', { p_token: token, p_sector_id: sectorId })
  },

  async getGeographicPriceRules(sectorId?: string, governorateId?: string): Promise<GeographicPriceRule[]> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    return rpc<GeographicPriceRule[]>('get_geographic_price_rules', {
      p_token: token, p_sector_id: sectorId || null, p_governorate_id: governorateId || null,
    })
  },

  async createGeographicPriceRule(params: {
    rule_name: string; adjustment_percent: number; scope: string;
    sector_id?: string; governorate_id?: string; company_ids?: string[]; product_ids?: string[];
  }): Promise<string> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    return rpc<string>('governed_create_geographic_price_rule', {
      p_token: token, p_rule_name: params.rule_name, p_adjustment_percent: params.adjustment_percent,
      p_scope: params.scope, p_sector_id: params.sector_id || null,
      p_governorate_id: params.governorate_id || null,
      p_company_ids: params.company_ids || [], p_product_ids: params.product_ids || [],
    })
  },

  async updateGeographicPriceRule(id: string, patch: {
    rule_name?: string; adjustment_percent?: number; is_active?: boolean;
    scope?: string; sector_id?: string; governorate_id?: string;
    company_ids?: string[] | null; product_ids?: string[] | null;
  }): Promise<boolean> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    return rpc<boolean>('governed_update_geographic_price_rule', {
      p_token: token, p_rule_id: id,
      p_rule_name: patch.rule_name ?? null, p_adjustment_percent: patch.adjustment_percent ?? null,
      p_is_active: patch.is_active ?? null, p_scope: patch.scope ?? null,
      p_sector_id: patch.sector_id ?? null, p_governorate_id: patch.governorate_id ?? null,
      p_company_ids: patch.company_ids ?? null, p_product_ids: patch.product_ids ?? null,
    })
  },

  async deleteGeographicPriceRule(id: string): Promise<boolean> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    return rpc<boolean>('governed_delete_geographic_price_rule', { p_token: token, p_rule_id: id })
  },

  async getEmployeeAssignments(employeeId: string): Promise<EmployeeGeographicAssignment[]> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    return rpc<EmployeeGeographicAssignment[]>('get_employee_geographic_assignments', {
      p_token: token, p_employee_id: employeeId,
    })
  },

  async assignEmployeeGeographic(params: {
    employee_id: string; assignment_type: string; governorate_id?: string; sector_id?: string;
  }): Promise<string> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    return rpc<string>('governed_assign_employee_geographic', {
      p_token: token, p_employee_id: params.employee_id, p_assignment_type: params.assignment_type,
      p_governorate_id: params.governorate_id || null, p_sector_id: params.sector_id || null,
    })
  },

  async removeEmployeeGeographic(assignmentId: string): Promise<boolean> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    return rpc<boolean>('governed_remove_employee_geographic', {
      p_token: token, p_assignment_id: assignmentId,
    })
  },

  async getCustomerCounts(): Promise<GeographicCustomerCount[]> {
    const token = getToken()
    if (!token) throw new Error('NO_SESSION')
    return rpc<GeographicCustomerCount[]>('get_geographic_customer_counts', { p_token: token })
  },
}
