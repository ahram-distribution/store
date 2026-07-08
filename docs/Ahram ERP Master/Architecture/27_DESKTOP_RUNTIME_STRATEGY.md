# 27 – Desktop Runtime Strategy

**التصنيف:** مواصفة معمارية — منصة تشغيل الديسكتوب  
**الغرض:** توثيق استراتيجية Electron كمنصة تشغيل رسمية لـ Ahram Desktop — العمارة، IPC، الأمان، الخدمات  
**تاريخ الإصدار:** 5 يوليو 2026  
**الإصدار:** 1.0  
**الحالة:** مجمّدة — ✅ معتمدة  
**الـ ADR المرتبط:** ADR-010 (في 20_ARCHITECTURE_DECISIONS.md)

---

## 1. القرار

**Electron هو منصة تشغيل (Runtime Host) رسمية لتطبيق Ahram Desktop.**

Electron **ليس** جزءاً من Business Architecture.  
Electron هو **Platform Host** — يوفّر بيئة تشغيل Windows مع خدمات نظام التشغيل.

React يبقى **طبقة العرض (Presentation Layer)** — لا علاقة له بـ Node.js أو APIs Electron.

---

## 2. مقارنة Electron vs Tauri

| المعيار | Electron | Tauri | الفائز |
|---------|----------|-------|--------|
| **حجم المثبّت** | ~150MB | ~5MB | Tauri |
| **استهلاك RAM** | ~150-250MB | ~50-100MB | Tauri |
| **وقت البدء** | ~2-3s | ~0.5-1s | Tauri |
| **مكتبات Native** | Node.js — غنية جداً | Rust — محدودة | **Electron** |
| **Local PostgreSQL** | child_process spawn | ط.ل. معقد مع Rust | **Electron** |
| **Auto Update** | electron-updater — ناضج | @tauri-apps/updater — حديث | **Electron** |
| **Printing API** | ناضج (Browser + Native) | محدود | **Electron** |
| **Multi-window** | native, ناضج | ممكن عبر Rust | **Electron** |
| **File System** | fs — كامل | Rust fs API | **Electron** |
| **Background Services** | Main Process + hidden window | Rust backend | **Electron** |
| **Plugin System** | node_modules + dynamic require | Rust compilation needed | **Electron** |
| **AI Integration (Local LLM)** | child_process لـ Python/ONNX | Rust + tch-rs | **Electron** |
| **Database Explorer** | pg + child_process | Rust + sqlx | **Electron** |
| **Community & Ecosystem** | ضخم — 10+ سنوات | صغير — 3 سنوات | **Electron** |
| **Developer Availability** | JavaScript/TypeScript | Rust مطلوب | **Electron** |
| **Maintenance Cost** | أقل (فريق JS موجود) | أعلى (يحتاج Rust) | **Electron** |

### 2.1 ملخص

| البعد | النتيجة |
|-------|---------|
| **الأفضل للمستخدم النهائي** | Tauri (أصغر، أسرع) |
| **الأفضل للمشروع المؤسسي** | **Electron** (نضج، بيئة، APIs، صيانة) |

**القرار:** نختار Electron بناءً على **متطلبات المشروع المؤسسي** — وليس على حجم المثبّت أو استهلاك RAM.

---

## 3. النموذج المعماري

