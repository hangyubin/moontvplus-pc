/**
 * 直播页 — 影视仓风格
 *
 * 播放器全屏作为背景,左侧悬浮频道列表面板(点击/OK键呼出),
 * 底部信息条显示频道名/线路,自动隐藏。
 *
 * 操作:
 * - 点击播放器区域 / OK键 / Enter: 切换频道列表
 * - ↑↓: 上一个/下一个频道
 * - ←→: 上一线路/下一线路
 * - 数字键: 直接跳转到指定频道编号
 * - Back/Escape: 返回首页
 * - 搜索: 在频道列表中搜索频道名
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
import WindowControls from '../components/WindowControls'

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
 const [errorType, setErrorType] = useState<'load' | 'play'>('play')
 const [reloadKey, setReloadKey] = useState(0)

 /* ============ UI 状态 ============ */
 // 频道列表是否可见(默认隐藏,影视仓风格)
 const [panelVisible, setPanelVisible] = useState(false)
 // 侧边栏 Tab
 const [sidebarTab, setSidebarTab] = useState<'sources' | 'channels'>('channels')
 // 搜索
 const [search, setSearch] = useState('')
 // 折叠的频道子分组
 const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
 // 底部信息条可见性
 const [infoBarVisible, setInfoBarVisible] = useState(true)
 // 数字键输入缓冲
 const [channelNumber, setChannelNumber] = useState('')
 const [channelNumberVisible, setChannelNumberVisible] = useState(false)
 // 自动换线提示
 const [autoSwitchMsg, setAutoSwitchMsg] = useState('')

 /* ============ 播放器 ref ============ */
 const containerRef = useRef<HTMLDivElement>(null)
 const artRef = useRef<Artplayer | null>(null)
 const hlsRef = useRef<Hls | null>(null)
 // 自动重试计数器
 const retryCountRef = useRef(0)
 const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
 // HLS 网络错误恢复检测定时器(换台/卸载时需清理,避免 stale 回调触发误换线)
 const networkRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
 // 屏蔽的 URL 集合(本次会话内播放失败的 URL 不再重试)
 const blockedUrlsRef = useRef<Set<string>>(new Set())
 // 当前正在播放的 URL(用于错误回调中换线)
 const currentUrlRef = useRef<string>('')
 // 自动换线函数的 ref(避免 createPlayer 依赖循环)
 const autoSwitchRef = useRef<(url: string) => void>(() => {})

 /* ============ ref 镜像 ============ */
 const currentChannelRef = useRef<ChannelItem | null>(null)
 const currentUrlIndexRef = useRef(0)
 const currentSourceKeyRef = useRef('')
 const sourceDataListRef = useRef<SourceData[]>([])
 currentChannelRef.current = currentChannel
 currentUrlIndexRef.current = currentUrlIndex
 currentSourceKeyRef.current = currentSourceKey
 sourceDataListRef.current = sourceDataList

 /* ============ 频道列表滚动 ref ============ */
 const channelListRef = useRef<HTMLDivElement>(null)
 const currentChannelItemRef = useRef<HTMLButtonElement>(null)

 const toggleGroup = useCallback((key: string) => {
 setCollapsedGroups((prev) => {
 const next = new Set(prev)
 if (next.has(key)) next.delete(key)
 else next.add(key)
 return next
 })
 }, [])

 /* ============ 加载直播源列表 ============ */
 useEffect(() => {
 let cancelled = false
 setLoading(true)
 setError('')
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

 const memory = loadLiveMemory()
 const initialKey = memory
 ? (list.find((s) => s.key === memory.sourceKey)?.key || list[0]?.key || '')
 : (list[0]?.key || '')
 if (initialKey) {
 setCurrentSourceKey(initialKey)
 }
 })
 .catch((e: any) => {
 if (cancelled) return
 const status = e?.response?.status
 const serverMsg = e?.response?.data?.error || e?.response?.data?.message
 const detail = status ? `(${status}) ${serverMsg || e?.message || ''}` : (e?.message || '网络请求失败')
 setErrorType('load')
 setError(`加载直播源失败: ${detail}`)
 setLoading(false)
 })
 return () => { cancelled = true }
 }, [reloadKey])

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
 // 过滤掉 Update 分组(更新时间提醒,非真实频道)
 const group = (ch.group || '未分组').trim()
 if (group === 'Update' || group === '更新') continue
 // 过滤掉指向 127.0.0.1 的无效地址
 if (ch.url && ch.url.includes('127.0.0.1')) continue
 if (map.has(name)) {
 map.get(name)!.urls.push(ch.url)
 } else {
 map.set(name, {
 name,
 group,
 tvgLogo: ch.tvgLogo || ch.logo,
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

 const memory = loadLiveMemory()
 if (memory && memory.sourceKey === sourceKey) {
 const ch = items.find((c) => c.name === memory.channelName)
 if (ch) {
 const urlIdx = Math.max(0, Math.min(memory.urlIndex, ch.urls.length - 1))
 setCurrentSourceKey(sourceKey)
 setCurrentChannel(ch)
 setCurrentUrlIndex(urlIdx)
 return
 }
 }
 // 没有记忆或记忆失效,自动选第一个频道播放
 if (items.length > 0) {
 setCurrentSourceKey(sourceKey)
 setCurrentChannel(items[0])
 setCurrentUrlIndex(0)
 }
 } catch (e: any) {
 const status = e?.response?.status
 const serverMsg = e?.response?.data?.error || e?.response?.data?.message
 const detail = status ? `(${status}) ${serverMsg || e?.message || ''}` : (e?.message || '网络请求失败')
 const isTimeout = e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')
 setErrorType('load')
 setError(`加载频道失败${isTimeout ? '(超时,服务端可能在下载EPG节目单,请稍后重试)' : ''}: ${detail}`)
 }
 }, [])

 useEffect(() => {
 if (currentSourceKey && sourceDataList.length > 0) {
 const sd = sourceDataList.find((s) => s.source.key === currentSourceKey)
 if (sd && !sd.loaded) {
 loadSourceChannels(currentSourceKey)
 }
 }
 }, [currentSourceKey, sourceDataList, loadSourceChannels])

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

 const goBack = useCallback(() => {
 const art = artRef.current
 if (art && !art.isDestroy) {
 try { art.pause() } catch {}
 }
 navigate('/')
 }, [navigate])

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

 /* ============ 选中频道/切换 URL 后自动播放 + 保存记忆 ============ */

 // 自动跳到下一个未屏蔽的线路
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
  }, [])

 // 同步到 ref,供 createPlayer 中的 HLS 错误回调使用
 autoSwitchRef.current = autoSwitchToNextUrl

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
 }, [currentChannel, currentUrlIndex, currentSourceKey, destroyPlayer, createPlayer, autoSwitchToNextUrl])

 /* ============ 换线路 ============ */
 const switchUrl = useCallback((dir: 1 | -1) => {
 const ch = currentChannelRef.current
 if (!ch || ch.urls.length <= 1) return
 const idx = currentUrlIndexRef.current
 setCurrentUrlIndex((idx + dir + ch.urls.length) % ch.urls.length)
 }, [])

 /* ============ 换台(清空屏蔽列表,新频道重新尝试所有线路) ============ */
 const switchChannel = useCallback((dir: 1 | -1) => {
 const sd = sourceDataListRef.current.find((s) => s.source.key === currentSourceKeyRef.current)
 if (!sd || sd.channels.length === 0) return
 const ch = currentChannelRef.current
 if (!ch) { setCurrentChannel(sd.channels[0]); setCurrentUrlIndex(0); blockedUrlsRef.current.clear(); return }
 const idx = sd.channels.findIndex((c) => c.name === ch.name)
 if (idx === -1) { setCurrentChannel(sd.channels[0]); setCurrentUrlIndex(0); blockedUrlsRef.current.clear(); return }
 setCurrentChannel(sd.channels[(idx + dir + sd.channels.length) % sd.channels.length])
 setCurrentUrlIndex(0)
 blockedUrlsRef.current.clear()
 }, [])

 /* ============ 所有频道的平铺列表(用于数字键跳转) ============ */
 const allChannels = useMemo(() => {
 const sd = sourceDataList.find((s) => s.source.key === currentSourceKey)
 return sd?.channels || []
 }, [sourceDataList, currentSourceKey])

 const currentChannelIndex = useMemo(() => {
 if (!currentChannel) return -1
 return allChannels.findIndex((c) => c.name === currentChannel.name)
 }, [currentChannel, allChannels])

 /* ============ 底部信息条:频道切换时显示,3秒后自动隐藏 ============ */
 const [infoText, setInfoText] = useState('')
 useEffect(() => {
 if (!currentChannel) return
 const parts: string[] = [currentChannel.name]
 if (currentChannelIndex >= 0) parts.push(`${currentChannelIndex + 1}/${allChannels.length}`)
 if (currentChannel.urls.length > 1) parts.push(`线路 ${currentUrlIndex + 1}/${currentChannel.urls.length}`)
 setInfoText(parts.join(' · '))
 setInfoBarVisible(true)
 const timer = setTimeout(() => setInfoBarVisible(false), 3000)
 return () => clearTimeout(timer)
 }, [currentChannel, currentUrlIndex, currentChannelIndex, allChannels.length])

 /* ============ 自动滚动当前频道到可视区域 ============ */
 useEffect(() => {
 if (panelVisible && currentChannelItemRef.current) {
 currentChannelItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
 }
 }, [panelVisible, currentChannel])

 /* ============ 数字键输入 ============ */
 useEffect(() => {
 if (!channelNumber) return
 setChannelNumberVisible(true)
 const timer = setTimeout(() => {
 const num = parseInt(channelNumber, 10)
 if (num > 0 && num <= allChannels.length) {
 const ch = allChannels[num - 1]
 setCurrentChannel(ch)
 setCurrentUrlIndex(0)
 }
 setChannelNumber('')
 setChannelNumberVisible(false)
 }, 1500)
 return () => clearTimeout(timer)
 }, [channelNumber, allChannels])

 /* ============ 键盘控制 ============ */
 useEffect(() => {
 const handleKey = (e: KeyboardEvent) => {
 const tag = (e.target as HTMLElement)?.tagName
 const isInput = tag === 'INPUT' || tag === 'TEXTAREA'
 // 搜索框有内容时,方向键用于编辑,不拦截
 if (isInput && (e.target as HTMLInputElement)?.value) return

 // 上下方向键:即使焦点在空搜索框也允许切换频道
 if (isInput && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
 (e.target as HTMLElement).blur()
 }

 // 任何按键都重新显示信息条
 setInfoBarVisible(true)

 switch (e.key) {
 case 'ArrowLeft':
 e.preventDefault()
 switchUrl(-1)
 break
 case 'ArrowRight':
 e.preventDefault()
 switchUrl(1)
 break
 case 'ArrowUp':
 e.preventDefault()
 switchChannel(-1)
 break
 case 'ArrowDown':
 e.preventDefault()
 switchChannel(1)
 break
 case 'Enter':
 case ' ':
 e.preventDefault()
 setPanelVisible(v => !v)
 break
 case 'Escape':
 case 'Backspace':
 if (panelVisible) {
 e.preventDefault()
 setPanelVisible(false)
 } else if (e.key === 'Escape') {
 goBack()
 }
 break
 default:
 // 数字键 0-9
 if (e.key >= '0' && e.key <= '9') {
 e.preventDefault()
 setChannelNumber(prev => (prev + e.key).slice(-4))
 }
 break
 }
 }
 window.addEventListener('keydown', handleKey)
 return () => window.removeEventListener('keydown', handleKey)
 }, [switchUrl, switchChannel, panelVisible, goBack])

 /* ============ 选择频道 ============ */
 const handleSelectChannel = (sourceKey: string, ch: ChannelItem) => {
 setCurrentSourceKey(sourceKey)
 if (currentChannel && ch.name === currentChannel.name && currentSourceKey === sourceKey) {
 setPanelVisible(false)
 return
 }
 setCurrentChannel(ch)
 setCurrentUrlIndex(0)
 blockedUrlsRef.current.clear()
 setPanelVisible(false) // 选完后自动隐藏面板
 }

 /* ============ 选择直播源 ============ */
 const handleSelectSource = (sourceKey: string) => {
 setCurrentSourceKey(sourceKey)
 setSidebarTab('channels')
 }

 /* ============ 播放器区域点击 ============ */
 const handlePlayerClick = useCallback(() => {
 setPanelVisible(v => !v)
 }, [])

 /* ============ 当前源信息 ============ */
 const currentSourceName = useMemo(() => {
 const sd = sourceDataList.find((s) => s.source.key === currentSourceKey)
 return sd?.source.name || ''
 }, [sourceDataList, currentSourceKey])

 const currentChannelName = currentChannel?.name || ''

 /* ============ 过滤后的直播源列表 ============ */
 const filteredSources = useMemo(() => {
 if (!search.trim()) return sourceDataList
 const q = search.trim().toLowerCase()
 return sourceDataList.filter((sd) => sd.source.name.toLowerCase().includes(q))
 }, [sourceDataList, search])

 /* ============ 当前源的频道 ============ */
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
 <div className="fixed inset-0 bg-black text-white overflow-hidden select-none dark-lock">
 {/* ============ 播放器全屏背景 ============ */}
 <div
 className="absolute inset-0"
 onClick={handlePlayerClick}
 >
 {/* 播放器容器:始终渲染,确保 ref 可用 */}
 <div className="absolute inset-0" ref={containerRef} />

 {/* 覆盖层:loading / 空状态 / 错误 */}
 {loading ? (
 <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black">
 <div className="spinner spinner-lg" />
		<p className="text-white/50 text-sm">加载直播源...</p>
 </div>
 ) : sourceDataList.length === 0 && !error ? (
 <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black">
 <div className="w-20 h-20 bg-white/5 flex items-center justify-center" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
 <svg className="w-10 h-10 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z" />
 </svg>
 </div>
 <div className="text-center">
 <p className="text-white/80 text-lg font-medium">暂无直播源</p>
 <p className="text-white/40 text-sm mt-2">请在服务端管理后台添加直播源</p>
 </div>
 </div>
 ) : !currentChannel && !error ? (
 <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black">
 <div className="w-20 h-20 bg-white/5 flex items-center justify-center" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
 <svg className="w-10 h-10 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z" />
 </svg>
 </div>
 <div className="text-center">
 <p className="text-white/80 text-lg font-medium">点击屏幕选择频道</p>
 <p className="text-white/40 text-sm mt-2">↑↓ 换台 · ←→ 换线路 · 数字键跳转</p>
 </div>
 </div>
 ) : error ? (
 <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 text-center bg-black">
 <div className="w-16 h-16 bg-red-500/10 flex items-center justify-center">
 <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
 </svg>
 </div>
 <div>
 <p className="text-white/80 text-base font-medium">{errorType === 'load' ? '加载失败' : '播放失败'}</p>
 <p className="text-white/40 text-sm mt-2 max-w-md">{error}</p>
 </div>
 <div className="flex gap-3">
 {errorType === 'load' ? (
 <button
 onClick={(e) => { e.stopPropagation(); setError(''); setReloadKey(k => k + 1) }}
 className="btn-primary"
			>
				重新加载
 </button>
 ) : (
 <>
 {currentChannel && currentChannel.urls.length > 1 && (
 <button onClick={(e) => { e.stopPropagation(); switchUrl(1) }} className="btn-primary">
 切换下一线路
 </button>
 )}
 <button
 onClick={(e) => {
 e.stopPropagation()
 setError('')
 const ch = currentChannel, idx = currentUrlIndex
 setCurrentChannel(null)
 setTimeout(() => { setCurrentChannel(ch); setCurrentUrlIndex(idx) }, 0)
 }}
 className="btn-ghost"
			>
				重试
 </button>
 </>
 )}
 </div>
 </div>
 ) : playerLoading ? (
 <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 pointer-events-none">
 <div className="spinner spinner-lg" />
		<p className="text-white/50 text-sm">
			正在加载直播流...
 {currentChannel && currentChannel.urls.length > 1 && (
 <span className="text-white/50 ml-1">（线路 {currentUrlIndex + 1}/{currentChannel.urls.length}）</span>
 )}
 </p>
 </div>
 ) : null}

 {/* 自动换线提示 */}
 {autoSwitchMsg && (
 <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-2 bg-black/85 backdrop-blur-sm border border-primary/30 shadow-lg animate-fadeIn">
 <div className="flex items-center gap-2 text-sm text-white">
 <svg className="w-4 h-4 text-primary animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
 </svg>
 {autoSwitchMsg}
 </div>
 </div>
 )}
 </div>

 {/* ============ 顶部栏(固定) ============ */}
 <header
 className="absolute top-0 left-0 right-0 h-10 flex items-stretch justify-between pl-4 pr-0 z-30"
 style={{
 background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)',
 WebkitAppRegion: 'drag',
 } as React.CSSProperties}
 >
 <div className="flex items-center gap-3 min-w-0 self-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
 <button
 onClick={(e) => { e.stopPropagation(); goBack() }}
 className="flex items-center gap-1.5 px-2 py-1 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-all duration-150 rounded"
 >
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
 <span>返回</span>
 </button>
 <div className="h-4 w-px bg-white/10" />
 <div className="w-7 h-7 bg-white/5 flex items-center justify-center" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
 <svg className="w-3.5 h-3.5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z" />
 </svg>
 </div>
 <span className="text-sm font-medium text-white">{currentSourceName || '直播'}</span>
 {currentChannel && (
 <>
 <span className="text-white/30">/</span>
 <span className="text-sm text-white/70 truncate max-w-[200px]">{currentChannel.name}</span>
 </>
 )}
 </div>

 <div className="flex items-center gap-3 text-xs text-[var(--color-text-tertiary)] self-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
 {currentChannel && (
 <span className="flex items-center gap-1.5 text-red-400">
 <span className="w-1.5 h-1.5 bg-red-500 animate-pulse" />LIVE
 </span>
 )}
 <div className="w-px h-4 bg-white/10" />
 </div>
 <WindowControls />
 </header>

 {/* ============ 数字键输入提示 ============ */}
 {channelNumberVisible && (
 <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none">
 <div className="bg-black/80 backdrop-blur-md px-8 py-4 text-center">
 <p className="text-white/40 text-xs mb-1">输入频道号</p>
 <p className="text-white text-4xl font-bold tracking-wider">{channelNumber}</p>
 </div>
 </div>
 )}

 {/* ============ 左侧悬浮频道面板 ============ */}
 {panelVisible && (
 <aside
 className="absolute left-0 top-0 bottom-0 w-[320px] z-20 flex flex-col animate-slideInLeft pt-10"
 style={{
 background: 'rgba(10, 10, 10, 0.7)',
 backdropFilter: 'blur(20px) saturate(180%)',
 WebkitBackdropFilter: 'blur(20px) saturate(180%)',
 borderRight: '1px solid rgba(255,255,255,0.08)',
 }}
 onClick={(e) => e.stopPropagation()}
 >
 {/* Tab 切换 */}
 <div className="flex border-b border-white/[0.06]">
 <button
 onClick={() => setSidebarTab('channels')}
 className={`flex-1 py-2.5 text-sm font-medium transition-all relative ${
 sidebarTab === 'channels' ? 'text-primary' : 'text-white/40 hover:text-white/70'
 }`}
 >
 频道
 {sidebarTab === 'channels' && (
 <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary" />
 )}
 </button>
 <button
 onClick={() => setSidebarTab('sources')}
 className={`flex-1 py-2.5 text-sm font-medium transition-all relative ${
 sidebarTab === 'sources' ? 'text-primary' : 'text-white/40 hover:text-white/70'
 }`}
 >
 直播源
 {sidebarTab === 'sources' && (
 <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary" />
 )}
 </button>
 </div>

 {/* 搜索框 */}
 <div className="p-2.5 border-b border-white/[0.06]">
 <div className="relative group">
 <input
 type="text"
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder={sidebarTab === 'sources' ? '搜索直播源...' : '搜索频道...'}
 className="w-full border border-white/10 px-3 py-1.5 pl-8 text-sm text-white placeholder-white/40 focus:outline-none focus:border-primary/50 transition-all rounded"
 style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
 autoFocus
 />
 <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
 </svg>
 {search && (
 <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all">✕</button>
 )}
 </div>
 </div>

 {/* 内容区域 */}
 <div ref={channelListRef} className="flex-1 overflow-y-auto scrollbar-thin">
 {sidebarTab === 'sources' ? (
 /* === 直播源列表 === */
 filteredSources.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
 <p className="text-white/40 text-sm">{search ? '未找到匹配直播源' : '暂无直播源'}</p>
 </div>
 ) : (
 <div className="p-1.5 space-y-0.5">
 {filteredSources.map((sd) => {
 const isCurrent = currentSourceKey === sd.source.key
 return (
 <button
 key={sd.source.key}
 onClick={() => handleSelectSource(sd.source.key)}
 className={`w-full text-left flex items-center gap-2.5 px-2.5 py-2 transition-all duration-200 ${
 isCurrent ? 'bg-primary/15' : 'hover:bg-white/5'
 }`}
 >
 <div className="w-8 h-8 bg-white/5 flex items-center justify-center flex-shrink-0" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
 <svg className={`w-4 h-4 ${isCurrent ? 'text-primary' : 'text-white/40'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z" />
 </svg>
 </div>
 <div className="flex-1 min-w-0">
 <p className={`text-sm truncate ${isCurrent ? 'text-primary font-medium' : 'text-white/80'}`}>{sd.source.name}</p>
 <p className="text-xs text-white/30 mt-0.5">
 {sd.loaded ? `${sd.channels.length} 个频道` : '点击加载'}
 </p>
 </div>
 {isCurrent && <span className="w-1.5 h-1.5 bg-primary flex-shrink-0" />}
 </button>
 )
 })}
 </div>
 )
 ) : (
 /* === 频道列表 === */
 !currentSourceKey ? (
 <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
 <p className="text-white/40 text-sm">请先选择直播源</p>
 <button onClick={() => setSidebarTab('sources')} className="text-xs text-primary hover:underline">选择直播源</button>
 </div>
 ) : !currentSourceData?.loaded ? (
 <div className="flex items-center justify-center py-12">
 <div className="spinner spinner-sm" />
 </div>
 ) : currentGroupNames.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
 <p className="text-white/40 text-sm">{search ? '未找到匹配频道' : '暂无频道'}</p>
 </div>
 ) : (
 <div className="pb-2">
 {currentGroupNames.map((group) => {
 const groupCollapsed = collapsedGroups.has(group)
 return (
 <div key={group} className="mb-0.5">
 <button
 onClick={() => toggleGroup(group)}
 className="sticky top-0 z-10 w-full px-3 py-1.5 flex items-center justify-between hover:bg-white/5 transition-colors"
 style={{ background: 'rgba(10, 10, 10, 0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
 >
 <div className="flex items-center gap-1.5 min-w-0">
 <svg className={`w-3 h-3 text-white/40 flex-shrink-0 transition-transform ${groupCollapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
 <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
 </svg>
 <span className="text-xs font-medium text-white/50 tracking-wide truncate">{group}</span>
 </div>
 <span className="text-xs text-white/25 flex-shrink-0 ml-2 tabular-nums">{currentGroupedChannels[group].length}</span>
 </button>
 {!groupCollapsed && (
 <div className="px-1.5 space-y-0.5">
 {currentGroupedChannels[group].map((ch, idx) => {
  const isCurrent = ch.name === currentChannelName
  return (
    <button
      key={`${group}-${idx}-${ch.name}`}
      ref={isCurrent ? currentChannelItemRef : null}
      onClick={() => handleSelectChannel(currentSourceKey, ch)}
      className={`w-full text-left flex items-center gap-2 px-2 py-2 transition-all duration-200 group ${
        isCurrent ? 'bg-primary/20' : 'hover:bg-white/5'
      }`}
    >
      {/* Logo (无外框,透明背景) */}
      <div className={`w-9 h-9 overflow-hidden flex-shrink-0 flex items-center justify-center transition-opacity duration-200 ${isCurrent ? 'opacity-100' : 'opacity-80 group-hover:opacity-100'}`}>
        {ch.tvgLogo ? (
          <SmartImage src={processImageUrl(ch.tvgLogo)} alt={ch.name} className="w-full h-full" objectFit="contain" />
        ) : (
          <span className="text-white/50 text-sm font-medium">{ch.name.slice(0, 1)}</span>
        )}
      </div>
 {/* 频道名 + 分组标签 */}
 <div className="flex-1 min-w-0">
 <span className={`block text-sm truncate ${isCurrent ? 'text-white font-medium' : 'text-white/80 group-hover:text-white'}`}>
 {ch.name}
 </span>
 <span className="block text-[10px] text-white/40 truncate mt-0.5">{group}</span>
 </div>
 {/* 线路数 */}
{ch.urls.length > 1 && (
  <span className="text-[10px] text-white/50 flex-shrink-0 px-1.5 py-0.5 border border-white/10">{ch.urls.length}线路</span>
)}
 {/* 当前播放标记 */}
 {isCurrent && <span className="w-1.5 h-1.5 bg-primary animate-pulse flex-shrink-0" />}
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

 {/* 底部提示 */}
 <div className="px-3 py-2 border-t border-white/[0.06] text-xs text-white/25 flex items-center justify-between">
 <span>↑↓ 换台 · ←→ 换线</span>
 <span className="tabular-nums">{allChannels.length} 个频道</span>
 </div>
 </aside>
 )}

 {/* ============ 底部信息条(悬浮,自动隐藏) ============ */}
 {currentChannel && !panelVisible && (
 <div
 className={`absolute bottom-0 left-0 right-0 z-30 transition-all duration-300 ${
 infoBarVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
 }`}
 style={{
 background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 60%, transparent 100%)',
 }}
 >
 <div className="flex items-center justify-between px-6 py-4">
 {/* 左:频道信息 */}
 <div className="flex items-center gap-3 min-w-0">
 {currentChannel.tvgLogo && (
  <div className="w-10 h-10 overflow-hidden flex items-center justify-center flex-shrink-0">
    <SmartImage src={processImageUrl(currentChannel.tvgLogo)} alt={currentChannel.name} className="w-full h-full" objectFit="contain" />
  </div>
)}
 <div className="min-w-0">
 <div className="flex items-center gap-2">
 <span className="text-white text-base font-medium truncate drop-shadow">{currentChannel.name}</span>
 {currentChannelIndex >= 0 && (
 <span className="text-xs text-white/50 tabular-nums">{currentChannelIndex + 1}/{allChannels.length}</span>
 )}
 </div>
 <div className="flex items-center gap-2 mt-0.5">
 <span className="text-xs text-white/40">{currentSourceName}</span>
 {currentChannel.group && (
 <>
 <span className="text-white/20">|</span>
 <span className="text-xs text-white/40">{currentChannel.group}</span>
 </>
 )}
 </div>
 </div>
 </div>

 {/* 右:线路切换 + 操作提示 */}
 <div className="flex items-center gap-3 flex-shrink-0">
 {currentChannel.urls.length > 1 && (
 <div className="flex items-center gap-1 px-2 py-1 bg-white/5 border border-white/10 rounded">
 <button onClick={(e) => { e.stopPropagation(); switchUrl(-1) }} className="w-7 h-7 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all" title="上一线路 (←)">
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
 </button>
 <span className="text-xs text-white/80 min-w-[70px] text-center font-medium tabular-nums">线路 {currentUrlIndex + 1}/{currentChannel.urls.length}</span>
 <button onClick={(e) => { e.stopPropagation(); switchUrl(1) }} className="w-7 h-7 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all" title="下一线路 (→)">
 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
 </button>
 </div>
 )}
 <span className="text-xs text-white/30">点击屏幕或按 Enter 切换列表</span>
 </div>
 </div>
 </div>
 )}

 </div>
 )
}
