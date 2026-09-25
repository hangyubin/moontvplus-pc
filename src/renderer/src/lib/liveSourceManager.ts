/**
 * 直播源管理器
 *
 * 支持多个直播源(替代原来单一 custom_live_source):
 * - URL 导入: http(s) 链接,指向 M3U 或 txt(自定义格式)
 * - 本地文件导入: 用户选择 .m3u/.m3u8/.txt 文件,内容直接持久化
 * - 自动分组: 解析后按 group 聚合
 * - 有效性检测: 批量 HEAD 探测(可选手动触发)
 *
 * 存储: localStorage(键 mtvp:live:sources),结构持久化
 * 兼容: 旧的 custom_live_source 自动迁移为首条源
 */

import { parseM3U, extractTvgUrl, checkStreams, type StreamCheckResult } from './m3u'
import { getCustomLiveSource } from './customSource'

const STORAGE_KEY = 'mtvp:live:sources'
/** 单源 M3U 内容持久化上限(防止 localStorage 爆量) */
const MAX_M3U_PERSIST_CHARS = 500 * 1024 // 500KB

/** 直播源条目 */
export interface ManagedLiveSource {
  /** 唯一 ID(时间戳+随机) */
  id: string
  /** 用户可编辑的名称 */
  name: string
  /** URL(http/https)或 'local'(本地导入) */
  url: string
  /** 来源类型 */
  type: 'url' | 'local'
  /** 本地导入时缓存的 M3U 原始文本(URL 类型不持久化,用缓存) */
  m3uText?: string
  /** 解析后的频道数(持久化,用于列表显示) */
  channelCount?: number
  /** 上次解析时间(Unix ms) */
  lastParsedAt?: number
  /** 是否启用(停用则不出现在直播页源列表) */
  enabled: boolean
  /** 创建时间 */
  createdAt: number
}

/** 解析后的分组频道 */
export interface ParsedSourceChannels {
  source: ManagedLiveSource
  /** 按 group 分组的频道名列表 */
  groups: Record<string, string[]>
  /** 频道总数 */
  totalChannels: number
  /** EPG 地址(若 M3U 含 x-tvg-url) */
  tvgUrl: string | null
  /** 原始频道列表 */
  channels: { name: string; url: string; group?: string; tvgId?: string; tvgLogo?: string }[]
}

/* ============ 内部工具 ============ */

