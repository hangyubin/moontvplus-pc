/**
 * 音乐页歌词 hook:LRC 解析(合并翻译)、当前行/卡拉OK进度、自动滚动、显示设置
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MusicLyric } from '../../lib/music'
import { parseLyric, type LyricLine } from './types'

export function useLyrics(lyricData: MusicLyric | null, currentTime: number, duration: number) {
  /* ============ 歌词设置 ============ */
  // 卡拉OK模式:当前行按播放进度逐字填充颜色
  const [karaokeMode, setKaraokeMode] = useState(true)
  // 歌词高亮颜色
  const [lyricColor, setLyricColor] = useState(() => {
    try { return localStorage.getItem('music_lyricColor') || 'var(--color-primary)' } catch { return 'var(--color-primary)' }
  })
  // 歌词字体大小
  const [lyricFontSize, setLyricFontSize] = useState(16)
  const lyricScrollRef = useRef<HTMLDivElement>(null)
  const activeLyricRef = useRef<HTMLDivElement>(null)

  /* ============ 颜色偏好持久化(重启后保留) ============ */
  useEffect(() => {
    try { localStorage.setItem('music_lyricColor', lyricColor) } catch {}
  }, [lyricColor])

  /* ============ 歌词解析(合并翻译) ============ */
  const lyricLines = useMemo<LyricLine[]>(() => {
    const main = parseLyric(lyricData?.lyric || '')
    if (!lyricData?.tlyric) return main
    const tMap = new Map<string, string>()
    for (const t of parseLyric(lyricData.tlyric)) {
      tMap.set(t.time.toFixed(2), t.text)
    }
    return main.map((line) => ({
      ...line,
      translation: tMap.get(line.time.toFixed(2)) || ''
    }))
  }, [lyricData])

  /** 当前歌词行索引(最后一个 time <= currentTime 的行) */
  const currentLyricIndex = useMemo(() => {
    if (lyricLines.length === 0) return -1
    let idx = -1
    for (let i = 0; i < lyricLines.length; i++) {
      if (lyricLines[i].time <= currentTime) idx = i
      else break
    }
    return idx
  }, [lyricLines, currentTime])

  /** 卡拉OK进度:当前行已播放的百分比 (0~1) */
  const karaokeProgress = useMemo(() => {
    if (!karaokeMode || currentLyricIndex < 0) return 0
    const cur = lyricLines[currentLyricIndex]
    const next = lyricLines[currentLyricIndex + 1]
    const start = cur.time
    const end = next ? next.time : (duration || cur.time + 5)
    if (end <= start) return 1
    return Math.min(1, Math.max(0, (currentTime - start) / (end - start)))
  }, [karaokeMode, currentLyricIndex, lyricLines, currentTime, duration])

  // 歌词自动滚动:将当前行居中
  useEffect(() => {
    const container = lyricScrollRef.current
    const el = activeLyricRef.current
    if (!container || !el) return
    const containerRect = container.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const offset =
      elRect.top - containerRect.top - container.clientHeight / 2 + el.clientHeight / 2
    container.scrollTo({ top: container.scrollTop + offset, behavior: 'smooth' })
  }, [currentLyricIndex])

  return {
    karaokeMode,
    setKaraokeMode,
    lyricColor,
    setLyricColor,
    lyricFontSize,
    setLyricFontSize,
    lyricScrollRef,
    activeLyricRef,
    lyricLines,
    currentLyricIndex,
    karaokeProgress
  }
}
