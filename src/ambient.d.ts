declare module 'zustand' {
  type SetState<T> = (partial: T | Partial<T> | ((state: T) => T | Partial<T>)) => void
  type GetState<T> = () => T
  type Subscribe<T> = (listener: (state: T) => void) => () => void
  type Destroy = () => void

  export function create<T>(initializer: (set: SetState<T>, get: GetState<T>, api: any) => T): {
    (): T
    <U>(selector: (state: T) => U): U
    getState: GetState<T>
    setState: SetState<T>
    subscribe: Subscribe<T>
    destroy: Destroy
  }
  export default create
}

declare module 'zustand/middleware' {
  export function persist<T>(config: (set: any, get: any, api: any) => T, options: { name: string }): (set: any, get: any, api: any) => T
}

declare module '@supabase/supabase-js' {
  export function createClient(supabaseUrl: string, supabaseAnonKey: string, options?: any): any
}

declare module 'react-hot-toast' {
  const toast: any
  export default toast
  export const Toaster: any
}