function generateId(): string {
  return `src_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function readAll(): ManagedLiveSource[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeAll(list: ManagedLiveSource[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch (e) {
    console.error('[liveSourceManager] persist failed', e)
  }
}

/** 迁移旧的单一 custom_live_source 为列表首条(仅首次) */
function migrateLegacy(): void {
  const legacy = getCustomLiveSource()
  if (!legacy) return
  const existing = readAll()
  if (existing.some((s) => s.url === legacy)) return
  const migrated: ManagedLiveSource = {
    id: generateId(),
    name: '自定义直播(迁移)',
    url: legacy,
    type: 'url',
    enabled: true,
    createdAt: Date.now(),
  }
  writeAll([migrated, ...existing])
}

/* ============ 公开 API ============ */

/** 获取所有管理的直播源(自动迁移旧配置) */
export function getManagedLiveSources(): ManagedLiveSource[] {
  migrateLegacy()
  return readAll()
}

/** 添加 URL 类型的直播源 */
export function addLiveSourceFromUrl(name: string, url: string): ManagedLiveSource {
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('URL 必须以 http:// 或 https:// 开头')
  }
  const src: ManagedLiveSource = {
    id: generateId(),
    name: name.trim() || new URL(trimmed).hostname,
    url: trimmed,
    type: 'url',
    enabled: true,
    createdAt: Date.now(),
  }
  const list = readAll()
  writeAll([...list, src])
  return src
}

/** 添加本地文件内容的直播源(txt/m3u 文本) */
export function addLiveSourceFromLocal(name: string, content: string): ManagedLiveSource {
  const trimmedName = name.trim() || '本地直播源'
  if (content.length > MAX_M3U_PERSIST_CHARS) {
    throw new Error(`文件过大(>${Math.round(MAX_M3U_PERSIST_CHARS / 1024)}KB),请改用 URL 导入`)
  }
  const src: ManagedLiveSource = {
    id: generateId(),
    name: trimmedName,
    url: 'local',
    type: 'local',
    m3uText: content,
    enabled: true,
    createdAt: Date.now(),
  }
  const list = readAll()
  writeAll([...list, src])
  return src
}

/** 更新直播源(名称/启用状态/解析统计) */
export function updateLiveSource(id: string, patch: Partial<Pick<ManagedLiveSource, 'name' | 'enabled' | 'channelCount' | 'lastParsedAt'>>): void {
  const list = readAll()
  const idx = list.findIndex((s) => s.id === id)
  if (idx === -1) return
  list[idx] = { ...list[idx], ...patch }
  writeAll(list)
}

/** 删除直播源 */
export function removeLiveSource(id: string): void {
  writeAll(readAll().filter((s) => s.id !== id))
}

/** 清空全部直播源 */
export function clearAllLiveSources(): void {
  writeAll([])
}

/* ============ 解析与分组 ============ */

/** 从 URL 拉取 M3U 文本 */
async function fetchM3UFromUrl(url: string): Promise<string> {
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(tid)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } catch (e: any) {
    clearTimeout(tid)
    throw new Error(e?.name === 'AbortError' ? '下载超时(30s)' : `下载失败: ${e?.message || '网络错误'}`)
  }
}

/**
 * 解析指定直播源,返回分组后的频道结构
 * 解析成功会更新 channelCount 和 lastParsedAt
 */
export async function parseLiveSource(id: string): Promise<ParsedSourceChannels> {
  const src = readAll().find((s) => s.id === id)
  if (!src) throw new Error('直播源不存在')

  let text = ''
  if (src.type === 'local') {
    if (!src.m3uText) throw new Error('本地源内容为空')
    text = src.m3uText
  } else {
    text = await fetchM3UFromUrl(src.url)
  }

  const channels = parseM3U(text)
  const tvgUrl = extractTvgUrl(text)

  // 按 group 分组
  const groups: Record<string, string[]> = {}
  for (const ch of channels) {
    const g = (ch.group || '未分组').trim()
    if (!groups[g]) groups[g] = []
    groups[g].push(ch.name)
  }

  // 更新持久化信息
  updateLiveSource(id, {
    channelCount: channels.length,
    lastParsedAt: Date.now(),
  })

  return {
    source: { ...src, channelCount: channels.length, lastParsedAt: Date.now() },
    groups,
    totalChannels: channels.length,
    tvgUrl,
    channels,
  }
}

/* ============ 有效性检测 ============ */

export interface SourceHealthReport {
  totalUrls: number
  okCount: number
  failCount: number
  results: StreamCheckResult[]
}

/**
 * 检测源内所有频道流地址的有效性(批量 HEAD)
 * 仅对前 N 个频道采样(避免数千频道全量探测),默认 50
 */
export async function checkSourceHealth(
  id: string,
  sampleSize = 50,
  onProgress?: (done: number, total: number) => void
): Promise<SourceHealthReport> {
  const parsed = await parseLiveSource(id)
  const urls = parsed.channels.slice(0, sampleSize).map((c) => c.url)
  const results = await checkStreams(urls, onProgress)
  const okCount = results.filter((r) => r.ok).length
  return {
    totalUrls: urls.length,
    okCount,
    failCount: urls.length - okCount,
    results,
  }
}

/* ============ 导入辅助 ============ */

/**
 * 从用户选择的文件读取文本内容
 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file, 'utf-8')
  })
}

/** 根据文件名猜测是否为支持的直播源格式 */
export function isSupportedLiveFile(name: string): boolean {
  return /\.(m3u8?|txt)$/i.test(name)
}
