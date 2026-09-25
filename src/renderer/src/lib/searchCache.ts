/**
 * 搜索结果缓存
 *
 * 背景:服务端 /api/detail 对部分资源源(如 dyttzyapi.com)返回空 episodes,
 * 但 SSE 搜索结果中已包含完整的 episodes 数组。
 * 此模块缓存搜索/详情结果,Detail/Play 页面优先读取缓存,避免 detail API 返回空数据。
 *
 * 同时维护以标题为索引的查找表,支持"换源"功能:
 * 同一标题在不同资源源有不同结果,通过标题可找到所有可用的源。
 *
 * 内存管理:cache 和 titleIndex 都有上限,淘汰时同步清理,
 * 防止内存无限增长。
 */
import type { SearchResult } from '../types'
import { generateStorageKey } from '../types'
import { normalizeTitle } from './utils'
import { getCached, setCached, clearByPrefix } from './ttlCache'
import { getHomeModeKey } from './homeCache'

/** 内存缓存:以 source+id 为键 */
const cache = new Map<string, SearchResult>()

/** 标题索引:title -> SearchResult[] (同一标题的多个源结果) */
const titleIndex = new Map<string, SearchResult[]>()

/** 最大缓存条目数(防止内存无限增长) */
const MAX_CACHE_SIZE = 200
/** 标题索引最大条目数 */
const MAX_TITLE_INDEX_SIZE = 300

/** 从 titleIndex 中移除指定的缓存项 */
function removeFromTitleIndex(item: SearchResult): void {
  if (!item.title) return
  const normTitle = normalizeTitle(item.title)
  const list = titleIndex.get(normTitle)
  if (!list) return
  const filtered = list.filter(
    (r) => !(r.source === item.source && r.id === item.id)
  )
  if (filtered.length === 0) {
    titleIndex.delete(normTitle)
  } else {
    titleIndex.set(normTitle, filtered)
  }
}

/** 缓存一条搜索结果 */
export function cacheSearchResult(item: SearchResult): void {
  if (!item.source || !item.id) return
  const key = generateStorageKey(item.source, item.id)

  // 如果已存在,先从 titleIndex 中移除旧条目(避免重复)
  const existing = cache.get(key)
  if (existing) {
    removeFromTitleIndex(existing)
  }

  cache.set(key, item)

  // 超出上限时清除最早的条目(同步清理 titleIndex)
  while (cache.size > MAX_CACHE_SIZE) {
    const firstKey = cache.keys().next().value
    if (!firstKey) break
    const evicted = cache.get(firstKey)
    cache.delete(firstKey)
    if (evicted) removeFromTitleIndex(evicted)
  }

  // 更新标题索引
  if (item.title) {
    const normTitle = normalizeTitle(item.title)
    const list = titleIndex.get(normTitle) || []
    // 避免重复(同一 source+id)
    const exists = list.some(
      (r) => r.source === item.source && r.id === item.id
    )
    if (!exists) {
      titleIndex.set(normTitle, [...list, item])
    }
    // 限制 titleIndex 大小
    while (titleIndex.size > MAX_TITLE_INDEX_SIZE) {
      const firstTitle = titleIndex.keys().next().value
      if (!firstTitle) break
      titleIndex.delete(firstTitle)
    }
  }
}

/** 批量缓存搜索结果 */
export function cacheSearchResults(items: SearchResult[]): void {
  for (const item of items) cacheSearchResult(item)
}

/** 清空全部内存搜索/详情缓存(切换自定义视频源或服务器时调用,防止跨源/跨模式串数据) */
export function clearSearchCache(): void {
  cache.clear()
  titleIndex.clear()
  // 同步清空持久化的"关键词→结果列表"缓存(搜索历史保留)
  clearPersistedResults()
}

/* ============================================================
 * 关键词搜索结果持久缓存
 *
 * 场景:搜索后进入详情/播放页再返回,Search 组件会卸载重挂载,
 * 若无缓存会重新发起一次全网搜索。持久缓存让返回时直接恢复结果。
 *
 * - 存储:localStorage,TTL 30 分钟(覆盖页面往返;超时重新搜索)
 * - 隔离:按"数据模式(服务器/自定义视频源)+ 过滤开关 + 关键词"建键
 * - 瘦身:只持久化展示字段(剥离 episodes 等大字段),详情走详情接口/内存缓存
 * - LRU:最多保留最近 3 个关键词,超出淘汰最旧,避免撑爆 localStorage
 * ============================================================ */

const RESULT_PREFIX = 'search:results:'
const RESULT_INDEX_KEY = RESULT_PREFIX + 'index'
/** 结果缓存有效期:30 分钟 */
const RESULT_TTL = 30 * 60 * 1000
/** 最多缓存的关键词数量(LRU) */
const RESULT_MAX_KEYS = 3
/** 单个源分组最多持久化的条数(超出截断) */
const RESULT_MAX_PER_GROUP = 150
/** 单次搜索最多持久化的总条数(所有源合计,控制 localStorage 体积) */
const RESULT_MAX_TOTAL = 300

/** 持久化的源分组(结构同 Search 页 SourceGroup) */
export interface PersistedSourceGroup {
  source: string
  sourceName: string
  results: SearchResult[]
  error?: string
}

