import { client } from './api'
import { apiUrl } from './auth'
import { hasCustomMusic, getCustomMusicSource } from './customSource'

export interface MusicSong {
  songId: string
  source: string
  name: string
  artist: string
  album?: string
  /** 封面 URL(服务端字段为 cover) */
  cover?: string
  /** 旧字段兼容 */
  pic?: string
  /** 时长文本(如 "03:45") */
  durationText?: string
  /** 时长秒数 */
  durationSec?: number
  /** 旧字段兼容 */
  duration?: number
  songmid?: string
  hash?: string
  copyrightId?: string
  albumId?: string
  lrcUrl?: string
  mrcUrl?: string
  trcUrl?: string
  /** 自定义源原始条目(POST /api/music/url 时原样回传) */
  raw?: unknown
}

export interface MusicSearchResult {
  list: MusicSong[]
  page: number
  limit: number
  hasMore: boolean
}

export interface MusicLyric {
  lyric: string
  tlyric?: string
}

/* ============ 自定义音乐源(脱离 moontvplus 服务器,直连 LX Music Web / lxserver) ============ *
 * lxserver 真实 API(与 Huibq 不同):
 * - 搜索: GET  /api/music/search?name={kw}&source={source}&page={page}&limit={limit}
 * - 播放: POST /api/music/url  body: { songInfo: 原始歌曲对象, quality } → { url, type, sourceName }
 * - 歌词: GET  /api/music/lyric?source=&songmid=&name=&singer=&albumId=&hash=&interval=...
 * - 认证: 头 x-user-name + x-user-token(匿名访问不带)
 */

/** 构造 lxserver 认证头 */
function buildCustomMusicHeaders(extra?: Record<string, string>): Record<string, string> {
  const { token, username } = getCustomMusicSource()
  const headers: Record<string, string> = { ...extra }
  if (token) {
    if (username) headers['x-user-name'] = username
    headers['x-user-token'] = token
  }
  return headers
}

/** 自定义源 fetch(带认证与超时),失败返回 null */
async function customMusicFetch(path: string, init?: RequestInit): Promise<any | null> {
  const { url } = getCustomMusicSource()
  const fullUrl = `${url.replace(/\/$/, '')}${path}`
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), 20000)
  try {
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string> || {}),
    }
    Object.assign(headers, buildCustomMusicHeaders())
    const res = await fetch(fullUrl, {
      ...init,
      headers,
      signal: controller.signal,
    })
    clearTimeout(tid)
    if (!res.ok) {
      let errBody = ''
      try { errBody = (await res.text()).substring(0, 120) } catch { /* ignore */ }
      console.warn(`[CustomMusic] HTTP ${res.status} for ${path} ${errBody}`)
      return null
    }
    return await res.json()
  } catch (e) {
    clearTimeout(tid)
    console.warn(`[CustomMusic] fetch error for ${path}:`, e)
    return null
  }
}

/** 归一化 lxserver 搜索条目为 MusicSong(保留原始对象供播放 API 回传) */
function normalizeCustomSearchData(data: any): MusicSong[] {
  const list: any[] = Array.isArray(data) ? data : (Array.isArray(data?.list) ? data.list : [])
  return list
    .map((s: any) => ({
      songId: String(s.songmid || s.songId || s.id || s.hash || s.copyrightId || ''),
      source: String(s.source || ''),
      name: String(s.name || s.songname || s.title || ''),
      artist: String(s.singer || s.artist || s.singername || ''),
      album: s.albumName || s.album || undefined,
      cover: s.img || s.cover || s.pic || undefined,
      pic: s.pic || undefined,
      durationText: s.interval || s.durationText || undefined,
      durationSec: typeof s.duration === 'number' ? s.duration : undefined,
      duration: typeof s.duration === 'number' ? s.duration : undefined,
      songmid: s.songmid ? String(s.songmid) : undefined,
      hash: s.hash || undefined,
      copyrightId: s.copyrightId || undefined,
      albumId: s.albumId ? String(s.albumId) : undefined,
      lrcUrl: s.lrcUrl || undefined,
      mrcUrl: s.mrcUrl || undefined,
      trcUrl: s.trcUrl || undefined,
      raw: s,
    }))
    .filter((s: MusicSong) => s.songId && s.name)
}

