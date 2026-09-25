/**
 * 本地 M3U / XMLTV 解析器
 * 用于「自定义直播源」场景,脱离服务端在客户端直接解析 M3U 播放列表
 */
import type { LiveChannel, LiveEpgProgram } from './live'

/**
 * 解析 M3U/M3U8 播放列表文本,返回频道列表
 * 支持 #EXTM3U 头部(可含 x-tvg-url)和 #EXTINF 条目
 */
export function parseM3U(text: string): LiveChannel[] {
  const lines = text.split(/\r?\n/)
  const channels: LiveChannel[] = []
  let current: Partial<LiveChannel> | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#EXTM3U')) {
      // 头部信息,不处理(EPG URL 由 extractTvgUrl 单独管理)
      continue
    }
    if (line.startsWith('#EXTINF')) {
      // 格式: #EXTINF duration tvg-name="..." tvg-logo="..." group-title="...",频道名
      const infoMatch = line.match(/#EXTINF[^,]*,(.*)$/)
      const name = infoMatch ? infoMatch[1].trim() : ''
      const attrs: Record<string, string> = {}
      const attrRegex = /([a-zA-Z0-9_-]+)="([^"]*)"/g
      let m: RegExpExecArray | null
      while ((m = attrRegex.exec(line)) !== null) {
        attrs[m[1].toLowerCase()] = m[2]
      }
      current = {
        name,
        tvgId: attrs['tvg-id'],
        tvgLogo: attrs['tvg-logo'],
        group: attrs['group-title'] || '未分组',
      }
      continue
    }
    if (line.startsWith('#')) continue // 其他 directive 跳过
    // 流 URL
    if (current) {
      channels.push({
        name: current.name || '未命名频道',
        url: line,
        tvgId: current.tvgId,
        tvgLogo: current.tvgLogo,
        logo: current.tvgLogo,
        group: current.group,
      })
      current = null
    } else {
      channels.push({ name: '未命名频道', url: line, group: '未分组' })
    }
  }
  return channels
}

/**
 * 提取 M3U 头部 x-tvg-url 属性(XMLTV EPG 地址)
 */
export function extractTvgUrl(text: string): string | null {
  const m = text.match(/#EXTM3U[^\r\n]*x-tvg-url="([^"]+)"/)
  return m ? m[1] : null
}

/* ============================================================
 * XMLTV EPG 解析(增强版)
 *
 * 完整保留 <programme> 的开始/结束时间(Unix 毫秒)、标题、描述、分类、图标。
 * 支持时区偏移 (+0800)、UTC Z 后缀,以及 start/stop/channel 属性任意顺序。
 * 兼容 CDATA 包裹的标题/描述。
 * ============================================================ */

/** 单个 EPG 节目(完整字段) */
export interface EpgProgramFull {
  /** 开始时间 Unix 毫秒 */
  startMs: number
  /** 结束时间 Unix 毫秒 */
  endMs: number
  /** 开始时间 "HH:MM" */
  start: string
  /** 结束时间 "HH:MM" */
  end: string
  /** 节目名 */
  title: string
  /** 描述 */
  desc?: string
  /** 分类标签 */
  category?: string
  /** 图标 URL */
  icon?: string
  /** 频道 tvg-id */
  channel: string
}

/** XMLTV 时间转 Unix 毫秒(失败返回 0) */
export function parseXmltvTimeMs(s: string): number {
  // 20240101120000 +0800 / 20240101120000Z / 20240101120000
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2})|Z)?/)
  if (!m) return 0
  const year = parseInt(m[1], 10)
  const month = parseInt(m[2], 10) - 1
  const day = parseInt(m[3], 10)
  const hour = parseInt(m[4], 10)
  const minute = parseInt(m[5], 10)
  const second = parseInt(m[6], 10)
  let offsetMin = 0
  if (m[7] && m[8] && m[9]) {
    offsetMin = (parseInt(m[8], 10) * 60 + parseInt(m[9], 10)) * (m[7] === '+' ? 1 : -1)
  } else if (s.includes('Z')) {
    offsetMin = 0
  }
  // 用 UTC 构造,再减去时区偏移(转为 UTC)
  return Date.UTC(year, month, day, hour, minute - offsetMin, second)
}

