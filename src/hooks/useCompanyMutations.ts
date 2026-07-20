import { supabase } from '../lib/supabase'
import { useCompaniesStore } from '../store/companies'

export interface CompanyFormData {
  company_name: string
  legacy_code: string
  logo_url: string
  is_visible: boolean
  display_order: number
  tierDiscounts: Record<string, string>
}

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

function invalidate() {
  useCompaniesStore.getState().triggerRefresh()
  try { localStorage.removeItem('ahram_company_profile_cache') } catch {}
}

export async function fetchGovernedData() {
  const token = getToken()
  if (!token) return { companies: [], tiers: [] }
  const [compRes, tiersRes] = await Promise.all([
    supabase.rpc('get_governed_companies', { p_token: token }),
    supabase.rpc('get_governed_tiers', { p_token: token }),
  ])
  return {
    companies: Array.isArray(compRes.data) ? compRes.data : [],
    tiers: Array.isArray(tiersRes.data) ? tiersRes.data : [],
  }
}

export async function createCompany(form: CompanyFormData): Promise<{ id?: string; error?: string }> {
  const token = getToken()
  if (!token) return { error: 'No session' }

  const { data, error } = await supabase.rpc('governed_create_company', {
    p_token: token,
    p_company_name: form.company_name,
    p_legacy_code: form.legacy_code,
    p_display_order: form.display_order,
  })
  if (error) return { error: error.message }
  if (data?.error) return { error: data.error }

  const targetId = data?.id

  if (targetId && (form.logo_url || !form.is_visible)) {
    await supabase.rpc('governed_update_company', {
      p_token: token,
      p_id: targetId,
      p_logo_url: form.logo_url || null,
      p_is_visible: form.is_visible,
    })
  }

  if (targetId) {
    for (const [tierId, discount] of Object.entries(form.tierDiscounts)) {
      if (discount !== undefined && discount !== '') {
        const parsed = parseFloat(discount)
        if (isNaN(parsed) || parsed < 0 || parsed > 100) continue
        await supabase.rpc('governed_set_tier_company_exception', {
          p_token: token,
          p_tier_id: tierId,
          p_company_id: targetId,
          p_discount_percent: parsed,
        })
      }
    }
  }

  invalidate()
  return { id: targetId }
}

export async function updateCompany(
  id: string,
  form: CompanyFormData,
  tiers: any[],
  existingExceptions: { tier_id: string; id: string }[],
): Promise<{ error?: string }> {
  const token = getToken()
  if (!token) return { error: 'No session' }

  const { error } = await supabase.rpc('governed_update_company', {
    p_token: token,
    p_id: id,
    p_company_name: form.company_name || null,
    p_legacy_code: form.legacy_code || null,
    p_logo_url: form.logo_url || null,
    p_is_visible: form.is_visible,
    p_display_order: form.display_order,
  })
  if (error) return { error: error.message }

  for (const tier of tiers) {
    const newDiscount = form.tierDiscounts[tier.id]
    const existingEx = existingExceptions.find((ex) => ex.tier_id === tier.id)
    if (newDiscount !== undefined && newDiscount !== '') {
      const parsed = parseFloat(newDiscount)
      if (isNaN(parsed) || parsed < 0 || parsed > 100) continue
      await supabase.rpc('governed_set_tier_company_exception', {
        p_token: token,
        p_tier_id: tier.id,
        p_company_id: id,
        p_discount_percent: parsed,
      })
    } else if (existingEx) {
      await supabase.rpc('governed_remove_tier_company_exception', {
        p_token: token,
        p_exception_id: existingEx.id,
      })
    }
  }

  invalidate()
  return {}
}

export async function deleteCompany(id: string): Promise<{ error?: string }> {
  const token = getToken()
  if (!token) return { error: 'No session' }

  const { data, error } = await supabase.rpc('governed_deletion_execute_companies', {
    p_token: token,
    p_ids: [id],
    p_dry_run: false,
  })
  if (error) return { error: error.message }
  if (data?.error) return { error: data.error }

  invalidate()
  return {}
}

export async function toggleVisibility(id: string, currentVisible: boolean): Promise<{ error?: string }> {
  const token = getToken()
  if (!token) return { error: 'No session' }

  const { error } = await supabase.rpc('governed_update_company', {
    p_token: token,
    p_id: id,
    p_is_visible: !currentVisible,
  })
  if (error) return { error: error.message }

  invalidate()
  return {}
}

export function extractTierExceptions(companyId: string, tiers: any[]) {
  const discounts: Record<string, string> = {}
  const exceptions: { tier_id: string; id: string; discount_percent: number }[] = []
  for (const tier of tiers) {
    for (const ex of (tier.company_exceptions || []).filter((e: any) => e.company_id === companyId)) {
      exceptions.push({ tier_id: tier.id, id: ex.id, discount_percent: ex.discount_percent })
      discounts[tier.id] = String(ex.discount_percent)
    }
  }
  return { discounts, exceptions }
}
