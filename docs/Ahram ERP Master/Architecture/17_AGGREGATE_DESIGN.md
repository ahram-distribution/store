# 17 – Aggregate Design

**التصنيف:** تصميم معماري — تصميم التجميعات  
**الغرض:** توثيق حدود التجميعات (Aggregate Boundaries)، دورات الحياة، القواعد الثابتة، والعلاقات  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** مسودة للاعتماد

---

## 1. مبادئ تصميم التجميعات

| المبدأ | الشرح |
|--------|-------|
| **تجمع واحد لكل معاملة (One Aggregate per Transaction)** | المعاملة لا تمس أكثر من تجمع واحد |
| **الاتساق داخل التجمع (Consistency Within)** | التجمع مسؤول عن اتساق أجزائه الداخلية |
| **الاتساق النهائي بين التجمعات (Eventual Consistency)** | بين تجمعين، نستخدم الأحداث |
| **التجمع الكبير مشكلة** | إذا كان التجمع كبيراً جداً، قسمه |
| **التجمع الصغير ليس تجمعاً** | إذا كان يحتوي كياناً واحداً فقط، قد لا يكون تجمعاً |

---

## 2. التجميعات الأساسية (Core Aggregates)

### 2.1 SalesOrder — تجمع أوامر البيع

| الحقل | القيمة |
|-------|--------|
| **الجذر (Root)** | `SalesOrder` |
| **الكيانات الداخلية** | `OrderItem` (قائمة), `StatusChange` (سجل الحالات value object) |
| **الحجم التقريبي** | < 100 items (معقول) |

**دورة الحياة:**

```
Draft ──► Submitted ──► Reviewing ──► Approved ──► Preparing ──► Dispatched ──► Delivered
  │                          │              │
  └──► Cancelled             └──► Rejected  └──► Cancelled
```

| الحالة | الوصف | المدة النموذجية |
|--------|-------|----------------|
| `Draft` | المسودة — الإنشاء الأولي | مؤقت (دقائق) |
| `Submitted` | تقديم الطلب — في انتظار المراجعة | ساعات |
| `Reviewing` | تحت المراجعة — موافقة/رفض معلقة | ساعات |
| `Approved` | تمت الموافقة — جاهز للتحضير | دقائق |
| `Rejected` | مرفوض — نهائي | نهائي |
| `Preparing` | قيد التحضير — تجهيز الطلب | ساعات |
| `Dispatched` | تم الشحن — في الطريق | أيام |
| `Delivered` | تم التسليم — نهائي | نهائي |
| `Cancelled` | ملغي — من أي حالة غير نهائية | نهائي |

**القواعد الثابتة (Invariants):**

| القاعدة | النوع | يُطبق في |
|---------|-------|---------|
| `netTotal` = `total - discount` | حسابي | Domain Service |
| لا يمكن الرجوع إلى حالة سابقة | انتقالي | Aggregate |
| الموافقة تحتاج `creditReservationId` موجود | تكاملي | Application Service |
| `Delivered`, `Rejected`, `Cancelled` حالات نهائية | انتقالي | Aggregate |
| كل `OrderItem.productName` يجب أن يكون معبأ | تحقق | Application Validator |
| `total` = sum(`OrderItem.totalPrice`) | حسابي | Aggregate |

**العلاقات:**

| العلاقة | مع | النوع |
|---------|----|-------|
| يربط بـ | `Customer` (عبر customerId) | Reference (ليس مملوكاً) |
| يربط بـ | `Product` (في OrderItem.productId) | Reference |
| يربط بـ | `CreditReservation` (عبر referenceId) | Reference |
| يملك | `OrderItem[]` | Composition |
| يملك | `StatusChange[]` | Composition |
| يرتبط بـ | `Payment` (عبر orderId) | Event-driven |

### 2.2 Customer — تجمع العملاء

| الحقل | القيمة |
|-------|--------|
| **الجذر** | `Customer` |
| **الكيانات الداخلية** | `Address` (value object) |
| **ملاحظات** | تجمع صغير — العميل لا يملك أوامره (الأوامر تجمع منفصل) |

**دورة الحياة:**

```
Created ──► Active ──► Suspended ──► Active
             │
             └──► Inactive
```

**القواعد الثابتة:**

| القاعدة | يُطبق في |
|---------|---------|
| رقم الهاتف فريد ضمن الشركة | Provider |
| `isActive = false` يمنع إنشاء طلبات | Application Service |
| الائتمان المستخدم لا يتجاوز الحد | Application Service |

**العلاقات:**

| العلاقة | مع |
|---------|----|
| Reference | `Route` (عبر routeId) |
| Reference | `Company` (عبر companyId) |
| يملك | `CreditLimit` (1:1) |
| مرتبط بـ | `SalesOrder` (event: OrderCreated) |

