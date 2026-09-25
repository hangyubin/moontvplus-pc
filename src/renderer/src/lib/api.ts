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
import { createApiClient, getToken, apiUrl, getBaseUrl } from './auth'
import { hasCustomVideo, getCustomVideoSource } from './customSource'

export const client = createApiClient()

/* ============ 自定义视频源(脱离 moontvplus 服务器) ============ */

/** 自定义源缓存的 api_site 项结构 */
interface CustomApiSite {
  key: string
  name: string
  api: string
  detail?: string
  weight?: number
}

let cachedCustomSites: CustomApiSite[] | null = null
let cachedCustomSitesUrl = ''
let customSitesFailedAt = 0
let customSitesInflight: Promise<CustomApiSite[]> | null = null
const CUSTOM_SITES_FAIL_COOLDOWN = 30 * 1000 // 失败后 30 秒冷却,防止高频重试

/**
 * 规范化视频源 URL:统一 format=0(原始 JSON)
 * format=2 是 Base58 编码、format 缺省会返回网页,均无法 JSON 解析,自动纠正
 */
function normalizeVideoSourceUrl(u: string): string {
  try {
    const parsed = new URL(u)
    if (parsed.searchParams.has('format')) {
      parsed.searchParams.set('format', '0')
    } else {
      parsed.searchParams.set('format', '0')
    }
    return parsed.toString()
  } catch {
    return u
  }
}

const K_SITES_CACHE = 'custom_video_sites_cache'

/** 读取持久化源列表缓存(URL 匹配才有效) */
function readSitesCache(url: string): CustomApiSite[] | null {
  try {
    const raw = localStorage.getItem(K_SITES_CACHE)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed?.url === url && Array.isArray(parsed?.sites) && parsed.sites.length > 0) {
      return parsed.sites as CustomApiSite[]
    }
    return null
  } catch {
    return null
  }
}

/** 写入持久化源列表缓存 */
function writeSitesCache(url: string, sites: CustomApiSite[]) {
  try {
    localStorage.setItem(K_SITES_CACHE, JSON.stringify({ url, sites, savedAt: Date.now() }))
  } catch {
    /* 存储满等异常忽略 */
  }
}

/** 清空视频源缓存(内存 + 持久化),下次使用时重新拉取 */
export function clearCustomVideoSitesCache() {
  cachedCustomSites = null
  cachedCustomSitesUrl = ''
  customSitesFailedAt = 0
  try {
    localStorage.removeItem(K_SITES_CACHE)
  } catch {
    /* ignore */
  }
}

/** 强制刷新源列表(清缓存后重新拉取),返回源数量 */
export async function refreshCustomApiSites(): Promise<number> {
  clearCustomVideoSitesCache()
  const sites = await fetchCustomApiSites(true)
  return sites.length
}

/** 清空播放中转页解析缓存(切换视频源时调用,防止旧源的 share 映射串到新源) */
export function clearCustomStreamResolveCache() {
  streamResolveCache.clear()
  streamResolving.clear()
}

/**
 * 拉取自定义视频源(返回 JSON,含 api_site 字段),解析为 api_site 列表
 * 兼容数组/对象格式: [{key,name,api,detail,weight}] 或 { key: {name,api,...} }
 * 优先本地持久缓存,其次内存缓存;仅无缓存时才网络拉取,成功后写持久缓存
 */
