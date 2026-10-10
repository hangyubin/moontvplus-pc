/**
 * 直播流录制器(主进程)
 *
 * 旧实现直接 fetch 播放地址并把响应体写入文件:对 HLS(m3u8)而言,响应体只是
 * 几百字节的播放列表文本,瞬间读完 → 录制"秒结束",且文件内容是文本、无法播放。
 *
 * 本模块按 HLS 规范实现真正的录制:
 *  1. 探测首个响应包,内容以 #EXTM3U 开头则按 HLS 处理,否则当作 flv/mp4 等连续流;
 *  2. HLS:先解析 master playlist 选择最高码率 variant,再轮询媒体 playlist,
 *     按媒体序列号顺序下载新出现的分片,追加拼接为 MPEG-TS(.ts,天然可逐段拼接、
 *     即使尾部截断也能被主流播放器播放);
 *  3. 支持 #EXT-X-KEY:AES-128 分片自动解密(METHOD=SAMPLE-AES 不支持);
 *  4. 直播 playlist 无 #EXT-X-ENDLIST,会持续轮询直到用户停止(abort)。
 *
 * 网络请求统一走 session.defaultSession.fetch(Chromium 网络栈),自动经过
 * onBeforeSendHeaders,携带主进程注入的 Referer/UA 等防盗链头。
 */
import { session } from 'electron'
import fs from 'fs'
import crypto from 'crypto'

/* ================= 类型 ================= */

interface KeyTag {
  method: string
  uri: string
  iv?: Buffer
}

interface SegmentInfo {
  seq: number
  uri: string
  duration: number
  key: KeyTag | null
}

interface VariantInfo {
  uri: string
  bandwidth: number
}

interface PlaylistInfo {
  master: boolean
  variants: VariantInfo[]
  /** 分片目标时长(秒) */
  targetDuration: number
  /** 首分片媒体序列号 */
  mediaSequence: number
  segments: SegmentInfo[]
  endlist: boolean
}

export interface RecordingCallbacks {
  /** 每写入一段数据回调一次(bytes=累计字节) */
  onProgress?: (bytes: number) => void
  /** 源流正常结束(VOD 播放到 ENDLIST / 直链 EOF) */
  onComplete?: (bytes: number) => void
}

const MAX_RETRY = 3
/** 直播 playlist 轮询间隔限制(秒):在 [1,3] 之间,兼顾实时性与请求量 */
const MIN_POLL_SEC = 1
const MAX_POLL_SEC = 3

/* ================= 工具函数 ================= */

function isAbortError(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError'
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      return
    }
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    signal.addEventListener('abort', onAbort)
  })
}

/**
 * 发起请求并把响应体收集为 Buffer。
 * 网络错误 / 非 2xx 会重试(直播 playlist/分片偶发抖动);abort 不重试、直接抛出。
 */
async function fetchBuffer(url: string, signal: AbortSignal): Promise<Buffer> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      const res = await session.defaultSession.fetch(url, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (!res.body) throw new Error('响应无 body')
      const chunks: Buffer[] = []
      const reader = res.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) chunks.push(Buffer.from(value))
      }
      return Buffer.concat(chunks)
    } catch (e) {
      if (isAbortError(e)) throw e
      lastErr = e
      if (attempt < MAX_RETRY) {
        await abortableSleep(500 * (attempt + 1), signal)
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('请求失败')
}

async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  return (await fetchBuffer(url, signal)).toString('utf8')
}

/* ================= m3u8 解析 ================= */

/** 解析 #EXT-X-KEY / #EXT-X-STREAM-INF 的属性串(正确处理引号内的逗号) */
function parseAttributes(line: string): Record<string, string> {
  const body = line.slice(line.indexOf(':') + 1)
  const out: Record<string, string> = {}
  let key = ''
  let val = ''
  let inQuote = false
  let readingKey = true
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '"') {
      inQuote = !inQuote
      continue
    }
    if (ch === '=' && readingKey && !inQuote) {
      readingKey = false
      continue
    }
    if (ch === ',' && !inQuote) {
      out[key.trim()] = val
      key = ''
      val = ''
      readingKey = true
      continue
    }
    if (readingKey) key += ch
    else val += ch
  }
  if (key.trim()) out[key.trim()] = val
  return out
}

/**
 * 解析 m3u8 文本。URI 一律相对 playlistUrl 解析为绝对地址。
 */
