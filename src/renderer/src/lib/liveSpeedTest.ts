/**
 * 直播线路测速
 *
 * 思路:拉取 m3u8 → 找到首个媒体分片 → 下载分片开头的一小段数据,
 *       测首包延迟(ms)与吞吐(kbps),约 3 秒内完成单条线路测速。
 * 结果按 URL 持久化到 localStorage,供自动换线时优先选择快线路。
 */

const PLAYLIST_TIMEOUT_MS = 5000
/** 下载测速数据的时长上限 */
const DOWNLOAD_TIME_LIMIT_MS = 2500
/** 累计下载字节达到该值即停止 */
const DOWNLOAD_BYTES_TARGET = 400 * 1024
/** 整条测速硬超时(含播放表解析) */
const HARD_TIMEOUT_MS = 12000

export interface LineSpeed {
  /** 是否测速成功(拿到有效数据) */
  ok: boolean
  /** 首包延迟 ms */
  latencyMs: number
  /** 吞吐 kbps */
  kbps: number
  /** 测速时间戳 */
  at: number
}

function fetchText(url: string): Promise<string> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), PLAYLIST_TIMEOUT_MS)
  return fetch(url, { signal: ctl.signal }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  }).finally(() => clearTimeout(timer))
}

/** 解析播放表,返回首个媒体分片的绝对 URL(变体播放表最多深入 2 层) */
async function resolveFirstSegment(url: string, depth = 0): Promise<string> {
  const text = await fetchText(url)
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  // 变体播放表:取第一个子播放表
  const variantIdx = lines.findIndex((l) => l.startsWith('#EXT-X-STREAM-INF'))
  if (variantIdx >= 0 && depth < 2) {
    const child = lines.slice(variantIdx + 1).find((l) => !l.startsWith('#'))
    if (child) return resolveFirstSegment(new URL(child, url).href, depth + 1)
  }
  // 媒体播放表:第一个非注释行即首个分片
  const seg = lines.find((l) => !l.startsWith('#'))
  if (!seg) throw new Error('播放表中无分片')
  return new URL(seg, url).href
}

/** 测速单条线路 */
export async function measureLine(url: string): Promise<LineSpeed> {
  const at = Date.now()
  const hardCtl = new AbortController()
  const hardTimer = setTimeout(() => hardCtl.abort(), HARD_TIMEOUT_MS)
  try {
    const segUrl = await resolveFirstSegment(url)
    const start = performance.now()
    const res = await fetch(segUrl, { signal: hardCtl.signal })
    const latencyMs = Math.round(performance.now() - start)
    if (!res.ok || !res.body) return { ok: false, latencyMs, kbps: 0, at }

    const reader = res.body.getReader()
    const dlCtl = new AbortController()
    const dlTimer = setTimeout(() => dlCtl.abort(), DOWNLOAD_TIME_LIMIT_MS)
    let bytes = 0
    const dlStart = performance.now()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value?.length ?? 0
        if (bytes >= DOWNLOAD_BYTES_TARGET) break
        if (performance.now() - dlStart >= DOWNLOAD_TIME_LIMIT_MS) break
      }
    } catch {
      // 下载超时 abort:已下载的数据仍可用于估算
    } finally {
      clearTimeout(dlTimer)
      dlCtl.abort()
    }
    const seconds = Math.max((performance.now() - dlStart) / 1000, 0.05)
    const kbps = Math.round((bytes * 8) / seconds / 1000)
    return { ok: bytes >= 16 * 1024, latencyMs, kbps, at }
  } catch {
    return { ok: false, latencyMs: 0, kbps: 0, at }
  } finally {
    clearTimeout(hardTimer)
  }
}

/* ============ 结果持久化 ============ */
const SPEED_STORE_KEY = 'mtvp:live:speed'
const SPEED_STORE_MAX = 500
/** 测速结果有效期:24h,过期视为未知(线路质量会变化) */
const SPEED_TTL_MS = 24 * 3600 * 1000

export function readSpeedMap(): Record<string, LineSpeed> {
  try {
    const raw = localStorage.getItem(SPEED_STORE_KEY)
    const obj = raw ? JSON.parse(raw) : {}
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

export function recordSpeed(url: string, s: LineSpeed): void {
  try {
    const map = readSpeedMap()
    const keys = Object.keys(map)
    if (keys.length >= SPEED_STORE_MAX && map[url] === undefined) delete map[keys[0]]
    map[url] = s
    localStorage.setItem(SPEED_STORE_KEY, JSON.stringify(map))
  } catch {
    // 存储失败忽略
  }
}

/** 读取某 URL 的有效测速结果(过期/不存在返回 undefined) */
export function getKnownSpeed(url: string): LineSpeed | undefined {
  const s = readSpeedMap()[url]
  return s && Date.now() - s.at < SPEED_TTL_MS ? s : undefined
}

/** 格式化速率显示 */
export function formatSpeed(kbps: number): string {
  if (kbps <= 0) return '—'
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${kbps} Kbps`
}