async function fetchCustomApiSites(force = false): Promise<CustomApiSite[]> {
  const rawUrl = getCustomVideoSource()
  if (!rawUrl) return []
  const url = normalizeVideoSourceUrl(rawUrl)
  if (!force) {
    // URL 变了重新拉取,否则用内存缓存
    if (cachedCustomSites && cachedCustomSitesUrl === url) return cachedCustomSites
    // 持久化缓存命中则直接使用,不发起网络请求(重启后也零请求)
    const persisted = readSitesCache(url)
    if (persisted) {
      cachedCustomSites = persisted
      cachedCustomSitesUrl = url
      console.log('[Custom] Loaded', persisted.length, 'api_site from localStorage cache')
      return persisted
    }
  }
  // 失败冷却期内不重复请求
  if (Date.now() - customSitesFailedAt < CUSTOM_SITES_FAIL_COOLDOWN) return []
  // 请求去重:多个调用共享同一个 in-flight 请求
  if (customSitesInflight) return customSitesInflight

  customSitesInflight = (async () => {
    try {
      const controller = new AbortController()
      const tid = setTimeout(() => controller.abort(), 20000)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(tid)
      if (!res.ok) {
        console.warn('[Custom] fetch api_site HTTP', res.status)
        customSitesFailedAt = Date.now()
        return []
      }
      const data = await res.json()
      const raw = (data as any)?.api_site
      const sites: CustomApiSite[] = []
      if (Array.isArray(raw)) {
        for (const s of raw) {
          if (!s) continue
          const api = String(s.api || s.detail || '').trim()
          const key = String(s.key || s.id || '').trim() || api
          if (!api) continue
          sites.push({
            key,
            name: String(s.name || '').trim() || key,
            api,
            detail: s.detail ? String(s.detail).trim() : undefined,
            weight: typeof s.weight === 'number' ? s.weight : undefined,
          })
        }
      } else if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
          const s = v as any
          const api = String(s?.api || s?.detail || '').trim()
          if (!api) continue
          sites.push({
            key: k,
            name: String(s?.name || k).trim(),
            api,
            detail: s?.detail ? String(s.detail).trim() : undefined,
            weight: typeof s?.weight === 'number' ? s.weight : undefined,
          })
        }
      }
      if (sites.length === 0) {
        console.warn('[Custom] api_site parsed empty, response head:', JSON.stringify(data).substring(0, 200))
        customSitesFailedAt = Date.now()
        return []
      }
      cachedCustomSites = sites
      cachedCustomSitesUrl = url
      writeSitesCache(url, sites)
      console.log('[Custom] Loaded', sites.length, 'api_site from', url)
      return sites
    } catch (e) {
      console.warn('[Custom] fetch api_site error:', e)
      customSitesFailedAt = Date.now()
      return []
    } finally {
      customSitesInflight = null
    }
  })()
  return customSitesInflight
}

/**
 * 解析苹果 CMS vod_play_url 为 episodes(播放 URL 列表)+ titles(集名列表)
 * 取集数最多的播放源
 */
function parseVodEpisodes(vodPlayUrl?: string): { episodes: string[]; titles: string[] } {
  const episodes: string[] = []
  const titles: string[] = []
  if (!vodPlayUrl) return { episodes, titles }
  vodPlayUrl.split('$$$').forEach((group) => {
    const eps: string[] = []
    const tls: string[] = []
    group.split('#').forEach((seg) => {
      const [name, url] = seg.split('$')
      const u = (url || '').trim()
      // 直连 m3u8 或服务器代理地址(/api/... 或 http(s)://)
      if (name && u && (u.startsWith('/') || /^https?:\/\//.test(u))) {
        eps.push(u)
        tls.push(name.trim())
      }
    })
    if (eps.length > episodes.length) {
      episodes.length = 0
      episodes.push(...eps)
      titles.length = 0
      titles.push(...tls)
    }
  })
  return { episodes, titles }
}

/** 把苹果 CMS vod 条目转换为 SearchResult */
function vodItemToSearchResult(
  v: CmsVodItem,
  source: string,
  sourceName: string,
  weight?: number
): SearchResult {
  const { episodes, titles } = parseVodEpisodes(v.vod_play_url)
  return {
    id: String(v.vod_id ?? ''),
    title: (v.vod_name || '').trim().replace(/\s+/g, ' '),
    poster: v.vod_pic || '',
    episodes,
    episodes_titles: titles,
    source,
    source_name: sourceName,
    weight,
    year: v.vod_year ? (String(v.vod_year).match(/\d{4}/)?.[0] || '') : '',
    desc: (v.vod_content || '').replace(/<[^>]+>/g, '').trim(),
    type_name: v.type_name || '',
    class: v.vod_class || '',
    vod_remarks: v.vod_remarks || '',
    vod_total: undefined,
    proxyMode: false, // 自定义源直连,CORS 由主进程注入 *
  }
}

/** 拉取单个源搜索结果(苹果 CMS API: ?ac=videolist&wd=) */
async function searchCustomSite(
  site: CustomApiSite,
  query: string
): Promise<SearchResult[]> {
  try {
    const api = site.api
    const sep = api.includes('?') ? '&' : '?'
    const url = `${api}${sep}ac=videolist&wd=${encodeURIComponent(query)}`
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), 20000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(tid)
    if (!res.ok) {
      console.warn(`[Custom] ${site.name} search HTTP ${res.status}`)
      return []
    }
    const data = await res.json()
    const list = (data as any)?.list
    if (!Array.isArray(list)) return []
    return list
      .map((v: CmsVodItem) => vodItemToSearchResult(v, site.key, site.name, site.weight))
      .filter((r: SearchResult) => r.id && r.title && r.episodes.length > 0)
  } catch (e) {
    console.warn(`[Custom] ${site.name} search error:`, e)
    return []
  }
}

