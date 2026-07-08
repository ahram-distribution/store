# 16 – Domain Model

**التصنيف:** تصميم معماري — نموذج النطاق  
**الغرض:** توثيق نموذج النطاق (Domain Model) المنظم حول قدرات الأعمال وليس حول جداول قاعدة البيانات  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** مسودة للاعتماد

---

## 1. مبدأ التصميم

كل Domain Model ينتمي إلى **قدرة أعمال واحدة** ولا يشارك مع قدرة أخرى.

الاستثناء الوحيد: الـ Value Objects التي تستخدمها قدرات متعددة (مثل `Money`, `GeoLocation`, `DateRange`).

---

## 2. Value Objects (مشتركة)

```text
Money {
  amount: number
  currency: string        // 'EGP' حالياً
}
→ غير قابل للتغيير (Immutable)
→ عمليات: add, subtract, multiply, isGreaterThan, isZero
→ ينتمي لـ: Foundation / Common

GeoLocation {
  latitude: number
  longitude: number
  accuracy: number        // بالأمتار
  timestamp: DateTime
}
→ ينتمي لـ: Foundation / Common

DateRange {
  from: DateTime
  to: DateTime
}
→ ينتمي لـ: Foundation / Common

Quantity {
  value: number
  unit: UnitOfMeasure     // piece | dozen | carton
}
→ ينتمي لـ: Foundation / Common

PhoneNumber {
  number: string
  countryCode: string     // '+2' لمصر
}
→ ينتمي لـ: Foundation / Common

Address {
  street: string
  district: string
  city: string
  governorate: string
  coordinates?: GeoLocation
}
→ ينتمي لـ: Foundation / Common
```

---

## 3. Domain Models لكل قدرة أعمال

### 3.1 Identity & Access

````text
+------------------+
|    Identity      |  ← الجذر (Aggregate Root)
+------------------+
| - id: string     |
| - fullName: Name |
| - phone: PhoneNumber |
| - identityType: 'employee' | 'customer' |
| - isActive: boolean |
| - createdAt: DateTime |
+------------------+
     |
     | يملك
     v
+------------------+
|    Session       |  ← Entity
+------------------+
| - token: string  |
| - identityId: string |
| - createdAt: DateTime |
| - expiresAt: DateTime |
| - isValid(): boolean |
+------------------+

+------------------+
| LoginCredential  |  ← Entity (محمي)
+------------------+
| - identityId: string |
| - passwordHash: string |
| - lastChangedAt: DateTime |
| - verify(password): boolean |
+------------------+
````

**قواعد ثابتة (Invariants):**
- لا يمكن أن يكون هناك Session صالح بعد `expiresAt`
- كل Identity لها `LoginCredential` واحد فقط
- `identityType` لا يتغير بعد الإنشاء

### 3.2 Authorization

````text
+------------------+
|      Role        |  ← Aggregate Root
+------------------+
| - id: string     |
| - name: string   |
| - normalizedName: string |
| - isUpperManagement: boolean |
+------------------+
     |
     | يمنح
     v
+------------------+
|   Capability     |  ← Entity
+------------------+
| - code: string   |  ← 'orders.approve', 'products.edit'
| - description: string |
| - category: string |
+------------------+

+------------------+
|  GovernancePolicy|  ← Entity
+------------------+
| - roleId: string |
| - entityType: string |  ← 'order', 'product', 'customer'
| - accessLevel: 'read' | 'write' | 'approve' | 'full'
| - scope: 'self' | 'team' | 'company'
+------------------+
````

**قواعد ثابتة:**
- `isUpperManagement` = true يتجاوز كل `Capability` دون تحقق
- `normalizedName` هو المرجع الوحيد للمقارنة (8 صيغ مقننة)
- لا يجوز حذف `Role` إذا كان مربوطاً بـ `Identity` نشط

### 3.3 Pricing & Discounts

````text
+------------------+
|    PriceTier     |  ← Aggregate Root
+------------------+
| - id: string     |
| - name: string   |
| - discountPercent: number |
| - companyId: string |
| - exceptions: TierException[] |
+------------------+
     |
     | يحتوي على
     v
