/**
 * 首页数据缓存
 *
 * - 持久化到 localStorage,TTL 24 小时(见 ttlCache)
 * - 缓存键带"模式标识":服务器模式(baseUrl)与自定义源模式(视频源 URL)隔离,
 *   切换模式/换源后不会读到旧模式的首页数据
 * - 配合 Home 页面的 SWR 策略:启动先用缓存即时渲染,再后台拉新数据更新
 */
import { getCached, setCached, clearByPrefix, TTL_24H } from './ttlCache'
import { hasCustomVideo, getCustomVideoSource } from './customSource'
import { getBaseUrl } from './auth'

const HOME_PREFIX = 'home:'

/** 当前数据模式标识:自定义视频源优先,否则为服务器地址 */
export function getHomeModeKey(): string {
  return hasCustomVideo()
    ? `custom:${getCustomVideoSource()}`
    : `server:${getBaseUrl() || 'anonymous'}`
}

/** 读取首页某板块缓存(自动按当前模式隔离) */
export function getHomeSection<T>(section: string): T | null {
  return getCached<T>(`${HOME_PREFIX}${getHomeModeKey()}|${section}`, TTL_24H)
}

/** 写入首页某板块缓存 */
export function setHomeSection<T>(section: string, data: T): void {
  setCached(`${HOME_PREFIX}${getHomeModeKey()}|${section}`, data, TTL_24H)
}

/**
 * 清空全部首页缓存(所有模式)。
 * 切换服务器连接状态、保存自定义源时调用,强制下次进入首页重新拉取。
 */
export function clearHomeCache(): void {
  clearByPrefix(HOME_PREFIX)
}