```
┌──────────────────────────────────────────────────────────────┐
│                     Ahram Platform                           │
├──────────────────────────────────────────────────────────────┤
│  Electron Main Process (Node.js)                             │
│                                                              │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐   │
│  │ Window  │ │  App     │ │  IPC     │ │  Service      │   │
│  │ Manager │ │ Lifecycle│ │ Router   │ │  Manager      │   │
│  └─────────┘ └──────────┘ └──────────┘ └───────────────┘   │
│                                                              │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌────────────┐   │
│  │PostgreSQL│ │  Backup   │ │  Sync    │ │  AI        │   │
│  │ Manager  │ │  Engine   │ │  Engine  │ │  Runtime   │   │
│  └──────────┘ └───────────┘ └──────────┘ └────────────┘   │
│                                                              │
│  ┌──────────┐ ┌────────────┐ ┌──────────┐ ┌────────────┐   │
│  │  Print   │ │  Database  │ │  Plugin  │ │  License   │   │
│  │ Service  │ │  Explorer  │ │  Loader  │ │  Manager   │   │
│  └──────────┘ └────────────┘ └──────────┘ └────────────┘   │
├──────────────────────────────────────────────────────────────┤
│  preload.ts — IPC Bridge (contextBridge)                     │
├──────────────────────────────────────────────────────────────┤
│  Renderer Process (Chromium — React)                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Presentation Layer (React)                          │    │
│  │  • Pages, Components, Layouts                        │    │
│  │  • يستدعي Application Services فقط                   │    │
│  │  • لا يعرف Electron APIs                             │    │
│  │  • يتواصل مع Main عبر window.api.* فقط               │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Application / Domain / Provider Layers              │    │
│  │  • مشتركة مع Mobile PWA                             │    │
│  │  • نفس الكود — لا نسختين                             │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. مسؤوليات Main Process

### 4.1 النواة (Core)

| الخدمة | المسؤولية | الحالة |
|--------|-----------|--------|
| **Window Manager** | إنشاء، إغلاق، ترتيب النوافذ — تعدد النوافذ (Dashboard, Orders, Reports) | (مستقبلاً) |
| **App Lifecycle** | بدء، إيقاف، Restart, Quit — التعامل مع system tray | (مستقبلاً) |
| **IPC Router** | توجيه الطلبات من Renderer إلى الخدمات المناسبة | (مستقبلاً) |
| **Service Manager** | بدء/إيقاف الخدمات الخلفية (PostgreSQL, Sync, AI) | (مستقبلاً) |
| **Auto Update** | التحقق من التحديثات، التحميل، التثبيت (electron-updater) | (مستقبلاً) |
| **Logging** | تسجيل أحداث التطبيق — ملفات logs محلية | (مستقبلاً) |

### 4.2 البيانات (Data)

| الخدمة | المسؤولية | الحالة |
|--------|-----------|--------|
| **PostgreSQL Manager** | بدء/إيقاف عملية PostgreSQL المحلية، إدارة قاعدة البيانات | (مستقبلاً) |
| **Backup Engine** | أخذ نسخة احتياطية من قاعدة البيانات المحلية | (مستقبلاً) |
| **Restore Engine** | استعادة قاعدة البيانات من نسخة احتياطية | (مستقبلاً) |
| **Sync Engine** | مزامنة البيانات بين Local PostgreSQL و Supabase | (مستقبلاً) |
| **Database Explorer** | تصفّح جداول وبيانات قاعدة البيانات المحلية (أداة مساعدة) | (مستقبلاً) |

### 4.3 النظام (System)

| الخدمة | المسؤولية | الحالة |
|--------|-----------|--------|
| **Print Service** | طباعة التقارير والفواتير — native print dialog + PDF | (مستقبلاً) |
| **File Explorer** | اختيار ملفات، فتح مجلدات، تصدير بيانات | (مستقبلاً) |
| **AI Runtime** | تشغيل نماذج LLM محلية (via child_process لـ Python/ONNX) | (مستقبلاً) |
| **Plugin Loader** | تحميل وتشغيل الإضافات (dynamic require من مجلد plugins/) | (مستقبلاً) |
| **License Manager** | التحقق من الترخيص، تفعيل/إلغاء | (مستقبلاً) |
| **Diagnostics** | تشخيص حالة النظام — التقارير، الفحوصات | (مستقبلاً) |

---

## 5. مسؤوليات Renderer (React)

**Renderer يمتلك فقط:**

- UI Components (Pages, Layouts, Shared)
- Navigation (React Router)
- User Interaction (Events, Forms, Gestures)
- استدعاء Application Services (Domain/Provider Logic)
- عرض DTOs

**Renderer لا يمتلك ولا يصل إلى:**

| الممنوع | السبب |
|---------|-------|
| `require('fs')` | أمن — يستخدم `contextIsolation` |
| `process.env` | أمن — لا تسريب للمتغيرات |
| `child_process.spawn` | أمن — لا تحكم في النظام |
| `electron.remote` | أمن — remote module معطل |
| استدعاء PostgreSQL مباشر | لا Renderer يتحكم بقاعدة البيانات |
| كتابة ملفات | عبر IPC فقط — Main Process يُنفّذ |

---

## 6. IPC Architecture

### 6.1 Preload Bridge

```typescript
// preload.ts — الجسر الوحيد بين Renderer و Main
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // Backup
  backup: {
    create: (options: BackupOptions) => ipcRenderer.invoke('backup:create', options),
    list: () => ipcRenderer.invoke('backup:list'),
    restore: (id: string) => ipcRenderer.invoke('backup:restore', id),
    delete: (id: string) => ipcRenderer.invoke('backup:delete', id),
  },

  // Database
  database: {
    start: () => ipcRenderer.invoke('database:start'),
    stop: () => ipcRenderer.invoke('database:stop'),
    status: () => ipcRenderer.invoke('database:status'),
    query: (sql: string) => ipcRenderer.invoke('database:query', sql),
  },

  // Sync
  sync: {
    start: (config: SyncConfig) => ipcRenderer.invoke('sync:start', config),
    stop: () => ipcRenderer.invoke('sync:stop'),
    status: () => ipcRenderer.invoke('sync:status'),
  },

  // Updates
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onProgress: (cb: Function) => ipcRenderer.on('update:progress', cb),
  },

  // AI
  ai: {
    ask: (prompt: string) => ipcRenderer.invoke('ai:ask', prompt),
    status: () => ipcRenderer.invoke('ai:status'),
  },

  // Files
  files: {
    open: (path: string) => ipcRenderer.invoke('files:open', path),
    save: (options: SaveOptions) => ipcRenderer.invoke('files:save', options),
    pick: (options: PickOptions) => ipcRenderer.invoke('files:pick', options),
  },

  // Print
  print: {
    pdf: (data: PrintData) => ipcRenderer.invoke('print:pdf', data),
    direct: (data: PrintData) => ipcRenderer.invoke('print:direct', data),
  },

  // Diagnostics
  diagnostics: {
    run: () => ipcRenderer.invoke('diagnostics:run'),
    getLogs: () => ipcRenderer.invoke('diagnostics:getLogs'),
  },

  // Plugin
  plugin: {
    list: () => ipcRenderer.invoke('plugin:list'),
    load: (name: string) => ipcRenderer.invoke('plugin:load', name),
    unload: (name: string) => ipcRenderer.invoke('plugin:unload', name),
  },

  // License
  license: {
    validate: () => ipcRenderer.invoke('license:validate'),
    activate: (key: string) => ipcRenderer.invoke('license:activate', key),
  },

  // Window
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
  }
})
```

### 6.2 نمط IPC

```
Renderer (React)                    Main Process (Node.js)
─────────────────                   ─────────────────────
window.api.backup.create()  ──────► ipcMain.handle('backup:create')
                                  │
                                  ├── spawn pg_dump
                                  ├── compress archive
                                  └── return { id, path, size }
                                  │
