import { supabase } from '../lib/supabase'

export interface PackageDealRecord {
  id: string
  packageType: 'daily_deal' | 'flash_offer'
  name: string
  description: string | null
  price: number
  availableQuantity: number
  originalQuantity: number
  startTime: string | null
  endTime: string | null
  status: string
  isManualStop: boolean
  createdAt: string
  updatedAt: string
}

function mapRow(row: any): PackageDealRecord {
  return {
    id: row.id,
    packageType: row.package_type,
    name: row.name,
    description: row.description,
    price: Number(row.price),
    availableQuantity: row.available_quantity,
    originalQuantity: row.original_quantity,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    isManualStop: row.is_manual_stop,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const dealService = {
  async getAll() {
    const { data, error } = await supabase
      .from('packages')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(mapRow)
  },

  async getActive() {
    const { data, error } = await supabase
      .from('packages')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data ?? []).map(mapRow)
  },

  async getById(id: string) {
    const { data, error } = await supabase
      .from('packages')
      .select('*, package_items(*, products(product_name))')
      .eq('id', id)
      .single()
    if (error) throw error
    return data ? mapRow(data) : null
  },
}
