# 10 – Provider Interfaces

**التصنيف:** تصميم معماري — واجهات مزود البيانات  
**الغرض:** توثيق جميع واجهات Data Provider Layer مع التوقيعات الكاملة  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** مسودة للاعتماد

---

## 1. المبادئ

1. **كل Interface يصف قدرة (Capability)** — ليس بالضرورة مطابقاً لجدول في قاعدة البيانات
2. **كل Interface مقيد بنوع (Generic)** — `IProvider<T>` حيث T هو الـ Model
3. **لا Interface يعتمد على Supabase** — لا `PostgrestFilter`, لا `SupabaseClient`
4. **كل Interface يوفر أخطاء محددة** — `ProviderException` أو مشتقاته
5. **كل Interface يدعم Pagination, Filtering, Sorting** بشكل موحد

---

## 2. الـ Interfaces الأساسية

### 2.1 Base Provider

```typescript
// src/providers/contracts/IProvider.ts

interface IProvider {
  readonly name: string
  readonly status: ProviderStatus  // 'connected' | 'disconnected' | 'error'

  connect(): Promise<void>
  disconnect(): Promise<void>
  healthCheck(): Promise<HealthCheckResult>
}

enum ProviderStatus {
  Connected = 'connected',
  Disconnected = 'disconnected',
  Error = 'error',
  Suspended = 'suspended'
}

interface HealthCheckResult {
  status: ProviderStatus
  latencyMs: number
  message?: string
  timestamp: Date
}
```

### 2.2 CRUD Provider (الأكثر استخداماً)

```typescript
// src/providers/contracts/ICrudProvider.ts

interface ICrudProvider<T, TFilter, TId = string>
  extends IProvider {

  getById(id: TId): Promise<T>

  getAll(filter?: TFilter): Promise<PaginatedResult<T>>

  create(data: Partial<T>): Promise<T>

  update(id: TId, data: Partial<T>): Promise<T>

  delete(id: TId): Promise<void>

  count(filter?: TFilter): Promise<number>

  exists(id: TId): Promise<boolean>
}

interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface IFilter {
  page?: number
  pageSize?: number
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
  search?: string
}
```

### 2.3 Read-Only Provider (للحالات التي لا نكتب فيها)

```typescript
// src/providers/contracts/IReadOnlyProvider.ts

interface IReadOnlyProvider<T, TFilter, TId = string>
  extends IProvider {

  getById(id: TId): Promise<T>

  getAll(filter?: TFilter): Promise<PaginatedResult<T>>

  count(filter?: TFilter): Promise<number>

  exists(id: TId): Promise<boolean>
}
```

---

## 3. الـ Interfaces الخاصة بالكيان

### 3.1 IOrderProvider

```typescript
// src/providers/contracts/IOrderProvider.ts

interface IOrderProvider
  extends ICrudProvider<Order, OrderFilter> {

  // حالات الطلب (State Machine)
  submit(id: string): Promise<Order>
  approve(id: string, notes?: string): Promise<Order>
  reject(id: string, reason: string): Promise<Order>
  prepare(id: string): Promise<Order>
  dispatch(id: string): Promise<Order>
  deliver(id: string): Promise<Order>
  cancel(id: string, reason: string): Promise<Order>

  // استعلامات خاصة
  getByCustomer(customerId: string): Promise<PaginatedResult<Order>>
  getByStatus(status: OrderStatus): Promise<PaginatedResult<Order>>
  getPendingApprovals(): Promise<PaginatedResult<Order>>
  getByDateRange(from: Date, to: Date): Promise<PaginatedResult<Order>>

  // إحصائيات
  getOrderStats(filter?: OrderStatsFilter): Promise<OrderStats>
}

interface OrderFilter extends IFilter {
  customerId?: string
  status?: OrderStatus
  fromDate?: Date
  toDate?: Date
  employeeId?: string
  minTotal?: number
  maxTotal?: number
}

interface OrderStats {
  totalOrders: number
  totalValue: number
  averageValue: number
  byStatus: Record<OrderStatus, number>
  byDate: { date: string; count: number; value: number }[]
}

// Domain Model
interface Order {
  id: string
  customerId: string
  customerName: string
  employeeId: string
  items: OrderItem[]
  total: number
  discount: number
  netTotal: number
  status: OrderStatus
  notes?: string
  createdAt: Date
  updatedAt: Date
  statusHistory: StatusChange[]
}

interface OrderItem {
  productId: string
  productName: string
  quantity: number
  unitType: UnitType
  unitPrice: number
  totalPrice: number
}

enum OrderStatus {
  Draft = 'draft',
  Submitted = 'submitted',
  Reviewing = 'reviewing',
  Approved = 'approved',
  Rejected = 'rejected',
  Preparing = 'preparing',
  Dispatched = 'dispatched',
  Delivered = 'delivered',
  Cancelled = 'cancelled'
}
```

