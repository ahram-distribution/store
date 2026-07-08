# 11 – Application Layer

**التصنيف:** تصميم معماري — طبقة التطبيق  
**الغرض:** تحديد هيكل ومسؤوليات Application Layer — الطبقة الوسيطة بين UI و Data  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** مسودة للاعتماد

---

## 1. الموقع في الهرم

```
┌──────────────────────────────────────┐
│         Presentation Layer           │
│  (Pages, Components, Hooks)          │
├──────────────────────────────────────┤
│         Application Layer  ◄── نركز هنا
│  (Application Services, DTOs,        │
│   Mappers, Validators)               │
├──────────────────────────────────────┤
│         Business Layer               │
│  (Domain Models, Business Services)  │
├──────────────────────────────────────┤
│         Data Provider Layer          │
│  (Contracts / Interfaces)            │
├──────────────────────────────────────┤
│         Provider Implementations     │
└──────────────────────────────────────┘
```

---

## 2. مسؤوليات Application Layer

| المسؤولية | وصف |
|-----------|------|
| **تلقي الطلبات** | من الـ UI عبر دوال use case |
| **تنسيق العمليات** | استدعاء Providers متعددة في ترتيب صحيح |
| **التحقق من الصلاحية** | استدعاء Auth + Capability |
| **التحقق من صحة المدخلات** | استخدام Validators قبل أي عملية |
| **تحويل DTO → Domain** | للكتابة |
| **تحويل Domain → DTO** | للقراءة |
| **إدارة المعاملات** | بدء/Commit/Rollback لـ Unit of Work |
| **معالجة الأخطاء** | تحويل ProviderExceptions إلى رسائل مفهومة |
| **التخزين المؤقت** | استدعاء CacheProvider إذا لزم |
| **تسجيل العمليات (Logging)** | تسجيل المدخلات والمخرجات للتدقيق |

**لا يديرها:** منطق الأعمال (Business Layer)، الوصول المباشر لقاعدة البيانات (Provider)

---

## 3. أنواع الـ Application Services

### 3.1 Use Case Service (لكل حالة استخدام)

```typescript
// Application Service يستهدف Use Case واحد أو مجموعة Use Cases مترابطة
class CreateOrderService {
  constructor(
    private orderProvider: IOrderProvider,
    private creditProvider: ICreditProvider,
    private productProvider: IProductProvider,
    private pricingService: PricingService,  // من Business Layer
    private unitOfWork: IUnitOfWork
  ) {}

  async execute(request: CreateOrderRequest): Promise<OrderResponse> {
    // 1. Validate
    const validator = new CreateOrderValidator()
    const errors = validator.validate(request)
    if (errors.length > 0) throw new ValidationError(errors)

    // 2. Business Logic
    const orderItems = request.items.map(item => {
      const product = await this.productProvider.getById(item.productId)
      const price = this.pricingService.computeProductPrice(product, request.tierId)
      return { ...item, unitPrice: price }
    })

    // 3. Transaction
    await this.unitOfWork.begin()
    try {
      // 4. Reserve credit
      const reservation = await this.creditProvider.reserve(
        request.customerId,
        orderItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
      )

      // 5. Create order
      const order = await this.orderProvider.create({
        ...request,
        items: orderItems,
        creditReservationId: reservation.id
      })

      await this.unitOfWork.commit()

      // 6. Map to response
      return new OrderMapper().toResponse(order)
    } catch (err) {
      await this.unitOfWork.rollback()
      throw err
    }
  }
}
```

### 3.2 Query Service (للقراءة فقط)

```typescript
// Service متخصص في القراءة — لا معاملات، لا كتابة
class OrderQueryService {
  constructor(
    private orderProvider: IOrderProvider
  ) {}

  async getOrderById(id: string): Promise<OrderDetailResponse> {
    const order = await this.orderProvider.getById(id)
    return new OrderDetailMapper().toDetailResponse(order)
  }

  async listOrders(filter: OrderFilter): Promise<PaginatedResponse<OrderSummary>> {
    const result = await this.orderProvider.getAll(filter)
    return {
      ...result,
      data: result.data.map(o => new OrderSummaryMapper().toSummary(o))
    }
  }

  async getOrderStats(filter: OrderStatsFilter): Promise<OrderStatsResponse> {
    return this.orderProvider.getOrderStats(filter)
  }
}
```

### 3.3 Command Service (للأوامر)

```typescript
// Service لعمليات محددة بأمر (Approve, Reject, Cancel)
class OrderApprovalService {
  constructor(
    private orderProvider: IOrderProvider,
    private authStore: AuthStore  // للتحقق من صلاحية الموافق
  ) {}

  async approve(command: ApproveOrderCommand): Promise<OrderResponse> {
    // تحقق من صلاحية المستخدم للموافقة
    const canApprove = await this.authStore.checkCapability('orders.approve')
    if (!canApprove) throw new UnauthorizedException()

    const order = await this.orderProvider.approve(command.orderId, command.notes)
    return new OrderMapper().toResponse(order)
  }

  async reject(command: RejectOrderCommand): Promise<OrderResponse> {
    const canReject = await this.authStore.checkCapability('orders.reject')
    if (!canReject) throw new UnauthorizedException()

    const order = await this.orderProvider.reject(command.orderId, command.reason)
    return new OrderMapper().toResponse(order)
  }
}
```