export async function searchMusic(q: string, source = 'kw', page = 1, limit = 20): Promise<MusicSearchResult> {
  if (hasCustomMusic()) {
    const params = new URLSearchParams({
      name: q,
      source,
      page: String(page),
      limit: String(limit),
    })
    const data = await customMusicFetch(`/api/music/search?${params.toString()}`)
    if (!data) return { list: [], page, limit, hasMore: false }
    const list = normalizeCustomSearchData(data)
    const total = (data as any)?.total || 0
    const hasMore = list.length >= limit && (total === 0 || page * limit < total)
    return { list, page, limit, hasMore }
  }
  const res = await client.get('/api/music/v2/search', { params: { q, source, page, limit } })
  return res.data?.data || { list: [], page, limit, hasMore: false }
}

/**
 * 从服务端获取音乐播放 URL
 * - moontvplus 服务器模式: 走 /api/music/v2/play
 * - 自定义源模式: POST lxserver /api/music/url,body { songInfo, quality }
 */
export async function getMusicUrlFromServer(song: MusicSong, quality = '320k'): Promise<string | null> {
  if (hasCustomMusic()) {
    if (!song.raw && !song.songId) {
      console.warn('[CustomMusic] No song info for URL fetch:', song.name)
      return null
    }
    const songInfo = song.raw ?? song
    const qualityList = Array.from(new Set([quality, '320k', '192k', '128k']))
    for (const q of qualityList) {
      const reqId = Math.random().toString(36).slice(2) + Date.now().toString(36)
      const data = await customMusicFetch('/api/music/url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-req-id': reqId,
        },
        body: JSON.stringify({
          songInfo,
          quality: q,
          enableAutoSwitchApiSource: true,
        }),
      })
      const url = data?.url
      if (typeof url === 'string' && url.length > 10) {
        console.log(`[CustomMusic] Got URL: q=${q} url=${url.substring(0, 80)}`)
        return url
      }
    }
    console.warn('[CustomMusic] All URL attempts failed for:', song.name, song.artist)
    return null
  }
  try {
    console.log('[Server] Fetching URL for:', song.name, 'source:', song.source)
    const res = await client.post('/api/music/v2/play', { song }, { timeout: 10000 })
    const data = res.data?.data
    const play = data?.play
    if (!play) {
      console.warn('[Server] No play object in response:', JSON.stringify(data).substring(0, 200))
      return null
    }
    // 优先使用 directUrl(CDN 直链,<audio> 可直接播放,无 CORS/认证问题)
    if (play.directUrl && typeof play.directUrl === 'string' && /^https?:\/\//.test(play.directUrl)) {
      console.log('[Server] Got directUrl:', play.directUrl.substring(0, 80))
      return play.directUrl
    }
    // 退而求其次:使用服务端代理流 URL(相对路径需拼接 baseUrl)
    if (play.url && typeof play.url === 'string') {
      const streamUrl = play.url.startsWith('http') ? play.url : apiUrl(play.url)
      console.log('[Server] Got stream URL:', streamUrl.substring(0, 80))
      return streamUrl
    }
    console.warn('[Server] No URL in play object:', JSON.stringify(play).substring(0, 200))
    return null
  } catch (err: any) {
    const status = err?.response?.status
    if (status === 404) {
      console.warn('[Server] Play API endpoint not found (404)')
    } else {
      console.warn('[Server] Play API error:', status || err?.message || err)
    }
    return null
  }
}

/**
 * 获取歌词
 * - moontvplus 服务器模式: 走 /api/music/v2/lyric
 * - 自定义源模式: GET lxserver /api/music/lyric?source=&songmid=&name=&singer=...
 */
export async function getMusicLyric(song: MusicSong): Promise<MusicLyric> {
  if (hasCustomMusic()) {
    const params = new URLSearchParams({
      source: song.source || '',
      songmid: song.songmid || song.songId || '',
      name: song.name || '',
      singer: song.artist || '',
      hash: song.hash || '',
      interval: song.durationText || '',
      copyrightId: song.copyrightId || '',
      albumId: song.albumId || '',
      lrcUrl: song.lrcUrl || '',
      mrcUrl: song.mrcUrl || '',
      trcUrl: song.trcUrl || '',
    })
    const data = await customMusicFetch(`/api/music/lyric?${params.toString()}`)
    const lyric = data?.lyric || data?.lrc || ''
    if (lyric) {
      return {
        lyric,
        tlyric: data.tlyric || undefined,
      }
    }
    return { lyric: '', tlyric: undefined }
  }
  const res = await client.post('/api/music/v2/lyric', { song })
  return res.data?.data || { lyric: '', tlyric: undefined }
}

