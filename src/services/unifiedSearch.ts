import { supabase } from '../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export type SearchEntity = 'products' | 'customers' | 'employees' | 'orders' | 'visits' | 'collections'

export interface UnifiedSearchResult<T = any> {
  data: T[]
  total: number
  page: number
  per_page: number
  query?: string
  error?: string
}

export const unifiedSearchService = {
  async search<T = any>(
    entity: SearchEntity,
    query?: string,
    filters?: Record<string, any>,
    page = 1,
    perPage = 50
  ): Promise<UnifiedSearchResult<T>> {
    const token = getToken()
    if (!token) throw new Error('NO_TOKEN')

    const { data, error } = await supabase.rpc('unified_search', {
      p_token: token,
      p_entity: entity,
      p_query: query || null,
      p_filters: filters || {},
      p_page: page,
      p_per_page: perPage,
      p_order_by: 'relevance',
    })

    if (error) throw error
    const result = data as UnifiedSearchResult<T>
    return result
  },
}