window.api.backup.create()  ◄────── return result
```

**القاعدة:** كل IPC Channel يبدأ بـ `{service}:{action}` — `backup:create`, `database:start`, `sync:status`.

### 6.3 قواعد IPC

| القاعدة | التفصيل |
|---------|---------|
| **IPC-01** | كل اتصال Renderer → Main يمر عبر `ipcRenderer.invoke` (Request-Response) |
| **IPC-02** | Main → Renderer يمر عبر `webContents.send` (Push Events) |
| **IPC-03** | كل Channel يُعرّف في `preload.ts` — لا Channels ديناميكية |
| **IPC-04** | Renderer لا يستقبل `ipcRenderer` مباشر — فقط عبر `window.api.*` |
| **IPC-05** | Main Process يتحقق من صحة كل طلب (Validation + Authorization) |

---

## 7. الأمان (Security)

### 7.1 إعدادات BrowserWindow

```typescript
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,    // ✅ عزل Context
    sandbox: true,             // ✅ Sandbox
    nodeIntegration: false,    // ✅ لا Node.js في Renderer
    preload: path.join(__dirname, 'preload.ts'),  // ✅ فقط preload
  }
})
```

### 7.2 قواعد أمنية

| القاعدة | التفصيل |
|---------|---------|
| **SEC-01** | `contextIsolation: true` — لا يمكن Renderer الوصول لـ Node.js |
| **SEC-02** | `sandbox: true` — Renderer في Sandbox |
| **SEC-03** | `nodeIntegration: false` — لا `require()` في Renderer |
| **SEC-04** | `preload.ts` هو الجسر الوحيد — ويُحدد بدقة ما يُكشف |
| **SEC-05** | كل IPC Handler يتحقق من صحة المدخلات (Input Validation) |
| **SEC-06** | لا Channels تسمح بتنفيذ أوامر عشوائية (No `eval`, No `exec`) |

---

## 8. Desktop Services Layer

### 8.1 الهيكل المقترح داخل المشروع

```
desktop/
├── main/
│   ├── main.ts                    ← نقطة دخول Electron Main Process
│   ├── preload.ts                 ← IPC Bridge
│   ├── window/
│   │   └── WindowManager.ts       ← إدارة النوافذ
│   ├── services/
│   │   ├── BackupService.ts       ← النسخ الاحتياطي
│   │   ├── RestoreService.ts      ← الاستعادة
│   │   ├── DatabaseService.ts     ← إدارة PostgreSQL المحلي
│   │   ├── SyncService.ts         ← مزامنة البيانات
│   │   ├── UpdateService.ts       ← التحديث التلقائي
│   │   ├── AIService.ts           ← الذكاء الاصطناعي المحلي
│   │   ├── PrintService.ts        ← الطباعة
│   │   ├── FileService.ts         ← إدارة الملفات
│   │   ├── PluginService.ts       ← تحميل الإضافات
│   │   ├── LicenseService.ts      ← إدارة الترخيص
│   │   └── DiagnosticsService.ts  ← تشخيص النظام
│   ├── ipc/
│   │   ├── router.ts              ← توجيه الـ IPC Channels
│   │   └── handlers/              ← معالجات منفصلة لكل خدمة
│   │       ├── backupHandlers.ts
│   │       ├── syncHandlers.ts
│   │       └── ...
│   └── utils/
│       ├── logger.ts
│       └── platform.ts
├── assets/                        ← أيقونات، مثبّت، موارد
├── build/                         ← إعدادات build (electron-builder)
├── package.json
└── electron-builder.yml
```

### 8.2 ملاحظة: `desktop/` خارج `src/`

| الموقع | المحتوى |
|--------|---------|
| `src/presentation/desktop/` | **React** — Pages, Components, Layouts الخاصة بالديسكتوب |
| `desktop/` | **Electron** — Main Process, IPC, Services — **خارج src/** تماماً |

**السبب:** Electron Main Process هو تطبيق Node.js مستقل — لا يشارك build pipeline مع React.

---

## 9. العلاقة مع Provider Layer

### 9.1 المبدأ

```
Electron Main Process ←── IPC ──→ Renderer (React)
                                        │
                                        ▼
                               Application Services
                                        │
                                        ▼
                               Provider Contracts
                                        │
                                        ▼
                               SupabaseProvider  /  DesktopProvider
                                    (Remote)         (Local PostgreSQL)