/**
 * Huibq 公共音源 API
 * 作为服务端 play API 的备用方案
 * API 文档: https://github.com/pdone/lx-music-source/tree/main/huibq
 *
 * 浏览器开发模式: 使用 /huibq 相对路径,由 Vite 代理转发(绕过 CORS)
 * Electron 模式: 直接请求 HTTPS URL(webSecurity:false 已绕过 CORS)
 */
const HUIBQ_API_BASE = typeof window !== 'undefined' && !(window as any).app
  ? '/huibq'  // 浏览器开发模式: Vite 代理
  : 'https://lxmusicapi.onrender.com'  // Electron: 直连
const HUIBQ_API_KEY = 'share-v3'
/** Huibq 已知支持的源: kw(酷我), wy(网易云), tx(QQ音乐); kg/mg 无法获取播放链接 */
const HUIBQ_SUPPORTED_SOURCES = ['kw', 'wy', 'tx']

export async function getMusicUrlFromHuibq(song: MusicSong, quality = '320k'): Promise<string | null> {
  // 源不支持直接返回,避免浪费时间尝试
  if (!HUIBQ_SUPPORTED_SOURCES.includes(song.source)) {
    console.warn(`[Huibq] Source "${song.source}" not supported, skipping`)
    return null
  }

  // songId 带有源前缀(如 "tx_xxx", "kg_xxx"),Huibq 不识别前缀
  // 优先使用 songmid/hash/copyrightId 等原始 ID
  const rawSongId = song.songId ? song.songId.replace(/^(tx|kg|mg|kw|wy)_/, '') : ''

  // 收集所有可能的 ID 字段,按可靠性排序
  const idCandidates = [
    song.songmid,      // 原始 ID,最可靠
    song.hash,         // 酷狗使用 hash
    song.copyrightId,  // 咪咕使用 copyrightId
    rawSongId,         // 去除前缀后的 songId
  ].filter(Boolean) as string[]

  if (idCandidates.length === 0) {
    console.warn('[Huibq] No song ID found in song object:', song.name, song.artist)
    return null
  }

  // 质量降级列表：先试高质量，失败则降低。去重避免重复尝试
  const qualityList = Array.from(new Set([quality, '320k', '192k', '128k']))
  const triedIds = new Set<string>()

  for (const songId of idCandidates) {
    if (triedIds.has(songId)) continue
    triedIds.add(songId)

    for (const q of qualityList) {
      try {
        const url = `${HUIBQ_API_BASE}/url/${song.source}/${songId}/${q}`
        console.log(`[Huibq] Trying: source=${song.source} id=${songId} quality=${q}`)
        // render.com 免费实例可能有冷启动,用 15 秒超时
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15000)
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'X-Request-Key': HUIBQ_API_KEY,
          },
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        if (!res.ok) {
          console.warn(`[Huibq] HTTP ${res.status} for id=${songId} quality=${q}`)
          continue
        }
        const data = await res.json()
        // 检查响应有效性：Huibq API 对 kg/mg 源可能返回 code=0 但 msg="无法获取播放链接！"
        // 同时返回一个无效的 kuwo.cn 占位 URL，必须检查 msg 字段过滤掉
        const errorMsg = typeof data.msg === 'string' ? data.msg : ''
        const isErrorMsg = errorMsg.includes('无法获取') || errorMsg.includes('失败') || errorMsg.includes('错误') || errorMsg.includes('error') || errorMsg.includes('failed')
        // URL 基本有效性检查:必须是 http(s) 开头的字符串
        const isValidUrl = typeof data.url === 'string' && data.url.length > 10 && /^https?:\/\//.test(data.url)
        if (data.code === 0 && isValidUrl && !isErrorMsg) {
          console.log(`[Huibq] Success: id=${songId} quality=${q} url=${data.url.substring(0, 60)}...`)
          return data.url
        }
        console.warn(`[Huibq] No URL: code=${data.code} msg=${data.msg} id=${songId} q=${q}`)
      } catch (err) {
        console.warn(`[Huibq] Error for id=${songId} q=${q}:`, err)
      }
    }
  }

  console.warn('[Huibq] All attempts failed for song:', song.name, song.artist)
  return null
}

