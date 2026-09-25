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

/**
 * 简易 XMLTV EPG 解析
 * 提取 <programme start stop channel> 块及其 <title>/<desc>
 * 返回以 channel tvg-id 为键的节目列表
 */
export function parseXmltvEpg(xml: string): Record<string, LiveEpgProgram[]> {
  const result: Record<string, LiveEpgProgram[]> = {}
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
    if (!result[channel]) result[channel] = []
    result[channel].push({
      start: formatXmltvTime(start),
      end: formatXmltvTime(stop),
      title: decodeXmlEntities((titleMatch ? titleMatch[1] : '').trim()),
      desc: descMatch ? decodeXmlEntities(descMatch[1].trim()) : undefined,
    })
  }
  return result
}

function formatXmltvTime(s: string): string {
  // XMLTV 时间格式: 20240101120000 +0800 / 20240101120000Z
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/)
  if (!m) return s
  return `${m[4]}:${m[5]}`
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
