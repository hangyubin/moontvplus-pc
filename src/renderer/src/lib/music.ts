import { client } from './api'

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
}

export interface MusicSearchResult {
  list: MusicSong[]
  page: number
  limit: number
  hasMore: boolean
}

export interface MusicPlayInfo {
  url: string
  directUrl?: string
  quality: string
  requestedQuality: string
}

export interface MusicLyric {
  lyric: string
  tlyric?: string
}

export async function searchMusic(q: string, source = 'kw', page = 1, limit = 20): Promise<MusicSearchResult> {
  const res = await client.get('/api/music/v2/search', { params: { q, source, page, limit } })
  return res.data?.data || { list: [], page, limit, hasMore: false }
}

export async function getMusicPlayUrl(song: MusicSong, quality = '320k'): Promise<{ play: MusicPlayInfo; lyric: MusicLyric }> {
  const res = await client.post('/api/music/v2/play', { song, quality, includeUrl: true })
  const data = res.data?.data
  const play = data?.play
  // 中间件使用 cookie 认证，但 <audio> 元素跨域不会携带 cookie。
  // 优先使用 directUrl（上游音频直链）绕过中间件，避免认证失败。
  if (play?.directUrl) {
    play.url = play.directUrl
  }
  return { play, lyric: data?.lyric || {} }
}

export async function getMusicLyric(song: MusicSong): Promise<MusicLyric> {
  const res = await client.post('/api/music/v2/lyric', { song })
  return res.data?.data || {}
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

export async function getBoards(source = 'kw'): Promise<Array<{ id: string; name: string; cover: string; source: string }>> {
  const res = await client.get('/api/music/v2/discovery/boards', { params: { source } })
  return res.data?.data?.list || res.data?.list || []
}

export async function getBoardSongs(source: string, boardId: string, page = 1): Promise<{ list: MusicSong[]; total: number; page: number }> {
  const res = await client.get('/api/music/v2/discovery/board-songs', { params: { source, boardId, page } })
  const data = res.data?.data || res.data
  return { list: data?.list || [], total: data?.total || 0, page: data?.page || page }
}
