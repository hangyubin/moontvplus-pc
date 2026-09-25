/**
 * 搜索页
 * - 从 URL 参数 q 获取关键词,使用 SSE 流式搜索(searchStream)
 * - 双模式展示:聚合视图(所有源合并去重) / 分组视图(按源分组)
 * - 顶部源筛选 chip,可切换显示全部/某源
 * - 搜索进度:百分比 + 已完成源数 / 总源数
 * - 搜索历史同步:搜索时保存到服务端,无关键词时展示历史
 * - 支持取消(组件卸载时调用 cancel)
 *
 * 优化项:
 * 1. 进度条:百分比与源数更直观
 * 2. 结果卡片:悬浮 scale+shadow,封面加载失败显示占位图
 * 3. 聚合视图:卡片展示所有源名称列表,点击直接跳转
 * 4. 空结果:显示搜索建议
 * 5. 搜索中:骨架屏代替空白
 * 6. 排序:标题完全匹配的排最前
 */
import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { searchStream, getSearchHistory, saveSearchHistory, clearSearchHistory, getSearchResources, getDoubanCategories } from '../lib/api'
import { cacheSearchResults, cacheSearchResult, getPersistedSearchResults, setPersistedSearchResults } from '../lib/searchCache'
import { normalizeTitle, buildDetailUrl, calcProgress } from '../lib/utils'
import { useStore } from '../lib/store'
import type { SearchResult, SearchSSEEvent, DoubanCategoryItem } from '../types'
import MediaCard from '../components/MediaCard'
import Icon from '../components/Icon'

/** 单个源的搜索结果分组 */
interface SourceGroup {
 source: string
 sourceName: string
 results: SearchResult[]
 error?: string
}

/** 聚合项:同一标题在多个源的匹配 */
interface AggregatedItem {
 title: string
 /** 所有源的结果(按相关度排序) */
 variants: SearchResult[]
 /** 最佳结果(用于展示封面/信息) */
 best: SearchResult
}

/** 视图模式 */
type ViewMode = 'aggregate' | 'grouped'

/** 预告片关键词(标题或备注中包含则判定为预告片) */
const trailerKeywords = ['预告', '预告片', 'trailer', 'Teaser', '花絮', '彩蛋', '预告合集']

/** 18禁关键词(源名称、分类、类型或标题中包含则判定为成人内容) */
const nsfwKeywords = ['伦理', '成人', '18禁', '18+', '三级', '大尺度', '福利', '深夜档', '肉番', '里番', '成人动漫', '黄色', 'AV', 'av', '色情', '情趣', 'NSFW', 'nsfw', '禁漫', '肌情', '夜夜']

/** 18禁图标/符号(emoji,源名称中常见) */
const nsfwEmojis = ['🔞', '🍆', '💋']

/** 屏蔽关键词(标题中包含则过滤:解说、体育赛事等无关内容) */
const BLOCKED_KEYWORDS = ['解说', '体育', 'NBA', 'CBA', '中超', '英超', '西甲', '意甲', '德甲', '法甲', '欧冠', '世界杯', '欧洲杯', '亚洲杯', '奥运会', '赛事', '集锦', '录像', '篮球', '足球', '网球', '斯诺克', '台球', '羽毛球', '乒乓球', '排球', '高尔夫', '拳击', 'F1', '赛车', '电竞', '奥运', '全明星', '季后赛', '总决赛', '半决赛', '四分之一决赛', '女篮', '男篮', '锦标赛', '联赛', '杯赛', '热身赛', '友谊赛', '预选赛', '小组赛', '淘汰赛']

/** 判断文本是否含18禁标记(关键词 + emoji图标) */
function hasNSFWMark(text: string): boolean {
 if (nsfwKeywords.some((kw) => text.includes(kw))) return true
 if (nsfwEmojis.some((emoji) => text.includes(emoji))) return true
 return false
}

/** 判断是否为预告片 */
function isTrailer(item: SearchResult): boolean {
 const title = item.title || ''
 const remarks = item.vod_remarks || ''
 return trailerKeywords.some((kw) => title.includes(kw) || remarks.includes(kw))
}

