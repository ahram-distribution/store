import { create } from 'zustand'
import { supabase } from '../lib/supabase'

export interface CompanyItem {
  id: string
  companyName: string
  logoUrl: string | null
  legacyCode: string
}

interface CompaniesState {
  refreshKey: number
  companies: CompanyItem[]
  setCompanies: (companies: CompanyItem[]) => void
  triggerRefresh: () => void
  fetchCompanyById: (companyId: string) => Promise<CompanyItem | null>
}

export const useCompaniesStore = create<CompaniesState>((set, get) => ({
  refreshKey: 0,
  companies: [],
  setCompanies: (companies) => set({ companies }),
  triggerRefresh: () => set((state) => ({ refreshKey: state.refreshKey + 1 })),
  fetchCompanyById: async (companyId: string) => {
    const cached = get().companies.find((c) => c.id === companyId)
    if (cached) return cached
    const { data, error } = await supabase
      .from('companies')
      .select('id, company_name, legacy_code, logo_url')
      .eq('id', companyId)
      .single()
    if (error || !data) return null
    const company: CompanyItem = {
      id: data.id,
      companyName: data.company_name,
      legacyCode: data.legacy_code || '',
      logoUrl: data.logo_url || null,
    }
    set((state) => ({
      companies: state.companies.some((c) => c.id === companyId)
        ? state.companies
        : [...state.companies, company],
    }))
    return company
  },
}))