### 3.2 IProductProvider

```typescript
// src/providers/contracts/IProductProvider.ts

interface IProductProvider
  extends ICrudProvider<Product, ProductFilter> {

  search(query: string): Promise<Product[]>
  getByCategory(categoryId: string): Promise<PaginatedResult<Product>>
  getActive(): Promise<PaginatedResult<Product>>
  getVisible(): Promise<PaginatedResult<Product>>
  getByPriceRange(min: number, max: number): Promise<PaginatedResult<Product>>
  getWithStock(filter?: ProductFilter): Promise<PaginatedResult<ProductWithStock>>
}

interface ProductFilter extends IFilter {
  activeOnly?: boolean
  visibleOnly?: boolean
  categoryId?: string
  searchQuery?: string
  governScope?: GovernScope  // حوكمة الوصول
  companyId?: string
}

interface Product {
  id: string
  name: string
  categoryId: string
  categoryName: string
  barcode?: string
  cartonQuantity: number
  cartonPrice: number
  piecePrice: number
  unitType: string
  isActive: boolean
  isVisible: boolean
  imageUrl?: string
  createdAt: Date
  updatedAt: Date
}

interface ProductWithStock extends Product {
  currentStock: number
  reservedStock: number
  availableStock: number
}
```

### 3.3 ICustomerProvider

```typescript
// src/providers/contracts/ICustomerProvider.ts

interface ICustomerProvider
  extends ICrudProvider<Customer, CustomerFilter> {

  search(query: string): Promise<Customer[]>
  getByPhone(phone: string): Promise<Customer | null>
  getByRoute(routeId: string): Promise<PaginatedResult<Customer>>
  getTopCustomers(limit: number): Promise<CustomerSummary[]>
  getCustomerStats(customerId: string): Promise<CustomerStats>
}

interface CustomerFilter extends IFilter {
  routeId?: string
  customerType?: CustomerType
  phone?: string
  companyId?: string
}

interface Customer {
  id: string
  name: string
  phone: string
  address?: string
  routeId?: string
  routeName?: string
  customerType: CustomerType
  creditLimit: number
  currentBalance: number
  companyId: string
  isActive: boolean
  createdAt: Date
}

interface CustomerStats {
  totalOrders: number
  totalSpent: number
  averageOrderValue: number
  lastOrderDate?: Date
  outstandingBalance: number
  overdueBalance: number
}
```

### 3.4 ICreditProvider

