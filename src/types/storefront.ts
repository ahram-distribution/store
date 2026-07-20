export type UnitType = 'piece' | 'dozen' | 'carton'
export type OrderStatus = 'draft' | 'submitted' | 'reviewing' | 'returned_for_revision' | 'approved' | 'preparing' | 'dispatched' | 'delivered'
export type VisitStatus = 'active' | 'completed' | 'cancelled'
export type CollectionMethod = 'cash' | 'bank_transfer' | 'cheque' | 'deposit'
export type AuctionStatus = 'pending' | 'live' | 'ended' | 'awarded' | 'cancelled'

export interface CartItem {
  productId: string
  productName: string
  unitType: UnitType
  unitQuantity: number
  pieceQuantity: number
  unitPrice: number
  totalPrice: number
  imageUrl?: string
  companyId?: string
  companyName?: string
}

export interface CartDealItem {
  dealId: string
  dealTitle: string
  fixedPrice: number
  totalPrice: number
  quantity: number
  imageUrl?: string
  description?: string
}

export interface TierConfig {
  id: string
  name: string
  description: string | null
  discountPercent: number
  minimumOrderAmount: number
  iconUrl: string | null
  color: string | null
  sortOrder: number
  isActive: boolean
  isVisible: boolean
  startsAt: string | null
  endsAt: string | null
}

export interface ProductUnitPrice {
  unitType: UnitType
  price: number
}

export interface ProductWithPrice {
  id: string
  productName: string
  legacyCode: string
  cartonPrice: number
  cartonQuantity: number
  piecePrice: number
  dozenPrice: number
  isActive: boolean
  isOutOfStock: boolean
  isVisible: boolean
  imageUrl?: string
  companyId: string
  companyName: string
  unitPrices: ProductUnitPrice[]
  availableUnitTypes: UnitType[]
}

export interface ComputedPrices {
  piecePrice: number
  dozenPrice: number
  cartonPrice: number
  tierPiecePrice: number
  tierDozenPrice: number
  tierCartonPrice: number
  discountPercent: number
}

export interface CartTotals {
  subtotal: number
  tierDiscount: number
  netTotal: number
  itemCount: number
  meetsTierMinimum: boolean
  remainingForMinimum: number
  tierMinimum: number
  dealTotal: number
  productSubtotal: number
}

export interface GuidedError {
  title: string
  reason: string
  correctiveAction: string
  navigationTarget?: string
  navigationLabel?: string
}

export interface Address {
  id: string
  label: string
  street: string
  city: string
  governorate: string
  landmark?: string
  isDefault: boolean
}

export interface OrderRecord {
  id: string
  orderNumber: string
  status: OrderStatus
  subtotal: number
  discountAmount: number
  totalAmount: number
  notes?: string
  tierId?: string
  tierName?: string
  revisionNumber: number
  submittedAt?: string
  createdAt: string
  itemCount: number
}

export interface OrderItemRecord {
  id: string
  productId: string
  productName: string
  unitType: UnitType
  unitQuantity: number
  pieceQuantity: number
  unitPrice: number
  totalPrice: number
}

export interface StatusHistoryEntry {
  id: string
  fromStatus?: string
  toStatus: string
  changedBy: string
  changedByName?: string
  reason?: string
  changedAt: string
}

export interface VisitRecord {
  id: string
  customerId: string
  customerName: string
  customerPhone: string
  customerAddress?: string
  status: VisitStatus
  checkInAt?: string
  checkOutAt?: string
  result?: string
  notes?: string
}

export interface CollectionRecord {
  id: string
  customerId: string
  customerName: string
  amount: number
  method: CollectionMethod
  reference?: string
  collectedAt: string
  notes?: string
}

export interface ReturnRecord {
  id: string
  returnNumber: string
  orderId: string
  orderNumber: string
  status: string
  totalAmount: number
  createdAt: string
}

export interface EmployeeInfo {
  id: string
  name: string
  code: string
  role: string
  phone?: string
}

export interface DashboardStats {
  totalOrders: number
  totalSales: number
  totalCollections: number
  pendingVisits: number
  activeVisits: number
  totalCustomers: number
  growthPercent: number
}

export interface AuctionItemV2 {
  id: string
  product_id: string
  product_name: string
  quantity: number
}

export interface AuctionBidRecord {
  id: string
  participant_id: string
  participant_name: string
  amount: number
  is_winning: boolean
  placed_at: string
}

