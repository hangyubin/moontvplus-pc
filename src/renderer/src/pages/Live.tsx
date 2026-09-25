/**
 * 直播页 — 影视仓风格
 *
 * 播放器全屏作为背景,左侧悬浮频道列表面板(点击/OK键呼出),
 * 底部信息条显示频道名/线路,自动隐藏。
 *
 * 操作:
 * - 点击播放器区域 / OK键 / Enter: 切换频道列表
 * - ↑↓: 上一个/下一个频道
 * - ←→: 上一线路/下一线路
 * - 数字键: 直接跳转到指定频道编号
 * - Back/Escape: 返回首页
 * - 搜索: 在频道列表中搜索频道名
 *
 * 模块拆分(见 ./live/):
 * - types.ts                 共享类型 + 直播记忆存取
 * - useLivePlayer.ts         播放器生命周期/自动换线
 * - useLiveEpg.ts            EPG 加载与当前/下一节目
 * - useLiveRecording.ts      录制控制与事件监听
 * - LiveOverlays.tsx         loading/空态/错误/换线提示覆盖层
 * - LiveHeader.tsx           顶部栏(返回/EPG/录制/窗口控制)
 * - LiveSidebar.tsx          左侧悬浮频道/直播源面板
 * - LiveInfoBar.tsx          底部频道信息条
 * - LiveSourceManagerPanel.tsx 直播源管理弹窗
 */
import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getLiveSources,
  getLiveChannels,
} from '../lib/live'
import { toast } from '../components/Toast'
import {
  loadLiveMemory,
  type ChannelItem,
  type SourceData,
} from './live/types'
import { useLivePlayer } from './live/useLivePlayer'
import { useLiveEpg } from './live/useLiveEpg'
import { useLiveRecording } from './live/useLiveRecording'
import LiveOverlays from './live/LiveOverlays'
import LiveHeader from './live/LiveHeader'
import LiveSidebar from './live/LiveSidebar'
import LiveInfoBar from './live/LiveInfoBar'
import LiveSourceManagerPanel from './live/LiveSourceManagerPanel'

