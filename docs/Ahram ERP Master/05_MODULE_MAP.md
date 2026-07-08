# 05 – Module Map

**التصنيف:** خريطة الوحدات  
**الغرض:** توثيق تنظيم الوحدات والتبعيات بينها  
**تاريخ المسح:** 5 يوليو 2026

---

## 1. Modules (High-Level)

| الوحدة | المسار | الحجم (ملفات) | التبعيات |
|--------|--------|--------------|---------|
| **Core** | `src/lib/`, `src/context/`, `src/store/`, `src/hooks/` | 12 | — |
| **Services** | `src/services/` | 23 | Core |
| **Engine** | `src/engine/` | 1 | Core (أنواع) |
| **Components** | `src/components/` | 46 | Core, Services |
| **Pages** | `src/pages/` | ~100 | Core, Services, Components, Engine |
| **Routes** | `src/routes/` | 1 | Pages, Components |
| **Layouts** | `src/layouts/` | 1 | Components |
| **Types** | `src/types/` | 4 | — |
| **Utils** | `src/utils/` | 8 | Core |
| **Modules** | `src/modules/` | 2 | Core |
| **Capacitor** | `src/capacitor-plugins/` | 2 | Core |

---

## 2. Dependency Graph

```
src/lib/supabase.ts
  └── تستخدمه جميع الـ Services وجميع الـ Pages التي تستدعي supabase مباشرة

src/store/auth.ts
  └── تعتمد عليه: App.tsx, useAuth, ProtectedRoute, جميع الصفحات المحمية

src/services/auth.ts
  └── تعتمد عليه: useAuth, useAuthStore (login/logout/restoreSession)

src/engine/pricing.ts
  └── تعتمد عليه: cart store, storefront pages, order pages

src/hooks/useCapability.ts
  └── تعتمد عليه: ProtectedRoute, الصفحات التي تحتاج صلاحية

src/hooks/useAuth.ts
  └── تعتمد عليه: معظم الصفحات

src/hooks/useCompanyProfile.ts
  └── تعتمد عليه: LoginPage, Storefront

App.tsx
  ├── ThemeProvider (context)
  ├── AppLayout (layouts)
  │     ├── TopBar
  │     ├── BottomNav
  │     └── ErrorBoundary
  └── Routes → ProtectedRoute → Pages → Components → Services → lib/supabase
```

---

## 3. الـ Services: هيكل الوحدة

| الخدمة | RPCs فريدة | تعتمد على Services أخرى | منطق أعمال إضافي |
|--------|-----------|------------------------|------------------|
| `auth.ts` | 5 | لا | لا |
| `attendance.ts` | 28 | لا | نعم (حساب الساعات) |
| `products.ts` | 1 (مع overloads) | لا | لا |
| `returns.ts` | 6 | لا | لا |
| `credit.ts` | 20 | لا | لا |
| `auctions.ts` | 4 | لا | لا |
| `dailyDeals.ts` | 5 | لا | لا |
| `flashOffers.ts` | 5 | لا | لا |
| `tiers.ts` | 5 | لا | لا |
| `targets.ts` | RPC ديناميكي | لا | لا |
| `deals.ts` | 2 | لا | لا |
| `location.ts` | 3 | لا | لا |
| `trackingEngine.ts` | 1 | trackingQueue, gpsService | نعم (جلسة GPS) |
| `trackingQueue.ts` | 0 (IndexedDB) | لا | نعم (قائمة انتظار) |
| `gpsService.ts` | 0 (Geolocation API) | لا | نعم (دقة GPS) |
| `heartbeatService.ts` | 2 | trackingEngine | نعم (مؤقت) |
| `lifeSignalService.ts` | 1 | لا | نعم (حالة التطبيق) |
| `notificationService.ts` | 0 (push) | لا | لا |
| `lastSeenTracker.ts` | 0 | لا | نعم (تتبع النشاط) |
| `dataDeletion.ts` | RPC ديناميكي | لا | نعم (صفحات + تأكيد) |
| `unifiedSearch.ts` | 1 | لا | لا |
| `failureLogger.ts` | 0 | لا | لا |
| `businessActivity.ts` | 1 | لا | نعم (KPI rule: sales=orders) |

---

## 4. التبعيات بين الـ Services

| الخدمة | تعتمد على |
|--------|-----------|
| `trackingEngine.ts` | `trackingQueue.ts`, `gpsService.ts`, `attendance.ts` (غير مباشر) |
| `heartbeatService.ts` | `trackingEngine.ts`, `auth.ts` (token) |
| `lifeSignalService.ts` | لا شيء (يستخدم `navigator` APIs) |
| جميع الخدمات | `src/lib/supabase.ts` |

**ملاحظة:** لا توجد تبعيات دائرية بين الخدمات. هرمية بسيطة.

---

## 5. صفحات مع تبعيات متعددة

| الصفحة | تعتمد على |
|--------|-----------|
| `OrderNewPage` | `productService`, `creditService`, `lifeSignalService`, `useAuthStore`, `pricingEngine` |
| `OrderReviewPage` | `useCartStore`, `useAuthStore`, `creditService`, `lifeSignalService`, مباشر RPC |
| `CheckoutPage` | `useCartStore`, `useAccountStore`, `useOrdersStore` |
| `AttendanceRuntimePage` | `attendanceService`, `trackingEngine`, `heartbeatService`, `useAuthStore` |

---

## 6. الوحدات القابلة لإعادة الاستخدام

| الوحدة | الموقع | قابلية إعادة الاستخدام |
|--------|--------|----------------------|
| Pricing Engine | `src/engine/pricing.ts` | ✅ **عالية جداً** — مستقلة، لا تعتمد على Supabase |
| Theme Context | `src/context/ThemeContext.tsx` | ✅ عالية — معزولة |
| Auth Store | `src/store/auth.ts` | ✅ عالية — تعتمد فقط على auth service |
| Role Normalization | `src/utils/roleNormalization.ts` | ✅ عالية — pure functions |
| GPS Engine | `src/utils/gpsEngine.ts` | ✅ عالية — pure functions |
| Format Utils | `src/utils/format.ts` | ✅ عالية — pure functions |
| Shared Components | `src/components/shared/` | ✅ متوسطة — تعتمد على supabase للبيانات |
| Services | `src/services/` | ❌ **منخفضة** — كل Service مرتبط بـ RPCات supabase |

---

## 7. الوحدات المقترنة بشدة (Tightly Coupled)

| الوحدة | مقترنة بـ | مستوى الاقتران |
|--------|-----------|----------------|
| جميع الـ Services | `supabase.rpc()` 🡪 `public.*_governed_*` functions | **شديد جداً** |
| `useAuth` | `localStorage('session_token')` | متوسط |
| `useCapability` | `check_capability` RPC | شديد |
| Attendance Pages | `attendance.ts` service 🡪 28 RPC | **شديد جداً** |
| Credit Pages | `credit.ts` service 🡪 20 RPC | **شديد جداً** |
| Auth Pages | `auth.ts` service 🡪 5 RPC | شديد |

**الخلاصة:** 165+ نقطة اقتران مباشر بقاعدة البيانات عبر RPC — لا توجد طبقة تجريد.
