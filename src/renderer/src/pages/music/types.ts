/**
 * 音乐页共享类型与工具
 */
import type { MusicSong } from '../../lib/music'

/** 可选音乐源 */
export const SOURCES = [
  { id: 'kw', name: '酷我' },
  { id: 'wy', name: '网易云' },
  { id: 'tx', name: 'QQ音乐' },
  { id: 'kg', name: '酷狗' },
  { id: 'mg', name: '咪咕' }
]

/** 榜单条目 */
export interface MusicBoard {
  id: string
  name: string
  cover: string
  source: string
}

/** 解析后的歌词行 */
export interface LyricLine {
  time: number
  text: string
  translation?: string
}

/** 解析 LRC 歌词文本为按时间排序的行数组 */
export function parseLyric(lrc: string): LyricLine[] {
  if (!lrc) return []
  const result: LyricLine[] = []
  const timeRegex = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g
  for (const raw of lrc.split('\n')) {
    const matches = [...raw.matchAll(timeRegex)]
    const text = raw.replace(timeRegex, '').trim()
    if (matches.length === 0) continue
    for (const m of matches) {
      const min = parseInt(m[1], 10) || 0
      const sec = parseInt(m[2], 10) || 0
      const ms = parseInt(m[3] ? m[3].padEnd(3, '0') : '0', 10) || 0
      result.push({ time: min * 60 + sec + ms / 1000, text })
    }
  }
  result.sort((a, b) => a.time - b.time)
  return result
}

export type { MusicSong }
