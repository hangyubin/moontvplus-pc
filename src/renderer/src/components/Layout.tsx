/**
 * 主布局：侧边栏导航 + 顶部栏 + 内容区
 * 精致深色侧栏 + 毛玻璃顶栏 + Win10 窗口控制
 */
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useStore } from '../lib/store'
import { useTheme } from '../lib/useTheme'
import WindowControls from './WindowControls'
import Icon from './Icon'

/** TV Logo */
const TvLogo = ({ className }: { className?: string }) => (
  <svg
    className={className}
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="var(--color-primary)"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ filter: 'drop-shadow(0 0 4px var(--color-glow-primary))' }}
  >
    <path d="M8 3l4 3 4-3" />
    <rect x="2" y="7" width="20" height="14" />
    <rect x="4.5" y="9.5" width="15" height="9" />
    <path d="M8 21l-1.5 2M16 21l1.5 2" />
  </svg>
)

const navItems = [
  { path: '/', label: '首页', icon: 'home' },
  { path: '/search', label: '搜索', icon: 'search' },
  { path: '/live', label: '直播', icon: 'tv' },
  { path: '/music', label: '音乐', icon: 'music' },
  { path: '/history', label: '历史', icon: 'clock' },
  { path: '/favorites', label: '收藏', icon: 'heart-outline' },
  { path: '/settings', label: '设置', icon: 'settings' },
]

export default function Layout({ children }: { children: ReactNode }) {
  const { serverConfig } = useStore()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()

  // 当前激活项索引(用于滑动指示胶囊定位)
  const activeIndex = navItems.findIndex((item) =>
    item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)
  )

  /* ============ 滑动选中指示器 ============
   * 用实际 DOM 位置测量,避免依赖固定行高;路由切换时平滑滑动 */
  const navRef = useRef<HTMLElement>(null)
  const itemRefs = useRef<Array<HTMLElement | null>>([])
  const [indicator, setIndicator] = useState({ top: 0, height: 0, visible: false })

  useLayoutEffect(() => {
    const navEl = navRef.current
    const itemEl = activeIndex >= 0 ? itemRefs.current[activeIndex] : null
    if (!navEl || !itemEl) return
    setIndicator({ top: itemEl.offsetTop, height: itemEl.offsetHeight, visible: true })
  }, [activeIndex, location.pathname])

  // 窗口尺寸变化时重新测量(高 DPI/字号变化兜底)
  useLayoutEffect(() => {
    const onResize = () => {
      const itemEl = activeIndex >= 0 ? itemRefs.current[activeIndex] : null
      if (!itemEl) return
      setIndicator((prev) => ({ ...prev, top: itemEl.offsetTop, height: itemEl.offsetHeight }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [activeIndex])

  return (
    <div className="flex h-screen bg-[var(--color-app-bg)]">
      {/* 侧边栏 */}
      <aside
        className="w-[192px] flex-shrink-0 flex flex-col border-r border-[var(--color-border-subtle)] relative"
        style={{
          background: 'var(--color-sidebar-bg)',
        }}
      >
        {/* Logo 区 */}
        <div
          className="h-12 px-4 pt-2 pb-1 flex items-center gap-2 flex-shrink-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <TvLogo className="flex-shrink-0" />
          <div className="min-w-0 flex items-center gap-1.5 relative top-[2px]">
            <h1
              className="min-w-0 truncate text-base font-bold gradient-text leading-none"
              style={{ fontFamily: "'Segoe UI', 'Microsoft YaHei', sans-serif" }}
            >
              {serverConfig?.SiteName || 'MoonTVPlus'}
            </h1>
            <span
              className="flex-shrink-0 text-[8px] tracking-[0.1em] font-semibold leading-none border rounded-[3px] px-1 py-[3px]"
              style={{
                fontFamily: "'Segoe UI', sans-serif",
                color: 'var(--color-primary)',
                borderColor: 'color-mix(in srgb, var(--color-primary) 50%, transparent)',
                backgroundColor: 'color-mix(in srgb, var(--color-primary) 8%, transparent)'
              }}
            >
              PC
            </span>
          </div>
        </div>

        {/* 导航 */}
        <nav ref={navRef} className="flex-1 px-2 py-1 space-y-0.5 relative">
          {/* 滑动选中胶囊:路由切换时平滑移动 */}
          <span
            aria-hidden
            className="absolute rounded-md pointer-events-none"
            style={{
              left: 8,
              right: 8,
              top: indicator.top,
              height: indicator.height,
              opacity: indicator.visible ? 1 : 0,
              background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)',
              boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 26%, transparent)',
              transition:
                'top 0.34s cubic-bezier(0.34, 1.3, 0.5, 1), height 0.34s cubic-bezier(0.34, 1.3, 0.5, 1), opacity 0.2s ease',
            }}
          />
          {/* 左侧发光竖条:位于胶囊左边缘,随胶囊同步滑动 */}
          <span
            aria-hidden
            className="absolute w-[3px] rounded-full pointer-events-none"
            style={{
              left: 8,
              top: indicator.top + indicator.height * 0.2,
              height: indicator.height * 0.6,
              opacity: indicator.visible ? 1 : 0,
              background: 'var(--color-primary)',
              boxShadow: '0 0 8px var(--color-glow-primary), 0 0 3px var(--color-glow-primary)',
              transition:
                'top 0.34s cubic-bezier(0.34, 1.3, 0.5, 1), height 0.34s cubic-bezier(0.34, 1.3, 0.5, 1), opacity 0.2s ease',
            }}
          />
          {navItems.map((item, i) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              ref={(el) => { itemRefs.current[i] = el }}
              className="nav-item-enter nav-link relative flex items-center gap-3 px-3 py-2 text-[13px] transition-colors duration-200"
              style={{ animationDelay: `${60 + i * 45}ms` }}
            >
              {({ isActive }) => (
                <>
                  {/* 图标:选中时放大 + 弹跳一次,未选中 hover 轻微放大 */}
                  <span
                    className={`flex-shrink-0 flex items-center justify-center transition-transform duration-200 ${
                      isActive ? 'scale-110 nav-icon-pop' : 'hover:scale-110'
                    }`}
                  >
                    <Icon name={item.icon} size={18} strokeWidth={1.8} />
                  </span>
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* 底部:主题切换 */}
        <div className="px-2 pb-3 space-y-0.5">
          <button
            onClick={toggleTheme}
            className="nav-item-enter w-full flex items-center gap-3 px-3 py-2 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)] transition-all duration-150"
            style={{ animationDelay: `${60 + navItems.length * 45}ms` }}
          >
            <span className="flex-shrink-0 flex items-center justify-center transition-transform duration-500 hover:rotate-45">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} strokeWidth={1.8} />
            </span>
            <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
          </button>
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部栏 */}
        <header
          className="glass h-12 flex-shrink-0 border-b border-[var(--color-border-subtle)] flex items-stretch justify-between pl-4 pr-0 pt-1.5 pb-0.5"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="flex-1" />

          {/* 窗口控制按钮 */}
          <WindowControls />
        </header>

        {/* 页面内容 */}
        <main className="flex-1 overflow-y-auto bg-[var(--color-app-bg)]">{children}</main>
      </div>
    </div>
  )
}
