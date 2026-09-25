/**
 * 直播页共享类型与直播记忆存取
 */
import type { LiveSource } from '../../lib/live'

/** 频道(可能包含同一源下的多个播放地址) */
export interface ChannelItem {
  name: string
  group: string
  tvgLogo?: string
  tvgId?: string
  urls: string[]
}

/** 一个直播源下的所有数据 */
export interface SourceData {
  source: LiveSource
  channels: ChannelItem[]
  loaded: boolean
}

/** 直播记忆 */
const LIVE_MEMORY_KEY = 'live-memory'
export interface LiveMemory {
  sourceKey: string
  channelName: string
  urlIndex: number
}
export function loadLiveMemory(): LiveMemory | null {
  try {
    const v = localStorage.getItem(LIVE_MEMORY_KEY)
    if (!v) return null
    const p = JSON.parse(v)
    if (p && typeof p.sourceKey === 'string') return p
  } catch {}
  return null
}
export function saveLiveMemory(m: LiveMemory) {
  try { localStorage.setItem(LIVE_MEMORY_KEY, JSON.stringify(m)) } catch {}
}
