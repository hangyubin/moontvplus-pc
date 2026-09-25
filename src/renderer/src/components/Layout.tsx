/**
 * 主布局：侧边栏导航 + 顶部栏 + 内容区
 * 精致深色侧栏 + 毛玻璃顶栏 + Win10 窗口控制
 */
import { type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
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

  return (
    <div className="flex h-screen bg-[var(--color-app-bg)]">
      {/* 侧边栏 */}
      <aside
        className="w-52 flex-shrink-0 flex flex-col border-r border-[var(--color-border-subtle)] relative"
        style={{
          background: 'var(--color-sidebar-bg)',
        }}
      >
        {/* Logo 区 */}
        <div
          className="h-10 px-4 flex items-center gap-2.5 flex-shrink-0"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <TvLogo className="flex-shrink-0" />
          <div className="min-w-0">
            <h1
              className="text-base font-bold gradient-text tracking-tight leading-none"
              style={{ fontFamily: "'Segoe UI', 'Microsoft YaHei', sans-serif" }}
            >
              {serverConfig?.SiteName || 'MoonTVPlus'}
            </h1>
            <p
              className="text-[9px] text-[var(--color-text-tertiary)] mt-1 tracking-[0.2em] font-medium"
              style={{ fontFamily: "'Segoe UI', sans-serif" }}
            >
              PC CLIENT
            </p>
          </div>
        </div>

        {/* 导航 */}
        <nav className="flex-1 px-2 py-1 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-3 py-2 text-[13px] transition-all duration-150 ${
                  isActive
                    ? 'text-primary font-semibold bg-primary/[0.06]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)] font-normal'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={item.icon} size={18} strokeWidth={1.8} className="flex-shrink-0" />
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
            className="w-full flex items-center gap-3 px-3 py-2 text-[13px] text-[var(--color-text-secondary)] hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)] transition-all duration-150"
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} strokeWidth={1.8} className="flex-shrink-0" />
            <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
          </button>
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部栏 */}
        <header
          className="glass h-10 flex-shrink-0 border-b border-[var(--color-border-subtle)] flex items-stretch justify-between pl-4 pr-0"
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