+------------------+
| TierException    |  ← Entity
+------------------+
| - tierId: string |
| - productId: string |
| - customDiscount?: number |  ← يعلو discountPercent
| - isActive: boolean |
+------------------+

+------------------+
|    UnitPrice     |  ← Value Object
+------------------+
| - productId: string |
| - price: Money   |
| - unitType: UnitOfMeasure |
| - effectiveFrom: DateTime |
| - effectiveTo?: DateTime |
+------------------+
````

**قواعد ثابتة:**
- خصم الشريحة لا يتجاوز 100%
- `TierException.customDiscount` يعلو `PriceTier.discountPercent`
- لا يجوز أن يكون `effectiveTo` قبل `effectiveFrom`

### 3.4 Deals & Offers

````text
+------------------+
|      Deal        |  ← Aggregate Root (Deal / FlashOffer / DailyDeal)
+------------------+
| - id: string     |
| - type: 'deal' | 'flash' | 'daily' |
| - name: string   |
| - description: string |
| - startDate: DateTime |
| - endDate: DateTime |
| - isActive: boolean |
| - rules: DealRule[] |
+------------------+
     |
     | يطبق على
     v
+------------------+
|   DealRule       |  ← Value Object
+------------------+
| - productId?: string |
| - categoryId?: string |
| - discountPercent: number |
| - minQuantity?: number |
| - maxQuantity?: number |
+------------------+

+------------------+
| DealEligibility  |  ← Value Object (نتيجة)
+------------------+
| - isEligible: boolean |
| - reason?: string |
| - applicablePrice: Money? |
| - discountAmount: Money? |
+------------------+
````

**قواعد ثابتة:**
- `startDate` و `endDate` يحددان صلاحية العرض
- لا يجوز جمع عرضين على نفس المنتج
- `isActive = false` يلغي العرض حتى لو التاريخ ساري

### 3.5 Sales Order Management

````text
+------------------+
|   SalesOrder     |  ← Aggregate Root — الجذر الأهم
+------------------+
| - id: string     |
| - customerId: string |
| - employeeId: string |
| - items: OrderItem[] |
| - total: Money    |
| - discount: Money |
| - netTotal: Money |
| - status: OrderStatus |
| - creditReservationId?: string |
| - notes: string   |
| - createdAt: DateTime |
| - updatedAt: DateTime |
| - statusHistory: StatusChange[] |
+------------------+
     |
     | يحتوي على
     ├──> OrderItem (Entity)
     |     - productId: string
     |     - productName: string
     |     - quantity: number
     |     - unitType: UnitOfMeasure
     |     - unitPrice: Money
     |     - totalPrice: Money
     |     - dealId?: string
     |
     └──> StatusChange (Value Object)
           - fromStatus: OrderStatus
           - toStatus: OrderStatus
           - changedBy: string
           - timestamp: DateTime
           - reason?: string

OrderStatus:  ← Enum
  Draft | Submitted | Reviewing | Approved
  | Rejected | Preparing | Dispatched
  | Delivered | Cancelled

Transition Rules:  ← State Machine (Business Rule)
  Draft        → Submitted | Cancelled
  Submitted    → Reviewing | Rejected
  Reviewing    → Approved | Rejected
  Approved     → Preparing | Cancelled
  Preparing    → Dispatched
  Dispatched   → Delivered
  Delivered    → (terminal)
  Rejected     → (terminal)
  Cancelled    → (terminal)
````

**قواعد ثابتة:**
- `netTotal` = `total` - `discount` (تلقائي)
- كل تغيير حالة يسجل في `statusHistory`
- لا يجوز الرجوع إلى حالة سابقة (إلا `Cancelled` من `Draft` أو `Approved`)
- `Delivered` و `Rejected` و `Cancelled` حالات نهائية

### 3.6 Customer Management