/** 拉取单个源详情(苹果 CMS API: ?ac=detail&ids=) */
async function getCustomDetailFromSite(
  site: CustomApiSite,
  id: string
): Promise<SearchResult | null> {
  try {
    const api = site.api
    const sep = api.includes('?') ? '&' : '?'
    const url = `${api}${sep}ac=detail&ids=${encodeURIComponent(id)}`
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), 20000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(tid)
    if (!res.ok) {
      console.warn(`[Custom] ${site.name} detail HTTP ${res.status}`)
      return null
    }
    const data = await res.json()
    const list = (data as any)?.list
    if (!Array.isArray(list) || list.length === 0) return null
    return vodItemToSearchResult(list[0], site.key, site.name, site.weight)
  } catch (e) {
    console.warn(`[Custom] ${site.name} detail error:`, e)
    return null
  }
}

export type { CustomApiSite }

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
    return apiUrl(rawUrl)
  }
  // 非 m3u8 的直链(.mp4/.flv 等),Electron video 标签可直接播放
  const isM3u8 = rawUrl.includes('.m3u') || !/\.(mp4|flv|mkv|avi|webm)(\?|$)/i.test(rawUrl)
  if (!isM3u8) return rawUrl

  // proxyMode 为真时走服务端代理(服务端会注入 UA/Referer 并重写 ts 地址)
  if (proxyMode && source) {
    return apiUrl(`/api/proxy/vod/m3u8?url=${encodeURIComponent(rawUrl)}&source=${encodeURIComponent(source)}`)
  }
  // proxyMode 为假时直连,CORS 由主进程 onHeadersReceived 注入 * 解决
  return rawUrl
}

/**
 * 自定义源播放前准备:向主进程注册该 m3u8 域名的防盗链 Referer/UA
 * 等效服务端 proxyMode 代理"注入 UA/Referer"的作用(脱离服务器后客户端直连,
 * CORS 由主进程注入 *,防盗链由 onBeforeSendHeaders 按注册域名注入)
 */
/**
 * 解析 CMS 播放中转页(常见于短剧源,如非凡 /share/{id})
 * 这类链接返回的是 text/html,真实 m3u8/mp4 藏在页面 JS 的
 *   const url = "/20260918/xxx/index.m3u8?sign=..."
 * 中(相对路径)。本函数抓取页面并提取真实流地址,相对路径转绝对。
 * 已是直链媒体(.m3u8/.mp4 等)则原样返回。结果按 URL 缓存。
 */
const streamResolveCache = new Map<string, string>()
const streamResolving = new Map<string, Promise<string>>()

