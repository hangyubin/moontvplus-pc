/**
 * 音乐页榜单数据 hook:加载榜单列表、切换榜单
 */
import { useCallback, useEffect, useState } from 'react'
import { getBoards, getBoardSongs, type MusicSong } from '../../lib/music'
import type { MusicBoard } from './types'

export function useMusicBoards(source: string) {
  const [boards, setBoards] = useState<MusicBoard[]>([])
  const [currentBoardId, setCurrentBoardId] = useState('')
  const [boardSongs, setBoardSongs] = useState<MusicSong[]>([])
  const [loadingBoards, setLoadingBoards] = useState(true)

  /* ============ 加载榜单 ============ */
  const loadBoards = useCallback(async (src: string) => {
    setLoadingBoards(true)
    try {
      const list = await getBoards(src)
      setBoards(list)
      if (list.length > 0) {
        setCurrentBoardId(list[0].id)
        const res = await getBoardSongs(src, list[0].id)
        setBoardSongs(res.list || [])
      } else {
        setCurrentBoardId('')
        setBoardSongs([])
      }
    } catch {
      setBoards([])
      setBoardSongs([])
    } finally {
      setLoadingBoards(false)
    }
  }, [])

  useEffect(() => {
    loadBoards(source)
  }, [source, loadBoards])

  /* ============ 切换榜单 ============ */
  const handleBoardChange = useCallback(
    async (boardId: string) => {
      if (boardId === currentBoardId) return
      setCurrentBoardId(boardId)
      setLoadingBoards(true)
      try {
        const res = await getBoardSongs(source, boardId)
        setBoardSongs(res.list || [])
      } catch {
        setBoardSongs([])
      } finally {
        setLoadingBoards(false)
      }
    },
    [source, currentBoardId]
  )

  return {
    boards,
    currentBoardId,
    setCurrentBoardId,
    boardSongs,
    loadingBoards,
    handleBoardChange
  }
}
