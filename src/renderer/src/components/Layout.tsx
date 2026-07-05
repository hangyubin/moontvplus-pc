import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useStore } from '../lib/store'
import { useTheme } from '../lib/useTheme'

const navItems = [
  { path: '/', label: '首页', icon: '🏠' },
  { path: '/search', label: '搜索', icon: '🔍' },
  { path: '/live', label: '直播', icon: '📺' },
  { path: '/music', label: '音乐', icon: '🎵' },
  { path: '/history', label: '观看历史', icon: '🕒' },
  { path: '/favorites', label: '收藏', icon: '❤️' }
]

export default function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { serverConfig, auth, logout } = useStore()
  const { theme, toggleTheme } = useTheme()
  const [keyword, setKeyword] = useState('')

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (keyword.trim()) {
      navigate(`/search?q=${encodeURIComponent(keyword.trim())}`)
    }
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-[var(--color-app-bg)]">
      {/* 侧边栏 — 渐变背景 + 毛玻璃 */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-white/[0.06]" style={{ background: 'linear-gradient(to bottom, var(--color-sidebar-bg), var(--color-app-bg-deep))' }}>
        {/* Logo 区域 */}
        <div className="px-6 py-6">
          <h1 className="text-xl font-bold gradient-text">
            {serverConfig?.SiteName || 'MoonTVPlus'}
          </h1>
          <p className="text-xs text-gray-600 mt-1 tracking-wider">PC CLIENT</p>
        </div>

        {/* 导航 */}
        <nav className="flex-1 px-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all duration-200 ${
                  isActive
                    ? 'bg-gradient-to-r from-primary/25 to-primary/5 text-primary font-medium'
                    : 'text-gray-400 hover:bg-white/[0.06] hover:text-white'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* 主题切换按钮 */}
        <div className="px-3 pb-2">
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm text-gray-400 hover:bg-white/[0.06] hover:text-white transition-all duration-200"
          >
            <span className="text-base">
              {theme === 'dark' ? '☀️' : '🌙'}
            </span>
            <span>{theme === 'dark' ? '浅色模式' : '深色模式'}</span>
          </button>
        </div>

        {/* 用户区域 */}
        <div className="p-3 border-t border-white/[0.06]">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary/40 to-purple-500/30 flex items-center justify-center text-sm font-medium text-white">
              {auth?.username?.[0]?.toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{auth?.username || '未登录'}</p>
              <p className="text-xs text-gray-600">{auth?.role || ''}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full mt-1 px-4 py-2 text-xs text-gray-500 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/5"
          >
            退出登录
          </button>
        </div>
      </aside>

      {/* 主内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部搜索栏 — 毛玻璃 */}
        <header className="h-14 flex-shrink-0 glass border-b border-white/[0.06] flex items-center px-6 gap-4">
          <form onSubmit={handleSearch} className="flex-1 max-w-xl">
            <div className="relative group">
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索影视、剧集..."
                className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-2 pl-10 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-primary/50 focus:bg-white/[0.08] transition-all"
              />
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600 group-focus-within:text-primary transition-colors">
                🔍
              </span>
            </div>
          </form>
        </header>

        {/* 页面内容 */}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
