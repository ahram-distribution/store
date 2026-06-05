export type EmployeeRole =
  | 'chairman'
  | 'general_supervisor'
  | 'sales_manager'
  | 'sales_supervisor'
  | 'sales_rep'
  | 'admin'
  | 'super_admin'

export type OrderStatus =
  | 'draft'
  | 'submitted'
  | 'reviewing'
  | 'returned_for_revision'
  | 'approved'
  | 'preparing'
  | 'prepared'
  | 'ready_for_dispatch'
  | 'dispatched'
  | 'sent_to_delivery'
  | 'deferred'
  | 'cancelled'
  | 'delivered'

export type VisitStatus = 'active' | 'completed' | 'cancelled'

export type CollectionMethod = 'cash' | 'bank_transfer' | 'cheque' | 'deposit'

export type UnitType = 'piece' | 'dozen' | 'carton'

export type DealType = 'daily_deal' | 'flash_offer'

export type AuctionStatus = 'pending' | 'live' | 'ended' | 'awarded' | 'cancelled'
