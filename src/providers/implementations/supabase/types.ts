import type { Database as BaseDatabase } from '../../../types/database'

export interface OrderRow {
  id: string
  company_id: string
  customer_id: string
  snapshot_customer_name: string | null
  owner_id: string | null
  created_by: string | null
  status: string
  order_number: string | null
  subtotal: number
  discount_amount: number
  total_amount: number
  notes: string | null
  created_at: string
  updated_at: string
  order_items?: OrderItemRow[]
}

export interface OrderInsert {
  id?: string
  company_id: string
  customer_id: string
  snapshot_customer_name?: string | null
  owner_id?: string | null
  created_by?: string | null
  status?: string
  order_number?: string | null
  subtotal: number
  discount_amount?: number
  total_amount: number
  notes?: string | null
}

export interface OrderUpdate {
  status?: string
  snapshot_customer_name?: string | null
  owner_id?: string | null
  notes?: string | null
  subtotal?: number
  discount_amount?: number
  total_amount?: number
  updated_at?: string
}

export interface OrderItemRow {
  id: string
  order_id: string
  product_id: string
  product_name: string
  unit_type: string
  unit_price: number
  unit_quantity: number
  total_price: number
}

export interface OrderItemInsert {
  id?: string
  order_id: string
  product_id: string
  product_name: string
  unit_type: string
  unit_price: number
  unit_quantity: number
  total_price: number
}

export interface CustomerRow {
  id: string
  company_id: string
  name: string
  full_name: string | null
  phone: string | null
  customer_type: string | null
  is_active: boolean | null
  credit_limit: number | null
  outstanding_balance: number | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  governorate: string | null
  created_at: string
  updated_at: string
}

export interface CustomerInsert {
  id?: string
  company_id: string
  name: string
  full_name?: string | null
  phone?: string | null
  customer_type?: string | null
  is_active?: boolean | null
  credit_limit?: number | null
  outstanding_balance?: number | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  governorate?: string | null
}

export interface CustomerUpdate {
  name?: string
  full_name?: string | null
  is_active?: boolean | null
  credit_limit?: number | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  governorate?: string | null
}

export interface CollectionRow {
  id: string
  order_id: string
  customer_id: string | null
  method: string
  amount: number
  reference_number: string | null
  bank_name: string | null
  due_date: string | null
  status: string | null
  collected_at: string
  created_at: string
}

export interface CollectionInsert {
  id?: string
  order_id: string
  customer_id?: string | null
  method: string
  amount: number
  reference_number?: string | null
  bank_name?: string | null
  due_date?: string | null
  status?: string | null
  collected_at?: string
}

export interface CollectionUpdate {
  status?: string
  reference_number?: string | null
  bank_name?: string | null
}

export interface WorkdaySessionRow {
  session_id: string
  company_id: string
  employee_id: string
  date: string
  status: string
  started_at: string
  ended_at: string | null
  check_in_latitude: number | null
  check_in_longitude: number | null
  check_in_accuracy: number | null
  check_in_captured_at: string | null
  check_out_latitude: number | null
  check_out_longitude: number | null
  check_out_accuracy: number | null
  check_out_captured_at: string | null
  notes: string | null
}

export interface WorkdaySessionInsert {
  session_id?: string
  company_id: string
  employee_id: string
  date: string
  status?: string
  started_at?: string
  ended_at?: string | null
  check_in_latitude?: number | null
  check_in_longitude?: number | null
  check_in_accuracy?: number | null
  check_in_captured_at?: string | null
  check_out_latitude?: number | null
  check_out_longitude?: number | null
  check_out_accuracy?: number | null
  check_out_captured_at?: string | null
  notes?: string | null
}

export interface WorkdaySessionUpdate {
  status?: string
  ended_at?: string | null
  check_out_latitude?: number | null
  check_out_longitude?: number | null
  check_out_accuracy?: number | null
  check_out_captured_at?: string | null
  notes?: string | null
}

export type AppDatabase = BaseDatabase & {
  public: {
    Tables: BaseDatabase['public']['Tables'] & {
      orders: { Row: OrderRow; Insert: OrderInsert; Update: OrderUpdate }
      order_items: { Row: OrderItemRow; Insert: OrderItemInsert; Update: Record<string, never> }
      customers: { Row: CustomerRow; Insert: CustomerInsert; Update: CustomerUpdate }
      collections: { Row: CollectionRow; Insert: CollectionInsert; Update: CollectionUpdate }
      workday_sessions: { Row: WorkdaySessionRow; Insert: WorkdaySessionInsert; Update: WorkdaySessionUpdate }
    }
  }
}