function parsePlaylist(text: string, playlistUrl: string): PlaylistInfo {
  const abs = (uri: string) => new URL(uri, playlistUrl).href
  const lines = text.split(/\r?\n/)

  const info: PlaylistInfo = {
    master: false,
    variants: [],
    targetDuration: 6,
    mediaSequence: 0,
    segments: [],
    endlist: false
  }

  let currentKey: KeyTag | null = null
  let pendingDuration = -1

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    if (line.startsWith('#EXT-X-STREAM-INF')) {
      info.master = true
      const attr = parseAttributes(line)
      // 下一个非注释行即 variant 的 URI
      for (let j = i + 1; j < lines.length; j++) {
        const u = lines[j].trim()
        if (u && !u.startsWith('#')) {
          info.variants.push({
            uri: abs(u),
            bandwidth: Number(attr.BANDWIDTH || 0)
          })
          break
        }
      }
      continue
    }

    if (line.startsWith('#EXT-X-KEY')) {
      const attr = parseAttributes(line)
      const method = attr.METHOD || 'NONE'
      if (method === 'NONE') {
        currentKey = null
      } else if (method === 'AES-128') {
        currentKey = {
          method,
          uri: abs(attr.URI || ''),
          iv: attr.IV ? Buffer.from(attr.IV.replace(/^0x/i, ''), 'hex') : undefined
        }
      } else {
        // SAMPLE-AES 等:记录但无法解密,下载分片时会给出明确错误
        currentKey = { method, uri: abs(attr.URI || '') }
      }
      continue
    }

    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      info.targetDuration = Number(line.split(':')[1]) || 6
      continue
    }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      info.mediaSequence = Number(line.split(':')[1]) || 0
      continue
    }
    if (line.startsWith('#EXTINF:')) {
      pendingDuration = Number(line.slice(8).split(',')[0]) || 0
      continue
    }
    if (line === '#EXT-X-ENDLIST') {
      info.endlist = true
      continue
    }
    if (line.startsWith('#')) continue

    // 普通行:与最近的 #EXTINF 配对成一个分片
    if (pendingDuration >= 0) {
      const seq = info.mediaSequence + info.segments.length
      info.segments.push({
        seq,
        uri: abs(line),
        duration: pendingDuration,
        key: currentKey
      })
      pendingDuration = -1
    }
  }

  return info
}

/** master playlist 选路:取最高带宽 variant */
function pickVariant(variants: VariantInfo[]): VariantInfo {
  return variants.reduce((best, v) => (v.bandwidth > best.bandwidth ? v : best), variants[0])
}

/* ================= 分片下载与解密 ================= */

/** AES-128 分片:key 按 URI 缓存;IV 缺省时由媒体序号(大端)填充 */
function sequenceIv(seq: number): Buffer {
  const iv = Buffer.alloc(16)
  iv.writeUInt32BE(seq >>> 0, 12)
  return iv
}

async function downloadSegment(
  seg: SegmentInfo,
  signal: AbortSignal,
  keyCache: Map<string, Buffer>
): Promise<Buffer> {
  const raw = await fetchBuffer(seg.uri, signal)
  if (!seg.key) return raw
  if (seg.key.method !== 'AES-128') {
    throw new Error(`不支持的加密方式: ${seg.key.method}`)
  }
  let key = keyCache.get(seg.key.uri)
  if (!key) {
    key = await fetchBuffer(seg.key.uri, signal)
    keyCache.set(seg.key.uri, key)
  }
  const iv = seg.key.iv ?? sequenceIv(seg.seq)
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv)
  return Buffer.concat([decipher.update(raw), decipher.final()])
}

/* ================= HLS 录制 ================= */