/** 判断播放地址是否为需要抓取 HTML 解析的中转页(非直链媒体) */
export function needsCustomStreamResolve(rawUrl: string): boolean {
  if (!rawUrl || !/^https?:\/\//.test(rawUrl)) return false
  if (/\.(m3u8?|mp4|flv|mkv|avi|webm|ts)(\?|#|$)/i.test(rawUrl)) return false
  return /\/(share|plays?|v|vid|view|jump|redirect)\//i.test(rawUrl)
}

export async function resolveCustomStreamUrl(rawUrl: string): Promise<string> {
  if (!needsCustomStreamResolve(rawUrl)) return rawUrl

  const cached = streamResolveCache.get(rawUrl)
  if (cached) return cached
  const inflight = streamResolving.get(rawUrl)
  if (inflight) return inflight

  const task = (async (): Promise<string> => {
    try {
      const controller = new AbortController()
      const tid = setTimeout(() => controller.abort(), 12000)
      const res = await fetch(rawUrl, { redirect: 'follow', signal: controller.signal })
      clearTimeout(tid)
      const ct = res.headers.get('content-type') || ''
      // 非 HTML(已经是流/二进制)则直接用原地址
      if (!ct.includes('text/html') && !ct.includes('application/xhtml')) return rawUrl
      const html = await res.text()
      // 依次匹配: const/let/var url = "..."、 url: "..."、 任意带 .m3u8/.mp4 的引号串
      const patterns: RegExp[] = [
        /(?:const|let|var)\s+url\s*=\s*["']([^"']+)["']/i,
        /["']?url["']?\s*[:=]\s*["']([^"']+\.(?:m3u8?|mp4)(?:\?[^"']*)?)["']/i,
        /["']([^"']+\.(?:m3u8?|mp4)(?:\?[^"']*)?)["']/i,
        /(?:player_aaaa|playerData|MacPlayerConfig)\s*=\s*[\s\S]*?"url"\s*:\s*"([^"]+)"/i,
      ]
      let real = ''
      for (const p of patterns) {
        const m = html.match(p)
        if (m && m[1]) { real = m[1]; break }
      }
      if (!real) return rawUrl
      // HTML 实体解码
      real = real.replace(/&amp;/g, '&').replace(/\\\//g, '/')
      if (!/^https?:\/\//.test(real)) real = new URL(real, rawUrl).href
      console.log('[Custom] resolved share stream:', rawUrl.substring(0, 60), '->', real.substring(0, 80))
      streamResolveCache.set(rawUrl, real)
      return real
    } catch (e) {
      console.warn('[Custom] resolve share stream failed:', (e as Error).message, rawUrl)
      return rawUrl
    } finally {
      streamResolving.delete(rawUrl)
    }
  })()
  streamResolving.set(rawUrl, task)
  return task
}

export async function prepareCustomVideoPlay(
  rawUrl: string,
  source: string | undefined
): Promise<void> {
  if (!hasCustomVideo() || !rawUrl || !source) return
  try {
    const sites = await fetchCustomApiSites()
    const site = sites.find((s) => s.key === source)
    if (!site) return
    // 防盗链 Referer 优先用资源站前台域名(detail),回退采集 API 域名
    let referer = ''
    try {
      referer = new URL(site.detail || site.api).origin + '/'
    } catch {
      referer = ''
    }
    const w = window as unknown as {
      app?: { media?: { setVideoHeaders?: (p: { url: string; referer?: string }) => Promise<unknown> } }
    }
    if (w?.app?.media?.setVideoHeaders) {
      await w.app.media.setVideoHeaders({ url: rawUrl, referer })
    }
  } catch {
    // 防盗链注册失败不阻断播放(多数源无需 Referer)
  }
}

/* ============ 站点配置 ============ */
export async function getServerConfig(): Promise<ServerConfig> {
  const res = await client.get<ServerConfig>('/api/server-config')
  return res.data
}

/* ============ 搜索 ============ */
/** 资源源列表(无需鉴权) */
export async function getSearchResources(): Promise<SearchResource[]> {
  if (hasCustomVideo()) {
    const sites = await fetchCustomApiSites()
    return sites.map((s) => ({
      key: s.key,
      name: s.name,
      api: s.api,
      detail: s.detail,
      type: 'custom',
      weight: s.weight,
    }))
  }
  const res = await client.get<SearchResource[]>('/api/search/resources')
  return res.data
}

/** 一次性聚合搜索 */
export async function search(query: string, special = false): Promise<SearchResult[]> {
  if (hasCustomVideo()) {
    const sites = sortSitesByWeight(await fetchCustomApiSites())
    const collected: SearchResult[] = []
    await runWithConcurrency(sites, 10, async (s) => {
      const r = await searchCustomSite(s, query)
      if (r.length) collected.push(...r)
    })
    return collected
  }
  const res = await client.get<{ results: SearchResult[] }>('/api/search', {
    params: { q: query, special: special ? 1 : 0 }
  })
  return res.data.results
}

/**
 * 并发限制池:最多同时运行 limit 个 worker,按入队顺序补位。
 * 自定义聚合搜索有数十个跨主机源,无限制 Promise.all 会瞬时占用大量 socket、
 * 拖慢优质源,故限制并发(死站由各自超时兜底,不影响已完成源的结果展示)。
 */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0
  const size = Math.max(1, limit)
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      await worker(items[i], i)
    }
  })
  await Promise.all(runners)
}

/** 按 weight 降序稳定排序(无 weight 的源排在末尾,保持原相对顺序) */
function sortSitesByWeight(sites: CustomApiSite[]): CustomApiSite[] {
  return sites
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (b.s.weight ?? 0) - (a.s.weight ?? 0) || a.i - b.i)
    .map((x) => x.s)
}

/**
 * SSE 流式搜索(边搜边出结果)
 * - 服务器模式: 通过 fetch + ReadableStream 解析 text/event-stream
 * - 自定义源模式: 对每个 api_site 并发(限流)调用苹果 CMS API,每完成一个出一个 source_result 事件
 */
