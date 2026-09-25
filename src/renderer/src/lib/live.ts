import { client } from './api'
import { hasCustomLive, getCustomLiveSource } from './customSource'
import { parseM3U, extractTvgUrl, parseXmltvEpg } from './m3u'

export interface LiveSource {
  key: string
  name: string
  url: string
  ua?: string
  epg?: string
  proxyMode?: string
  order?: number
}

export interface LiveChannel {
  name: string
  url: string
  tvgId?: string
  tvgLogo?: string
  logo?: string
  group?: string
}

export interface LiveEpgProgram {
  start: string
  end: string
  title: string
  desc?: string
}

const CUSTOM_KEY = 'custom'
let cachedM3UText = ''
let cachedM3UUrl = ''
let cachedChannels: LiveChannel[] | null = null
let cachedEpgUrl = ''
let cachedEpgMap: Record<string, LiveEpgProgram[]> | null = null

async function fetchCustomM3U(): Promise<{ text: string; tvgUrl: string | null; channels: LiveChannel[] }> {
  const url = getCustomLiveSource()
  if (!url) return { text: '', tvgUrl: null, channels: [] }
  if (cachedM3UUrl === url && cachedChannels) {
    return { text: cachedM3UText, tvgUrl: extractTvgUrl(cachedM3UText), channels: cachedChannels }
  }
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), 30000)
  const res = await fetch(url, { signal: controller.signal })
  clearTimeout(tid)
  if (!res.ok) throw new Error(`M3U HTTP ${res.status}`)
  const text = await res.text()
  const channels = parseM3U(text)
  cachedM3UUrl = url
  cachedM3UText = text
  cachedChannels = channels
  cachedEpgUrl = '' // M3U 变化后重置 EPG 缓存
  cachedEpgMap = null
  return { text, tvgUrl: extractTvgUrl(text), channels }
}

async function fetchCustomEpg(): Promise<Record<string, LiveEpgProgram[]>> {
  if (cachedEpgMap) return cachedEpgMap
  const tvgUrl = extractTvgUrl(cachedM3UText)
  if (!tvgUrl) return {}
  try {
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), 30000)
    const res = await fetch(tvgUrl, { signal: controller.signal })
    clearTimeout(tid)
    if (!res.ok) return {}
    const xml = await res.text()
    const map = parseXmltvEpg(xml)
    cachedEpgUrl = tvgUrl
    cachedEpgMap = map
    return map
  } catch {
    return {}
  }
}

export async function getLiveSources(): Promise<LiveSource[]> {
  if (hasCustomLive()) {
    const url = getCustomLiveSource()
    return [
      {
        key: CUSTOM_KEY,
        name: '自定义直播',
        url,
        proxyMode: 'direct',
        order: 0,
      },
    ]
  }
  try {
    const res = await client.get('/api/live/sources', { timeout: 15000 })
    console.log('[Live] getLiveSources response:', res.status, 'data:', JSON.stringify(res.data)?.substring(0, 500))
    return res.data?.data || []
  } catch (e: any) {
    console.error('[Live] getLiveSources error:', e?.response?.status, e?.response?.data, e?.message)
    throw e
  }
}

export async function getLiveChannels(source: string): Promise<LiveChannel[]> {
  if (hasCustomLive()) {
    const { channels } = await fetchCustomM3U()
    return channels
  }
  try {
    // 服务端首次加载需下载 M3U + EPG,可能较慢,给 60 秒超时
    const res = await client.get('/api/live/channels', { params: { source }, timeout: 60000 })
    console.log('[Live] getLiveChannels response:', res.status, 'channels count:', res.data?.data?.length)
    return res.data?.data || []
  } catch (e: any) {
    console.error('[Live] getLiveChannels error:', e?.response?.status, e?.response?.data, e?.message)
    throw e
  }
}

export async function getLiveEpg(source: string, tvgId: string): Promise<LiveEpgProgram[]> {
  if (hasCustomLive()) {
    const map = await fetchCustomEpg()
    return map[tvgId] || []
  }
  try {
    const res = await client.get('/api/live/epg', { params: { source, tvgId } })
    return res.data?.data?.programs || []
  } catch {
    return []
  }
}

export async function precheckLive(url: string, source: string): Promise<string> {
  if (hasCustomLive()) {
    // 自定义源直连,CORS 由主进程注入 *,无需服务端预检
    return url.includes('.flv') ? 'flv' : 'm3u8'
  }
  try {
    const res = await client.get('/api/live/precheck', { params: { url, 'moontv-source': source } })
    return res.data?.type || 'm3u8'
  } catch {
    return 'm3u8'
  }
}
