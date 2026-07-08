# 01 – Current Architecture

**التصنيف:** وثيقة معمارية  
**الغرض:** توثيق البنية الحالية للمشروع كما هي دون تغيير  
**تاريخ المسح:** 5 يوليو 2026

---

## 1. Overview

Ahram ERP هو تطبيق ويب من صفحة واحدة (SPA) مبني باستخدام React + TypeScript + Vite + Tailwind CSS، مع Supabase PostgreSQL كقاعدة بيانات ومزود خدمات (BaaS). يدعم التطبيق تشغيل PWA مع Service Worker، وله استعدادات أولية لـ Capacitor (Android/iOS). لا يُستخدم Supabase Auth بل نظام جلسات مخصص عبر RPC.

### Identities
- **نوع التطبيق:** SPA + PWA (+ Capacitor mobile)
- **اللغة:** العربية (RTL) بالكامل
- **نظام المصادقة:** جلسات مخصصة (Custom Session Tokens) عبر RPC
- **قاعدة البيانات:** Supabase PostgreSQL
- **النشر:** GitHub Pages + GitHub Actions CI/CD
- **الـ Bundler:** Vite 5
- **إدارة الحالة:** Zustand 5
- **التوجيه:** React Router DOM v7
- **التوثيق:** TypeScript صارم مع أنواع قاعدة بيانات آلية

---

## 2. Stack

| الطبقة | التقنية | الإصدار |
|--------|---------|---------|
| UI Framework | React | 19 |
| Language | TypeScript | 6.0 |
| Bundler | Vite | 5.4 |
| CSS | Tailwind CSS | 4.3 |
| Routing | react-router-dom | 7.16 |
| State (global) | Zustand | 5.0 |
| State (server) | supabase-js (direct, no React Query) | 2.106 |
| Backend | Supabase (PostgreSQL + RPC) | — |
| PWA | vite-plugin-pwa | 1.3 |
| Mobile | Capacitor | 8.4 |
| PDF | jsPDF + html-to-image | 4.2 / 1.11 |
| Maps | Leaflet + react-leaflet | 1.9 / 5.0 |
| Forms | react-hook-form + zod | 5.4 |
| Notifications | react-hot-toast | 2.6 |
| Icons | lucide-react | 1.17 |
| Dates | date-fns | 4.4 |

---

## 3. Directory Structure

