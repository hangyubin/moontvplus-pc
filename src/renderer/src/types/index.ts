/**
 * MoonTVPlus PC 客户端类型定义
 * 对齐服务端 src/lib/types.ts 与 src/lib/auth.ts
 */

/** 认证信息(对应服务端 AuthInfo,URL编码JSON token 的内容) */
export interface AuthInfo {
  password?: string
  username?: string
  signature?: string
  timestamp?: number
  role?: 'owner' | 'admin' | 'user'
  tokenId?: string
  refreshToken?: string
  refreshExpires?: number
}

/** 登录响应 */
export interface LoginResponse {
  ok: boolean
  token: string
  auth: AuthInfo
  message?: string
  needPasswordChange?: boolean
}

/** 播放记录(观看历史)— 对齐服务端 PlayRecord */
export interface PlayRecord {
  title: string
  source_name: string
  cover: string
  year: string
  index: number
  total_episodes: number
  play_time: number
  total_time: number
  save_time: number
  search_title: string
  new_episodes?: number
}

/** 播放记录集合(以 key=source+id 为键) */
export type PlayRecordMap = Record<string, PlayRecord>

/** 收藏 — 对齐服务端 Favorite */
export interface Favorite {
  source_name: string
  total_episodes: number
  title: string
  year: string
  cover: string
  save_time: number
  search_title: string
  origin?: 'vod' | 'live'
  is_completed?: boolean
  vod_remarks?: string
}

export type FavoriteMap = Record<string, Favorite>

/** 搜索结果项 — 对齐服务端 SearchResult */
export interface SearchResult {
  id: string
  title: string
  poster: string
  episodes: string[]
  episodes_titles: string[]
  source: string
  source_name: string
  weight?: number
  year: string
  desc: string
  type_name: string
  class?: string
  douban_id?: string
  vod_remarks?: string
  vod_total?: number
  proxyMode?: boolean
}

/** 资源源(站点)列表项 */
export interface SearchResource {
  key: string
  name: string
  api?: string
  detail?: string
  type?: string
  isScript?: boolean
  weight?: number
}

/** SSE 搜索事件 */
export type SearchSSEEvent =
  | { type: 'start'; query: string; totalSources: number; timestamp: number }
  | { type: 'source_result'; source: string; sourceName: string; results: SearchResult[]; timestamp: number }
  | { type: 'source_error'; source: string; sourceName: string; error: string; timestamp: number }
  | { type: 'complete'; totalResults: number; completedSources: number; timestamp: number }

/** 豆瓣推荐项 */
export interface DoubanItem {
  id: number | string
  title: string
  poster: string
  rate: number | string
  year: string
  type?: string
}

/** 豆瓣分类项(/api/douban/categories 返回) */
export interface DoubanCategoryItem {
  id: string
  title: string
  poster: string
  rate: string
  year: string
  /** 自定义源模式:携带完整可播放结果,点击直接进详情而非跳搜索 */
  custom?: SearchResult
}

/** TMDB 趋势项(/api/tmdb/trending 返回) */
export interface TmdbTrendingItem {
  id: string
  title: string
  backdrop_path: string
  poster_path: string
  release_date: string
  overview: string
  vote_average: number
  media_type: string
  genres: string[]
  video_key: string | null
  /** 自定义源模式:携带完整可播放结果,点击直接进详情而非跳搜索 */
  custom?: SearchResult
}

/** 短剧推荐项(/api/duanju/recommends 返回,结构类似 SearchResult) */
export interface DuanjuItem {
  id: string
  title: string
  poster: string
  episodes: string[]
  episodes_titles: string[]
  source: string
  source_name: string
  class: string
  year: string
  desc: string
  type_name: string
  douban_id: number
}

/** 站点配置(server-config 返回) */
export interface ServerConfig {
  SiteName: string
  StorageType: string
  Version: string
  TVModeEnabled?: boolean
  EnableRegistration?: boolean
  LoginRequireTurnstile?: boolean
  TurnstileSiteKey?: string
  EnableOIDCLogin?: boolean
}

/** 设备信息 */
export interface DeviceInfo {
  tokenId: string
  deviceInfo?: string
  createdAt?: number
  lastUsed?: number
  expiresAt?: number
  isCurrent?: boolean
}

/** 跳过配置(片头片尾) */
export interface SkipConfig {
  enable: boolean
  intro_time: number
  outro_time: number
}

/** 生成存储 key:source+id */
export function generateStorageKey(source: string, id: string): string {
  return `${source}+${id}`
}

/** 从 key 解析 source 与 id */
export function parseStorageKey(key: string): { source: string; id: string } {
  const idx = key.indexOf('+')
  if (idx === -1) return { source: key, id: '' }
  return { source: key.slice(0, idx), id: key.slice(idx + 1) }
}
