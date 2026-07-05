/**
 * 音乐播放页
 * - 顶部搜索栏(从 searchMusic 获取结果)+ 音乐源选择(kw/wy/tx 等,默认 kw)
 * - 左侧:搜索结果 / 榜单歌曲列表
 * - 右侧:歌词(按时间戳对齐,高亮当前行;无歌词显示"暂无歌词")
 * - 底部固定播放控制栏:播放/暂停、上一首/下一首、进度条(可拖动)、音量、歌曲信息
 * - 播放使用 HTML5 <audio> 元素(不需要 Artplayer)
 * - 自动下一首:播放结束后自动播放列表下一首
 */
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import {
  searchMusic,
  getMusicPlayUrl,
  getBoards,
  getBoardSongs,
  getMusicHistory,
  saveMusicHistory,
  type MusicSong,
  type MusicLyric
} from '../lib/music'
import { getBaseUrl, getToken } from '../lib/auth'
import SmartImage from '../components/SmartImage'

/** 可选音乐源 */
const SOURCES = [
  { id: 'kw', name: '酷我' },
  { id: 'wy', name: '网易云' },
  { id: 'tx', name: 'QQ音乐' },
  { id: 'kg', name: '酷狗' },
  { id: 'mg', name: '咪咕' }
]

/** 解析后的歌词行 */
interface LyricLine {
  time: number
  text: string
  translation?: string
}

/** 解析 LRC 歌词文本为按时间排序的行数组 */
function parseLyric(lrc: string): LyricLine[] {
  if (!lrc) return []
  const result: LyricLine[] = []
  const timeRegex = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
  for (const raw of lrc.split('\n')) {
    const matches = [...raw.matchAll(timeRegex)]
    const text = raw.replace(timeRegex, '').trim()
    if (matches.length === 0) continue
    for (const m of matches) {
      const min = parseInt(m[1], 10) || 0
      const sec = parseInt(m[2], 10) || 0
      const ms = parseInt(m[3] ? m[3].padEnd(3, '0') : '0', 10) || 0
      result.push({ time: min * 60 + sec + ms / 1000, text })
    }
  }
  result.sort((a, b) => a.time - b.time)
  return result
}