export function searchStream(
  query: string,
  onEvent: (e: SearchSSEEvent) => void,
  special = false
): { cancel: () => void; done: Promise<void> } {
  const controller = new AbortController()

  // 自定义源分支:并行搜索每个 api_site,模拟 SSE 事件
  if (hasCustomVideo()) {
    const done = (async () => {
      try {
        const sites = await fetchCustomApiSites()
        if (controller.signal.aborted) return
        if (sites.length === 0) {
          // 源列表加载失败,给出用户可见提示
          onEvent({ type: 'start', query, totalSources: 0, timestamp: Date.now() })
          onEvent({
            type: 'source_error',
            source: 'custom',
            sourceName: '自定义视频源',
            error: '源列表加载失败,请检查设置中的视频点播源 URL',
            timestamp: Date.now(),
          })
          onEvent({ type: 'complete', totalResults: 0, completedSources: 1, timestamp: Date.now() })
          return
        }
        // 权重高的源优先入队,配合并发池让优质源更早返回;事件仍按完成顺序发出
        const orderedSites = sortSitesByWeight(sites)
        onEvent({ type: 'start', query, totalSources: orderedSites.length, timestamp: Date.now() })
        let totalResults = 0
        let completedSources = 0
        // 限流并发(最多 10 个源同时请求),避免数十个跨主机连接同时建立
        await runWithConcurrency(orderedSites, 10, async (site) => {
          if (controller.signal.aborted) return
          try {
            const results = await searchCustomSite(site, query)
            if (controller.signal.aborted) return
            totalResults += results.length
            completedSources++
            onEvent({
              type: 'source_result',
              source: site.key,
              sourceName: site.name,
              results,
              timestamp: Date.now(),
            })
          } catch (e) {
            if (controller.signal.aborted) return
            completedSources++
            onEvent({
              type: 'source_error',
              source: site.key,
              sourceName: site.name,
              error: (e as Error).message,
              timestamp: Date.now(),
            })
          }
        })
        if (controller.signal.aborted) return
        onEvent({
          type: 'complete',
          totalResults,
          completedSources,
          timestamp: Date.now(),
        })
      } catch (e) {
        if (controller.signal.aborted) return
        onEvent({
          type: 'source_error',
          source: '',
          sourceName: '',
          error: (e as Error).message,
          timestamp: Date.now(),
        })
        onEvent({ type: 'complete', totalResults: 0, completedSources: 0, timestamp: Date.now() })
      }
    })()
    return { cancel: () => controller.abort(), done }
  }

  // 服务器模式:SSE 流式
  const url = apiUrl(`/api/search/ws?q=${encodeURIComponent(query)}&special=${special ? 1 : 0}`)
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
  if (hasCustomVideo()) {
    const sites = await fetchCustomApiSites()
    const site = sites.find((s) => s.key === source)
    if (!site) throw new Error(`自定义源 ${source} 不存在`)
    const r = await getCustomDetailFromSite(site, id)
    if (!r) throw new Error('未找到详情')
    return r
  }
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

/* ============ 搜索历史 ============
 * 本地优先(localStorage,服务器/自定义源双模式均可用),
 * 服务器模式下额外同步到服务端(多端一致),同步失败不影响本地。
 */
const SEARCH_HISTORY_KEY = 'mtvp:search:history'
const SEARCH_HISTORY_MAX = 20

function readLocalHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function writeLocalHistory(list: string[]): void {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(list.slice(0, SEARCH_HISTORY_MAX)))
  } catch {
    // 配额失败等:忽略,不影响搜索主流程
  }
}

/** 合并去重(本地在前),服务端历史追加在后 */
function mergeHistory(local: string[], remote: string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const kw of [...local, ...remote]) {
    const k = kw.trim()
    if (k && !seen.has(k)) {
      seen.add(k)
      merged.push(k)
    }
  }
  return merged.slice(0, SEARCH_HISTORY_MAX)
}

export async function getSearchHistory(): Promise<string[]> {
  const local = readLocalHistory()
  // 服务器模式:尝试拉取服务端历史并合并(自定义源/离线时直接用本地)
  if (getBaseUrl()) {
    try {
      const res = await client.get<string[]>('/api/searchhistory')
      if (Array.isArray(res.data)) {
        const merged = mergeHistory(local, res.data)
        writeLocalHistory(merged)
        return merged
      }
    } catch {
      // 服务端不可用:降级到本地
    }
  }
  return local
}

/** 保存搜索关键词:本地即时生效,服务器模式后台同步,返回最新历史列表 */
export async function saveSearchHistory(keyword: string): Promise<string[]> {
  const kw = keyword.trim()
  const prev = readLocalHistory()
  const next = kw ? [kw, ...prev.filter((h) => h !== kw)].slice(0, SEARCH_HISTORY_MAX) : prev
  writeLocalHistory(next)

  if (kw && getBaseUrl()) {
    // 后台同步,不阻塞 UI;失败保留本地
    client.post<string[]>('/api/searchhistory', { keyword: kw }).catch(() => {})
  }
  return next
}

