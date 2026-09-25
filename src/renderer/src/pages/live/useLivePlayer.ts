/**
 * 直播播放器 hook — Artplayer + HLS 创建/销毁/错误恢复/自动换线
 */
import { useEffect, useRef, useState, useCallback, type MutableRefObject } from 'react'
import Artplayer from 'artplayer'
import Hls from 'hls.js'
import { saveLiveMemory } from './types'
import type { ChannelItem } from './types'

interface UseLivePlayerOptions {
  currentChannel: ChannelItem | null
  currentUrlIndex: number
  currentSourceKey: string
  currentChannelRef: MutableRefObject<ChannelItem | null>
  currentUrlIndexRef: MutableRefObject<number>
  setCurrentUrlIndex: (v: number | ((prev: number) => number)) => void
  setError: (msg: string) => void
  setErrorType: (type: 'load' | 'play') => void
  setPlayerLoading: (loading: boolean) => void
}

export function useLivePlayer({
  currentChannel,
  currentUrlIndex,
  currentSourceKey,
  currentChannelRef,
  currentUrlIndexRef,
  setCurrentUrlIndex,
  setError,
  setErrorType,
  setPlayerLoading,
}: UseLivePlayerOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<Artplayer | null>(null)
  const hlsRef = useRef<Hls | null>(null)
  const retryCountRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const networkRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blockedUrlsRef = useRef<Set<string>>(new Set())
  const currentUrlRef = useRef<string>('')
  const autoSwitchRef = useRef<(url: string) => void>(() => {})

  const [autoSwitchMsg, setAutoSwitchMsg] = useState('')

  /* ============ 销毁播放器(同步) ============ */
  const destroyPlayer = useCallback(() => {
    const art = artRef.current
    const hls = hlsRef.current
    artRef.current = null
    hlsRef.current = null
    // 清除重试定时器
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null }
    if (networkRetryTimerRef.current) { clearTimeout(networkRetryTimerRef.current); networkRetryTimerRef.current = null }
    retryCountRef.current = 0
    if (art && !art.isDestroy) {
      try { art.pause() } catch {}
      try {
        const video = art.template?.$video
        if (video) { video.pause(); video.removeAttribute('src'); video.load() }
      } catch {}
      try { art.destroy(true) } catch {}
    }
    if (hls) { try { hls.destroy() } catch {} }
    // 清空容器
    if (containerRef.current) {
      containerRef.current.innerHTML = ''
    }
  }, [])

  /* ============ 销毁播放器(异步,仅用于组件卸载) ============ */
  const destroyPlayerAsync = useCallback(() => {
    const art = artRef.current
    const hls = hlsRef.current
    artRef.current = null
    hlsRef.current = null
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null }
    if (networkRetryTimerRef.current) { clearTimeout(networkRetryTimerRef.current); networkRetryTimerRef.current = null }
    if (art && !art.isDestroy) { try { art.pause() } catch {} }
    setTimeout(() => {
      if (hls) { try { hls.destroy() } catch {} }
      if (art && !art.isDestroy) {
        try {
          const video = art.template?.$video
          if (video) { video.pause(); video.removeAttribute('src'); video.load() }
        } catch {}
        try { art.destroy(true) } catch {}
      }
    }, 0)
  }, [])

  useEffect(() => {
    return () => { destroyPlayerAsync() }
  }, [destroyPlayerAsync])

  /* ============ 创建播放器 ============ */
  const createPlayer = useCallback((url: string, _detectedType?: string) => {
    if (!containerRef.current) return
    containerRef.current.innerHTML = ''

    const art = new Artplayer({
      container: containerRef.current,
      url,
      type: 'm3u8',
      autoplay: true,
      screenshot: true,
      hotkey: false,
      fullscreen: true,
      fullscreenWeb: false,
      playsInline: true,
      mutex: true,
      backdrop: true,
      theme: getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#e50914',
      lang: 'zh-cn',
      setting: false,
      customType: {
        m3u8: (video: HTMLVideoElement, src: string) => {
          if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = src
          } else if (Hls.isSupported()) {
            const hls = new Hls({
              liveDurationInfinity: true,
              lowLatencyMode: true,
              liveSyncDurationCount: 3,
              liveMaxLatencyDurationCount: 6,
              liveBackBufferLength: 10,
              maxBufferLength: 10,
              maxMaxBufferLength: 30,
              maxBufferSize: 30 * 1000 * 1000,
              maxBufferHole: 0.5,
              highBufferWatchdogPeriod: 2,
              nudgeMaxRetry: 5,
              xhrSetup: (xhr) => { xhr.withCredentials = false },
            })
            hls.loadSource(src)
            hls.attachMedia(video)
            hlsRef.current = hls
            hls.on(Hls.Events.ERROR, (_e, data) => {
              console.log('[Live] HLS error:', data.type, data.details, data.fatal)
              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    // 网络错误:尝试恢复一次,2秒后仍无画面则换线
                    hls.startLoad()
                    if (networkRetryTimerRef.current) clearTimeout(networkRetryTimerRef.current)
                    networkRetryTimerRef.current = setTimeout(() => {
                      networkRetryTimerRef.current = null
                      const v = art.template?.$video
                      if (v && v.readyState < 2) {
                        hls.destroy()
                        autoSwitchRef.current(src)
                      }
                    }, 2000)
                    break
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    hls.recoverMediaError()
                    break
                  default:
                    hls.destroy()
                    autoSwitchRef.current(src)
                    break
                }
              }
            })
          }
        }
      },
    })

    // 播放就绪后取消静音
    art.on('video:playing', () => {
      retryCountRef.current = 0
    })

    artRef.current = art
  }, [])

  /** 暂停当前播放(返回首页前调用,避免后台继续解码) */
  const pausePlayer = useCallback(() => {
    const art = artRef.current
    if (art && !art.isDestroy) {
      try { art.pause() } catch {}
    }
  }, [])

  /* ============ 自动跳到下一个未屏蔽的线路 ============ */
  const autoSwitchToNextUrl = useCallback((failedUrl: string) => {
    const ch = currentChannelRef.current
    if (!ch) return
    blockedUrlsRef.current.add(failedUrl)
    // 找下一个未屏蔽的 URL
    const total = ch.urls.length
    for (let i = 1; i <= total; i++) {
      const nextIdx = (currentUrlIndexRef.current + i) % total
      const nextUrl = ch.urls[nextIdx]
      if (nextUrl && !blockedUrlsRef.current.has(nextUrl)) {
        setAutoSwitchMsg(`线路 ${currentUrlIndexRef.current + 1} 无法播放，自动切换到线路 ${nextIdx + 1}`)
        // 3秒后清除提示
        setTimeout(() => setAutoSwitchMsg(''), 3000)
        setCurrentUrlIndex(nextIdx)
        return
      }
    }
    // 所有线路都被屏蔽了
    setErrorType('play')
    setError('所有线路均无法播放，请换台或更换直播源')
    setPlayerLoading(false)
  }, [currentChannelRef, currentUrlIndexRef, setCurrentUrlIndex, setError, setErrorType, setPlayerLoading])

  // 同步到 ref,供 createPlayer 中的 HLS 错误回调使用
  autoSwitchRef.current = autoSwitchToNextUrl

  /* ============ 选中频道/切换 URL 后自动播放 + 保存记忆 ============ */
  useEffect(() => {
    if (!currentChannel) return
    if (currentSourceKey) {
      saveLiveMemory({ sourceKey: currentSourceKey, channelName: currentChannel.name, urlIndex: currentUrlIndex })
    }
    const url = currentChannel.urls[currentUrlIndex]
    if (!url) {
      setErrorType('play')
      setError('该频道无播放地址')
      setPlayerLoading(false)
      return
    }
    // 如果这个 URL 已被屏蔽,自动跳到下一个
    if (blockedUrlsRef.current.has(url)) {
      autoSwitchToNextUrl(url)
      return
    }
    currentUrlRef.current = url
    setError('')
    setPlayerLoading(true)
    retryCountRef.current = 0
    destroyPlayer()

    let cancelled = false

    // 安全播放:无论成功失败都取消 loading
    const safePlay = (playUrl: string) => {
      if (cancelled) { return }
      try {
        createPlayer(playUrl)
      } catch (err) {
        console.error('[Live] createPlayer failed:', err)
        setErrorType('play')
        setError('播放器创建失败: ' + (err as Error)?.message)
      } finally {
        setPlayerLoading(false)
      }
    }

    // 统一用 HLS 播放
    requestAnimationFrame(() => safePlay(url))

    // 超时检测:3秒后检查是否在播放
    const checkTimer = setTimeout(() => {
      if (cancelled) return
      const art = artRef.current
      if (art && !art.isDestroy) {
        const video = art.template?.$video
        if (video && video.readyState < 2 && !video.currentTime) {
          if (retryCountRef.current < 1) {
            // 重试一次,3秒后再检测
            retryCountRef.current++
            destroyPlayer()
            requestAnimationFrame(() => safePlay(url))
            // 重试后设置新的超时检测
            const retryTimer = setTimeout(() => {
              if (cancelled) return
              const art2 = artRef.current
              if (art2 && !art2.isDestroy) {
                const v2 = art2.template?.$video
                if (v2 && v2.readyState < 2 && !v2.currentTime) {
                  autoSwitchToNextUrl(url)
                }
              } else {
                autoSwitchToNextUrl(url)
              }
            }, 3000)
            retryTimerRef.current = retryTimer
          } else {
            // 重试失败,自动换线
            autoSwitchToNextUrl(url)
          }
        }
      } else {
        // 播放器不存在,自动换线
        autoSwitchToNextUrl(url)
      }
    }, 3000)
    retryTimerRef.current = checkTimer

    return () => {
      cancelled = true
      clearTimeout(checkTimer)
      destroyPlayer()
    }
  }, [currentChannel, currentUrlIndex, currentSourceKey, destroyPlayer, createPlayer, autoSwitchToNextUrl, setError, setErrorType, setPlayerLoading])

  return { containerRef, autoSwitchMsg, blockedUrlsRef, pausePlayer }
}
