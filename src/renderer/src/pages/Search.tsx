/**
 * 搜索页
 * - 从 URL 参数 q 获取关键词,使用 SSE 流式搜索(searchStream)
 * - 双模式展示:聚合视图(所有源合并去重) / 分组视图(按源分组)
 * - 顶部源筛选 chip,可切换显示全部/某源
 * - 搜索进度:已完成源数 / 总源数
 * - 搜索历史同步:搜索时保存到服务端,无关键词时展示历史
 * - 支持取消(组件卸载时调用 cancel)
 */
import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { searchStream, getSearchHistory, saveSearchHistory, clearSearchHistory } from '../lib/api'
import { cacheSearchResults } from '../lib/searchCache'
import type { SearchResult, SearchSSEEvent } from '../types'
import MediaCard from '../components/MediaCard'

/** 单个源的搜索结果分组 */
interface SourceGroup {
  source: string
  sourceName: string
  results: SearchResult[]
  error?: string
}

/** 聚合项:同一标题在多个源的匹配 */
interface AggregatedItem {
  title: string
  /** 所有源的结果(按相关度排序) */
  variants: SearchResult[]
  /** 最佳结果(用于展示封面/信息) */
  best: SearchResult
}

/** 视图模式 */
type ViewMode = 'aggregate' | 'grouped'

/** 标题归一化(去空格、转小写,用于去重匹配) */
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, '')
}

/** 计算标题匹配度(0-1,越高越匹配) */
function titleScore(query: string, title: string): number {
  const q = normalizeTitle(query)
  const t = normalizeTitle(title)
  if (q === t) return 1.0
  if (t.includes(q)) return 0.9
  if (q.includes(t)) return 0.8
  // 字符级相似度
  let common = 0
  for (const ch of q) {
    if (t.includes(ch)) common++
  }
  return common / Math.max(q.length, t.length) * 0.5
}

