/// <reference types="vite/client" />

declare const __BUILD_ID__: string
declare const __COMMIT_HASH__: string

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_APP_NAME: string
  readonly VITE_APP_VERSION: string
  readonly VITE_WHATSAPP_NUMBER: string
  readonly VITE_WHATSAPP_NUMBER_2?: string
  readonly VITE_SALES_PHONE_1?: string
  readonly VITE_SALES_PHONE_2?: string
  readonly VITE_SUPPORT_PHONE?: string
  readonly VITE_FACEBOOK_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
