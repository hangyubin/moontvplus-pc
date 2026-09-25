/**
 * 直播左侧悬浮面板 — 频道/直播源双 Tab、搜索、分组频道列表
 */
import Icon from '../../components/Icon'
import SmartImage from '../../components/SmartImage'
import { processImageUrl } from '../../lib/image'
import type { CurrentNextProgram } from '../../lib/m3u'
import type { ChannelItem, SourceData } from './types'

interface LiveSidebarProps {
  sidebarTab: 'sources' | 'channels'
  setSidebarTab: (tab: 'sources' | 'channels') => void
  search: string
  setSearch: (s: string) => void
  filteredSources: SourceData[]
  currentSourceKey: string
  currentSourceData: SourceData | null
  currentGroupNames: string[]
  currentGroupedChannels: Record<string, ChannelItem[]>
  collapsedGroups: Set<string>
  toggleGroup: (key: string) => void
  currentChannelName: string
  currentNextProgram: CurrentNextProgram
  allChannelsLength: number
  onSelectSource: (sourceKey: string) => void
  onSelectChannel: (sourceKey: string, ch: ChannelItem) => void
  onShowSourceManager: () => void
  onRefreshSources: () => void
  channelListRef: React.RefObject<HTMLDivElement>
  currentChannelItemRef: React.RefObject<HTMLButtonElement>
}

