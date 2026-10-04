/**
 * 音乐页播放器 hook
 *
 * 内聚:<audio> 元素与全部播放状态、加载播放(含自动换源)、
 * 播放控制(上一首/下一首/播放暂停)、audio 事件、音量、进度条拖动。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  searchMusic,
  getMusicLyric,
  getMusicUrlFromHuibq,
  getMusicUrlFromServer,
  type MusicSong,
  type MusicLyric
} from '../../lib/music'
import { SOURCES } from './types'
import type { SpectrumCore } from './useSpectrum'

interface UseMusicPlayerParams {
  audioCtxRef: SpectrumCore['audioCtxRef']
  initVisualizer: SpectrumCore['initVisualizer']
  /** 播放成功后把歌曲加入播放列表(本地持久化) */
  upsertPlaylistSong: (song: MusicSong) => void
  /** 用户选择的音质('320k' | '192k' | '128k') */
  quality: string
}

export function useMusicPlayer({ audioCtxRef, initVisualizer, upsertPlaylistSong, quality }: UseMusicPlayerParams) {
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
  /** 拖拽中的 pointerId,用于 setPointerCapture/releasePointerCapture */
  const dragPointerIdRef = useRef<number | null>(null)

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
  const qualityRef = useRef(quality)
  qualityRef.current = quality

  /* ============ 加载播放地址并播放(含自动换源) ============ */
  const loadAndPlay = useCallback(async (song: MusicSong) => {
    const audio = audioRef.current
    if (!audio) return
    // 生成请求 ID,用于快速切歌时取消旧的异步流程
    const requestId = ++playRequestIdRef.current
    // 初始化频谱可视化(首次播放时创建 AudioContext)
    initVisualizer(audioRef.current)
    // 恢复 AudioContext(浏览器可能自动挂起),必须 await 否则音频不会出声
    if (audioCtxRef.current?.state === 'suspended') {
      console.log('[Music] Resuming AudioContext...')
      await audioCtxRef.current.resume()
      console.log('[Music] AudioContext state:', audioCtxRef.current.state)
    }

    // 尝试播放单个 URL,返回是否成功
    // 修复:等待 canplay/playing 事件确认播放,而非仅依赖 play() Promise
    // play() resolve 仅表示浏览器接受了播放请求,不代表音频能正常播放
    const tryPlay = (url: string, timeoutMs = 12000): Promise<{ ok: boolean; blocked: boolean }> => {
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

        const finish = (result: boolean, blocked: boolean, reason: string) => {
          if (settled) return
          settled = true
          tryPlayingRef.current = false
          cleanup()
          console.log(`[Music] tryPlay result: ${result} blocked: ${blocked} (${reason})`)
          resolve({ ok: result, blocked })
        }

        const onCanPlay = () => finish(true, false, 'canplay event')
        const onPlaying = () => finish(true, false, 'playing event')
        const onError = (e: Event) => {
          const err = (e.target as HTMLAudioElement).error
          finish(false, false, `error event: ${err ? `code=${err.code}` : 'unknown'}`)
        }
        const onStalled = () => {
          console.warn('[Music] audio stalled, waiting 3s...')
          stallCheckTimer = setTimeout(() => {
            if (settled) return
            if (audio.readyState < 3) {
              finish(false, false, 'stalled timeout, readyState still low')
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
            finish(true, false, 'play() resolved with readyState >= 3')
          }
        }).catch((err) => {
          console.warn('[Music] play() rejected:', err)
          // 自动播放被浏览器/系统拦截(启动时无用户手势):src 已加载,
          // 保持就绪暂停态,不应触发换源链或报错
          if (err?.name === 'NotAllowedError') {
            finish(false, true, 'autoplay blocked')
          } else {
            finish(false, false, `play() rejected: ${err?.message || err}`)
          }
        })

        // 总超时:超时后检查音频是否实际在播放
        timeoutTimer = setTimeout(() => {
          if (settled) return
          // 如果音频实际在播放(非暂停且有时间进度),判定成功
          if (!audio.paused && audio.currentTime > 0) {
            finish(true, false, 'timeout but audio is playing')
          } else {
            finish(false, false, `timeout after ${timeoutMs}ms, readyState=${audio.readyState}`)
          }
        }, timeoutMs)
      })
    }

    // 尝试从指定歌曲获取 URL 并播放
    // 策略:先尝试服务端 play API,失败再尝试 Huibq 公共 API
    // 返回 { played, blocked }:blocked 表示自动播放被拦截(src 已就绪,非播放失败)
    const tryPlaySong = async (
      songToPlay: MusicSong
    ): Promise<{ played: boolean; blocked: boolean }> => {

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

      // 尝试获取可播放的 URL:服务端 API → Huibq API
      let audioUrl: string | null = null

      // 1. 服务端 play API(LX Music 音源,可能更稳定)
      console.log('[Music] Trying server play API:', songToPlay.name, 'source:', songToPlay.source)
      audioUrl = await getMusicUrlFromServer(songToPlay, qualityRef.current)

      if (!audioUrl) {
        console.warn('[Music] No URL from server for:', songToPlay.name)
      }

      // 2. 播放(12秒超时)
      let played = false
      let blocked = false
      if (audioUrl) {
        const r = await tryPlay(audioUrl, 12000)
        played = r.ok
        blocked = r.blocked
        console.log('[Music] Play result:', played, 'blocked:', blocked)
      }

      // 2b. 播放失败(非拦截):可能320k的URL来自不可用的中转站,
      //     用128k重新解析(野花等脚本在低质量可能出CDN直链)
      if (!played && !blocked) {
        console.log('[Music] Play failed, retrying with 128k...')
        const lowUrl = await getMusicUrlFromServer(songToPlay, '128k')
        if (lowUrl && lowUrl !== audioUrl) {
          audioUrl = lowUrl
          const r = await tryPlay(audioUrl, 12000)
          played = r.ok
          blocked = r.blocked
          console.log('[Music] Play result (128k):', played, 'blocked:', blocked)
        }
      }

      // 2c. 还是失败,试 Huibq 公共 API
      if (!played && !blocked) {
        console.log('[Music] Server URL unplayable, trying Huibq:', songToPlay.name)
        const huibqUrl = await getMusicUrlFromHuibq(songToPlay)
        if (huibqUrl) {
          audioUrl = huibqUrl
          const r = await tryPlay(audioUrl, 12000)
          played = r.ok
          blocked = r.blocked
          console.log('[Music] Play result (Huibq):', played, 'blocked:', blocked)
        }
      }

      if (blocked) return { played: false, blocked: true }
      if (!played) return { played: false, blocked: false }

      // 4. 播放成功:获取歌词并加入播放列表
      applyLyrics()
      upsertPlaylistSong(songToPlay)
      return { played: true, blocked: false }
    }

    setLoadingUrl(true)
    setPlayError('')
    setLyricData(null)
    setCurrentTime(0)
    setDuration(0)

    // 先尝试当前源
    const first = await tryPlaySong(song)
    if (first.played) {
      if (requestId !== playRequestIdRef.current) return // 已被新请求取代
      setLoadingUrl(false)
      return
    }
    // 自动播放被拦截:src 已加载就绪,静默等待用户点击播放,不换源、不报错
    if (first.blocked) {
      if (requestId !== playRequestIdRef.current) return
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
          const r = await tryPlaySong(newSong)
          if (r.played) {
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
          if (r.blocked) {
            if (requestId !== playRequestIdRef.current) return
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
  }, [initVisualizer, audioCtxRef, upsertPlaylistSong])

  /* ============ 点击歌曲播放 ============ */
  const handlePlaySong = (song: MusicSong, index: number, list: MusicSong[]) => {
    setPlaylist(list)
    setCurrentIndex(index)
    currentIndexRef.current = index
    loadAndPlay(song)
  }

  /* ============ 启动时:用保存的播放列表自动播放 ============ */
  const startPlaylist = useCallback((songs: MusicSong[], index = 0) => {
    if (songs.length === 0) return
    if (index < 0 || index >= songs.length) index = 0
    setPlaylist(songs)
    setCurrentIndex(index)
    currentIndexRef.current = index
    loadAndPlay(songs[index])
  }, [loadAndPlay])

  /* ============ 播放控制 ============ */
  const togglePlay = async () => {
    const audio = audioRef.current
    if (!audio || !audio.src) return
    // 初始化/恢复 AudioContext(用户交互后)
    initVisualizer(audioRef.current)
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
    // 用 Pointer Capture 确保拖出窗口仍能跟踪,替代纯 window mousemove
    const bar = progressBarRef.current
    const native = e.nativeEvent as MouseEvent & { pointerId?: number }
    if (bar && native.pointerId != null) {
      dragPointerIdRef.current = native.pointerId
      bar.setPointerCapture(native.pointerId)
    }
    setIsDragging(true)
    seekToClientX(e.clientX)
  }

  /** 停止播放并复位状态(删除当前歌曲/清空列表时调用) */
  const stopPlay = () => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    // 必须同步清空队列:否则播放栏上一首/下一首/onEnded 仍能播放已删除的歌,
    // 播放成功后经 upsertPlaylistSong 把歌曲重新写回列表造成"复活"
    setPlaylist([])
    setIsPlaying(false)
    setCurrentIndex(-1)
    setCurrentTime(0)
    setDuration(0)
    setPlayError('')
    setLyricData(null)
  }

  /**
   * 从播放队列移除单首(播放列表删除非当前歌曲时同步队列)。
   * 删除当前播放项应由 stopPlay 处理;此处返回是否命中。
   */
  const removeSongFromQueue = (song: MusicSong): boolean => {
    const list = playlistRef.current
    const idx = list.findIndex(
      (s) => s.source === song.source && s.songId === song.songId
    )
    if (idx < 0) return false
    const next = list.slice()
    next.splice(idx, 1)
    setPlaylist(next)
    // 删除项在当前歌曲之前时,当前索引前移,避免播错/错位
    const cur = currentIndexRef.current
    if (idx < cur) {
      const ci = cur - 1
      setCurrentIndex(ci)
      currentIndexRef.current = ci
    }
    return true
  }

  // 全局拖动监听(拖动期间持续 seek; pointermove 配合 setPointerCapture 可在拖出窗口后仍跟踪)
  useEffect(() => {
    if (!isDragging) return
    const bar = progressBarRef.current
    const onMove = (e: PointerEvent) => seekToClientX(e.clientX)
    const onUp = () => {
      setIsDragging(false)
      // 释放 pointer capture,避免后续事件仍被捕获
      if (bar && dragPointerIdRef.current != null) {
        try { bar.releasePointerCapture(dragPointerIdRef.current) } catch { /* 未捕获过指针时忽略 */ }
        dragPointerIdRef.current = null
      }
    }
    const onCancel = () => {
      setIsDragging(false)
      if (bar && dragPointerIdRef.current != null) {
        try { bar.releasePointerCapture(dragPointerIdRef.current) } catch { /* 忽略 */ }
        dragPointerIdRef.current = null
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging, duration])

  return {
    audioRef,
    playlist,
    currentIndex,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    loadingUrl,
    playError,
    lyricData,
    progressBarRef,
    handlePlaySong,
    startPlaylist,
    stopPlay,
    removeSongFromQueue,
    togglePlay,
    playPrev,
    playNext,
    onLoadedMetadata,
    onTimeUpdate,
    onEnded,
    onPlay,
    onPause,
    onError,
    handleVolumeChange,
    toggleMute,
    onProgressMouseDown
  }
}
