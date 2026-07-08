# 06 – Runtime Flow

**التصنيف:** تدفق التشغيل  
**الغرض:** توثيق تسلسل بدء التشغيل، المصادقة، التوجيه، وإدارة الجلسات  
**تاريخ المسح:** 5 يوليو 2026

---

## 1. Startup Sequence

```
1. المستخدم يفتح التطبيق
     │
     ├── [Web] index.html ← Vite builds
     ├── [PWA] sw.ts service worker installs/activates
     └── [Mobile] Capacitor loads WebView → index.html
           │
           ▼
2. main.tsx
     ├── ErrorBoundary يلف التطبيق
     └── renders <App/>
           │
           ▼
3. App.tsx
     ├── healthMonitor.start() — فحص صحة الصفحة
     ├── useAuth().restoreSession() — استعادة الجلسة
     │     │
     │     ├── localStorage('session_token') موجود؟
     │     │     ├── لا → set loading=false (مستخدم غير مسجل)
     │     │     └── نعم →
     │     │           └── RPC 'validate_session(p_token)'
     │     │                 ├── Valid → user = response data
     │     │                 └── Invalid → clear token, sessionExpired=true
     │     │
     │     └── loading=false
     │
     ├── أثناء loading=true:
     │     └── SplashScreen مع رسالة "جاري التحقق من المستخدم"
     │
     └── بعد loading=false:
           ├── ThemeProvider يلف التطبيق
           ├── AppLayout يلف التطبيق (TopBar, BottomNav, floating buttons)
           └── Routes تبدأ العرض
```

---

## 2. Auth Flow

```
Login:
  User → Phone + Password → LoginPage
    │
    └── authService.login(phone, password)
          │
          └── RPC 'login(p_phone, p_password)'
                │
                └── Response:
                      ├── session_token (uuid)
                      ├── identity_id
                      ├── identity_type ('employee' | 'customer')
                      ├── employee_id? (اختياري)
                      ├── customer_id? (اختياري)
                      ├── full_name
                      ├── roles[] (مصفوفة نصوص)
                      └── company_name?
                │
                └── useAuthStore.login(response)
                      ├── localStorage.setItem('session_token', token)
                      └── state = { user, token, loading: false }

Validate Session (عند بدء التشغيل):
  localStorage('session_token') → authService.validateSession(token)
    │
    └── RPC 'validate_session(p_token)'
          │
          └── Response:
                ├── valid: boolean
                ├── identity_id, identity_type, roles, ...
                └── employee (بيانات الموظف إذا وجد)

Logout:
  authService.logout(token)
    │
    └── RPC 'logout(p_token)' → server invalidates
    └── localStorage.removeItem('session_token')
    └── state reset → redirect to /login
```

---

## 3. Routing Flow

```
AppRoutes (src/routes/index.tsx)
  │
  ├── if (!token): Public Routes
  │     ├── /login → LoginPage
  │     ├── /register → RegistrationPage
  │     ├── /storefront → CompaniesPage
  │     ├── /storefront/products → StorefrontPage
  │     ├── /daily-deals → DailyDealsPage
  │     ├── /daily-deals/:id → DailyDealDetailPage
  │     ├── /flash-offers → FlashOffersPage
  │     ├── /flash-offers/:id → FlashOfferDetailPage
  │     ├── /tiers → TierSystemPage
  │     ├── /auctions → AuctionsPage
  │     ├── /auctions/:id → AuctionDetailPage
  │     ├── / → redirect to /storefront
  │     └── * → redirect to /login
  │
  └── if (token): Protected Routes
        └── جميع المسارات ملفوفة بـ <ProtectedRoute [guards]>
              │
              ├── بدون guard → أي مستخدم مسجل
              ├── employeeOnly → فقط الموظفين
              ├── requireCapability="..." → الصلاحية مطلوبة
              ├── requireUpperManagement → الإدارة العليا فقط
              └── customerOnly → العملاء فقط

Home Redirect:
  ── token = employee → /dashboard
  ── token = customer → /storefront
```

