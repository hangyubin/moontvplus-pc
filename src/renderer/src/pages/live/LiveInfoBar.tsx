/**
 * 直播底部信息条 — 频道信息、线路切换、操作提示
 */
import Icon from '../../components/Icon'
import SmartImage from '../../components/SmartImage'
import { processImageUrl } from '../../lib/image'
import type { ChannelItem } from './types'

interface LiveInfoBarProps {
  currentChannel: ChannelItem | null
  currentChannelIndex: number
  allChannelsLength: number
  currentSourceName: string
  currentUrlIndex: number
  infoBarVisible: boolean
  panelVisible: boolean
  onSwitchUrl: (dir: 1 | -1) => void
}

export default function LiveInfoBar({
  currentChannel,
  currentChannelIndex,
  allChannelsLength,
  currentSourceName,
  currentUrlIndex,
  infoBarVisible,
  panelVisible,
  onSwitchUrl,
}: LiveInfoBarProps) {
  if (!currentChannel || panelVisible) return null

  return (
    <div
      className={`absolute bottom-0 left-0 right-0 z-30 transition-all duration-300 ${
        infoBarVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
      }`}
      style={{
        background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.6) 60%, transparent 100%)',
      }}
    >
      <div className="flex items-center justify-between px-6 py-4">
        {/* 左:频道信息 */}
        <div className="flex items-center gap-3 min-w-0">
          {currentChannel.tvgLogo && (
            <div className="w-10 h-10 overflow-hidden flex items-center justify-center flex-shrink-0">
              <SmartImage src={processImageUrl(currentChannel.tvgLogo)} alt={currentChannel.name} className="w-full h-full" objectFit="contain" />
            </div>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-white text-base font-medium truncate drop-shadow">{currentChannel.name}</span>
              {currentChannelIndex >= 0 && (
                <span className="text-xs text-white/50 tabular-nums">{currentChannelIndex + 1}/{allChannelsLength}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-white/40">{currentSourceName}</span>
              {currentChannel.group && (
                <>
                  <span className="text-white/20">|</span>
                  <span className="text-xs text-white/40">{currentChannel.group}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 右:线路切换 + 操作提示 */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {currentChannel.urls.length > 1 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-white/5 border border-white/10 rounded">
              <button onClick={(e) => { e.stopPropagation(); onSwitchUrl(-1) }} className="w-7 h-7 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all" title="上一线路 (←)">
                <Icon name="chevron-left" size={16} />
              </button>
              <span className="text-xs text-white/80 min-w-[70px] text-center font-medium tabular-nums">线路 {currentUrlIndex + 1}/{currentChannel.urls.length}</span>
              <button onClick={(e) => { e.stopPropagation(); onSwitchUrl(1) }} className="w-7 h-7 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-all" title="下一线路 (→)">
                <Icon name="chevron-right" size={16} />
              </button>
            </div>
          )}
          <span className="text-xs text-white/30">点击屏幕或按 Enter 切换列表</span>
        </div>
      </div>
    </div>
  )
}