```
store/
├── src/
│   ├── App.tsx                    # Bootstrap: splash, auth restore, providers
│   ├── main.tsx                   # Entry point, ErrorBoundary
│   ├── style.css                  # Global styles, theme variables, animations
│   ├── version.ts                 # Build version constant
│   ├── sw.ts                      # Service Worker (precache, offline, background sync)
│   ├── ambient.d.ts               # Third-party type declarations
│   ├── vite-env.d.ts              # Environment variable types
│   │
│   ├── lib/
│   │   ├── supabase.ts            # Supabase client singleton
│   │   └── whatsapp.ts            # WhatsApp integration utilities
│   │
│   ├── context/
│   │   └── ThemeContext.tsx        # Theme provider (Gold/VIP)
│   │
│   ├── store/                     # Zustand stores
│   │   ├── auth.ts                # Auth state (token, user, session)
│   │   ├── cart.ts                # Shopping cart (persisted to localStorage)
│   │   ├── account.ts             # Customer addresses
│   │   ├── companies.ts           # Companies refresh key
│   │   ├── orders.ts              # Orders list + current
│   │   └── visits.ts              # Visits list + active
│   │
│   ├── services/                  # Data access layer (23 files)
│   │   ├── auth.ts                # login, logout, validate_session, check_capability
│   │   ├── attendance.ts          # Workday, breaks, GPS, policies
│   │   ├── products.ts            # Products CRUD
│   │   ├── returns.ts             # Returns CRUD + approval
│   │   ├── credit.ts              # Credit accounts, invoices, cheques, programs
│   │   ├── auctions.ts            # Auctions, bids, participation
│   │   ├── businessActivity.ts    # KPI detail drill-down
│   │   ├── dailyDeals.ts          # Daily deals CRUD
│   │   ├── flashOffers.ts         # Flash offers CRUD
│   │   ├── tiers.ts               # Tiers CRUD + company exceptions
│   │   ├── targets.ts             # Performance targets
│   │   ├── deals.ts               # Package deals
│   │   ├── location.ts            # Governed locations
│   │   ├── trackingEngine.ts      # GPS tracking session orchestration
│   │   ├── trackingQueue.ts       # Offline tracking queue
│   │   ├── gpsService.ts          # Geolocation API wrapper
│   │   ├── heartbeatService.ts    # Periodic session keepalive
│   │   ├── lifeSignalService.ts   # App lifecycle signals
│   │   ├── notificationService.ts # Push notifications
│   │   ├── lastSeenTracker.ts     # User last-seen tracking
│   │   ├── unifiedSearch.ts       # Cross-entity search
│   │   ├── dataDeletion.ts        # GDPR data deletion
│   │   └── failureLogger.ts       # Error logging
│   │
│   ├── engine/
│   │   └── pricing.ts             # Core pricing engine (tiers, unit conversion, totals)
│   │
│   ├── hooks/
│   │   ├── useAuth.ts             # Auth state hook
│   │   ├── useCapability.ts       # Permission check with cache
│   │   └── useCompanyProfile.ts   # Company contact info
│   │
│   ├── routes/
│   │   └── index.tsx              # All route definitions (~95 routes)
│   │
│   ├── layouts/
│   │   └── AppLayout.tsx          # Main layout: TopBar, BottomNav, floating buttons
│   │
│   ├── modules/
│   │   ├── BusinessActivityModule.tsx  # KPI card panel
│   │   └── types.ts               # Shared module types
│   │
│   ├── components/
│   │   ├── auth/
│   │   │   └── ProtectedRoute.tsx # Route guard with capability checks
│   │   ├── shared/                # 10 shared components (BottomNav, TopBar, etc.)
│   │   ├── orders/                # 16 order components (card, detail, timeline, etc.)
│   │   ├── storefront/            # 11 storefront components
│   │   ├── attendance/            # 2 attendance components
│   │   ├── products/              # 1 product card
│   │   ├── visits/                # 1 visit card
│   │   ├── splash/                # 3 splash/offline/install components
│   │   └── root/                  # 4 standalone components (TrackingExplorer, etc.)
│   │
│   ├── pages/                     # ~42 page directories
│   │   ├── auth/                  # Login, Registration
│   │   ├── dashboard/             # 5+ dashboard/workspace variants
│   │   ├── orders/                # Order list, detail, new, edit, approval
│   │   ├── customers/             # List, profile, new, analytics
│   │   ├── storefront/            # Companies, products, cart, review
│   │   ├── visits/                # List, detail, screen, new
│   │   ├── attendance/            # Runtime, settings, team map, operations
│   │   ├── collections/           # List, new, followup
│   │   ├── returns/               # List, detail, new
│   │   ├── sales-manager/         # 8 sub-pages (CC, targets, operations, field, etc.)
│   │   ├── sales-list/            # Sales price list with PDF export
│   │   ├── ... (33 more)
│   │   └── warehouse/             # Prep, review, detail
│   │
│   ├── capacitor-plugins/
│   │   ├── tracking-service.ts    # Native tracking plugin definition
│   │   └── tracking-service.web.ts # Web fallback
│   │
│   ├── types/
│   │   ├── database.ts            # Supabase Database type definition
│   │   ├── storefront.ts          # Storefront-related types
│   │   ├── order-display.ts       # Order display types
│   │   └── unified-order.ts       # Unified order data type
│   │
│   └── utils/
│       ├── format.ts              # Number, date, currency formatting (Arabic locale)
│       ├── gpsEngine.ts           # Coordinate math, distance calculation
│       ├── hierarchyFilter.ts     # Org hierarchy filtering
│       ├── roleNormalization.ts   # Role mapping + canonicalization
│       ├── pageHealthCheck.ts     # App health monitoring
│       ├── safeAttendanceTime.ts  # Safe time calculations
│       ├── safeValue.ts           # Safe nested access
│       └── systemStates.ts        # System constants
│
├── supabase/
│   └── migrations/                # ~170 migration files
│
├── public/
│   ├── fonts/                     # Tajawal Arabic font
│   └── pwa/                       # PWA icons
│
├── vite.config.ts                 # Vite + React + Tailwind + PWA + 404
├── capacitor.config.ts            # Capacitor mobile config
└── package.json                   # Dependencies
```

