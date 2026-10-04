/**
 * 音乐页右侧:两段式面板
 *  - 上段:歌曲封面大图(放大)+ 图上红心收藏按钮(无底色、默认不遮挡封面;
 *    播放的歌曲自动在播放列表中,无需重复加入;歌名/歌手在底部播放栏已有,此处不重复)
 *  - 下段:歌词(模糊封面背景 + 卡拉OK高亮 + 设置)
 *
 * 配色全部走主题变量:
 *  - 非当前行用 text-tertiary,深浅色模式都可读
 *  - 当前行用用户选择的高亮色(默认 var(--color-primary))
 *  - 透明/发光变体用 color-mix 派生,兼容 hex 色值和 var() 变量
 */
import type { MusicSong, LyricLine } from './types'
import Icon from '../../components/Icon'

/** 给任意颜色(hex 或 var())叠加透明度,Electron Chromium 原生支持 color-mix */
function withAlpha(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

interface MusicLyricPanelProps {
  currentSong: MusicSong | undefined
  isFavorite: boolean
  onToggleFavorite: () => void
  karaokeMode: boolean
  onToggleKaraoke: () => void
  lyricColor: string
  onLyricColorChange: (c: string) => void
  lyricFontSize: number
  onLyricFontSizeChange: (size: number) => void
  /** 歌词背景:cover=模糊封面 / solid=纯色面板 / dark=深色氛围 */
  lyricBg: 'cover' | 'solid' | 'dark'
  onLyricBgChange: (bg: 'cover' | 'solid' | 'dark') => void
  /** 纯色模式下的自定义背景色 */
  lyricBgColor: string
  onLyricBgColorChange: (color: string) => void
  lyricLines: LyricLine[]
  currentLyricIndex: number
  karaokeProgress: number
  lyricScrollRef: React.RefObject<HTMLDivElement>
  activeLyricRef: React.RefObject<HTMLDivElement>
}

export default function MusicLyricPanel({
  currentSong,
  isFavorite,
  onToggleFavorite,
  karaokeMode,
  onToggleKaraoke,
  lyricColor,
  onLyricColorChange,
  lyricFontSize,
  onLyricFontSizeChange,
  lyricBg,
  onLyricBgChange,
  lyricBgColor,
  onLyricBgColorChange,
  lyricLines,
  currentLyricIndex,
  karaokeProgress,
  lyricScrollRef,
  activeLyricRef
}: MusicLyricPanelProps) {
  const coverUrl = currentSong?.cover || currentSong?.pic

  return (
    <div className="w-72 flex-shrink-0 border-l border-[var(--color-border-subtle)] flex flex-col bg-[var(--color-panel-bg)]">
      {/* ============ 上段:封面大图 + 操作 ============ */}
      <div className="flex-shrink-0 px-5 pt-4 pb-3 border-b border-[var(--color-border-subtle)]">
        {/* 大封面(方形,尺寸随窗口高度自适应:窗口矮时自动缩小,把高度让给歌词区) */}
        <div
          className="group aspect-square mx-auto rounded-xl overflow-hidden relative bg-[var(--color-hover-overlay-subtle)] ring-1 ring-white/5 shadow-lg shadow-black/20"
          style={{ width: 'min(100%, clamp(140px, 24vh, 248px))' }}
        >
          {coverUrl ? (
            <img
              key={currentSong!.songmid || currentSong!.name}
              src={coverUrl}
              alt={currentSong?.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[var(--color-text-quaternary)]">
              <Icon name="music" size={56} strokeWidth={1.4} />
            </div>
          )}

          {/* 收藏红心:无底色圆块、不遮挡封面。
              未收藏:默认隐藏,hover 封面时淡入白色空心心(带阴影,浅底图也可见);悬停到心上时白心消失、红色实心心出现,提示可收藏;
              已收藏:红色实心心(#ff2d55)常显,hover 轻微放大 */}
          {currentSong && (
            <button
              onClick={onToggleFavorite}
              title={isFavorite ? '取消收藏' : '收藏'}
              aria-label={isFavorite ? '取消收藏' : '收藏'}
              className="group/heart absolute top-2 right-2 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 active:scale-90"
            >
              {isFavorite ? (
                <Icon
                  name="heart"
                  size={22}
                  className="text-[#ff2d55] drop-shadow-[0_1px_4px_rgba(0,0,0,0.45)] transition-transform duration-200 group-hover/heart:scale-110"
                />
              ) : (
                <>
                  <Icon
                    name="heart-outline"
                    size={20}
                    className="absolute text-white opacity-0 drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] transition-opacity duration-200 group-hover:opacity-100 group-hover/heart:opacity-0"
                  />
                  <Icon
                    name="heart"
                    size={20}
                    className="text-[#ff2d55] opacity-0 drop-shadow-[0_1px_3px_rgba(0,0,0,0.45)] transition-opacity duration-200 group-hover/heart:opacity-100"
                  />
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ============ 下段:歌词(背景可选:模糊封面 / 纯色 / 深色) ============ */}
      <div
        className="flex-1 flex flex-col relative overflow-hidden min-h-0"
        style={lyricBg === 'solid' ? { backgroundColor: lyricBgColor } : lyricBg === 'dark' ? { backgroundColor: '#101018' } : undefined}
      >
        {/* 模糊专辑封面背景:仅 cover 模式显示,大模糊+降亮,只保留氛围色调 */}
        {lyricBg === 'cover' && coverUrl && (
          <img
            src={coverUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: 'blur(70px) brightness(0.55) saturate(1.35)', transform: 'scale(1.25)', opacity: 0.55 }}
          />
        )}
        {/* 遮罩:cover 模式上下不透明、中间微透封面色;solid 模式纯色微渐变;dark 模式深色渐变 */}
        <div
          className="absolute inset-0"
          style={{
            background:
              lyricBg === 'cover'
                ? 'linear-gradient(180deg, var(--color-panel-bg) 0%, color-mix(in srgb, var(--color-panel-bg) 82%, transparent) 28%, color-mix(in srgb, var(--color-panel-bg) 74%, transparent) 72%, var(--color-panel-bg) 100%)'
                : lyricBg === 'solid'
                ? `linear-gradient(180deg, ${withAlpha(lyricBgColor, 100)} 0%, ${withAlpha(lyricBgColor, 92)} 50%, ${withAlpha(lyricBgColor, 100)} 100%)`
                : 'linear-gradient(180deg, rgba(16,16,24,0.9) 0%, rgba(16,16,24,0.75) 50%, rgba(16,16,24,0.9) 100%)'
          }}
        />
        {/* 歌词标题 + 设置 */}
        <div className="relative z-10 flex-shrink-0 px-4 py-2 flex items-center justify-between border-b border-[var(--color-border-subtle)]">
          <span className="text-xs text-[var(--color-text-tertiary)] font-medium">歌词</span>
          <div className="flex items-center gap-1.5">
            {/* 卡拉OK开关 */}
            <button
              onClick={onToggleKaraoke}
              className="text-[10px] px-2 py-0.5 transition-all rounded bg-[var(--color-hover-overlay)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
              style={
                karaokeMode
                  ? {
                      backgroundColor: withAlpha('var(--color-primary)', 20),
                      color: 'var(--color-primary)',
                      boxShadow: `inset 0 0 0 1px ${withAlpha('var(--color-primary)', 30)}`
                    }
                  : undefined
              }
              title="卡拉OK模式"
            >
              KTV
            </button>
            {/* 颜色选择 */}
            <div className="flex items-center gap-1">
              {['var(--color-primary)', '#ff5b8a', '#00d4aa', '#ffa500', '#e040fb'].map((c) => (
                <button
                  key={c}
                  onClick={() => onLyricColorChange(c)}
                  className={`w-3 h-3 rounded-full transition-transform ${lyricColor === c ? 'scale-125 ring-1 ring-[var(--color-text-secondary)]' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                  title={c === 'var(--color-primary)' ? '高亮颜色(跟随主题)' : `高亮颜色 ${c}`}
                />
              ))}
            </div>
            {/* 字体大小 */}
            <div className="flex items-center gap-0.5 ml-1">
              <button
                onClick={() => onLyricFontSizeChange(Math.max(12, lyricFontSize - 2))}
                className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-[10px] w-4 h-4 flex items-center justify-center hover:bg-[var(--color-hover-overlay)] transition-all"
                title="缩小字体"
              >A-</button>
              <button
                onClick={() => onLyricFontSizeChange(Math.min(24, lyricFontSize + 2))}
                className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] text-[10px] w-4 h-4 flex items-center justify-center hover:bg-[var(--color-hover-overlay)] transition-all"
                title="放大字体"
              >A+</button>
            </div>
            {/* 背景切换:封面 → 纯色 → 深色 循环 */}
            <button
              onClick={() => onLyricBgChange(lyricBg === 'cover' ? 'solid' : lyricBg === 'solid' ? 'dark' : 'cover')}
              className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-hover-overlay)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-all"
              title={`歌词背景:${lyricBg === 'cover' ? '模糊封面' : lyricBg === 'solid' ? '纯色' : '深色'}(点击切换)`}
            >
              {lyricBg === 'cover' ? '封面' : lyricBg === 'solid' ? '纯色' : '深色'}
            </button>
            {/* 纯色模式取色器 */}
            {lyricBg === 'solid' && (
              <label className="relative w-3.5 h-3.5 rounded-full overflow-hidden ring-1 ring-[var(--color-border-subtle)] cursor-pointer" title="点击自定义纯色背景" style={{ backgroundColor: lyricBgColor }}>
                <input
                  type="color"
                  value={lyricBgColor}
                  onChange={(e) => onLyricBgColorChange(e.target.value)}
                  className="absolute -inset-2 opacity-0 cursor-pointer"
                />
              </label>
            )}
          </div>
        </div>
        {/* 歌词内容(上下边缘淡出) */}
        <div
          ref={lyricScrollRef}
          className="relative z-10 flex-1 overflow-y-auto px-5 py-8 lyric-scroll min-h-0"
          style={{
            maskImage: 'linear-gradient(180deg, transparent 0%, #000 12%, #000 88%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(180deg, transparent 0%, #000 12%, #000 88%, transparent 100%)'
          }}
        >
          {!currentSong ? (
            <p className="text-center text-[var(--color-text-quaternary)] text-sm mt-10">播放歌曲以查看歌词</p>
          ) : lyricLines.length === 0 ? (
            <p className="text-center text-[var(--color-text-quaternary)] text-sm mt-10">暂无歌词</p>
          ) : (
            <div className="space-y-4">
              {lyricLines.map((line, i) => {
                const isActive = i === currentLyricIndex
                // 距离当前行的距离,用于计算淡出透明度
                const distance = Math.abs(i - currentLyricIndex)
                const opacity = isActive ? 1 : Math.max(0.2, 1 - distance * 0.28)
                return (
                  <div
                    key={i}
                    ref={isActive ? activeLyricRef : undefined}
                    className="transition-all duration-500 ease-out"
                    style={{
                      opacity,
                      transform: isActive ? 'scale(1.03)' : 'scale(0.97)',
                    }}
                  >
                    {/* 卡拉OK模式:底层暗色完整文字 + 顶层高亮色按进度裁切 */}
                    {isActive && karaokeMode ? (
                      <div className="relative leading-relaxed font-semibold" style={{ fontSize: `${lyricFontSize + 1}px` }}>
                        {/* 底层:完整未唱文字 */}
                        <span style={{ color: 'var(--color-text-quaternary)' }}>
                          {line.text || '...'}
                        </span>
                        {/* 顶层:高亮文字按进度宽度裁切(线性平滑过渡) */}
                        <span
                          className="absolute inset-0 overflow-hidden whitespace-nowrap"
                          style={{
                            width: `${karaokeProgress * 100}%`,
                            color: lyricColor,
                            transition: 'width 0.3s linear',
                            textShadow: `0 0 10px ${withAlpha(lyricColor, 40)}`,
                          }}
                        >
                          {line.text || '...'}
                        </span>
                      </div>
                    ) : (
                      <p
                        className="leading-relaxed"
                        style={{
                          fontSize: `${isActive ? lyricFontSize + 1 : lyricFontSize - 2}px`,
                          color: isActive ? lyricColor : 'var(--color-text-tertiary)',
                          fontWeight: isActive ? 600 : 400,
                          textShadow: isActive ? `0 0 12px ${withAlpha(lyricColor, 35)}` : 'none',
                        }}
                      >
                        {line.text || '...'}
                      </p>
                    )}
                    {line.translation && (
                      <p
                        className="text-xs mt-1"
                        style={{ color: isActive ? withAlpha(lyricColor, 70) : 'var(--color-text-quaternary)' }}
                      >
                        {line.translation}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
