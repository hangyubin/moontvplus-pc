/**
 * 直播播放器 hook — Artplayer + HLS 创建/销毁/错误恢复/自动换线
 */
import { useEffect, useRef, useState, useCallback, type MutableRefObject } from 'react'
import Artplayer from 'artplayer'
import Hls from 'hls.js'
import { saveLiveMemory } from './types'
import type { ChannelItem } from './types'

/** 播放中途卡死判定:连续多少秒进度不推进就自动换线 */
const MID_STALL_LIMIT_SEC = 6
/** 两次自动换线最小间隔(冷却):给新线路足够的起播/缓冲时间,避免频繁切换 */
const AUTO_SWITCH_COOLDOWN_MS = 15000
/** 同一频道连续自动换线上限:超过即停止并提示手动处理,避免无限循环 */
const AUTO_SWITCH_MAX_ROUND = 4

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
  /** 播放中途卡死看门狗定时器(每秒检查一次播放进度是否推进) */
  const stallWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const blockedUrlsRef = useRef<Set<string>>(new Set())
  const currentUrlRef = useRef<string>('')
  const autoSwitchRef = useRef<(url: string) => void>(() => {})
  /** 上次自动换线时间戳(冷却门控,0 表示尚无自动换线) */
  const lastAutoSwitchAtRef = useRef(0)
  /** 本轮(同一频道)已自动换线次数 */
  const autoSwitchRoundRef = useRef(0)
  /** 上次播放的频道名:检测换频道时重置自动换线计数 */
  const lastChannelNameRef = useRef('')

  /** 诊断统计(诊断面板每秒读取):
   * - waiting/stalled:缓冲耗尽事件次数,区分"网络型卡顿"
   * - fragsLoaded/lastFragMs/maxFragMs:分片下载耗时,判断网速是否追得上直播
   * - netFatal/mediaFatal:致命错误计数 */
  const diagStatsRef = useRef({
    waiting: 0,
    stalled: 0,
    playing: 0,
    netFatal: 0,
    mediaFatal: 0,
    fragsLoaded: 0,
    lastFragMs: 0,
    maxFragMs: 0,
    sumFragMs: 0,
  })

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
    if (stallWatchdogRef.current) { clearInterval(stallWatchdogRef.current); stallWatchdogRef.current = null }
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
    if (stallWatchdogRef.current) { clearInterval(stallWatchdogRef.current); stallWatchdogRef.current = null }
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
            // 每次换流重置诊断计数
            const diag = diagStatsRef.current
            diag.waiting = 0; diag.stalled = 0; diag.playing = 0
            diag.netFatal = 0; diag.mediaFatal = 0
            diag.fragsLoaded = 0; diag.lastFragMs = 0; diag.maxFragMs = 0; diag.sumFragMs = 0

            // 直播缓冲配置(方案A + 二次优化):
            // 统一用 Duration 族(秒)——禁止与 Count 族混用,否则抛 Illegal config。
            // 二次优化对标 ExoPlayer 默认(minBuffer≈15s / maxBuffer≈50s),进一步拉大缓冲、
            // 增强弱网重试,向 APP 播放流畅度靠拢;代价仅直播延迟约 12s,电视直播源本身延迟高,无感
            const hls = new Hls({
              liveDurationInfinity: true,
              // 普通直播流关闭低延迟:仅 LL-HLS 有意义,开着只会让播放点更贴边缘
              lowLatencyMode: false,
              liveSyncDuration: 12, // 目标直播延迟:播放点距边缘 12s(原 10s)
              liveMaxLatencyDuration: 40, // 追播极限 40s(原 30s),抗抖动核心
              liveBackBufferLength: 30,
              maxBufferLength: 45, // 正常缓冲水位 45s(原 30s),接近 ExoPlayer maxBuffer
              maxMaxBufferLength: 90, // 网络好时最多囤 90s(原 60s)
              maxBufferSize: 120 * 1000 * 1000, // 缓冲大小上限 120MB(原 60MB),高清多路流更从容
              maxBufferHole: 1, // 1s 内的缓冲空洞直接跳过,避免假性卡顿
              highBufferWatchdogPeriod: 2,
              nudgeMaxRetry: 6, // 卡住时主动跳变的次数(原 5)
              fragLoadingTimeOut: 20000, // 分片 20s 拉不下来即判网络错误
              // 弱网重试更充分:靠重试扛过短时波动,而不是轻易判死换线
              manifestLoadingMaxRetry: 4,
              levelLoadingMaxRetry: 4,
              fragLoadingMaxRetry: 6,
              xhrSetup: (xhr) => { xhr.withCredentials = false },
            })
            hls.loadSource(src)
            hls.attachMedia(video)
            hlsRef.current = hls

            // ---- 诊断 + 卡死看门狗(video 随 Artplayer 每次重建,元素级监听无需手动解绑)
            hls.on(Hls.Events.MEDIA_ATTACHED, () => {
              const v = hls.media
              if (!v) return
              v.addEventListener('waiting', () => { diag.waiting++ })
              v.addEventListener('stalled', () => { diag.stalled++ })
              v.addEventListener('playing', () => { diag.playing++ })

              /* ---- 播放中途卡死自动换线 ----
               * 起播成功后才武装;每秒核对:未被用户暂停且进度连续 6s 不推进
               * (缓冲耗尽/分片拉不动/解码挂死),判定为中途卡死,屏蔽当前线路并自动换线。
               * 一旦触发立即停掉看门狗,换线 effect 会销毁并重建整套播放器 */
              let armed = false
              let lastTime = -1
              let stuckSec = 0
              v.addEventListener('playing', () => {
                armed = true
                lastTime = v.currentTime
                stuckSec = 0
              })
              v.addEventListener('timeupdate', () => {
                // 进度有推进就清零卡死计数(用时间比较,避免同一秒内重复回调误判)
                if (v.currentTime !== lastTime) {
                  lastTime = v.currentTime
                  stuckSec = 0
                }
              })
              stallWatchdogRef.current = setInterval(() => {
                // 用户手动暂停 / 尚未起播:不监测
                if (!armed || v.paused) { stuckSec = 0; return }
                // readyState<3(数据不足)或时间戳停住:累计卡死秒数
                if (v.readyState < 3 || v.currentTime === lastTime) {
                  stuckSec++
                  if (stuckSec >= MID_STALL_LIMIT_SEC) {
                    // 冷却门控:距上次自动换线不足 15s 则继续等待(卡死计数保留,
                    // 冷却一到的下一秒立即触发),给新线路完整的起播/缓冲机会
                    if (lastAutoSwitchAtRef.current &&
                      Date.now() - lastAutoSwitchAtRef.current < AUTO_SWITCH_COOLDOWN_MS) {
                      return
                    }
                    if (stallWatchdogRef.current) {
                      clearInterval(stallWatchdogRef.current)
                      stallWatchdogRef.current = null
                    }
                    autoSwitchRef.current(src)
                  }
                } else {
                  stuckSec = 0
                }
              }, 1000)
            })

            // ---- 诊断:分片下载耗时(对比分片时长,判断网速能否追平直播产出)
            hls.on(Hls.Events.FRAG_LOADED, (_e, data) => {
              const stats = data.frag.stats
              const ms = Math.round(stats.loading.end - stats.loading.start)
              diag.fragsLoaded++
              diag.lastFragMs = ms
              diag.sumFragMs += ms
              if (ms > diag.maxFragMs) diag.maxFragMs = ms
            })

            hls.on(Hls.Events.ERROR, (_e, data) => {
              console.log('[Live] HLS error:', data.type, data.details, data.fatal)
              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    diag.netFatal++
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
                    diag.mediaFatal++
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

    // 次数上限:同一频道已自动换满 4 条线路仍不行,停止切换并提示手动处理
    if (autoSwitchRoundRef.current >= AUTO_SWITCH_MAX_ROUND) {
      setErrorType('play')
      setError('已自动尝试多条线路仍无法流畅播放，请手动换台或稍后再试')
      setPlayerLoading(false)
      return
    }

    // 找下一个未屏蔽的 URL
    const total = ch.urls.length
    for (let i = 1; i <= total; i++) {
      const nextIdx = (currentUrlIndexRef.current + i) % total
      const nextUrl = ch.urls[nextIdx]
      if (nextUrl && !blockedUrlsRef.current.has(nextUrl)) {
        setAutoSwitchMsg(`线路 ${currentUrlIndexRef.current + 1} 无法播放，自动切换到线路 ${nextIdx + 1}`)
        // 3秒后清除提示
        setTimeout(() => setAutoSwitchMsg(''), 3000)
        // 记录本轮自动换线:次数+1、刷新冷却计时起点
        autoSwitchRoundRef.current += 1
        lastAutoSwitchAtRef.current = Date.now()
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
    // 切换到不同频道:重置自动换线轮次/冷却/屏蔽表,新一轮计数从头开始
    if (lastChannelNameRef.current !== currentChannel.name) {
      lastChannelNameRef.current = currentChannel.name
      autoSwitchRoundRef.current = 0
      lastAutoSwitchAtRef.current = 0
      blockedUrlsRef.current.clear()
    }
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

  /** 用户手动切换线路(←→键)时调用:重置自动轮次/冷却,并清空屏蔽表,
   *  尊重用户的明确选择(即便该线路之前被自动判坏,也给一次重试机会) */
  const resetAutoSwitchCounters = useCallback(() => {
    autoSwitchRoundRef.current = 0
    lastAutoSwitchAtRef.current = 0
    blockedUrlsRef.current.clear()
  }, [])

  return { containerRef, autoSwitchMsg, blockedUrlsRef, pausePlayer, hlsRef, diagStatsRef, resetAutoSwitchCounters }
}
