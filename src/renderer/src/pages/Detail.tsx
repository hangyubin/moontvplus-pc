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
import { buildPlayUrl } from '../lib/utils'
import { getDetailWithCache, cacheSearchResult } from '../lib/searchCache'
import Icon from '../components/Icon'
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
    navigate(buildPlayUrl(source, id, title, index))
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 animate-fadeIn">
        <div className="spinner-lg" />
        <p className="text-[var(--color-text-tertiary)] text-sm">加载中...</p>
      </div>
    )
  }

  if (error || !detail) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 animate-fadeIn">
        <div className="w-20 h-20 flex items-center justify-center bg-[var(--color-hover-overlay-subtle)] border border-[var(--color-border-subtle)]">
          <Icon name="info" size={36} strokeWidth={1.5} className="text-[var(--color-text-quaternary)]" />
        </div>
        <p className="text-[var(--color-text-tertiary)]">{error || '未找到该影视信息'}</p>
        <button onClick={() => navigate(-1)} className="btn-ghost">
          返回
        </button>
      </div>
    )
  }

  const episodes = detail.episodes || []
  const episodeTitle = (i: number) => detail.episodes_titles?.[i] || `第${i + 1}集`

  return (
    <div className="animate-fadeIn">
      {/* 返回按钮栏 */}
      <div className="sticky top-0 z-30 px-6 py-3 flex items-center gap-3 glass border-b border-[var(--color-border-subtle)]">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors group"
        >
          <Icon name="chevron-left-slim" size={16} className="transition-transform group-hover:-translate-x-0.5" />
          返回
        </button>
        <div className="h-4 w-px bg-[var(--color-border-default)]" />
        <span className="text-sm text-[var(--color-text-tertiary)] truncate">详情</span>
      </div>

      {/* 沉浸式背景头部 */}
      <div className="relative h-[280px] overflow-hidden">
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
        {/* 渐变遮罩 */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, var(--color-app-bg) 0%, var(--color-app-bg) 25%, color-mix(in srgb, var(--color-app-bg) 80%, transparent) 55%, color-mix(in srgb, var(--color-app-bg) 40%, transparent) 100%)'
          }}
        />

        {/* 头部内容:海报 + 信息 */}
        <div className="absolute bottom-0 left-0 right-0 p-6 flex gap-6">
          {/* 海报 */}
          <div className="w-36 md:w-44 flex-shrink-0">
            <div className="aspect-[2/3] overflow-hidden shadow-lg ring-1 ring-white/10 relative rounded-md">
              <SmartImage
                src={detail.poster}
                alt={detail.title}
                className="w-full h-full"
              />
            </div>
          </div>

          {/* 信息区 */}
          <div className="flex-1 min-w-0 flex flex-col justify-end pb-2">
            <h1 className="text-3xl font-bold text-white drop-shadow-lg truncate">
              {detail.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              {detail.year && <span className="badge">{detail.year}</span>}
              {detail.source_name && (
                <span className="text-sm text-[var(--color-text-tertiary)]">
                  {detail.source_name}
                </span>
              )}
              {detail.vod_remarks && (
                <span className="badge badge-gold">{detail.vod_remarks}</span>
              )}
              {detail.type_name && (
                <span className="badge badge-primary">{detail.type_name}</span>
              )}
            </div>

            {/* 操作按钮 */}
            <div className="flex flex-wrap items-center gap-3 mt-4">
              {record ? (
                <button
                  onClick={() => goPlay(lastIndex)}
                  className="btn-primary px-6 py-2.5 flex items-center gap-2"
                >
                  <Icon name="play" size={16} />
                  继续观看第 {record.index} 集
                </button>
              ) : (
                episodes.length > 0 && (
                  <button
                    onClick={() => goPlay(0)}
                    className="btn-primary px-6 py-2.5 flex items-center gap-2"
                  >
                    <Icon name="play" size={16} />
                    开始播放
                  </button>
                )
              )}
              <button
                onClick={toggleFavorite}
                className={`px-5 py-2.5 transition-all font-medium border flex items-center gap-2 rounded ${
                  favorited
                    ? 'bg-primary/15 text-primary border-primary/40 hover:bg-primary/25 hover:border-primary/60'
                    : 'bg-[var(--color-hover-overlay)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)] hover:bg-[var(--color-hover-overlay-strong)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-default)]'
                }`}
              >
                <Icon
                  name={favorited ? 'star' : 'star-outline'}
                  size={16}
                  stroke={favorited ? 2 : undefined}
                />
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
            <div className="flex items-center gap-2 mb-2">
              <span className="section-bar" />
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)]">
                简介
              </h2>
            </div>
            <p className="text-[var(--color-text-tertiary)] text-sm leading-relaxed selectable line-clamp-4">
              {detail.desc}
            </p>
          </div>
        )}

        {/* 剧集列表 */}
        {episodes.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="section-bar" />
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] flex items-center gap-2">
                剧集列表
                <span className="text-[var(--color-text-quaternary)] font-normal">
                  共 {episodes.length} 集
                </span>
              </h2>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-10 gap-2">
              {episodes.map((_, i) => {
                const isLast = i === lastIndex
                return (
                  <button
                    key={i}
                    onClick={() => goPlay(i)}
                    title={episodeTitle(i)}
                    className={`text-sm py-2.5 px-2 truncate transition-all border rounded ${
                      isLast
                        ? 'bg-gradient-to-r from-primary to-red-700 text-white font-medium shadow-lg shadow-primary/30 border-primary/50'
                        : 'bg-[var(--color-card-bg)] text-[var(--color-text-secondary)] border-[var(--color-border-subtle)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-default)] hover:-translate-y-0.5'
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