---

## 4. الـ DTOs

### 4.1 قواعد الـ DTO

| القاعدة | التفصيل |
|---------|---------|
| **DTO مخصص لكل Use Case** | لا DTO عام (GenericDTO) |
| **DTO للقراءة منفصل عن الكتابة** | `CreateOrderRequest` ≠ `OrderResponse` |
| **DTO Plain Object** | لا دوال، لا سلوك |
| **DTO لا يعرف الـ Domain** | لا يستورد من domain/ |
| **DTO في مجلد dto/ خاص** | `src/application/dto/order/` |

### 4.2 أمثلة الـ DTOs

```typescript
// --- Request DTOs (Input) ---

interface CreateOrderRequest {
  customerId: string
  tierId?: string
  items: CreateOrderItemRequest[]
  notes?: string
}

interface CreateOrderItemRequest {
  productId: string
  quantity: number
  unitType: 'piece' | 'dozen' | 'carton'
}

interface ApproveOrderCommand {
  orderId: string
  notes?: string
}

interface RejectOrderCommand {
  orderId: string
  reason: string
}

// --- Response DTOs (Output) ---

interface OrderResponse {
  id: string
  customerName: string
  status: OrderStatus
  items: OrderItemResponse[]
  total: number
  discount: number
  netTotal: string  // منسق للعرض
  createdAt: string  // منسق للعرض
}

interface OrderItemResponse {
  productName: string
  quantity: number
  unitType: string
  unitPrice: string
  totalPrice: string
}

interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
```

### 4.3 الهيكل التنظيمي للـ DTOs

```
src/application/dto/
├── order/
│   ├── CreateOrderRequest.ts
│   ├── CreateOrderItemRequest.ts
│   ├── ApproveOrderCommand.ts
│   ├── RejectOrderCommand.ts
│   ├── OrderResponse.ts
│   ├── OrderItemResponse.ts
│   └── OrderFilter.ts
├── product/
│   ├── ProductResponse.ts
│   ├── ProductFilter.ts
│   └── ProductSearchRequest.ts
├── customer/
│   ├── CustomerResponse.ts
│   ├── CustomerFilter.ts
│   └── CustomerStatsResponse.ts
├── credit/
│   ├── CreditBalanceResponse.ts
│   ├── ReserveCreditRequest.ts
│   └── PaymentRequest.ts
├── attendance/
│   ├── StartWorkdayRequest.ts
│   ├── WorkdayResponse.ts
│   └── AttendanceReportResponse.ts
├── auth/
│   ├── LoginRequest.ts
│   ├── LoginResponse.ts
│   └── SessionResponse.ts
└── common/
    ├── PaginatedResponse.ts
    ├── ErrorResponse.ts
    └── FilterRequest.ts
```

---

## 5. الـ Mappers

### 5.1 قواعد الـ Mapper

| القاعدة | التفصيل |
|---------|---------|
| **Mapper لكل Aggregate** | `OrderMapper`, `ProductMapper` |
| **Mapper لا يحتوي منطق أعمال** | فقط `fieldA = source.fieldA` |
| **Mapper لا يستدعي Provider** | ممنوع — pure function |
| **Mapper يمكن اختباره** | Input → Expected Output |
| **DTO → Domain و Domain → DTO** | في نفس الملف |

### 5.2 مثال Mapper

```typescript
class OrderMapper {
  // Domain → Response (للعرض)
  toResponse(order: Order): OrderResponse {
    return {
      id: order.id,
      customerName: order.customerName,
      status: order.status,
      items: order.items.map(item => ({
        productName: item.productName,
        quantity: item.quantity,
        unitType: item.unitType,
        unitPrice: formatPrice(item.unitPrice),  // تنسيق فقط
        totalPrice: formatPrice(item.totalPrice)
      })),
      total: order.total,
      discount: order.discount,
      netTotal: formatPrice(order.netTotal),
      createdAt: formatDate(order.createdAt)
    }
  }

  // Request → Domain (للحفظ)
  toDomain(request: CreateOrderRequest): Partial<Order> {
    return {
      customerId: request.customerId,
      items: request.items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        unitType: item.unitType
      })),
      notes: request.notes
    }
  }
}
```

---

## 6. الـ Validators

### 6.1 أنواع الـ Validation

| المستوى | الموقع | أمثلة |
|---------|--------|-------|
| **Presentation Validation** | الصفحة (HTML form) | حقول إجبارية، نمط الهاتف |
| **Application Validation** | Validator في Application Layer | رقم العميل موجود؟ المنتج نشط؟ |
| **Business Validation** | Business Layer | هل الخصم مسموح؟ هل الائتمان كافٍ؟ |
| **Provider Validation** | قاعدة البيانات | UNIQUE constraint, FK |

### 6.2 مثال Validator

