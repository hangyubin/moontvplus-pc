/**
 * 音乐页左侧:歌曲列表(搜索结果 / 榜单 / 播放历史)
 */
import SmartImage from '../../components/SmartImage'
import Icon from '../../components/Icon'
import { formatTime } from '../../lib/utils'
import type { MusicSong } from './types'

interface MusicSongListProps {
  searching: boolean
  loadingBoards: boolean
  displayList: MusicSong[]
  isSearchMode: boolean
  submittedKeyword: string
  searchCount: number
  showHistory: boolean
  historyCount: number
  boardCount: number
  currentSong: MusicSong | undefined
  isPlaying: boolean
  onPlaySong: (song: MusicSong, index: number, list: MusicSong[]) => void
}

export default function MusicSongList({
  searching,
  loadingBoards,
  displayList,
  isSearchMode,
  submittedKeyword,
  searchCount,
  showHistory,
  historyCount,
  boardCount,
  currentSong,
  isPlaying,
  onPlaySong
}: MusicSongListProps) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-5 py-2 text-xs text-[var(--color-text-tertiary)] border-b border-[var(--color-border-subtle)] flex items-center justify-between">
        <span>
          {isSearchMode
            ? `搜索 "${submittedKeyword}" 的结果(${searchCount})`
            : showHistory
            ? `播放历史(${historyCount})`
            : loadingBoards
            ? '加载榜单中...'
            : `共 ${boardCount} 首`}
        </span>
        {currentSong && (
          <span className="text-primary/70 truncate max-w-[200px]">正在播放: {currentSong.name}</span>
        )}
      </div>

      {/* 列表表头 */}
      {displayList.length > 0 && (
        <div className="flex-shrink-0 px-5 py-1.5 grid grid-cols-[28px_44px_1fr_auto] gap-3 text-[11px] text-[var(--color-text-quaternary)] border-b border-[var(--color-border-subtle)] items-center">
          <span className="text-center">#</span>
          <span></span>
          <span>歌曲 / 歌手</span>
          <span className="text-right pr-1">时长</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {(searching || loadingBoards) && displayList.length === 0 ? (
          <div className="px-6 py-10 text-center text-[var(--color-text-tertiary)]">
            <div className="spinner" />
            <p className="mt-3 text-sm">加载中...</p>
          </div>
        ) : displayList.length === 0 ? (
          <div className="px-6 py-20 text-center text-[var(--color-text-tertiary)]">
            <Icon name="music" size={64} strokeWidth={1.2} className="mx-auto mb-4 text-[var(--color-text-quaternary)] opacity-40" />
            <p>{isSearchMode ? '未找到相关音乐' : showHistory ? '暂无播放历史' : '暂无榜单数据'}</p>
          </div>
        ) : (
          <div className="px-3 py-1.5">
            {displayList.map((song, idx) => {
              const isCurrent =
                !!currentSong &&
                currentSong.songId === song.songId &&
                currentSong.source === song.source
              return (
                <div
                  key={`${song.source}-${song.songId}-${idx}`}
                  onClick={() => onPlaySong(song, idx, displayList)}
                  className={`group grid grid-cols-[28px_44px_1fr_auto] gap-3 px-2 py-1.5 cursor-pointer transition-all items-center ${
                    isCurrent
                      ? 'bg-primary/20 shadow-[inset_0_0_0_1px_rgba(91,110,255,0.3)]'
                      : 'hover:bg-[var(--color-hover-overlay)]'
                  }`}
                >
                  {/* 序号 / 播放指示 */}
                  <div className="w-7 flex-shrink-0 text-center">
                    {isCurrent && isPlaying ? (
                      <div className="flex items-end justify-center h-4 gap-0.5">
                        <span className="w-0.5 bg-primary" style={{ height: '40%', animation: 'eq 0.8s ease-in-out infinite alternate' }} />
                        <span className="w-0.5 bg-primary" style={{ height: '80%', animation: 'eq 0.6s ease-in-out infinite alternate' }} />
                        <span className="w-0.5 bg-primary" style={{ height: '60%', animation: 'eq 0.7s ease-in-out infinite alternate' }} />
                      </div>
                    ) : (
                      <span
                        className={`text-xs tabular-nums group-hover:hidden ${
                          isCurrent ? 'text-primary font-medium' : 'text-[var(--color-text-tertiary)]'
                        }`}
                      >
                        {idx + 1}
                      </span>
                    )}
                    {!(isCurrent && isPlaying) && (
                      <Icon name="play" size={14} className="hidden group-hover:block text-[var(--color-text-primary)] mx-auto" />
                    )}
                  </div>

                  {/* 封面 */}
                  <div className="w-11 h-11 overflow-hidden flex-shrink-0 bg-[var(--color-hover-overlay-subtle)] relative rounded">
                    <SmartImage src={song.cover || song.pic} alt={song.name} className="w-full h-full" />
                    {isCurrent && (
                      <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                        <Icon name={isPlaying ? 'pause' : 'play'} size={16} className="text-primary" />
                      </div>
                    )}
                  </div>

                  {/* 名称 / 歌手 */}
                  <div className="min-w-0 flex flex-col">
                    <p
                      className={`text-sm truncate ${
                        isCurrent ? 'text-primary font-medium' : 'text-[var(--color-text-primary)]'
                      }`}
                    >
                      {song.name}
                    </p>
                    <p className="text-xs text-[var(--color-text-tertiary)] truncate">{song.artist}</p>
                  </div>

                  {/* 时长 */}
                  <span className={`text-xs flex-shrink-0 pr-1 text-right tabular-nums ${isCurrent ? 'text-primary/70' : 'text-[var(--color-text-quaternary)]'}`}>
                    {song.durationText || (song.durationSec ? formatTime(song.durationSec) : (song.duration ? formatTime(song.duration) : '--:--'))}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
