/**
 * 统一媒体卡片
 *
 * 收编原先散落在 Home / Search / History / Favorites 的 5 套手写海报卡片。
 * 三种视觉预设对应原实现的动效差异,逐像素保持原样:
 *  - home:   封面底 card-bg,图片 hover 1.08,底部渐变 60%→95%(300ms),播放钮 scale-90
 *  - search: 封面底 hover-overlay-subtle,图片 hover 1.10,渐变 70%(200ms),播放钮 scale-75
 *  - plain:  无渐变、无图片缩放,暗遮罩 + 小播放钮,封面下方可放 footer 信息区
 *
 * horizontal 为"继续观看"行卡片(plain 预设):左侧 112px 封面 + 右侧 footer 面板。
 *
 * 角标/按钮通过 topLeft / topRight / bottomLeft 插槽传入,节点自带 absolute 定位类。
 */
import type { CSSProperties, ReactNode } from 'react'
import SmartImage from './SmartImage'
import Icon from './Icon'

/** 卡片所需最小数据结构(豆瓣条目 / 短剧 / SearchResult / PlayRecord 均满足) */
export interface MediaCardLike {
  id?: string | number
  title: string
  poster: string
  year?: string
}

export interface MediaCardProps {
  item: MediaCardLike
  onClick: () => void
  variant?: 'home' | 'search' | 'plain'
  /** 封面内标题下的副标题整节点(自带 class,如年份/来源) */
  subtitle?: ReactNode
  /** 标题前的小标记(如聚合搜索的"精确") */
  titlePrefix?: ReactNode
  /** 左上角标(节点自带 absolute 定位类) */
  topLeft?: ReactNode
  /** 右上角标/悬浮按钮(节点自带 absolute 定位类) */
  topRight?: ReactNode
  /** 封面左下角内容(节点自带 absolute 定位类) */
  bottomLeft?: ReactNode
  /** 播放进度 0-100,>0 时封面底部显示 3px 细条 */
  progress?: number
  /** 悬浮播放钮:lg=居中大圆钮(home/search 默认);sm=暗遮罩小钮(plain 默认);none 不显示 */
  play?: 'lg' | 'sm' | 'none'
  /** 横向行卡片:左封面 + 右侧 footer 面板 */
  horizontal?: boolean
  /** 封面下方信息区(plain 卡片),或横向布局的右侧面板 */
  footer?: ReactNode
  style?: CSSProperties
  className?: string
}

export default function MediaCard({
  item,
  onClick,
  variant = 'home',
  subtitle,
  titlePrefix,
  topLeft,
  topRight,
  bottomLeft,
  progress = 0,
  play,
  horizontal = false,
  footer,
  style,
  className = '',
}: MediaCardProps) {
  const isHome = variant === 'home'
  const playMode = play ?? (variant === 'plain' ? 'sm' : 'lg')
  const coverBg = isHome
    ? 'bg-[var(--color-card-bg)]'
    : 'bg-[var(--color-hover-overlay-subtle)]'

  const outerCls = horizontal
    ? 'card-hover cursor-pointer group relative flex overflow-hidden'
    : 'card-hover cursor-pointer overflow-hidden group relative'

  const coverCls = horizontal
    ? `relative w-28 flex-shrink-0 ${coverBg} overflow-hidden`
    : `relative aspect-[2/3] ${coverBg} overflow-hidden`

  return (
    <div onClick={onClick} className={`${outerCls} ${className}`} style={style}>
      <div className={coverCls}>
        <SmartImage
          src={item.poster}
          alt={item.title}
          className={
            variant === 'plain'
              ? 'w-full h-full'
              : `w-full h-full transition-transform duration-300 ${
                  isHome ? 'group-hover:scale-[1.08]' : 'group-hover:scale-110'
                }`
          }
        />

        {/* 底部渐变遮罩(仅海报叠加型) */}
        {variant !== 'plain' && (
          <div
            className={`absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent group-hover:opacity-95 transition-opacity pointer-events-none ${
              isHome ? 'opacity-60 duration-300' : 'opacity-70'
            }`}
          />
        )}

        {/* 悬浮播放钮:大(居中) */}
        {playMode === 'lg' && (
          <div
            className={`absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all pointer-events-none ${
              isHome ? 'duration-300' : 'duration-200'
            }`}
          >
            <div
              className={`w-8 h-8 bg-primary flex items-center justify-center shadow-xl shadow-primary/70 group-hover:scale-100 transition-transform rounded-full ${
                isHome ? 'scale-90 duration-300' : 'scale-75 duration-200'
              }`}
            >
              <Icon name="play-outline" size={20} className="text-white ml-0.5" />
            </div>
          </div>
        )}

        {/* 悬浮播放钮:小(整体暗遮罩) */}
        {playMode === 'sm' && (
          <div
            className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center ${
              horizontal ? 'bg-black/50' : 'bg-black/40'
            }`}
          >
            <span className="w-6 h-6 flex items-center justify-center text-lg text-white rounded-full bg-primary shadow-xl shadow-primary/70">
              <Icon name="play-outline" size={16} className="ml-0.5" />
            </span>
          </div>
        )}

        {/* 标题叠加在封面底部(仅海报叠加型) */}
        {variant !== 'plain' && (
          <div className="absolute bottom-0 left-0 right-0 p-2 pointer-events-none">
            {titlePrefix ? (
              <p className="text-xs font-medium text-white truncate flex items-center gap-1 drop-shadow-md">
                {titlePrefix}
                <span className="truncate">{item.title}</span>
              </p>
            ) : (
              <p className="text-xs font-medium text-white truncate drop-shadow-md">{item.title}</p>
            )}
            {subtitle}
          </div>
        )}

        {/* 封面左下内容(集数角标等) */}
        {bottomLeft}

        {/* 播放进度细条 */}
        {progress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/50 z-20">
            <div className="h-full progress-bar" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      {/* 封面下方信息区 / 横向布局右侧面板 */}
      {footer}

      {/* 角标与悬浮按钮(节点自带定位,锚定外层 relative 容器,与原封面内定位坐标一致) */}
      {topLeft}
      {topRight}
    </div>
  )
}