```typescript
class CreateOrderValidator implements IValidator<CreateOrderRequest> {
  validate(request: CreateOrderRequest): ValidationError[] {
    const errors: ValidationError[] = []

    if (!request.customerId) {
      errors.push({ field: 'customerId', message: 'العميل مطلوب', code: 'required' })
    }

    if (!request.items || request.items.length === 0) {
      errors.push({ field: 'items', message: 'يجب إضافة منتج واحد على الأقل', code: 'required' })
    }

    for (const [index, item] of request.items.entries()) {
      if (item.quantity <= 0) {
        errors.push({
          field: `items[${index}].quantity`,
          message: 'الكمية يجب أن تكون أكبر من صفر',
          code: 'invalid_quantity'
        })
      }
    }

    return errors
  }
}
```

---

## 7. العلاقة مع الـ UI

### 7.1 كيف تستدعي الصفحة Application Service

```typescript
// في الصفحة (Presentation Layer)
function OrderListPage() {
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const service = createOrderQueryService()  // من Factory
    service.listOrders({ page: 1, pageSize: 20 })
      .then(result => setOrders(result.data))
      .finally(() => setLoading(false))
  }, [])

  // ... render
}
```

### 7.2 ماذا لا تفعل الصفحة

| ممنوع | السبب |
|-------|-------|
| استدعاء `supabase.rpc()` مباشر | يقضي على هدف الفصل |
| استدعاء Provider مباشر | يقضي على هدف الفصل |
| تحويل البيانات (mapping) | مسؤولية Application Layer |
| التحقق من الصلاحية | مسؤولية Application Layer |
| التحقق من صحة المدخلات المعقدة | مسؤولية Application Layer |

---

## 8. العلاقة مع Business Layer

```typescript
// Business Layer Service (موجود في src/engine/pricing.ts)
class PricingService {
  computeUnitPrice(product: Product, unitType: string): number {
    // منطق أعمال خالص — لا يعرف DTO, لا يعرف Provider
    switch (unitType) {
      case 'piece': return product.piecePrice
      case 'dozen': return product.cartonPrice / product.cartonQuantity * 12
      case 'carton': return product.cartonPrice
      default: throw new Error(`Unknown unit type: ${unitType}`)
    }
  }
}

// Application Layer تستدعيه:
class OrderApplicationService {
  constructor(private pricingService: PricingService) {}

  async createOrder(request: CreateOrderRequest): Promise<OrderResponse> {
    // ...
    const unitPrice = this.pricingService.computeUnitPrice(product, item.unitType)
    // ...
  }
}
```

---

## 9. دورة حياة Application Service

```
[UI] --- request ---> [Application Service]
                          │
                          ├── validate(request)
                          ├── checkCapability()
                          ├── [Business Service] (إذا لزم)
                          ├── [Provider A].getAll()
                          ├── [Provider B].create()
                          ├── [Unit of Work].commit()
                          ├── mapper.toResponse(result)
                          │
[UI] <-- response ---- [Application Service]
```

**القواعد:**
- Application Service يعيش لمدة request واحدة (Scoped)
- لا حالة داخلية (Stateless)
- كل دوال الـ Service غير متزامنة (Promise)

---

## 10. الـ Service Factory

```typescript
// src/application/factories/serviceFactory.ts
// تجميع كل التبعيات في مكان واحد

function createOrderQueryService(): OrderQueryService {
  const registry = ProviderRegistry.getInstance()
  return new OrderQueryService(
    registry.resolve<IOrderProvider>('order')
  )
}

function createOrderCommandService(): OrderCommandService {
  const registry = ProviderRegistry.getInstance()
  return new OrderCommandService(
    registry.resolve<IOrderProvider>('order'),
    useAuthStore  // أو تمرير AuthStore من الـ UI
  )
}

function createOrderApprovalService(): OrderApprovalService {
  const registry = ProviderRegistry.getInstance()
  return new OrderApprovalService(
    registry.resolve<IOrderProvider>('order'),
    useAuthStore
  )
}
```

---

## 11. ملفات Application Layer المقترحة

```
src/application/
├── services/
│   ├── order/
│   │   ├── OrderQueryService.ts
│   │   ├── OrderCommandService.ts
│   │   └── OrderApprovalService.ts
│   ├── product/
│   │   ├── ProductQueryService.ts
│   │   └── ProductSearchService.ts
│   ├── customer/
│   │   └── CustomerService.ts
│   ├── credit/
│   │   ├── CreditQueryService.ts
│   │   └── CreditCommandService.ts
│   ├── attendance/
│   │   ├── AttendanceQueryService.ts
│   │   └── AttendanceCommandService.ts
│   └── auth/
│       ├── AuthService.ts
│       └── SessionService.ts
├── dto/
│   ├── order/
│   ├── product/
│   ├── customer/
│   ├── credit/
│   ├── attendance/
│   ├── auth/
│   └── common/
├── mappers/
│   ├── OrderMapper.ts
│   ├── ProductMapper.ts
│   ├── CustomerMapper.ts
│   ├── CreditMapper.ts
│   └── AttendanceMapper.ts
├── validators/
│   ├── CreateOrderValidator.ts
│   ├── CreateCustomerValidator.ts
│   └── LoginValidator.ts
└── factories/
    └── serviceFactory.ts
```
