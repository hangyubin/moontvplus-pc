/**
 * 直播顶部栏 — 返回/源名/频道名、EPG 当前/下一节目、录制按钮、LIVE 标记、窗口控制
 */
import Icon from '../../components/Icon'
import WindowControls from '../../components/WindowControls'
import type { CurrentNextProgram } from '../../lib/m3u'
import type { ChannelItem } from './types'

interface LiveHeaderProps {
  currentSourceName: string
  currentChannel: ChannelItem | null
  currentNextProgram: CurrentNextProgram
  epgLoading: boolean
  recordingId: string | null
  recordingBytes: number
  onGoBack: () => void
  onToggleRecording: () => void
}

export default function LiveHeader({
  currentSourceName,
  currentChannel,
  currentNextProgram,
  epgLoading,
  recordingId,
  recordingBytes,
  onGoBack,
  onToggleRecording,
}: LiveHeaderProps) {
  return (
    <header
      className="absolute top-0 left-0 right-0 h-10 flex items-stretch justify-between pl-4 pr-0 z-30"
      style={{
        background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <div className="flex items-center gap-3 min-w-0 self-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={(e) => { e.stopPropagation(); onGoBack() }}
          className="flex items-center gap-1.5 px-2 py-1 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-all duration-150 rounded"
        >
          <Icon name="chevron-left" size={16} />
          <span>返回</span>
        </button>
        <div className="h-4 w-px bg-white/10" />
        <div className="w-7 h-7 bg-white/5 flex items-center justify-center" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
          <Icon name="tv" size={14} className="text-primary" />
        </div>
        <span className="text-sm font-medium text-white">{currentSourceName || '直播'}</span>
        {currentChannel && (
          <>
            <span className="text-white/30">/</span>
            <span className="text-sm text-white/70 truncate max-w-[200px]">{currentChannel.name}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)] self-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* EPG 当前/下一节目 */}
        {currentNextProgram.current && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 border border-white/10 rounded max-w-[220px]">
            <span className="text-[10px] text-primary font-bold flex-shrink-0">当前</span>
            <span className="text-white/80 truncate text-xs">{currentNextProgram.current.title}</span>
            <span className="text-white/30 text-[10px] flex-shrink-0">{currentNextProgram.current.start}-{currentNextProgram.current.end}</span>
          </div>
        )}
        {currentNextProgram.next && (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-white/5 border border-white/10 rounded max-w-[220px]">
            <span className="text-[10px] text-white/40 font-bold flex-shrink-0">下一</span>
            <span className="text-white/50 truncate text-xs">{currentNextProgram.next.title}</span>
            <span className="text-white/30 text-[10px] flex-shrink-0">{currentNextProgram.next.start}-{currentNextProgram.next.end}</span>
          </div>
        )}
        {epgLoading && (
          <span className="text-white/30 text-xs">EPG加载中...</span>
        )}

        {/* 录制按钮 */}
        {currentChannel && window.app?.live && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleRecording() }}
            className={`flex items-center gap-1.5 px-2 py-1 rounded transition-all ${
              recordingId
                ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                : 'bg-white/5 text-white/70 border border-white/10 hover:bg-white/10 hover:text-white'
            }`}
            title={recordingId ? '停止录制' : '开始录制'}
          >
            <span className={`w-2 h-2 rounded-full ${recordingId ? 'bg-red-500 animate-pulse' : 'bg-white/40'}`} />
            <span className="text-xs font-medium">{recordingId ? '录制中' : '录制'}</span>
          </button>
        )}
        {recordingId && (
          <span className="text-white/30 text-[10px] tabular-nums">
            {(recordingBytes / 1024 / 1024).toFixed(1)}MB
          </span>
        )}

        {currentChannel && (
          <span className="flex items-center gap-1.5 text-red-400">
            <span className="w-1.5 h-1.5 bg-red-500 animate-pulse" />LIVE
          </span>
        )}
        <div className="w-px h-4 bg-white/10" />
      </div>
      <WindowControls />
    </header>
  )
}
