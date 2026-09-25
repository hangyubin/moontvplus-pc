/**
 * 音乐页搜索 hook:关键词、搜索结果、提交/清空
 */
import { useState } from 'react'
import { searchMusic, type MusicSong } from '../../lib/music'

export function useMusicSearch(source: string, onSearchStart: () => void) {
  const [keyword, setKeyword] = useState('')
  const [submittedKeyword, setSubmittedKeyword] = useState('')
  const [searchResults, setSearchResults] = useState<MusicSong[]>([])
  const [searching, setSearching] = useState(false)

  /* ============ 搜索 ============ */
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = keyword.trim()
    if (!q) return
    onSearchStart()
    setSubmittedKeyword(q)
    setSearching(true)
    try {
      const res = await searchMusic(q, source, 1, 50)
      setSearchResults(res.list || [])
    } catch {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const clearSearch = () => {
    setKeyword('')
    setSubmittedKeyword('')
    setSearchResults([])
  }

  return {
    keyword,
    setKeyword,
    submittedKeyword,
    searchResults,
    searching,
    handleSearch,
    clearSearch
  }
}