/** 解析完整 XMLTV 文本,返回 channel tvg-id → 节目数组(按开始时间升序) */
export function parseXmltvFull(xml: string): Record<string, EpgProgramFull[]> {
  const result: Record<string, EpgProgramFull[]> = {}
  // 兼容 channel 在 start/stop 前后任意顺序
  const regex =
    /<programme\b[^>]*?(?:\bstart="([^"]+)"[^>]*?\bstop="([^"]+)"|\bstop="([^"]+)"[^>]*?\bstart="([^"]+)")[^>]*?\bchannel="([^"]+)"[^>]*>([\s\S]*?)<\/programme>/g
  let m: RegExpExecArray | null
  while ((m = regex.exec(xml)) !== null) {
    const start = m[1] || m[4] || ''
    const stop = m[2] || m[3] || ''
    const channel = m[5] || ''
    const body = m[6] || ''
    const titleMatch = body.match(/<title[^>]*>([\s\S]*?)<\/title>/)
    const descMatch = body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/)
    const categoryMatch = body.match(/<category[^>]*>([\s\S]*?)<\/category>/)
    const iconMatch = body.match(/<icon\s+src="([^"]+)"/)

    const startMs = parseXmltvTimeMs(start)
    const endMs = parseXmltvTimeMs(stop)
    if (!result[channel]) result[channel] = []
    result[channel].push({
      startMs,
      endMs,
      start: msToHHMM(startMs),
      end: msToHHMM(endMs),
      title: decodeXmlEntities((titleMatch ? stripCdata(titleMatch[1]) : '').trim()),
      desc: descMatch ? decodeXmlEntities(stripCdata(descMatch[1]).trim()) : undefined,
      category: categoryMatch ? decodeXmlEntities(stripCdata(categoryMatch[1]).trim()) : undefined,
      icon: iconMatch ? iconMatch[1] : undefined,
      channel,
    })
  }
  // 按开始时间排序
  for (const key of Object.keys(result)) {
    result[key].sort((a, b) => a.startMs - b.startMs)
  }
  return result
}

/** 旧版简易解析(兼容现有 live.ts 调用),返回 HH:MM 字符串格式 */
export function parseXmltvEpg(xml: string): Record<string, LiveEpgProgram[]> {
  const full = parseXmltvFull(xml)
  const result: Record<string, LiveEpgProgram[]> = {}
  for (const [key, arr] of Object.entries(full)) {
    result[key] = arr.map((p) => ({
      start: p.start,
      end: p.end,
      title: p.title,
      desc: p.desc,
    }))
  }
  return result
}

function msToHHMM(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

function stripCdata(s: string): string {
  const m = s.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/)
  return m ? m[1] : s
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

/** 在 EPG 缓存中查找指定 tvgId 的当前节目(取首个 start<=now<end) */
export function findCurrentProgram(programs: LiveEpgProgram[]): LiveEpgProgram | null {
  if (!programs.length) return null
  const now = new Date()
  const nowHHMM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
  for (const p of programs) {
    if (p.start <= nowHHMM && nowHHMM < p.end) return p
  }
  return programs[0] // 兜底返回首个
}

/* ============ 当前/下一节目查找(基于完整毫秒时间) ============ */

export interface CurrentNextProgram {
  current: EpgProgramFull | null
  next: EpgProgramFull | null
}

/**
 * 在排序好的完整 EPG 列表中查找当前/下一节目(基于 Unix 毫秒精确判断)
 */
export function findCurrentNextFull(programs: EpgProgramFull[], nowMs?: number): CurrentNextProgram {
  const now = nowMs ?? Date.now()
  let current: EpgProgramFull | null = null
  let next: EpgProgramFull | null = null
  for (const p of programs) {
    if (p.startMs <= now && now < p.endMs) {
      current = p
    } else if (p.startMs >= now) {
      next = p
      break
    }
  }
  return { current, next }
}

/* ============ M3U 流有效性检测(HEAD 请求) ============ */

export interface StreamCheckResult {
  url: string
  ok: boolean
  status: number
  latencyMs: number
  error?: string
}

/**
 * 检测单个流地址是否可用(HEAD 请求,3秒超时)
 */
export async function checkStream(url: string, timeoutMs = 3000): Promise<StreamCheckResult> {
  const start = Date.now()
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal })
    clearTimeout(tid)
    return { url, ok: res.ok, status: res.status, latencyMs: Date.now() - start }
  } catch (e: any) {
    clearTimeout(tid)
    return {
      url,
      ok: false,
      status: 0,
      latencyMs: Date.now() - start,
      error: e?.name === 'AbortError' ? '超时' : (e?.message || '网络错误'),
    }
  }
}

/**
 * 并发批量检测流地址,返回每个 URL 的结果
 * 限制并发数为 6,避免同时发起过多 HEAD 请求
 */
export async function checkStreams(
  urls: string[],
  onProgress?: (done: number, total: number) => void
): Promise<StreamCheckResult[]> {
  const results: StreamCheckResult[] = []
  const CONCURRENCY = 6
  let idx = 0
  let done = 0

  async function worker(): Promise<void> {
    while (idx < urls.length) {
      const i = idx++
      const r = await checkStream(urls[i])
      results[i] = r
      done++
      onProgress?.(done, urls.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, () => worker()))
  return results
}
