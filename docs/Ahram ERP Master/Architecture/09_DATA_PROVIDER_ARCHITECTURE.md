# 09 – Data Provider Architecture

**التصنيف:** تصميم معماري — طبقة مزود البيانات  
**الغرض:** تحديد العمارة الكاملة لطبقة Data Provider وفصلها عن بقية النظام  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** مسودة للاعتماد

---

## 1. الرؤية

فصل منطق الوصول إلى البيانات تماماً عن منطق الأعمال وطبقة العرض، بحيث:

- أي تغيير في قاعدة البيانات لا يؤثر على الـ UI
- أي مزود بيانات جديد (Supabase, PostgreSQL, SQL Server, Mock) يُضاف دون تغيير كود المستهلك
- الاختبار يصبح ممكناً عبر Mock Provider
- التحول إلى Offline / Sync / Mirror يصبح امتداداً وليس إعادة بناء

---

## 2. الهرم المعماري (Layer Diagram)

```
┌──────────────────────────────────────────────────────────┐
│                   Presentation Layer                      │
│   Pages / Components / Hooks / Layouts                   │
│   (لا وصول مباشر للبيانات)                                │
├──────────────────────────────────────────────────────────┤
│                   Application Layer                       │
│   Application Services / DTOs / Mappers / Validators     │
│   (التنسيق بين الطبقات، التحقق، التحويل)                  │
├──────────────────────────────────────────────────────────┤
│                   Business Layer                          │
│   Domain Models / Value Objects / Business Services      │
│   (منطق الأعمال الخالص، لا يعرف مصدر البيانات)            │
├──────────────────────────────────────────────────────────┤
│                 Data Provider Layer (Contracts)           │
│   IProductProvider / IOrderProvider / IProviderRegistry   │
│   IUnitOfWork / ICacheProvider                            │
│   (واجهات فقط — لا تنفيذ)                                 │
├──────────────────────────────────────────────────────────┤
│              Provider Implementations                     │
│   SupabaseProvider / PostgresProvider                    │
│   MockProvider / SqlServerProvider (مستقبلاً)             │
│   (تطبيق واجهات Data Provider)                            │
├──────────────────────────────────────────────────────────┤
│                      Database                             │
│   Supabase / PostgreSQL / SQL Server / IndexedDB          │
│   (مصدر البيانات الفعلي)                                  │
└──────────────────────────────────────────────────────────┘
```

---

## 3. مسؤوليات كل طبقة

### 3.1 Presentation Layer (الموجودة)

| المسؤولية | ملاحظات |
|-----------|---------|
| عرض البيانات للمستخدم | لا تغيير — تبقى كما هي |
| التفاعل مع المستخدم | لا تغيير |
| استدعاء Application Layer فقط | **تغيير جذري:** حالياً تستدعي Services مباشرة |

**القاعدة:** Presentation Layer **لا** تستدعي أي Provider أو Service مباشرة.  
**الاستثناء الوحيد:** Auth — يبقى Store هو المسؤول عن الجلسة.

### 3.2 Application Layer (جديد)

| المسؤولية | الوصف |
|-----------|-------|
| **تلقي الطلبات من Presentation** | عبر Application Services |
| **التحقق من الصلاحيات** | استدعاء auth + capability check |
| **التحقق من صحة المدخلات** | استخدام Validators |
| **تحويل DTO ↔ Domain Model** | استخدام Mappers |
| **تنسيق العمليات عبر مزودين متعددين** | مثلاً: Order + Credit + Inventory في عملية واحدة |
| **إدارة المعاملات (Transactions)** | عبر IUnitOfWork |
| **اختيار Provider المناسب** | عبر ProviderRegistry |
| **معالجة الأخطاء** | تحويل Provider Exceptions → Domain Exceptions |

**القاعدة:** Application Layer لا يحتوي منطق أعمال — فقط تنسيق وتحويل.

### 3.3 Business Layer (مقترح — يعزز الـ Engine الحالي)

