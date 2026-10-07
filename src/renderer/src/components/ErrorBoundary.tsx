/**
 * 渲染进程全局错误边界
 * 捕获子组件渲染期异常,显示兜底界面,避免整窗白屏;
 * 提供「重新加载」一键恢复。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] 页面崩溃:', error.message, info.componentStack)
  }

  private handleReload = (): void => {
    this.setState({ error: null })
    window.location.reload()
  }

  render(): ReactNode {
    const { error } = this.state
    if (error) {
      return (
        <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-[var(--color-bg-base)] px-6">
          <div className="text-lg font-medium text-[var(--color-text-primary)]">页面出现异常</div>
          <div className="max-w-[600px] text-xs text-[var(--color-text-tertiary)] break-all max-h-24 overflow-y-auto">
            {error.message}
          </div>
          <button
            onClick={this.handleReload}
            className="px-4 py-2 rounded bg-primary text-white text-sm hover:opacity-90 transition-opacity"
          >
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
