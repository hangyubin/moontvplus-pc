import { useNavigate } from 'react-router-dom'
import type { SearchResult } from '../types'
import { useStore } from '../lib/store'
import { cacheSearchResult } from '../lib/searchCache'
import { calcProgress, buildDetailUrl } from '../lib/utils'
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
  const progress = record ? calcProgress(record.play_time, record.total_time) : 0

  const handleClick = () => {
    cacheSearchResult(item)
    navigate(buildDetailUrl(item.source, item.id, item.title))
  }

  return (
    <div
      onClick={handleClick}
      className="card-hover cursor-pointer overflow-hidden group relative bg-[var(--color-card-bg)]"
    >
      {/* 封面区 */}
      <div className="relative aspect-[2/3] bg-[var(--color-card-bg)] overflow-hidden">
        <SmartImage
          src={item.poster}
          alt={item.title}
          className="w-full h-full transition-transform duration-300 group-hover:scale-[1.08]"
        />

        {/* 底部渐变遮罩(始终存在,悬浮加深) */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent opacity-70 group-hover:opacity-95 transition-opacity pointer-events-none" />

        {/* 悬浮播放按钮 */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none">
          <div className="w-8 h-8 bg-primary flex items-center justify-center scale-75 group-hover:scale-100 transition-transform duration-200 rounded-full shadow-xl shadow-primary/70">
            <svg className="w-5 h-5 text-white ml-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 5v14l11-7z" /></svg>
          </div>
        </div>

        {/* 角标:更新状态 */}
        {item.vod_remarks && (
          <span className="badge absolute top-1.5 right-1.5">
            {item.vod_remarks}
          </span>
        )}

        {/* NSFW 标记(检查来源名称是否含18禁关键词) */}
        {item.source_name && /18\s*禁|成人|nsfw/i.test(item.source_name) && (
          <span className="badge badge-primary absolute top-1.5 left-1.5">
            18+
          </span>
        )}

        {/* 标题叠加在封面底部 */}
        <div className="absolute bottom-0 left-0 right-0 p-2 pointer-events-none">
          <p className="text-xs font-medium text-white truncate drop-shadow-md">{item.title}</p>
          <p className="text-[10px] text-white/60 truncate mt-0.5">
            {item.year && item.year !== 'unknown' ? item.year : ''}{item.year && item.year !== 'unknown' && item.source_name ? ' · ' : ''}{item.source_name}
          </p>
        </div>

        {/* 进度条 */}
        {progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/50 z-10">
            <div className="h-full progress-bar" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}