```typescript
// src/providers/contracts/ICreditProvider.ts

interface ICreditProvider
  extends IProvider {

  // الرصيد
  getBalance(customerId: string): Promise<CreditBalance>
  getTransactions(customerId: string, filter?: CreditFilter): Promise<PaginatedResult<CreditTransaction>>

  // الحجز
  reserve(customerId: string, amount: number, referenceId: string): Promise<CreditReservation>
  releaseReservation(reservationId: string): Promise<void>
  convertToOutstanding(reservationId: string): Promise<void>

  // السداد
  recordPayment(customerId: string, amount: number, method: PaymentMethod): Promise<Payment>
  getOutstanding(customerId: string): Promise<OutstandingBalance>

  // الشيكات
  registerCheck(check: CheckDTO): Promise<Check>
  depositCheck(checkId: string): Promise<Check>
  bounceCheck(checkId: string, reason: string): Promise<Check>

  // برامج الائتمان (Credit Programs)
  getPrograms(): Promise<CreditProgram[]>
  enrollCustomer(customerId: string, programId: string): Promise<void>

  // التحقق
  checkOrderOverLimit(customerId: string, orderTotal: number): Promise<boolean>
}

interface CreditBalance {
  customerId: string
  totalLimit: number
  usedAmount: number
  availableAmount: number
  outstandingAmount: number
}

interface CreditReservation {
  id: string
  customerId: string
  amount: number
  status: 'active' | 'converted' | 'released'
  referenceId: string
  createdAt: Date
  expiresAt: Date
}

interface CreditFilter extends IFilter {
  type?: TransactionType
  fromDate?: Date
  toDate?: Date
  minAmount?: number
  maxAmount?: number
}
```

### 3.5 IAttendanceProvider

```typescript
// src/providers/contracts/IAttendanceProvider.ts

interface IAttendanceProvider
  extends IProvider {

  // يوم العمل
  startWorkday(employeeId: string, location: GpsLocation): Promise<Workday>
  endWorkday(workdayId: string, location: GpsLocation): Promise<Workday>
  getWorkdayStatus(employeeId: string): Promise<WorkdayStatus>

  // الاستراحة
  startBreak(workdayId: string): Promise<BreakPeriod>
  endBreak(breakId: string): Promise<BreakPeriod>

  // التقارير
  getAttendanceReport(employeeId: string, from: Date, to: Date): Promise<AttendanceReport>
  getMyAttendance(filter?: AttendanceFilter): Promise<PaginatedResult<Workday>>

  // إحصائيات
  getStats(employeeId: string, from: Date, to: Date): Promise<AttendanceStats>
}

interface Workday {
  id: string
  employeeId: string
  startTime: Date
  endTime?: Date
  startLocation: GpsLocation
  endLocation?: GpsLocation
  breaks: BreakPeriod[]
  netWorkHours: number
  status: WorkdayStatus
}

enum WorkdayStatus {
  Active = 'active',
  Completed = 'completed',
  Interrupted = 'interrupted'
}

interface GpsLocation {
  latitude: number
  longitude: number
  accuracy?: number
  timestamp: Date
}
```

### 3.6 IUserProvider (Auth + Identity)

```typescript
// src/providers/contracts/IUserProvider.ts

interface IUserProvider
  extends IProvider {

  // المصادقة
  login(credentials: LoginRequest): Promise<Session>
  logout(token: string): Promise<void>
  validateSession(token: string): Promise<SessionValidation>

  // المستخدمين
  getProfile(identityId: string): Promise<UserProfile>
  updateProfile(identityId: string, data: Partial<UserProfile>): Promise<UserProfile>

  // الصلاحيات
  getCapabilities(identityId: string): Promise<string[]>
  checkCapability(identityId: string, code: string): Promise<boolean>

  // الأدوار
  getRoles(identityId: string): Promise<Role[]>

  // الإدارة
  createUser(data: CreateUserRequest): Promise<User>
  deactivateUser(userId: string): Promise<void>
}

interface Session {
  token: string
  identityId: string
  identityType: 'employee' | 'customer'
  roles: string[]
  companyId?: string
  companyName?: string
  employeeId?: string
  customerId?: string
  expiresAt: Date
}

interface LoginRequest {
  phone: string
  password: string
}

interface UserProfile {
  identityId: string
  fullName: string
  phone: string
  identityType: 'employee' | 'customer'
  roles: string[]
  companyName?: string
  avatarUrl?: string
}
```

### 3.7 ITrackingProvider (GPS Tracking)