| المسؤولية | الوصف |
|-----------|-------|
| **قواعد التسعير** | نقل من `src/engine/pricing.ts` مع توسيع |
| **صلاحية الخصومات** | التحقق من شروط العرض والفلاش |
| **حدود الائتمان** | قواعد الحجز والتحويل |
| **حوكمة الوصول** | قواعد من له حق الوصول لأي بيانات |
| **حسابات الحضور** | صافي ساعات العمل، الخصم، الغياب |

**القاعدة:** Business Layer **لا يستورد أي شيء** من `supabase` أو `providers`.  
**المدخلات:** Domain Models فقط.  
**المخرجات:** نتائج حسابية أو قرارات.

### 3.4 Data Provider Layer — Contracts (جديد)

| المسؤولية | الوصف |
|-----------|-------|
| **تعريف واجهات CRUD** | `IProductProvider`, `IOrderProvider`, إلخ |
| **تعريف واجهة Unit of Work** | `IUnitOfWork` للمعاملات عبر Providers |
| **تعريف واجهة Provider Registry** | تسجيل واستعلام الـ Providers |
| **تعريف DTOs أساسية** | DTOs خاصة بالطبقة إن لزم |
| **تعريف Exceptions** | `ProviderException`, `NotFoundException`, `ConflictException` |

**القاعدة:** لا توجد أي شيفرة تنفيذية — واجهات فقط.

### 3.5 Provider Implementations (جديد)

| المسؤولية | الوصف |
|-----------|-------|
| **تنفيذ واجهات Data Provider** | لكل مصدر بيانات |
| **تحويل استعلامات Provider إلى صيغته** | RPC لـ Supabase, SQL لـ Postgres |
| **إدارة الاتصال** | فتح/غلق/تجمع الاتصالات |
| **معالجة أخطاء المصدر** | تحويل أخطاء قاعدة البيانات إلى `ProviderException` |
| **التخزين المؤقت** | اختياري — تطبيق `ICacheProvider` |

---

## 4. تدفق البيانات بين الطبقات

### 4.1 تدفق قراءة (Read)

```
[صفحة] → استدعاء Application Service
  → Application Service:
      1. التحقق من الصلاحية (auth store)
      2. التحقق من المدخلات (validator)
      3. استدعاء Provider المناسب
          → Provider:
              1. تنفيذ الاستعلام على قاعدة البيانات
              2. إرجاع DTO أو Domain Model
      4. تحويل النتيجة باستخدام Mapper (DTO → ViewModel)
  → إرجاع ViewModel إلى الصفحة
```

### 4.2 تدفق كتابة (Write)

```
[صفحة] ← استمارة ← Application Service
  → Application Service:
      1. التحقق من الصلاحية
      2. التحقق من صحة المدخلات (validator)
      3. تحويل DTO → Domain Model (mapper)
      4. استدعاء Business Layer للقواعد (إذا لزم)
      5. فتح IUnitOfWork
      6. استدعاء Provider 1 (مثلاً OrderProvider)
      7. استدعاء Provider 2 (مثلاً CreditProvider)
      8. Commit / Rollback
      9. تحويل النتيجة → ViewModel
  → إرجاع النتيجة
```

### 4.3 تدفق مختلط (Read-Write)

```
[صفحة] ← Application Service
  → 1. Read من Provider A
  → 2. Business Logic تعالج البيانات
  → 3. Write إلى Provider B
  → 4. Read من Provider C للتأكيد
  → إرجاع النتيجة
```

---

## 5. Provider Lifecycle

```
┌──────────┐     ┌──────────────┐     ┌──────────┐     ┌───────────┐     ┌──────────┐
│ Created  │────►│ Initialized  │────►│  Active  │────►│ Suspended │────►│ Disposed │
└──────────┘     └──────────────┘     └──────────┘     └───────────┘     └──────────┘
      │                                    │                 │
      └── (فشل initialization)             │                 │
          → Error State                    │                 │
                                           │                 │
                                           └── (انتهاء المهلة،
                                                خطأ متكرر)
```

| الحالة | الوصف |
|--------|-------|
| **Created** | تم إنشاء كائن Provider — لم يُفتح اتصال بعد |
| **Initialized** | تم التحقق من الاتصال، جاهز للاستخدام |
| **Active** | قيد الاستخدام — عمليات CRUD |
| **Suspended** | تعليق مؤقت (خطأ، استرجاع، Offline) |
| **Disposed** | تحرير الموارد — نهاية الدورة |

