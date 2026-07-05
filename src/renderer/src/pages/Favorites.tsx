/**
 * 收藏页
 * 展示用户收藏的影视,支持查看详情、取消收藏
 */
import { useNavigate } from 'react-router-dom'
import { useStore, sortedFavorites } from '../lib/store'
import SmartImage from '../components/SmartImage'
import { parseStorageKey } from '../types'
import type { Favorite } from '../types'
// 复用 History.tsx 中的相对时间格式化工具
import { formatRelativeTime } from './History'

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
      <div className="h-full flex flex-col items-center justify-center text-gray-500">
        <div className="text-6xl mb-4">💔</div>
        <p className="text-lg">暂无收藏</p>
        <p className="text-sm text-gray-600 mt-2">在详情页点击收藏即可保存到这里</p>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">我的收藏</h2>
          <p className="text-sm text-gray-500 mt-1">共 {favoritesList.length} 部</p>
        </div>
      </div>

      {/* 收藏卡片网格 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '20px' }}>
        {favoritesList.map(([key, favorite]) => {
          // 是否已完结(用于显示标记)
          const completed = favorite.is_completed

          return (
            <div
              key={key}
              onClick={() => handleClick(key, favorite)}
              className="card-hover cursor-pointer bg-card rounded-xl overflow-hidden group relative"
            >
              {/* 封面区 */}
              <div className="relative aspect-[2/3] bg-white/[0.03]">
                <SmartImage
                  src={favorite.cover}
                  alt={favorite.title}
                  className="w-full h-full"
                />

                {/* vod_remarks 角标(如"更新至第X集"/"已完结") */}
                {favorite.vod_remarks && (
                  <span className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2 py-0.5 rounded">
                    {favorite.vod_remarks}
                  </span>
                )}

                {/* 已完结标记 */}
                {completed && (
                  <span className="absolute bottom-2 left-2 bg-primary/80 text-white text-xs px-2 py-0.5 rounded">
                    已完结
                  </span>
                )}

                {/* 右上角取消收藏按钮 */}
                <button
                  onClick={(e) => handleRemove(e, key)}
                  title="取消收藏"
                  className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/70 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
                >
                  ✕
                </button>
              </div>

              {/* 信息区 */}
              <div className="p-2">
                <p className="text-sm text-white truncate">{favorite.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 truncate">
                  {favorite.year} · {favorite.source_name}
                </p>
                <p className="text-xs text-gray-600 mt-0.5 truncate">
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