```typescript
// src/providers/contracts/ITrackingProvider.ts

interface ITrackingProvider
  extends IProvider {

  syncTrackingPoints(points: TrackingPoint[]): Promise<void>
  recordHeartbeat(employeeId: string, workdayId: string): Promise<HeartbeatResponse>
  getLastTracking(employeeId: string): Promise<TrackingPoint | null>
  getRoute(employeeId: string, date: Date): Promise<TrackingPoint[]>
}

interface TrackingPoint {
  employeeId: string
  workdayId: string
  latitude: number
  longitude: number
  accuracy: number
  batteryLevel?: number
  timestamp: Date
}

interface HeartbeatResponse {
  sessionActive: boolean
  lastHeartbeat: Date
  timeoutWarning: boolean
}
```

### 3.8 IDealProvider (العروض والخصومات)

```typescript
// src/providers/contracts/IDealProvider.ts

interface IDealProvider
  extends ICrudProvider<Deal, DealFilter> {

  getActive(): Promise<PaginatedResult<Deal>>
}

interface IFlashOfferProvider
  extends ICrudProvider<FlashOffer, FlashOfferFilter> {

  getActive(): Promise<PaginatedResult<FlashOffer>>
}

interface IDailyDealProvider
  extends ICrudProvider<DailyDeal, DailyDealFilter> {

  getToday(): Promise<PaginatedResult<DailyDeal>>
}

interface ITierProvider
  extends ICrudProvider<Tier, TierFilter> {

  getByCompany(companyId: string): Promise<Tier | null>
  getExceptions(tierId: string): Promise<TierException[]>
}
```

### 3.9 ICacheProvider

```typescript
// src/providers/contracts/ICacheProvider.ts

interface ICacheProvider extends IProvider {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
  invalidateByPrefix(prefix: string): Promise<void>
}
```

---

## 4. Unit of Work Interface

```typescript
// src/providers/contracts/IUnitOfWork.ts

interface IUnitOfWork {
  begin(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>
  isActive: boolean

  // ربط Provider بـ UoW
  register(provider: ITransactionalProvider): void
}

interface ITransactionalProvider {
  supportsTransactions: boolean

  // تستدعيها الـ UoW داخلياً
  onBegin(): Promise<void>
  onCommit(): Promise<void>
  onRollback(): Promise<void>
}
```

---

## 5. Provider Registry Interface

```typescript
// src/providers/contracts/IProviderRegistry.ts

interface IProviderRegistry {
  // التسجيل
  register<T extends IProvider>(name: string, provider: T): void
  registerMultiple(providers: ProviderRegistration[]): void

  // الاستعلام
  resolve<T extends IProvider>(name: string): T
  resolveOrNull<T extends IProvider>(name: string): T | null

  // الإدارة
  setDefault(name: string): void
  getDefault(): string
  getAllProviders(): Map<string, IProvider>

  // الحالة
  getStatus(name: string): ProviderStatus
  healthCheckAll(): Promise<Map<string, HealthCheckResult>>
}

interface ProviderRegistration {
  name: string
  provider: IProvider
  isDefault?: boolean
}
```

---

## 6. الـ Async / Sync Provider (للمستقبل)

```typescript
// src/providers/contracts/ISyncProvider.ts

interface ISyncProvider extends IProvider {
  syncPull(lastSyncAt: Date): Promise<SyncResult>
  syncPush(changes: ChangeSet[]): Promise<SyncResult>
  resolveConflicts(conflicts: Conflict[]): Promise<ResolvedConflict[]>
  getSyncStatus(): Promise<SyncStatus>
}

interface SyncResult {
  success: boolean
  changesPulled: number
  changesPushed: number
  conflicts: Conflict[]
  newLastSyncAt: Date
}

interface ChangeSet {
  entity: string
  changeType: 'create' | 'update' | 'delete'
  id: string
  data: Record<string, unknown>
  timestamp: Date
}

interface SyncStatus {
  lastSyncAt?: Date
  pendingSyncs: number
  conflicts: number
  isSyncing: boolean
}
```