````text
+------------------+
|    Customer      |  ← Aggregate Root
+------------------+
| - id: string     |
| - name: string   |
| - phone: PhoneNumber |
| - address: Address |
| - classification: CustomerClassification |
| - routeId?: string |
| - companyId: string |
| - creditLimit: Money |
| - currentBalance: Money |
| - isActive: boolean |
| - createdAt: DateTime |
+------------------+

+------------------+
| CustomerClassification |  ← Value Object
+------------------+
| - type: 'retail' | 'wholesale' | 'distributor' |
| - priority: number |
| - maxCreditLimit: Money |
+------------------+
````

**قواعد ثابتة:**
- `phone` فريد ضمن `companyId`
- `currentBalance` لا يتجاوز `creditLimit` (ي enforced عند حجز الائتمان)
- `isActive = false` يمنع إنشاء طلبات جديدة

### 3.7 Product Catalog

````text
+------------------+
|    Product       |  ← Aggregate Root
+------------------+
| - id: string     |
| - name: string   |
| - barcode?: string |
| - categoryId: string |
| - basePrice: Money |
| - cartonQuantity: number |
| - cartonPrice: Money |
| - piecePrice: Money |
| - unitType: string |
| - imageUrl?: string |
| - isActive: boolean |
| - isVisible: boolean |
+------------------+

+------------------+
|   Category       |  ← Entity
+------------------+
| - id: string     |
| - name: string   |
| - parentId?: string |
| - sortOrder: number |
+------------------+

+------------------+
|  UnitOfMeasure   |  ← Value Object
+------------------+
| - code: 'piece' | 'dozen' | 'carton' |
| - name: string   |
| - baseUnit: 'piece' |
| - conversionFactor: number |  ← dozen=12, carton=cartonQuantity
+------------------+
````

**قواعد ثابتة:**
- `isVisible = false` يخفي المنتج عن العملاء لكن يبقى ظاهراً للموظفين
- `cartonQuantity >= 24` لتظهر الدستة كوحدة شراء
- ما لم يحدد خلافه، `piecePrice` = `cartonPrice / cartonQuantity`

### 3.8 Credit Management

````text
+------------------+
| CreditReservation|  ← Aggregate Root
+------------------+
| - id: string     |
| - customerId: string |
| - amount: Money  |
| - status: 'active' | 'converted' | 'released' |
| - referenceId: string |  ← رقم الطلب المرتبط
| - createdAt: DateTime |
| - expiresAt: DateTime |
+------------------+

+------------------+
|   CreditLimit    |  ← Entity
+------------------+
| - customerId: string |
| - totalLimit: Money |
| - usedAmount: Money |
| - availableAmount(): Money |  ← totalLimit - usedAmount
+------------------+

+------------------+
| CreditTransaction|  ← Entity (سجل)
+------------------+
| - id: string     |
| - customerId: string |
| - type: 'reservation' | 'release' | 'conversion' | 'payment'
| - amount: Money  |
| - referenceId: string |
| - createdAt: DateTime |
+------------------+

+------------------+
| OutstandingBalance| ← Value Object
+------------------+
| - customerId: string |
| - totalOutstanding: Money |
| - overdue: Money  |
| - dueDate: DateTime |
+------------------+
````

**قواعد ثابتة:**
- `active` reservation تنتهي بعد 24 ساعة (`expiresAt`)
- `status` ينتقل: `active` → `converted` | `released` (نهائي)
- لا يجوز إنشاء reservation إذا `availableAmount` < مبلغ الحجز

### 3.9 Collections & Payments

````text
+------------------+
|    Payment       |  ← Aggregate Root
+------------------+
| - id: string     |
| - customerId: string |
| - amount: Money  |
| - method: 'cash' | 'check' | 'transfer' |
| - referenceId?: string |
| - collectedBy: string |  ← employeeId
| - collectedAt: DateTime |
+------------------+

+------------------+
|     Check        |  ← Aggregate Root (له دورة حياة خاصة)
+------------------+
| - id: string     |
| - customerId: string |
| - bankName: string |
| - checkNumber: string |
| - amount: Money  |
| - issueDate: DateTime |
| - dueDate: DateTime |
| - status: 'received' | 'deposited' | 'cleared' | 'bounced' |
| - bounceReason?: string |
+------------------+
````

