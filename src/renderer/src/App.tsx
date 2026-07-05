import { useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useStore } from './lib/store'
import Login from './pages/Login'
import Layout from './components/Layout'
import Home from './pages/Home'
import Search from './pages/Search'
import Detail from './pages/Detail'
import Play from './pages/Play'
import Live from './pages/Live'
import Music from './pages/Music'
import History from './pages/History'
import Favorites from './pages/Favorites'

export default function App() {
  const { isAuthed, init } = useStore()
  const location = useLocation()

  useEffect(() => {
    init()
  }, [init])

  // 播放页和直播页全屏,不走 Layout
  const isFullscreenPage =
    location.pathname.startsWith('/play') || location.pathname.startsWith('/live')

  if (!isAuthed) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  if (isFullscreenPage) {
    return (
      <Routes>
        <Route path="/play" element={<Play />} />
        <Route path="/live" element={<Live />} />
      </Routes>
    )
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<Search />} />
        <Route path="/detail" element={<Detail />} />
        <Route path="/history" element={<History />} />
        <Route path="/favorites" element={<Favorites />} />
        <Route path="/music" element={<Music />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
