/*
 * ============================================================================
 * UNIFIED ORDER DATA LAYER — Phase 2
 * ============================================================================
 * Single Source of Truth contracts for get_unified_order / get_unified_orders.
 * All order screens consume these types, NOT individual RPC types.
 *
 * Data source: get_unified_order RPC (Postgres jsonb → typed here).
 * ============================================================================
 */

export type DeliveryMode = 'internal' | 'external'

export type DeliveryTrackingStatus =
  | 'assigned'
  | 'out_for_delivery'
  | 'delivered'
  | 'failed'
  | 'returned'

export type CollectionStatus =
  | 'pending'
  | 'approved'
  | 'treasury_posted'

export interface UnifiedOrder {
  order: UnifiedOrderHeader
  customer: UnifiedCustomerSummary | null
  items: UnifiedOrderItem[]
  status_history: UnifiedStatusHistoryEntry[]
  modification_history: UnifiedModificationEntry[]
  current_delivery: UnifiedDeliveryTracking | null
  delivery_history: UnifiedDeliveryTracking[]
  preparation: UnifiedPreparationRecord | null
  returns: UnifiedReturnSummary[]
  collections: UnifiedCollectionSummary[]
}

export interface UnifiedOrderHeader {
  id: string
  order_number: string
  status: string
  delivery_mode: DeliveryMode
  payment_method: string
  subtotal: number
  discount_amount: number
  tax_amount: number
  total_amount: number
  notes: string | null
  revision_number: number
  last_revised_at: string | null
  customer_id: string
  owner_type: string
  owner_id: string
  created_by: string
  submitted_at: string | null
  approved_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
  deferred_until: string | null
  defer_reason: string | null
  cancel_reason: string | null
  execution_latitude: number | null
  execution_longitude: number | null
  execution_accuracy_meters: number | null
  execution_captured_at: string | null
  execution_location_id: string | null
  tier_id: string | null
  effective_discount_percent: number | null
  snapshot_customer_name: string | null
  snapshot_customer_phone: string | null
  snapshot_customer_address: string | null
  snapshot_customer_code: string | null
  snapshot_owner_name: string | null
  snapshot_owner_phone: string | null
  snapshot_owner_address: string | null
  snapshot_sender_name: string | null
  snapshot_sender_phone: string | null
  snapshot_sender_address: string | null
  customer_owner_name: string
  customer_owner_role: string
  customer_owner_id: string | null
  order_creator_name: string
  order_creator_role: string | null
  order_creator_id: string | null
  order_creator_type: string | null
  order_owner_name: string
  order_owner_role: string | null
}

export interface UnifiedCustomerSummary {
  id: string
  code: string
  company_name: string
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  governorate: string | null
  address_latitude: number | null
  address_longitude: number | null
}

export interface UnifiedOrderItem {
  id: string
  product_id: string
  product_name: string
  legacy_code: string | null
  image_url: string | null
  company_id: string | null
  company_name: string | null
  unit_type: string
  unit_quantity: number
  piece_quantity: number
  unit_price: number
  total_price: number
}

export interface UnifiedStatusHistoryEntry {
  id: string
  from_status: string | null
  to_status: string
  changed_by: string | null
  changed_at: string
  changed_by_name: string | null
}

export interface UnifiedDeliveryTracking {
  id: string
  status: DeliveryTrackingStatus
  attempt_number: number
  is_active?: boolean
  assigned_to: string | null
  assigned_by: string | null
  assigned_at: string | null
  started_at: string | null
  completed_at: string | null
  failure_reason: string | null
  failure_notes: string | null
  notes: string | null
  returned_at: string | null
  external_carrier_id: string | null
  waybill_number: string | null
  tracking_url: string | null
  delivery_mode?: DeliveryMode
  assigned_to_name: string | null
  assigned_to_phone: string | null
  external_carrier_name: string | null
  updated_at: string | null
}

export interface UnifiedPreparationRecord {
  id: string
  status: string
  started_by: string | null
  started_at: string | null
  completed_by: string | null
  completed_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  notes: string | null
}

export interface UnifiedReturnSummary {
  id: string
  code: string
  status: string
  credit_note_amount: number | null
  notes: string | null
  created_at: string
}

export interface UnifiedCollectionSummary {
  id: string
  code: string
  method: string
  amount: number
  status: CollectionStatus
  reference_number: string | null
  collected_at: string | null
  order_id: string | null
}

export interface UnifiedModificationEntry {
  id: string
  revision_number: number
  field_name: string
  old_value: string | null
  new_value: string | null
  old_order_items: any | null
  new_order_items: any | null
  old_daily_deals: any | null
  new_daily_deals: any | null
  old_flash_offers: any | null
  new_flash_offers: any | null
  modified_by: string | null
  reason: string | null
  modified_at: string
}

export interface UnifiedOrderListItem {
  id: string
  order_number: string
  status: string
  delivery_mode: DeliveryMode
  payment_method: string
  total_amount: number
  revision_number: number
  customer_id: string
  customer_name: string
  customer_code: string | null
  customer_phone: string | null
  owner_name: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  updated_at: string
  submitted_at: string | null
  approved_at: string | null
  notes: string | null
  item_count: number
  current_delivery_status: string | null
  has_collections: boolean
  customer_owner_name: string
  customer_owner_role: string
  customer_owner_id: string | null
  created_by_id: string | null
  created_by_type: string | null
}