export default function Live() {
  const navigate = useNavigate()

  /* ============ 数据状态 ============ */
  const [sourceDataList, setSourceDataList] = useState<SourceData[]>([])
  const [currentSourceKey, setCurrentSourceKey] = useState('')
  const [currentChannel, setCurrentChannel] = useState<ChannelItem | null>(null)
  const [currentUrlIndex, setCurrentUrlIndex] = useState(0)

  /* ============ 加载 / 错误状态 ============ */
  const [loading, setLoading] = useState(true)
  const [playerLoading, setPlayerLoading] = useState(false)
  const [error, setError] = useState('')
  const [errorType, setErrorType] = useState<'load' | 'play'>('play')
  const [reloadKey, setReloadKey] = useState(0)

  /* ============ UI 状态 ============ */
  // 频道列表是否可见(默认隐藏,影视仓风格)
  const [panelVisible, setPanelVisible] = useState(false)
  // 侧边栏 Tab
  const [sidebarTab, setSidebarTab] = useState<'sources' | 'channels'>('channels')
  // 搜索
  const [search, setSearch] = useState('')
  // 折叠的频道子分组
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  // 底部信息条可见性
  const [infoBarVisible, setInfoBarVisible] = useState(true)
  // 数字键输入缓冲
  const [channelNumber, setChannelNumber] = useState('')
  const [channelNumberVisible, setChannelNumberVisible] = useState(false)
  // 直播源管理面板
  const [showSourceManager, setShowSourceManager] = useState(false)

  /* ============ ref 镜像 ============ */
  const currentChannelRef = useRef<ChannelItem | null>(null)
  const currentUrlIndexRef = useRef(0)
  const currentSourceKeyRef = useRef('')
  const sourceDataListRef = useRef<SourceData[]>([])
  currentChannelRef.current = currentChannel
  currentUrlIndexRef.current = currentUrlIndex
  currentSourceKeyRef.current = currentSourceKey
  sourceDataListRef.current = sourceDataList

  /* ============ 频道列表滚动 ref ============ */
  const channelListRef = useRef<HTMLDivElement>(null)
  const currentChannelItemRef = useRef<HTMLButtonElement>(null)

  /* ============ 播放器 / EPG / 录制 hooks ============ */
  const { containerRef, autoSwitchMsg, blockedUrlsRef, pausePlayer } = useLivePlayer({
    currentChannel,
    currentUrlIndex,
    currentSourceKey,
    currentChannelRef,
    currentUrlIndexRef,
    setCurrentUrlIndex,
    setError,
    setErrorType,
    setPlayerLoading,
  })
  const { epgLoading, currentNextProgram } = useLiveEpg(currentChannel, currentSourceKey)
  const { recordingId, recordingBytes, startRecording, stopRecording } = useLiveRecording(currentChannel, currentUrlIndex)

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /* ============ 加载直播源列表 ============ */
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getLiveSources()
      .then((list) => {
        if (cancelled) return
        const dataList = list.map((source) => ({
          source,
          channels: [],
          loaded: false
        }))
        setSourceDataList(dataList)
        setLoading(false)

        const memory = loadLiveMemory()
        const initialKey = memory
          ? (list.find((s) => s.key === memory.sourceKey)?.key || list[0]?.key || '')
          : (list[0]?.key || '')
        if (initialKey) {
          setCurrentSourceKey(initialKey)
        }
      })
      .catch((e: any) => {
        if (cancelled) return
        const status = e?.response?.status
        const serverMsg = e?.response?.data?.error || e?.response?.data?.message
        const detail = status ? `(${status}) ${serverMsg || e?.message || ''}` : (e?.message || '网络请求失败')
        setErrorType('load')
        setError(`加载直播源失败: ${detail}`)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [reloadKey])

  /* ============ 按需加载某个源的频道 ============ */
  const loadSourceChannels = useCallback(async (sourceKey: string) => {
    const idx = sourceDataListRef.current.findIndex((sd) => sd.source.key === sourceKey)
    if (idx === -1) return
    if (sourceDataListRef.current[idx].loaded) return

    try {
      const list = await getLiveChannels(sourceKey)
      const map = new Map<string, ChannelItem>()
      for (const ch of list) {
        const name = ch.name.trim()
        if (!name) continue
        // 过滤掉 Update 分组(更新时间提醒,非真实频道)
        const group = (ch.group || '未分组').trim()
        if (group === 'Update' || group === '更新') continue
        // 过滤掉指向 127.0.0.1 的无效地址
        if (ch.url && ch.url.includes('127.0.0.1')) continue
        if (map.has(name)) {
          map.get(name)!.urls.push(ch.url)
        } else {
          map.set(name, {
            name,
            group,
            tvgLogo: ch.tvgLogo || ch.logo,
            tvgId: ch.tvgId,
            urls: [ch.url]
          })
        }
      }
      const items = Array.from(map.values())
      setSourceDataList((prev) => {
        const next = [...prev]
        const i = next.findIndex((sd) => sd.source.key === sourceKey)
        if (i !== -1) {
          next[i] = { ...next[i], channels: items, loaded: true }
        }
        return next
      })

      const memory = loadLiveMemory()
      if (memory && memory.sourceKey === sourceKey) {
        const ch = items.find((c) => c.name === memory.channelName)
        if (ch) {
          const urlIdx = Math.max(0, Math.min(memory.urlIndex, ch.urls.length - 1))
          setCurrentSourceKey(sourceKey)
          setCurrentChannel(ch)
          setCurrentUrlIndex(urlIdx)
          return
        }
      }
      // 没有记忆或记忆失效,自动选第一个频道播放
      if (items.length > 0) {
        setCurrentSourceKey(sourceKey)
        setCurrentChannel(items[0])
        setCurrentUrlIndex(0)
      }
    } catch (e: any) {
      const status = e?.response?.status
      const serverMsg = e?.response?.data?.error || e?.response?.data?.message
      const detail = status ? `(${status}) ${serverMsg || e?.message || ''}` : (e?.message || '网络请求失败')
      const isTimeout = e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')
      setErrorType('load')
      setError(`加载频道失败${isTimeout ? '(超时,服务端可能在下载EPG节目单,请稍后重试)' : ''}: ${detail}`)
    }
  }, [])

  useEffect(() => {
    if (currentSourceKey && sourceDataList.length > 0) {
      const sd = sourceDataList.find((s) => s.source.key === currentSourceKey)
      if (sd && !sd.loaded) {
        loadSourceChannels(currentSourceKey)
      }
    }
  }, [currentSourceKey, sourceDataList, loadSourceChannels])

  const goBack = useCallback(() => {
    pausePlayer()
    navigate('/')
  }, [navigate, pausePlayer])

  /* ============ 换线路 ============ */
  const switchUrl = useCallback((dir: 1 | -1) => {
    const ch = currentChannelRef.current
    if (!ch || ch.urls.length <= 1) return
    const idx = currentUrlIndexRef.current
    setCurrentUrlIndex((idx + dir + ch.urls.length) % ch.urls.length)
  }, [])

  /* ============ 换台(清空屏蔽列表,新频道重新尝试所有线路) ============ */
  const switchChannel = useCallback((dir: 1 | -1) => {
    const sd = sourceDataListRef.current.find((s) => s.source.key === currentSourceKeyRef.current)
    if (!sd || sd.channels.length === 0) return
    const ch = currentChannelRef.current
    if (!ch) { setCurrentChannel(sd.channels[0]); setCurrentUrlIndex(0); blockedUrlsRef.current.clear(); return }
    const idx = sd.channels.findIndex((c) => c.name === ch.name)
    if (idx === -1) { setCurrentChannel(sd.channels[0]); setCurrentUrlIndex(0); blockedUrlsRef.current.clear(); return }
    setCurrentChannel(sd.channels[(idx + dir + sd.channels.length) % sd.channels.length])
    setCurrentUrlIndex(0)
    blockedUrlsRef.current.clear()
  }, [blockedUrlsRef])

  /* ============ 所有频道的平铺列表(用于数字键跳转) ============ */
  const allChannels = useMemo(() => {
    const sd = sourceDataList.find((s) => s.source.key === currentSourceKey)
    return sd?.channels || []
  }, [sourceDataList, currentSourceKey])

  const currentChannelIndex = useMemo(() => {
    if (!currentChannel) return -1
    return allChannels.findIndex((c) => c.name === currentChannel.name)
  }, [currentChannel, allChannels])

  /* ============ 底部信息条:频道切换时显示,3秒后自动隐藏 ============ */
  const [infoText, setInfoText] = useState('')
  useEffect(() => {
    if (!currentChannel) return
    const parts: string[] = [currentChannel.name]
    if (currentChannelIndex >= 0) parts.push(`${currentChannelIndex + 1}/${allChannels.length}`)
    if (currentChannel.urls.length > 1) parts.push(`线路 ${currentUrlIndex + 1}/${currentChannel.urls.length}`)
    setInfoText(parts.join(' · '))
    setInfoBarVisible(true)
    const timer = setTimeout(() => setInfoBarVisible(false), 3000)
    return () => clearTimeout(timer)
  }, [currentChannel, currentUrlIndex, currentChannelIndex, allChannels.length])

  /* ============ 自动滚动当前频道到可视区域 ============ */
  useEffect(() => {
    if (panelVisible && currentChannelItemRef.current) {
      currentChannelItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [panelVisible, currentChannel])

  /* ============ 数字键输入 ============ */
  useEffect(() => {
    if (!channelNumber) return
    setChannelNumberVisible(true)
    const timer = setTimeout(() => {
      const num = parseInt(channelNumber, 10)
      if (num > 0 && num <= allChannels.length) {
        const ch = allChannels[num - 1]
        setCurrentChannel(ch)
        setCurrentUrlIndex(0)
      }
      setChannelNumber('')
      setChannelNumberVisible(false)
    }, 1500)
    return () => clearTimeout(timer)
  }, [channelNumber, allChannels])

  /* ============ 键盘控制 ============ */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA'
      // 搜索框有内容时,方向键用于编辑,不拦截
      if (isInput && (e.target as HTMLInputElement)?.value) return

      // 上下方向键:即使焦点在空搜索框也允许切换频道
      if (isInput && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        (e.target as HTMLElement).blur()
      }

      // 任何按键都重新显示信息条
      setInfoBarVisible(true)

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          switchUrl(-1)
          break
        case 'ArrowRight':
          e.preventDefault()
          switchUrl(1)
          break
        case 'ArrowUp':
          e.preventDefault()
          switchChannel(-1)
          break
        case 'ArrowDown':
          e.preventDefault()
          switchChannel(1)
          break
        case 'Enter':
        case ' ':
          e.preventDefault()
          setPanelVisible(v => !v)
          break
        case 'Escape':
        case 'Backspace':
          if (panelVisible) {
            e.preventDefault()
            setPanelVisible(false)
          } else if (e.key === 'Escape') {
            goBack()
          }
          break
        default:
          // 数字键 0-9
          if (e.key >= '0' && e.key <= '9') {
            e.preventDefault()
            setChannelNumber(prev => (prev + e.key).slice(-4))
          }
          break
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [switchUrl, switchChannel, panelVisible, goBack])

  /* ============ 选择频道 ============ */
  const handleSelectChannel = (sourceKey: string, ch: ChannelItem) => {
    setCurrentSourceKey(sourceKey)
    if (currentChannel && ch.name === currentChannel.name && currentSourceKey === sourceKey) {
      setPanelVisible(false)
      return
    }
    setCurrentChannel(ch)
    setCurrentUrlIndex(0)
    blockedUrlsRef.current.clear()
    setPanelVisible(false) // 选完后自动隐藏面板
  }

  /* ============ 选择直播源 ============ */
  const handleSelectSource = (sourceKey: string) => {
    setCurrentSourceKey(sourceKey)
    setSidebarTab('channels')
  }

  /* ============ 刷新直播源 ============ */
  const handleRefreshSources = useCallback(() => {
    // 清空当前源的缓存,强制重新加载
    setSourceDataList((prev) =>
      prev.map((sd) => ({ ...sd, loaded: false, channels: [] }))
    )
    // 如果当前有选中的源,重新加载
    if (currentSourceKey) {
      setTimeout(() => loadSourceChannels(currentSourceKey), 100)
    }
    toast.info('正在刷新直播源...')
  }, [currentSourceKey, loadSourceChannels])

  /* ============ 播放器区域点击 ============ */
  const handlePlayerClick = useCallback(() => {
    setPanelVisible(v => !v)
  }, [])

  /* ============ 当前源信息 ============ */
  const currentSourceName = useMemo(() => {
    const sd = sourceDataList.find((s) => s.source.key === currentSourceKey)
    return sd?.source.name || ''
  }, [sourceDataList, currentSourceKey])

  const currentChannelName = currentChannel?.name || ''

  /* ============ 过滤后的直播源列表 ============ */
  const filteredSources = useMemo(() => {
    if (!search.trim()) return sourceDataList
    const q = search.trim().toLowerCase()
    return sourceDataList.filter((sd) => sd.source.name.toLowerCase().includes(q))
  }, [sourceDataList, search])

  /* ============ 当前源的频道 ============ */
  const currentSourceData = useMemo(() => {
    return sourceDataList.find((s) => s.source.key === currentSourceKey) || null
  }, [sourceDataList, currentSourceKey])

  const currentChannels = useMemo(() => {
    if (!currentSourceData || !currentSourceData.loaded) return []
    if (!search.trim()) return currentSourceData.channels
    const q = search.trim().toLowerCase()
    return currentSourceData.channels.filter((ch) => ch.name.toLowerCase().includes(q) || ch.group.toLowerCase().includes(q))
  }, [currentSourceData, search])

  // 当前源的频道按 group 分组
  const currentGroupedChannels = useMemo(() => {
    const groups: Record<string, ChannelItem[]> = {}
    currentChannels.forEach((ch) => {
      const g = ch.group || '未分组'
      if (!groups[g]) groups[g] = []
      groups[g].push(ch)
    })
    return groups
  }, [currentChannels])
  const currentGroupNames = useMemo(() => Object.keys(currentGroupedChannels), [currentGroupedChannels])

  // infoText 已并入 LiveInfoBar 的内部渲染(保留状态计算与原逻辑一致)
  void infoText

  return (
    <div className="fixed inset-0 bg-black text-white overflow-hidden select-none dark-lock">
      {/* ============ 播放器全屏背景 ============ */}
      <div
        className="absolute inset-0"
        onClick={handlePlayerClick}
      >
        {/* 播放器容器:始终渲染,确保 ref 可用 */}
        <div className="absolute inset-0" ref={containerRef} />

        {/* 覆盖层:loading / 空状态 / 错误 / 换线提示 */}
        <LiveOverlays
          loading={loading}
          sourceDataListLength={sourceDataList.length}
          error={error}
          errorType={errorType}
          playerLoading={playerLoading}
          autoSwitchMsg={autoSwitchMsg}
          currentChannel={currentChannel}
          currentUrlIndex={currentUrlIndex}
          onReload={() => { setError(''); setReloadKey(k => k + 1) }}
          onRetry={() => {
            setError('')
            const ch = currentChannel, idx = currentUrlIndex
            setCurrentChannel(null)
            setTimeout(() => { setCurrentChannel(ch); setCurrentUrlIndex(idx) }, 0)
          }}
          onSwitchUrl={switchUrl}
        />
      </div>

      {/* ============ 顶部栏(固定) ============ */}
      <LiveHeader
        currentSourceName={currentSourceName}
        currentChannel={currentChannel}
        currentNextProgram={currentNextProgram}
        epgLoading={epgLoading}
        recordingId={recordingId}
        recordingBytes={recordingBytes}
        onGoBack={goBack}
        onToggleRecording={() => { recordingId ? stopRecording() : startRecording() }}
      />

      {/* ============ 数字键输入提示 ============ */}
      {channelNumberVisible && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none">
          <div className="bg-black/80 backdrop-blur-md px-8 py-4 text-center">
            <p className="text-white/40 text-xs mb-1">输入频道号</p>
            <p className="text-white text-4xl font-bold tracking-wider">{channelNumber}</p>
          </div>
        </div>
      )}

      {/* ============ 左侧悬浮频道面板 ============ */}
      {panelVisible && (
        <LiveSidebar
          sidebarTab={sidebarTab}
          setSidebarTab={setSidebarTab}
          search={search}
          setSearch={setSearch}
          filteredSources={filteredSources}
          currentSourceKey={currentSourceKey}
          currentSourceData={currentSourceData}
          currentGroupNames={currentGroupNames}
          currentGroupedChannels={currentGroupedChannels}
          collapsedGroups={collapsedGroups}
          toggleGroup={toggleGroup}
          currentChannelName={currentChannelName}
          currentNextProgram={currentNextProgram}
          allChannelsLength={allChannels.length}
          onSelectSource={handleSelectSource}
          onSelectChannel={handleSelectChannel}
          onShowSourceManager={() => setShowSourceManager(true)}
          onRefreshSources={handleRefreshSources}
          channelListRef={channelListRef}
          currentChannelItemRef={currentChannelItemRef}
        />
      )}

      {/* ============ 底部信息条(悬浮,自动隐藏) ============ */}
      <LiveInfoBar
        currentChannel={currentChannel}
        currentChannelIndex={currentChannelIndex}
        allChannelsLength={allChannels.length}
        currentSourceName={currentSourceName}
        currentUrlIndex={currentUrlIndex}
        infoBarVisible={infoBarVisible}
        panelVisible={panelVisible}
        onSwitchUrl={switchUrl}
      />

      {/* ============ 直播源管理面板 ============ */}
      {showSourceManager && (
        <LiveSourceManagerPanel
          onClose={() => setShowSourceManager(false)}
          onSourcesChanged={() => {
            // 源变更后刷新列表
            setReloadKey((k) => k + 1)
          }}
        />
      )}

    </div>
  )
}