**قواعد ثابتة:**
- `Check.status` ينتقل: `received` → `deposited` → `cleared` | `bounced`
- `bounced` check لا يمكن إعادة إيداعه
- `Payment` يقلل OutstandingBalance فوراً

### 3.10 Inventory Control

````text
+------------------+
|  StockReservation|  ← Aggregate Root
+------------------+
| - id: string     |
| - productId: string |
| - quantity: Quantity |
| - referenceType: 'order' | 'return' |
| - referenceId: string |
| - status: 'active' | 'fulfilled' | 'released' |
| - createdAt: DateTime |
+------------------+

+------------------+
|  InventoryItem   |  ← Entity
+------------------+
| - productId: string |
| - warehouseId: string |
| - totalStock: number |
| - reservedStock: number |
| - availableStock(): number |  ← totalStock - reservedStock
+------------------+

+------------------+
|  StockMovement   |  ← Entity (سجل)
+------------------+
| - id: string     |
| - productId: string |
| - type: 'in' | 'out' | 'reservation' | 'release'
| - quantity: number |
| - referenceId: string |
| - createdAt: DateTime |
+------------------+
````

**قواعد ثابتة:**
- `availableStock` >= 0 دائماً (لا مخزون سالب)
- `reservation` يقلل `availableStock` فقط، لا `totalStock`
- `fulfilled` reservation يقلل `totalStock`

### 3.11 Attendance & Time

````text
+------------------+
|    Workday       |  ← Aggregate Root
+------------------+
| - id: string     |
| - employeeId: string |
| - date: DateTime |
| - startTime: DateTime |
| - endTime?: DateTime |
| - startLocation: GeoLocation |
| - endLocation?: GeoLocation |
| - breaks: BreakPeriod[] |
| - netWorkHours(): Duration |  ← (endTime - startTime) - totalBreakDuration
| - status: 'active' | 'completed' | 'interrupted'
+------------------+
     |
     | يحتوي على
     v
+------------------+
|  BreakPeriod     |  ← Entity
+------------------+
| - id: string     |
| - startTime: DateTime |
| - endTime?: DateTime |
| - type: 'lunch' | 'rest' | 'personal'
| - duration(): Duration?
+------------------+

+------------------+
|  AttendanceSession| ← Value Object (مشتق)
+------------------+
| - employeeId: string |
| - date: DateTime |
| - workdayId: string |
| - clockIn: DateTime |
| - clockOut?: DateTime |
| - totalBreaks: Duration |
| - netHours: Duration |
+------------------+
````

**قواعد ثابتة:**
- لا يمكن بدء `Workday` بدون `GeoLocation` صحيح
- لا يمكن إنهاء `Workday` لم يبدأ
- `BreakPeriod` بدون `endTime` تعني استراحة نشطة (لا يمكن إنهاء يوم العمل)
- 30 دقيقة بدون `heartbeat` → `interrupted`

### 3.12 Employee Tracking

````text
+------------------+
|  TrackingSession |  ← Aggregate Root
+------------------+
| - id: string     |
| - employeeId: string |
| - workdayId: string |
| - startedAt: DateTime |
| - endedAt?: DateTime |
+------------------+
     |
     | يحتوي على
     v
+------------------+
|  TrackingPoint   |  ← Entity (كمية كبيرة)
+------------------+
| - sessionId: string |
| - latitude: number |
| - longitude: number |
| - accuracy: number |
| - batteryLevel?: number |
| - timestamp: DateTime |
+------------------+
````

**قواعد ثابتة:**
- `TrackingPoint` تسجل كل 30 ثانية خلال `TrackingSession`
- النقاط تُخزّن في IndexedDB إذا كان الجهاز Offline
- `TrackingSession` تبدأ مع `Workday` وتنتهي معه

### 3.13 Route Management