export default function Search() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const q = searchParams.get('q') || ''

  const [groups, setGroups] = useState<SourceGroup[]>([])
  const [loading, setLoading] = useState(false)
  const [totalFound, setTotalFound] = useState(0)
  const [filterSource, setFilterSource] = useState<string>('')
  const [, setInputValue] = useState(q)
  const [viewMode, setViewMode] = useState<ViewMode>('aggregate')
  const [completedSources, setCompletedSources] = useState(0)
  const [totalSources, setTotalSources] = useState(0)
  const [errorSources, setErrorSources] = useState<{ source: string; sourceName: string; error: string }[]>([])
  const [history, setHistory] = useState<string[]>([])
  const cancelRef = useRef<(() => void) | null>(null)

  // 加载搜索历史(无关键词时展示)
  useEffect(() => {
    if (!q) {
      let cancelled = false
      getSearchHistory()
        .then((h) => { if (!cancelled) setHistory(h) })
        .catch(() => {})
      return () => { cancelled = true }
    }
  }, [q])

  // 搜索触发时保存关键词到服务端
  useEffect(() => {
    if (q) {
      let cancelled = false
      saveSearchHistory(q)
        .then((h) => { if (!cancelled) setHistory(h) })
        .catch(() => {})
      return () => { cancelled = true }
    }
  }, [q])

  useEffect(() => {
    setInputValue(q)

    if (!q) {
      setGroups([])
      setLoading(false)
      setTotalFound(0)
      setFilterSource('')
      setCompletedSources(0)
      setTotalSources(0)
      setErrorSources([])
      cancelRef.current = null
      return
    }

    let mounted = true
    setGroups([])
    setTotalFound(0)
    setFilterSource('')
    setCompletedSources(0)
    setTotalSources(0)
    setErrorSources([])
    setLoading(true)

    const onEvent = (e: SearchSSEEvent) => {
      if (!mounted) return
      if (e.type === 'start') {
        // 搜索开始,设置总源数
        setTotalSources(e.totalSources || 0)
      } else if (e.type === 'source_result') {
        if (e.results.length > 0) {
          cacheSearchResults(e.results)
          setGroups((prev) => {
            const idx = prev.findIndex((g) => g.source === e.source)
            if (idx >= 0) {
              const next = [...prev]
              next[idx] = {
                ...next[idx],
                results: [...next[idx].results, ...e.results]
              }
              return next
            }
            return [
              ...prev,
              { source: e.source, sourceName: e.sourceName, results: e.results }
            ]
          })
          setTotalFound((prev) => prev + e.results.length)
        }
        setCompletedSources((prev) => prev + 1)
      } else if (e.type === 'source_error') {
        setCompletedSources((prev) => prev + 1)
        setErrorSources((prev) => [
          ...prev,
          { source: e.source, sourceName: e.sourceName, error: e.error }
        ])
      } else if (e.type === 'complete') {
        setLoading(false)
        setCompletedSources(e.completedSources || 0)
      }
    }

    const { cancel } = searchStream(q, onEvent, false)
    cancelRef.current = cancel

    return () => {
      mounted = false
      cancel()
      cancelRef.current = null
    }
  }, [q])

  const handleCancel = useCallback(() => {
    cancelRef.current?.()
    setLoading(false)
  }, [])

  /** 源筛选 chip 列表(仅含有结果的源) */
  const sourceChips = useMemo(
    () =>
      groups
        .filter((g) => g.results.length > 0)
        .map((g) => ({
          source: g.source,
          sourceName: g.sourceName,
          count: g.results.length
        })),
    [groups]
  )

  /** 当前实际展示的分组(根据筛选条件过滤) */
  const visibleGroups = useMemo(() => {
    const withResults = groups.filter((g) => g.results.length > 0)
    if (!filterSource) return withResults
    return withResults.filter((g) => g.source === filterSource)
  }, [groups, filterSource])

  /** 聚合视图:将所有源结果按标题合并去重 */
  const aggregatedList = useMemo(() => {
    const allResults: SearchResult[] = []
    for (const g of visibleGroups) {
      allResults.push(...g.results)
    }

    // 按归一化标题分组
    const titleMap = new Map<string, AggregatedItem>()
    for (const item of allResults) {
      const normTitle = normalizeTitle(item.title)
      const existing = titleMap.get(normTitle)
      if (existing) {
        existing.variants.push(item)
      } else {
        titleMap.set(normTitle, {
          title: item.title,
          variants: [item],
          best: item
        })
      }
    }

    // 为每个聚合项选择最佳结果(优先有 episodes 的,其次按匹配度)
    const list: AggregatedItem[] = []
    for (const item of titleMap.values()) {
      // 排序:有 episodes 优先,然后按标题匹配度
      item.variants.sort((a, b) => {
        const aHas = a.episodes?.length > 0 ? 1 : 0
        const bHas = b.episodes?.length > 0 ? 1 : 0
        if (aHas !== bHas) return bHas - aHas
        return titleScore(q, b.title) - titleScore(q, a.title)
      })
      item.best = item.variants[0]
      list.push(item)
    }

    // 按匹配度排序
    list.sort((a, b) => titleScore(q, b.title) - titleScore(q, a.title))
    return list
  }, [visibleGroups, q])

  const hasResults = aggregatedList.length > 0 || visibleGroups.length > 0
  const searchProgress = totalSources > 0 ? Math.round((completedSources / totalSources) * 100) : 0

  return (
    <div className="p-6">
      {/* 搜索进度条(搜索中显示取消按钮) */}
      {q && loading && (
        <div className="mb-4 flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
              <span className="flex items-center gap-2">
                <span className="inline-block w-3.5 h-3.5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                搜索中... 已完成 {completedSources}/{totalSources || '?'} 个源,找到 {totalFound} 条结果
              </span>
              <span>{searchProgress}%</span>
            </div>
            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-purple-500 transition-all duration-300 rounded-full"
              style={{ width: `${searchProgress}%` }}
            />
          </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="ml-4 px-3 py-1.5 text-xs text-gray-400 hover:text-white bg-white/5 rounded-lg transition-colors flex-shrink-0"
          >
            取消
          </button>
        </div>
      )}

      {/* ============ 无关键词:展示搜索历史 ============ */}
      {!q && (
        <div className="max-w-2xl mx-auto">
          {history.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="flex items-center gap-2 text-sm font-medium text-gray-300">
                  <span className="w-1 h-4 rounded-full bg-gradient-to-b from-primary to-purple-500" />
                  搜索历史
                </h3>
                <button
                  onClick={async () => {
                    await clearSearchHistory()
                    setHistory([])
                  }}
                  className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                >
                  清空历史
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {history.map((kw, i) => (
                  <button
                    key={`${kw}-${i}`}
                    onClick={() => navigate(`/search?q=${encodeURIComponent(kw)}`)}
                    className="group flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white/[0.04] hover:bg-white/[0.08] text-gray-300 hover:text-white rounded-full transition-all"
                  >
                    {kw}
                    <span
                      onClick={async (e) => {
                        e.stopPropagation()
                        await clearSearchHistory(kw)
                        setHistory((prev) => prev.filter((h) => h !== kw))
                      }}
                      className="w-4 h-4 flex items-center justify-center text-gray-600 hover:text-red-400 rounded-full transition-colors"
                    >
                      ✕
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-20 text-gray-500">
              <div className="text-5xl mb-4 opacity-30">🔍</div>
              <p>请输入关键词开始搜索</p>
              <p className="text-sm text-gray-600 mt-2">搜索历史将同步到你的账号</p>
            </div>
          )}
        </div>
      )}

      {/* ============ 工具栏:视图切换 + 源筛选 ============ */}
      {q && hasResults && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          {/* 左:视图切换 */}
          <div className="flex items-center gap-1 bg-white/[0.04] rounded-lg p-1">
            <button
              onClick={() => setViewMode('aggregate')}
              className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                viewMode === 'aggregate'
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              聚合视图
            </button>
            <button
              onClick={() => setViewMode('grouped')}
              className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                viewMode === 'grouped'
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              分组视图
            </button>
          </div>

          {/* 右:源筛选 */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFilterSource('')}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                !filterSource
                  ? 'bg-primary text-white'
                  : 'bg-white/[0.06] text-gray-400 hover:text-white'
              }`}
            >
              全部 ({totalFound})
            </button>
            {sourceChips.map((chip) => (
              <button
                key={chip.source}
                onClick={() =>
                  setFilterSource((prev) => (prev === chip.source ? '' : chip.source))
                }
                className={`px-3 py-1 text-xs rounded-full transition-colors ${
                  filterSource === chip.source
                    ? 'bg-primary text-white'
                    : 'bg-white/[0.06] text-gray-400 hover:text-white'
                }`}
              >
                {chip.sourceName} ({chip.count})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ============ 聚合视图 ============ */}
      {q && hasResults && viewMode === 'aggregate' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '20px' }}>
          {aggregatedList.map((item) => (
            <MediaCard key={item.best.source + item.best.id} item={item.best} />
          ))}
        </div>
      )}

      {/* ============ 分组视图 ============ */}
      {q && hasResults && viewMode === 'grouped' && (
        <div className="space-y-8">
          {visibleGroups.map((group) => (
            <div key={group.source}>
              <h3 className="flex items-center gap-2 text-sm font-medium text-gray-300 mb-3">
                <span className="w-1 h-4 rounded-full bg-gradient-to-b from-primary to-purple-500" />
                {group.sourceName}
                <span className="text-gray-600">({group.results.length})</span>
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '20px' }}>
                {group.results.map((item) => (
                  <MediaCard key={`${item.source}-${item.id}`} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ============ 错误源提示 ============ */}
      {q && !loading && errorSources.length > 0 && (
        <div className="mt-6 p-3 bg-white/[0.03] rounded-lg border border-white/[0.06]">
          <p className="text-xs text-gray-500 mb-1">{errorSources.length} 个源搜索失败:</p>
          <div className="flex flex-wrap gap-2">
            {errorSources.map((e, i) => (
              <span key={i} className="text-xs text-gray-600 bg-white/[0.04] px-2 py-0.5 rounded">
                {e.sourceName}: {e.error}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ============ 空状态 ============ */}
      {q && !loading && !hasResults && (
        <div className="text-center py-20">
          <div className="text-5xl mb-4 opacity-30">🎬</div>
          <p className="text-gray-500 mb-2">未找到与 "{q}" 相关的结果</p>
          <p className="text-gray-600 text-sm">试试其他关键词,或检查资源源配置</p>
        </div>
      )}
    </div>
  )
}