---

## 4. Capability Check Flow

```
ProtectedRoute / useCapability(code)
  │
  ├── identity_type !== 'employee' → deny (redirect to /storefront)
  │
  ├── isUpperManagement(role) → permit (بدون استدعاء RPC)
  │
  ├── Cache hit (useCapability internal LRU, 5min TTL) → return cached
  │
  └── RPC 'check_capability(p_token, p_code)'
        │
        ├── true → permit
        └── false → deny (redirect to /dashboard)
```

---

## 5. Service Worker Flow

```
src/sw.ts
  │
  ├── install:
  │     └── Precache جميع ملفات التطبيق
  │
  ├── activate:
  │     └── حذف الـ caches القديمة
  │
  ├── fetch:
  │     ├── Cache-first للملفات الثابتة
  │     └── Network-first للإستعلامات (RPC calls)
  │
  └── background sync:
        └── مزامنة نقاط التتبع المعلقة (tracking points)
              └── من IndexedDB إلى server
```

---

## 6. GPS Tracking Flow

```
AttendanceRuntimePage
  │
  ├── startWorkday() → RPC 'start_workday'
  │     └── تنشيط trackingEngine
  │
  ├── trackingEngine:
  │     ├── Geolocation.watchPosition() → كل ثواني محددة
  │     ├── تسجيل نقطة مع timestamp + الموقع + دقة + بطارية
  │     ├── تخزين في IndexedDB إذا disconnected
  │     └── sync_tracking_points RPC كل دقيقة أو عند إعادة الاتصال
  │
  ├── heartbeatService:
  │     └── record_heartbeat RPC كل 5 دقائق
  │           └── check_session_timeout بعد 30 دقيقة انقطاع
  │
  ├── startBreak() → RPC 'start_break'
  ├── endBreak() → RPC 'end_break'
  │
  └── endWorkday() → RPC 'end_workday'
        └── إيقاف trackingEngine
```

---

## 7. Data Flow for a Typical Page

مثال: صفحة قائمة الطلبات (`OrdersPage`)

```
1. OrdersPage تتحمل
2. useAuth() → تجلب token من store
3. useEffect → استدعاء get_governed_orders(p_token)
     │
     └── supabase.rpc('get_governed_orders', { p_token })
           │
           └── PostgreSQL RPC:
                 ├── التحقق من صحة الجلسة
                 ├── تطبيق قواعد حوكمة الوصول
                 └── إرجاع الطلبات المسموح بها
     │
     └── useState → تخزين النتائج في state محلي
4. Render:
     └── جدول الطلبات مع التصفية والبحث المحلي
```

---

## 8. Token Lifecycle

| المرحلة | الإجراء |
|---------|---------|
| **إنشاء** | `login` RPC يُرجع token |
| **تخزين** | `localStorage.setItem('session_token', token)` |
| **استخدام** | يُمرر كـ `p_token` في كل طلب RPC |
| **تحقق دوري** | `validate_session` عند بدء التشغيل |
| **انتهاء الصلاحية** | `validate_session` يفشل ← `sessionExpired=true` ← إعادة توجيه للـ login |
| **إنهاء** | `logout` RPC + حذف من localStorage |

---

## 9. ملاحظات هامة

1. **لا يوجد Refresh Token** — الـ token ينتهي بعد 24 ساعة (`expires_at`)
2. **لا يوجد Silent Refresh** — إذا انتهت الجلسة، المستخدم يجب أن يسجل دخول مجدداً
3. **الـ Token يُمرر كـ Argument** — ليس كـ HTTP Header (لا يستخدم `Authorization: Bearer`)
4. **لا يوجد Supabase Auth** — النظام لا يستخدم `supabase.auth` إطلاقاً
5. **وحدة التتبع GPS مستمرة** — حتى لو كان التطبيق في الخلفية (عبر Capacitor أو SW background sync)