export interface AuctionActivityRecord {
  id: string
  activity_type: string
  actor_name: string | null
  message: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface ParticipantStatus {
  status: 'visitor' | 'registered' | 'pending' | 'approved' | 'rejected' | 'blocked'
  can_request?: boolean
  participant_id?: string
  deposit_paid?: boolean
  company_name?: string
}

export interface AuctionRecordV2 {
  id: string
  code: string
  title: string
  description: string | null
  image_url: string | null
  starting_price: number
  current_price: number
  bid_increment: number
  deposit_amount: number | null
  start_time: string
  end_time: string
  status: AuctionStatus
  winner_id: string | null
  winner_amount: number | null
  participant_count: number
  bid_count: number
  items: AuctionItemV2[]
  created_at: string
  updated_at: string
  participant_status: ParticipantStatus
}

export interface AuctionDetailRecordV2 extends AuctionRecordV2 {
  current_leader_name: string | null
  current_leader_bid: number | null
  bids: AuctionBidRecord[]
  activity: AuctionActivityRecord[]
  participant_status: ParticipantStatus
}

export interface PackageDeal {
  id: string
  name: string
  description?: string
  type: 'daily_deal' | 'flash_offer'
  price: number
  originalPrice?: number
  inventory: number
  startsAt: string
  endsAt: string
  isActive: boolean
}

export interface DailyDealItem {
  id: string
  productId: string
  productName: string
  quantity: number
}

export interface DailyDealRecord {
  id: string
  title: string
  imageUrl: string | null
  description: string | null
  fixedPrice: number
  availableQuantity: number
  originalQuantity: number
  startsAt: string | null
  endsAt: string | null
  status: 'draft' | 'scheduled' | 'active' | 'sold_out' | 'expired' | 'cancelled'
  isPurchasable?: boolean
  items: DailyDealItem[]
  createdAt?: string
  updatedAt?: string
}

export interface OrderDailyDeal {
  dealId: string
  dealTitle: string
  quantity: number
  fixedPrice: number
  totalPrice: number
  imageUrl?: string
  description?: string
}

export interface FlashOfferItem {
  id: string
  productId: string
  productName: string
  quantity: number
}

export interface FlashOfferRecord {
  id: string
  title: string
  imageUrl: string | null
  description: string | null
  fixedPrice: number
  availableQuantity: number
  originalQuantity: number
  startsAt: string | null
  endsAt: string | null
  status: 'draft' | 'scheduled' | 'active' | 'sold_out' | 'expired' | 'cancelled'
  isPurchasable?: boolean
  items: FlashOfferItem[]
  createdAt?: string
  updatedAt?: string
}

export interface CartFlashOfferItem {
  offerId: string
  offerTitle: string
  fixedPrice: number
  totalPrice: number
  quantity: number
  imageUrl?: string
  description?: string
}

export interface OrderFlashOffer {
  offerId: string
  offerTitle: string
  quantity: number
  fixedPrice: number
  totalPrice: number
  imageUrl?: string
  description?: string
}

export interface TierCompanyException {
  id: string
  companyId: string
  companyName: string
  discountPercent: number
}

export interface TierProductException {
  id: string
  productId: string
  productName: string
  discountPercent: number
  appliesToAllTiers: boolean
}

export interface TierRecord extends TierConfig {
  companyExceptions: TierCompanyException[]
  productExceptions: TierProductException[]
  createdAt?: string
  updatedAt?: string
}

export interface TierExceptionLookup {
  productException: number | null
  companyException: number | null
  tierDefault: number
}

export type CreditAccountStatus = 'active' | 'suspended' | 'closed'
export type CreditInvoiceStatus = 'open' | 'paid' | 'overdue'
export type ChequeStatus = 'received' | 'deposited' | 'collected' | 'cancelled' | 'returned' | 'paid_directly'

export interface CreditAccountRecord {
  id: string
  customer_id: string
  program_id: string
  program_name: string
  credit_limit: number
  payment_term_days: number
  outstanding_credit: number
  reserved_credit: number
  available_credit: number
  guarantee_cheque_amount: number | null
  credit_status: CreditAccountStatus
  activated_at: string
}

export interface CreditInvoiceRecord {
  id: string
  invoice_number: string
  order_id: string
  order_number: string
  invoice_amount: number
  issue_date: string
  due_date: string
  status: CreditInvoiceStatus
  days_overdue: number
  cheque_status: ChequeStatus | null
}

export interface CreditInvoiceDetailRecord {
  invoice: CreditInvoiceRecord & { customer_id: string; paid_at: string | null; created_at: string; updated_at: string }
  cheque: ChequeRecord | null
  order: { id: string; order_number: string; total_amount: number; status: string; created_at: string }
}

export interface ChequeRecord {
  id: string
  invoice_id: string
  cheque_number: string
  bank_name: string
  amount: number
  due_date: string
  status: ChequeStatus
  recorded_by: string
  recorded_at: string
}

export interface CreditDashboardStats {
  total_accounts: number
  active_accounts: number
  suspended_accounts: number
  total_outstanding: number
  total_reserved: number
  total_credit_limit: number
  open_invoices: number
  overdue_invoices: number
  pending_applications: number
}