---

## 4. Architecture Layers

### 4.1 Presentation
- React components with Tailwind CSS
- RTL-first design
- Theme system (Gold Classic / VIP) via CSS custom properties
- Responsive (mobile-first, desktop-capable)

### 4.2 State Management
- **Zustand** stores for global state (auth, cart, orders, visits, account, companies)
- **localStorage** persistence for cart (`ahram-cart`) and theme (`ahram_theme`)
- **No React Query / TanStack Query** — all server data fetched on mount via service functions

### 4.3 Data Access
- جميع استدعاءات البيانات تمر عبر **Supabase RPC** (`supabase.rpc(...)`) مع `p_token` لمصادقة الطلبات
- لا يتم استخدام `supabase.auth` إطلاقًا
- لا يتم استخدام `supabase.from('table').select()` في معظم الحالات — كل الوصول عبر RPCs
- استثناءات قليلة لاستخدام `from('table')` في الصفحات العامة (Storefront)
- **لا توجد طبقة Data Provider** — كل صفحة تستدعي supabase مباشرة عبر الخدمات

### 4.4 Business Rules
- **مبعثرة** في ثلاثة أماكن رئيسية:
  1. `src/engine/pricing.ts` — قواعد تسعير مركزية
  2. `src/services/*.ts` — منطق الأعمال مخلوط مع استدعاءات البيانات
  3. **Supabase RPC functions** — قواعد الأعمال في قاعدة البيانات (PostgreSQL functions)
  4. مبعثرة في الصفحات والمكونات

### 4.5 Authentication
- نظام جلسات مخصص (ليس Supabase Auth)
- الـ Token يُخزن في `localStorage('session_token')`
- يُمرر كـ `p_token` في كل طلب RPC
- الأدوار: 8 أدوار مقننة (الإدارة العليا، مدير بيع، مندوب مبيعات، مشرف عام، إلخ)
- التحكم بالصلاحيات: Capability-based عبر RPC `check_capability`

---

## 5. Key Architectural Decisions (Current)

### لا توجد طبقة Data Provider
كل صفحة/خدمة تستدعي `supabase.rpc(...)` مباشرة. لا يوجد تجريد بين الواجهة ومصدر البيانات.

### Auth مخصص
لا يُستخدم Supabase Auth إطلاقًا. النظام يستخدم RPC `login`/`logout`/`validate_session` مع تخزين token في localStorage.

### قواعد الأعمال في قاعدة البيانات
جزء كبير من المنطق التجاري موجود في PostgreSQL RPC functions (170+ ملف هجرة). هذا يجعل منطق الأعمال غير مرئي من كود التطبيق.

### لا توجد طبقة اختبارات
لا يوجد مجلد `__tests__` أو `test/`. لا توجد اختبارات للـ Engine أو Services أو Components.

### الخدمات كطبقة وصول بيانات
23 ملف خدمة في `src/services/`. معظمها مجرد wrapper حول `supabase.rpc()`. بعضها يحتوي على منطق أعمال إضافي.

### Pricing Engine
الاستثناء الوحيد — `src/engine/pricing.ts` يحتوي على محرك تسعير مركزي ومنفصل قابل للاختبار.

### Capacitor Mobile
يوجد تكامل أولي مع Capacitor لدعم Android/iOS، مع plugins مخصصة للتتبع.