---

## 6. Provider Registration Mechanism

### 6.1 التسجيل (Bootstrapping)

```typescript
// في ملف bootstrapping مركزي (src/bootstrap.ts)
const registry = ProviderRegistry.getInstance()

// تسليم SupabaseProvider
registry.register('supabase', new SupabaseProvider(config))

// تسليم MockProvider للتطوير
registry.register('mock', new MockProvider())

// تحديد الافتراضي
registry.setDefault('supabase')
```

### 6.2 الاستعلام (Resolution)

```typescript
// في Application Service
class OrderApplicationService {
  private orderProvider: IOrderProvider

  constructor() {
    const registry = ProviderRegistry.getInstance()
    this.orderProvider = registry.resolve<IOrderProvider>('order')
  }
}
```

### 6.3 تبديل الـ Provider

```typescript
// في الإنتاج — Supabase
registry.setDefault('supabase')

// في الاختبار — Mock
registry.setDefault('mock')

// في المستقبل — Postgres محلي
registry.setDefault('postgres')
```

---

## 7. Dependency Injection Strategy

**النهج:** حقن تبعيات يدوي عبر Constructor (Manual DI بدون Framework).

**الأسباب:**
- لا حاجة لـ DI Framework (التطبيق صغير)
- تحكم كامل في دورة حياة الـ Providers
- لا اعتماديات إضافية
- سهولة الفهم للمطورين

**النمط:**

```typescript
// كل Application Service يستقبل Provider في Constructor
class OrderApplicationService {
  constructor(
    private orderProvider: IOrderProvider,
    private creditProvider: ICreditProvider,
    private unitOfWork: IUnitOfWork
  ) {}

  // ...
}
```

**تجميع الـ Dependencies في Factory:**

```typescript
// src/application/factories/serviceFactory.ts
function createOrderService(): OrderApplicationService {
  const registry = ProviderRegistry.getInstance()
  return new OrderApplicationService(
    registry.resolve<IOrderProvider>('order'),
    registry.resolve<ICreditProvider>('credit'),
    registry.resolve<IUnitOfWork>('unitOfWork')
  )
}
```

---

## 8. Error Handling Strategy

### 8.1 سلسلة أنواع الأخطاء

```
┌──────────────────────────────────────┐
│         ProviderException            │  ← أساسي
├──────────────────────────────────────┤
│  ├── ConnectionException             │  ← فشل اتصال
│  ├── QueryException                  │  ← خطأ استعلام
│  ├── NotFoundException               │  ← 404
│  ├── ConflictException               │  ← تعارض (مكرر)
│  ├── ValidationException             │  ← خطأ تحقق Provider-side
│  └── TimeoutException                │  ← انتهاء مهلة
└──────────────────────────────────────┘
```

### 8.2 قواعد معالجة الأخطاء

| نوع الخطأ | الإجراء |
|-----------|---------|
| `ConnectionException` | إعادة المحاولة (Retry 3 مرات)، ثم إخطار المستخدم |
| `TimeoutException` | إعادة المحاولة، ثم عرض "الخدمة غير متوفرة" |
| `NotFoundException` | عرض "المورد غير موجود" (لا إعادة محاولة) |
| `ConflictException` | عرض "بيانات مكررة" (لا إعادة محاولة) |
| `ValidationException` | عرض تفاصيل الخطأ للمستخدم |
| أي خطأ غير متوقع | تسجيل + عرض رسالة عامة |

### 8.3 Retry Policy

```typescript
interface IRetryPolicy {
  maxRetries: number         // 3
  baseDelayMs: number        // 1000
  maxDelayMs: number         // 5000
  backoffMultiplier: number  // 2 (exponential)
  retryableExceptions: ExcludeFromTuple // [ConnectionException, TimeoutException]
}
```

---

## 9. Transaction Strategy

### 9.1 Unit of Work

```typescript
interface IUnitOfWork {
  begin(): Promise<void>
  commit(): Promise<void>
  rollback(): Promise<void>

  // ربط Provider بـ UoW
  registerProvider(provider: ITransactionalProvider): void
}
```

