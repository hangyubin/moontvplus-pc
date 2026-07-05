/**
 * 播放页(全屏,无侧边栏)
 * 使用 Artplayer + hls.js 播放 m3u8 流
 * 功能:进度恢复、进度上报、自由选集、换源
 * 路由参数:source, id, title, index(0 基集数,默认 0)
 */
import { useEffect, useRef, useState, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import Artplayer from 'artplayer'
import Hls from 'hls.js'
import { getDetail, resolvePlayUrl, searchStream } from '../lib/api'
import { processImageUrl } from '../lib/image'
import { getDetailWithCache, cacheSearchResults, findSourcesByTitle } from '../lib/searchCache'
import { useStore } from '../lib/store'
import { generateStorageKey, type PlayRecord, type SearchResult } from '../types'

/** 判断 URL 是否为 HLS(m3u8)流:含 .m3u8 扩展或为服务端代理地址 */
function isHlsStream(url: string): boolean {
  return /\.m3u8?(\?|$|#)/i.test(url) || url.includes('/proxy/vod/m3u8')
}

/** 侧边面板类型 */
type PanelType = 'none' | 'episodes' | 'sources' | 'detail'

export default function Play() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  // 路由参数(index 为 0 基,默认 0)
  const source = searchParams.get('source') || ''
  const id = searchParams.get('id') || ''
  const title = searchParams.get('title') || ''
  const index = Math.max(0, parseInt(searchParams.get('index') || '0', 10) || 0)

  const upsertPlayRecord = useStore((s) => s.upsertPlayRecord)
  const playRecords = useStore((s) => s.playRecords)

  // 播放器容器 ref 与实例 ref
  const containerRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<Artplayer | null>(null)

  const [detail, setDetail] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [noEpisode, setNoEpisode] = useState(false)

  // 侧边面板状态
  const [panel, setPanel] = useState<PanelType>('detail')

  // 开灯/关灯模式(关灯时背景变黑,聚焦播放器)
  const [lightsOff, setLightsOff] = useState(false)

  // 换源:可用源列表
  const [altSources, setAltSources] = useState<SearchResult[]>([])
  const [searchingSources, setSearchingSources] = useState(false)

  // 用 useRef 保存当前集数、detail、source、id、title,供 beforeunload 回调读取最新值
  const stateRef = useRef({ index, detail, source, id, title })
  stateRef.current = { index, detail, source, id, title }

  // 用 ref 保存 playRecords,避免进度上报更新 store 后触发播放器重建
  const playRecordsRef = useRef(playRecords)
  playRecordsRef.current = playRecords

  // 加载详情(获取 episodes 数组):优先使用缓存,缓存未命中时调用 API
  // 如果 detail API 返回空 episodes,自动通过标题搜索获取可用源
  useEffect(() => {
    let cancelled = false
    // 立即清空旧 detail,防止播放器 effect 用旧 detail + 新 source 创建错误播放器
    setDetail(null)
    setLoading(true)
    setError('')
    setNoEpisode(false)
    getDetailWithCache(source, id, getDetail)
      .then((res) => {
        if (cancelled) return
        // 如果 API 返回有 episodes,直接使用
        if (res && res.episodes && res.episodes.length > 0) {
          setDetail(res)
          setLoading(false)
          return
        }
        // API 返回空 episodes:通过标题搜索获取可用源
        if (!title) {
          // 无标题,无法搜索,直接返回空结果
          setDetail(res)
          setLoading(false)
          return
        }
        // 触发标题搜索,找到有 episodes 的源
        const onEvent = (e: { type: string; results?: SearchResult[] }) => {
          if (cancelled) return
          if (e.type === 'source_result' && e.results && e.results.length > 0) {
            const matched = e.results.filter((r) => r.title === title && r.episodes && r.episodes.length > 0)
            if (matched.length > 0) {
              cacheSearchResults(matched)
              // 优先选择当前 source 的结果,否则用第一个匹配结果
              const currentMatch = matched.find((r) => r.source === source) || matched[0]
              if (currentMatch && currentMatch.episodes && currentMatch.episodes.length > 0) {
                setDetail(currentMatch)
                setLoading(false)
              }
            }
          } else if (e.type === 'complete') {
            if (cancelled) return
            // 搜索完成后仍无结果,设置 noEpisode
            setDetail((prev) => {
              if (prev) return prev
              return res
            })
            setLoading(false)
          }
        }
        searchStream(title, onEvent, false)
      })
      .catch((e) => {
        if (cancelled) return
        setError((e as Error)?.message || '加载详情失败')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [source, id, title])

  // 加载可用换源列表:先从缓存查找,缓存不足时触发后台搜索
  useEffect(() => {
    if (!title) return
    // 1. 先从缓存查找
    const cached = findSourcesByTitle(title, source)
    setAltSources(cached)

    // 2. 如果缓存结果少于 3 个,触发后台搜索补充
    if (cached.length < 3) {
      setSearchingSources(true)
      const onEvent = (e: { type: string; results?: SearchResult[] }) => {
        if (e.type === 'source_result' && e.results && e.results.length > 0) {
          // 过滤标题完全匹配的结果并缓存
          const matched = e.results.filter((r) => r.title === title)
          if (matched.length > 0) {
            cacheSearchResults(matched)
            setAltSources(findSourcesByTitle(title, source))
          }
        } else if (e.type === 'complete') {
          setSearchingSources(false)
        }
      }
      const { cancel } = searchStream(title, onEvent, false)
      return () => {
        cancel()
        setSearchingSources(false) // 取消时复位,防止状态卡死
      }
    } else {
      setSearchingSources(false) // 缓存充足时复位
    }
  }, [title, source])

  // 组件卸载时强制销毁播放器(保险措施,防止后台音频)
  useEffect(() => {
    return () => {
      const art = artRef.current
      if (art && !art.isDestroy) {
        try {
          art.pause()
          const video = art.template?.$video
          if (video) {
            video.pause()
            video.removeAttribute('src')
            video.load()
          }
        } catch {}
        art.destroy(true)
      }
      artRef.current = null
    }
  }, [])

  // beforeunload:窗口关闭时保存进度(使用 ref 中的最新值)
  useEffect(() => {
    const handler = () => {
      const art = artRef.current
      const { index: idx, detail: d, source: s, id: i, title: t } = stateRef.current
      if (!art || !d) return
      if (art.currentTime < 1 || !art.duration) return
      const rec: PlayRecord = {
        title: d.title,
        source_name: d.source_name,
        cover: processImageUrl(d.poster),
        year: d.year,
        index: idx + 1,
        total_episodes: d.episodes?.length || 0,
        play_time: art.currentTime,
        total_time: art.duration,
        save_time: Date.now(),
        search_title: t
      }
      upsertPlayRecord(s, i, rec)
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [upsertPlayRecord])

  // 换源/换集时立即销毁旧播放器(不依赖 detail 加载完成)
  // 这个 effect 在 source/id/index 变化时同步执行,确保旧音频立即停止
  useEffect(() => {
    return () => {
      // cleanup 在下一次 source/id/index 变化时执行
      const art = artRef.current
      if (art && !art.isDestroy) {
        try {
          art.pause()
          const video = art.template?.$video
          if (video) {
            video.pause()
            video.removeAttribute('src')
            video.load()
          }
        } catch {}
        art.destroy(true)
        artRef.current = null
      }
    }
  }, [source, id, index])

  // 初始化播放器 / 切换集数时重建播放器
  useEffect(() => {
    if (!detail || !containerRef.current) return

    // 确保 detail 属于当前 source/id,防止换源时旧 detail 创建错误播放器
    // (setDetail(null) 是异步的,effect 在同一 commit 仍会用旧 detail 执行)
    // 但如果 detail 有 episodes 且 source/id 不匹配,可能是降级搜索获取的其他源结果,
    // 此时同步更新 URL 为实际源并继续播放
    if (detail.source !== source || detail.id !== id) {
      if (!detail.episodes || detail.episodes.length === 0) return
      // 降级搜索获取的其他源结果:更新 URL 为实际源
      const params = new URLSearchParams(searchParams)
      params.set('source', detail.source)
      params.set('id', detail.id)
      setSearchParams(params, { replace: true })
      return // 等 URL 更新后 effect 重新执行,此时 source/id 匹配
    }

    const episodes = detail.episodes || []
    if (episodes.length === 0) {
      setNoEpisode(true)
      return
    }
    setNoEpisode(false)

    // 确保 index 不越界
    const safeIndex = Math.max(0, Math.min(index, episodes.length - 1))
    // 如果 URL 中的 index 越界,同步修正 URL(防止从历史记录进入时集数不匹配)
    if (safeIndex !== index) {
      const params = new URLSearchParams(searchParams)
      params.set('index', String(safeIndex))
      setSearchParams(params, { replace: true })
      return // 等 URL 更新后 effect 重新执行
    }
    const curIndex = safeIndex
    const rawUrl = episodes[curIndex]
    if (!rawUrl) return
    const playUrl = resolvePlayUrl(rawUrl, source, detail.proxyMode)
    if (!playUrl) return

    // 销毁旧实例(切换集数时)
    if (artRef.current && !artRef.current.isDestroy) {
      try {
        artRef.current.pause()
      } catch {}
      artRef.current.destroy(true)
      artRef.current = null
    }

    const hls = isHlsStream(playUrl)
    const capturedIndex = curIndex
    let hlsInstance: Hls | null = null

    const saveProgress = () => {
      // 使用闭包内的 art 实例(而非 artRef.current),
      // cleanup 时 artRef.current 可能已被置 null
      if (!art || art.isDestroy) return
      if (art.currentTime < 1 || !art.duration) return
      const rec: PlayRecord = {
        title: detail.title,
        source_name: detail.source_name,
        cover: processImageUrl(detail.poster),
        year: detail.year,
        index: capturedIndex + 1,
        total_episodes: episodes.length,
        play_time: art.currentTime,
        total_time: art.duration,
        save_time: Date.now(),
        search_title: title
      }
      upsertPlayRecord(source, id, rec)
    }

    const art = new Artplayer({
      container: containerRef.current,
      url: playUrl,
      type: hls ? 'm3u8' : undefined,
      poster: processImageUrl(detail.poster) || '',
      autoplay: true,
      autoSize: false,
      screenshot: true,
      setting: true,
      playbackRate: true,
      aspectRatio: true,
      hotkey: true,
      pip: true,
      fullscreen: true,
      fullscreenWeb: true,
      miniProgressBar: false,
      mutex: true,
      backdrop: true,
      playsInline: true,
      theme: '#5b6eff',
      lang: 'zh-cn',
      customType: hls
        ? {
            m3u8: (video: HTMLVideoElement, url: string) => {
              if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url
              } else if (Hls.isSupported()) {
                hlsInstance = new Hls()
                hlsInstance.loadSource(url)
                hlsInstance.attachMedia(video)
              }
            }
          }
        : undefined
    })

    artRef.current = art

    // 进度恢复:从 playRecordsRef 实时读取,不捕获到闭包
    // (playRecords 可能在此 effect 运行时还未从服务端加载完成)
    // 查找策略:先用 source+id 精确查找,找不到则按标题查找(跨源恢复)
    const seekKey = generateStorageKey(source, id)
    let seeked = false
    const findRecord = (): PlayRecord | null => {
      // 1. 精确匹配 source+id
      const exact = playRecordsRef.current[seekKey]
      if (exact && exact.play_time > 0 && exact.index === capturedIndex + 1) return exact
      // 2. 按标题匹配(降级搜索换了源,旧记录的 key 不同)
      if (detail.title) {
        let best: PlayRecord | null = null
        let bestTime = 0
        for (const k in playRecordsRef.current) {
          const r = playRecordsRef.current[k]
          if (r.title === detail.title && r.play_time > 0 && r.index === capturedIndex + 1) {
            if (r.save_time > bestTime) {
              best = r
              bestTime = r.save_time
            }
          }
        }
        return best
      }
      return null
    }
    const trySeek = () => {
      if (seeked) return
      const rec = findRecord()
      if (!rec) return
      const dur = art.duration || 0
      if (dur > 0 && rec.play_time < dur - 5) {
        art.seek = rec.play_time
        seeked = true
      }
    }
    // 多个时机尝试 seek(不同视频源 duration 就绪时间不同)
    art.on('ready', trySeek)
    art.on('video:loadedmetadata', trySeek)
    art.on('video:canplay', trySeek)
    // 延迟重试:某些 HLS 流 duration 延迟就绪
    const seekTimers = [1, 2, 3, 5].map((s) => setTimeout(trySeek, s * 1000))

    art.on('pause', saveProgress)

    let lastSave = 0
    art.on('video:timeupdate', () => {
      const now = Date.now()
      if (now - lastSave >= 5000) {
        lastSave = now
        saveProgress()
      }
    })

    return () => {
      // 先保存进度(此时 art.currentTime 和 duration 仍有效)
      saveProgress()
      // 清除 seek 重试定时器
      seekTimers.forEach(clearTimeout)
      // 先暂停视频,防止后台继续播放音频
      if (artRef.current && !artRef.current.isDestroy) {
        try {
          artRef.current.pause()
        } catch {}
      }
      // 销毁 hls.js 实例(停止 ts 分片下载)
      if (hlsInstance) {
        hlsInstance.destroy()
        hlsInstance = null
      }
      // 完全销毁播放器(包括 DOM),防止后台音频
      if (art && !art.isDestroy) {
        try {
          // 清除 video src,确保音频停止
          const video = art.template?.$video
          if (video) {
            video.pause()
            video.removeAttribute('src')
            video.load()
          }
        } catch {}
        art.destroy(true)
      }
      artRef.current = null
    }
  // title 通过 stateRef 在 saveProgress 中读取,不作为重建依赖
  }, [detail, index, source, id, upsertPlayRecord])

  const episodes = detail?.episodes || []
  const total = episodes.length
  const curIdx = Math.min(index, Math.max(0, total - 1))
  const hasPrev = curIdx > 0
  const hasNext = curIdx < total - 1

  // 集标题
  const episodeTitle = (i: number) => detail?.episodes_titles?.[i] || `第${i + 1}集`

  // 切换集数:更新 URL index
  const switchEpisode = (delta: number) => {
    const next = curIdx + delta
    if (next < 0 || next >= total) return
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('index', String(next))
      return p
    })
  }

  // 直接跳转到指定集
  const jumpToEpisode = (ep: number) => {
    if (ep < 0 || ep >= total) return
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('index', String(ep))
      return p
    })
    setPanel('none')
  }

  // 换源:跳转到另一个源
  const switchSource = (newSource: string, newId: string) => {
    setSearchParams((prev) => {
      const p = new URLSearchParams(prev)
      p.set('source', newSource)
      p.set('id', newId)
      p.set('index', '0')
      return p
    })
    setPanel('none')
  }

  // 当前可用的换源列表(含当前源标记)
  const sourceList = useMemo(() => {
    const list = [...altSources]
    // 如果当前源不在列表中,添加当前源的缓存信息
    if (detail && !list.some((s) => s.source === source)) {
      list.unshift(detail)
    }
    return list
  }, [altSources, detail, source])

  return (
    <div className="flex flex-col h-screen bg-[var(--color-app-bg-deep)] text-white relative">
      {/* 关灯遮罩:覆盖整个页面(顶栏+侧边面板+背景),只留播放器 */}
      {lightsOff && (
        <div
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm transition-opacity duration-300"
          onClick={() => setLightsOff(false)}
        />
      )}
      {/* ============ 顶部栏 ============ */}
      <header className="h-16 flex-shrink-0 flex items-center justify-between px-6 border-b border-white/[0.06]" style={{ background: 'linear-gradient(to bottom, var(--color-app-bg-deep), transparent)' }}>
        {/* 左:返回 + 标题信息 */}
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-sm text-gray-300 hover:text-white transition-colors flex-shrink-0 group"
          >
            <span className="text-lg transition-transform group-hover:-translate-x-0.5">←</span>
            <span>返回</span>
          </button>
          {/* 分隔线 */}
          <div className="h-5 w-px bg-white/10 flex-shrink-0" />
          {/* 标题 */}
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate max-w-[280px]">{title}</div>
            <div className="text-xs text-gray-500 truncate">
              {detail?.source_name || source}
              {detail?.year && detail.year !== 'unknown' ? ` · ${detail.year}` : ''}
            </div>
          </div>
        </div>

        {/* 中:集数切换 */}
        {total > 0 && (
          <div className="flex items-center gap-1.5 bg-white/[0.04] rounded-xl px-2 py-1">
            <button
              onClick={() => switchEpisode(-1)}
              disabled={!hasPrev}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.06] hover:bg-primary/30 hover:text-primary disabled:opacity-20 disabled:cursor-not-allowed transition-all text-base"
              title="上一集"
            >
              ‹
            </button>
            <span className="text-sm text-gray-200 min-w-[140px] text-center">
              <span className="text-white font-medium">{episodeTitle(curIdx)}</span>
              <span className="text-gray-600 ml-2 text-xs">{curIdx + 1}/{total}</span>
            </span>
            <button
              onClick={() => switchEpisode(1)}
              disabled={!hasNext}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/[0.06] hover:bg-primary/30 hover:text-primary disabled:opacity-20 disabled:cursor-not-allowed transition-all text-base"
              title="下一集"
            >
              ›
            </button>
          </div>
        )}

        {/* 右:功能按钮 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* 开灯/关灯 */}
          <button
            onClick={() => setLightsOff(!lightsOff)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl transition-all ${
              lightsOff
                ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/20'
                : 'bg-white/[0.06] text-gray-300 hover:bg-white/[0.1] hover:text-white'
            }`}
            title={lightsOff ? '开灯' : '关灯'}
          >
            <span className="text-base">{lightsOff ? '💡' : '🌙'}</span>
            {lightsOff ? '开灯' : '关灯'}
          </button>
          {total > 0 && (
            <button
              onClick={() => setPanel(panel === 'episodes' ? 'none' : 'episodes')}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl transition-all ${
                panel === 'episodes'
                  ? 'bg-gradient-to-r from-primary to-purple-600 text-white shadow-lg shadow-primary/20'
                  : 'bg-white/[0.06] text-gray-300 hover:bg-white/[0.1] hover:text-white'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
              </svg>
              选集
            </button>
          )}
          <button
            onClick={() => setPanel(panel === 'sources' ? 'none' : 'sources')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl transition-all ${
              panel === 'sources'
                ? 'bg-gradient-to-r from-primary to-purple-600 text-white shadow-lg shadow-primary/20'
                : 'bg-white/[0.06] text-gray-300 hover:bg-white/[0.1] hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
            换源
            {sourceList.length > 1 && (
              <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full">{sourceList.length}</span>
            )}
          </button>
          <button
            onClick={() => setPanel(panel === 'detail' ? 'none' : 'detail')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl transition-all ${
              panel === 'detail'
                ? 'bg-gradient-to-r from-primary to-purple-600 text-white shadow-lg shadow-primary/20'
                : 'bg-white/[0.06] text-gray-300 hover:bg-white/[0.1] hover:text-white'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            详情
          </button>
        </div>
      </header>

      {/* ============ 主区域:播放器 + 侧边面板 ============ */}
      <div className="flex-1 flex min-h-0 relative">
        {/* 播放器区域(关灯时浮于遮罩之上 z-60) */}
        <div className={`flex-1 flex items-center justify-center min-h-0 relative ${lightsOff ? 'z-[60] shadow-[0_0_80px_rgba(0,0,0,0.9)] rounded-2xl overflow-hidden' : ''}`}>
          {/* 关灯时的浮动开灯按钮 */}
          {lightsOff && (
            <button
              onClick={() => setLightsOff(false)}
              className="absolute top-4 right-4 z-[70] flex items-center gap-1.5 px-4 py-2 text-sm rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/30 hover:opacity-90 transition-opacity"
              title="开灯"
            >
              <span className="text-base">💡</span>
              开灯
            </button>
          )}
          {loading ? (
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-14 h-14">
                <div className="absolute inset-0 border-2 border-white/10 rounded-full" />
                <div className="absolute inset-0 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
              <p className="text-gray-400 text-sm">正在加载视频...</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-5">
              <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
                <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                </svg>
              </div>
              <p className="text-gray-300 text-base">{error}</p>
              <button
                onClick={() => navigate(-1)}
                className="px-5 py-2 bg-white/[0.08] text-gray-200 rounded-xl hover:bg-white/[0.12] transition-all"
              >
                返回
              </button>
            </div>
          ) : noEpisode ? (
            <div className="flex flex-col items-center gap-5 max-w-md text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/10 flex items-center justify-center">
                <span className="text-4xl">🎬</span>
              </div>
              <div>
                <p className="text-gray-200 text-lg font-medium">该资源暂无播放地址</p>
                <p className="text-gray-500 text-sm mt-2 leading-relaxed">
                  详情数据已获取,但未解析到有效的视频流地址。<br />请尝试切换其他资源源。
                </p>
              </div>
              <div className="flex gap-3">
                {sourceList.length > 1 && (
                  <button
                    onClick={() => setPanel('sources')}
                    className="px-5 py-2.5 bg-gradient-to-r from-primary to-purple-600 text-white rounded-xl hover:opacity-90 transition-all shadow-lg shadow-primary/20"
                  >
                    换个源试试
                  </button>
                )}
                <button
                  onClick={() => navigate(-1)}
                  className="px-5 py-2.5 bg-white/[0.08] text-gray-200 rounded-xl hover:bg-white/[0.12] transition-all"
                >
                  返回详情
                </button>
              </div>
            </div>
          ) : (
            <div
              className="w-full max-w-6xl h-full bg-black rounded-2xl overflow-hidden shadow-2xl ring-1 ring-white/[0.06]"
              ref={containerRef}
            />
          )}
        </div>

        {/* ============ 侧边面板:选集 / 换源 ============ */}
        {panel !== 'none' && (
          <aside className="w-80 flex-shrink-0 border-l border-white/[0.08] overflow-hidden flex flex-col animate-slideInRight" style={{ background: 'linear-gradient(to bottom, var(--color-panel-bg), var(--color-app-bg-deep))' }}>
            {/* 面板标题 */}
            <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                {panel === 'episodes' ? (
                  <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                  </svg>
                ) : panel === 'sources' ? (
                  <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                )}
                <h3 className="text-sm font-semibold text-white">
                  {panel === 'episodes' ? '选集' : panel === 'sources' ? '换源' : '详情'}
                </h3>
                <span className="text-xs text-gray-600">
                  {panel === 'episodes'
                    ? `共 ${total} 集`
                    : panel === 'sources'
                      ? `${sourceList.length} 个源${searchingSources ? ' · 搜索中...' : ''}`
                      : '影视信息'}
                </span>
              </div>
              <button
                onClick={() => setPanel('none')}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-500 hover:text-white hover:bg-white/[0.08] transition-all"
              >
                ✕
              </button>
            </div>

            {/* 面板内容 */}
            <div className="flex-1 overflow-y-auto p-3">
              {/* 选集面板 */}
              {panel === 'episodes' && (
                <div className="grid grid-cols-3 gap-2">
                  {episodes.map((_, i) => {
                    const isCurrent = i === curIdx
                    const isWatched = playRecords[generateStorageKey(source, id)]?.index === i + 1
                    return (
                      <button
                        key={i}
                        onClick={() => jumpToEpisode(i)}
                        title={episodeTitle(i)}
                        className={`relative text-sm py-2.5 px-1 rounded-xl truncate transition-all duration-200 ${
                          isCurrent
                            ? 'bg-gradient-to-br from-primary to-purple-600 text-white font-medium shadow-lg shadow-primary/25'
                            : isWatched
                              ? 'bg-primary/15 text-primary hover:bg-primary/25'
                              : 'bg-white/[0.04] text-gray-300 hover:bg-white/[0.1] hover:text-white'
                        }`}
                      >
                        {episodeTitle(i)}
                        {isWatched && !isCurrent && (
                          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary" />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* 换源面板 */}
              {panel === 'sources' && (
                <div className="space-y-2">
                  {sourceList.length === 0 && !searchingSources && (
                    <div className="text-center py-12">
                      <p className="text-gray-600 text-sm">暂无可用源</p>
                    </div>
                  )}
                  {sourceList.map((s) => {
                    const isCurrent = s.source === source
                    const epCount = s.episodes?.length || 0
                    return (
                      <button
                        key={`${s.source}-${s.id}`}
                        onClick={() => !isCurrent && switchSource(s.source, s.id)}
                        disabled={isCurrent}
                        className={`w-full text-left p-3.5 rounded-xl transition-all duration-200 ${
                          isCurrent
                            ? 'bg-primary/15 border border-primary/30'
                            : 'bg-white/[0.04] hover:bg-white/[0.08] border border-transparent cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${isCurrent ? 'text-primary' : 'text-white'}`}>
                              {s.source_name || s.source}
                            </span>
                            {isCurrent && (
                              <span className="flex items-center gap-1 text-xs text-primary bg-primary/15 px-2 py-0.5 rounded-full">
                                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                                当前
                              </span>
                            )}
                          </div>
                          {!isCurrent && epCount > 0 && (
                            <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                            </svg>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5 text-xs">
                          <span className={`px-1.5 py-0.5 rounded ${
                            epCount > 0
                              ? 'bg-green-500/10 text-green-400'
                              : 'bg-red-500/10 text-red-400'
                          }`}>
                            {epCount > 0 ? `${epCount} 集` : '无地址'}
                          </span>
                          {s.vod_remarks && <span className="text-gray-600">{s.vod_remarks}</span>}
                          {s.year && s.year !== 'unknown' && <span className="text-gray-600">{s.year}</span>}
                        </div>
                      </button>
                    )
                  })}
                  {searchingSources && (
                    <div className="flex items-center justify-center gap-2 py-4 text-sm text-gray-500">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      正在搜索更多源...
                    </div>
                  )}
                </div>
              )}

              {/* 详情面板 */}
              {panel === 'detail' && detail && (
                <div className="space-y-4">
                  {/* 封面 + 标题 */}
                  <div className="flex gap-3">
                    <div className="w-24 h-36 rounded-lg overflow-hidden flex-shrink-0 bg-white/[0.04]">
                      {detail.poster ? (
                        <img
                          src={processImageUrl(detail.poster)}
                          alt={detail.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-700 text-xs">
                          无封面
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-white leading-snug mb-1.5 line-clamp-2">
                        {detail.title}
                      </h4>
                      {detail.year && detail.year !== 'unknown' && (
                        <p className="text-xs text-gray-500 mb-1">{detail.year}</p>
                      )}
                      {detail.source_name && (
                        <p className="text-xs text-gray-500 mb-2">来源: {detail.source_name}</p>
                      )}
                      {detail.vod_remarks && (
                        <span className="inline-block text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-md">
                          {detail.vod_remarks}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 标签信息 */}
                  {(detail.type_name || detail.class) && (
                    <div>
                      <p className="text-xs text-gray-600 mb-1.5">类型</p>
                      <div className="flex flex-wrap gap-1.5">
                        {detail.type_name && (
                          <span className="text-xs bg-white/[0.06] text-gray-300 px-2 py-1 rounded-md">
                            {detail.type_name}
                          </span>
                        )}
                        {detail.class && detail.class.split(',').filter(Boolean).map((c, i) => (
                          <span key={i} className="text-xs bg-white/[0.06] text-gray-300 px-2 py-1 rounded-md">
                            {c.trim()}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 集数信息 */}
                  {episodes.length > 0 && (
                    <div className="flex items-center justify-between p-3 bg-white/[0.04] rounded-lg">
                      <span className="text-xs text-gray-400">总集数</span>
                      <span className="text-sm text-white font-medium">{episodes.length} 集</span>
                    </div>
                  )}

                  {/* 简介 */}
                  {detail.desc && (
                    <div>
                      <p className="text-xs text-gray-600 mb-2">简介</p>
                      <p className="text-xs text-gray-400 leading-relaxed max-h-60 overflow-y-auto pr-1 selectable">
                        {detail.desc}
                      </p>
                    </div>
                  )}

                  {/* 无数据提示 */}
                  {!detail.desc && !detail.type_name && !detail.class && (
                    <div className="text-center py-8 text-gray-600 text-sm">
                      暂无详细信息
                    </div>
                  )}
                </div>
              )}

              {/* 详情面板 - detail 尚未加载 */}
              {panel === 'detail' && !detail && (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