/** 判断是否为18禁内容(关键词 + emoji图标) */
function isNSFW(item: SearchResult): boolean {
 const title = item.title || ''
 const typeName = item.type_name || ''
 const classStr = item.class || ''
 const remarks = item.vod_remarks || ''
 return hasNSFWMark(`${title} ${typeName} ${classStr} ${remarks}`)
}

/** 计算标题匹配度(0-1,越高越匹配) */
function titleScore(query: string, title: string): number {
 const q = normalizeTitle(query)
 const t = normalizeTitle(title)
 if (q === t) return 1.0
 if (t.includes(q)) return 0.9
 if (q.includes(t)) return 0.8
 // 字符级相似度
 let common = 0
 for (const ch of q) {
 if (t.includes(ch)) common++
 }
 return common / Math.max(q.length, t.length) * 0.5
}

/** 骨架卡片数量 */
const SKELETON_COUNT = 18

/** 卡片网格样式(统一) — 160px 起步,卡片更大更易点 */
const cardGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: '14px',
  alignItems: 'start',
}

/* ============================================================
 * 搜索结果卡片(聚合/分组通用)
 * - 悬浮效果:scale + shadow
 * - 封面加载失败显示占位图(SmartImage 内置)
 * - 聚合模式:展示所有可用源,点击源直接跳转
 * ============================================================ */
interface SearchResultCardProps {
 item: SearchResult
 /** 聚合模式:同一标题的所有源变体(长度>1时显示源列表) */
 variants?: SearchResult[]
 /** 搜索关键词(用于精确匹配标记) */
 query?: string
}

function SearchResultCard({ item, variants, query }: SearchResultCardProps) {
 const navigate = useNavigate()
 const { playRecords } = useStore()

 const key = `${item.source}+${item.id}`
 const record = playRecords[key]
 const progress = record ? calcProgress(record.play_time, record.total_time) : 0

 const sourceList = variants && variants.length > 1 ? variants : []
 const isExact = !!query && normalizeTitle(item.title) === normalizeTitle(query)

 const goDetail = (v: SearchResult) => {
 cacheSearchResult(v)
 navigate(buildDetailUrl(v.source, v.id, v.title))
 }

 return (
 <MediaCard
 item={{ title: item.title, poster: item.poster }}
 variant="search"
 onClick={() => goDetail(item)}
 progress={progress}
 titlePrefix={
 isExact ? (
 <span className="flex-shrink-0 bg-emerald-500 text-white text-[9px] leading-none px-1 py-0.5 rounded">
 精确
 </span>
 ) : undefined
 }
 subtitle={
 item.source_name ? (
 <p className="text-[10px] text-white/60 truncate mt-0.5 drop-shadow-md">{item.source_name}</p>
 ) : undefined
 }
 topLeft={
 <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1">
 {item.year && item.year !== 'unknown' && (
 <span className="bg-black/75 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 leading-none rounded">
 {item.year}
 </span>
 )}
 {sourceList.length > 1 && (
 <span className="bg-primary/85 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 leading-none rounded">
 {sourceList.length} 源
 </span>
 )}
 </div>
 }
 topRight={
 item.vod_remarks ? (
 <span className="absolute top-1.5 right-1.5 bg-black/75 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 z-10 leading-none rounded">
 {item.vod_remarks}
 </span>
 ) : undefined
 }
 />
 )
}

/** 骨架卡片(搜索中占位) */
function SkeletonCard() {
 return (
 <div className="overflow-hidden">
 <div className="aspect-[2/3] shimmer" />
 </div>
 )
}

