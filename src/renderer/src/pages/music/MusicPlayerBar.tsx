/**
 * 音乐页底部:固定播放控制栏(歌曲信息、播放控制、进度条、音量、频谱可视化)
 */
import SmartImage from '../../components/SmartImage'
import Icon from '../../components/Icon'
import { formatTime } from '../../lib/utils'
import type { MusicSong } from './types'

interface MusicPlayerBarProps {
  currentSong: MusicSong | undefined
  hasPlaylist: boolean
  isPlaying: boolean
  loadingUrl: boolean
  onTogglePlay: () => void
  onPrev: () => void
  onNext: () => void
  currentTime: number
  duration: number
  progressRatio: number
  progressBarRef: React.RefObject<HTMLDivElement>
  onProgressMouseDown: (e: React.MouseEvent) => void
  volume: number
  muted: boolean
  onToggleMute: () => void
  onVolumeChange: (v: number) => void
  canvasRef: React.RefObject<HTMLCanvasElement>
  spectrumColor: string
  onSpectrumColorChange: (c: string) => void
}

export default function MusicPlayerBar({
  currentSong,
  hasPlaylist,
  isPlaying,
  loadingUrl,
  onTogglePlay,
  onPrev,
  onNext,
  currentTime,
  duration,
  progressRatio,
  progressBarRef,
  onProgressMouseDown,
  volume,
  muted,
  onToggleMute,
  onVolumeChange,
  canvasRef,
  spectrumColor,
  onSpectrumColorChange
}: MusicPlayerBarProps) {
  return (
    <div className="h-24 flex-shrink-0 glass border-t border-[var(--color-border-subtle)] flex items-center px-5 gap-4 relative">
      {/* 歌曲信息 */}
      <div className="flex items-center gap-3 w-56 flex-shrink-0">
        <div className="w-12 h-12 overflow-hidden flex-shrink-0 bg-[var(--color-hover-overlay-subtle)] ring-1 ring-white/5 rounded">
          {currentSong ? (
            <SmartImage src={currentSong.cover || currentSong.pic} alt={currentSong.name} className="w-full h-full" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-700 text-xl">
              🎵
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-white truncate font-medium">{currentSong?.name || '未播放'}</p>
          <p className="text-xs text-[var(--color-text-tertiary)] truncate">{currentSong?.artist || '—'}</p>
        </div>
      </div>

      {/* 播放控制 + 进度 */}
      <div className="flex-1 flex flex-col items-center gap-1 min-w-0">
        <div className="flex items-center gap-5">
          <button
            onClick={onPrev}
            disabled={!hasPlaylist}
            className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-30 transition-colors"
            title="上一首"
          >
            <Icon name="prev" size={20} />
          </button>
          <button
            onClick={onTogglePlay}
            disabled={!currentSong}
            className="w-10 h-10 bg-primary text-white flex items-center justify-center hover:scale-105 active:scale-95 transition-transform disabled:opacity-30 shadow-lg shadow-primary/30 rounded-full"
            title={isPlaying ? '暂停' : '播放'}
          >
            {loadingUrl ? (
              <div className="spinner spinner-sm" />
            ) : isPlaying ? (
              <Icon name="pause" size={20} />
            ) : (
              <Icon name="play" size={20} className="ml-0.5" />
            )}
          </button>
          <button
            onClick={onNext}
            disabled={!hasPlaylist}
            className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] disabled:opacity-30 transition-colors"
            title="下一首"
          >
            <Icon name="next" size={20} />
          </button>
        </div>

        {/* 进度条(带时间显示) + 音量(同一行) */}
        <div className="w-full flex items-center gap-2.5">
          <span className="text-[11px] text-white/80 w-10 text-right tabular-nums font-medium">
            {formatTime(currentTime)}
          </span>
          <div
            ref={progressBarRef}
            onMouseDown={onProgressMouseDown}
            className="flex-1 h-1.5 bg-[var(--color-hover-overlay-strong)] cursor-pointer relative group hover:h-2 transition-all"
            style={{ borderRadius: '9999px' }}
          >
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary via-red-500 to-red-400"
              style={{ width: `${progressRatio * 100}%`, borderRadius: '9999px' }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity ring-2 ring-primary/40"
              style={{ left: `${progressRatio * 100}%`, borderRadius: '50%' }}
            />
          </div>
          <span className="text-[11px] text-white/80 w-10 tabular-nums font-medium">
            {formatTime(duration)}
          </span>
          {/* 音量 */}
          <button
            onClick={onToggleMute}
            className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors ml-1"
            title={muted || volume === 0 ? '取消静音' : '静音'}
          >
            {muted || volume === 0 ? (
              <Icon name="volume-high" size={20} />
            ) : (
              <Icon name="volume-low" size={20} />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="w-24 flex-shrink-0"
          />
        </div>
      </div>

      {/* 频谱可视化(独立区域) */}
      <div className="w-44 h-16 flex-shrink-0 relative group/spectrum">
        <canvas
          ref={canvasRef}
          className="w-full h-full"
        />
        {/* 频谱颜色选择器(hover 显示) */}
        <div className="absolute top-0 left-0 right-0 h-5 flex items-center justify-center gap-1.5 bg-black/60 backdrop-blur-sm opacity-0 group-hover/spectrum:opacity-100 transition-opacity z-10 rounded-t">
          {[
            { key: 'theme', label: '主题', color: 'var(--color-primary)' },
            { key: '#e50914', label: '', color: '#e50914' },
            { key: '#ff5b8a', label: '', color: '#ff5b8a' },
            { key: '#00d4aa', label: '', color: '#00d4aa' },
            { key: '#ffa500', label: '', color: '#ffa500' },
            { key: '#42a5f5', label: '', color: '#42a5f5' },
            { key: '#ab47bc', label: '', color: '#ab47bc' },
            { key: 'rainbow', label: '彩虹', color: 'linear-gradient(90deg,#e50914,#ffa500,#00d4aa,#42a5f5,#ab47bc)' },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => onSpectrumColorChange(opt.key)}
              className={`w-3 h-3 transition-transform ${spectrumColor === opt.key ? 'scale-125 ring-1 ring-white/60' : 'hover:scale-110'}`}
              style={{
                background: opt.color,
                borderRadius: '2px',
              }}
              title={opt.label || opt.key}
            >
              {opt.label && (
                <span className="text-[8px] text-white/80 leading-none flex items-center justify-center w-full h-full">{opt.label}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
