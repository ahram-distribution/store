# 12 – Folder Structure V2

**التصنيف:** تصميم معماري — هيكل المجلدات المقترح  
**الغرض:** توثيق الهيكل التنظيمي الجديد للمشروع بعد إضافة الـ 3 طبقات الجديدة  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** مسودة للاعتماد

---

## 1. المبادئ

1. **الفصل حسب الطبقة (Layer First)** — `application/`, `domain/`, `providers/` هي المجلدات العليا
2. **الفصل حسب الميزة داخل كل طبقة** — `order/`, `product/`, `customer/` داخل كل طبقة
3. **لا مجلد `services/` قديم** — سيتم توزيع محتواه بين `application/services/` و `providers/implementations/` و `domain/services/`
4. **المجلدات الموجودة تبقى** — لا إعادة هيكلة جذرية — تدريجياً يتحول الكود
5. **كل طبقة معزولة** — لا import بين الطبقات إلا عبر الـ Interfaces

---

## 2. الهيكل الكامل

```
src/
│
├── main.tsx                          # نقطة الدخول — بدون تغيير
├── App.tsx                           # المكون الجذر — بدون تغيير
├── vite-env.d.ts                     # Types Vite
│
├── bootstrap.ts                      # 🔸 جديد — تهيئة Providers
│                                     #    ProviderRegistry.getInstance()
│                                     #    registry.register('order', new SupabaseOrderProvider())
│                                     #    registry.setDefault('supabase')
│
├── index.css                         # بدون تغيير
│
├─── application/                     # 🔸 جديد — طبقة التطبيق
│   ├── services/                     #     Application Services
│   │   ├── order/
│   │   │   ├── OrderQueryService.ts
│   │   │   ├── OrderCommandService.ts
│   │   │   └── OrderApprovalService.ts
│   │   ├── product/
│   │   │   ├── ProductQueryService.ts
│   │   │   └── ProductSearchService.ts
│   │   ├── customer/
│   │   │   └── CustomerService.ts
│   │   ├── credit/
│   │   │   ├── CreditQueryService.ts
│   │   │   └── CreditCommandService.ts
│   │   ├── attendance/
│   │   │   ├── AttendanceQueryService.ts
│   │   │   └── AttendanceCommandService.ts
│   │   ├── auth/
│   │   │   ├── AuthService.ts
│   │   │   └── SessionService.ts
│   │   └── common/
│   │       └── HealthCheckService.ts
│   │
│   ├── dto/                          #     Data Transfer Objects
│   │   ├── order/
│   │   │   ├── CreateOrderRequest.ts
│   │   │   ├── OrderResponse.ts
│   │   │   ├── OrderFilter.ts
│   │   │   └── OrderCommand.ts
│   │   ├── product/
│   │   │   ├── ProductResponse.ts
│   │   │   ├── ProductFilter.ts
│   │   │   └── ProductSearchRequest.ts
│   │   ├── customer/
│   │   │   ├── CustomerResponse.ts
│   │   │   ├── CustomerFilter.ts
│   │   │   └── CustomerStatsResponse.ts
│   │   ├── credit/
│   │   │   ├── CreditBalanceResponse.ts
│   │   │   ├── CreditTransactionResponse.ts
│   │   │   └── PaymentRequest.ts
│   │   ├── attendance/
│   │   │   ├── StartWorkdayRequest.ts
│   │   │   ├── WorkdayResponse.ts
│   │   │   └── AttendanceReportResponse.ts
│   │   ├── auth/
│   │   │   ├── LoginRequest.ts
│   │   │   ├── LoginResponse.ts
│   │   │   └── SessionResponse.ts
│   │   └── common/
│   │       ├── PaginatedResponse.ts
│   │       ├── ErrorResponse.ts
│   │       └── FilterRequest.ts
│   │
│   ├── mappers/                      #     DTO ↔ Domain
│   │   ├── OrderMapper.ts
│   │   ├── ProductMapper.ts
│   │   ├── CustomerMapper.ts
│   │   ├── CreditMapper.ts
│   │   ├── AttendanceMapper.ts
│   │   └── AuthMapper.ts
│   │
│   ├── validators/                   #     Input Validation
│   │   ├── CreateOrderValidator.ts
│   │   ├── CreateCustomerValidator.ts
│   │   ├── LoginValidator.ts
│   │   └── StartWorkdayValidator.ts
│   │
│   └── factories/                    #     تجميع التبعيات
│       └── serviceFactory.ts
│
├─── domain/                          # 🔸 جديد — طبقة الأعمال
│   ├── models/                       #     Domain Models (Entities)
│   │   ├── Order.ts
│   │   ├── OrderItem.ts
│   │   ├── Product.ts
│   │   ├── Customer.ts
│   │   ├── CreditBalance.ts
│   │   ├── Workday.ts
│   │   └── User.ts
│   │
│   ├── value-objects/                #     Value Objects
│   │   ├── Money.ts
│   │   ├── Quantity.ts
│   │   ├── PhoneNumber.ts
│   │   ├── GpsLocation.ts
│   │   └── DateRange.ts
│   │
│   ├── enums/                        #     Domain Enums
│   │   ├── OrderStatus.ts
│   │   ├── UnitType.ts
│   │   ├── IdentityType.ts
│   │   └── WorkdayStatus.ts
│   │
│   └── services/                     #     Business Logic Services
│       ├── PricingService.ts         #     ← من src/engine/pricing.ts
│       ├── DiscountService.ts
│       ├── CreditLimitService.ts
│       ├── AttendanceCalculator.ts
│       └── CommissionCalculator.ts
│
├─── providers/                       # 🔸 جديد — طبقة مزود البيانات
│   ├── contracts/                    #     Interfaces فقط
│   │   ├── IProvider.ts
│   │   ├── ICrudProvider.ts
│   │   ├── IReadOnlyProvider.ts
│   │   ├── IOrderProvider.ts
│   │   ├── IProductProvider.ts
│   │   ├── ICustomerProvider.ts
│   │   ├── ICreditProvider.ts
│   │   ├── IAttendanceProvider.ts
│   │   ├── ITrackingProvider.ts
│   │   ├── IUserProvider.ts
│   │   ├── IDealProvider.ts
│   │   ├── ICacheProvider.ts
│   │   ├── IUnitOfWork.ts
│   │   ├── IProviderRegistry.ts
│   │   └── exceptions.ts
│   │
│   ├── registry/                     #     تسجيل وإدارة الـ Providers
│   │   ├── ProviderRegistry.ts
│   │   └── types.ts
│   │
│   └── implementations/              #     تنفيذات الـ Providers
│       ├── supabase/
│       │   ├── SupabaseProvider.ts          # Base
│       │   ├── SupabaseOrderProvider.ts
│       │   ├── SupabaseProductProvider.ts
│       │   ├── SupabaseCustomerProvider.ts
│       │   ├── SupabaseCreditProvider.ts
│       │   ├── SupabaseAttendanceProvider.ts
│       │   ├── SupabaseTrackingProvider.ts
│       │   ├── SupabaseUserProvider.ts
│       │   ├── SupabaseDealProvider.ts
│       │   └── SupabaseUnitOfWork.ts
│       │
│       ├── mock/                     #     للتطوير والاختبار
│       │   ├── MockOrderProvider.ts
│       │   ├── MockProductProvider.ts
│       │   ├── MockCustomerProvider.ts
│       │   ├── MockCreditProvider.ts
│       │   ├── MockAttendanceProvider.ts
│       │   ├── MockTrackingProvider.ts
│       │   ├── MockUserProvider.ts
│       │   └── MockDataStore.ts      #     البيانات الوهمية
│       │
│       └── local/                    #     للمستقبل — IndexedDB للتخزين المحلي
│           └── (في مرحلة لاحقة)
│
├─── store/                           # 🔸 موجود — يحتاج تحديثات طفيفة
│   ├── auth.ts                       #     يبقى — لكن يستخدم IUserProvider (أو لا)
│   ├── cart.ts                       #     يبقى — لكن يستخدم Application Services
│   ├── account.ts
│   ├── order-requests.ts
│   └── orders.ts
│
├─── services/                        # ⚠️ موجود — سيتم إيقافه تدريجياً
│   ├── *.ts                          #     كل ملف Service قديم
│   └── ...                           #     يبقى مؤقتاً أثناء الترحيل
│
├─── engine/                          # ⚠️ موجود — سينتقل إلى domain/services/
│   └── pricing.ts                    #     سينتقل إلى domain/services/PricingService.ts
│
├─── pages/                           # ⚠️ موجود — يستدعي Application Services الجديدة
│   ├── sales-list/
│   ├── attendance-runtime/
│   ├── ... (42 صفحة)
│   └── ...
│
├─── components/                      # موجود — بدون تغيير جذري
│   ├── auth/
│   ├── shared/
│   ├── ...
│   └── ...
│
├─── hooks/                           # موجود — قد يحتاج تحديثات طفيفة
│   ├── useAuth.ts
│   ├── useCapability.ts
│   └── useCompanyProfile.ts
│
├─── utils/                           # موجود — بدون تغيير
│   ├── format.ts
│   ├── roleNormalization.ts
│   ├── gpsEngine.ts
│   └── ...
│
├─── types/                           # موجود — سينتقل إلى domain/models/
│   └── ...
│
├─── routes/                          # موجود — بدون تغيير
│   └── index.tsx
│
├─── layouts/                         # موجود — بدون تغيير
│   └── AppLayout.tsx
│
├─── lib/                             # موجود — بدون تغيير (يبقى Supabase client)
│   └── supabase.ts
│
├─── context/                         # موجود — بدون تغيير
│   └── ThemeContext.tsx
│
├─── modules/                         # موجود — بدون تغيير
│
├─── capacitor-plugins/               # موجود — يبقى Infrastructure
│   ├── trackingEngine.ts
│   └── ...
│
└─── sw.ts                            # موجود — بدون تغيير
```

