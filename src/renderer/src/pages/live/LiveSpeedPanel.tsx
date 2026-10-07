/**
 * 直播线路测速面板
 * 逐条线路显示测速进度与结果(延迟/速率),完成后可点击行手动切换
 */
import Icon from '../../components/Icon'
import { formatSpeed, type LineSpeed } from '../../lib/liveSpeedTest'
import { lineLabel } from './LiveHeader'

interface Props {
  /** 按线路索引排列的结果(undefined=等待测速) */
  results: (LineSpeed | undefined)[]
  running: boolean
  currentUrlIndex: number
  onClose: () => void
  onPick: (idx: number) => void
}

/** 按速率取显示色 */
function speedColor(kbps: number): string {
  if (kbps >= 4000) return 'text-green-400'
  if (kbps >= 1500) return 'text-lime-400'
  if (kbps > 0) return 'text-yellow-400'
  return 'text-red-400'
}

export default function LiveSpeedPanel({ results, running, currentUrlIndex, onClose, onPick }: Props) {
  return (
    <div
      className="absolute inset-0 z-40 flex items-start justify-center pt-14"
      onClick={onClose}
    >
      <div
        className="w-80 rounded-lg overflow-hidden shadow-2xl"
        style={{
          background: 'rgba(20,20,24,0.92)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <Icon name="gauge" size={14} className="text-primary" />
            <span className="text-sm font-medium text-white/90">线路测速</span>
            {running && (
              <span className="text-[10px] text-white/40 flex items-center gap-1">
                <span className="w-3 h-3 spinner spinner-sm" />测速中
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 rounded transition-all"
          >
            <Icon name="x" size={13} />
          </button>
        </div>

        {/* 结果行 */}
        <div className="p-1.5 space-y-0.5 max-h-80 overflow-y-auto scrollbar-thin">
          {results.map((r, i) => {
            const isCurrent = i === currentUrlIndex
            return (
              <button
                key={i}
                onClick={() => !running && r?.ok && onPick(i)}
                disabled={running || !r?.ok}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded transition-all ${
                  isCurrent ? 'bg-primary/20' : 'hover:bg-white/5'
                } ${running || !r?.ok ? 'cursor-default' : 'cursor-pointer'}`}
              >
                <span className={`text-xs w-9 flex-shrink-0 ${isCurrent ? 'text-primary font-medium' : 'text-white/60'}`}>
                  {lineLabel(i)}
                </span>
                <div className="flex-1 flex items-center justify-end gap-3 tabular-nums">
                  {!r ? (
                    <span className="w-3.5 h-3.5 spinner spinner-sm" />
                  ) : r.ok ? (
                    <>
                      <span className="text-[10px] text-white/35">{r.latencyMs}ms</span>
                      <span className={`text-xs font-medium w-20 text-right ${speedColor(r.kbps)}`}>
                        {formatSpeed(r.kbps)}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-red-400/80">无法连接</span>
                  )}
                </div>
                {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />}
              </button>
            )
          })}
        </div>

        {/* 底部提示 */}
        <div className="px-3.5 py-2 border-t border-white/[0.08] text-[10px] text-white/30">
          {running ? '正在并发测试全部线路…' : '测速完成 · 点击线路行可手动切换'}
        </div>
      </div>
    </div>
  )
}