export async function getMusicHistory(): Promise<MusicSong[]> {
  const res = await client.get('/api/music/v2/history')
  return res.data?.data?.records || []
}

export async function saveMusicHistory(record: MusicSong, playProgressSec: number, playCount: number, lastQuality: string): Promise<void> {
  await client.post('/api/music/v2/history', { record: { ...record, playProgressSec, lastPlayedAt: Date.now(), playCount, lastQuality } })
}

export async function deleteMusicHistory(songId?: string): Promise<void> {
  await client.delete('/api/music/v2/history', { params: { songId } })
}

export async function getHotSearch(source = 'kw'): Promise<Array<{ keyword: string; name: string; artist: string }>> {
  const res = await client.get('/api/music/v2/discovery/hot-search', { params: { source } })
  return res.data?.data?.list || res.data?.list || []
}

/**
 * 自定义音乐源原生榜单
 * lxserver 无排行榜 API,直连网易云官方 Toplist API 获取真实榜单
 * (网易云 API 无需鉴权,Electron 主进程已注入 CORS *,可直接请求)
 * 榜单歌曲通过 lxserver /api/music/url 播放(网易云渠道,实测可用)
 */
const NETEASE_BOARDS: Array<{ id: string; name: string }> = [
  { id: '19723756', name: '飙升榜' },
  { id: '3779629', name: '新歌榜' },
  { id: '3778678', name: '热歌榜' },
  { id: '2884035', name: '原创榜' },
  { id: '71384707', name: '古典榜' },
  { id: '1978921795', name: '电音榜' },
  { id: '991319590', name: '中文说唱榜' },
  { id: '745956260', name: 'ACG榜' },
]
const NETEASE_API = 'https://music.163.com/api'

/** 从网易云榜单 API 拉取歌曲并转换为 lxserver 可播放的 MusicSong */
async function fetchNeteaseBoardSongs(boardId: string, limit = 100): Promise<MusicSong[]> {
  const url = `${NETEASE_API}/v6/playlist/detail?id=${boardId}&n=${limit}`
  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return []
    const data = await res.json()
    const tracks = data?.playlist?.tracks || []
    return tracks.map((t: any) => {
      const artists = (t.ar || []).map((a: any) => a.name).filter(Boolean)
      const artist = artists.join(' / ')
      const album = t.al?.name || ''
      const cover = t.al?.picUrl || ''
      const dt = t.dt || 0
      const mm = Math.floor(dt / 60000)
      const ss = Math.floor((dt % 60000) / 1000)
      const durationText = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
      // 保存完整 songInfo 给 lxserver /api/music/url 使用
      const raw = {
        source: 'wy',
        songmid: String(t.id),
        name: t.name,
        singer: artist,
        interval: durationText,
        hash: '',
        copyrightId: '',
        albumId: t.al?.id ? String(t.al.id) : '',
        albumName: album,
        lrcUrl: '',
        mrcUrl: '',
        trcUrl: '',
      }
      return {
        songId: `wy_${t.id}`,
        source: 'wy',
        songmid: String(t.id),
        name: t.name,
        artist,
        album,
        cover,
        durationText,
        durationSec: Math.floor(dt / 1000),
        raw,
      } as MusicSong
    })
  } finally {
    clearTimeout(tid)
  }
}

export async function getBoards(source = 'kw'): Promise<Array<{ id: string; name: string; cover: string; source: string }>> {
  if (hasCustomMusic()) {
    return NETEASE_BOARDS.map((b) => ({
      id: b.id,
      name: b.name,
      cover: '',
      source,
    }))
  }
  const res = await client.get('/api/music/v2/discovery/boards', { params: { source } })
  return res.data?.data?.list || res.data?.list || []
}

export async function getBoardSongs(source: string, boardId: string, page = 1): Promise<{ list: MusicSong[]; total: number; page: number }> {
  if (hasCustomMusic()) {
    const all = await fetchNeteaseBoardSongs(boardId, 100)
    const pageSize = 30
    const start = (page - 1) * pageSize
    const list = all.slice(start, start + pageSize)
    return { list, total: all.length, page }
  }
  const res = await client.get('/api/music/v2/discovery/board-songs', { params: { source, boardId, page } })
  const data = res.data?.data || res.data
  return { list: data?.list || [], total: data?.total || 0, page: data?.page || page }
}
