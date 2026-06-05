export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      companies: {
        Row: { id: string; company_name: string; legacy_code: string; is_active: boolean; created_at: string; updated_at: string }
        Insert: { id?: string; company_name: string; legacy_code: string; is_active?: boolean }
        Update: { company_name?: string; legacy_code?: string; is_active?: boolean }
      }
      products: {
        Row: { id: string; company_id: string; product_name: string; legacy_code: string; description: string | null; carton_quantity: number; carton_price: number; is_active: boolean; image_url: string | null; created_at: string; updated_at: string }
        Insert: { id?: string; company_id: string; product_name: string; legacy_code: string; description?: string | null; carton_quantity: number; carton_price: number; is_active?: boolean; image_url?: string | null }
        Update: { company_id?: string; product_name?: string; legacy_code?: string; description?: string | null; carton_quantity?: number; carton_price?: number; is_active?: boolean; image_url?: string | null }
      }
      product_units: {
        Row: { id: string; product_id: string; unit_type: string; is_active: boolean; created_at: string }
        Insert: { id?: string; product_id: string; unit_type: string; is_active?: boolean }
        Update: { product_id?: string; unit_type?: string; is_active?: boolean }
      }
      inventory: {
        Row: { id: string; product_id: string; quantity: number; last_counted_at: string | null; notes: string | null; updated_at: string }
        Insert: { id?: string; product_id: string; quantity?: number; notes?: string | null }
        Update: { product_id?: string; quantity?: number; notes?: string | null }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