async function recordHls(
  entryUrl: string,
  initialText: string,
  filePath: string,
  signal: AbortSignal,
  cb: RecordingCallbacks
): Promise<void> {
  let playlistUrl = entryUrl
  let playlist = parsePlaylist(initialText, playlistUrl)

  // master → 选最高码率 variant,重新拉媒体 playlist
  if (playlist.master) {
    if (!playlist.variants.length) throw new Error('主播放列表中没有可用的子码率')
    playlistUrl = pickVariant(playlist.variants).uri
    playlist = parsePlaylist(await fetchText(playlistUrl, signal), playlistUrl)
    if (playlist.master) throw new Error('子播放列表仍是主播放列表')
  }

  const keyCache = new Map<string, Buffer>()
  /** 已处理分片的绝对 URL:与媒体序号构成双保险,兼容序号非标准的源 */
  const seenUrls = new Set<string>()
  let bytes = 0
  /** 已处理(写入或确认跳过)的最大媒体序号 */
  let lastSeq = playlist.mediaSequence - 1

  while (true) {
    // 按序号顺序处理本轮 playlist 中的新分片
    for (const seg of playlist.segments) {
      if (seg.seq <= lastSeq || seenUrls.has(seg.uri)) continue
      try {
        const buf = await downloadSegment(seg, signal, keyCache)
        // appendFile 每次完整开关句柄,顺序写入、天然无并发,abort 也不会残留句柄
        await fs.promises.appendFile(filePath, buf)
        bytes += buf.length
        lastSeq = seg.seq
        seenUrls.add(seg.uri)
        if (seenUrls.size > 10000) seenUrls.clear()
        cb.onProgress?.(bytes)
      } catch (e) {
        if (isAbortError(e)) throw e
        // 分片拉不到(多为已滚出直播窗口):跳过该序号,等下轮 playlist 刷新
        lastSeq = seg.seq
        seenUrls.add(seg.uri)
      }
    }

    if (playlist.endlist) {
      cb.onComplete?.(bytes)
      return
    }

    // 直播:等待后重新拉取 playlist,发现新分片
    const pollSec = Math.min(
      Math.max(Math.round(playlist.targetDuration), MIN_POLL_SEC),
      MAX_POLL_SEC
    )
    await abortableSleep(pollSec * 1000, signal)
    playlist = parsePlaylist(await fetchText(playlistUrl, signal), playlistUrl)
  }
}

/* ================= 连续流(flv/mp4/未知)录制 ================= */

async function recordRawStream(
  body: { getReader: () => ReadableStreamDefaultReader<Uint8Array> },
  head: Buffer,
  filePath: string,
  signal: AbortSignal,
  cb: RecordingCallbacks
): Promise<void> {
  void signal
  const writer = fs.createWriteStream(filePath)
  let bytes = 0

  const writeChunk = (chunk: Buffer): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      bytes += chunk.length
      cb.onProgress?.(bytes)
      if (writer.write(chunk)) resolve()
      else writer.once('drain', () => resolve())
      writer.once('error', reject)
    })

  try {
    if (head.length) await writeChunk(head)

    const reader = body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.length) await writeChunk(Buffer.from(value))
    }
    await new Promise<void>((resolve, reject) => writer.end((e: Error | null | undefined) => (e ? reject(e) : resolve())))
    cb.onComplete?.(bytes)
  } catch (e) {
    writer.destroy()
    throw e
  }
}

/* ================= 统一入口 ================= */

/**
 * 录制指定地址到 filePath。
 * 通过响应首包探测类型:#EXTM3U → HLS;否则按连续流落盘。
 * 正常结束走 cb.onComplete;被 abort 时抛出 AbortError(由调用方区分"已停止")。
 */
export async function runRecording(
  url: string,
  filePath: string,
  signal: AbortSignal,
  cb: RecordingCallbacks
): Promise<void> {
  // 打开连接允许重试,但首包探测必须基于同一次响应
  let res: Awaited<ReturnType<typeof session.defaultSession.fetch>> | null = null
  let lastErr: unknown = null
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    try {
      res = await session.defaultSession.fetch(url, { signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (!res.body) throw new Error('响应无 body')
      break
    } catch (e) {
      if (isAbortError(e)) throw e
      lastErr = e
      res = null
      if (attempt < MAX_RETRY) await abortableSleep(500 * (attempt + 1), signal)
    }
  }
  if (!res) throw lastErr instanceof Error ? lastErr : new Error('无法打开直播地址')

  if (!res.body) throw new Error('响应无 body')
  const streamBody = res.body
  const reader = streamBody.getReader()
  const { value: firstValue } = await reader.read()
  const head = Buffer.from(firstValue || [])
  const sniff = head.toString('utf8', 0, Math.min(head.length, 256))

  if (sniff.includes('#EXTM3U')) {
    // 首包就是 playlist 的一部分:读完整个响应得到完整 playlist 文本
    const chunks: Buffer[] = [head]
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(Buffer.from(value))
    }
    await recordHls(url, Buffer.concat(chunks).toString('utf8'), filePath, signal, cb)
    return
  }

  // 非 HLS:把首包连同后续响应体作为连续流写入(读取器与响应体同源)
  await recordRawStream(streamBody, head, filePath, signal, cb)
}
