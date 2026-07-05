/**
 * MoonTVPlus API 客户端
 * 封装所有服务端接口,基于 createApiClient()(带认证拦截)
 */
import type {
  PlayRecord,
  PlayRecordMap,
  Favorite,
  FavoriteMap,
  SearchResult,
  SearchResource,
  SearchSSEEvent,
  DoubanItem,
  DoubanCategoryItem,
  TmdbTrendingItem,
  DuanjuItem,
  ServerConfig,
  DeviceInfo,
  SkipConfig
} from '../types'
import { createApiClient, getBaseUrl, getToken } from './auth'

export const client = createApiClient()

/**
 * 构造播放 URL
 * - proxyMode=true:走服务端 /api/proxy/vod/m3u8 代理(服务端重写 ts 分片地址)
 * - proxyMode=false:直连原始 m3u8,由 Electron 主进程注入 CORS 头解决跨域
 *   (服务端代理在 proxyMode=false 时会返回 403,不能走代理)
 */
export function resolvePlayUrl(
  rawUrl: string,
  source: string | undefined,
  proxyMode: boolean | undefined
): string {
  if (!rawUrl) return ''
  // 已经是代理地址或相对路径,直接拼接 baseUrl
  if (rawUrl.startsWith('/api/proxy/')) {
    return `${getBaseUrl()}${rawUrl}`
  }
  // 非 m3u8 的直链(.mp4/.flv 等),Electron video 标签可直接播放
  const isM3u8 = rawUrl.includes('.m3u') || !/\.(mp4|flv|mkv|avi|webm)(\?|$)/i.test(rawUrl)
  if (!isM3u8) return rawUrl

  // proxyMode 为真时走服务端代理(服务端会注入 UA/Referer 并重写 ts 地址)
  if (proxyMode && source) {
    return `${getBaseUrl()}/api/proxy/vod/m3u8?url=${encodeURIComponent(rawUrl)}&source=${encodeURIComponent(source)}`
  }
  // proxyMode 为假时直连,CORS 由主进程 onHeadersReceived 注入 * 解决
  return rawUrl
}

/* ============ 站点配置 ============ */
export async function getServerConfig(): Promise<ServerConfig> {
  const res = await client.get<ServerConfig>('/api/server-config')
  return res.data
}

/* ============ 搜索 ============ */
/** 资源源列表(无需鉴权) */
export async function getSearchResources(): Promise<SearchResource[]> {
  const res = await client.get<SearchResource[]>('/api/search/resources')
  return res.data
}

/** 一次性聚合搜索 */
export async function search(query: string, special = false): Promise<SearchResult[]> {
  const res = await client.get<{ results: SearchResult[] }>('/api/search', {
    params: { q: query, special: special ? 1 : 0 }
  })
  return res.data.results
}

/**
 * SSE 流式搜索(边搜边出结果)
 * 通过 fetch + ReadableStream 解析 text/event-stream
 */
export function searchStream(
  query: string,
  onEvent: (e: SearchSSEEvent) => void,
  special = false
): { cancel: () => void; done: Promise<void> } {
  const controller = new AbortController()
  const url = `${getBaseUrl()}/api/search/ws?q=${encodeURIComponent(query)}&special=${special ? 1 : 0}`
  const headers: Record<string, string> = {}
  if (getToken()) headers.Authorization = `Bearer ${getToken()}`

  const done = (async () => {
    try {
      const res = await fetch(url, { headers, signal: controller.signal })
      if (!res.ok || !res.body) {
        onEvent({
          type: 'source_error',
          source: '',
          sourceName: '',
          error: `HTTP ${res.status}`,
          timestamp: Date.now()
        })
        onEvent({ type: 'complete', totalResults: 0, completedSources: 0, timestamp: Date.now() })
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6))
              onEvent(json as SearchSSEEvent)
            } catch {
              /* skip malformed */
            }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        onEvent({
          type: 'source_error',
          source: '',
          sourceName: '',
          error: (e as Error).message,
          timestamp: Date.now()
        })
      }
      onEvent({ type: 'complete', totalResults: 0, completedSources: 0, timestamp: Date.now() })
    }
  })()

  return { cancel: () => controller.abort(), done }
}

/* ============ 详情 ============ */
export async function getDetail(
  id: string,
  source: string,
  special = false
): Promise<SearchResult> {
  const res = await client.get<SearchResult>('/api/detail', {
    params: { id, source, special: special ? 1 : 0 }
  })
  return res.data
}

/* ============ 播放记录(观看历史) ============ */
/** 获取全部播放记录(已按 save_time DESC 排序的对象) */
export async function getPlayRecords(): Promise<PlayRecordMap> {
  const res = await client.get<PlayRecordMap>('/api/playrecords')
  return res.data
}