### 2.3 Product — تجمع المنتجات

| الحقل | القيمة |
|-------|--------|
| **الجذر** | `Product` |
| **الكيانات الداخلية** | `Category` (كيان مستقل — قد يكون تجمعه الخاص) |

**دورة الحياة:**

```
Created ──► Active ──► Inactive
```

**القواعد الثابتة:**

| القاعدة | يُطبق في |
|---------|---------|
| `isVisible = false` للموظفين فقط | Provider (Governed RPC) |
| الدستة تظهر فقط إذا `cartonQuantity >= 24` | Application Service |
| أسعار غير سالبة | Aggregate |

### 2.4 CreditReservation — تجمع حجوزات الائتمان

| الحقل | القيمة |
|-------|--------|
| **الجذر** | `CreditReservation` |
| **ملاحظات** | تجمع صغير — دورة حياة قصيرة (24 ساعة) |

**دورة الحياة:**

```
Active ──► Converted    (عند تأكيد الطلب)
Active ──► Released     (عند إلغاء الطلب أو انتهاء الصلاحية)
```

**القواعد الثابتة:**

| القاعدة | يُطبق في |
|---------|---------|
| `active` تنتهي بعد 24 ساعة | Scheduled Job |
| `converted` أو `released` — حالات نهائية | Aggregate |
| لا حجز إذا `availableAmount` غير كافٍ | Application Service |

**العلاقات:**

| العلاقة | مع |
|---------|----|
| Reference | `Customer` (عبر customerId) |
| Reference | `SalesOrder` (عبر referenceId) |
| مملوك لـ | `CreditLimit` (يعدل availableAmount) |

### 2.5 Workday — تجمع أيام العمل

| الحقل | القيمة |
|-------|--------|
| **الجذر** | `Workday` |
| **الكيانات الداخلية** | `BreakPeriod[]` |

**دورة الحياة:**

```
Active ──► Completed    (إنهاء يوم العمل)
Active ──► Interrupted  (انقطاع 30 دقيقة)
```

**القواعد الثابتة:**

| القاعدة | يُطبق في |
|---------|---------|
| لا بدء بدون GPS | Application Service |
| لا إنهاء قبل بدء | Aggregate |
| لا إنهاء مع Break نشط (بدون endTime) | Aggregate |
| `netWorkHours` = مجموع ساعات الحضور - مجموع فترات الراحة | Domain Service |

**العلاقات:**

| العلاقة | مع |
|---------|----|
| يملك | `BreakPeriod[]` |
| مرتبط بـ | `TrackingSession` (1:1) |
| Reference | `Employee` (عبر employeeId) |

### 2.6 TrackingSession — تجمع التتبع

| الحقل | القيمة |
|-------|--------|
| **الجذر** | `TrackingSession` |
| **الكيانات الداخلية** | `TrackingPoint[]` (كمية كبيرة جداً — مئات في اليوم) |

**دورة الحياة:**

```
Active ──► Completed    (إنهاء يوم العمل)
Active ──► Interrupted  (انقطاع التتبع)
```

**ملاحظة هامة:** بسبب كمية `TrackingPoint` الكبيرة، **لا نحمّل كل النقاط في الذاكرة**.  
الـ TrackingSession يحمل الملخص فقط (عدد النقاط، أول نقطة، آخر نقطة، المسار التقريبي).  
النقاط تُستعلم بشكل منفصل (صفحات).

**القواعد الثابتة:**

| القاعدة | يُطبق في |
|---------|---------|
| النقاط تسجل كل 30 ثانية | Infrastructure (GPS Service) |
| Offline → IndexedDB Queue | Infrastructure |
| المزامنة كل دقيقة إذا كان متصلاً | Background Sync |

**العلاقات:**

| العلاقة | مع |
|---------|----|
| يملك | `TrackingPoint[]` (لكن lazy-loaded) |
| مرتبط بـ | `Workday` (1:1) |

### 2.7 Payment — تجمع المدفوعات

| الحقل | القيمة |
|-------|--------|
| **الجذر** | `Payment` |
| **ملاحظات** | تجمع مستقل — لا يملكه Customer |

**دورة الحياة:**

```
Created ──► Completed    (تسجيل الدفعة)
(نهائي — بدون حالات أخرى)
```

**العلاقات:**

| العلاقة | مع |
|---------|----|
| Reference | `Customer` (عبر customerId) |
| مرتبط بـ | `OutstandingBalance` (يقلله) |

### 2.8 Check — تجمع الشيكات

| الحقل | القيمة |
|-------|--------|
| **الجذر** | `Check` |
| **ملاحظات** | دورة حياة مستقلة عن Payment |

**دورة الحياة:**

```
Received ──► Deposited ──► Cleared
                           └──► Bounced (نهائي)
```

