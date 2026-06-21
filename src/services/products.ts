import { supabase } from '../lib/supabase'

function getToken(): string | null {
  try { return localStorage.getItem('session_token') } catch { return null }
}

export interface ProductWithDetails {
  id: string
  productName: string
  companyName: string
  productCode: string
  description: string | null
  cartonPrice: number
  cartonQuantity: number
  isActive: boolean
  isOutOfStock: boolean
  salesBlocked: boolean
  imageUrl: string | null
  availableUnits: { unitCode: string; unitName: string; unitsPerParent: number; isActive: boolean }[]
  inventoryQuantity: number
}

function mapRow(row: any): ProductWithDetails {
  const productUnits = row.product_units ?? []
  const cartonPrice = Number(row.carton_price) || 0
  const cartonQuantity = Number(row.carton_quantity) || 0
  const inv = row.inventory

  return {
    id: row.id,
    productName: row.product_name,
    companyName: row.company_name ?? '',
    productCode: row.legacy_code,
    description: row.description,
    cartonPrice,
    cartonQuantity,
    isActive: row.is_active,
    isOutOfStock: row.is_out_of_stock === true && row.is_active !== false,
    salesBlocked: !row.is_active || (row.is_out_of_stock === true && row.is_active !== false) || productUnits.filter((u: any) => u.is_active !== false).length === 0 || !row.carton_price || Number(row.carton_price) <= 0,
    imageUrl: row.image_url,
    availableUnits: productUnits.filter((u: any) => u.is_active !== false).map((u: any) => ({
      unitCode: u.unit_type,
      unitName: u.unit_type === 'piece' ? 'قطعة' : u.unit_type === 'dozen' ? 'دستة' : 'كرتونة',
      unitsPerParent: u.unit_type === 'carton' ? cartonQuantity : 0,
      isActive: u.is_active,
    })),
    inventoryQuantity: inv ? Number(inv.quantity ?? 0) : 0,
  }
}

export const productService = {
  async getAll(token?: string) {
    const t = token || getToken()
    if (!t) throw new Error('NO_TOKEN')
    const { data, error } = await supabase.rpc('get_governed_products', { p_token: t })
    if (error) throw error
    const arr = Array.isArray(data) ? data : []
    return arr.map(mapRow)
  },

  async getActive(token?: string) {
    const t = token || getToken()
    if (!t) throw new Error('NO_TOKEN')
    const { data, error } = await supabase.rpc('get_governed_products', { p_token: t, p_active_only: true })
    if (error) throw error
    const arr = Array.isArray(data) ? data : []
    return arr.map(mapRow)
  },

  async getById(id: string, token?: string) {
    const t = token || getToken()
    if (!t) throw new Error('NO_TOKEN')
    const { data, error } = await supabase.rpc('get_governed_products', { p_token: t, p_active_only: false, p_visible_only: false })
    if (error) throw error
    const arr = Array.isArray(data) ? data : []
    const found = arr.find((p: any) => p.id === id)
    return found ? mapRow(found) : null
  },

  async search(query: string, token?: string) {
    const t = token || getToken()
    if (!t) throw new Error('NO_TOKEN')
    const { data, error } = await supabase.rpc('get_governed_products', { p_token: t, p_search: query, p_active_only: false })
    if (error) throw error
    const arr = Array.isArray(data) ? data : []
    return arr.map(mapRow)
  },
}
