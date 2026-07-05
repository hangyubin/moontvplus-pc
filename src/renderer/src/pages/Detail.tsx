/**
 * 详情页
 * 展示影视详情、剧集列表,支持收藏与"继续观看"
 * 路由参数:source, id, title
 */
import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { getDetail, getFavorite } from '../lib/api'
import { processImageUrl } from '../lib/image'
import { useStore } from '../lib/store'
import { getDetailWithCache, cacheSearchResult } from '../lib/searchCache'
import SmartImage from '../components/SmartImage'
import { generateStorageKey, type Favorite, type SearchResult } from '../types'

export default function Detail() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const source = searchParams.get('source') || ''
  const id = searchParams.get('id') || ''
  const title = searchParams.get('title') || ''

  const playRecords = useStore((s) => s.playRecords)
  const upsertFavorite = useStore((s) => s.upsertFavorite)
  const removeFavorite = useStore((s) => s.removeFavorite)

  const key = generateStorageKey(source, id)

  const [detail, setDetail] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [favorited, setFavorited] = useState<boolean>(
    () => !!useStore.getState().favorites[key]
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    getDetailWithCache(source, id, getDetail)
      .then((res) => {
        if (cancelled) return
        setDetail(res)
        cacheSearchResult(res)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError((e as Error)?.message || '加载详情失败')
        setLoading(false)
      })

    getFavorite(key)
      .then((f) => {
        if (cancelled) return
        setFavorited(!!f)
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [source, id, key])

  const record = playRecords[key]
  const lastIndex = record ? record.index - 1 : -1

  const toggleFavorite = () => {
    if (!detail) return
    if (favorited) {
      removeFavorite(key)
      setFavorited(false)
    } else {
      const fav: Favorite = {
        source_name: detail.source_name,
        total_episodes: detail.episodes.length,
        title: detail.title,
        year: detail.year,
        cover: detail.poster,
        save_time: Date.now(),
        search_title: title,
        origin: 'vod',
        vod_remarks: detail.vod_remarks
      }
      upsertFavorite(key, fav)
      setFavorited(true)
    }
  }

  const goPlay = (index: number) => {
    navigate(
      `/play?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}&index=${index}`
    )
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">加载中...</p>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-5xl opacity-30">🎬</div>
        <p className="text-gray-400">{error || '未找到该影视信息'}</p>
        <button
          onClick={() => navigate(-1)}
          className="px-4 py-2 bg-white/10 text-gray-300 rounded-lg hover:bg-white/20 transition-colors"
        >
          返回
        </button>
      </div>
    )
  }

  const episodes = detail.episodes || []
  const episodeTitle = (i: number) => detail.episodes_titles?.[i] || `第${i + 1}集`

  return (
    <div className="animate-fadeIn">
      {/* 返回按钮(独立栏,不与海报重叠) */}
      <div className="sticky top-0 z-30 px-6 py-3 flex items-center gap-3 glass border-b border-white/[0.06]">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-sm text-gray-300 hover:text-white transition-colors"
        >
          <span className="text-lg">←</span> 返回
        </button>
        <div className="h-4 w-px bg-white/10" />
        <span className="text-sm text-gray-500 truncate">详情</span>
      </div>

      {/* 渐变背景头部 */}
      <div className="relative h-64 overflow-hidden">
        {/* 模糊背景图 */}
        {detail.poster && (
          <div className="absolute inset-0 scale-110">
            <img
              src={processImageUrl(detail.poster)}
              alt=""
              className="w-full h-full object-cover blur-2xl opacity-30"
            />
          </div>
        )}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, var(--color-app-bg), color-mix(in srgb, var(--color-app-bg) 80%, transparent), color-mix(in srgb, var(--color-app-bg) 40%, transparent))' }} />

        {/* 头部内容:海报 + 信息 */}
        <div className="absolute bottom-0 left-0 right-0 p-6 flex gap-6">
          {/* 海报 */}
          <div className="w-36 md:w-44 flex-shrink-0">
            <div className="aspect-[2/3] rounded-xl overflow-hidden shadow-2xl ring-1 ring-white/10 relative">
              <SmartImage
                src={detail.poster}
                alt={detail.title}
                className="w-full h-full"
              />
            </div>
          </div>

          {/* 信息 */}
          <div className="flex-1 min-w-0 flex flex-col justify-end pb-2">
            <h1 className="text-2xl font-bold text-white drop-shadow-lg">{detail.title}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-3 text-sm">
              {detail.year && <span className="text-gray-300">{detail.year}</span>}
              {detail.source_name && (
                <span className="text-gray-500">· {detail.source_name}</span>
              )}
              {detail.vod_remarks && (
                <span className="bg-primary/20 text-primary px-2 py-0.5 rounded-md text-xs font-medium">
                  {detail.vod_remarks}
                </span>
              )}
              {detail.type_name && (
                <span className="bg-white/10 text-gray-300 px-2 py-0.5 rounded-md text-xs">
                  {detail.type_name}
                </span>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="flex flex-wrap items-center gap-3 mt-4">
              {record ? (
                <button
                  onClick={() => goPlay(lastIndex)}
                  className="bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-white font-medium px-6 py-2.5 rounded-xl transition-all shadow-lg shadow-primary/20"
                >
                  ▶ 继续观看第 {record.index} 集
                </button>
              ) : (
                episodes.length > 0 && (
                  <button
                    onClick={() => goPlay(0)}
                    className="bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-white font-medium px-6 py-2.5 rounded-xl transition-all shadow-lg shadow-primary/20"
                  >
                    ▶ 开始播放
                  </button>
                )
              )}
              <button
                onClick={toggleFavorite}
                className={`px-5 py-2.5 rounded-xl transition-all font-medium ${
                  favorited
                    ? 'bg-primary/20 text-primary border border-primary/40'
                    : 'bg-white/[0.06] text-gray-300 border border-white/10 hover:bg-white/10'
                }`}
              >
                {favorited ? '已收藏' : '收藏'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-6 space-y-6">
        {/* 简介 */}
        {detail.desc && (
          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-2">简介</h2>
            <p className="text-gray-400 text-sm leading-relaxed selectable line-clamp-4">
              {detail.desc}
            </p>
          </div>
        )}

        {/* 剧集列表 */}
        {episodes.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
              剧集列表
              <span className="text-gray-600 font-normal">共 {episodes.length} 集</span>
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 gap-2">
              {episodes.map((_, i) => {
                const isLast = i === lastIndex
                return (
                  <button
                    key={i}
                    onClick={() => goPlay(i)}
                    title={episodeTitle(i)}
                    className={`text-sm py-2.5 px-2 rounded-lg truncate transition-all ${
                      isLast
                        ? 'bg-gradient-to-r from-primary to-purple-600 text-white font-medium shadow-lg shadow-primary/20'
                        : 'bg-white/[0.04] text-gray-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {episodeTitle(i)}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
