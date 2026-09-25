/**
 * 音乐页榜单/历史标签行(非搜索模式下显示)
 */
import Icon from '../../components/Icon'
import type { MusicBoard } from './types'

interface MusicBoardTabsProps {
  boards: MusicBoard[]
  currentBoardId: string
  showHistory: boolean
  historyCount: number
  onSelectHistory: () => void
  onSelectBoard: (boardId: string) => void
}

export default function MusicBoardTabs({
  boards,
  currentBoardId,
  showHistory,
  historyCount,
  onSelectHistory,
  onSelectBoard
}: MusicBoardTabsProps) {
  return (
    <div className="flex-shrink-0 px-5 py-2 flex items-center gap-1.5 overflow-x-auto border-b border-[var(--color-border-subtle)] scrollbar-thin">
      {/* 播放历史 */}
      <button
        onClick={onSelectHistory}
        className={`flex-shrink-0 flex items-center gap-1 ${showHistory ? 'chip chip-active' : 'chip'}`}
      >
        <Icon name="clock" size={16} className="inline-block" /> 播放历史
        {historyCount > 0 && (
          <span className={`text-[10px] ${showHistory ? 'opacity-70' : 'text-[var(--color-text-quaternary)]'}`}>{historyCount}</span>
        )}
      </button>
      {/* 分隔线 */}
      {boards.length > 0 && <div className="flex-shrink-0 h-3.5 w-px bg-[var(--color-border-subtle)]" />}
      {/* 榜单标签 */}
      {boards.map((b) => (
        <button
          key={b.id}
          onClick={() => onSelectBoard(b.id)}
          className={`flex-shrink-0 whitespace-nowrap ${!showHistory && currentBoardId === b.id ? 'chip chip-active' : 'chip'}`}
        >
          {b.name}
        </button>
      ))}
    </div>
  )
}