---

## 7. قائمة الـ Interfaces الكاملة وجدول الكيانات

| الـ Interface | الـ Aggregate | حجم العمليات التقريبي | الأولوية |
|--------------|---------------|----------------------|---------|
| `IUserProvider` | Auth + Identity | 10 دوال | 1 (حرج) |
| `IOrderProvider` | Order | 16 دالة | 1 (حرج) |
| `IProductProvider` | Product | 10 دوال | 1 (حرج) |
| `ICustomerProvider` | Customer | 10 دوال | 1 (حرج) |
| `ICreditProvider` | Credit | 16 دالة | 2 (عالي) |
| `IAttendanceProvider` | Attendance | 10 دوال | 2 (عالي) |
| `ITrackingProvider` | GPS Tracking | 5 دوال | 2 (عالي) |
| `IDealProvider` | Deals/Offers | 6 دوال | 3 (متوسط) |
| `IFlashOfferProvider` | Flash Offers | 6 دوال | 3 (متوسط) |
| `IDailyDealProvider` | Daily Deals | 6 دوال | 3 (متوسط) |
| `ITierProvider` | Tiers | 6 دوال | 3 (متوسط) |
| `ILocationProvider` | Locations | 4 دوال | 3 (متوسط) |
| `ICacheProvider` | Caching | 5 دوال | 4 (اختياري) |

---

## 8. Exceptions

```typescript
// src/providers/contracts/exceptions.ts

class ProviderException extends Error {
  constructor(
    message: string,
    public readonly providerName: string,
    public readonly originalError?: unknown
  ) {
    super(message)
    this.name = 'ProviderException'
  }
}

class ConnectionException extends ProviderException {
  constructor(providerName: string, originalError?: unknown) {
    super(`Connection failed: ${providerName}`, providerName, originalError)
    this.name = 'ConnectionException'
  }
}

class QueryException extends ProviderException {
  constructor(
    providerName: string,
    public readonly query?: string,
    originalError?: unknown
  ) {
    super(`Query failed: ${providerName}`, providerName, originalError)
    this.name = 'QueryException'
  }
}

class NotFoundException extends ProviderException {
  constructor(
    providerName: string,
    public readonly entityId?: string
  ) {
    super(`Not found: ${providerName}`, providerName)
    this.name = 'NotFoundException'
  }
}

class ConflictException extends ProviderException {
  constructor(
    providerName: string,
    public readonly field?: string,
    public readonly value?: string
  ) {
    super(`Conflict: ${providerName}`, providerName)
    this.name = 'ConflictException'
  }
}

class TimeoutException extends ProviderException {
  constructor(providerName: string, timeoutMs: number) {
    super(`Timeout after ${timeoutMs}ms: ${providerName}`, providerName)
    this.name = 'TimeoutException'
  }
}

class ValidationException extends ProviderException {
  constructor(
    providerName: string,
    public readonly errors: ValidationError[]
  ) {
    super(`Validation failed: ${providerName}`, providerName)
    this.name = 'ValidationException'
  }
}

interface ValidationError {
  field: string
  message: string
  code: string
}
```

---

## 9. قواعد عامة للـ Interfaces

1. **لا دوال افتراضية (default implementations)** — كل دالة يجب أن تنفذ صراحة
2. **لا Generics معقدة** — `ICrudProvider<T, TFilter>` كافٍ
3. **كل Interface في ملف منفصل** — باسم `I{Name}.ts`
4. **كل Interface ينتهي بـ `Provider`** — ما عدا `IUnitOfWork` و `ICacheProvider`
5. **أسماء الدوال أفعال** — `create`, `update`, `submit`, `approve`
6. **كل دالة تعيد Promise** — كل شيء غير متزامن (حتى Mock)
7. **لا دوال تحمل Side Effects مخفية** — `save()` ممنوع — استخدم `create` أو `update` صراحة
8. **كل Filter يرث من `IFilter` الأساسي** — لتوحيد الـ Pagination
