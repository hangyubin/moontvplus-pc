/**
 * 收藏页
 * 展示用户收藏的影视,支持查看详情、取消收藏
 */
import { useNavigate } from 'react-router-dom'
import { useStore, sortedFavorites } from '../lib/store'
import SmartImage from '../components/SmartImage'
import { parseStorageKey } from '../types'
import type { Favorite } from '../types'
import { formatRelativeTime } from '../lib/utils'

export default function Favorites() {
  const navigate = useNavigate()
  const { favorites, removeFavorite } = useStore()

  // 按 save_time 倒序排列的收藏数组
  const favoritesList = sortedFavorites(favorites)

  /** 点击卡片:跳转详情页 */
  const handleClick = (key: string, favorite: Favorite) => {
    const { source, id } = parseStorageKey(key)
    navigate(
      `/detail?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&title=${encodeURIComponent(favorite.title)}`
    )
  }

  /** 取消收藏 */
  const handleRemove = async (e: React.MouseEvent, key: string) => {
    e.stopPropagation()
    await removeFavorite(key)
  }

  // 空状态
  if (favoritesList.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-[var(--color-text-tertiary)] px-6 animate-fadeIn">
        <div
          className="flex items-center justify-center w-32 h-32 mb-6 text-6xl animate-pulse-glow rounded-lg"
          style={{
            background: 'linear-gradient(135deg, var(--color-hover-overlay) 0%, var(--color-hover-overlay-subtle) 100%)',
            border: '1px solid var(--color-border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          💔
        </div>
        <p className="text-xl font-bold text-[var(--color-text-primary)] mb-2">暂无收藏</p>
        <p className="text-sm text-[var(--color-text-tertiary)] text-center max-w-sm leading-relaxed">
          在影视详情页点击收藏,即可把喜欢的影片保存到这里
        </p>
        <button
          onClick={() => navigate('/')}
          className="btn-primary mt-8"
        >
          去发现影视
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 animate-fadeIn">
      {/* ============ 页头 ============ */}
      <div className="mb-8">
        <h2 className="flex items-center gap-2 text-xl font-bold text-[var(--color-text-primary)]">
          <span className="section-bar" />
          我的收藏
        </h2>
        <p className="text-sm text-[var(--color-text-tertiary)] mt-1.5 ml-4">
          共 <span className="text-[var(--color-text-primary)] font-medium">{favoritesList.length}</span> 部影片
        </p>
      </div>

      {/* ============ 收藏卡片网格 ============ */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: '20px',
          alignItems: 'start',
        }}
      >
        {favoritesList.map(([key, favorite]) => {
          // 是否已完结(用于显示标记)
          const completed = favorite.is_completed

          return (
            <div
              key={key}
              onClick={() => handleClick(key, favorite)}
              className="card-hover cursor-pointer overflow-hidden group relative"
              style={{
                background: 'var(--color-card-bg)',
                border: '1px solid var(--color-border-subtle)',
              }}
            >
              {/* 封面区 */}
              <div className="relative aspect-[2/3] bg-[var(--color-hover-overlay-subtle)] overflow-hidden">
                <SmartImage
                  src={favorite.cover}
                  alt={favorite.title}
                  className="w-full h-full"
                />

                {/* 悬浮查看遮罩 */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span
                    className="w-6 h-6 flex items-center justify-center text-lg text-white rounded-full bg-primary shadow-xl shadow-primary/70"
                  >
                    <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 5v14l11-7z" /></svg>
                  </span>
                </div>

                {/* vod_remarks 角标(如"更新至第X集"/"已完结") */}
                {favorite.vod_remarks && (
                  <span className="absolute top-2 left-2 bg-black/75 text-white text-xs px-2 py-0.5 rounded">
                    {favorite.vod_remarks}
                  </span>
                )}

                {/* 已完结标记 */}
                {completed && (
                  <span
                    className="absolute bottom-2 left-2 text-white text-xs px-2 py-0.5 rounded"
                    style={{
                      background: 'var(--color-primary)',
                      opacity: 0.9,
                    }}
                  >
                    已完结
                  </span>
                )}

                {/* 右上角取消收藏按钮 */}
                <button
                  onClick={(e) => handleRemove(e, key)}
                  title="取消收藏"
                  className="absolute top-2 right-2 w-7 h-7 bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80 z-10 rounded"
                >
                  ✕
                </button>
              </div>

              {/* 信息区 */}
              <div className="p-2.5">
                <p className="text-sm text-[var(--color-text-primary)] truncate">{favorite.title}</p>
                <p className="text-xs text-[var(--color-text-tertiary)] mt-1 truncate">
                  {favorite.year} · {favorite.source_name}
                </p>
                <p className="text-xs text-[var(--color-text-quaternary)] mt-0.5 truncate">
                  收藏于 {formatRelativeTime(favorite.save_time)}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
