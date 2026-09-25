/**
 * 播放器覆盖层 — loading / 空状态 / 错误 / playerLoading / 自动换线提示
 */
import Icon from '../../components/Icon'
import type { ChannelItem } from './types'

interface LiveOverlaysProps {
  loading: boolean
  sourceDataListLength: number
  error: string
  errorType: 'load' | 'play'
  playerLoading: boolean
  autoSwitchMsg: string
  currentChannel: ChannelItem | null
  currentUrlIndex: number
  onReload: () => void
  onRetry: () => void
  onSwitchUrl: (dir: 1 | -1) => void
}

export default function LiveOverlays({
  loading,
  sourceDataListLength,
  error,
  errorType,
  playerLoading,
  autoSwitchMsg,
  currentChannel,
  currentUrlIndex,
  onReload,
  onRetry,
  onSwitchUrl,
}: LiveOverlaysProps) {
  return (
    <>
      {/* loading / 空状态 / 错误 / playerLoading */}
      {loading ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black">
          <div className="spinner spinner-lg" />
          <p className="text-white/50 text-sm">加载直播源...</p>
        </div>
      ) : sourceDataListLength === 0 && !error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black">
          <div className="w-20 h-20 bg-white/5 flex items-center justify-center" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
            <Icon name="tv" size={40} strokeWidth={1.5} className="text-primary" />
          </div>
          <div className="text-center">
            <p className="text-white/80 text-lg font-medium">暂无直播源</p>
            <p className="text-white/40 text-sm mt-2">请在服务端管理后台添加直播源</p>
          </div>
        </div>
      ) : !currentChannel && !error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black">
          <div className="w-20 h-20 bg-white/5 flex items-center justify-center" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
            <Icon name="tv" size={40} strokeWidth={1.5} className="text-primary" />
          </div>
          <div className="text-center">
            <p className="text-white/80 text-lg font-medium">点击屏幕选择频道</p>
            <p className="text-white/40 text-sm mt-2">↑↓ 换台 · ←→ 换线路 · 数字键跳转</p>
          </div>
        </div>
      ) : error ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 text-center bg-black">
          <div className="w-16 h-16 bg-red-500/10 flex items-center justify-center">
            <Icon name="info" size={32} strokeWidth={1.5} className="text-red-400" />
          </div>
          <div>
            <p className="text-white/80 text-base font-medium">{errorType === 'load' ? '加载失败' : '播放失败'}</p>
            <p className="text-white/40 text-sm mt-2 max-w-md">{error}</p>
          </div>
          <div className="flex gap-3">
            {errorType === 'load' ? (
              <button onClick={(e) => { e.stopPropagation(); onReload() }} className="btn-primary">
                重新加载
              </button>
            ) : (
              <>
                {currentChannel && currentChannel.urls.length > 1 && (
                  <button onClick={(e) => { e.stopPropagation(); onSwitchUrl(1) }} className="btn-primary">
                    切换下一线路
                  </button>
                )}
                <button onClick={(e) => { e.stopPropagation(); onRetry() }} className="btn-ghost">
                  重试
                </button>
              </>
            )}
          </div>
        </div>
      ) : playerLoading ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 pointer-events-none">
          <div className="spinner spinner-lg" />
          <p className="text-white/50 text-sm">
            正在加载直播流...
            {currentChannel && currentChannel.urls.length > 1 && (
              <span className="text-white/50 ml-1">（线路 {currentUrlIndex + 1}/{currentChannel.urls.length}）</span>
            )}
          </p>
        </div>
      ) : null}

      {/* 自动换线提示 */}
      {autoSwitchMsg && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 px-4 py-2 bg-black/85 backdrop-blur-sm border border-primary/30 shadow-lg animate-fadeIn">
          <div className="flex items-center gap-2 text-sm text-white">
            <Icon name="refresh" size={16} className="text-primary animate-spin" />
            {autoSwitchMsg}
          </div>
        </div>
      )}
    </>
  )
}