/** 删除单条搜索历史(带 keyword)或清空全部(不带):本地即时生效,服务器模式后台同步 */
export async function clearSearchHistory(keyword?: string): Promise<boolean> {
  const kw = keyword?.trim()
  const next = kw
    ? readLocalHistory().filter((h) => h !== kw)
    : []
  writeLocalHistory(next)

  if (getBaseUrl()) {
    const params = kw ? { keyword: kw } : {}
    client.delete('/api/searchhistory', { params }).catch(() => {})
  }
  return true
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
  return res.data?.success === true
}

export async function logoutAllDevices(): Promise<boolean> {
  const res = await client.post('/api/auth/devices')
  return res.data?.success === true
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

/** 豆瓣榜单内存缓存(自定义源直连):key=`${kind}|${type}`,避免展开重复请求 */
const doubanCatCache = new Map<string, DoubanCategoryItem[]>()

/**
 * 自定义源模式直连豆瓣公开榜单 API
 * GET https://movie.douban.com/j/search_subjects?type=movie|tv&tag=热门|综艺
 * 返回真实热门片单与评分;播放仍由自定义 CMS 源标题聚合搜索完成
 */
async function fetchDoubanCategoriesDirect(
  kind: 'movie' | 'tv',
  type: string,
  limit: number
): Promise<DoubanCategoryItem[]> {
  const isShow = type === 'show'
  const dbType = kind === 'movie' ? 'movie' : 'tv'
  const tag = isShow ? '综艺' : '热门'
  const cacheKey = `${kind}|${type}`
  const cached = doubanCatCache.get(cacheKey)
  const want = Math.min(Math.max(limit, 24), 100)
  if (cached && cached.length >= want) return cached.slice(0, want)

  const url =
    `https://movie.douban.com/j/search_subjects?type=${dbType}` +
    `&tag=${encodeURIComponent(tag)}&sort=recommend&page_limit=${want}&page_start=0`
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`Douban HTTP ${res.status}`)
    const data = await res.json()
    const list: DoubanCategoryItem[] = (data?.subjects || []).map((s: any) => ({
      id: String(s.id ?? ''),
      title: String(s.title || '').trim(),
      // 小图替换为大图,首页卡片更清晰
      poster: String(s.cover || '').replace('/s_ratio_poster/', '/l_ratio_poster/'),
      rate: s.rate ? String(s.rate) : '',
      year: '',
    }))
    if (list.length > 0) doubanCatCache.set(cacheKey, list)
    return list
  } finally {
    clearTimeout(tid)
  }
}

/** 豆瓣分类列表(热门电影/电视剧/综艺) */
export async function getDoubanCategories(
  kind: 'movie' | 'tv',
  category: string,
  type: string,
  limit = 30
): Promise<DoubanCategoryItem[]> {
  if (hasCustomVideo()) {
    // 自定义源:直连豆瓣公开榜单获取热门片单+评分
    // (点击卡片走标题聚合搜索,由 CMS 源匹配可播放地址)
    try {
      return await fetchDoubanCategoriesDirect(kind, type, limit)
    } catch (e) {
      console.warn('[Custom] douban categories error:', e)
      return []
    }
  }
  const res = await client.get('/api/douban/categories', {
    params: { kind, category, type, limit }
  })
  return res.data?.list || []
}

/** TMDB 趋势(首页轮播 Banner) */
export async function getTmdbTrending(): Promise<TmdbTrendingItem[]> {
  if (hasCustomVideo()) {
    // 自定义源无 TMDB,用采集源电影分类的最新内容作为 Banner
    const r =
      (await findCustomCategorySource('movie')) ||
      (await findCustomCategorySource('tv'))
    if (!r) return []
    const resp = await getCmsVideos(r.site.api, r.typeId, 1)
    return resp.list
      .filter((v) => !!v.vod_pic)
      .slice(0, 8)
      .map((v) => {
        const sr = vodItemToSearchResult(v, r.site.key, r.site.name)
        return {
          id: sr.id,
          title: sr.title,
          backdrop_path: sr.poster,
          poster_path: sr.poster,
          release_date: sr.year || '',
          overview: sr.desc || v.vod_remarks || '',
          vote_average: 0,
          media_type: 'movie',
          genres: sr.type_name ? [sr.type_name] : [],
          video_key: null,
          custom: sr,
        }
      })
  }
  const res = await client.get('/api/tmdb/trending')
  return res.data?.list || []
}

/** TMDB 即将上映 */
export async function getTmdbUpcoming(): Promise<TmdbTrendingItem[]> {
  const res = await client.get('/api/tmdb/upcoming')
  return res.data?.list || []
}

