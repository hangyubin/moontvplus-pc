import { client } from './api'
import { hasCustomLive, getCustomLiveSource, getCustomLiveEpg } from './customSource'
import { parseM3U, extractTvgUrl, parseXmltvEpg, parseXmltvFull, normalizeEpgKey, type EpgProgramFull } from './m3u'

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
/** 完整时间戳版 EPG 缓存(自定义模式直接解析得到,含真实日期/时区) */
let cachedEpgFullMap: Record<string, EpgProgramFull[]> | null = null

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
  cachedEpgFullMap = null
  return { text, tvgUrl: extractTvgUrl(text), channels }
}

/** 解析当前生效的 EPG URL:用户手动配置优先,其次 M3U 头部 x-tvg-url */
function resolveEpgUrl(): string | null {
  const manual = getCustomLiveEpg()
  if (manual) return manual
  return extractTvgUrl(cachedM3UText)
}

async function fetchCustomEpg(): Promise<Record<string, LiveEpgProgram[]>> {
  if (cachedEpgMap) return cachedEpgMap
  const tvgUrl = resolveEpgUrl()
  if (!tvgUrl) return {}
  try {
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), 30000)
    const res = await fetch(tvgUrl, { signal: controller.signal })
    clearTimeout(tid)
    if (!res.ok) return {}
    const xml = await readMaybeGzip(res, tvgUrl)
    const map = parseXmltvEpg(xml)
    // 同时缓存完整时间戳版本
    cachedEpgFullMap = parseXmltvFull(xml)
    cachedEpgUrl = tvgUrl
    cachedEpgMap = map
    return map
  } catch {
    return {}
  }
}

/**
 * 读取响应文本,兼容 .xml.gz(URL 以 .gz 结尾且浏览器未自动解压的情况)。
 * 常规 HTTP content-encoding: gzip 浏览器会自动解压,无需处理;
 * 这里仅针对静态 .xml.gz 文件(application/gzip 等非编码响应)。
 */
async function readMaybeGzip(res: Response, url: string): Promise<string> {
  const isGzFile = /\.gz(\?|$)/i.test(url)
  if (!isGzFile) return res.text()
  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)
  // gzip magic number 1f 8b:确认确实是 gzip 数据
  if (bytes.byteLength < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
    return new TextDecoder('utf-8').decode(bytes)
  }
  try {
    const ds = new DecompressionStream('gzip')
    const decompressed = new Response(new Blob([buf]).stream().pipeThrough(ds))
    return await decompressed.text()
  } catch {
    return new TextDecoder('utf-8').decode(buf)
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
    return map[tvgId] || map[normalizeEpgKey(tvgId)] || []
  }
  try {
    const res = await client.get('/api/live/epg', { params: { source, tvgId } })
    return res.data?.data?.programs || []
  } catch {
    return []
  }
}

/** 简易 HH:MM 节目列表按"今天"补齐为完整时间戳(服务端 EPG 兜底路径) */
function simpleToFull(programs: LiveEpgProgram[], channel: string): EpgProgramFull[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return programs.map((p) => {
    const [sh, sm] = p.start.split(':').map(Number)
    const [eh, em] = p.end.split(':').map(Number)
    return {
      startMs: today.getTime() + (sh || 0) * 3600000 + (sm || 0) * 60000,
      endMs: today.getTime() + (eh || 0) * 3600000 + (em || 0) * 60000,
      start: p.start,
      end: p.end,
      title: p.title,
      desc: p.desc,
      channel
    }
  })
}

/**
 * 获取完整时间戳版 EPG(用于精确判断当前/下一节目、跨午夜)
 * - 自定义模式:直接由 XMLTV 解析(含真实日期与时区)
 * - 服务器模式:简易 HH:MM 按今天补齐
 */
export async function getLiveEpgFull(source: string, tvgId: string): Promise<EpgProgramFull[]> {
  if (hasCustomLive()) {
    await fetchCustomEpg()
    return cachedEpgFullMap?.[tvgId] || cachedEpgFullMap?.[normalizeEpgKey(tvgId)] || []
  }
  const simple = await getLiveEpg(source, tvgId)
  return simpleToFull(simple, tvgId)
}

/** 清除 EPG 内存缓存(设置中更换 EPG URL / 直播源后调用) */
export function clearLiveEpgCache(): void {
  cachedEpgUrl = ''
  cachedEpgMap = null
  cachedEpgFullMap = null
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