/** 上报/更新单条播放记录 */
export async function savePlayRecord(
  source: string,
  id: string,
  record: PlayRecord
): Promise<boolean> {
  const key = `${source}+${id}`
  const res = await client.post('/api/playrecords', { key, record })
  return res.data?.success === true
}

/** 删除单条播放记录 */
export async function deletePlayRecord(key: string): Promise<boolean> {
  const res = await client.delete('/api/playrecords', { params: { key } })
  return res.data?.success === true
}

/** 批量删除播放记录 */
export async function deletePlayRecords(keys: string[]): Promise<boolean> {
  const res = await client.delete('/api/playrecords', { data: { keys } })
  return res.data?.success === true
}

/** 清空全部播放记录 */
export async function clearPlayRecords(): Promise<boolean> {
  const res = await client.delete('/api/playrecords')
  return res.data?.success === true
}

/* ============ 收藏 ============ */
export async function getFavorites(): Promise<FavoriteMap> {
  const res = await client.get<FavoriteMap>('/api/favorites')
  return res.data
}

export async function getFavorite(key: string): Promise<Favorite | null> {
  const res = await client.get<Favorite | null>('/api/favorites', { params: { key } })
  return res.data
}

export async function saveFavorite(key: string, favorite: Favorite): Promise<boolean> {
  const res = await client.post('/api/favorites', { key, favorite })
  return res.data?.success === true
}

export async function deleteFavorite(key: string): Promise<boolean> {
  const res = await client.delete('/api/favorites', { params: { key } })
  return res.data?.success === true
}

/* ============ 搜索历史 ============ */
export async function getSearchHistory(): Promise<string[]> {
  const res = await client.get<string[]>('/api/searchhistory')
  return res.data
}

/** 保存搜索关键词到服务端,返回最新历史列表 */
export async function saveSearchHistory(keyword: string): Promise<string[]> {
  const res = await client.post<string[]>('/api/searchhistory', { keyword })
  return res.data
}

/** 删除单条搜索历史(带 keyword)或清空全部(不带) */
export async function clearSearchHistory(keyword?: string): Promise<boolean> {
  const params = keyword ? { keyword } : {}
  const res = await client.delete('/api/searchhistory', { params })
  return res.data?.success === true
}

/* ============ 跳过配置 ============ */
export async function getSkipConfig(source: string, id: string): Promise<SkipConfig | null> {
  const res = await client.get<SkipConfig>('/api/skipconfigs', { params: { source, id } })
  return res.data
}

export async function saveSkipConfig(
  source: string,
  id: string,
  config: SkipConfig
): Promise<boolean> {
  const res = await client.post('/api/skipconfigs', { source, id, config })
  return res.data?.success === true
}

/* ============ 设备管理 ============ */
export async function getDevices(): Promise<{ devices: DeviceInfo[] }> {
  const res = await client.get<{ devices: DeviceInfo[] }>('/api/auth/devices')
  return res.data
}

export async function revokeDevice(tokenId: string): Promise<boolean> {
  const res = await client.delete('/api/auth/devices', { data: { tokenId } })
  return res.data.success === true
}

export async function logoutAllDevices(): Promise<boolean> {
  const res = await client.post('/api/auth/devices')
  return res.data.success === true
}

/* ============ 豆瓣推荐 ============ */
export async function getDoubanRecommend(
  type: 'movie' | 'tv',
  tag: string,
  pageStart = 0,
  pageSize = 16
): Promise<{ list: DoubanItem[]; total?: number }> {
  const res = await client.get('/api/douban', {
    params: { type, tag, pageStart, pageSize }
  })
  return { list: res.data?.list || [], total: res.data?.total }
}

export async function doubanSearch(q: string): Promise<DoubanItem[]> {
  const res = await client.get('/api/douban/search', { params: { q } })
  return res.data || []
}

/* ============ 首页推荐(对齐服务端首页 API) ============ */
/** 豆瓣分类列表(热门电影/电视剧/综艺) */
export async function getDoubanCategories(
  kind: 'movie' | 'tv',
  category: string,
  type: string,
  limit = 30
): Promise<DoubanCategoryItem[]> {
  const res = await client.get('/api/douban/categories', {
    params: { kind, category, type, limit }
  })
  return res.data?.list || []
}

/** TMDB 趋势(首页轮播 Banner) */
export async function getTmdbTrending(): Promise<TmdbTrendingItem[]> {
  const res = await client.get('/api/tmdb/trending')
  return res.data?.list || []
}

/** TMDB 即将上映 */
export async function getTmdbUpcoming(): Promise<TmdbTrendingItem[]> {
  const res = await client.get('/api/tmdb/upcoming')
  return res.data?.list || []
}

/** 短剧推荐 */
export async function getDuanjuRecommends(): Promise<DuanjuItem[]> {
  const res = await client.get('/api/duanju/recommends')
  return res.data?.data || []
}
