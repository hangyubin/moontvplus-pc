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

/** 内存缓存:以 source+id 为键 */
const cache = new Map<string, SearchResult>()

/** 标题索引:title -> SearchResult[] (同一标题的多个源结果) */
const titleIndex = new Map<string, SearchResult[]>()

/** 最大缓存条目数(防止内存无限增长) */
const MAX_CACHE_SIZE = 200
/** 标题索引最大条目数 */
const MAX_TITLE_INDEX_SIZE = 300

/** 规范化标题(去空格、转小写)用于模糊匹配 */
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, '')
}

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