````text
+------------------+
|     Route        |  ← Aggregate Root
+------------------+
| - id: string     |
| - name: string   |
| - employees: string[] |
| - customers: string[] |
| - isActive: boolean |
+------------------+

+------------------+
|   RouteVisit     |  ← Entity
+------------------+
| - id: string     |
| - routeId: string |
| - customerId: string |
| - employeeId: string |
| - plannedDate: DateTime |
| - actualVisitTime?: DateTime |
| - location: GeoLocation |
| - notes?: string |
+------------------+
````

**قواعد ثابتة:**
- `customer` ينتمي لـ `Route` واحد فقط
- `RouteVisit` تسجل عند الزيارة الفعلية مع `GeoLocation`

### 3.14 KPI & Targets

````text
+------------------+
|     Target       |  ← Aggregate Root
+------------------+
| - id: string     |
| - employeeId: string |
| - periodType: 'daily' | 'monthly' | 'quarterly'
| - periodStart: DateTime |
| - periodEnd: DateTime |
| - targetValue: number |
| - actualValue: number |
| - unit: 'egp' | 'orders' | 'customers'
+------------------+

+------------------+
| TargetAchievement|  ← Value Object
+------------------+
| - target: Target |
| - percentage: number |  ← actualValue / targetValue * 100
| - status: 'below' | 'onTrack' | 'achieved' | 'exceeded'
+------------------+

+------------------+
|   KpiDefinition  |  ← Entity
+------------------+
| - code: string   |
| - name: string   |
| - formula: string |  ← 'sales = orders.total' (قاعدة map)
| - dataSource: string |
+------------------+
````

**قواعد ثابتة:**
- `KPI sales` = بيانات `orders` (لا يوجد مصدر منفصل للمبيعات)
- الهدف اليومي = الهدف الشهري / أيام العمل في الشهر

### 3.15 Returns Management

````text
+------------------+
|  ReturnRequest   |  ← Aggregate Root
+------------------+
| - id: string     |
| - orderId: string |
| - customerId: string |
| - employeeId: string |
| - items: ReturnItem[] |
| - reason: string |
| - status: 'pending' | 'approved' | 'rejected' | 'completed'
| - approvalInfo?: ReturnApproval |
| - createdAt: DateTime |
+------------------+
     |
     | يحتوي على
     ├──> ReturnItem (Entity)
     |     - productId: string
     |     - quantity: number
     |     - reason: string
     |     - condition: 'new' | 'used' | 'damaged'
     |
     └──> ReturnApproval (Value Object)
           - approvedBy: string
           - approvedAt: DateTime
           - notes?: string
````

**قواعد ثابتة:**
- `ReturnRequest` مقبول فقط خلال 7 أيام من `Order.deliveredAt`
- `condition = 'damaged'` يتطلب موافقة إضافية
- `approved` return يؤدي إلى `StockMovement.in` تلقائي

### 3.16 Auctions

````text
+------------------+
|    Auction       |  ← Aggregate Root
+------------------+
| - id: string     |
| - productId: string |
| - startingPrice: Money |
| - currentPrice: Money |
| - minBidIncrement: Money |
| - startTime: DateTime |
| - endTime: DateTime |
| - status: 'pending' | 'active' | 'closed' | 'cancelled'
| - winner?: BidInfo |
+------------------+
     |
     | يحتوي على
     v
+------------------+
|      Bid         |  ← Entity
+------------------+
| - auctionId: string |
| - customerId: string |
| - amount: Money  |
| - timestamp: DateTime |
+------------------+

+------------------+
|   BidInfo        |  ← Value Object
+------------------+
| - customerId: string |
| - winningBid: Money |
+------------------+
````

**قواعد ثابتة:**
- كل `Bid.amount` > `currentPrice + minBidIncrement`
- `status` ينتقل: `pending` → `active` → `closed` | `cancelled`
- الفائز ملزم بالسعر

### 3.17 Notification & Alerts