### 9.2 أنماط المعاملات

| النمط | الوصف | متى يُستخدم |
|-------|-------|-------------|
| **Single Provider** | معاملة داخل Provider واحد | عملية بسيطة (إنشاء طلب واحد) |
| **Multi Provider** | معاملة عبر Provider متعددة | عملية مركبة (طلب + خصم رصيد) |
| **Compensating** | إجراء تعويضي إذا فشلت معاملة | عمليات غير قابلة للـ rollback (إرسال إشعار) |
| **No Transaction** | بدون معاملة | قراءة فقط |

### 9.3 مثال: معاملة متعددة الـ Providers

```typescript
class OrderApplicationService {
  async createOrder(dto: CreateOrderDTO): Promise<OrderViewModel> {
    const uow = this.unitOfWork
    await uow.begin()

    try {
      // 1. حجز الائتمان (CreditProvider)
      const reservation = await this.creditProvider.reserve(dto.customerId, dto.total)

      // 2. إنشاء الطلب (OrderProvider)
      const order = await this.orderProvider.create({
        ...dto,
        creditReservationId: reservation.id
      })

      // 3. تحديث المخزون (InventoryProvider)
      await this.inventoryProvider.reserveItems(dto.items)

      await uow.commit()
      return this.orderMapper.toViewModel(order)
    } catch (error) {
      await uow.rollback()
      throw error
    }
  }
}
```

---

## 10. DTO Strategy

### 10.1 قواعد الـ DTOs

| القاعدة | التفصيل |
|---------|---------|
| **DTO واحد لكل Use Case** | ليس DTO واحد لكل جدول |
| **DTO للقراءة منفصل عن DTO للكتابة** | `OrderRequest` / `OrderResponse` |
| **DTO في طبقة Application فقط** | لا يظهر في Presentation أو Provider |
| **DTO بسيط** — Plain objects, لا دوال | فقط خصائص |

### 10.2 أنواع الـ DTOs

| النوع | اللاحقة | مثال | الغرض |
|-------|---------|------|-------|
| Request DTO | `*Request` | `CreateOrderRequest` | مدخل من الـ UI |
| Response DTO | `*Response` | `OrderListResponse` | مخرج إلى الـ UI |
| Filter DTO | `*Filter` | `OrderFilter` | معايير التصفية |
| Command DTO | `*Command` | `ApproveOrderCommand` | أمر تنفيذي |

---

## 11. Mapping Strategy

### 11.1 أنواع الـ Mappers

```typescript
// 1. Domain → DTO (للعرض)
class OrderMapper {
  toViewModel(order: Order): OrderResponse { ... }
  toViewModelList(orders: Order[]): OrderListResponse { ... }
}

// 2. DTO → Domain (للحفظ)
class OrderMapper {
  toDomain(request: CreateOrderRequest): Order { ... }
}

// 3. Provider Result → Domain (من قاعدة البيانات)
class OrderProviderMapper {
  toDomain(raw: SupabaseOrderRow): Order { ... }
}
```

### 11.2 قواعد الـ Mapping

| القاعدة | التفصيل |
|---------|---------|
| **Mapper لكل Aggregate Root** | OrderMapper, ProductMapper, CustomerMapper |
| **Mapper لا يحتوي منطق** | فقط تحويل حقول — لا حسابات |
| **كل Mapper لا يعتمد على شيء** | Pure function |
| **التحويل التلقائي** | يمكن استخدام `class-transformer` أو يدوي |

---

## 12. Interface Naming Conventions

| النمط | المثال | ملاحظات |
|-------|--------|---------|
| `I{Entity}Provider` | `IOrderProvider` | لكل كيان رئيسي |
| `I{Entity}Reader` | `IProductReader` | للقراءة فقط (CQRS اختياري) |
| `I{Entity}Writer` | `IOrderWriter` | للكتابة فقط (CQRS اختياري) |
| `I{Operation}Repository` | - | بديل عن Provider (مستودع) |
| `IUnitOfWork` | - | إدارة المعاملات |
| `ICacheProvider` | - | التخزين المؤقت |
| `ISyncProvider` | - | المزامنة |
| `IProviderRegistry` | - | التسجيل والاستعلام |
| `IMapper<TSource, TTarget>` | `IMapper<Order, OrderResponse>` | الـ Mapping |
| `IValidator<T>` | `IValidator<CreateOrderRequest>` | التحقق من الصحة |

