import { Component, type ReactNode, type ErrorInfo } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (typeof window !== 'undefined' && (window as any).__healthMonitor) {
      ;(window as any).__healthMonitor.recordError(error.message, 'react')
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
          <div className="text-center max-w-md">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-danger/10 flex items-center justify-center">
              <span className="text-danger text-xl font-bold">!</span>
            </div>
            <h2 className="text-lg font-bold mb-2" style={{ color: '#1F2937' }}>عذراً، حدث خطأ غير متوقع</h2>
            <p className="text-sm mb-6" style={{ color: '#6B7280' }}>
              {this.state.error?.message || 'حدث خطأ أثناء تحميل هذه الصفحة'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
              }}
              className="px-6 py-2 rounded-lg text-white text-sm font-medium"
              style={{ background: '#0B3D91' }}
            >
              إعادة المحاولة
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
