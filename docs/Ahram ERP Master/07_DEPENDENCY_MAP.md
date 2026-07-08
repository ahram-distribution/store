# 07 – Dependency Map

**التصنيف:** خريطة التبعيات  
**الغرض:** توثيق جميع التبعيات الخارجية والداخلية والأدوات  
**تاريخ المسح:** 5 يوليو 2026

---

## 1. التبعيات الخارجية (Production Dependencies)

| الحزمة | الإصدار | الوظيفة | هل يمكن الاستغناء عنها؟ |
|--------|---------|---------|----------------------|
| **react** | ^18 | UI Framework | لا |
| **react-dom** | ^18 | DOM Renderer | لا |
| **react-router-dom** | ^6 | Routing | ممكن (لكن صعب) |
| **zustand** | ^4 | State Management | ممكن (Context API) |
| **@supabase/supabase-js** | ^2 | Database Client | لا (البيانات كلها عبره) |
| **@capacitor/*** | ^6 | Mobile Native Features | نعم (PWA فقط) |
| **html-to-image** | ^1.11 | HTML → PNG/PDF | نعم (لكن PDF العربي يحتاجه) |
| **jspdf** | ^2.5 | PDF Generation | نعم (البديل: Print API) |
| **tailwindcss** | ^3 | CSS Framework | ممكن (CSS عادي) |
| **@headlessui/react** | ^1 | Unstyled Components | ممكن |
| **@heroicons/react** | ^2 | Icons | ممكن |
| **@vitejs/plugin-react-swc** | ^3 | Vite Plugin | لا (Build only) |
| **typescript** | ^5 | Type Safety | لا (Build only) |
| **autoprefixer** | ^10 | CSS Postprocessor | لا (Build only) |
| **postcss** | ^8 | CSS Postprocessor | لا (Build only) |

### تبعيات Supabase

| الوظيفة | تستخدم في |
|---------|-----------|
| `createClient(url, key)` | `src/lib/supabase.ts` — مرة واحدة فقط |
| `client.rpc(name, params)` | **165+ استدعاء** عبر جميع الـ Services |
| `client.channel('*')` | Realtime subscriptions (غير مستخدم حالياً) |
| `client.storage.*` | غير مستخدم — الرفع يتم عبر RPC أيضاً |

### تبعيات Capacitor

| الحزمة | الوظيفة | هل تستخدم؟ |
|--------|---------|-----------|
| `@capacitor/core` | Core runtime | نعم |
| `@capacitor/android` | Android build | (غير متأكد) |
| `@capacitor/ios` | iOS build | (غير متأكد) |
| Capacitor plugins | GPS, Camera, Push | (موجودة في الشيفرة) |

---

## 2. التبعيات الداخلية — الـ Store (zustand)

| Store | يعتمد على | تعتمد عليه |
|-------|-----------|-----------|
| `store/auth.ts` | `services/auth.ts` | `useAuth` hook, `App.tsx`, `ProtectedRoute`, معظم الصفحات |
| `store/cart.ts` | `engine/pricing.ts` | صفحات إنشاء الطلب والدفع |
| `store/account.ts` | `services/credit.ts` | `CartStore`, صفحات الدفع |
| `store/order-requests.ts` | `services/` | صفحات الطلبات |
| `store/orders.ts` | (لم يُفحص بالكامل) | (لم يُفحص) |
| `useAuthStore` | `services/auth.ts` | التطبيق بأكمله |

---

## 3. التبعيات الداخلية — الـ Hooks

| Hook | يعتمد على | تعتمد عليه |
|------|-----------|-----------|
| `useAuth` | `store/auth.ts` | جميع الصفحات المحمية |
| `useCapability` | `services/auth.ts`, `authStore`, `roleNormalizationUtils` | `ProtectedRoute`, صفحات تحتاج صلاحية |
| `useCompanyProfile` | `supabase.rpc()` | صفحة تسجيل الدخول، Storefront |

---

## 4. تبعيات الملفات الثابتة (Static Assets)

| المسار | النوع | الحجم التقريبي |
|--------|-------|---------------|
| `public/assets/` | صور، أيقونات، fonts | غير معروف |
| `public/manifest.json` | PWA manifest | صغير |
| `public/favicon.ico` | Favicon | صغير |
| `public/logo*.png` | الشعار بأحجام مختلفة | ~100KB |
| `public/robots.txt` | SEO | صغير |
| `public/sitemap.xml` | SEO | صغير |
| `src/index.css` | Tailwind + custom CSS | ~1000 سطر |

---

## 5. تبعيات الـ SW (Service Worker)

| المورد | النوع |
|--------|-------|
| `sw.ts` | Service Worker logic |
| `manifest.json` | PWA manifest |
| IndexedDB (عبر `idb` أو native) | Offline queue لـ GPS tracking |
| Cache API | Precache للـ static assets |

---

## 6. تبعيات البناء (Build Chain)

```
Vite (vite.config.ts)
  │
  ├── @vitejs/plugin-react-swc — SWC-based React Fast Refresh
  │
  ├── postcss.config.js
  │     └── tailwindcss
  │     └── autoprefixer
  │
  ├── tailwind.config.js
  │     └── Custom theme colors, fonts, breakpoints
  │
  └── TypeScript (tsconfig.json)
        └── Path aliases (@/ → src/)
```

---

## 7. الملفات غير المستخدمة أو المكررة (Dead/Duplicate Dependencies)

| الملف | المشكلة |
|-------|---------|
| `@capacitor/*` plugins | لا يوجد ملف تكوين `capacitor.config.ts` — هل Capacitor مُهيأ فعلاً؟ |
| `client.channel('*')` | Realtime ليس له استخدام فعلي في الشيفرة |
| `html2canvas` | تم استبداله بـ `html-to-image` — قد لا يزال مثبتاً |
| `public/` بعض الملفات | مجلد ثابت قد يحتوي ملفات غير مستخدمة |

---

## 8. شجرة التبعيات الكاملة (Tree Form)

```
node_modules/
├── react-icons/         ← تستخدمه TailAdmin
├── react-hot-toast/     ← الإشعارات
├── faker-js/faker       ← بيانات وهمية (تطوير)
├── zustand/             ← إدارة الحالة
├── @supabase/supabase-js ← قاعدة البيانات
├── @capacitor/*         ← الموبايل (ربما غير مفعل)
├── html-to-image        ← PDF العربي
├── jspdf                ← PDF
├── react-router-dom     ← التوجيه
├── tailwindcss          ← الـ CSS
├── @headlessui/react    ← UI Components
└── @heroicons/react     ← الأيقونات
```

---

## 9. دائرة التبعيات (Dependency Cycles)

✅ **لا توجد تبعيات دائرية معروفة.**  
الهرمية: `Pages → Components → Services → lib/supabase` مع `Engine` و `Store` كطبقات أفقية.

---

## 10. ملاحظات الأمان — تبعيات خطيرة

| التبعية | الخطر |
|---------|-------|
| `localStorage('session_token')` | XSS يمكنه سرقة الجلسة — لا `httpOnly` |
| `Supabase anon key` | مكشوف في client-side — مقبول لـ Row Level Security |
| الـ token يُمرر كـ argument في RPC | لا `Authorization` header — غير قياسي |