**القاعدة الأساسية:** `I{Namespace}{Role}` — الـ Interface يصف الدور وليس التنفيذ.

---

## 13. Future Provider Implementations

| الـ Provider | الموقف | متى |
|-------------|--------|-----|
| **SupabaseProvider** | الإنتاج الحالي — التنفيذ الأول | الآن |
| **MockProvider** | التطوير والاختبار — بيانات وهمية | الآن |
| **PostgresProvider** | اتصال مباشر بـ PostgreSQL — للمستقبل | المرحلة 3 |
| **SqlServerProvider** | Windows Desktop — للمستقبل | المرحلة 4 |
| **LocalProvider** | IndexedDB — Offline Mode | المرحلة 2 |
| **SyncProvider** | مزامنة Local ↔ Server | المرحلة 2 |
| **MirrorProvider** | نسخ متطابق للقراءة فقط | المرحلة 5 |
| **CacheProvider** | تخزين مؤقت (Redis / Memory) | المرحلة 3 |

---

## 14. العلاقة مع الـ Services الموجودة

```
حالياً:                    مستقبلاً:
Services (23 ملف)  ───►    إعادة هيكلة:
┌────────────────┐        ┌─────────────────────┐
│ Auth Service    │        │ Application Service │ ← تنسيق
│ Product Service │        ├─────────────────────┤
│ Order Service   │  ──►   │ Business Service    │ ← منطق
│ Credit Service  │        ├─────────────────────┤
│ ...             │        │ Data Provider      │ ← وصول
│ trackingEngine  │        └─────────────────────┘
│ heartbeatService│
│ ...             │
└────────────────┘
```

**الملاحظات المهمة:**
- `trackingEngine`, `heartbeatService`, `gpsService` → تبقى كـ **Infrastructure Services** (ليست Data Providers)
- `auth.ts` → جزء من الـ Provider (أو مستقل — حسب القرار المعماري)
- الـ 23 Service الحالية سيتم توزيع مسؤولياتها بين Application Services + Data Providers
- بعض الخدمات الحالية تحتوي طبقة رقيقة جداً فوق RPC → تتحول مباشرة إلى Provider

---

## 15. القواعد الصارمة (Hard Rules)

1. **Presentation Layer لا يستورد أي شيء من `providers/` أو `supabase`**
2. **Business Layer لا يستورد أي شيء من `supabase` أو `providers/`**
3. **Provider Implementation لا يعرف شيئاً عن الـ UI (لا React, لا Components)**
4. **كل Provider ينفذ Interface واحد على الأقل من `providers/contracts/`**
5. **Mapper لا يحتوي منطق أعمال — فقط تحويل حقل لحقل**
6. **الـ Unit of Work يدعم Rollback كامل لأي فشل**
7. **لا Interface يمرر `any` — كل شيء مقيد بنوع (Typed)**
8. **الـ Provider لا يرمي `Error` — فقط `ProviderException` أو ما يشتق منه**
9. **تقديم الـ Provider عبر Registry — ليس عبر `new` مباشر في Application Service**
10. **كل Application Service يقبل Providers عبر Constructor — ليس استدعاء Registry داخلياً (لإمكانية الاختبار)**

---

## 16. ملخص التغييرات الرئيسية

| العنصر | الحالي | المقترح |
|--------|--------|---------|
| وصول البيانات | `service.rpc()` مباشر | Provider عبر Interface |
| فصل الطبقات | 3 طبقات (Page-Service-DB) | 5 طبقات (Page-App-Business-Provider-DB) |
| منطق الأعمال | مبعثر في Services + RPC | مركز في Business Layer |
| الاختبار | غير ممكن | ممكن عبر MockProvider |
| التبديل بين DB | غير ممكن | ممكن عبر ProviderRegistry |
| Transaction | داخل RPC (server-side) | متحكم به من Application Layer |
| Typing | `any` في بعض RPC | Typed Interfaces بالكامل |