**النقاط الثابتة:**

| القاعدة | يُطبق في |
|---------|---------|
| `bounced` لا يمكن إعادة إيداعه | Aggregate |
| التصفية تستغرق 3 أيام عمل | Business Rule |

### 2.9 ReturnRequest — تجمع المرتجعات

| الحقل | القيمة |
|-------|--------|
| **الجذر** | `ReturnRequest` |
| **الكيانات الداخلية** | `ReturnItem[]`, `ReturnApproval` (value object) |

**دورة الحياة:**

```
Pending ──► Approved ──► Completed
Pending ──► Rejected (نهائي)
```

**القواعد الثابتة:**

| القاعدة | يُطبق في |
|---------|---------|
|只能在 7 أيام من التسليم | Application Service |
| `damaged` يتطلب موافقة إضافية | Business Rule |
| الموافقة تؤدي إلى حركة مخزون | Event (Application Service) |

### 2.10 Target — تجمع الأهداف

| الحقل | القيمة |
|-------|--------|
| **الجذر** | `Target` |

**دورة الحياة:**

```
Defined ──► Active ──► Achieved | Expired
```

**القواعد الثابتة:**

| القاعدة | يُطبق في |
|---------|---------|
| الهدف اليومي = الشهري / أيام العمل | Domain Service |
| يحسب `actualValue` من الطلبات (ليس مصدراً مستقلاً) | Domain Service |

---

## 3. حدود التجميعات (Bounded Contexts)

القدرات تتجمع في Contexts أكبر:

```
┌─────────────────────────────────────────────────────────────┐
│                     Sales Context                            │
│  SalesOrder | ReturnRequest | RouteVisit | Route            │
│  (تدفق البيع بالكامل — من إنشاء الطلب إلى التسليم)          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Product Context                           │
│  Product | Category | PriceTier | Deal | Offer              │
│  (إدارة المنتجات والتسعير والعروض)                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Financial Context                           │
│  CreditReservation | Payment | Check | OutstandingBalance   │
│  (الائتمان والتحصيل والمدفوعات)                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 Workforce Context                            │
│  Workday | TrackingSession | AttendanceSession              │
│  (الحضور والتتبع — إدارة القوى العاملة الميدانية)           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Identity Context                            │
│  Identity | Session | Role | Capability                     │
│  (المصادقة والصلاحيات — أساس كل شيء)                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Performance Context                         │
│  Target | KpiDefinition | KpiValue                          │
│  (الأهداف ومؤشرات الأداء)                                    │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  Foundation Context                          │
│  Company | AuditEntry | Notification | SyncQueue            │
│  (البنية التحتية — إعدادات, تدقيق, إشعارات, مزامنة)         │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. كيف تتفاعل التجميعات (Interaction Patterns)

### النمط 1: Reference عبر ID

```text
SalesOrder.customerId ──► Customer
SalesOrderItem.productId ──► Product
```

لا يملك التجميع التجميع الآخر. فقط يشير إليه عبر المعرف.

### النمط 2: Application Service تنسق بين تجمعين

```text
[Application Service: CreateOrder]
  1. CustomerProvider.getById(customerId)          ← تحقق من وجود العميل
  2. PricingService.computeTotal(items)             ← احسب السعر (Domain Service)
  3. CreditProvider.reserve(customerId, total)      ← احجز الائتمان
  4. SalesOrderProvider.create(order)               ← أنشئ الطلب
  5. NotificationService.send('order.created')     ← أرسل إشعاراً
```

### النمط 3: الـ Events (للاتساق النهائي)

```text
SalesOrder.status = 'delivered'
  ↓
Event: OrderDelivered
  ↓
CustomerProvider.updateLastPurchase(customerId)
TargetProvider.updateActual(employeeId, orderTotal)
InventoryProvider.releaseReservation(reservationId)
```

**الملاحظة:** النظام الحالي لا يدعم الـ Events. هذا تصميم للمستقبل. حالياً، كل شيء يتم ضمن Application Service مباشرة.

---

## 5. مقارنة: الحالي (DB-centric) vs المقترح (Domain-centric)

| الجانب | الحالي (DB-centric) | المقترح (Domain-centric) |
|--------|--------------------|--------------------------|
| **وحدة التنظيم** | جداول DB | Business Capability |
| **الـ Provider** | لكل جدول (IOrderProvider) | لكل قدرة (ISalesOrderProvider) |
| **حدود المعاملات** | غير واضحة | Aggregate Root |
| **القواعد الثابتة** | مبعثرة في RPCs + Pages | داخل الـ Aggregate |
| **طبيعة الـ Services** | طبقة رقيقة فوق RPC | Application Services للتنسيق |
| **منطق الأعمال** | في PostgreSQL RPCs | Domain Services (TypeScript) |
