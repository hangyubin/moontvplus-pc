/**
 * 直播页
 * - 左侧:单个侧边栏,直播源作为顶层分组(可折叠),每个源下是该源的频道(按 group 子分组)
 * - 右侧:播放器区域(Artplayer + hls.js)
 *
 * 换线路:同一频道有多个 URL 时,鼠标左右滑动或方向键 ← → 切换
 * 换台:方向键 ↑ ↓ 切换上一个/下一个频道(在当前源的频道列表范围内)
 * 记忆:localStorage 持久化上次播放的源、频道和 URL 索引
 */
import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Artplayer from 'artplayer'
import Hls from 'hls.js'
import {
  getLiveSources,
  getLiveChannels,
  type LiveSource,
  type LiveChannel
} from '../lib/live'
import { processImageUrl } from '../lib/image'
import SmartImage from '../components/SmartImage'

function isFlvStream(url: string): boolean {
  return /\.flv(\?|$|#)/i.test(url)
}

/** 频道(可能包含同一源下的多个播放地址) */
interface ChannelItem {
  name: string
  group: string
  tvgLogo?: string
  tvgId?: string
  urls: string[]
}

/** 一个直播源下的所有数据 */
interface SourceData {
  source: LiveSource
  channels: ChannelItem[]
  loaded: boolean
}

/** 直播记忆 */
const LIVE_MEMORY_KEY = 'live-memory'
interface LiveMemory {
  sourceKey: string
  channelName: string
  urlIndex: number
}
function loadLiveMemory(): LiveMemory | null {
  try {
    const v = localStorage.getItem(LIVE_MEMORY_KEY)
    if (!v) return null
    const p = JSON.parse(v)
    if (p && typeof p.sourceKey === 'string') return p
  } catch {}
  return null
}
function saveLiveMemory(m: LiveMemory) {
  try { localStorage.setItem(LIVE_MEMORY_KEY, JSON.stringify(m)) } catch {}
}

export default function Live() {
  const navigate = useNavigate()

  /* ============ 数据状态 ============ */
  const [sourceDataList, setSourceDataList] = useState<SourceData[]>([])
  const [currentSourceKey, setCurrentSourceKey] = useState('')
  const [currentChannel, setCurrentChannel] = useState<ChannelItem | null>(null)
  const [currentUrlIndex, setCurrentUrlIndex] = useState(0)

  /* ============ 加载 / 错误状态 ============ */
  const [loading, setLoading] = useState(true)
  const [playerLoading, setPlayerLoading] = useState(false)
  const [error, setError] = useState('')

  /* ============ 搜索 / 折叠 ============ */
  const [search, setSearch] = useState('')
  // 侧边栏 Tab:'sources' 直播源列表 | 'channels' 频道列表
  const [sidebarTab, setSidebarTab] = useState<'sources' | 'channels'>('channels')
  // 折叠的频道子分组(key = group)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /* ============ 播放器 ref ============ */
  const containerRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<Artplayer | null>(null)
  const hlsRef = useRef<Hls | null>(null)

  /* ============ ref 镜像 ============ */
  const currentChannelRef = useRef<ChannelItem | null>(null)
  const currentUrlIndexRef = useRef(0)
  const currentSourceKeyRef = useRef('')
  const sourceDataListRef = useRef<SourceData[]>([])
  currentChannelRef.current = currentChannel
  currentUrlIndexRef.current = currentUrlIndex
  currentSourceKeyRef.current = currentSourceKey
  sourceDataListRef.current = sourceDataList

  /* ============ 加载直播源列表 ============ */
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getLiveSources()
      .then((list) => {
        if (cancelled) return
        const dataList = list.map((source) => ({
          source,
          channels: [],
          loaded: false
        }))
        setSourceDataList(dataList)
        setLoading(false)

        // 记忆恢复:选中上次的直播源并加载其频道
        const memory = loadLiveMemory()
        const initialKey = memory
          ? (list.find((s) => s.key === memory.sourceKey)?.key || list[0]?.key || '')
          : (list[0]?.key || '')
        if (initialKey) {
          setCurrentSourceKey(initialKey)
          // 展开记忆中的源
          if (memory && memory.sourceKey === initialKey) {
            // 保持展开(默认展开)
          }
        }
      })
      .catch((e) => {
        if (cancelled) return
        setError((e as Error)?.message || '加载直播源失败')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  /* ============ 按需加载某个源的频道 ============ */
  const loadSourceChannels = useCallback(async (sourceKey: string) => {
    const idx = sourceDataListRef.current.findIndex((sd) => sd.source.key === sourceKey)
    if (idx === -1) return
    if (sourceDataListRef.current[idx].loaded) return

    try {
      const list = await getLiveChannels(sourceKey)
      const map = new Map<string, ChannelItem>()
      for (const ch of list) {
        const name = ch.name.trim()
        if (!name) continue
        if (map.has(name)) {
          map.get(name)!.urls.push(ch.url)
        } else {
          map.set(name, {
            name,
            group: ch.group || '未分组',
            tvgLogo: ch.tvgLogo,
            tvgId: ch.tvgId,
            urls: [ch.url]
          })
        }
      }
      const items = Array.from(map.values())
      setSourceDataList((prev) => {
        const next = [...prev]
        const i = next.findIndex((sd) => sd.source.key === sourceKey)
        if (i !== -1) {
          next[i] = { ...next[i], channels: items, loaded: true }
        }
        return next
      })

      // 记忆恢复:如果是记忆中的源,选中上次的频道
      const memory = loadLiveMemory()
      if (memory && memory.sourceKey === sourceKey) {
        const ch = items.find((c) => c.name === memory.channelName)
        if (ch) {
          const urlIdx = Math.max(0, Math.min(memory.urlIndex, ch.urls.length - 1))
          setCurrentSourceKey(sourceKey)
          setCurrentChannel(ch)
          setCurrentUrlIndex(urlIdx)
        }
      }
    } catch (e) {
      setError((e as Error)?.message || '加载频道失败')
    }
  }, [])

  // 初始加载第一个源的频道
  useEffect(() => {
    if (currentSourceKey && sourceDataList.length > 0) {
      const sd = sourceDataList.find((s) => s.source.key === currentSourceKey)
      if (sd && !sd.loaded) {
        loadSourceChannels(currentSourceKey)
      }
    }
  }, [currentSourceKey, sourceDataList, loadSourceChannels])

  /* ============ 销毁播放器 ============ */
  const destroyPlayer = useCallback(() => {
    if (hlsRef.current) { try { hlsRef.current.destroy() } catch {} ; hlsRef.current = null }
    if (artRef.current && !artRef.current.isDestroy) {
      try {
        artRef.current.pause()
        const video = artRef.current.template?.$video
        if (video) { video.pause(); video.removeAttribute('src'); video.load() }
      } catch {}
      artRef.current.destroy(true)
    }
    artRef.current = null
  }, [])

  useEffect(() => { return () => destroyPlayer() }, [destroyPlayer])

  /* ============ 创建播放器 ============ */
  const createPlayer = useCallback((url: string) => {
    if (!containerRef.current) return
    const isFlv = isFlvStream(url)
    const art = new Artplayer({
      container: containerRef.current,
      url,
      type: isFlv ? undefined : 'm3u8',
      autoplay: true,
      screenshot: true,
      hotkey: true,
      fullscreen: true,
      fullscreenWeb: true,
      playsInline: true,
      mutex: true,
      backdrop: true,
      theme: '#5b6eff',
      lang: 'zh-cn',
      customType: isFlv ? undefined : {
        m3u8: (video: HTMLVideoElement, src: string) => {
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = src
          } else if (Hls.isSupported()) {
            const hls = new Hls({
              liveDurationInfinity: true,
              lowLatencyMode: true,
              xhrSetup: (xhr) => { xhr.withCredentials = false },
            })
            hls.loadSource(src)
            hls.attachMedia(video)
            hlsRef.current = hls
            hls.on(Hls.Events.ERROR, (_e, data) => {
              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(); break
                  case Hls.ErrorTypes.MEDIA_ERROR: hls.recoverMediaError(); break
                  default: hls.destroy(); break
                }
              }
            })
          }
        }
      }
    })
    artRef.current = art
  }, [])

  /* ============ 选中频道/切换 URL 后自动播放 + 保存记忆 ============ */
  useEffect(() => {
    if (!currentChannel) return
    if (currentSourceKey) {
      saveLiveMemory({ sourceKey: currentSourceKey, channelName: currentChannel.name, urlIndex: currentUrlIndex })
    }
    const url = currentChannel.urls[currentUrlIndex]
    if (!url) { setError('该频道无播放地址'); return }
    setError('')
    setPlayerLoading(true)
    destroyPlayer()
    if (isFlvStream(url)) {
      setPlayerLoading(false)
      setError('FLV 格式暂不支持播放,请按 ← → 切换其他线路')
      return
    }
    createPlayer(url)
    setPlayerLoading(false)
    return () => destroyPlayer()
  }, [currentChannel, currentUrlIndex, currentSourceKey, destroyPlayer, createPlayer])

  /* ============ 换线路 ============ */
  const switchUrl = useCallback((dir: 1 | -1) => {
    const ch = currentChannelRef.current
    if (!ch || ch.urls.length <= 1) return
    const idx = currentUrlIndexRef.current
    setCurrentUrlIndex((idx + dir + ch.urls.length) % ch.urls.length)
  }, [])

  /* ============ 换台(在当前源的频道列表范围内) ============ */
  const switchChannel = useCallback((dir: 1 | -1) => {
    const sd = sourceDataListRef.current.find((s) => s.source.key === currentSourceKeyRef.current)
    if (!sd || sd.channels.length === 0) return
    const ch = currentChannelRef.current
    if (!ch) { setCurrentChannel(sd.channels[0]); setCurrentUrlIndex(0); return }
    const idx = sd.channels.findIndex((c) => c.name === ch.name)
    if (idx === -1) { setCurrentChannel(sd.channels[0]); setCurrentUrlIndex(0); return }
    setCurrentChannel(sd.channels[(idx + dir + sd.channels.length) % sd.channels.length])
    setCurrentUrlIndex(0)
  }, [])

  /* ============ 键盘方向键 ============ */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'ArrowLeft') { e.preventDefault(); switchUrl(-1) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); switchUrl(1) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); switchChannel(-1) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); switchChannel(1) }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [switchUrl, switchChannel])

  /* ============ 鼠标左右滑动换线路 ============ */
  const playerSectionRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = playerSectionRef.current
    if (!el) return
    let startX = 0, startY = 0, active = false
    const onStart = (e: PointerEvent) => { startX = e.clientX; startY = e.clientY; active = true }
    const onEnd = (e: PointerEvent) => {
      if (!active) return
      active = false
      const dx = e.clientX - startX, dy = e.clientY - startY
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) switchUrl(dx > 0 ? 1 : -1)
    }
    el.addEventListener('pointerdown', onStart)
    el.addEventListener('pointerup', onEnd)
    return () => { el.removeEventListener('pointerdown', onStart); el.removeEventListener('pointerup', onEnd) }
  }, [switchUrl])

  /* ============ 选择频道 ============ */
  const handleSelectChannel = (sourceKey: string, ch: ChannelItem) => {
    setCurrentSourceKey(sourceKey)
    if (currentChannel && ch.name === currentChannel.name && currentSourceKey === sourceKey) return
    setCurrentChannel(ch)
    setCurrentUrlIndex(0)
  }

  /* ============ 当前源信息 ============ */
  const currentSourceName = useMemo(() => {
    const sd = sourceDataList.find((s) => s.source.key === currentSourceKey)
    return sd?.source.name || ''
  }, [sourceDataList, currentSourceKey])

  const currentChannelName = currentChannel?.name || ''

  /* ============ 过滤后的直播源列表(带搜索) ============ */
  const filteredSources = useMemo(() => {
    if (!search.trim()) return sourceDataList
    const q = search.trim().toLowerCase()
    return sourceDataList.filter((sd) => sd.source.name.toLowerCase().includes(q))
  }, [sourceDataList, search])

  /* ============ 当前源的频道(带搜索) ============ */
  const currentSourceData = useMemo(() => {
    return sourceDataList.find((s) => s.source.key === currentSourceKey) || null
  }, [sourceDataList, currentSourceKey])

  const currentChannels = useMemo(() => {
    if (!currentSourceData || !currentSourceData.loaded) return []
    if (!search.trim()) return currentSourceData.channels
    const q = search.trim().toLowerCase()
    return currentSourceData.channels.filter((ch) => ch.name.toLowerCase().includes(q) || ch.group.toLowerCase().includes(q))
  }, [currentSourceData, search])

  // 当前源的频道按 group 分组
  const currentGroupedChannels = useMemo(() => {
    const groups: Record<string, ChannelItem[]> = {}
    currentChannels.forEach((ch) => {
      const g = ch.group || '未分组'
      if (!groups[g]) groups[g] = []
      groups[g].push(ch)
    })
    return groups
  }, [currentChannels])
  const currentGroupNames = useMemo(() => Object.keys(currentGroupedChannels), [currentGroupedChannels])

  return (
    <div className="flex flex-col h-full bg-[var(--color-app-bg)] text-white overflow-hidden">
      {/* ============ 顶部标题栏 ============ */}
      <header className="h-14 flex-shrink-0 flex items-center justify-between px-6 border-b border-white/[0.06] glass">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition-colors flex-shrink-0 group" title="返回首页">
            <span className="text-lg transition-transform group-hover:-translate-x-0.5">←</span>
            <span>返回</span>
          </button>
          <div className="h-5 w-px bg-white/10 flex-shrink-0" />
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/30 to-purple-500/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z" />
            </svg>
          </div>
          <h1 className="text-base font-semibold text-white flex-shrink-0">直播</h1>
          {currentSourceName && (
            <>
              <span className="text-gray-600">/</span>
              <span className="text-sm text-gray-400 truncate">{currentSourceName}</span>
            </>
          )}
          {currentChannel && (
            <>
              <span className="text-gray-600">/</span>
              <span className="text-sm text-gray-400 truncate">{currentChannel.name}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-gray-500 flex-shrink-0">
          {/* 线路切换指示器 */}
          {currentChannel && currentChannel.urls.length > 1 && (
            <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-white/[0.06]">
              <button onClick={() => switchUrl(-1)} className="text-gray-400 hover:text-primary transition-colors" title="上一线路">‹</button>
              <span className="text-gray-300">线路 {currentUrlIndex + 1}/{currentChannel.urls.length}</span>
              <button onClick={() => switchUrl(1)} className="text-gray-400 hover:text-primary transition-colors" title="下一线路">›</button>
            </div>
          )}
          {currentChannel && (
            <span className="flex items-center gap-1.5 text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />直播中
            </span>
          )}
        </div>
      </header>

      {/* ============ 主区域 ============ */}
      <div className="flex-1 flex min-h-0">
        {/* ============ 侧边栏:Tab 切换直播源/频道 ============ */}
        <section className="w-80 flex-shrink-0 border-r border-white/[0.06] flex flex-col" style={{ background: 'linear-gradient(to bottom, var(--color-panel-bg), var(--color-app-bg))' }}>
          {/* Tab 标签 */}
          <div className="flex border-b border-white/[0.06]">
            <button
              onClick={() => setSidebarTab('sources')}
              className={`flex-1 py-2.5 text-sm font-medium transition-all relative ${
                sidebarTab === 'sources'
                  ? 'text-primary'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              直播源
              {sidebarTab === 'sources' && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
              )}
            </button>
            <button
              onClick={() => setSidebarTab('channels')}
              className={`flex-1 py-2.5 text-sm font-medium transition-all relative ${
                sidebarTab === 'channels'
                  ? 'text-primary'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              频道
              {sidebarTab === 'channels' && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
              )}
            </button>
          </div>

          {/* 搜索框 */}
          <div className="p-3 border-b border-white/[0.06]">
            <div className="relative group">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={sidebarTab === 'sources' ? '搜索直播源...' : '搜索频道...'}
                className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-2 pl-9 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-primary/50 focus:bg-white/[0.08] transition-all"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600 group-focus-within:text-primary transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full text-gray-500 hover:text-white hover:bg-white/[0.1] transition-all">✕</button>
              )}
            </div>
          </div>

          {/* 内容区域 */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-500 text-sm">加载中...</p>
              </div>
            ) : sidebarTab === 'sources' ? (
              /* === 直播源列表 === */
              filteredSources.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
                  <p className="text-gray-500 text-sm">{search ? '未找到匹配直播源' : '暂无直播源'}</p>
                  {search && <button onClick={() => setSearch('')} className="text-xs text-primary hover:underline">清除搜索</button>}
                </div>
              ) : (
                <div className="p-2 space-y-0.5">
                  {filteredSources.map((sd) => {
                    const isCurrent = currentSourceKey === sd.source.key
                    return (
                      <button
                        key={sd.source.key}
                        onClick={() => {
                          setCurrentSourceKey(sd.source.key)
                          setSidebarTab('channels')
                        }}
                        className={`w-full text-left flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 ${
                          isCurrent ? 'bg-gradient-to-r from-primary/20 to-primary/5' : 'hover:bg-white/[0.06]'
                        }`}
                      >
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/20 to-purple-500/10 flex items-center justify-center flex-shrink-0">
                          <svg className={`w-5 h-5 ${isCurrent ? 'text-primary' : 'text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z" />
                          </svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm truncate ${isCurrent ? 'text-primary font-medium' : 'text-gray-300'}`}>{sd.source.name}</p>
                          <p className="text-xs text-gray-600 mt-0.5">
                            {sd.loaded ? `${sd.channels.length} 个频道` : '点击加载'}
                          </p>
                        </div>
                        {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />}
                      </button>
                    )
                  })}
                </div>
              )
            ) : (
              /* === 频道列表 === */
              !currentSourceKey ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
                  <p className="text-gray-500 text-sm">请先选择直播源</p>
                  <button onClick={() => setSidebarTab('sources')} className="text-xs text-primary hover:underline">选择直播源</button>
                </div>
              ) : !currentSourceData?.loaded ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : currentGroupNames.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
                  <p className="text-gray-500 text-sm">{search ? '未找到匹配频道' : '暂无频道'}</p>
                  {search && <button onClick={() => setSearch('')} className="text-xs text-primary hover:underline">清除搜索</button>}
                </div>
              ) : (
                <div className="pb-2">
                  {currentGroupNames.map((group) => {
                    const groupCollapsed = collapsedGroups.has(group)
                    return (
                      <div key={group} className="mb-0.5">
                        <button
                          onClick={() => toggleGroup(group)}
                          className="sticky top-0 z-10 w-full px-4 py-2 bg-[var(--color-panel-bg)]/95 backdrop-blur-sm flex items-center justify-between hover:bg-white/[0.04] transition-colors"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <svg className={`w-3 h-3 text-gray-500 flex-shrink-0 transition-transform ${groupCollapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                            </svg>
                            <span className="text-xs font-medium text-gray-400 tracking-wide truncate">{group}</span>
                          </div>
                          <span className="text-xs text-gray-600 flex-shrink-0 ml-2">{currentGroupedChannels[group].length}</span>
                        </button>
                        {!groupCollapsed && (
                          <div className="px-2 space-y-0.5">
                            {currentGroupedChannels[group].map((ch, idx) => {
                              const isCurrent = ch.name === currentChannelName
                              return (
                                <button
                                  key={`${group}-${idx}-${ch.name}`}
                                  onClick={() => handleSelectChannel(currentSourceKey, ch)}
                                  className={`w-full text-left flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg transition-all duration-200 group ${
                                    isCurrent ? 'bg-gradient-to-r from-primary/20 to-primary/5' : 'hover:bg-white/[0.06]'
                                  }`}
                                >
                                  <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 bg-white/[0.04]">
                                    {ch.tvgLogo ? (
                                      <SmartImage src={processImageUrl(ch.tvgLogo)} alt={ch.name} className="w-full h-full" />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs font-medium">{ch.name.slice(0, 1)}</div>
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-sm truncate ${isCurrent ? 'text-primary font-medium' : 'text-gray-300 group-hover:text-white'}`}>{ch.name}</p>
                                  </div>
                                  {ch.urls.length > 1 && <span className="text-xs text-gray-700 flex-shrink-0">{ch.urls.length}</span>}
                                  {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            )}
          </div>
        </section>

        {/* ============ 右侧:播放器 ============ */}
        <section ref={playerSectionRef} className="flex-1 flex items-center justify-center bg-black relative min-w-0">
          {currentChannel && currentChannel.urls.length > 1 && !error && !playerLoading && (
            <>
              <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20 pointer-events-none opacity-30">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white text-xl">‹</div>
              </div>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 z-20 pointer-events-none opacity-30">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white text-xl">›</div>
              </div>
            </>
          )}

          {error ? (
            <div className="flex flex-col items-center gap-5 px-8 text-center max-w-md relative z-10">
              <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <p className="text-gray-200 text-base font-medium">播放失败</p>
                <p className="text-gray-500 text-sm mt-2 leading-relaxed">{error}</p>
              </div>
              <div className="flex gap-3">
                {currentChannel && currentChannel.urls.length > 1 && (
                  <button onClick={() => switchUrl(1)} className="px-5 py-2.5 bg-gradient-to-r from-primary to-purple-600 text-white rounded-xl hover:opacity-90 transition-all text-sm shadow-lg shadow-primary/20">
                    切换下一线路
                  </button>
                )}
                <button
                  onClick={() => {
                    setError('')
                    const ch = currentChannel, idx = currentUrlIndex
                    setCurrentChannel(null)
                    setTimeout(() => { setCurrentChannel(ch); setCurrentUrlIndex(idx) }, 0)
                  }}
                  className="px-5 py-2.5 bg-white/[0.08] text-gray-200 rounded-xl hover:bg-white/[0.12] transition-all text-sm"
                >
                  重试
                </button>
              </div>
            </div>
          ) : !currentChannel ? (
            <div className="flex flex-col items-center gap-5 px-8 text-center relative z-10">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/10 flex items-center justify-center">
                <svg className="w-10 h-10 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z" />
                </svg>
              </div>
              <div>
                <p className="text-gray-200 text-lg font-medium">选择频道开始观看</p>
                <p className="text-gray-500 text-sm mt-2 leading-relaxed">← → 换线路 · ↑ ↓ 换台</p>
              </div>
            </div>
          ) : playerLoading ? (
            <div className="flex flex-col items-center gap-4 relative z-10">
              <div className="relative w-14 h-14">
                <div className="absolute inset-0 border-2 border-white/10 rounded-full" />
                <div className="absolute inset-0 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
              <p className="text-gray-400 text-sm">正在加载直播流...</p>
            </div>
          ) : (
            <div className="w-full h-full bg-black" ref={containerRef} />
          )}
        </section>
      </div>
    </div>
  )
}