export default function LiveSidebar({
  sidebarTab,
  setSidebarTab,
  search,
  setSearch,
  filteredSources,
  currentSourceKey,
  currentSourceData,
  currentGroupNames,
  currentGroupedChannels,
  collapsedGroups,
  toggleGroup,
  currentChannelName,
  currentNextProgram,
  allChannelsLength,
  onSelectSource,
  onSelectChannel,
  onShowSourceManager,
  onRefreshSources,
  channelListRef,
  currentChannelItemRef,
}: LiveSidebarProps) {
  return (
    <aside
      className="absolute left-0 top-0 bottom-0 w-[320px] z-20 flex flex-col animate-slideInLeft pt-10"
      style={{
        background: 'rgba(10, 10, 10, 0.7)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderRight: '1px solid rgba(255,255,255,0.08)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Tab 切换 */}
      <div className="flex border-b border-white/[0.06]">
        <button
          onClick={() => setSidebarTab('channels')}
          className={`flex-1 py-2.5 text-sm font-medium transition-all relative ${
            sidebarTab === 'channels' ? 'text-primary' : 'text-white/40 hover:text-white/70'
          }`}
        >
          频道
          {sidebarTab === 'channels' && (
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary" />
          )}
        </button>
        <button
          onClick={() => setSidebarTab('sources')}
          className={`flex-1 py-2.5 text-sm font-medium transition-all relative ${
            sidebarTab === 'sources' ? 'text-primary' : 'text-white/40 hover:text-white/70'
          }`}
        >
          直播源
          {sidebarTab === 'sources' && (
            <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary" />
          )}
        </button>
      </div>

      {/* 直播源管理操作栏(仅在直播源 tab 显示) */}
      {sidebarTab === 'sources' && (
        <div className="flex items-center gap-2 px-2.5 py-2 border-b border-white/[0.06]">
          <button
            onClick={onShowSourceManager}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-all text-white/70 hover:text-white"
          >
            <Icon name="plus" size={14} />
            导入源
          </button>
          <button
            onClick={onRefreshSources}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded transition-all text-white/70 hover:text-white"
            title="重新加载当前源"
          >
            <Icon name="refresh" size={14} />
            刷新
          </button>
        </div>
      )}

      {/* 搜索框 */}
      <div className="p-2.5 border-b border-white/[0.06]">
        <div className="relative group">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={sidebarTab === 'sources' ? '搜索直播源...' : '搜索频道...'}
            className="w-full border border-white/10 px-3 py-1.5 pl-8 text-sm text-white placeholder-white/40 focus:outline-none focus:border-primary/50 transition-all rounded"
            style={{ background: 'rgba(255,255,255,0.08)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
            autoFocus
          />
          <Icon name="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all">✕</button>
          )}
        </div>
      </div>

      {/* 内容区域 */}
      <div ref={channelListRef} className="flex-1 overflow-y-auto scrollbar-thin">
        {sidebarTab === 'sources' ? (
          /* === 直播源列表 === */
          filteredSources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <p className="text-white/40 text-sm">{search ? '未找到匹配直播源' : '暂无直播源'}</p>
            </div>
          ) : (
            <div className="p-1.5 space-y-0.5">
              {filteredSources.map((sd) => {
                const isCurrent = currentSourceKey === sd.source.key
                return (
                  <button
                    key={sd.source.key}
                    onClick={() => onSelectSource(sd.source.key)}
                    className={`w-full text-left flex items-center gap-2.5 px-2.5 py-2 transition-all duration-200 ${
                      isCurrent ? 'bg-primary/15' : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="w-8 h-8 bg-white/5 flex items-center justify-center flex-shrink-0" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                      <Icon name="tv" size={16} strokeWidth={1.5} className={`${isCurrent ? 'text-primary' : 'text-white/40'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${isCurrent ? 'text-primary font-medium' : 'text-white/80'}`}>{sd.source.name}</p>
                      <p className="text-xs text-white/30 mt-0.5">
                        {sd.loaded ? `${sd.channels.length} 个频道` : '点击加载'}
                      </p>
                    </div>
                    {isCurrent && <span className="w-1.5 h-1.5 bg-primary flex-shrink-0" />}
                  </button>
                )
              })}
            </div>
          )
        ) : (
          /* === 频道列表 === */
          !currentSourceKey ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <p className="text-white/40 text-sm">请先选择直播源</p>
              <button onClick={() => setSidebarTab('sources')} className="text-xs text-primary hover:underline">选择直播源</button>
            </div>
          ) : !currentSourceData?.loaded ? (
            <div className="flex items-center justify-center py-12">
              <div className="spinner spinner-sm" />
            </div>
          ) : currentGroupNames.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <p className="text-white/40 text-sm">{search ? '未找到匹配频道' : '暂无频道'}</p>
            </div>
          ) : (
            <div className="pb-2">
              {currentGroupNames.map((group) => {
                const groupCollapsed = collapsedGroups.has(group)
                return (
                  <div key={group} className="mb-0.5">
                    <button
                      onClick={() => toggleGroup(group)}
                      className="sticky top-0 z-10 w-full px-3 py-1.5 flex items-center justify-between hover:bg-white/5 transition-colors"
                      style={{ background: 'rgba(10, 10, 10, 0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' }}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Icon name="chevron-right" size={12} strokeWidth={2.5} className={`text-white/40 flex-shrink-0 transition-transform ${groupCollapsed ? '' : 'rotate-90'}`} />
                        <span className="text-xs font-medium text-white/50 tracking-wide truncate">{group}</span>
                      </div>
                      <span className="text-xs text-white/25 flex-shrink-0 ml-2 tabular-nums">{currentGroupedChannels[group].length}</span>
                    </button>
                    {!groupCollapsed && (
                      <div className="px-1.5 space-y-0.5">
                        {currentGroupedChannels[group].map((ch, idx) => {
                          const isCurrent = ch.name === currentChannelName
                          // 当前频道显示 EPG 当前/下一节目
                          const showEpg = isCurrent && (currentNextProgram.current || currentNextProgram.next)
                          return (
                            <button
                              key={`${group}-${idx}-${ch.name}`}
                              ref={isCurrent ? currentChannelItemRef : null}
                              onClick={() => onSelectChannel(currentSourceKey, ch)}
                              className={`w-full text-left flex items-center gap-2 px-2 py-2 transition-all duration-200 group ${
                                isCurrent ? 'bg-primary/20' : 'hover:bg-white/5'
                              }`}
                            >
                              {/* Logo (无外框,透明背景) */}
                              <div className={`w-9 h-9 overflow-hidden flex-shrink-0 flex items-center justify-center transition-opacity duration-200 ${isCurrent ? 'opacity-100' : 'opacity-80 group-hover:opacity-100'}`}>
                                {ch.tvgLogo ? (
                                  <SmartImage src={processImageUrl(ch.tvgLogo)} alt={ch.name} className="w-full h-full" objectFit="contain" />
                                ) : (
                                  <span className="text-white/50 text-sm font-medium">{ch.name.slice(0, 1)}</span>
                                )}
                              </div>
                              {/* 频道名 + 分组标签 */}
                              <div className="flex-1 min-w-0">
                                <span className={`block text-sm truncate ${isCurrent ? 'text-white font-medium' : 'text-white/80 group-hover:text-white'}`}>
                                  {ch.name}
                                </span>
                                {showEpg ? (
                                  <div className="flex flex-col gap-0.5 mt-0.5">
                                    {currentNextProgram.current && (
                                      <span className="text-[10px] text-primary truncate font-medium">
                                        ▶ {currentNextProgram.current.title} ({currentNextProgram.current.start}-{currentNextProgram.current.end})
                                      </span>
                                    )}
                                    {currentNextProgram.next && (
                                      <span className="text-[10px] text-white/40 truncate">
                                        {currentNextProgram.next.title} ({currentNextProgram.next.start})
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="block text-[10px] text-white/40 truncate mt-0.5">{group}</span>
                                )}
                              </div>
                              {/* 线路数 */}
                              {ch.urls.length > 1 && (
                                <span className="text-[10px] text-white/50 flex-shrink-0 px-1.5 py-0.5 border border-white/10">{ch.urls.length}线路</span>
                              )}
                              {/* 当前播放标记 */}
                              {isCurrent && <span className="w-1.5 h-1.5 bg-primary animate-pulse flex-shrink-0" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>

      {/* 底部提示 */}
      <div className="px-3 py-2 border-t border-white/[0.06] text-xs text-white/25 flex items-center justify-between">
        <span>↑↓ 换台 · ←→ 换线</span>
        <span className="tabular-nums">{allChannelsLength} 个频道</span>
      </div>
    </aside>
  )
}
