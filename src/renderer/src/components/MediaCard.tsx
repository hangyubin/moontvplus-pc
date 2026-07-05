import { useNavigate } from 'react-router-dom'
import type { SearchResult } from '../types'
import { useStore } from '../lib/store'
import { cacheSearchResult } from '../lib/searchCache'
import SmartImage from './SmartImage'

interface Props {
  item: SearchResult
}

/** 搜索结果卡片 */
export default function MediaCard({ item }: Props) {
  const navigate = useNavigate()
  const { playRecords } = useStore()

  const key = `${item.source}+${item.id}`
  const record = playRecords[key]
  const progress = record && record.total_time > 0
    ? Math.min(100, (record.play_time / record.total_time) * 100)
    : 0

  const handleClick = () => {
    cacheSearchResult(item)
    navigate(
      `/detail?source=${encodeURIComponent(item.source)}&id=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title)}`
    )
  }

  return (
    <div
      onClick={handleClick}
      className="card-hover cursor-pointer bg-card rounded-xl overflow-hidden group"
    >
      <div className="relative aspect-[2/3] bg-white/[0.03]">
        <SmartImage
          src={item.poster}
          alt={item.title}
          className="w-full h-full"
        />

        {/* 渐变遮罩(底部) */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />

        {/* 角标:更新状态 */}
        {item.vod_remarks && (
          <span className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-white text-xs px-2 py-0.5 rounded-md z-10">
            {item.vod_remarks}
          </span>
        )}

        {/* 悬浮播放按钮 */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="w-12 h-12 rounded-full bg-primary/80 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-primary/30">
            <span className="text-white text-lg ml-0.5">▶</span>
          </div>
        </div>

        {/* 进度条 */}
        {progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50 z-10">
            <div className="h-full progress-bar" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      <div className="p-2.5">
        <p className="text-sm text-white truncate group-hover:text-primary transition-colors">{item.title}</p>
        <p className="text-xs text-gray-600 mt-0.5 truncate">
          {item.year && item.year !== 'unknown' ? item.year : ''}{item.year && item.year !== 'unknown' && item.source_name ? ' · ' : ''}{item.source_name}
        </p>
      </div>
    </div>
  )
}