```

- `SupabaseProvider` — مستخدم في PWA **و** Desktop عند الاتصال
- `DesktopProvider` — جديد — يستخدم Local PostgreSQL عبر IPC
- كلاهما ينفذ نفس `I{Capability}Provider` Interfaces

### 9.2 DesktopProvider

```typescript
// providers/implementations/desktop/DesktopOrderProvider.ts
class DesktopOrderProvider implements ISalesOrderProvider {
  constructor(private ipcApi: DesktopIPCAPI) {}

  async getById(id: string): Promise<Order> {
    // يمر الطلب عبر IPC إلى Main Process
    // Main Process ينفذ الاستعلام على Local PostgreSQL
    return this.ipcApi.database.query('SELECT * FROM orders WHERE id = $1', [id])
  }
  // ...
}
```

### 9.3 تبديل الـ Provider في Desktop

```typescript
// desktop/main.ts — عند بدء التطبيق
import { DesktopProviderFactory } from './providers/DesktopProviderFactory'

const registry = new ProviderRegistry()

if (isOnline) {
  registry.register('salesOrder', new SupabaseSalesOrderProvider(client))
  registry.register('sync', new SupabaseSyncProvider(client))
} else {
  registry.register('salesOrder', new DesktopOrderProvider(ipcApi))
  // المزامنة تتم لاحقاً عبر SyncService في Main Process
}
```

---

## 10. التحديث التلقائي (Auto Update)

### 10.1 الاستراتيجية

| المكون | الوصف |
|--------|-------|
| **الناشر** | electron-builder + electron-updater |
| **مصدر التحديثات** | GitHub Releases / S3 / خادم خاص |
| **التكرار** | التحقق عند بدء التشغيل + كل 6 ساعات |
| **آلية التثبيت** | Silent download → إشعار → Install on quit / Restart now |
| **التحديث الإجباري** | ممكن للإصدارات الحرجة |
| **Rollback** | نسخة احتياطية من الإصدار السابق |

---

## 11. الخدمات الخلفية (Background Services)

| الخدمة | متى تعمل | متطلبات |
|--------|----------|---------|
| **PostgreSQL Manager** | عند بدء التطبيق — إيقاف عند الإغلاق | PostgreSQL portable مضمن |
| **Sync Engine** | عند الطلب أو مجدول (كل N دقيقة) | اتصال إنترنت |
| **Backup Engine** | مجدول (يومي/أسبوعي/يدوي) | مساحة تخزين كافية |
| **AI Runtime** | عند الطلب فقط | ONNX Runtime / Python |
| **Auto Update** | عند بدء التشغيل + دوري | اتصال إنترنت |

---

## 12. الخلاصة

| البند | القيمة |
|-------|--------|
| **Runtime** | Electron |
| **Presentation** | React (Chromium) |
| **IPC Bridge** | preload.ts مع contextBridge |
| **الأمان** | contextIsolation + sandbox + nodeIntegration=false |
| **Local Database** | PostgreSQL عبر Main Process |
| **محل Desktop Services** | `desktop/` (خارج src/) |
| **Desktop Providers** | `providers/implementations/desktop/` |
| **Auto Update** | electron-updater |
| **الخدمات الخلفية** | Main Process (Node.js) |
| **الحالة** | ✅ مجمّدة — جزء من Architecture v1.2 |
