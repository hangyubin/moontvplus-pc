/**
 * 窗口控制按钮组件 (Windows 11 风格)
 *
 * 包含:最小化、最大化/还原、关闭
 * 悬浮态统一使用 CSS 变量（--color-hover-overlay 等），
 * 关闭按钮保留红色悬浮 (#e81123) 以符合系统习惯。
 */
import { useState, useEffect } from 'react'

export default function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    // 浏览器开发模式下 window.app 不存在,跳过初始化
    if (!(window as any).app) return
    window.app.window.isMaximized().then(setIsMaximized)
    const unsubscribe = window.app.window.onMaximizeChange(setIsMaximized)
    return unsubscribe
  }, [])

  // 浏览器开发模式下不渲染窗口控制按钮(浏览器自带)
  if (!(window as any).app) return null

  return (
    <div
      className="window-controls flex items-stretch flex-shrink-0 h-full"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        onClick={() => window.app.window.minimize()}
        className="w-10 flex items-center justify-center text-[var(--color-text-tertiary)] hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)] transition-colors duration-150"
        title="最小化"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><rect y="4.5" width="10" height="1" fill="currentColor" /></svg>
      </button>
      <button
        onClick={() => window.app.window.maximize()}
        className="w-10 flex items-center justify-center text-[var(--color-text-tertiary)] hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)] transition-colors duration-150"
        title={isMaximized ? '还原' : '最大化'}
      >
        {isMaximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1.5" y="0" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
            <rect x="0" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        onClick={() => window.app.window.close()}
        className="w-10 flex items-center justify-center text-[var(--color-text-tertiary)] hover:bg-[#e81123] hover:text-white transition-colors duration-150"
        title="关闭"
      >
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></svg>
      </button>
    </div>
  )
}