/** 格式化秒为 mm:ss */
function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '00:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function Music() {
  /* ============ 源 / 搜索 / 榜单状态 ============ */
  const [source, setSource] = useState('kw')
  const [keyword, setKeyword] = useState('')
  const [submittedKeyword, setSubmittedKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<MusicSong[]>([])
  const [searching, setSearching] = useState(false)

  const [boards, setBoards] = useState<Array<{ id: string; name: string; cover: string; source: string }>>([])
  const [currentBoardId, setCurrentBoardId] = useState('')
  const [boardSongs, setBoardSongs] = useState<MusicSong[]>([])
  const [loadingBoards, setLoadingBoards] = useState(true)

  /* ============ 播放历史 ============ */
  const [historySongs, setHistorySongs] = useState<MusicSong[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const historyRef = useRef<MusicSong[]>([])
  historyRef.current = historySongs

  /* ============ 播放器状态 ============ */
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playlist, setPlaylist] = useState<MusicSong[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [muted, setMuted] = useState(false)
  const [loadingUrl, setLoadingUrl] = useState(false)
  const [playError, setPlayError] = useState('')
  const [lyricData, setLyricData] = useState<MusicLyric | null>(null)

  /* ============ 进度条拖动 ============ */
  const progressBarRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  /* ============ 歌词设置 ============ */
  // 卡拉OK模式:当前行按播放进度逐字填充颜色
  const [karaokeMode, setKaraokeMode] = useState(true)
  // 歌词高亮颜色
  const [lyricColor, setLyricColor] = useState('#5b6eff')
  // 歌词字体大小
  const [lyricFontSize, setLyricFontSize] = useState(16)
  const lyricScrollRef = useRef<HTMLDivElement>(null)
  const activeLyricRef = useRef<HTMLDivElement>(null)

  // 用 ref 保存 playlist / currentIndex / volume / muted,
  // 避免 onEnded 等闭包捕获过期状态
  const playlistRef = useRef(playlist)
  playlistRef.current = playlist
  const currentIndexRef = useRef(currentIndex)
  currentIndexRef.current = currentIndex
  const volumeRef = useRef(volume)
  volumeRef.current = volume
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  /* ============ 加载榜单 ============ */
  const loadBoards = useCallback(async (src: string) => {
    setLoadingBoards(true)
    try {
      const list = await getBoards(src)
      setBoards(list)
      if (list.length > 0) {
        setCurrentBoardId(list[0].id)
        const res = await getBoardSongs(src, list[0].id)
        setBoardSongs(res.list || [])
      } else {
        setCurrentBoardId('')
        setBoardSongs([])
      }
    } catch {
      setBoards([])
      setBoardSongs([])
    } finally {
      setLoadingBoards(false)
    }
  }, [])

  useEffect(() => {
    loadBoards(source)
  }, [source, loadBoards])

  /* ============ 加载播放历史 ============ */
  const loadHistory = useCallback(async () => {
    try {
      const list = await getMusicHistory()
      setHistorySongs(list || [])
    } catch {
      // 忽略错误
    }
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  /* ============ 切换榜单 ============ */
  const handleBoardChange = useCallback(
    async (boardId: string) => {
      if (boardId === currentBoardId) return
      setCurrentBoardId(boardId)
      setLoadingBoards(true)
      try {
        const res = await getBoardSongs(source, boardId)
        setBoardSongs(res.list || [])
      } catch {
        setBoardSongs([])
      } finally {
        setLoadingBoards(false)
      }
    },
    [source, currentBoardId]
  )

  /* ============ 切换音乐源 ============ */
  const handleSourceChange = (id: string) => {
    if (id === source) return
    setSource(id)
    // 切源后回到榜单模式,清空搜索
    setKeyword('')
    setSubmittedKeyword('')
    setSearchResults([])
  }

  /* ============ 搜索 ============ */
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = keyword.trim()
    if (!q) return
    setShowHistory(false)
    setSubmittedKeyword(q)
    setSearching(true)
    try {
      const res = await searchMusic(q, source, 1, 50)
      setSearchResults(res.list || [])
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const clearSearch = () => {
    setKeyword('')
    setSubmittedKeyword('')
    setSearchResults([])
  }

  /* ============ 加载播放地址并播放 ============ */
  const loadAndPlay = useCallback(async (song: MusicSong) => {
    const audio = audioRef.current
    if (!audio) return
    setLoadingUrl(true)
    setPlayError('')
    setLyricData(null)
    setCurrentTime(0)
    setDuration(0)
    try {
      const { play, lyric } = await getMusicPlayUrl(song)
      if (!play?.url) {
        setPlayError('暂无播放地址')
        return
      }
      // play.url 可能是相对路径(/api/music/v2/stream?...)或直链(directUrl)
      // <audio> 元素不走 axios,不会自动加 baseURL,也不会携带认证 cookie
      // 优先使用 directUrl(上游音频直链)避免认证问题
      const baseUrl = getBaseUrl()
      const rawUrl = play.directUrl || play.url
      const fullUrl = rawUrl.startsWith('http')
        ? rawUrl
        : `${baseUrl}${rawUrl}`
      audio.src = fullUrl
      audio.volume = volumeRef.current
      audio.muted = mutedRef.current
      try {
        await audio.play()
      } catch {
        /* 自动播放策略可能拦截,忽略 */
      }
      setLyricData(lyric || null)
      // 保存播放历史到服务端
      try {
        await saveMusicHistory(song, 0, 1, play.quality || '320k')
        // 更新本地历史列表(去重,移到最前)
        setHistorySongs((prev) => {
          const filtered = prev.filter((s) => s.songId !== song.songId)
          return [song, ...filtered].slice(0, 100)
        })
      } catch {
        // 忽略历史保存失败
      }
    } catch {
      setPlayError('播放地址获取失败')
    } finally {
      setLoadingUrl(false)
    }
  }, [])

  /* ============ 点击歌曲播放 ============ */
  const handlePlaySong = (song: MusicSong, index: number, list: MusicSong[]) => {
    setPlaylist(list)
    setCurrentIndex(index)
    currentIndexRef.current = index
    loadAndPlay(song)
  }

  /* ============ 播放控制 ============ */
  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio || !audio.src) return
    if (audio.paused) {
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }

  const playPrev = () => {
    const list = playlistRef.current
    if (list.length === 0) return
    const prev = (currentIndexRef.current - 1 + list.length) % list.length
    setCurrentIndex(prev)
    currentIndexRef.current = prev
    loadAndPlay(list[prev])
  }

  const playNext = () => {
    const list = playlistRef.current
    if (list.length === 0) return
    const next = (currentIndexRef.current + 1) % list.length
    setCurrentIndex(next)
    currentIndexRef.current = next
    loadAndPlay(list[next])
  }

  /* ============ audio 事件 ============ */
  const onLoadedMetadata = () => {
    if (audioRef.current) setDuration(audioRef.current.duration || 0)
  }
  const onTimeUpdate = () => {
    if (isDragging) return
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime)
  }
  const onEnded = () => playNext()
  const onPlay = () => setIsPlaying(true)
  const onPause = () => setIsPlaying(false)
  const onError = () => {
    setPlayError('播放失败,请尝试其他歌曲或源')
    setIsPlaying(false)
  }

  /* ============ 音量 ============ */
  const handleVolumeChange = (v: number) => {
    setVolume(v)
    setMuted(v === 0)
    if (audioRef.current) {
      audioRef.current.volume = v
      audioRef.current.muted = false
    }
  }
  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    if (audioRef.current) audioRef.current.muted = next
  }

  /* ============ 进度条拖动 ============ */
  const seekToClientX = (clientX: number) => {
    const bar = progressBarRef.current
    const audio = audioRef.current
    if (!bar || !audio || !duration) return
    const rect = bar.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const newTime = ratio * duration
    audio.currentTime = newTime
    setCurrentTime(newTime)
  }

  const onProgressMouseDown = (e: React.MouseEvent) => {
    if (!duration) return
    setIsDragging(true)
    seekToClientX(e.clientX)
  }

  // 全局拖动监听(拖动期间持续 seek)
  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => seekToClientX(e.clientX)
    const onUp = () => setIsDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, duration])

  /* ============ 歌词解析(合并翻译) ============ */
  const lyricLines = useMemo<LyricLine[]>(() => {
    const main = parseLyric(lyricData?.lyric || '')
    if (!lyricData?.tlyric) return main
    const tMap = new Map<string, string>()
    for (const t of parseLyric(lyricData.tlyric)) {
      tMap.set(t.time.toFixed(2), t.text)
    }
    return main.map((line) => ({
      ...line,
      translation: tMap.get(line.time.toFixed(2)) || ''
    }))
  }, [lyricData])

  /** 当前歌词行索引(最后一个 time <= currentTime 的行) */
  const currentLyricIndex = useMemo(() => {
    if (lyricLines.length === 0) return -1
    let idx = -1
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].time <= currentTime) idx = i
      else break
    }
    return idx
  }, [lyricLines, currentTime])

  /** 卡拉OK进度:当前行已播放的百分比 (0~1) */
  const karaokeProgress = useMemo(() => {
    if (!karaokeMode || currentLyricIndex < 0) return 0
    const cur = lyricLines[currentLyricIndex]
    const next = lyricLines[currentLyricIndex + 1]
    const start = cur.time
    const end = next ? next.time : (duration || cur.time + 5)
    if (end <= start) return 1
    return Math.min(1, Math.max(0, (currentTime - start) / (end - start)))
  }, [karaokeMode, currentLyricIndex, lyricLines, currentTime, duration])

  // 歌词自动滚动:将当前行居中
  useEffect(() => {
    const container = lyricScrollRef.current
    const el = activeLyricRef.current
    if (!container || !el) return
    const containerRect = container.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const offset =
      elRect.top - containerRect.top - container.clientHeight / 2 + el.clientHeight / 2
    container.scrollTo({ top: container.scrollTop + offset, behavior: 'smooth' })
  }, [currentLyricIndex])

  /* ============ 派生值 ============ */
  const isSearchMode = submittedKeyword !== ''
  const displayList = showHistory ? historySongs : (isSearchMode ? searchResults : boardSongs)
  const currentSong = currentIndex >= 0 ? playlist[currentIndex] : undefined
  const progressRatio = duration > 0 ? currentTime / duration : 0

  /* ============ 渲染 ============ */
  return (
    <div className="relative h-full flex flex-col">
      {/* ============ 顶部:搜索栏 + 源选择 ============ */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-white/[0.06] flex items-center gap-4 flex-wrap">
        <form onSubmit={handleSearch} className="relative flex-1 min-w-[240px] max-w-xl">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索音乐、歌手..."
            className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-2 pl-10 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-primary/50 focus:bg-white/[0.08] transition-all"
          />
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600">🎵</span>
          {keyword && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center text-gray-500 hover:text-white rounded-full transition-colors"
            >
              ✕
            </button>
          )}
        </form>

        {/* 源选择 */}
        <div className="flex items-center gap-1 bg-white/[0.04] rounded-lg p-1">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              onClick={() => handleSourceChange(s.id)}
              className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                source === s.id ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {/* ============ 榜单/历史标签(非搜索模式) ============ */}
      {!isSearchMode && (
        <div className="flex-shrink-0 px-6 py-3 flex items-center gap-2 overflow-x-auto border-b border-white/[0.04]">
          {/* 播放历史 */}
          <button
            onClick={() => { setShowHistory(true); setCurrentBoardId('') }}
            className={`flex-shrink-0 px-3 py-1 text-xs rounded-full transition-colors flex items-center gap-1 ${
              showHistory
                ? 'bg-primary text-white'
                : 'bg-white/[0.06] text-gray-400 hover:text-white'
            }`}
          >
            <span>🕒</span> 播放历史
            {historySongs.length > 0 && (
              <span className={`text-[10px] ${showHistory ? 'text-white/70' : 'text-gray-600'}`}>{historySongs.length}</span>
            )}
          </button>
          {/* 分隔线 */}
          {boards.length > 0 && <div className="flex-shrink-0 h-4 w-px bg-white/10" />}
          {/* 榜单标签 */}
          {boards.map((b) => (
            <button
              key={b.id}
              onClick={() => { handleBoardChange(b.id); setShowHistory(false) }}
              className={`flex-shrink-0 px-3 py-1 text-xs rounded-full transition-colors ${
                !showHistory && currentBoardId === b.id
                  ? 'bg-primary text-white'
                  : 'bg-white/[0.06] text-gray-400 hover:text-white'
              }`}
            >
              {b.name}
            </button>
          ))}
        </div>
      )}

      {/* ============ 中间内容区 ============ */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧:歌曲列表 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 px-6 py-3 text-xs text-gray-500 border-b border-white/[0.04]">
            {isSearchMode
              ? `搜索 "${submittedKeyword}" 的结果(${searchResults.length})`
              : showHistory
                ? `播放历史(${historySongs.length})`
                : loadingBoards
                  ? '加载榜单中...'
                  : `共 ${boardSongs.length} 首`}
          </div>

          <div className="flex-1 overflow-y-auto">
            {(searching || loadingBoards) && displayList.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-500">
                <div className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="mt-3 text-sm">加载中...</p>
              </div>
            ) : displayList.length === 0 ? (
              <div className="px-6 py-20 text-center text-gray-500">
                <div className="text-5xl mb-4 opacity-30">🎵</div>
                <p>{isSearchMode ? '未找到相关音乐' : showHistory ? '暂无播放历史' : '暂无榜单数据'}</p>
              </div>
            ) : (
              <div className="px-3 py-2">
                {displayList.map((song, idx) => {
                  const isCurrent =
                    !!currentSong &&
                    currentSong.songId === song.songId &&
                    currentSong.source === song.source
                  return (
                    <div
                      key={`${song.source}-${song.songId}-${idx}`}
                      onClick={() => handlePlaySong(song, idx, displayList)}
                      className={`group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                        isCurrent ? 'bg-primary/15' : 'hover:bg-white/[0.05]'
                      }`}
                    >
                      {/* 序号 / 播放指示 */}
                      <div className="w-7 flex-shrink-0 text-center">
                        {isCurrent && isPlaying ? (
                          <span className="text-primary text-sm">♪</span>
                        ) : (
                          <span
                            className={`text-sm ${
                              isCurrent ? 'text-primary' : 'text-gray-600'
                            }`}
                          >
                            {idx + 1}
                          </span>
                        )}
                      </div>

                      {/* 封面 */}
                      <div className="w-11 h-11 rounded-md overflow-hidden flex-shrink-0 bg-white/[0.04]">
                        <SmartImage src={song.cover || song.pic} alt={song.name} className="w-full h-full" />
                      </div>

                      {/* 名称 / 歌手 */}
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm truncate ${
                            isCurrent ? 'text-primary' : 'text-white'
                          }`}
                        >
                          {song.name}
                        </p>
                        <p className="text-xs text-gray-500 truncate">{song.artist}</p>
                      </div>

                      {/* 专辑(大屏显示) */}
                      {song.album ? (
                        <p className="hidden lg:block text-xs text-gray-600 truncate max-w-[160px]">
                          {song.album}
                        </p>
                      ) : null}

                      {/* 时长 */}
                      <span className="text-xs text-gray-600 flex-shrink-0">
                        {song.durationText || (song.durationSec ? formatTime(song.durationSec) : (song.duration ? formatTime(song.duration) : '--:--'))}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* 右侧:歌词 */}
        <div className="w-80 flex-shrink-0 border-l border-white/[0.06] flex flex-col">
          {/* 歌词标题 + 设置 */}
          <div className="flex-shrink-0 px-5 py-3 flex items-center justify-between border-b border-white/[0.04]">
            <span className="text-xs text-gray-500">歌词</span>
            <div className="flex items-center gap-2">
              {/* 卡拉OK开关 */}
              <button
                onClick={() => setKaraokeMode(!karaokeMode)}
                className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                  karaokeMode ? 'bg-primary/20 text-primary' : 'bg-white/[0.06] text-gray-500'
                }`}
                title="卡拉OK模式"
              >
                KTV
              </button>
              {/* 颜色选择 */}
              {['#5b6eff', '#ff5b8a', '#00d4aa', '#ffa500', '#e040fb'].map((c) => (
                <button
                  key={c}
                  onClick={() => setLyricColor(c)}
                  className={`w-3 h-3 rounded-full transition-transform ${lyricColor === c ? 'scale-125 ring-1 ring-white/30' : ''}`}
                  style={{ backgroundColor: c }}
                  title={`高亮颜色 ${c}`}
                />
              ))}
              {/* 字体大小 */}
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setLyricFontSize(Math.max(12, lyricFontSize - 2))}
                  className="text-gray-500 hover:text-white text-xs w-4 h-4 flex items-center justify-center"
                  title="缩小字体"
                >A-</button>
                <button
                  onClick={() => setLyricFontSize(Math.min(24, lyricFontSize + 2))}
                  className="text-gray-500 hover:text-white text-xs w-4 h-4 flex items-center justify-center"
                  title="放大字体"
                >A+</button>
              </div>
            </div>
          </div>
          {/* 歌词内容 */}
          <div ref={lyricScrollRef} className="flex-1 overflow-y-auto px-5 py-4">
            {!currentSong ? (
              <p className="text-center text-gray-600 text-sm mt-10">播放歌曲以查看歌词</p>
            ) : lyricLines.length === 0 ? (
              <p className="text-center text-gray-600 text-sm mt-10">暂无歌词</p>
            ) : (
              <div className="space-y-3">
                {lyricLines.map((line, i) => {
                  const isActive = i === currentLyricIndex
                  // 距离当前行的距离,用于计算淡出透明度
                  const distance = Math.abs(i - currentLyricIndex)
                  const opacity = isActive ? 1 : Math.max(0.2, 1 - distance * 0.18)
                  return (
                    <div
                      key={i}
                      ref={isActive ? activeLyricRef : undefined}
                      className="transition-all duration-500 ease-out"
                      style={{
                        opacity,
                        transform: isActive ? 'scale(1)' : 'scale(0.95)',
                      }}
                    >
                      {/* 卡拉OK模式:底层灰色完整文字 + 顶层彩色按进度裁切 */}
                      {isActive && karaokeMode ? (
                        <div className="relative leading-relaxed font-medium" style={{ fontSize: `${lyricFontSize}px` }}>
                          {/* 底层:完整灰色文字(始终可见) */}
                          <span style={{ color: 'rgba(255,255,255,0.35)' }}>
                            {line.text || '...'}
                          </span>
                          {/* 顶层:彩色文字按进度宽度裁切(线性平滑过渡) */}
                          <span
                            className="absolute inset-0 overflow-hidden whitespace-nowrap"
                            style={{
                              width: `${karaokeProgress * 100}%`,
                              color: lyricColor,
                              transition: 'width 0.3s linear',
                            }}
                          >
                            {line.text || '...'}
                          </span>
                        </div>
                      ) : (
                        <p
                          className="leading-relaxed"
                          style={{
                            fontSize: `${isActive ? lyricFontSize : lyricFontSize - 2}px`,
                            color: isActive ? lyricColor : 'rgba(255,255,255,0.4)',
                            fontWeight: isActive ? 500 : 400,
                          }}
                        >
                          {line.text || '...'}
                        </p>
                      )}
                      {line.translation && (
                        <p
                          className="text-xs mt-1"
                          style={{ color: isActive ? `${lyricColor}b0` : 'rgba(255,255,255,0.3)' }}
                        >
                          {line.translation}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ============ 底部:播放控制栏(固定) ============ */}
      <div className="h-20 flex-shrink-0 glass border-t border-white/[0.06] flex items-center px-6 gap-6">
        {/* 歌曲信息 */}
        <div className="flex items-center gap-3 w-64 flex-shrink-0">
          <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-white/[0.04]">
            {currentSong ? (
              <SmartImage src={currentSong.cover || currentSong.pic} alt={currentSong.name} className="w-full h-full" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-700 text-xl">
                🎵
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white truncate">{currentSong?.name || '未播放'}</p>
            <p className="text-xs text-gray-500 truncate">{currentSong?.artist || '—'}</p>
          </div>
        </div>

        {/* 播放控制 + 进度 */}
        <div className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
          <div className="flex items-center gap-4">
            <button
              onClick={playPrev}
              disabled={playlist.length === 0}
              className="text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
              title="上一首"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
            </button>
            <button
              onClick={togglePlay}
              disabled={!currentSong}
              className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-30"
              title={isPlaying ? '暂停' : '播放'}
            >
              {loadingUrl ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : isPlaying ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <button
              onClick={playNext}
              disabled={playlist.length === 0}
              className="text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
              title="下一首"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z" />
              </svg>
            </button>
          </div>

          {/* 进度条 */}
          <div className="w-full flex items-center gap-2">
            <span className="text-xs text-gray-500 w-10 text-right tabular-nums">
              {formatTime(currentTime)}
            </span>
            <div
              ref={progressBarRef}
              onMouseDown={onProgressMouseDown}
              className="flex-1 h-1.5 bg-white/[0.1] rounded-full cursor-pointer relative group"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary to-purple-500"
                style={{ width: `${progressRatio * 100}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `${progressRatio * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 w-10 tabular-nums">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* 音量 */}
        <div className="flex items-center gap-2 w-40 flex-shrink-0">
          <button
            onClick={toggleMute}
            className="text-gray-400 hover:text-white transition-colors"
            title={muted || volume === 0 ? '取消静音' : '静音'}
          >
            {muted || volume === 0 ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.59 3l2.7-2.71-1.41-1.41L15.17 10.6 12.46 7.9l-1.41 1.41 2.7 2.71-2.7 2.71 1.41 1.41 2.71-2.7 2.71 2.7 1.41-1.41z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 00-2.5-4.03v8.06A4.5 4.5 0 0016.5 12z" />
              </svg>
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            className="flex-1 h-1.5 cursor-pointer"
            style={{ accentColor: '#5b6eff' }}
          />
        </div>
      </div>

      {/* ============ 错误提示 ============ */}
      {playError && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 bg-red-500/20 text-red-300 text-xs rounded-lg backdrop-blur-sm border border-red-500/30 animate-fadeIn">
          {playError}
        </div>
      )}

      <audio
        ref={audioRef}
        onLoadedMetadata={onLoadedMetadata}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        onPlay={onPlay}
        onPause={onPause}
        onError={onError}
      />
    </div>
  )
}