````text
+------------------+
|  Notification    |  ← Aggregate Root
+------------------+
| - id: string     |
| - identityId: string |
| - title: string  |
| - body: string   |
| - type: 'push' | 'in-app'
| - priority: 'low' | 'normal' | 'high' | 'urgent'
| - isRead: boolean |
| - readAt?: DateTime |
| - createdAt: DateTime |
+------------------+

+------------------+
| NotificationPreference | ← Entity
+------------------+
| - identityId: string |
| - channel: 'push' | 'email' | 'sms'
| - isEnabled: boolean |
| - quietHoursStart?: number |
| - quietHoursEnd?: number |
+------------------+
````

### 3.18 Administration

````text
+------------------+
|    Company       |  ← Aggregate Root
+------------------+
| - id: string     |
| - name: string   |
| - database: string |  ← معرف قاعدة البيانات
| - settings: SystemSetting[] |
| - isActive: boolean |
+------------------+

+------------------+
| SystemSetting    |  ← Entity
+------------------+
| - companyId: string |
| - key: string    |
| - value: string  |
| - type: 'string' | 'number' | 'boolean' | 'json'
+------------------+
````

### 3.19 Audit & Log

````text
+------------------+
|   AuditEntry     |  ← Aggregate Root (إلحاق فقط)
+------------------+
| - id: string     |
| - identityId: string |
| - action: string |  ← 'order.create', 'login'
| - entityType: string |
| - entityId: string |
| - oldValue?: object |
| - newValue?: object |
| - ipAddress?: string |
| - timestamp: DateTime |
+------------------+

+------------------+
|   EventLog       |  ← Entity (سجل النظام)
+------------------+
| - id: string     |
| - level: 'info' | 'warning' | 'error'
| - source: string |
| - message: string |
| - stackTrace?: string |
| - metadata?: object |
| - timestamp: DateTime |
+------------------+
````

**قواعد ثابتة:**
- `AuditEntry` إلحاق فقط (لا تعديل، لا حذف)

---

## 4. مصفوفة الـ Models ↔ Capabilities

| الـ Model | القدرة المالكة | هل هو Aggregate Root؟ |
|-----------|---------------|----------------------|
| `Identity` | Identity & Access | ✅ نعم |
| `Session` | Identity & Access | لا |
| `LoginCredential` | Identity & Access | لا |
| `Role` | Authorization | ✅ نعم |
| `Capability` | Authorization | لا |
| `GovernancePolicy` | Authorization | لا |
| `PriceTier` | Pricing & Discounts | ✅ نعم |
| `TierException` | Pricing & Discounts | لا |
| `UnitPrice` | Pricing & Discounts | لا |
| `Deal` / `FlashOffer` / `DailyDeal` | Deals & Offers | ✅ نعم |
| `SalesOrder` | Sales Order Management | ✅ نعم (الأهم) |
| `OrderItem` | Sales Order Management | لا |
| `Customer` | Customer Management | ✅ نعم |
| `Product` | Product Catalog | ✅ نعم |
| `Category` | Product Catalog | لا |
| `CreditReservation` | Credit Management | ✅ نعم |
| `CreditLimit` | Credit Management | لا |
| `CreditTransaction` | Credit Management | لا |
| `Payment` | Collections & Payments | ✅ نعم |
| `Check` | Collections & Payments | ✅ نعم |
| `StockReservation` | Inventory Control | ✅ نعم |
| `InventoryItem` | Inventory Control | لا |
| `Workday` | Attendance & Time | ✅ نعم |
| `BreakPeriod` | Attendance & Time | لا |
| `TrackingSession` | Employee Tracking | ✅ نعم |
| `TrackingPoint` | Employee Tracking | لا |
| `Route` | Route Management | ✅ نعم |
| `RouteVisit` | Route Management | لا |
| `Target` | KPI & Targets | ✅ نعم |
| `KpiDefinition` | KPI & Targets | لا |
| `ReturnRequest` | Returns Management | ✅ نعم |
| `Auction` | Auctions | ✅ نعم |
| `Notification` | Notification & Alerts | ✅ نعم |
| `Company` | Administration | ✅ نعم |
| `AuditEntry` | Audit & Log | ✅ نعم |