---

## 3. مصفوفة الـ 23 Service الحالية: إلى أين تذهب

| الـ Service الحالي | الوجهة الجديدة |
|--------------------|---------------|
| `auth.ts` | `application/services/auth/AuthService.ts` + `providers/implementations/supabase/SupabaseUserProvider.ts` |
| `attendance.ts` | `application/services/attendance/AttendanceCommandService.ts` + `SupabaseAttendanceProvider.ts` |
| `products.ts` | `application/services/product/ProductQueryService.ts` + `SupabaseProductProvider.ts` |
| `orders.ts` | `application/services/order/OrderQueryService.ts` + `SupabaseOrderProvider.ts` |
| `credit.ts` | `application/services/credit/CreditCommandService.ts` + `SupabaseCreditProvider.ts` |
| `returns.ts` | `application/services/order/OrderCommandService.ts` + `SupabaseOrderProvider.ts` |
| `auctions.ts` | `application/services/product/ProductQueryService.ts` + `SupabaseProductProvider.ts` |
| `dailyDeals.ts` | `providers/implementations/supabase/SupabaseDealProvider.ts` |
| `flashOffers.ts` | `providers/implementations/supabase/SupabaseDealProvider.ts` |
| `tiers.ts` | `providers/implementations/supabase/SupabaseDealProvider.ts` |
| `deals.ts` | `providers/implementations/supabase/SupabaseDealProvider.ts` |
| `targets.ts` | `application/services/attendance/AttendanceQueryService.ts` |
| `location.ts` | `domain/value-objects/GpsLocation.ts` + `SupabaseTrackingProvider.ts` |
| `trackingEngine.ts` | `providers/implementations/supabase/SupabaseTrackingProvider.ts` + يبقى Infrastructure |
| `trackingQueue.ts` | `providers/implementations/local/LocalQueueProvider.ts` (مستقبلا) |
| `gpsService.ts` | `domain/services/TrackingService.ts` (يبقى Infrastructure) |
| `heartbeatService.ts` | `providers/implementations/supabase/SupabaseTrackingProvider.ts` |
| `lifeSignalService.ts` | `providers/implementations/supabase/SupabaseUserProvider.ts` |
| `notificationService.ts` | `application/services/common/NotificationService.ts` |
| `lastSeenTracker.ts` | `providers/implementations/supabase/SupabaseUserProvider.ts` |
| `dataDeletion.ts` | `application/services/common/DataDeletionService.ts` |
| `unifiedSearch.ts` | `application/services/common/SearchService.ts` |
| `failureLogger.ts` | يبقى Infrastructure (Logging) |

---

## 4. تطور الهيكل — مراحل الترحيل

```
المرحلة 1 (الحالي):
src/
├── services/      ← 23 ملف — كل شيء هنا
├── engine/        ← Pricing
└── pages/         ← تستدعي services مباشرة

المرحلة 2 (إضافة طبقات — لا حذف):
src/
├── providers/     ← جديد — واجهات + تنفيذ Supabase
├── application/   ← جديد — خدمات التطبيق
├── domain/        ← جديد — نماذج + منطق أعمال
├── services/      ← موجود — يبقى للتوافق
├── engine/        ← موجود — سينتقل تدريجياً
└── pages/         ← تتحول تدريجياً لاستخدام application services

المرحلة 3 (إيقاف القديم):
src/
├── providers/     ← مكتمل
├── application/   ← مكتمل
├── domain/        ← مكتمل
├── services/      ← ⛔ إيقاف
├── engine/        ← منقول إلى domain/
└── pages/         ← كلها تستخدم application services

المرحلة 4 (إضافة Providers جديدة):
src/
├── providers/implementations/
│   ├── supabase/  ← موجود
│   ├── mock/      ← للاختبار
│   ├── local/     ← تخزين محلي
│   └── postgres/  ← مستقبلاً
```
