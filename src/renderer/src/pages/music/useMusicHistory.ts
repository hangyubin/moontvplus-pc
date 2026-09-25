/**
 * 音乐页播放历史 hook
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getMusicHistory, type MusicSong } from '../../lib/music'

export function useMusicHistory() {
  const [historySongs, setHistorySongs] = useState<MusicSong[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const historyRef = useRef<MusicSong[]>([])
  historyRef.current = historySongs

  /* ============ 加载播放历史 ============ */
  const loadHistory = useCallback(async () => {
    try {
      const list = await getMusicHistory()
      setHistorySongs(list || [])
    } catch {
      // 忽略错误
    }
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  return {
    historySongs,
    setHistorySongs,
    showHistory,
    setShowHistory
  }
}
