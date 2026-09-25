/**
 * 音乐页顶部:搜索栏 + 音乐源选择(紧凑布局)
 */
import Icon from '../../components/Icon'
import { SOURCES } from './types'

interface MusicHeaderProps {
  keyword: string
  onKeywordChange: (v: string) => void
  onSearch: (e: React.FormEvent) => void
  onClearSearch: () => void
  source: string
  onSourceChange: (id: string) => void
}

export default function MusicHeader({
  keyword,
  onKeywordChange,
  onSearch,
  onClearSearch,
  source,
  onSourceChange
}: MusicHeaderProps) {
  return (
    <div className="flex-shrink-0 px-5 py-2.5 border-b border-[var(--color-border-subtle)] flex items-center gap-3">
      <form onSubmit={onSearch} className="relative flex-1 min-w-[200px] max-w-md">
        <input
          type="text"
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
          placeholder="搜索音乐、歌手..."
          className="w-full bg-[var(--color-hover-overlay)] border border-[var(--color-border-subtle)] px-3.5 py-1.5 pl-9 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-quaternary)] focus:outline-none focus:border-primary/50 focus:bg-[var(--color-hover-overlay-strong)] transition-all rounded"
        />
        <Icon name="search-check" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]" />
        {keyword && (
          <button
            type="button"
            onClick={onClearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay)] transition-all text-xs rounded"
          >
            ✕
          </button>
        )}
      </form>

      {/* 源选择(紧凑) */}
      <div className="flex items-center gap-1">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            onClick={() => onSourceChange(s.id)}
            className={`px-2.5 py-1 text-xs transition-all whitespace-nowrap rounded ${
              source === s.id ? 'bg-primary text-white' : 'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover-overlay)]'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>
    </div>
  )
}