/** 仅保留卡片展示/跳转所需字段,剥离 episodes 等大字段 */
function slimResult(r: SearchResult): SearchResult {
  // 解构剔除 episodes(体积最大的集数/播放地址数组),持久化只用于结果列表展示
  const { episodes: _omit, ...rest } = r
  void _omit
  return rest as unknown as SearchResult
}

function readResultIndex(): string[] {
  try {
    const raw = localStorage.getItem('mtvp:' + RESULT_INDEX_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeResultIndex(keys: string[]): void {
  try {
    localStorage.setItem('mtvp:' + RESULT_INDEX_KEY, JSON.stringify(keys.slice(0, RESULT_MAX_KEYS)))
  } catch {
    // ignore
  }
}

/** 构造结果缓存键(含模式与过滤开关,保证不同配置互不串用) */
function buildResultCacheKey(keyword: string, hideTrailers: boolean, blockNSFW: boolean): string {
  return `${RESULT_PREFIX}${getHomeModeKey()}|${hideTrailers ? 1 : 0}${blockNSFW ? 1 : 0}|${keyword.trim()}`
}

/**
 * 读取某次搜索的持久结果;不存在或已过期返回 null。
 * 返回的 groups 可直接恢复页面状态(不重新发起搜索)。
 */
export function getPersistedSearchResults(
  keyword: string,
  hideTrailers: boolean,
  blockNSFW: boolean
): PersistedSourceGroup[] | null {
  const key = buildResultCacheKey(keyword, hideTrailers, blockNSFW)
  const groups = getCached<PersistedSourceGroup[]>(key, RESULT_TTL)
  if (!groups) return null
  // 命中即提到 LRU 最前
  const idx = readResultIndex().filter((k) => k !== key)
  writeResultIndex([key, ...idx])
  return groups
}

/** 持久化某次搜索的最终结果(complete 时调用) */
export function setPersistedSearchResults(
  keyword: string,
  hideTrailers: boolean,
  blockNSFW: boolean,
  groups: PersistedSourceGroup[]
): void {
  const key = buildResultCacheKey(keyword, hideTrailers, blockNSFW)
  const slimmed: PersistedSourceGroup[] = []
  let budget = RESULT_MAX_TOTAL
  for (const g of groups) {
    if (budget <= 0) break
    const slice = g.results.slice(0, RESULT_MAX_PER_GROUP).slice(0, budget).map(slimResult)
    budget -= slice.length
    if (slice.length > 0 || g.error) {
      slimmed.push({ source: g.source, sourceName: g.sourceName, error: g.error, results: slice })
    }
  }
  if (slimmed.length === 0) return

  setCached(key, slimmed, RESULT_TTL)

  // LRU:新键置顶,超出上限的最旧键删除
  const idx = readResultIndex().filter((k) => k !== key)
  const next = [key, ...idx]
  writeResultIndex(next.slice(0, RESULT_MAX_KEYS))
  for (const old of next.slice(RESULT_MAX_KEYS)) {
    removeCachedKey(old)
  }
}

function removeCachedKey(fullSubKey: string): void {
  try {
    localStorage.removeItem('mtvp:' + fullSubKey)
  } catch {
    // ignore
  }
}

/** 清空全部持久化的搜索结果(切换模式/换源时随 clearSearchCache 调用) */
export function clearPersistedResults(): void {
  clearByPrefix(RESULT_PREFIX)
}

/** 读取缓存的搜索结果(可能为 null) */
export function getCachedResult(source: string, id: string): SearchResult | null {
  if (!source || !id) return null
  const key = generateStorageKey(source, id)
  return cache.get(key) || null
}

/**
 * 按标题查找所有可用源(用于换源功能)
 * @param title 影视标题
 * @param excludeSource 排除的源 key(当前正在播放的源)
 * @returns 匹配的搜索结果列表(已排除当前源),过滤掉已从缓存中淘汰的条目
 */
export function findSourcesByTitle(
  title: string,
  excludeSource?: string
): SearchResult[] {
  if (!title) return []
  const normTitle = normalizeTitle(title)
  const results = titleIndex.get(normTitle) || []
  return results.filter((r) => {
    // 排除当前源
    if (excludeSource && r.source === excludeSource) return false
    // 只返回有播放地址的
    return r.episodes && r.episodes.length > 0
  })
}

/**
 * 获取详情:优先使用缓存(含完整 episodes),缓存未命中时调用 API
 * @param fetchDetail API 获取函数
 */
export async function getDetailWithCache(
  source: string,
  id: string,
  fetchDetail: (id: string, source: string) => Promise<SearchResult>
): Promise<SearchResult> {
  // 1. 先查缓存
  const cached = getCachedResult(source, id)
  if (cached && cached.episodes && cached.episodes.length > 0) {
    return cached
  }

  // 2. 缓存未命中或无 episodes,调用 API
  try {
    const result = await fetchDetail(id, source)
    // 3. API 返回有 episodes 则缓存并返回
    if (result && result.episodes && result.episodes.length > 0) {
      cacheSearchResult(result)
      return result
    }
    // 4. API 返回无 episodes 但缓存有(即使无 episodes),返回缓存
    if (cached) return cached
    // 5. 都没有,返回 API 结果
    return result
  } catch (e) {
    // API 失败时,如果有缓存就返回缓存
    if (cached) return cached
    throw e
  }
}
