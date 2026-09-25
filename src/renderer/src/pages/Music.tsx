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
 getMusicLyric,
 getMusicUrlFromHuibq,
 getMusicUrlFromServer,
 getBoards,
 getBoardSongs,
 getMusicHistory,
 saveMusicHistory,
 type MusicSong,
 type MusicLyric
} from '../lib/music'
import { formatTime } from '../lib/utils'
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

 /* ============ 频谱可视化(Web Audio API) ============ */
 const canvasRef = useRef<HTMLCanvasElement>(null)
 const audioCtxRef = useRef<AudioContext | null>(null)
 const analyserRef = useRef<AnalyserNode | null>(null)
 const sourceRef = useRef<MediaElementAudioSourceNode | null>(null)
 const rafRef = useRef<number | null>(null)
 const mountedRef = useRef(true)
 // 频谱颜色模式:'theme'(跟随主题) | 'rainbow'(彩虹渐变) | hex 色值
 const [spectrumColor, setSpectrumColor] = useState(() => {
  try { return localStorage.getItem('music_spectrumColor') || 'theme' } catch { return 'theme' }
 })
 const spectrumColorRef = useRef(spectrumColor)
 spectrumColorRef.current = spectrumColor

 /* ============ 进度条拖动 ============ */
 const progressBarRef = useRef<HTMLDivElement>(null)
 const [isDragging, setIsDragging] = useState(false)

 /* ============ 歌词设置 ============ */
 // 卡拉OK模式:当前行按播放进度逐字填充颜色
 const [karaokeMode, setKaraokeMode] = useState(true)
 // 歌词高亮颜色
 const [lyricColor, setLyricColor] = useState(() => {
  try { return localStorage.getItem('music_lyricColor') || 'var(--color-primary)' } catch { return 'var(--color-primary)' }
 })
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

 /** tryPlay 进行中标记:防止 React onError 在 tryPlay 期间触发冲突 */
 const tryPlayingRef = useRef(false)
 /** 播放请求 ID:快速切歌时取消旧的异步播放流程 */
 const playRequestIdRef = useRef(0)

 /* ============ 颜色偏好持久化(重启后保留) ============ */
 useEffect(() => {
  try { localStorage.setItem('music_spectrumColor', spectrumColor) } catch {}
 }, [spectrumColor])
 useEffect(() => {
  try { localStorage.setItem('music_lyricColor', lyricColor) } catch {}
 }, [lyricColor])

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

 /* ============ 频谱可视化:初始化 Web Audio API ============ */
 // 在首次播放时创建 AudioContext + AnalyserNode(浏览器限制需用户交互后才能创建)
 // 注意: createMediaElementSource 会接管音频输出,若音频源跨域且无 CORS 头则会被静音
 // 浏览器开发模式下音频 CDN 不支持 CORS,因此跳过可视化(音频正常通过 <audio> 播放)
 // Electron 模式下 webSecurity:false 绕过了 CORS,可视化正常工作
 const initVisualizer = useCallback(() => {
 if (audioCtxRef.current) return // 已初始化
 const audio = audioRef.current
 if (!audio) return
 // 浏览器开发模式:跳过 Web Audio API,避免跨域音频被静音
 if (!(window as any).app) {
   console.log('[Music] Browser mode: skipping Web Audio API visualizer (CORS)')
   return
 }
 try {
 const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
 const ctx = new AudioCtx()
 const analyser = ctx.createAnalyser()
 analyser.fftSize = 512 // 256 个频段(fftSize/2),对数映射下低频分辨率更细腻
 analyser.smoothingTimeConstant = 0.62
 const source = ctx.createMediaElementSource(audio)
 source.connect(analyser)
 analyser.connect(ctx.destination)
 audioCtxRef.current = ctx
 analyserRef.current = analyser
 sourceRef.current = source
 } catch {
 // 已连接过或其他错误,忽略
 }
 }, [])

 /* ============ 加载播放地址并播放(含自动换源) ============ */
 const loadAndPlay = useCallback(async (song: MusicSong) => {
 const audio = audioRef.current
 if (!audio) return
 // 生成请求 ID,用于快速切歌时取消旧的异步流程
 const requestId = ++playRequestIdRef.current
 // 初始化频谱可视化(首次播放时创建 AudioContext)
 initVisualizer()
 // 恢复 AudioContext(浏览器可能自动挂起),必须 await 否则音频不会出声
 if (audioCtxRef.current?.state === 'suspended') {
 console.log('[Music] Resuming AudioContext...')
 await audioCtxRef.current.resume()
 console.log('[Music] AudioContext state:', audioCtxRef.current.state)
 }

 // 尝试播放单个 URL,返回是否成功
 // 修复:等待 canplay/playing 事件确认播放,而非仅依赖 play() Promise
 // play() resolve 仅表示浏览器接受了播放请求,不代表音频能正常播放
 const tryPlay = (url: string, timeoutMs = 12000): Promise<boolean> => {
 return new Promise((resolve) => {
 console.log('[Music] tryPlay:', url.substring(0, 80))
 // 先清除旧 src,避免上一首的事件干扰
 audio.removeAttribute('src')
 audio.load()

 audio.src = url
 audio.volume = volumeRef.current
 audio.muted = mutedRef.current
 let settled = false
 let stallCheckTimer: ReturnType<typeof setTimeout> | null = null
 let timeoutTimer: ReturnType<typeof setTimeout> | null = null
 tryPlayingRef.current = true

 const finish = (result: boolean, reason: string) => {
 if (settled) return
 settled = true
 tryPlayingRef.current = false
 cleanup()
 console.log(`[Music] tryPlay result: ${result} (${reason})`)
 resolve(result)
 }

 const onCanPlay = () => finish(true, 'canplay event')
 const onPlaying = () => finish(true, 'playing event')
 const onError = (e: Event) => {
 const err = (e.target as HTMLAudioElement).error
 finish(false, `error event: ${err ? `code=${err.code}` : 'unknown'}`)
 }
 const onStalled = () => {
 console.warn('[Music] audio stalled, waiting 3s...')
 stallCheckTimer = setTimeout(() => {
 if (settled) return
 if (audio.readyState < 3) {
 finish(false, 'stalled timeout, readyState still low')
 }
 }, 3000)
 }

 const cleanup = () => {
 audio.removeEventListener('canplay', onCanPlay)
 audio.removeEventListener('playing', onPlaying)
 audio.removeEventListener('error', onError)
 audio.removeEventListener('stalled', onStalled)
 if (stallCheckTimer) clearTimeout(stallCheckTimer)
 if (timeoutTimer) clearTimeout(timeoutTimer)
 }

 audio.addEventListener('canplay', onCanPlay)
 audio.addEventListener('playing', onPlaying)
 audio.addEventListener('error', onError)
 audio.addEventListener('stalled', onStalled)

 audio.play().then(() => {
 console.log('[Music] play() resolved, readyState:', audio.readyState)
 // 如果 readyState 已经 >= 3(HAVE_FUTURE_DATA),可以直接判定成功
 // 否则等待 canplay/playing 事件确认
 if (!settled && audio.readyState >= 3) {
 finish(true, 'play() resolved with readyState >= 3')
 }
 }).catch((err) => {
 console.warn('[Music] play() rejected:', err)
 finish(false, `play() rejected: ${err?.message || err}`)
 })

 // 总超时:超时后检查音频是否实际在播放
 timeoutTimer = setTimeout(() => {
 if (settled) return
 // 如果音频实际在播放(非暂停且有时间进度),判定成功
 if (!audio.paused && audio.currentTime > 0) {
 finish(true, 'timeout but audio is playing')
 } else {
 finish(false, `timeout after ${timeoutMs}ms, readyState=${audio.readyState}`)
 }
 }, timeoutMs)
 })
 }

 // 尝试从指定歌曲获取 URL 并播放,返回是否成功
 // 策略:先尝试服务端 play API,失败再尝试 Huibq 公共 API
 const tryPlaySong = async (songToPlay: MusicSong): Promise<boolean> => {

  // 辅助函数:设置歌词(从服务端单独获取)
  const applyLyrics = async () => {
    try {
      const lyric = await getMusicLyric(songToPlay)
      if (lyric && (lyric.lyric || lyric.tlyric)) {
        setLyricData(lyric)
        return
      }
    } catch {
      // 歌词获取失败,忽略
    }
    setLyricData(null)
  }

  // 辅助函数:保存播放历史(异步,不阻塞播放流程)
  const saveHistory = () => {
    saveMusicHistory(songToPlay, 0, 1, '320k').catch(() => {})
    setHistorySongs((prev) => {
      const filtered = prev.filter((s) => s.songId !== songToPlay.songId)
      return [songToPlay, ...filtered].slice(0, 100)
    })
  }

  // 尝试获取可播放的 URL:服务端 API → Huibq API
  let audioUrl: string | null = null

  // 1. 服务端 play API(LX Music 音源,可能更稳定)
  console.log('[Music] Trying server play API:', songToPlay.name, 'source:', songToPlay.source)
  audioUrl = await getMusicUrlFromServer(songToPlay)

  // 2. 服务端失败,尝试 Huibq 公共 API
  if (!audioUrl) {
    console.log('[Music] Server API failed, trying Huibq:', songToPlay.name, 'source:', songToPlay.source)
    audioUrl = await getMusicUrlFromHuibq(songToPlay)
  }

  if (!audioUrl) {
    console.warn('[Music] No URL from any source for:', songToPlay.name)
    return false
  }

  // 3. 播放(12秒超时)
  const played = await tryPlay(audioUrl, 12000)
  console.log('[Music] Play result:', played)
  if (!played) return false

  // 4. 播放成功:并行获取歌词和保存历史
  applyLyrics()
  saveHistory()
  return true
 }

 setLoadingUrl(true)
 setPlayError('')
 setLyricData(null)
 setCurrentTime(0)
 setDuration(0)

 // 先尝试当前源
 if (await tryPlaySong(song)) {
 if (requestId !== playRequestIdRef.current) return // 已被新请求取代
 setLoadingUrl(false)
 return
 }

 // 当前源失败,自动尝试其他源
 // 已知可获取播放链接的源: kw(酷我), wy(网易云), tx(QQ音乐)
 // kg(酷狗)和mg(咪咕)的播放链接通常无法获取,但服务端 API 可能支持
 const FALLBACK_SOURCES = ['kw', 'wy', 'tx']
 const triedSources = new Set<string>([song.source])
 for (const srcId of FALLBACK_SOURCES) {
 if (triedSources.has(srcId)) continue
 if (requestId !== playRequestIdRef.current) return // 已被新请求取消
 triedSources.add(srcId)
 const srcName = SOURCES.find(s => s.id === srcId)?.name || srcId
 setPlayError(`当前源无法播放,正在尝试${srcName}源...`)
 try {
 const searchRes = await searchMusic(`${song.name} ${song.artist}`, srcId, 1, 10)
 if (requestId !== playRequestIdRef.current) return // 已被新请求取消
 if (searchRes.list && searchRes.list.length > 0) {
 // 优先匹配同名同歌手的结果,避免搜到不同歌曲
 // 歌手匹配规则:完全相同,或用 / 分割后至少有一位歌手相同(兼容多歌手)
 const normalizeArtist = (a: string) => a.trim()
 const sameArtist = (a: string, b: string) => {
 const na = normalizeArtist(a)
 const nb = normalizeArtist(b)
 if (na === nb) return true
 const partsA = na.split(/[\/、,，&和\s]+/).filter(Boolean)
 const partsB = nb.split(/[\/、,，&和\s]+/).filter(Boolean)
 if (partsA.length > 0 && partsA.some(p => partsB.includes(p))) return true
 return false
 }
 const exactMatch = searchRes.list.find(s =>
 s.name === song.name && sameArtist(s.artist || '', song.artist || '')
 )
 const newSong = exactMatch || searchRes.list[0]
 if (await tryPlaySong(newSong)) {
 if (requestId !== playRequestIdRef.current) return // 已被新请求取消
 // 换源成功:同步播放列表当前位置的歌曲,使底部播放栏/列表高亮显示换源后的真实歌曲
 setPlaylist((prev) => {
 const idx = currentIndexRef.current
 if (idx < 0 || idx >= prev.length) return prev
 const updated = [...prev]
 updated[idx] = newSong
 return updated
 })
 setPlayError('')
 setLoadingUrl(false)
 return
 }
 }
 } catch (err) {
 console.error(`[Music] Error switching to source ${srcId}:`, err)
 }
 }

 setPlayError('该歌曲暂时无法播放,已尝试所有可用音源')
 setLoadingUrl(false)
 }, [initVisualizer])

 /* ============ 点击歌曲播放 ============ */
 const handlePlaySong = (song: MusicSong, index: number, list: MusicSong[]) => {
 setPlaylist(list)
 setCurrentIndex(index)
 currentIndexRef.current = index
 loadAndPlay(song)
 }

 /* ============ 播放控制 ============ */
 const togglePlay = async () => {
 const audio = audioRef.current
 if (!audio || !audio.src) return
 // 初始化/恢复 AudioContext(用户交互后)
 initVisualizer()
 if (audioCtxRef.current?.state === 'suspended') {
   await audioCtxRef.current.resume()
 }
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
 // tryPlay 期间的错误由 tryPlay 内部处理,不在此重复触发
 if (tryPlayingRef.current) return
 setPlayError('播放失败,请尝试其他歌曲或源')
 setIsPlaying(false)
 }

 /* ============ 频谱可视化:Canvas 渲染循环(独立区域) ============ */
 useEffect(() => {
 const canvas = canvasRef.current
 if (!canvas) return

 const ctx = canvas.getContext('2d')
 if (!ctx) return

 mountedRef.current = true

 const bufferLength = analyserRef.current?.frequencyBinCount ?? 256
 const dataArray = new Uint8Array(bufferLength)
 const barCount = 24 // 柱数减少 → 柱宽自动加粗,画面更干净
 let phase = 0

 // 平滑值
 const smoothVals = new Array(barCount).fill(0)
 // 峰值帽:每根柱子的当前峰值与下落速度(重力加速回落)
 const peaks = new Array(barCount).fill(0)
 const peakVel = new Array(barCount).fill(0)

 // 频谱颜色:'theme' 从 CSS 变量读取, 'rainbow' 按柱位 HSL 渐变, 其他为 hex 色值
 let colorRGB = { r: 229, g: 9, b: 20 }
 let colorTick = 0
 // 单色模式下的位置渐变色:低频深沉偏暖、高频明亮偏冷,形成高低音视觉层次
 let barColors: Array<{ r: number; g: number; b: number }> = new Array(barCount).fill(0).map(() => colorRGB)
 // RGB↔HSL(单色模式按柱位做色相/亮度渐变,高低音区分更明显)
 const rgbToHsl = (r: number, g: number, b: number) => {
 const r1 = r / 255, g1 = g / 255, b1 = b / 255
 const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1)
 const l = (max + min) / 2
 let h = 0, s = 0
 if (max !== min) {
 const d = max - min
 s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
 if (max === r1) h = (g1 - b1) / d + (g1 < b1 ? 6 : 0)
 else if (max === g1) h = (b1 - r1) / d + 2
 else h = (r1 - g1) / d + 4
 h *= 60
 }
 return { h, s, l }
 }
 const hslToRgb = (h: number, s: number, l: number) => {
 const c = (1 - Math.abs(2 * l - 1)) * s
 const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
 const m2 = l - c / 2
 let r = 0, g = 0, b = 0
 if (h < 60) { r = c; g = x; b = 0 }
 else if (h < 120) { r = x; g = c; b = 0 }
 else if (h < 180) { r = 0; g = c; b = x }
 else if (h < 240) { r = 0; g = x; b = c }
 else if (h < 300) { r = x; g = 0; b = c }
 else { r = c; g = 0; b = x }
 return { r: Math.round((r + m2) * 255), g: Math.round((g + m2) * 255), b: Math.round((b + m2) * 255) }
 }
 const refreshColor = () => {
 const mode = spectrumColorRef.current
 if (mode === 'rainbow') return // 彩虹模式在绘制时按柱位计算
 if (mode === 'theme') {
 const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim()
 const m = /^#?([0-9a-fA-F]{6})$/.exec(raw)
 if (m) {
 const n = parseInt(m[1], 16)
 colorRGB = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
 }
 } else {
 const m = /^#?([0-9a-fA-F]{6})$/.exec(mode)
 if (m) {
 const n = parseInt(m[1], 16)
 colorRGB = { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
 }
 }
 // 基于更新后的 colorRGB 生成位置渐变 barColors:低频深沉偏暖、高频明亮偏冷
 const base = rgbToHsl(colorRGB.r, colorRGB.g, colorRGB.b)
 barColors = new Array(barCount).fill(0).map((_, i) => {
 const t = i / (barCount - 1) // 0(低频) → 1(高频)
 const hh = (base.h - 10 + t * 24 + 360) % 360 // 色相微移,低偏暖高偏冷
 const ll = Math.max(0.34, Math.min(0.70, base.l - 0.10 + t * 0.26)) // 低沉高亮
 const ss = Math.min(0.95, Math.max(0.5, base.s + 0.08))
 return hslToRgb(hh, ss, ll)
 })
 }
 refreshColor()

 // 彩虹模式:按柱位生成 HSL → RGB(低频红→中频绿→高频紫)
 const hueToRGB = (h: number) => {
 const s = 0.85, l = 0.55
 const c = (1 - Math.abs(2 * l - 1)) * s
 const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
 const m2 = l - c / 2
 let r = 0, g = 0, b = 0
 if (h < 60) { r = c; g = x; b = 0 }
 else if (h < 120) { r = x; g = c; b = 0 }
 else if (h < 180) { r = 0; g = c; b = x }
 else if (h < 240) { r = 0; g = x; b = c }
 else if (h < 300) { r = x; g = 0; b = c }
 else { r = c; g = 0; b = x }
 return { r: Math.round((r + m2) * 255), g: Math.round((g + m2) * 255), b: Math.round((b + m2) * 255) }
 }
 const rainbowColors = new Array(barCount).fill(0).map((_, i) =>
 hueToRGB(300 - (i / barCount) * 300) // 紫(300°)→ 蓝 → 绿 → 黄 → 红(0°)
 )

 // 频率窗口:起始抬高到约 1kHz(bin 12),跳过低中音稳定区,
 // 24 根柱覆盖约 1kHz~13.6kHz 的灵动区(镲片/齿音/中高频泛音/人声亮度)
 // 用幂次曲线(指数 0.6)替代纯对数:左端柱覆盖更宽 bin 区间,聚合更多能量而灵动;
 // 每根柱强制最少 2 bin 宽,避免单 bin 长期为 0 几乎不动
 const FREQ_LO_RATIO = 0.047
 const FREQ_HI_RATIO = 0.62
 const startBin = Math.max(2, Math.floor(bufferLength * FREQ_LO_RATIO))
 const endBin = Math.min(bufferLength, Math.floor(bufferLength * FREQ_HI_RATIO))
 const span = endBin - startBin
 const bandRanges: Array<[number, number]> = []
 for (let i = 0; i < barCount; i++) {
 const lo = startBin + Math.floor(Math.pow(i / barCount, 0.6) * span)
 const hi = Math.max(lo + 2, startBin + Math.floor(Math.pow((i + 1) / barCount, 0.6) * span))
 bandRanges.push([Math.min(lo, endBin), Math.min(hi, endBin)])
 }

 const render = () => {
 const w = canvas.width
 const h = canvas.height
 ctx.clearRect(0, 0, w, h)

 // 每 40 帧刷新一次颜色(响应主题色或用户切换)
 if (++colorTick >= 40) {
 colorTick = 0
 refreshColor()
 }

 // ====== 采集频谱数据 ======
 const live = isPlaying && analyserRef.current
 if (live) {
 analyserRef.current!.getByteFrequencyData(dataArray)
 phase += 0.06
 } else {
 // 待机呼吸动画(暂停或分析器未初始化时)
 phase += 0.03
 for (let i = 0; i < bufferLength; i++) {
 const wave1 = Math.sin(phase + i * 0.12) * 14
 const wave2 = Math.sin(phase * 0.7 + i * 0.05) * 10
 dataArray[i] = Math.max(0, Math.min(255, 22 + wave1 + wave2))
 }
 }

 // ====== 绘制频谱光柱(从底部向上生长) ======
 const barWidth = w / barCount
 const gap = Math.min(2.5, Math.max(1.5, barWidth * 0.22))
 const actualBarWidth = Math.max(1, barWidth - gap)
 const maxBarH = h * 0.7 // 限制最大高度,避免柱子过高
 const baselineY = h - 2 // 底部基线(留 2px 间距)
 const isRainbow = spectrumColorRef.current === 'rainbow'

 for (let i = 0; i < barCount; i++) {
 // 区间聚合:均值(稳定) + 峰值(抓瞬态),加重峰值让弱信号瞬态也能明显跳动
 const [lo, hi] = bandRanges[i]
 let sum = 0
 let peak = 0
 for (let j = lo; j < hi; j++) {
 const d = dataArray[j]
 sum += d
 if (d > peak) peak = d
 }
 const avg = sum / (hi - lo)
 const drive = avg * 0.4 + peak * 0.6
 const normalized = Math.min(1, Math.pow(drive / 255, 0.68) * 1.5)

 // 平滑:起跳更脆、回落更利落,节奏点更"灵动"
 const prev = smoothVals[i]
 smoothVals[i] =
 normalized > prev ? prev * 0.12 + normalized * 0.88 : prev * 0.58 + normalized * 0.42
 const v = smoothVals[i]

 const barHeight = Math.max(2, v * maxBarH)
 const x = i * barWidth + gap / 2
 const botY = baselineY
 const topY = botY - barHeight

 // 颜色:彩虹按柱位取色,单色模式用位置渐变色(低沉→高亮)
 const { r, g, b } = isRainbow ? rainbowColors[i] : barColors[i]

 // 竖向渐变:底部沉稳,顶端明亮
 const grad = ctx.createLinearGradient(0, botY, 0, topY)
 grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.5)`)
 grad.addColorStop(0.6, `rgba(${r}, ${g}, ${b}, 0.85)`)
 grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 1)`)
 ctx.fillStyle = grad

 // 顶部圆角矩形(底部平齐,贴基线)
 const rad = Math.min(actualBarWidth / 2, 2)
 ctx.beginPath()
 ctx.moveTo(x, botY)
 ctx.lineTo(x, topY + rad)
 ctx.quadraticCurveTo(x, topY, x + rad, topY)
 ctx.lineTo(x + actualBarWidth - rad, topY)
 ctx.quadraticCurveTo(x + actualBarWidth, topY, x + actualBarWidth, topY + rad)
 ctx.lineTo(x + actualBarWidth, botY)
 ctx.closePath()
 ctx.fill()

 // ====== 峰值帽:悬停在柱子顶端上方,带重力缓慢下落 ======
 if (v >= peaks[i]) {
 peaks[i] = v
 peakVel[i] = 0
 } else {
 peakVel[i] += 0.0018
 peaks[i] = Math.max(v, peaks[i] - peakVel[i])
 }
 if (peaks[i] > 0.02) {
 const capY = botY - Math.max(2, peaks[i] * maxBarH) - 3
 ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.6)`
 ctx.fillRect(x, capY, actualBarWidth, 2)
 }
 }

 if (mountedRef.current) rafRef.current = requestAnimationFrame(render)
 }

 render()

 return () => {
 mountedRef.current = false
 if (rafRef.current) cancelAnimationFrame(rafRef.current)
 }
 }, [isPlaying])

 /* ============ 频谱可视化:Canvas 尺寸自适应 ============ */
 useEffect(() => {
 const canvas = canvasRef.current
 if (!canvas) return
 const resize = () => {
 canvas.width = canvas.clientWidth
 canvas.height = canvas.clientHeight
 }
 resize()
 const ro = new ResizeObserver(resize)
 ro.observe(canvas)
 return () => ro.disconnect()
 }, [])

 /* ============ 组件卸载:清理 Web Audio 资源 ============ */
 useEffect(() => {
 return () => {
 mountedRef.current = false
 if (rafRef.current) cancelAnimationFrame(rafRef.current)
 if (sourceRef.current) { try { sourceRef.current.disconnect() } catch {} }
 if (analyserRef.current) { try { analyserRef.current.disconnect() } catch {} }
 if (audioCtxRef.current) { try { audioCtxRef.current.close() } catch {} }
 audioCtxRef.current = null
 analyserRef.current = null
 sourceRef.current = null
 }
 }, [])

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
 {/* ============ 顶部:搜索栏 + 源选择(紧凑布局) ============ */}
 <div className="flex-shrink-0 px-5 py-2.5 border-b border-[var(--color-border-subtle)] flex items-center gap-3">
 <form onSubmit={handleSearch} className="relative flex-1 min-w-[200px] max-w-md">
 <input
			type="text"
			value={keyword}
			onChange={(e) => setKeyword(e.target.value)}
			placeholder="搜索音乐、歌手..."
			className="w-full bg-[var(--color-hover-overlay)] border border-[var(--color-border-subtle)] px-3.5 py-1.5 pl-9 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-quaternary)] focus:outline-none focus:border-primary/50 focus:bg-[var(--color-hover-overlay-strong)] transition-all rounded"
		/>
 <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-tertiary)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
 </svg>
 {keyword && (
 <button
				type="button"
				onClick={clearSearch}
				className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay)] transition-all text-xs rounded"
			>
 ✕
 </button>
 )}
 </form>

 {/* 源选择(紧凑) */}
 <div className="flex items-center gap-1">
			{SOURCES.map((s) => (
				<button
					key={s.id}
					onClick={() => handleSourceChange(s.id)}
					className={`px-2.5 py-1 text-xs transition-all whitespace-nowrap rounded ${
						source === s.id ? 'bg-primary text-white' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay)]'
					}`}
				>
 {s.name}
 </button>
 ))}
 </div>
 </div>

 {/* ============ 榜单/历史标签(非搜索模式) ============ */}
 {!isSearchMode && (
 <div className="flex-shrink-0 px-5 py-2 flex items-center gap-1.5 overflow-x-auto border-b border-[var(--color-border-subtle)] scrollbar-thin">
 {/* 播放历史 */}
 <button
 onClick={() => { setShowHistory(true); setCurrentBoardId('') }}
 className={`flex-shrink-0 flex items-center gap-1 ${showHistory ? 'chip chip-active' : 'chip'}`}
 >
 <svg className="w-4 h-4 inline-block" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> 播放历史
 {historySongs.length > 0 && (
 <span className={`text-[10px] ${showHistory ? 'opacity-70' : 'text-[var(--color-text-quaternary)]'}`}>{historySongs.length}</span>
 )}
 </button>
 {/* 分隔线 */}
 {boards.length > 0 && <div className="flex-shrink-0 h-3.5 w-px bg-[var(--color-border-subtle)]" />}
 {/* 榜单标签 */}
 {boards.map((b) => (
 <button
 key={b.id}
 onClick={() => { handleBoardChange(b.id); setShowHistory(false) }}
 className={`flex-shrink-0 whitespace-nowrap ${!showHistory && currentBoardId === b.id ? 'chip chip-active' : 'chip'}`}
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
 <div className="flex-shrink-0 px-5 py-2 text-xs text-[var(--color-text-tertiary)] border-b border-[var(--color-border-subtle)] flex items-center justify-between">
 <span>
 {isSearchMode
 ? `搜索 "${submittedKeyword}" 的结果(${searchResults.length})`
 : showHistory
 ? `播放历史(${historySongs.length})`
 : loadingBoards
 ? '加载榜单中...'
 : `共 ${boardSongs.length} 首`}
 </span>
 {currentSong && (
 <span className="text-primary/70 truncate max-w-[200px]">正在播放: {currentSong.name}</span>
 )}
 </div>

 {/* 列表表头 */}
 {displayList.length > 0 && (
 <div className="flex-shrink-0 px-5 py-1.5 grid grid-cols-[28px_44px_1fr_auto] gap-3 text-[11px] text-[var(--color-text-quaternary)] border-b border-[var(--color-border-subtle)] items-center">
 <span className="text-center">#</span>
 <span></span>
 <span>歌曲 / 歌手</span>
 <span className="text-right pr-1">时长</span>
 </div>
 )}

 <div className="flex-1 overflow-y-auto">
 {(searching || loadingBoards) && displayList.length === 0 ? (
 <div className="px-6 py-10 text-center text-[var(--color-text-tertiary)]">
 <div className="spinner" />
 <p className="mt-3 text-sm">加载中...</p>
 </div>
 ) : displayList.length === 0 ? (
 <div className="px-6 py-20 text-center text-[var(--color-text-tertiary)]">
 <svg className="w-16 h-16 mx-auto mb-4 text-[var(--color-text-quaternary)] opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" /></svg>
 <p>{isSearchMode ? '未找到相关音乐' : showHistory ? '暂无播放历史' : '暂无榜单数据'}</p>
 </div>
 ) : (
 <div className="px-3 py-1.5">
 {displayList.map((song, idx) => {
 const isCurrent =
 !!currentSong &&
 currentSong.songId === song.songId &&
 currentSong.source === song.source
 return (
 <div
 key={`${song.source}-${song.songId}-${idx}`}
 onClick={() => handlePlaySong(song, idx, displayList)}
 className={`group grid grid-cols-[28px_44px_1fr_auto] gap-3 px-2 py-1.5 cursor-pointer transition-all items-center ${
 isCurrent
 ? 'bg-primary/20 shadow-[inset_0_0_0_1px_rgba(91,110,255,0.3)]'
 : 'hover:bg-[var(--color-hover-overlay)]'
 }`}
 >
 {/* 序号 / 播放指示 */}
 <div className="w-7 flex-shrink-0 text-center">
 {isCurrent && isPlaying ? (
 <div className="flex items-end justify-center h-4 gap-0.5">
 <span className="w-0.5 bg-primary" style={{ height: '40%', animation: 'eq 0.8s ease-in-out infinite alternate' }} />
 <span className="w-0.5 bg-primary" style={{ height: '80%', animation: 'eq 0.6s ease-in-out infinite alternate' }} />
 <span className="w-0.5 bg-primary" style={{ height: '60%', animation: 'eq 0.7s ease-in-out infinite alternate' }} />
 </div>
 ) : (
 <span
 className={`text-xs tabular-nums group-hover:hidden ${
 isCurrent ? 'text-primary font-medium' : 'text-[var(--color-text-tertiary)]'
 }`}
 >
 {idx + 1}
 </span>
 )}
 {!(isCurrent && isPlaying) && (
 <svg className="hidden group-hover:block w-3.5 h-3.5 text-[var(--color-text-primary)] mx-auto" fill="currentColor" viewBox="0 0 24 24">
 <path d="M8 5v14l11-7z" />
 </svg>
 )}
 </div>

 {/* 封面 */}
 <div className="w-11 h-11 overflow-hidden flex-shrink-0 bg-[var(--color-hover-overlay-subtle)] relative rounded">
 <SmartImage src={song.cover || song.pic} alt={song.name} className="w-full h-full" />
 {isCurrent && (
 <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
 <svg className="w-4 h-4 text-primary" fill="currentColor" viewBox="0 0 24 24">
 {isPlaying ? <path d="M6 5h4v14H6zm8 0h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
 </svg>
 </div>
 )}
 </div>

 {/* 名称 / 歌手 */}
 <div className="min-w-0 flex flex-col">
 <p
 className={`text-sm truncate ${
 isCurrent ? 'text-primary font-medium' : 'text-[var(--color-text-primary)]'
 }`}
 >
 {song.name}
 </p>
 <p className="text-xs text-[var(--color-text-tertiary)] truncate">{song.artist}</p>
 </div>

 {/* 时长 */}
 <span className={`text-xs flex-shrink-0 pr-1 text-right tabular-nums ${isCurrent ? 'text-primary/70' : 'text-[var(--color-text-quaternary)]'}`}>
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
 <div className="w-80 flex-shrink-0 border-l border-[var(--color-border-subtle)] flex flex-col bg-[var(--color-panel-bg)] relative overflow-hidden">
 {/* 毛玻璃专辑封面背景:取当前歌曲封面,模糊+暗化,随歌曲切换平滑过渡 */}
 {currentSong && (currentSong.cover || currentSong.pic) && (
 <img
 src={currentSong.cover || currentSong.pic}
 alt=""
 className="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000"
 style={{ filter: 'blur(40px) brightness(0.35) saturate(1.4)', transform: 'scale(1.15)', opacity: 0.7 }}
 />
 )}
 {/* 半透明遮罩,确保歌词可读性 */}
 <div className="absolute inset-0 bg-[var(--color-panel-bg)] opacity-60" />
 {/* 歌词标题 + 设置 */}
 <div className="relative z-10 flex-shrink-0 px-5 py-2.5 flex items-center justify-between border-b border-[var(--color-border-subtle)]">
 <span className="text-xs text-[var(--color-text-tertiary)] font-medium">歌词</span>
 <div className="flex items-center gap-1.5">
 {/* 卡拉OK开关 */}
 <button
				onClick={() => setKaraokeMode(!karaokeMode)}
				className={`text-[10px] px-2 py-0.5 transition-all rounded ${
					karaokeMode ? 'bg-primary/20 text-primary ring-1 ring-primary/30' : 'bg-[var(--color-hover-overlay)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
				}`}
 title="卡拉OK模式"
 >
 KTV
 </button>
 {/* 颜色选择 */}
 <div className="flex items-center gap-1">
 {['#e50914', '#ff5b8a', '#00d4aa', '#ffa500', '#e040fb'].map((c) => (
 <button
 key={c}
 onClick={() => setLyricColor(c)}
 className={`w-3 h-3 transition-transform ${lyricColor === c ? 'scale-125 ring-1 ring-white/40' : 'hover:scale-110'}`}
 style={{ backgroundColor: c }}
 title={`高亮颜色 ${c}`}
 />
 ))}
 </div>
 {/* 字体大小 */}
 <div className="flex items-center gap-0.5 ml-1">
 <button
 onClick={() => setLyricFontSize(Math.max(12, lyricFontSize - 2))}
 className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-[10px] w-4 h-4 flex items-center justify-center hover:bg-[var(--color-hover-overlay)] transition-all"
 title="缩小字体"
 >A-</button>
 <button
 onClick={() => setLyricFontSize(Math.min(24, lyricFontSize + 2))}
 className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-[10px] w-4 h-4 flex items-center justify-center hover:bg-[var(--color-hover-overlay)] transition-all"
 title="放大字体"
 >A+</button>
 </div>
 </div>
 </div>
 {/* 歌词内容 */}
 <div ref={lyricScrollRef} className="relative z-10 flex-1 overflow-y-auto px-5 py-6 lyric-scroll">
 {!currentSong ? (
 <p className="text-center text-[var(--color-text-quaternary)] text-sm mt-10">播放歌曲以查看歌词</p>
 ) : lyricLines.length === 0 ? (
 <p className="text-center text-[var(--color-text-quaternary)] text-sm mt-10">暂无歌词</p>
 ) : (
 <div className="space-y-4">
 {lyricLines.map((line, i) => {
 const isActive = i === currentLyricIndex
 // 距离当前行的距离,用于计算淡出透明度(更明显的淡化)
 const distance = Math.abs(i - currentLyricIndex)
 const opacity = isActive ? 1 : Math.max(0.15, 1 - distance * 0.28)
 return (
 <div
 key={i}
 ref={isActive ? activeLyricRef : undefined}
 className="transition-all duration-500 ease-out"
 style={{
 opacity,
 transform: isActive ? 'scale(1.02)' : 'scale(0.96)',
 filter: isActive ? 'none' : distance > 2 ? 'blur(0.5px)' : 'none',
 }}
 >
 {/* 卡拉OK模式:底层灰色完整文字 + 顶层彩色按进度裁切 */}
 {isActive && karaokeMode ? (
 <div className="relative leading-relaxed font-semibold" style={{ fontSize: `${lyricFontSize + 1}px` }}>
 {/* 底层:完整灰色文字(始终可见) */}
 <span style={{ color: 'rgba(255,255,255,0.3)' }}>
 {line.text || '...'}
 </span>
 {/* 顶层:彩色文字按进度宽度裁切(线性平滑过渡) */}
 <span
 className="absolute inset-0 overflow-hidden whitespace-nowrap"
 style={{
 width: `${karaokeProgress * 100}%`,
 color: lyricColor,
 transition: 'width 0.3s linear',
 textShadow: `0 0 10px ${lyricColor}66`,
 }}
 >
 {line.text || '...'}
 </span>
 </div>
 ) : (
 <p
 className="leading-relaxed"
 style={{
 fontSize: `${isActive ? lyricFontSize + 1 : lyricFontSize - 2}px`,
 color: isActive ? lyricColor : 'rgba(255,255,255,0.35)',
 fontWeight: isActive ? 600 : 400,
 textShadow: isActive ? `0 0 12px ${lyricColor}55` : 'none',
 }}
 >
 {line.text || '...'}
 </p>
 )}
 {line.translation && (
 <p
 className="text-xs mt-1"
 style={{ color: isActive ? `${lyricColor}b0` : 'rgba(255,255,255,0.25)' }}
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
 <div className="h-24 flex-shrink-0 glass border-t border-[var(--color-border-subtle)] flex items-center px-5 gap-4 relative">
 {/* 歌曲信息 */}
 <div className="flex items-center gap-3 w-56 flex-shrink-0">
 <div className="w-12 h-12 overflow-hidden flex-shrink-0 bg-[var(--color-hover-overlay-subtle)] ring-1 ring-white/5 rounded">
 {currentSong ? (
 <SmartImage src={currentSong.cover || currentSong.pic} alt={currentSong.name} className="w-full h-full" />
 ) : (
 <div className="w-full h-full flex items-center justify-center text-gray-700 text-xl">
 🎵
 </div>
 )}
 </div>
 <div className="min-w-0 flex-1">
 <p className="text-sm text-white truncate font-medium">{currentSong?.name || '未播放'}</p>
 <p className="text-xs text-[var(--color-text-tertiary)] truncate">{currentSong?.artist || '—'}</p>
 </div>
 </div>

 {/* 播放控制 + 进度 */}
 <div className="flex-1 flex flex-col items-center gap-1 min-w-0">
 <div className="flex items-center gap-5">
 <button
 onClick={playPrev}
 disabled={playlist.length === 0}
 className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-30 transition-colors"
 title="上一首"
 >
 <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
 <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
 </svg>
 </button>
 <button
			onClick={togglePlay}
			disabled={!currentSong}
			className="w-10 h-10 bg-primary text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-transform disabled:opacity-30 shadow-lg shadow-primary/30 rounded-full"
			title={isPlaying ? '暂停' : '播放'}
		>
 {loadingUrl ? (
 <div className="spinner spinner-sm" />
 ) : isPlaying ? (
 <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
 <path d="M6 5h4v14H6zm8 0h4v14h-4z" />
 </svg>
 ) : (
 <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
 <path d="M8 5v14l11-7z" />
 </svg>
 )}
 </button>
 <button
 onClick={playNext}
 disabled={playlist.length === 0}
 className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-30 transition-colors"
 title="下一首"
 >
 <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
 <path d="M16 6h2v12h-2zM6 6l8.5 6L6 18z" />
 </svg>
 </button>
 </div>

 {/* 进度条(带时间显示) + 音量(同一行) */}
 <div className="w-full flex items-center gap-2.5">
 <span className="text-[11px] text-white/80 w-10 text-right tabular-nums font-medium">
 {formatTime(currentTime)}
 </span>
 <div
			ref={progressBarRef}
			onMouseDown={onProgressMouseDown}
			className="flex-1 h-1.5 bg-[var(--color-hover-overlay-strong)] cursor-pointer relative group hover:h-2 transition-all"
			style={{ borderRadius: '9999px' }}
		>
			<div
				className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary via-red-500 to-red-400"
				style={{ width: `${progressRatio * 100}%`, borderRadius: '9999px' }}
			/>
			<div
				className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity ring-2 ring-primary/40"
				style={{ left: `${progressRatio * 100}%`, borderRadius: '50%' }}
			/>
 </div>
 <span className="text-[11px] text-white/80 w-10 tabular-nums font-medium">
 {formatTime(duration)}
 </span>
 {/* 音量 */}
 <button
 onClick={toggleMute}
 className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors ml-1"
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
			className="w-24 flex-shrink-0"
		/>
 </div>
 </div>

 {/* 频谱可视化(独立区域) */}
 <div className="w-44 h-16 flex-shrink-0 relative group/spectrum">
 <canvas
 ref={canvasRef}
 className="w-full h-full"
 />
 {/* 频谱颜色选择器(hover 显示) */}
 <div className="absolute top-0 left-0 right-0 h-5 flex items-center justify-center gap-1.5 bg-black/60 backdrop-blur-sm opacity-0 group-hover/spectrum:opacity-100 transition-opacity z-10 rounded-t">
 {[
 { key: 'theme', label: '主题', color: 'var(--color-primary)' },
 { key: '#e50914', label: '', color: '#e50914' },
 { key: '#ff5b8a', label: '', color: '#ff5b8a' },
 { key: '#00d4aa', label: '', color: '#00d4aa' },
 { key: '#ffa500', label: '', color: '#ffa500' },
 { key: '#42a5f5', label: '', color: '#42a5f5' },
 { key: '#ab47bc', label: '', color: '#ab47bc' },
 { key: 'rainbow', label: '彩虹', color: 'linear-gradient(90deg,#e50914,#ffa500,#00d4aa,#42a5f5,#ab47bc)' },
 ].map((opt) => (
 <button
 key={opt.key}
 onClick={() => setSpectrumColor(opt.key)}
 className={`w-3 h-3 transition-transform ${spectrumColor === opt.key ? 'scale-125 ring-1 ring-white/60' : 'hover:scale-110'}`}
 style={{
 background: opt.color,
 borderRadius: '2px',
 }}
 title={opt.label || opt.key}
 >
 {opt.label && (
 <span className="text-[8px] text-white/80 leading-none flex items-center justify-center w-full h-full">{opt.label}</span>
 )}
 </button>
 ))}
 </div>
 </div>
 </div>

 {/* ============ 错误提示 ============ */}
 {playError && (
 <div className="absolute bottom-28 left-1/2 -translate-x-1/2 px-4 py-2 bg-red-500/20 text-red-300 text-xs backdrop-blur-sm border border-red-500/30 animate-fadeIn z-20 rounded">
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
