/**
 * 播放页(全屏,无侧边栏)
 * 使用 Artplayer + hls.js 播放 m3u8 流
 * 功能:进度恢复、进度上报、自由选集、换源
 * 路由参数:source, id, title, index(0 基集数,默认 0)
 */
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import Artplayer from 'artplayer'
import Hls from 'hls.js'
import { getDetail, resolvePlayUrl, searchStream, prepareCustomVideoPlay, needsCustomStreamResolve, resolveCustomStreamUrl } from '../lib/api'
import { processImageUrl } from '../lib/image'
import { getDetailWithCache, cacheSearchResults, findSourcesByTitle } from '../lib/searchCache'
import { useStore } from '../lib/store'
import { generateStorageKey, type PlayRecord, type SearchResult, type SearchSSEEvent } from '../types'
import WindowControls from '../components/WindowControls'
import Icon from '../components/Icon'

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
 const hlsRef = useRef<Hls | null>(null)

 const [detail, setDetail] = useState<SearchResult | null>(null)
 const [loading, setLoading] = useState(true)
 const [error, setError] = useState('')
 const [noEpisode, setNoEpisode] = useState(false)
 // 自定义源中转页(短剧 /share/xxx 等)解析出的真实流地址,key 随 source/id/集数/原始URL 变化
 const [resolvedStream, setResolvedStream] = useState<{ key: string; url: string } | null>(null)
 // 中转页解析中遮罩(独立于 loading:不能用 loading,否则会卸载播放器容器导致 ref 丢失)
 const [resolvingStream, setResolvingStream] = useState(false)
 const resolveSeqRef = useRef(0)

 // 侧边面板状态
 const [panel, setPanel] = useState<PanelType>('detail')

 // 开灯/关灯模式已移除

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
 // detail API 失败(如500)时自动重试一次,仍失败则降级到标题搜索
 useEffect(() => {
 let cancelled = false
 let streamHandle: { cancel: () => void; done: Promise<void> } | null = null
 let retryTimer: ReturnType<typeof setTimeout> | null = null
 // 立即清空旧 detail,防止播放器 effect 用旧 detail + 新 source 创建错误播放器
 setDetail(null)
 setLoading(true)
 setError('')
 setNoEpisode(false)
 setResolvedStream(null)
 setResolvingStream(false)
 resolveSeqRef.current++

 // 标题搜索降级:detail API 失败或返回空 episodes 时,通过搜索获取可用源
 const fallbackToSearch = (fallbackDetail: SearchResult | null) => {
 if (cancelled) return
 if (!title) {
 setDetail(fallbackDetail)
 setLoading(false)
 return
 }
 const onEvent = (e: SearchSSEEvent) => {
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
 return fallbackDetail
 })
 setLoading(false)
 }
 }
 streamHandle = searchStream(title, onEvent, false)
 }

 // 尝试获取详情,失败时重试一次,仍失败则降级到标题搜索
 const tryFetchDetail = (isRetry: boolean) => {
 getDetailWithCache(source, id, getDetail)
 .then((res) => {
 if (cancelled) return
 // 如果 API 返回有 episodes,直接使用
 if (res && res.episodes && res.episodes.length > 0) {
 setDetail(res)
 setLoading(false)
 return
 }
 // API 返回空 episodes:降级到标题搜索
 fallbackToSearch(res)
 })
 .catch((e) => {
 if (cancelled) return
 if (!isRetry && title) {
 // 首次失败:等待 1.5s 后重试(服务端可能正在初始化源)
 retryTimer = setTimeout(() => tryFetchDetail(true), 1500)
 } else if (title) {
 // 重试仍失败:降级到标题搜索
 fallbackToSearch(null)
 } else {
 // 无标题无法搜索,直接报错
 setError((e as Error)?.message || '加载详情失败')
 setLoading(false)
 }
 })
 }

 tryFetchDetail(false)

 return () => {
 cancelled = true
 streamHandle?.cancel()
 if (retryTimer) clearTimeout(retryTimer)
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
 const onEvent = (e: SearchSSEEvent) => {
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

 /** 同步销毁播放器和 HLS 实例(防止后台音频继续播放) */
 const destroyPlayerSync = useCallback(() => {
 const art = artRef.current
 const hls = hlsRef.current
 artRef.current = null
 hlsRef.current = null
 if (art && !art.isDestroy) {
 try { art.pause() } catch {}
 try {
 if (document.fullscreenElement) document.exitFullscreen?.()
 const video = art.template?.$video
 if (video) {
 video.pause()
 video.removeAttribute('src')
 video.load()
 }
 } catch {}
 try { art.destroy(true) } catch {}
 }
 if (hls) { try { hls.destroy() } catch {} }
 if (containerRef.current) {
 containerRef.current.innerHTML = ''
 }
 }, [])

 // 组件卸载时同步销毁播放器(防止后台音频继续播放)
 useEffect(() => {
 return () => { destroyPlayerSync() }
 }, [destroyPlayerSync])

 // 返回:同步销毁播放器后导航
 const goBack = useCallback(() => {
 destroyPlayerSync()
 if (window.history.length > 1) navigate(-1)
 else navigate('/')
 }, [navigate, destroyPlayerSync])

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
 const rawUrl0 = episodes[curIndex]
 if (!rawUrl0) return
 let rawUrl = rawUrl0
 // 自定义源中转页(短剧常见,如 /share/{id} 返回 HTML,真实 m3u8 在页面 JS 里):
 // 先异步抓取解析出真实流地址,解析完成 setState 触发本 effect 重跑后再创建播放器
 if (needsCustomStreamResolve(rawUrl0)) {
 const rk = `${source}|${id}|${curIndex}|${rawUrl0}`
 if (resolvedStream && resolvedStream.key === rk) {
 rawUrl = resolvedStream.url
 setResolvingStream(false)
 } else {
 // 注意:不调用 setLoading(true) —— 那会卸载播放器容器使 containerRef 失效。
 // 容器保持挂载,用 resolvingStream 遮罩提示,解析完成后本 effect 重跑创建播放器。
 setResolvingStream(true)
 const seq = ++resolveSeqRef.current
 void resolveCustomStreamUrl(rawUrl0).then((u) => {
 // 仅最新一次解析允许回写,防止切集/换源竞态写入旧地址
 if (seq === resolveSeqRef.current) {
 setResolvedStream({ key: rk, url: u })
 setResolvingStream(false)
 }
 })
 return // 等解析完成 effect 重跑
 }
 } else {
 setResolvingStream(false)
 }
 // 自定义源:播放前向主进程注册该 m3u8 域名的防盗链 Referer/UA(等效服务端代理)
 // 源列表此刻已内存缓存,注册在当前微任务链完成,早于 HLS.js 发起的 m3u8 请求
 void prepareCustomVideoPlay(rawUrl, source)
 const playUrl = resolvePlayUrl(rawUrl, source, detail.proxyMode)
 if (!playUrl) return
 console.log('[PlayDBG] start play:', {
 source, id, proxyMode: detail.proxyMode,
 episodes: episodes.length, index: curIndex,
 hls: isHlsStream(playUrl), hlsSupported: Hls.isSupported(),
 nativeHls: (() => { const v = document.createElement('video'); return v.canPlayType('application/vnd.apple.mpegurl') })(),
 url: playUrl.substring(0, 100),
 })

 // 同步销毁旧实例(切换集数时必须同步销毁,否则旧 DOM 残留导致黑屏)
 if (artRef.current && !artRef.current.isDestroy) {
 try {
 artRef.current.pause()
 const oldVideo = artRef.current.template?.$video
 if (oldVideo) {
 oldVideo.pause()
 oldVideo.removeAttribute('src')
 oldVideo.load()
 }
 artRef.current.destroy(true)
 } catch {}
 artRef.current = null
 }
 if (hlsRef.current) {
 try { hlsRef.current.destroy() } catch {}
 hlsRef.current = null
 }
 // 清空容器内残留 DOM(防止旧播放器 DOM 干扰新播放器)
 if (containerRef.current) {
 containerRef.current.innerHTML = ''
 }

 const hls = isHlsStream(playUrl)
 const capturedIndex = curIndex

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
 pip: false,
 fullscreen: true,
 fullscreenWeb: false,
 miniProgressBar: false,
 mutex: true,
 backdrop: true,
 playsInline: true,
 theme: getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#e50914',
 lang: 'zh-cn',
 customType: hls
 ? {
 m3u8: async (video: HTMLVideoElement, url: string) => {
 // Electron(Chromium) 必须优先 hls.js:桌面 Chromium 不支持原生 HLS,
 // 但其 canPlayType('application/vnd.apple.mpegurl') 可能返回 'maybe'(truthy),
 // 若先判原生会错误走 video.src 导致空白。仅 Safari 用原生。
 if (Hls.isSupported()) {
 const inst = new Hls({ enableWorker: true })
 hlsRef.current = inst
 let netRetries = 0
 inst.on(Hls.Events.ERROR, (_evt: unknown, data: { type?: string; details?: string; fatal?: boolean; url?: string; reason?: string }) => {
 if (!data.fatal) {
 console.warn('[PlayDBG] hls non-fatal:', data.type, data.details)
 return
 }
 console.error('[PlayDBG] hls fatal:', data.type, data.details, data.url || '')
 // 致命错误自动恢复:网络错误重新加载,媒体错误重建解码器;限制次数防死循环
 if (data.type === Hls.ErrorTypes.NETWORK_ERROR && netRetries < 4) {
 netRetries++
 console.warn(`[PlayDBG] network retry ${netRetries}`)
 try { inst.startLoad() } catch {}
 } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
 console.warn('[PlayDBG] recoverMediaError')
 try { inst.recoverMediaError() } catch {}
 }
 })
 // 先确保防盗链 Referer/UA 已注入主进程(首次需拉源列表,可能耗时),
 // 再发起 m3u8 请求,避免首个请求因缺 Referer 被 403 导致首播失败
 try { await prepareCustomVideoPlay(rawUrl, source) } catch {}
 inst.attachMedia(video)
 inst.loadSource(url)
 } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
 video.src = url
 } else {
 console.error('[PlayDBG] no HLS engine available')
 }
 }
 }
 : undefined
 })

 artRef.current = art
 // 播放器壳子已创建(中转页解析等待时显示过 loading),关闭全屏加载态
 setLoading(false)

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

 // 自动播放下一集
 art.on('video:ended', () => {
 saveProgress()
 if (capturedIndex < episodes.length - 1) {
 const nextIndex = capturedIndex + 1
 setSearchParams((prev) => {
 const p = new URLSearchParams(prev)
 p.set('index', String(nextIndex))
 return p
 }, { replace: true })
 }
 })

 return () => {
 // 先保存进度(此时 art.currentTime 和 duration 仍有效)
 saveProgress()
 // 清除 seek 重试定时器
 seekTimers.forEach(clearTimeout)
 // 同步销毁播放器和 HLS(防止旧实例残留导致黑屏/后台音频)
 if (art && !art.isDestroy) {
 try { art.pause() } catch {}
 try {
 const video = art.template?.$video
 if (video) {
 video.pause()
 video.removeAttribute('src')
 video.load()
 }
 } catch {}
 try { art.destroy(true) } catch {}
 }
 if (hlsRef.current) {
 try { hlsRef.current.destroy() } catch {}
 hlsRef.current = null
 }
 artRef.current = null
 }
 // title 通过 stateRef 在 saveProgress 中读取,不作为重建依赖
 }, [detail, index, source, id, upsertPlayRecord, resolvedStream])

 const episodes = detail?.episodes || []
 const total = episodes.length
 const curIdx = Math.min(index, Math.max(0, total - 1))
 const hasPrev = curIdx > 0
 const hasNext = curIdx < total - 1

 // 集标题
 const episodeTitle = (i: number) => detail?.episodes_titles?.[i] || `第${i + 1}集`

 // 切换集数:更新 URL index(replace 模式,避免污染历史记录)
 const switchEpisode = (delta: number) => {
 const next = curIdx + delta
 if (next < 0 || next >= total) return
 setSearchParams((prev) => {
 const p = new URLSearchParams(prev)
 p.set('index', String(next))
 return p
 }, { replace: true })
 }

 // 直接跳转到指定集(replace 模式)
 const jumpToEpisode = (ep: number) => {
 if (ep < 0 || ep >= total) return
 setSearchParams((prev) => {
 const p = new URLSearchParams(prev)
 p.set('index', String(ep))
 return p
 }, { replace: true })
 setPanel('none')
 }

 // 换源:同步销毁旧播放器后跳转到另一个源
 // replace 模式:避免污染历史记录,保证返回按钮能直接回到详情页(上一级)
 const switchSource = (newSource: string, newId: string) => {
 destroyPlayerSync()
 setSearchParams((prev) => {
 const p = new URLSearchParams(prev)
 p.set('source', newSource)
 p.set('id', newId)
 p.set('index', '0')
 return p
 }, { replace: true })
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
 {/* ============ 顶部栏(可拖拽移动窗口) ============ */}
 <header
 className="h-10 flex-shrink-0 flex items-stretch justify-between pl-4 pr-0 border-b border-[var(--color-border-subtle)]"
 style={{
 WebkitAppRegion: 'drag',
 background: 'linear-gradient(to bottom, var(--color-app-bg-deep), transparent)'
 } as React.CSSProperties}
 >
 {/* 左:返回按钮 + 标题信息 */}
 <div className="flex items-stretch gap-3 min-w-0 h-full" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
 <button
 onClick={goBack}
 className="flex items-center gap-1.5 px-3 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] bg-[var(--color-hover-overlay)] hover:bg-[var(--color-hover-overlay-strong)] transition-all flex-shrink-0 group rounded"
 >
 <Icon name="chevron-left" size={16} className="transition-transform group-hover:-translate-x-0.5" />
 <span>返回</span>
 </button>
 {/* 分隔线 */}
 <div className="w-px bg-[var(--color-hover-overlay)] flex-shrink-0 self-center" style={{ height: '24px' }} />
 {/* 标题 */}
 <div className="min-w-0 self-center">
 <div className="text-sm font-medium text-white truncate max-w-[220px]">{title}</div>
 <div className="text-xs text-[var(--color-text-tertiary)] truncate flex items-center gap-1.5">
 {detail?.source_name || source}
 {detail?.year && detail.year !== 'unknown' && (
 <>
 <span className="text-gray-700">·</span>
 <span>{detail.year}</span>
 </>
 )}
 </div>
 </div>
 </div>

 {/* 中:集数切换 */}
 {total > 0 && (
 <div className="flex items-stretch gap-1 bg-[var(--color-hover-overlay-subtle)] p-1 self-stretch" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
 <button
 onClick={() => switchEpisode(-1)}
 disabled={!hasPrev}
 className="w-8 flex items-center justify-center hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)] disabled:opacity-20 disabled:cursor-not-allowed transition-all duration-150 rounded"
title="上一集"
 >
 <Icon name="chevron-left" size={16} strokeWidth={2.5} />
 </button>
 <span className="flex items-center text-sm text-[var(--color-text-primary)] min-w-[150px] justify-center">
 <span className="text-white font-medium">{episodeTitle(curIdx)}</span>
 <span className="text-[var(--color-text-quaternary)] ml-2 text-xs">{curIdx + 1}/{total}</span>
 </span>
 <button
 onClick={() => switchEpisode(1)}
 disabled={!hasNext}
 className="w-8 flex items-center justify-center hover:bg-[var(--color-hover-overlay)] hover:text-[var(--color-text-primary)] disabled:opacity-20 disabled:cursor-not-allowed transition-all duration-150 rounded"
title="下一集"
 >
 <Icon name="chevron-right" size={16} strokeWidth={2.5} />
 </button>
 </div>
 )}

 {/* 右:功能按钮 + 窗口控制 */}
 <div className="flex items-stretch gap-2.5 flex-shrink-0 self-stretch" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
 {/* 面板切换按钮组 */}
 {total > 0 && (
 <button
 onClick={() => setPanel(panel === 'episodes' ? 'none' : 'episodes')}
 className={`flex items-center gap-1.5 px-2.5 text-sm transition-all duration-150 rounded ${
 panel === 'episodes'
 ? 'bg-primary text-white'
 : 'bg-[var(--color-hover-overlay-subtle)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay)]'
 }`}
 >
 <Icon name="grid" size={16} />
 选集
 </button>
 )}
 <button
 onClick={() => setPanel(panel === 'sources' ? 'none' : 'sources')}
className={`flex items-center gap-1.5 px-2.5 text-sm transition-all duration-150 rounded ${
 panel === 'sources'
 ? 'bg-primary text-white'
 : 'bg-[var(--color-hover-overlay-subtle)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay)]'
 }`}
 >
 <Icon name="menu" size={16} />
 换源
 {sourceList.length > 1 && (
 <span className="text-[10px] bg-white/20 px-1.5 py-0.5 leading-none rounded">{sourceList.length}</span>
 )}
 </button>
 <button
 onClick={() => setPanel(panel === 'detail' ? 'none' : 'detail')}
className={`flex items-center gap-1.5 px-2.5 text-sm transition-all duration-150 rounded ${
 panel === 'detail'
 ? 'bg-primary text-white'
 : 'bg-[var(--color-hover-overlay-subtle)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay)]'
 }`}
 >
 <Icon name="help" size={16} />
 详情
 </button>
 {/* 分隔线 */}
 <div className="w-px bg-[var(--color-hover-overlay)] mx-0.5 self-center" style={{ height: '20px' }} />
 <WindowControls />
 </div>
 </header>

 {/* ============ 主区域:播放器 + 侧边面板 ============ */}
 <div className="flex-1 flex min-h-0 relative">
 {/* 播放器区域 */}
 <div className="flex-1 flex items-center justify-center min-h-0 relative">
 {loading ? (
 <div className="flex flex-col items-center gap-5">
 <div className="spinner spinner-lg" />
 <div className="text-center">
 <p className="text-[var(--color-text-primary)] text-sm font-medium">正在加载视频</p>
 <p className="text-[var(--color-text-quaternary)] text-xs mt-1">正在获取播放资源,请稍候...</p>
 </div>
 </div>
 ) : error ? (
 <div className="flex flex-col items-center gap-5 max-w-sm text-center">
 <div className="w-16 h-16 bg-red-500/10 flex items-center justify-center ring-1 ring-red-500/20">
 <Icon name="info" size={32} strokeWidth={1.5} className="text-red-400" />
 </div>
 <div>
 <p className="text-[var(--color-text-primary)] text-base font-medium">加载失败</p>
 <p className="text-[var(--color-text-tertiary)] text-sm mt-1.5 leading-relaxed">{error}</p>
 </div>
 <button
 onClick={() => navigate(-1)}
 className="flex items-center gap-1.5 px-5 py-2.5 bg-[var(--color-hover-overlay-strong)] text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay-strong)] transition-all rounded"
 >
 <Icon name="chevron-left" size={16} />
 返回
 </button>
 </div>
 ) : noEpisode ? (
 <div className="flex flex-col items-center gap-5 max-w-md text-center">
 <div className="w-20 h-20 bg-gradient-to-br from-primary/20 to-red-700/10 flex items-center justify-center ring-1 ring-primary/20">
 <Icon name="film" size={64} strokeWidth={1.2} className="mx-auto mb-4 text-[var(--color-text-quaternary)] opacity-40" />
 </div>
 <div>
 <p className="text-[var(--color-text-primary)] text-lg font-medium">该资源暂无播放地址</p>
 <p className="text-[var(--color-text-tertiary)] text-sm mt-2 leading-relaxed">
 详情数据已获取,但未解析到有效的视频流地址。<br />请尝试切换其他资源源。
 </p>
 </div>
 <div className="flex gap-3">
 {sourceList.length > 1 && (
 <button
 onClick={() => setPanel('sources')}
 className="btn-primary flex items-center gap-1.5"
 >
 <Icon name="menu" size={16} />
 换个源试试
 </button>
 )}
 <button
 onClick={() => navigate(-1)}
 className="px-5 py-2.5 bg-[var(--color-hover-overlay-strong)] text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay-strong)] transition-all rounded"
 >
 返回详情
 </button>
 </div>
 </div>
 ) : (
 <div className="relative w-full h-full">
 <div
          className="w-full h-full bg-black overflow-hidden shadow-2xl ring-1 ring-[var(--color-border-subtle)] dark-lock"
          ref={containerRef}
        />
 {resolvingStream && (
 <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black/70">
 <div className="spinner spinner-lg" />
 <p className="text-sm text-[var(--color-text-secondary)]">正在解析播放地址…</p>
 </div>
 )}
 </div>
 )}
 </div>

 {/* ============ 侧边面板:选集 / 换源 / 详情 ============ */}
 {panel !== 'none' && (
 <aside
 className="flex-shrink-0 overflow-hidden flex flex-col animate-slideInRight ml-px mr-0 mt-0 mb-0 border border-[var(--color-border-default)] shadow-2xl"
 style={{
 width: '320px',
 background: 'var(--color-panel-bg)',
 backdropFilter: 'blur(24px)',
 WebkitBackdropFilter: 'blur(24px)'
 }}
 >
 {/* 面板标题 */}
 <div className="px-5 py-4 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
 <div className="flex items-center gap-2">
 {panel === 'episodes' ? (
 <Icon name="grid" size={16} className="text-primary" />
 ) : panel === 'sources' ? (
 <Icon name="menu" size={16} className="text-primary" />
 ) : (
 <Icon name="help" size={16} className="text-primary" />
 )}
 <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
 {panel === 'episodes' ? '选集' : panel === 'sources' ? '换源' : '详情'}
 </h3>
 <span className="text-xs text-[var(--color-text-quaternary)]">
 {panel === 'episodes'
 ? `共 ${total} 集`
 : panel === 'sources'
 ? `${sourceList.length} 个源${searchingSources ? ' · 搜索中...' : ''}`
 : '影视信息'}
 </span>
 </div>
 <button
 onClick={() => setPanel('none')}
 className="w-7 h-7 flex items-center justify-center text-[var(--color-text-tertiary)] hover:text-red-400 hover:bg-red-500/10 transition-all rounded"
 title="关闭面板"
 >
 <Icon name="x" size={16} />
 </button>
 </div>

 {/* 面板内容 */}
 <div className="flex-1 overflow-y-auto p-3">
 {/* 选集面板 */}
 {panel === 'episodes' && (
 <div className="grid grid-cols-3 gap-1.5">
 {episodes.map((_, i) => {
 const isCurrent = i === curIdx
 const isWatched = playRecords[generateStorageKey(source, id)]?.index === i + 1
 return (
 <button
 key={i}
 onClick={() => jumpToEpisode(i)}
 title={episodeTitle(i)}
 className={`relative text-xs py-2 px-1 truncate transition-all duration-200 rounded ${
 isCurrent
 ? 'bg-gradient-to-br from-primary to-red-700 text-white font-semibold shadow-lg shadow-primary/30 ring-2 ring-primary/50'
 : isWatched
 ? 'bg-primary/15 text-primary hover:bg-primary/25 font-medium'
 : 'bg-[var(--color-hover-overlay)] text-[var(--color-text-tertiary)] hover:bg-[var(--color-hover-overlay-strong)] hover:text-white'
 }`}
 >
 {episodeTitle(i)}
 {isCurrent && (
 <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5">
 <span className="w-1 h-1 bg-white animate-pulse" />
 </span>
 )}
 {isWatched && !isCurrent && (
 <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-primary" />
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
 <p className="text-[var(--color-text-quaternary)] text-sm">暂无可用源</p>
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
 className={`w-full text-left p-3 transition-all duration-200 border rounded ${
 isCurrent
 ? 'bg-primary/15 border-primary/40 ring-1 ring-primary/20'
 : 'border-[var(--color-border-subtle)] hover:bg-[var(--color-hover-overlay)] hover:border-[var(--color-border-default)] cursor-pointer'
 }`}
 >
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2 min-w-0">
 <span className={`text-sm font-medium truncate ${isCurrent ? 'text-primary' : 'text-[var(--color-text-primary)]'}`}>
 {s.source_name || s.source}
 </span>
 {isCurrent && (
 <span className="flex items-center gap-1 text-[10px] text-primary bg-primary/20 px-1.5 py-0.5 flex-shrink-0">
					<span className="w-1.5 h-1.5 bg-primary animate-pulse" />
 使用中
 </span>
 )}
 </div>
 {!isCurrent && epCount > 0 && (
 <Icon name="arrow-right" size={16} className="text-[var(--color-text-quaternary)] flex-shrink-0" />
 )}
 </div>
 <div className="flex items-center gap-2 mt-2 text-xs">
 <span className={`flex items-center gap-1 px-1.5 py-0.5 ${
 epCount > 0
 ? 'bg-green-500/10 text-green-400'
 : 'bg-red-500/10 text-red-400'
 }`}>
 {epCount > 0 ? `${epCount} 集` : '无地址'}
 </span>
 {s.vod_remarks && <span className="text-[var(--color-text-quaternary)] truncate">{s.vod_remarks}</span>}
 {s.year && s.year !== 'unknown' && <span className="text-[var(--color-text-quaternary)] flex-shrink-0">{s.year}</span>}
 </div>
 </button>
 )
 })}
 {searchingSources && (
 <div className="flex items-center justify-center gap-2 py-4 text-sm text-[var(--color-text-tertiary)]">
 <div className="spinner spinner-sm" />
 正在搜索更多源...
 </div>
 )}
 </div>
 )}

 {/* 详情面板 */}
 {panel === 'detail' && detail && (
 <div className="space-y-4">
 {/* 封面 + 标题 */}
 <div className="flex gap-3.5">
 <div className="w-28 h-40 overflow-hidden flex-shrink-0 bg-[var(--color-hover-overlay-subtle)] ring-1 ring-[var(--color-border-subtle)] shadow-lg">
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
 <div className="flex-1 min-w-0 flex flex-col">
 <h4 className="text-sm font-semibold text-[var(--color-text-primary)] leading-snug mb-2 line-clamp-2">
 {detail.title}
 </h4>
 {detail.vod_remarks && (
 <span className="inline-block text-xs bg-primary/15 text-primary px-2 py-0.5 mb-2 w-fit">
 {detail.vod_remarks}
 </span>
 )}
 <div className="space-y-1 text-xs text-[var(--color-text-tertiary)] mt-auto">
 {detail.year && detail.year !== 'unknown' && (
 <div className="flex items-center gap-1.5">
 <span className="text-[var(--color-text-secondary)]">年份</span>
 <span className="text-[var(--color-text-tertiary)]">{detail.year}</span>
 </div>
 )}
 {detail.source_name && (
 <div className="flex items-center gap-1.5">
 <span className="text-[var(--color-text-secondary)]">来源</span>
 <span className="text-[var(--color-text-tertiary)] truncate">{detail.source_name}</span>
 </div>
 )}
 </div>
 </div>
 </div>

 {/* 信息栏 */}
 <div className="grid grid-cols-2 gap-2">
 {episodes.length > 0 && (
 <div className="flex flex-col items-center py-2.5 bg-[var(--color-hover-overlay)]">
 <span className="text-base text-[var(--color-text-primary)] font-semibold">{episodes.length}</span>
 <span className="text-xs text-[var(--color-text-tertiary)] mt-0.5">总集数</span>
 </div>
 )}
 {detail.year && detail.year !== 'unknown' && (
 <div className="flex flex-col items-center py-2.5 bg-[var(--color-hover-overlay)]">
 <span className="text-base text-[var(--color-text-primary)] font-semibold">{detail.year}</span>
 <span className="text-xs text-[var(--color-text-tertiary)] mt-0.5">年份</span>
 </div>
 )}
 </div>

 {/* 标签信息 */}
 {(detail.type_name || detail.class) && (
 <div>
 <p className="text-xs text-[var(--color-text-secondary)] mb-2">类型</p>
 <div className="flex flex-wrap gap-1.5">
 {detail.type_name && (
 <span className="text-xs bg-[var(--color-hover-overlay)] text-[var(--color-text-tertiary)] px-2 py-1 ">
 {detail.type_name}
 </span>
 )}
 {detail.class && detail.class.split(',').filter(Boolean).map((c, i) => (
 <span key={i} className="text-xs bg-[var(--color-hover-overlay)] text-[var(--color-text-tertiary)] px-2 py-1 ">
 {c.trim()}
 </span>
 ))}
 </div>
 </div>
 )}

 {/* 简介 */}
 {detail.desc && (
 <div>
 <p className="text-xs text-[var(--color-text-secondary)] mb-2">简介</p>
 <p className="text-xs text-[var(--color-text-tertiary)] leading-relaxed max-h-60 overflow-y-auto pr-1 selectable">
 {detail.desc}
 </p>
 </div>
 )}

 {/* 无数据提示 */}
 {!detail.desc && !detail.type_name && !detail.class && (
 <div className="text-center py-8 text-[var(--color-text-quaternary)] text-sm">
 暂无详细信息
 </div>
 )}
 </div>
 )}

 {/* 详情面板 - detail 尚未加载 */}
 {panel === 'detail' && !detail && (
 <div className="flex items-center justify-center py-12">
 <div className="spinner spinner-sm" />
 </div>
 )}
 </div>
 </aside>
 )}
 </div>

 {/* ============ 底部拖拽条(标准窗口大小时可拖拽移动窗口) ============ */}
 <div
 className="flex-shrink-0 h-4 border-t border-[var(--color-border-subtle)]"
 style={{ WebkitAppRegion: 'drag', background: 'var(--color-app-bg-deep)' } as React.CSSProperties}
 />
 </div>
 )
}
