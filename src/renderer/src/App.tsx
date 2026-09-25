import { useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useStore } from './lib/store'
import Layout from './components/Layout'
import { Toaster } from './components/Toast'
import Home from './pages/Home'

// 路由级懒加载:首页外的页面按需加载,减小首屏 JS 体积、加快启动
const Search = lazy(() => import('./pages/Search'))
const Detail = lazy(() => import('./pages/Detail'))
const Play = lazy(() => import('./pages/Play'))
const Live = lazy(() => import('./pages/Live'))
const Music = lazy(() => import('./pages/Music'))
const History = lazy(() => import('./pages/History'))
const Favorites = lazy(() => import('./pages/Favorites'))
const Settings = lazy(() => import('./pages/Settings'))

const PageFallback = () => (
  <div className="flex items-center justify-center min-h-screen bg-[var(--color-bg-base)]">
    <div className="spinner spinner-lg" />
  </div>
)

export default function App() {
  const { init } = useStore()
  const location = useLocation()

  useEffect(() => {
    init()
  }, [init])

  // 播放页和直播页全屏,不走 Layout
  const isFullscreenPage =
    location.pathname === '/play' || location.pathname === '/live'

  if (isFullscreenPage) {
    return (
      <>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/play" element={<Play />} />
            <Route path="/live" element={<Live />} />
          </Routes>
        </Suspense>
        <Toaster />
      </>
    )
  }

  return (
    <>
      <Layout>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<Search />} />
            <Route path="/detail" element={<Detail />} />
            <Route path="/history" element={<History />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route path="/music" element={<Music />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/login" element={<Navigate to="/settings" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Layout>
      <Toaster />
    </>
  )
}
