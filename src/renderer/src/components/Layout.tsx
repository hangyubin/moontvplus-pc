/**
 * 主布局：侧边栏导航 + 顶部栏 + 内容区
 * 精致深色侧栏 + 毛玻璃顶栏 + Win10 窗口控制
 */
import { type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { useStore } from '../lib/store'
import { useTheme } from '../lib/useTheme'
import WindowControls from './WindowControls'

/** SVG 图标 */
const Icon = ({ name, className }: { name: string; className?: string }) => {
  const icons: Record<string, string> = {
    home: 'M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75',
    search: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z',
    live: 'M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z',
    music: 'M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z',
    history: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z',
    favorite: 'M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z',
    settings: 'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
    sun: 'M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z',
    moon: 'M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z',
  }
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d={icons[name]} />
    </svg>
  )
}

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
  { path: '/live', label: '直播', icon: 'live' },
  { path: '/music', label: '音乐', icon: 'music' },
  { path: '/history', label: '历史', icon: 'history' },
  { path: '/favorites', label: '收藏', icon: 'favorite' },
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
                  <Icon name={item.icon} className="w-[18px] h-[18px] flex-shrink-0" />
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
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} className="w-[18px] h-[18px] flex-shrink-0" />
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
