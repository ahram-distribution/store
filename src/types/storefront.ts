export type UnitType = 'piece' | 'dozen' | 'carton'
export type OrderStatus = 'submitted' | 'approved' | 'reviewing' | 'preparing' | 'prepared' | 'delivered' | 'returned_for_revision' | 'cancelled'
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
  geoAdjustPercent?: number
  baseUnitPrice?: number
  isBonus?: boolean
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
  minimumCompanyCount: number | null
  maxCompanyPurchasePercent: number | null
  iconUrl: string | null
  color: string | null
  sortOrder: number
  isActive: boolean
  isVisible: boolean
  startsAt: string | null
  endsAt: string | null
}

export interface PaymentOptionException {
  id: string
  companyId: string
  companyName: string
  discountPercent: number
}

export interface PaymentProductException {
  id: string
  productId: string
  productName: string
  discountPercent: number
}

export interface ShippingOptionException {
  id: string
  companyId: string
  companyName: string
  discountPercent: number
}

export interface ShippingProductException {
  id: string
  productId: string
  productName: string
  discountPercent: number
}

export interface PaymentMethodOption {
  id: string
  name: string
  discountPercent: number
  sortOrder: number
  isVisible: boolean
  isActive: boolean
  updatedAt?: string
  companyExceptions?: PaymentOptionException[]
  productExceptions?: PaymentProductException[]
}

export interface ShippingMethodOption {
  id: string
  name: string
  discountPercent: number
  sortOrder: number
  isVisible: boolean
  isActive: boolean
  updatedAt?: string
  companyExceptions?: ShippingOptionException[]
  productExceptions?: ShippingProductException[]
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
  companyLegacyCode?: string
  bonusEnabled?: boolean
  companyBonusEnabled?: boolean
  unitPrices: ProductUnitPrice[]
  availableUnitTypes: UnitType[]
  recentlyAvailableAt?: string
}

export interface ComputedPrices {
  piecePrice: number
  dozenPrice: number
  cartonPrice: number
  tierPiecePrice: number
  tierDozenPrice: number
  tierCartonPrice: number
  discountPercent: number
  paymentDiscountPercent: number
  shippingDiscountPercent: number
  totalDiscountPercent: number
  finalPiecePrice: number
  finalDozenPrice: number
  finalCartonPrice: number
}

export interface CompanyRuleBreakdown {
  companyId: string
  companyName: string
  value: number
  /** Share of the SELECTED TIER value (never the cart subtotal). */
  percent: number
  maxPercent: number | null
  /** tier.minimumOrderAmount × maxCompanyPurchasePercent / 100 (fixed limit). */
  maxCompanyValue: number | null
  exceedsCap: boolean
}

export interface CompanyRuleResult {
  minimumCompanyCount: number | null
  maxCompanyPurchasePercent: number | null
  /** The selected Tier's value that the per-company maximum is derived from. */
  tierValue?: number
  /** Fixed per-company limit = tierValue × maxCompanyPurchasePercent / 100. */
  maxCompanyValue?: number
  distinctCompanyCount: number
  meetsMinimumCompanies: boolean
  meetsCompanyCaps: boolean
  companies: CompanyRuleBreakdown[]
}

/** Result of the governed company-maximum add guard (used by the Cart + button
 *  and the governed store actions). Evaluated against MAIN products only.
 *  The per-company limit is derived from the SELECTED TIER value, never from
 *  the cart subtotal:  maxCompanyValue = tierValue × maxPercent / 100. */
export interface CompanyAddGuardResult {
  blocked: boolean
  reason: 'company-max' | null
  /** True when the selected Tier has no company cap (unlimited / no tier value /
   *  0%) → nothing to guard. Also true when the target is a Bonus line, which is
   *  a complete exception from the diversification rule (see bonusBypass). */
  unlimited: boolean
  /** True when the target line is a BONUS product (is_bonus = true): company
   *  diversification is bypassed entirely — the operation is governed only by
   *  Bonus-specific rules (Bonus Credit, inventory, entitlement). */
  bonusBypass?: boolean
  /** The selected Tier's value the maximum was derived from. */
  tierValue?: number
  companyId?: string
  companyName?: string
  maxPercent?: number
  /** Fixed per-company limit = tierValue × maxPercent / 100. */
  maxCompanyValue?: number
  /** The judged company's value in the CANDIDATE (resulting) state. */
  companyValue?: number
  /** The judged company's value BEFORE the operation (pre-candidate). */
  currentCompanyValue?: number
  /** Remaining allowance for the judged company = max(0, max − current). */
  room?: number
  /** Whole units this target line may hold (0 = even the current qty is over-cap). */
  maxAllowedUnits?: number
}

/**
 * Resolved per-benefit-group rates for the order's MAIN products plus a
 * uniformity flag. `uniform: true` means every main product resolves to the
 * SAME effective Tier/Payment/Shipping group — only then is a single order-wide
 * percentage honest. Heterogeneous carts must never show one global rate.
 */
export interface OrderBenefitRates {
  uniform: boolean
  tierPct: number
  payPct: number
  shipPct: number
  /** Meaningful only when `uniform` is true (else 0). */
  sumPct: number
}

export interface CartTotals {
  subtotal: number
  totalDiscount: number
  tierDiscount: number
  paymentDiscount: number
  shippingDiscount: number
  totalDiscountPercent: number
  netTotal: number
  itemCount: number
  meetsTierMinimum: boolean
  remainingForMinimum: number
  tierMinimum: number
  dealTotal: number
  productSubtotal: number
  productBaseSubtotal: number
  companyRule: CompanyRuleResult | null
  meetsCompanyRules: boolean
  /** Effective per-group rates after manual-exception resolution (one source of truth). */
  benefitRates?: OrderBenefitRates
  bonusMode?: boolean
  bonusCredit?: number
  bonusApplied?: number
  bonusUnused?: number
  bonusOverflow?: number
  bonusProductsTotal?: number
  mainBaseTotal?: number
  bonusSummary?: BonusSummary
}

/** Per-main-product entitlement: the money value its resolved combined % produces. */
export interface BonusItemEntitlement {
  productId: string
  productName: string
  baseValue: number
  tierPercent: number
  paymentPercent: number
  shippingPercent: number
  combinedPercent: number
  credit: number
}

/** Bonus Credit = Σ per-main-product entitlements (D-O2), with per-group breakdown. */
export interface BonusCreditResult {
  mainBaseTotal: number
  totalBonusCredit: number
  tierCredit: number
  paymentCredit: number
  shippingCredit: number
  items: BonusItemEntitlement[]
}

/** Complete bonus-mode accounting for an order (spec §13.3, §24.2, company rules). */
export interface BonusSummary extends BonusCreditResult {
  bonusProductsTotal: number
  bonusApplied: number
  bonusUnused: number
  bonusOverflow: number
  finalPayable: number
  tierMinimum: number
  meetsTierMinimum: boolean
  remainingForMinimum: number
  companyRule: CompanyRuleResult | null
  meetsCompanyRules: boolean
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

export interface DiscountOverridePair {
  productException: number | null
  companyException: number | null
}

export interface TierExceptionLookup {
  productException: number | null
  companyException: number | null
  tierDefault: number
  paymentOverride?: DiscountOverridePair | null
  shippingOverride?: DiscountOverridePair | null
}
