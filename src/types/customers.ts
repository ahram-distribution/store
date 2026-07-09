export interface CustomerCardData {
  id: string
  code: string
  company_name: string
  responsible_name: string | null
  business_type: string | null
  email: string | null
  phone: string | null
  credit_limit: number | null
  credit_days: number | null
  owner_id: string | null
  owner_name: string | null
  is_active: boolean
  location_id: string | null
  registered_address: string | null
  location_address: string | null
  registered_at: string | null
  created_at: string

  previous_order_count: number | null
  previous_orders_total: number | null
  last_order_number: string | null
  last_order_date: string | null
  last_visit_date: string | null
  visit_count: number | null
  current_balance: number | null
}
