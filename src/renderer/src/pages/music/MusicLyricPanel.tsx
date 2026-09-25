/**
 * 音乐页右侧:歌词面板(毛玻璃封面背景 + 卡拉OK高亮 + 设置)
 */
import type { MusicSong, LyricLine } from './types'

interface MusicLyricPanelProps {
  currentSong: MusicSong | undefined
  karaokeMode: boolean
  onToggleKaraoke: () => void
  lyricColor: string
  onLyricColorChange: (c: string) => void
  lyricFontSize: number
  onLyricFontSizeChange: (size: number) => void
  lyricLines: LyricLine[]
  currentLyricIndex: number
  karaokeProgress: number
  lyricScrollRef: React.RefObject<HTMLDivElement>
  activeLyricRef: React.RefObject<HTMLDivElement>
}

export default function MusicLyricPanel({
  currentSong,
  karaokeMode,
  onToggleKaraoke,
  lyricColor,
  onLyricColorChange,
  lyricFontSize,
  onLyricFontSizeChange,
  lyricLines,
  currentLyricIndex,
  karaokeProgress,
  lyricScrollRef,
  activeLyricRef
}: MusicLyricPanelProps) {
  return (
    <div className="w-80 flex-shrink-0 border-l border-[var(--color-border-subtle)] flex flex-col bg-[var(--color-panel-bg)] relative overflow-hidden">
      {/* 毛玻璃专辑封面背景:取当前歌曲封面,模糊+暗化,随歌曲切换平滑过渡 */}
      {currentSong && (currentSong.cover || currentSong.pic) && (
        <img
          src={currentSong.cover || currentSong.pic}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-1000"
          style={{ filter: 'blur(40px) brightness(0.35) saturate(1.4)', transform: 'scale(1.15)', opacity: 0.7 }}
        />
      )}
      {/* 半透明遮罩,确保歌词可读性 */}
      <div className="absolute inset-0 bg-[var(--color-panel-bg)] opacity-60" />
      {/* 歌词标题 + 设置 */}
      <div className="relative z-10 flex-shrink-0 px-5 py-2.5 flex items-center justify-between border-b border-[var(--color-border-subtle)]">
        <span className="text-xs text-[var(--color-text-tertiary)] font-medium">歌词</span>
        <div className="flex items-center gap-1.5">
          {/* 卡拉OK开关 */}
          <button
            onClick={onToggleKaraoke}
            className={`text-[10px] px-2 py-0.5 transition-all rounded ${
              karaokeMode ? 'bg-primary/20 text-primary ring-1 ring-primary/30' : 'bg-[var(--color-hover-overlay)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]'
            }`}
            title="卡拉OK模式"
          >
            KTV
          </button>
          {/* 颜色选择 */}
          <div className="flex items-center gap-1">
            {['#e50914', '#ff5b8a', '#00d4aa', '#ffa500', '#e040fb'].map((c) => (
              <button
                key={c}
                onClick={() => onLyricColorChange(c)}
                className={`w-3 h-3 transition-transform ${lyricColor === c ? 'scale-125 ring-1 ring-white/40' : 'hover:scale-110'}`}
                style={{ backgroundColor: c }}
                title={`高亮颜色 ${c}`}
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
        </div>
      </div>
      {/* 歌词内容 */}
      <div ref={lyricScrollRef} className="relative z-10 flex-1 overflow-y-auto px-5 py-6 lyric-scroll">
        {!currentSong ? (
          <p className="text-center text-[var(--color-text-quaternary)] text-sm mt-10">播放歌曲以查看歌词</p>
        ) : lyricLines.length === 0 ? (
          <p className="text-center text-[var(--color-text-quaternary)] text-sm mt-10">暂无歌词</p>
        ) : (
          <div className="space-y-4">
            {lyricLines.map((line, i) => {
              const isActive = i === currentLyricIndex
              // 距离当前行的距离,用于计算淡出透明度(更明显的淡化)
              const distance = Math.abs(i - currentLyricIndex)
              const opacity = isActive ? 1 : Math.max(0.15, 1 - distance * 0.28)
              return (
                <div
                  key={i}
                  ref={isActive ? activeLyricRef : undefined}
                  className="transition-all duration-500 ease-out"
                  style={{
                    opacity,
                    transform: isActive ? 'scale(1.02)' : 'scale(0.96)',
                    filter: isActive ? 'none' : distance > 2 ? 'blur(0.5px)' : 'none',
                  }}
                >
                  {/* 卡拉OK模式:底层灰色完整文字 + 顶层彩色按进度裁切 */}
                  {isActive && karaokeMode ? (
                    <div className="relative leading-relaxed font-semibold" style={{ fontSize: `${lyricFontSize + 1}px` }}>
                      {/* 底层:完整灰色文字(始终可见) */}
                      <span style={{ color: 'rgba(255,255,255,0.3)' }}>
                        {line.text || '...'}
                      </span>
                      {/* 顶层:彩色文字按进度宽度裁切(线性平滑过渡) */}
                      <span
                        className="absolute inset-0 overflow-hidden whitespace-nowrap"
                        style={{
                          width: `${karaokeProgress * 100}%`,
                          color: lyricColor,
                          transition: 'width 0.3s linear',
                          textShadow: `0 0 10px ${lyricColor}66`,
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
                        color: isActive ? lyricColor : 'rgba(255,255,255,0.35)',
                        fontWeight: isActive ? 600 : 400,
                        textShadow: isActive ? `0 0 12px ${lyricColor}55` : 'none',
                      }}
                    >
                      {line.text || '...'}
                    </p>
                  )}
                  {line.translation && (
                    <p
                      className="text-xs mt-1"
                      style={{ color: isActive ? `${lyricColor}b0` : 'rgba(255,255,255,0.25)' }}
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
  )
}