export default function Search() {
 const [searchParams, setSearchParams] = useSearchParams()
 const navigate = useNavigate()
 const q = searchParams.get('q') || ''

 const [groups, setGroups] = useState<SourceGroup[]>([])
 const [loading, setLoading] = useState(false)
 const [totalFound, setTotalFound] = useState(0)
 const [filterSource, setFilterSource] = useState<string>('')
 const [inputValue, setInputValue] = useState(q)
 const [viewMode, setViewMode] = useState<ViewMode>('aggregate')
 const [completedSources, setCompletedSources] = useState(0)
 const [totalSources, setTotalSources] = useState(0)
 const [errorSources, setErrorSources] = useState<{ source: string; sourceName: string; error: string }[]>([])
 const [history, setHistory] = useState<string[]>([])
 const [hideTrailers, setHideTrailers] = useState(() => {
 const saved = localStorage.getItem('search_hideTrailers')
 return saved === null ? true : saved === '1'
 }) // 默认过滤预告片,持久化
 const [blockNSFW, setBlockNSFW] = useState(() => {
 const saved = localStorage.getItem('search_blockNSFW')
 return saved === null ? true : saved === '1'
 }) // 默认开启18禁过滤,持久化
 const [nsfwSourceKeys, setNsfwSourceKeys] = useState<Set<string>>(new Set())
 /** NSFW 源集合是否加载完成(完成前不发起搜索,避免集合为空时多搜一次) */
 const [nsfwLoaded, setNsfwLoaded] = useState(false)
 const cancelRef = useRef<(() => void) | null>(null)
 /** groups 的最新值镜像:complete 时据此持久化搜索结果 */
 const groupsRef = useRef<SourceGroup[]>([])
 const [recommendList, setRecommendList] = useState<DoubanCategoryItem[]>([])

 // 开关变化时持久化
 useEffect(() => {
 localStorage.setItem('search_hideTrailers', hideTrailers ? '1' : '0')
 }, [hideTrailers])
 useEffect(() => {
 localStorage.setItem('search_blockNSFW', blockNSFW ? '1' : '0')
 }, [blockNSFW])

 // 加载搜索源列表(用于识别18禁源,从源头过滤)
 useEffect(() => {
 getSearchResources()
 .then((resources) => {
 const keys = new Set<string>()
 for (const r of resources) {
 const name = r.name || ''
 // 源名称含18禁关键词或emoji图标 → 标记为NSFW源
 if (hasNSFWMark(name)) {
 keys.add(r.key)
 }
 }
 setNsfwSourceKeys(keys)
 })
 .catch(() => {})
 .finally(() => setNsfwLoaded(true))
 }, [])

 // 加载搜索历史(无关键词时展示)
 useEffect(() => {
 if (!q) {
 let cancelled = false
 getSearchHistory()
 .then((h) => { if (!cancelled) setHistory(h) })
 .catch(() => {})
 return () => { cancelled = true }
 }
 }, [q])

 // 搜索触发时保存关键词(本地即时生效,服务器模式后台同步)
 useEffect(() => {
 if (q) {
 let cancelled = false
 saveSearchHistory(q)
 .then((h) => { if (!cancelled) setHistory(h) })
 .catch(() => {})
 return () => { cancelled = true }
 }
 }, [q])

 useEffect(() => {
 setInputValue(q)

 if (!q) {
 setGroups([])
 groupsRef.current = []
 setLoading(false)
 setTotalFound(0)
 setFilterSource('')
 setCompletedSources(0)
 setTotalSources(0)
 setErrorSources([])
 cancelRef.current = null
 return
 }

 // 开启18禁过滤时,先等 NSFW 源集合加载完成再搜索(否则集合为空会白搜一次)
 if (blockNSFW && !nsfwLoaded) {
 setLoading(true)
 return
 }

 // 优先恢复 30 分钟内的持久结果:
 // 从详情/播放页返回时直接还原,不再发起全网搜索
 const persisted = getPersistedSearchResults(q, hideTrailers, blockNSFW)
 if (persisted) {
 const found = persisted.reduce((n, g) => n + g.results.length, 0)
 const errs = persisted
 .filter((g) => g.error)
 .map((g) => ({ source: g.source, sourceName: g.sourceName, error: g.error || '搜索失败' }))
 setGroups(persisted)
 groupsRef.current = persisted
 setTotalFound(found)
 setErrorSources(errs)
 setCompletedSources(persisted.length)
 setTotalSources(persisted.length)
 setLoading(false)
 return
 }

 let mounted = true
 setGroups([])
 groupsRef.current = []
 setTotalFound(0)
 setFilterSource('')
 setCompletedSources(0)
 setTotalSources(0)
 setErrorSources([])
 setLoading(true)

 const onEvent = (e: SearchSSEEvent) => {
 if (!mounted) return
 if (e.type === 'start') {
 // 搜索开始,设置总源数
 setTotalSources(e.totalSources || 0)
 } else if (e.type === 'source_result') {
 // 从源头过滤18禁:如果该源本身被标记为NSFW源,直接丢弃整个源的结果
 if (blockNSFW && nsfwSourceKeys.has(e.source)) {
 setCompletedSources((prev) => prev + 1)
 return
 }

 const filtered = e.results.filter((r) => {
 const title = r.title || ''
 // 屏蔽体育/解说
 if (BLOCKED_KEYWORDS.some((kw) => title.includes(kw))) return false
 // 过滤预告片
 if (hideTrailers && isTrailer(r)) return false
 // 过滤18禁(开关开启时,逐条检查兜底)
 if (blockNSFW && isNSFW(r)) return false
 return true
 })
 if (filtered.length > 0) {
 cacheSearchResults(filtered)
 setGroups((prev) => {
 let next: SourceGroup[]
 const idx = prev.findIndex((g) => g.source === e.source)
 if (idx >= 0) {
 next = [...prev]
 next[idx] = {
 ...next[idx],
 results: [...next[idx].results, ...filtered]
 }
 } else {
 next = [
 ...prev,
 { source: e.source, sourceName: e.sourceName, results: filtered }
 ]
 }
 groupsRef.current = next
 return next
 })
 setTotalFound((prev) => prev + filtered.length)
 }
 setCompletedSources((prev) => prev + 1)
 } else if (e.type === 'source_error') {
 setCompletedSources((prev) => prev + 1)
 const errInfo = { source: e.source, sourceName: e.sourceName, error: e.error }
 setErrorSources((prev) => [...prev, errInfo])
 // 错误也并入分组(空结果分组不渲染,但会随结果一起持久化,返回时可恢复错误提示)
 setGroups((prev) => {
 let next: SourceGroup[]
 const idx = prev.findIndex((g) => g.source === e.source)
 if (idx >= 0) {
 next = [...prev]
 next[idx] = { ...next[idx], error: e.error }
 } else {
 next = [...prev, { source: e.source, sourceName: e.sourceName, results: [], error: e.error }]
 }
 groupsRef.current = next
 return next
 })
 } else if (e.type === 'complete') {
 setLoading(false)
 setCompletedSources(e.completedSources || 0)
 // 持久化最终结果(瘦身+LRU+30分钟TTL),详情/播放页返回时直接恢复
 setPersistedSearchResults(q, hideTrailers, blockNSFW, groupsRef.current)
 }
 }

 const { cancel } = searchStream(q, onEvent, false)
 cancelRef.current = cancel

 return () => {
 mounted = false
 cancel()
 cancelRef.current = null
 }
 }, [q, hideTrailers, blockNSFW, nsfwSourceKeys, nsfwLoaded])

 const handleCancel = useCallback(() => {
 cancelRef.current?.()
 setLoading(false)
 }, [])

 /** 搜索提交 */
 const handleSearch = useCallback((e: React.FormEvent) => {
 e.preventDefault()
 const kw = inputValue.trim()
 if (kw) {
 setSearchParams({ q: kw }, { replace: true })
 }
 }, [inputValue, setSearchParams])

 /** 热门搜索词 */
 const hotSearches = useMemo(() => [
 '庆余年第二季', '玫瑰的故事', '繁花', '与凤行', '追风者',
 '长相思第二季', '城中之城', '哈尔滨一九四四', '微暗之火', '春色寄情人'
 ], [])

 /** 快捷搜索 */
 const handleQuickSearch = useCallback((kw: string) => {
 setInputValue(kw)
 setSearchParams({ q: kw }, { replace: true })
 }, [setSearchParams])

 /** 源筛选 chip 列表(仅含有结果的源) */
 const sourceChips = useMemo(
 () =>
 groups
 .filter((g) => g.results.length > 0)
 .map((g) => ({
 source: g.source,
 sourceName: g.sourceName,
 count: g.results.length
 })),
 [groups]
 )

 /** 当前实际展示的分组(根据筛选条件过滤) */
 const visibleGroups = useMemo(() => {
 const withResults = groups.filter((g) => g.results.length > 0)
 if (!filterSource) return withResults
 return withResults.filter((g) => g.source === filterSource)
 }, [groups, filterSource])

 /** 聚合视图:将所有源结果按标题合并去重 */
 const aggregatedList = useMemo(() => {
 const allResults: SearchResult[] = []
 for (const g of visibleGroups) {
 allResults.push(...g.results)
 }

 // 按归一化标题分组
 const titleMap = new Map<string, AggregatedItem>()
 for (const item of allResults) {
 const normTitle = normalizeTitle(item.title)
 const existing = titleMap.get(normTitle)
 if (existing) {
 existing.variants.push(item)
 } else {
 titleMap.set(normTitle, {
 title: item.title,
 variants: [item],
 best: item
 })
 }
 }

 // 为每个聚合项选择最佳结果(优先有 episodes 的,其次按匹配度)
 const list: AggregatedItem[] = []
 for (const item of titleMap.values()) {
 // 排序:有 episodes 优先,然后按标题匹配度
 item.variants.sort((a, b) => {
 const aHas = a.episodes?.length > 0 ? 1 : 0
 const bHas = b.episodes?.length > 0 ? 1 : 0
 if (aHas !== bHas) return bHas - aHas
 return titleScore(q, b.title) - titleScore(q, a.title)
 })
 item.best = item.variants[0]
 list.push(item)
 }

 // 排序:标题完全匹配的排最前,其次按匹配度
 const normQ = normalizeTitle(q)
 list.sort((a, b) => {
 const aExact = normalizeTitle(a.title) === normQ ? 1 : 0
 const bExact = normalizeTitle(b.title) === normQ ? 1 : 0
 if (aExact !== bExact) return bExact - aExact
 return titleScore(q, b.title) - titleScore(q, a.title)
 })
 return list
 }, [visibleGroups, q])

 /** 空结果时的搜索建议 */
 const suggestions = useMemo(() => {
 const list: string[] = []
 // 去空格
 const noSpace = q.replace(/\s+/g, '')
 if (noSpace && noSpace !== q) list.push(noSpace)
 // 去掉结尾年份(如 "2024"、"(2024)")
 const noYear = q.replace(/\s*[(（]?\d{4}[)）]?\s*$/, '').trim()
 if (noYear && noYear !== q && !list.includes(noYear)) list.push(noYear)
 // 去掉"第X季/部/期"
 const noSeason = q.replace(/\s*第[\d一二三四五六七八九十]+[季部期]\s*/g, '').trim()
 if (noSeason && noSeason !== q && !list.includes(noSeason)) list.push(noSeason)
 // 补充历史记录
 for (const h of history) {
 if (h !== q && !list.includes(h) && list.length < 6) list.push(h)
 }
 return list.slice(0, 6)
 }, [q, history])

 const hasResults = aggregatedList.length > 0 || visibleGroups.length > 0
 const searchProgress = totalSources > 0 ? Math.round((completedSources / totalSources) * 100) : 0

 // 无关键词或搜索结果为空时加载"猜你喜欢"推荐
useEffect(() => {
 if (loading || hasResults) return
 let cancelled = false
 getDoubanCategories('movie', '热门', '全部', 10)
 .then((list) => { if (!cancelled) setRecommendList(list) })
 .catch(() => {})
 return () => { cancelled = true }
}, [loading, hasResults])

 /** 点击推荐项:跳转到搜索 */
const handleRecommendClick = useCallback((item: DoubanCategoryItem) => {
 handleQuickSearch(item.title)
}, [handleQuickSearch])

 return (
 <div className="p-6">
 {/* ============ 搜索框 ============ */}
 <div className="mb-6">
 <form onSubmit={handleSearch} className="relative max-w-2xl">
 <Icon name="search" size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)] pointer-events-none" />
 <input
 type="text"
 value={inputValue}
 onChange={(e) => setInputValue(e.target.value)}
 placeholder="搜索影视、剧集..."
 className="input-field w-full"
 style={{ paddingLeft: '2.75rem', height: '40px' }}
 autoFocus
 />
 {inputValue && (
 <button
 type="button"
 onClick={() => { setInputValue(''); setSearchParams({}, { replace: true }) }}
 className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors"
 >
 <Icon name="x" size={16} />
 </button>
 )}
 </form>
 </div>

 {/* ============ 无关键词:热门搜索 + 搜索历史(并排) + 推荐 ============ */}
 {!q && (
 <div className="max-w-4xl">
 {/* 热门搜索 + 搜索历史 并排(窄屏自动堆叠) */}
 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
 {/* 热门搜索 */}
 <div>
 <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-3">
 <span className="section-bar" />
 热门搜索
 </h3>
 <div className="flex flex-wrap gap-2">
 {hotSearches.map((kw, i) => (
 <button
 key={`hot-${i}`}
 onClick={() => handleQuickSearch(kw)}
 className={`chip ${i < 3 ? 'chip-active' : ''}`}
 >
 {i < 3 && <span className="text-primary mr-1">●</span>}
 {kw}
 </button>
 ))}
 </div>
 </div>

 {/* 搜索历史 */}
 {history.length > 0 && (
 <div>
 <div className="flex items-center justify-between mb-3">
 <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)]">
 <span className="section-bar" />
 搜索历史
 </h3>
 <button
 onClick={async () => {
 await clearSearchHistory()
 setHistory([])
 }}
 className="text-xs text-[var(--color-text-tertiary)] hover:text-red-400 transition-colors"
 >
 清空历史
 </button>
 </div>
 <div className="flex flex-wrap gap-2">
 {history.map((kw, i) => (
 <button
 key={`${kw}-${i}`}
 onClick={() => handleQuickSearch(kw)}
 className="chip group flex items-center gap-1.5"
 >
 <span className="truncate">{kw}</span>
 <span
 onClick={async (e) => {
 e.stopPropagation()
 await clearSearchHistory(kw)
 setHistory((prev) => prev.filter((h) => h !== kw))
 }}
 className="w-4 h-4 flex items-center justify-center text-[var(--color-text-quaternary)] hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0"
 >
 <Icon name="x" size={12} />
 </span>
 </button>
 ))}
 </div>
 </div>
 )}
 </div>

 {/* 猜你喜欢推荐 */}
 {recommendList.length > 0 && (
 <div>
 <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-3">
 <span className="section-bar" />
 猜你喜欢
 </h3>
 <div style={cardGridStyle}>
 {recommendList.map((item) => (
 <MediaCard
 key={item.id}
 item={{ title: item.title, poster: item.poster }}
 variant="search"
 play="none"
 onClick={() => handleRecommendClick(item)}
 topLeft={item.year ? (
      <span className="absolute top-1.5 left-1.5 bg-black/75 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 z-10 leading-none rounded">
        {item.year}
      </span>
    ) : undefined}
 topRight={item.rate && item.rate !== '0' ? (
      <span className="absolute top-1.5 right-1.5 bg-black/75 backdrop-blur-sm text-[10px] px-1.5 py-0.5 z-10 leading-none rounded" style={{ color: '#facc15' }}>
        ★ {item.rate}
      </span>
    ) : undefined}
 />
 ))}
 </div>
 </div>
 )}

 {history.length === 0 && recommendList.length === 0 && (
 <div className="flex flex-col items-center justify-center py-24 text-center">
 <div className="w-20 h-20 flex items-center justify-center bg-[var(--color-hover-overlay-subtle)] border border-[var(--color-border-subtle)] mb-5 rounded-lg">
 <Icon name="search" size={36} strokeWidth={1.2} className="text-[var(--color-text-quaternary)]" />
 </div>
 <p className="text-[var(--color-text-secondary)] text-sm">请输入关键词开始搜索</p>
 <p className="text-xs text-[var(--color-text-quaternary)] mt-2">搜索历史保存在本机,连接服务器后自动多端同步</p>
 </div>
 )}
 </div>
 )}

 {/* ============ 搜索进度条(搜索中显示,百分比 + 源数更直观) ============ */}
 {q && loading && (
 <div className="mb-4">
 <div className="flex items-center justify-between mb-2">
 <div className="flex items-center gap-2 text-sm">
 <span className="spinner-sm flex-shrink-0" />
 <span className="text-[var(--color-text-secondary)]">搜索中</span>
 <span className="text-[var(--color-text-quaternary)]">·</span>
 <span className="text-white font-semibold tabular-nums">{searchProgress}%</span>
 <span className="text-[var(--color-text-tertiary)] text-xs tabular-nums">
 ({completedSources}/{totalSources || '?'} 源)
 </span>
 </div>
 <div className="flex items-center gap-3">
 <span className="text-xs text-[var(--color-text-tertiary)]">
 已找到 <span className="text-primary font-medium tabular-nums">{totalFound}</span> 条
 </span>
 <button
 type="button"
 onClick={handleCancel}
 className="btn-ghost px-3 py-1.5 text-xs flex-shrink-0"
 >
 取消
 </button>
 </div>
 </div>
 <div className="h-1 bg-[var(--color-hover-overlay-subtle)] overflow-hidden border border-[var(--color-border-subtle)] rounded-full">
			<div
				className="h-full progress-bar rounded-full"
				style={{ width: `${searchProgress}%` }}
			/>
 </div>
 </div>
 )}

 {/* ============ 工具栏:视图切换 + 源筛选 ============ */}
 {q && hasResults && (
 <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
 {/* 左:视图切换(分段控件) */}
 <div className="flex items-center gap-0.5 bg-[var(--color-hover-overlay-subtle)] p-1 border border-[var(--color-border-subtle)] rounded">
			<button
				onClick={() => setViewMode('aggregate')}
				className={`px-3.5 py-1.5 text-xs font-medium transition-all rounded ${
					viewMode === 'aggregate'
					? 'bg-[var(--color-card-bg)] text-[var(--color-text-primary)] shadow-sm'
					: 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay)]'
				}`}
			>
				聚合视图
			</button>
			<button
				onClick={() => setViewMode('grouped')}
				className={`px-3.5 py-1.5 text-xs font-medium transition-all rounded ${
					viewMode === 'grouped'
					? 'bg-[var(--color-card-bg)] text-[var(--color-text-primary)] shadow-sm'
					: 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay)]'
				}`}
			>
 分组视图
 </button>
 </div>

 {/* 右:源筛选 */}
 <div className="flex flex-wrap items-center gap-2">
 <button
 onClick={() => setFilterSource('')}
 className={!filterSource ? 'chip-active' : 'chip'}
 >
 全部 ({totalFound})
 </button>
 {sourceChips.map((chip) => (
 <button
 key={chip.source}
 onClick={() =>
 setFilterSource((prev) => (prev === chip.source ? '' : chip.source))
 }
 className={filterSource === chip.source ? 'chip-active' : 'chip'}
 >
 {chip.sourceName} ({chip.count})
 </button>
 ))}
 </div>
 </div>
 )}

 {/* ============ 聚合视图:卡片展示所有源,点击源直接跳转 ============ */}
 {q && hasResults && viewMode === 'aggregate' && (
 <div style={cardGridStyle}>
 {aggregatedList.map((item) => (
 <SearchResultCard
 key={item.best.source + item.best.id}
 item={item.best}
 variants={item.variants}
 query={q}
 />
 ))}
 </div>
 )}

 {/* ============ 分组视图 ============ */}
 {q && hasResults && viewMode === 'grouped' && (
 <div className="space-y-5">
 {visibleGroups.map((group) => (
 <div key={group.source}>
 <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-2.5">
 <span className="section-bar" />
 {group.sourceName}
 <span className="text-[var(--color-text-quaternary)]">({group.results.length})</span>
 </h3>
 <div style={cardGridStyle}>
 {group.results.map((item) => (
 <SearchResultCard key={`${item.source}-${item.id}`} item={item} query={q} />
 ))}
 </div>
 </div>
 ))}
 </div>
 )}

 {/* ============ 搜索中骨架屏(暂无结果时显示) ============ */}
 {q && loading && !hasResults && (
 <div style={cardGridStyle}>
 {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
 <SkeletonCard key={i} />
 ))}
 </div>
 )}

 {/* ============ 错误源提示 ============ */}
 {q && !loading && errorSources.length > 0 && (
 <div className="mt-6 glass-panel p-4">
 <div className="flex items-center gap-2 mb-2">
 <Icon name="alert" size={16} strokeWidth={1.8} className="text-amber-400 flex-shrink-0" />
 <p className="text-xs text-[var(--color-text-secondary)] font-medium">{errorSources.length} 个源搜索失败</p>
 </div>
 <div className="flex flex-wrap gap-2">
 {errorSources.map((e, i) => (
 <span key={i} className="badge text-xs">
 {e.sourceName}: {e.error}
 </span>
 ))}
 </div>
 </div>
 )}

 {/* ============ 空状态 + 搜索建议 ============ */}
 {q && !loading && !hasResults && (
 <div className="flex flex-col items-center justify-center py-24 text-center">
 <div className="w-20 h-20 flex items-center justify-center bg-[var(--color-hover-overlay-subtle)] border border-[var(--color-border-subtle)] mb-5 rounded-lg">
 <Icon name="film" size={36} strokeWidth={1.2} className="text-[var(--color-text-quaternary)]" />
 </div>
 <p className="text-[var(--color-text-secondary)] mb-2">
 未找到与 "<span className="text-white">{q}</span>" 相关的结果
 </p>
 <p className="text-[var(--color-text-quaternary)] text-sm mb-6">试试其他关键词,或检查资源源配置</p>
 {suggestions.length > 0 && (
 <div className="max-w-md mx-auto">
 <p className="text-xs text-[var(--color-text-quaternary)] mb-2">搜索建议</p>
 <div className="flex flex-wrap justify-center gap-2">
 {suggestions.map((s, i) => (
 <button
 key={`${s}-${i}`}
 onClick={() => handleQuickSearch(s)}
 className="chip"
 >
 {s}
 </button>
))}
 </div>
 </div>
 )}

 {/* 猜你喜欢推荐 */}
 {recommendList.length > 0 && (
 <div className="max-w-4xl mx-auto mt-8">
 <h3 className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] mb-3">
 <span className="section-bar" />
 猜你喜欢
 </h3>
 <div style={cardGridStyle}>
 {recommendList.map((item) => (
 <MediaCard
 key={item.id}
 item={{ title: item.title, poster: item.poster }}
 variant="search"
 play="none"
 onClick={() => handleRecommendClick(item)}
 topLeft={item.year ? (
      <span className="absolute top-1.5 left-1.5 bg-black/75 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 z-10 leading-none rounded">
        {item.year}
      </span>
    ) : undefined}
 topRight={item.rate && item.rate !== '0' ? (
      <span className="absolute top-1.5 right-1.5 bg-black/75 backdrop-blur-sm text-[10px] px-1.5 py-0.5 z-10 leading-none rounded" style={{ color: '#facc15' }}>
        ★ {item.rate}
      </span>
    ) : undefined}
 />
 ))}
 </div>
 </div>
 )}
 </div>
 )}
 </div>
 )
}