/** 短剧采集源 */
export interface DuanjuSource {
  key: string
  name: string
  api: string
  typeId?: string
  typeName?: string
}

/** 短剧分页响应(/api/duanju/videos) */
export interface DuanjuVideosResp {
  data: DuanjuItem[]
  total: number
  page: number
  pageCount: number
}

/** 短剧采集源列表 */
export async function getDuanjuSources(): Promise<DuanjuSource[]> {
  if (hasCustomVideo()) {
    const r = await findCustomCategorySource('duanju')
    return r ? [{ key: r.site.key, name: r.site.name, api: r.site.api, typeId: String(r.typeId) }] : []
  }
  const res = await client.get('/api/duanju/sources')
  return res.data?.data || []
}

/* ============ 自定义源:CMS 直连(首页板块) ============ */

/** 直连苹果 CMS API(ac=list / ac=videolist) */
async function fetchCmsJson(
  apiUrl: string,
  params: Record<string, string | number>
): Promise<any> {
  const sep = apiUrl.includes('?') ? '&' : '?'
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
  const url = `${apiUrl}${sep}${qs}`
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`CMS HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(tid)
  }
}

/** 首页板块分类类型 */
export type HomeCatKind = 'movie' | 'tv' | 'show' | 'duanju'

/**
 * 苹果 CMS 分类名评分:选出最匹配板块的分类
 * "电影"父分类通常只有几条,真正影片在"动作片/喜剧片/科幻片"等子分类
 */
function scoreHomeCategory(kind: HomeCatKind, rawName: string): number {
  const n = rawName.trim()
  if (!n) return 0
  if (kind === 'movie') {
    if (n === '电影') return 100
    if (n === '动漫电影') return 95
    // 以"片"结尾的电影子分类(动作片/喜剧片/科幻片/爱情片/恐怖片/剧情片/战争片/惊悚片)
    // 排除"综艺片/动漫片/纪录片/伦理片"(以"片"结尾但非电影)
    if (/片$/.test(n) && !/综艺片|动漫片|动画片|纪录片|伦理片|预告片|资讯|新闻/.test(n)) return 85
    if (/电影/.test(n) && !/短剧|动漫|动画|综艺|纪录|剧\s*集|资讯|新闻/.test(n)) return 80
    return 0
  }
  if (kind === 'tv') {
    if (n === '连续剧' || n === '电视剧') return 100
    if (/连续剧|电视剧|剧集/.test(n)) return 90
    // 以"剧"结尾的剧集子分类(国产剧/香港剧/欧美剧/韩剧/日本剧/台湾剧/泰国剧/海外剧)
    if (/剧$/.test(n) && !/综艺|短剧|动漫|纪录/.test(n)) return 80
    return 0
  }
  if (kind === 'show') {
    if (n === '综艺片' || n === '综艺') return 100
    if (/综艺/.test(n)) return 90
    if (/演唱会/.test(n)) return 80
    if (/真人秀/.test(n)) return 70
    return 0
  }
  // duanju: 短剧/反转爽剧/现代都市/古装仙侠/悬疑烧脑/重生民国/穿越现代/言情总裁 等
  if (n === '短剧' || n === '短剧大全') return 100
  if (/短剧/.test(n)) return 95
  if (/重生民国|穿越现代|反转爽剧|言情总裁|现代都市|古装仙侠|悬疑烧脑/.test(n)) return 85
  if (/网络剧|微剧/.test(n)) return 60
  return 0
}

interface ResolvedCatSource {
  site: CustomApiSite
  typeId: string | number
}

/** 各板块"源+分类"解析结果缓存(运行期),避免多板块重复扫描 */
const resolvedCatCache = new Map<HomeCatKind, ResolvedCatSource | null>()
/** CMS 分类列表缓存(apiUrl 维度,多板块共享) */
const cmsCategoriesCache = new Map<string, CmsCategory[]>()

/**
 * 为指定首页板块找到内容最丰富的"采集源+分类"
 * 扫描前 8 个候选源,对每个源按评分降序逐个探活匹配分类,
 * "电影"父分类通常数据少,自动降级到"动作片/喜剧片"等子分类
 */
async function findCustomCategorySource(kind: HomeCatKind): Promise<ResolvedCatSource | null> {
  if (resolvedCatCache.has(kind)) return resolvedCatCache.get(kind)!
  const sites = await fetchCustomApiSites()
  let best: (ResolvedCatSource & { count: number }) | null = null
  for (const site of sites.slice(0, 8)) {
    try {
      const cats = await getCmsCategories(site.api)
      // 收集所有匹配分类,按评分降序
      const matched = cats
        .map((c) => ({
          id: c.type_id,
          name: String(c.type_name),
          score: scoreHomeCategory(kind, String(c.type_name)),
        }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score)
      if (matched.length === 0) continue
      // 从最高分开始探活,找到第一个有效条目足够的分类就停
      for (const mc of matched) {
        const probe = await getCmsVideos(site.api, mc.id, 1)
        const validCount = probe.list.filter((v) => !!v.vod_pic && !!v.vod_name).length
        const total = probe.total || validCount
        if (total >= 6 && (!best || total > best.count)) {
          best = { site, typeId: mc.id, count: total }
          break // 该源已找到可用分类,不再探其他分类
        }
      }
    } catch {
      // 单源失败尝试下一个
    }
  }
  const resolved: ResolvedCatSource | null = best
    ? { site: best.site, typeId: best.typeId }
    : null
  resolvedCatCache.set(kind, resolved)
  return resolved
}

/** CMS 采集站分类 */
export interface CmsCategory {
  type_id: string | number
  type_name: string
}

/** CMS 原始视频条目(苹果 CMS vod 结构) */
export interface CmsVodItem {
  vod_id: string | number
  vod_name: string
  vod_pic?: string
  vod_remarks?: string
  vod_play_from?: string
  vod_play_url?: string
  vod_class?: string
  vod_year?: string
  vod_content?: string
  vod_douban_id?: number
  type_name?: string
}

/** CMS 分页响应 */
export interface CmsVideoListResp {
  code: number
  page: number
  pagecount: number
  total: number
  list: CmsVodItem[]
}

/** 获取指定采集源的全部分类 */
export async function getCmsCategories(apiUrl: string): Promise<CmsCategory[]> {
  if (hasCustomVideo()) {
    const cached = cmsCategoriesCache.get(apiUrl)
    if (cached) return cached
    const data = await fetchCmsJson(apiUrl, { ac: 'list' })
    const list: CmsCategory[] = data?.class || []
    if (list.length > 0) cmsCategoriesCache.set(apiUrl, list)
    return list
  }
  const res = await client.get('/api/cms-proxy', {
    params: { api: apiUrl, ac: 'list' }
  })
  return res.data?.class || []
}

/** 按分类分页获取采集站视频 */
export async function getCmsVideos(
  apiUrl: string,
  typeId: string | number,
  page: number
): Promise<CmsVideoListResp> {
  if (hasCustomVideo()) {
    const data = await fetchCmsJson(apiUrl, { ac: 'videolist', t: typeId, pg: page })
    return {
      code: data?.code ?? 0,
      page: data?.page || page,
      pagecount: data?.pagecount || 0,
      total: data?.total || 0,
      list: data?.list || []
    }
  }
  const res = await client.get('/api/cms-proxy', {
    params: { api: apiUrl, ac: 'videolist', t: typeId, pg: page }
  })
  return {
    code: res.data?.code ?? 0,
    page: res.data?.page || page,
    pagecount: res.data?.pagecount || 0,
    total: res.data?.total || 0,
    list: res.data?.list || []
  }
}

/**
 * 短剧视频列表(分页)
 * @param source 采集源 key
 * @param categoryId 短剧分类 ID
 * @param page 页码,从 1 开始
 */
export async function getDuanjuVideos(
  source: string,
  categoryId: string,
  page: number
): Promise<DuanjuVideosResp> {
  if (hasCustomVideo()) {
    const sites = await fetchCustomApiSites()
    const site = sites.find((s) => s.key === source)
    if (!site) return { data: [], total: 0, page, pageCount: 0 }
    const resp = await getCmsVideos(site.api, categoryId, page)
    const data: DuanjuItem[] = resp.list
      .filter((v) => !!v.vod_name)
      .map((v) => {
        const sr = vodItemToSearchResult(v, site.key, site.name)
        return {
          id: sr.id,
          title: sr.title,
          poster: sr.poster,
          episodes: sr.episodes,
          episodes_titles: sr.episodes_titles,
          source: site.key,
          source_name: site.name,
          class: sr.class || '',
          year: sr.year || '',
          desc: sr.desc || '',
          type_name: sr.type_name || '',
          douban_id: 0,
        }
      })
    return { data, total: resp.total, page: resp.page, pageCount: resp.pagecount }
  }
  const res = await client.get('/api/duanju/videos', {
    params: { source, categoryId, page }
  })
  return {
    data: res.data?.data || [],
    total: res.data?.total || 0,
    page: res.data?.page || page,
    pageCount: res.data?.pageCount || 0
  }
}
