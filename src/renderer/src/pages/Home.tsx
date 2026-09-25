/**
 * 首页 — 对齐服务端首页 API
 * - TMDB 趋势 Banner(轮播)
 * - 热门电影/电视剧/综艺/短剧/新番放送(服务器采集源番剧)
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getTmdbTrending,
  getDoubanCategories,
  getDuanjuSources,
  getDuanjuVideos,
  getSearchResources,
  getCmsCategories,
  getCmsVideos
} from '../lib/api'
import type { CmsVodItem } from '../lib/api'
import { useGridColumns } from '../lib/useGridColumns'
import SmartImage from '../components/SmartImage'
import Icon from '../components/Icon'
import MediaCard from '../components/MediaCard'
import type {
  DoubanCategoryItem,
  TmdbTrendingItem,
  DuanjuItem
} from '../types'
import { getHomeSection, setHomeSection, getHomeModeKey } from '../lib/homeCache'

const BANNER_INTERVAL = 6000
/** 每次加载的条数(首页分类列表) */
const PAGE_SIZE = 24

/**
 * 首页分类数据 Hook:就地展开 + 触底无限加载
 * 服务端 /api/douban/categories 仅支持累计 limit,每次按更大的 limit 重新拉取并按 id 去重
 *
 * 缓存策略(SWR):进入页面先用 24h 内缓存即时渲染(无骨架/无等待),
 * 同时后台拉取最新数据更新;拉取失败时保留缓存。
 */
function useCategorySection(kind: 'movie' | 'tv', category: string, type: string) {
  const cacheKey = `douban:${kind}:${type}`
  const [items, setItems] = useState<DoubanCategoryItem[]>(
    () => getHomeSection<DoubanCategoryItem[]>(cacheKey) || []
  )
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(
    () => getHomeSection<DoubanCategoryItem[]>(cacheKey) == null
  )
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(true)
  const limitRef = useRef(PAGE_SIZE)
  const modeKey = getHomeModeKey()

  // 模式/源变化时重置并读取对应模式的缓存
  useEffect(() => {
    const cached = getHomeSection<DoubanCategoryItem[]>(cacheKey)
    setItems(cached || [])
    setLoading(cached == null)
    setLimit(PAGE_SIZE)
    limitRef.current = PAGE_SIZE
    setHasMore(true)
    hasMoreRef.current = true
    setExpanded(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey])

  useEffect(() => {
    let cancelled = false
    const isInitial = limit === PAGE_SIZE
    // 有缓存时的后台静默刷新不显示骨架
    if (isInitial && items.length === 0) setLoading(true)
    else if (isInitial) setLoading(false)
    else setLoadingMore(true)
    loadingMoreRef.current = !isInitial

    getDoubanCategories(kind, category, type, limit)
      .then((list) => {
        if (cancelled) return
        setItems((prev) => {
          const seen = new Set(prev.map((p) => p.id))
          const merged = [...prev]
          let added = 0
          for (const it of list) {
            if (!seen.has(it.id)) {
              seen.add(it.id)
              merged.push(it)
              added++
            }
          }
          // 当页不足一页或本次没有新增内容 → 已加载全部
          // (自定义源为每页 24 条的真实分页;服务器为累计返回,added===0 兜底)
          if (list.length < PAGE_SIZE || added === 0) {
            setHasMore(false)
            hasMoreRef.current = false
          }
          return merged
        })
        // 仅缓存首页板块的首批数据,避免无限加载内容撑爆 localStorage
        if (isInitial && list.length > 0) setHomeSection(cacheKey, list.slice(0, 100))
      })
      .catch(() => {
        // 初始加载失败:有缓存则保留(不显示空态),无缓存显示"暂无数据";
        // 加载更多失败回滚页码,哨兵再次进入可重试同一页
        if (cancelled) return
        if (isInitial) {
          setItems((prev) => (getHomeSection<DoubanCategoryItem[]>(cacheKey) ? prev : []))
        } else {
          limitRef.current = limit - PAGE_SIZE
        }
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        setLoadingMore(false)
        loadingMoreRef.current = false
      })

    return () => { cancelled = true }
    // items 不作为依赖:仅在分页/模式变化时拉取,缓存写入不触发重新请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, category, type, limit, modeKey])

  const loadMore = useCallback(() => {
    // 并发锁 + 边界保护,避免哨兵连续触发重复请求
    if (loadingMoreRef.current || !hasMoreRef.current) return
    limitRef.current += PAGE_SIZE
    setLimit(limitRef.current)
  }, [])

  const toggleExpanded = useCallback(() => setExpanded((v) => !v), [])

  return { items, expanded, loading, loadingMore, hasMore, loadMore, toggleExpanded }
}

/** 区块列表数据的统一形状(豆瓣分类 / 短剧集市共用) */
interface SectionData<T> {
  items: T[]
  expanded: boolean
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  loadMore: () => void
  toggleExpanded: () => void
}

/**
 * 短剧数据 Hook:基于 /api/duanju/sources + /api/duanju/videos 的页码分页
 * 固定使用第一个采集源及其短剧分类(与服务端 recommends 选源逻辑一致)
 */
function useDuanjuSection(): SectionData<DuanjuItem> {
  const cacheKey = 'duanju'
  const [items, setItems] = useState<DuanjuItem[]>(
    () => getHomeSection<DuanjuItem[]>('duanju') || []
  )
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(
    () => getHomeSection<DuanjuItem[]>('duanju') == null
  )
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const sourceRef = useRef<{ key: string; categoryId: string } | null>(null)
  const pageRef = useRef(0)
  const pageCountRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(true)
  const modeKey = getHomeModeKey()

  // 模式/源变化时重置并读取对应模式的缓存
  useEffect(() => {
    const cached = getHomeSection<DuanjuItem[]>(cacheKey)
    setItems(cached || [])
    setLoading(cached == null)
    setHasMore(true)
    hasMoreRef.current = true
    setExpanded(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(items.length === 0)
      try {
        const sources = await getDuanjuSources()
        if (cancelled) return
        const first = sources[0]
        if (!first?.typeId) {
          // 无可用源:保留 24h 缓存(离线/网关回退时首页仍可读),无缓存才显示空态
          if (!getHomeSection<DuanjuItem[]>(cacheKey)) {
            setItems([])
            setHasMore(false)
            hasMoreRef.current = false
          }
          return
        }
        sourceRef.current = { key: first.key, categoryId: first.typeId }
        const resp = await getDuanjuVideos(first.key, first.typeId, 1)
        if (cancelled) return
        pageRef.current = 1
        pageCountRef.current = resp.pageCount
        // 列表只用于展示,播放地址进详情页再拉取
        const valid = resp.data.filter((d) => !!d.id && !!d.title)
        setItems(valid)
        if (valid.length > 0) setHomeSection(cacheKey, valid.slice(0, 100))
        const more = resp.pageCount > 1
        setHasMore(more)
        hasMoreRef.current = more
      } catch {
        // 失败时保留缓存(有缓存则不置空)
        if (!cancelled && !getHomeSection<DuanjuItem[]>(cacheKey)) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey])

  const loadMore = useCallback(async () => {
    // 并发锁 + 边界保护
    if (loadingMoreRef.current || !hasMoreRef.current) return
    const src = sourceRef.current
    if (!src) return
    const nextPage = pageRef.current + 1
    if (pageCountRef.current > 0 && nextPage > pageCountRef.current) {
      setHasMore(false)
      hasMoreRef.current = false
      return
    }
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const resp = await getDuanjuVideos(src.key, src.categoryId, nextPage)
        const valid = resp.data.filter((d) => !!d.id && !!d.title)
      setItems((prev) => {
        const seen = new Set(prev.map((p) => String(p.id)))
        const merged = [...prev]
        let added = 0
        for (const it of valid) {
          const k = String(it.id)
          if (!seen.has(k)) {
            seen.add(k)
            merged.push(it)
            added++
          }
        }
        const reachedEnd =
          nextPage >= (resp.pageCount || nextPage) || (resp.data.length === 0)
        if (reachedEnd || added === 0) {
          setHasMore(false)
          hasMoreRef.current = false
        }
        return merged
      })
      pageRef.current = nextPage
    } catch {
      // 失败保持页码不变,哨兵再次进入可重试同一页
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [])

  const toggleExpanded = useCallback(() => setExpanded((v) => !v), [])

  return { items, expanded, loading, loadingMore, hasMore, loadMore, toggleExpanded }
}

/* ============================================================
 * 新番放送(番剧)
 * 数据来自服务器已聚合的苹果 CMS 采集源(动漫/番剧分类),
 * 封面走采集站自有图床(国内可达),不依赖被墙的 lain.bgm.tv
 * ============================================================ */

/** 番剧列表项(由 CMS vod 条目归一化得到) */
interface AnimeItem {
  id: string
  title: string
  poster: string
  year: string
  episodes: string[]
  episodes_titles: string[]
  source: string
  source_name: string
  /** 更新状态文案,如 "更新至11集" / "全24集" */
  remark: string
  desc: string
  class: string
}

/** 解析苹果 CMS vod_play_url,取集数最多的播放源 */
function parseVodEpisodes(vodPlayUrl?: string): { episodes: string[]; titles: string[] } {
  const episodes: string[] = []
  const titles: string[] = []
  if (!vodPlayUrl) return { episodes, titles }
  vodPlayUrl.split('$$$').forEach((group) => {
    const eps: string[] = []
    const tls: string[] = []
    group.split('#').forEach((seg) => {
      const [name, url] = seg.split('$')
      const u = (url || '').trim()
      // 直连 m3u8 或服务器代理地址(/api/... 或 http(s)://)
      if (name && u && (u.startsWith('/') || /^https?:\/\//.test(u))) {
        eps.push(u)
        tls.push(name.trim())
      }
    })
    if (eps.length > episodes.length) {
      episodes.length = 0
      episodes.push(...eps)
      titles.length = 0
      titles.push(...tls)
    }
  })
  return { episodes, titles }
}

/** 番剧分类匹配分(0=不相关),越高越优先 */
function scoreAnimeCategory(name: string): number {
  const n = name.trim()
  if (/里番|成人|福利|伦理|禁漫|18/.test(n)) return 0
  if (/新番/.test(n)) return 100
  if (/日[韩本](动漫|动画)/.test(n)) return 90
  if (/^(动漫|动画|动漫片|动画片)$/.test(n)) return 70
  if (/国产(动漫|动画)/.test(n)) return 55
  if (/动漫|动画|番/.test(n)) return 40
  return 0
}

/** 将 CMS vod 条目转为番剧列表项 */
function toAnimeItem(v: CmsVodItem, sourceKey: string, sourceName: string): AnimeItem | null {
  const { episodes, titles } = parseVodEpisodes(v.vod_play_url)
  if (episodes.length === 0 || !v.vod_pic) return null
  return {
    id: String(v.vod_id),
    title: (v.vod_name || '').trim().replace(/\s+/g, ' '),
    poster: v.vod_pic,
    year: v.vod_year ? (v.vod_year.match(/\d{4}/)?.[0] || '') : '',
    episodes,
    episodes_titles: titles,
    source: sourceKey,
    source_name: sourceName,
    remark: (v.vod_remarks || '').trim(),
    desc: (v.vod_content || '').replace(/<[^>]+>/g, '').trim(),
    class: v.vod_class || v.type_name || ''
  }
}

/**
 * 番剧数据 Hook
 * 1. 从全部采集源中找到"最佳番剧分类"(优先 新番 > 日韩动漫 > 动漫)
 * 2. 按页码无限加载
 */
function useAnimeSection(): SectionData<AnimeItem> {
  const cacheKey = 'anime'
  const [items, setItems] = useState<AnimeItem[]>(
    () => getHomeSection<AnimeItem[]>('anime') || []
  )
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(
    () => getHomeSection<AnimeItem[]>('anime') == null
  )
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)

  const targetRef = useRef<{ api: string; key: string; name: string; typeId: string | number } | null>(null)
  const pageRef = useRef(0)
  const pageCountRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const hasMoreRef = useRef(true)
  const modeKey = getHomeModeKey()

  // 模式/源变化时重置并读取对应模式的缓存
  useEffect(() => {
    const cached = getHomeSection<AnimeItem[]>(cacheKey)
    setItems(cached || [])
    setLoading(cached == null)
    setHasMore(true)
    hasMoreRef.current = true
    setExpanded(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(items.length === 0)
      try {
        const resources = await getSearchResources()
        if (cancelled) return
        // 仅尝试前若干个带 api 的采集源,避免首页加载过慢
        const candidates = resources.filter((r) => !!r.api).slice(0, 5)

        let target: { api: string; key: string; name: string; typeId: string | number } | null = null
        for (const res of candidates) {
          if (cancelled) return
          try {
            const cats = await getCmsCategories(res.api!)
            let best: { id: string | number; score: number } | null = null
            for (const c of cats) {
              const s = scoreAnimeCategory(c.type_name)
              if (s > 0 && (!best || s > best.score)) best = { id: c.type_id, score: s }
            }
            if (!best) continue
            // 验证该分类确实有视频
            const probe = await getCmsVideos(res.api!, best.id, 1)
            if (cancelled) return
            if (probe.list.some((v) => !!v.vod_play_url && !!v.vod_pic)) {
              target = { api: res.api!, key: res.key, name: res.name, typeId: best.id }
              pageCountRef.current = probe.pagecount
              const mapped = probe.list
                .map((v) => toAnimeItem(v, res.key, res.name))
                .filter((x): x is AnimeItem => !!x)
              setItems(mapped)
              if (mapped.length > 0) setHomeSection(cacheKey, mapped.slice(0, 100))
              const more = probe.pagecount > 1
              setHasMore(more)
              hasMoreRef.current = more
              break
            }
          } catch {
            // 单个源失败,尝试下一个
          }
        }
        if (cancelled) return
        if (!target) {
          // 所有源都没有番剧分类:保留缓存,无缓存才显示空
          if (!getHomeSection<AnimeItem[]>(cacheKey)) {
            setItems([])
          }
          setHasMore(false)
          hasMoreRef.current = false
          return
        }
        targetRef.current = target
        pageRef.current = 1
      } catch {
        if (!cancelled && !getHomeSection<AnimeItem[]>(cacheKey)) setItems([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey])

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return
    const t = targetRef.current
    if (!t) return
    const nextPage = pageRef.current + 1
    if (pageCountRef.current > 0 && nextPage > pageCountRef.current) {
      setHasMore(false)
      hasMoreRef.current = false
      return
    }
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const resp = await getCmsVideos(t.api, t.typeId, nextPage)
      const mapped = resp.list
        .map((v) => toAnimeItem(v, t.key, t.name))
        .filter((x): x is AnimeItem => !!x)
      setItems((prev) => {
        const seen = new Set(prev.map((p) => `${p.source}:${p.id}`))
        const merged = [...prev]
        let added = 0
        for (const it of mapped) {
          const k = `${it.source}:${it.id}`
          if (!seen.has(k)) {
            seen.add(k)
            merged.push(it)
            added++
          }
        }
        const reachedEnd = nextPage >= (resp.pagecount || nextPage) || resp.list.length === 0
        if (reachedEnd || added === 0) {
          setHasMore(false)
          hasMoreRef.current = false
        }
        return merged
      })
      pageRef.current = nextPage
    } catch {
      // 失败保持页码,哨兵再次进入可重试
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [])

  const toggleExpanded = useCallback(() => setExpanded((v) => !v), [])

  return { items, expanded, loading, loadingMore, hasMore, loadMore, toggleExpanded }
}

/** 触底哨兵:进入视口(提前 300px)时触发加载下一页 */
function LoadMoreSentinel({
  loadingMore,
  hasMore,
  onVisible
}: {
  loadingMore: boolean
  hasMore: boolean
  onVisible: () => void
}) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const onVisibleRef = useRef(onVisible)
  onVisibleRef.current = onVisible

  useEffect(() => {
    if (!hasMore) return
    const el = sentinelRef.current
    if (!el) return
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onVisibleRef.current()
      },
      { rootMargin: '300px' }
    )
    ob.observe(el)
    return () => ob.disconnect()
  }, [hasMore])

  return (
    <div ref={sentinelRef} className="flex justify-center items-center py-5">
      {loadingMore ? (
        <span className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
          <span className="spinner spinner-sm" />
          正在加载更多...
        </span>
      ) : hasMore ? (
        <span className="text-xs text-[var(--color-text-quaternary)]">向下滚动加载更多</span>
      ) : (
        <span className="text-xs text-[var(--color-text-quaternary)]">— 已经到底了 —</span>
      )}
    </div>
  )
}

/** 卡片最小数据约束(豆瓣条目 / 短剧均满足) */
interface MediaCardItem {
  id: string | number
  title: string
  poster: string
  year?: string
}

/** 首页分类区块:收起时显示两行,展开后就地无限加载 */
function CategorySectionView<T extends MediaCardItem>({
  title,
  sec,
  maxItems,
  onItemClick,
  renderBadge
}: {
  title: string
  sec: SectionData<T>
  maxItems: number
  onItemClick: (item: T) => void
  renderBadge?: (item: T) => ReactNode
}) {
  const displayItems = sec.expanded ? sec.items : sec.items.slice(0, maxItems)
  return (
    <section>
      <SectionTitle
        expanded={sec.expanded}
        onToggle={sec.toggleExpanded}
        hasMore={sec.items.length > maxItems || sec.hasMore}
      >
        {title}
      </SectionTitle>
      {sec.loading ? (
        <div style={gridStyle}>
          {Array.from({ length: Math.max(8, maxItems) }).map((_, i) => (
            <div key={i} className="aspect-[2/3] shimmer" />
          ))}
        </div>
      ) : sec.items.length === 0 ? (
        <p className="text-center py-6 text-[var(--color-text-quaternary)] text-sm">暂无数据</p>
      ) : (
        <>
          <div style={gridStyle}>
            {displayItems.map((item) => (
              <MediaCard
                key={String(item.id)}
                item={item}
                topRight={renderBadge?.(item)}
                subtitle={
                  item.year ? (
                    <p className="text-[10px] text-white/60 truncate mt-0.5">{item.year}</p>
                  ) : undefined
                }
                onClick={() => onItemClick(item)}
              />
            ))}
          </div>
          {sec.expanded && (
            <LoadMoreSentinel
              loadingMore={sec.loadingMore}
              hasMore={sec.hasMore}
              onVisible={sec.loadMore}
            />
          )}
        </>
      )}
    </section>
  )
}

/** 豆瓣评分角标 */
function DoubanRateBadge({ item }: { item: DoubanCategoryItem }) {
  if (!item.rate || item.rate === '0') return null
  return (
    <span className="badge badge-gold absolute top-1.5 right-1.5 z-10">
      ★ {item.rate}
    </span>
  )
}

/** 短剧集数角标(列表未带播放地址时无集数,不显示角标) */
function DuanjuEpBadge({ item }: { item: DuanjuItem }) {
  if (!item.episodes || item.episodes.length === 0) return null
  return (
    <span className="badge absolute top-1.5 right-1.5 z-10">
      {item.episodes.length}集
    </span>
  )
}

/** 番剧更新状态角标(更新至xx集/全xx集,无文案时回退集数) */
function AnimeRemarkBadge({ item }: { item: AnimeItem }) {
  const text = item.remark || `${item.episodes.length}集`
  return (
    <span className="badge badge-primary absolute top-1.5 right-1.5 z-10">
      {text}
    </span>
  )
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
  gap: '16px'
}

function SectionTitle({ children, expanded, onToggle, hasMore }: { children: React.ReactNode; expanded?: boolean; onToggle?: () => void; hasMore?: boolean }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-[var(--color-text-primary)]">
        <span className="section-bar" />
        {children}
      </h2>
      {hasMore && onToggle && (
        <button
          onClick={onToggle}
          className="flex items-center gap-1 text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors px-2 py-1 rounded"
        >
          {expanded ? '收起' : '查看更多'}
          <Icon name="chevron-down" size={12} strokeWidth={2.5} className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  )
}

export default function Home() {
  const navigate = useNavigate()

  const { ref: containerRef, maxItems } = useGridColumns<HTMLDivElement>({
    minWidth: 148,
    gap: 16,
    rows: 1
  })

  const [banners, setBanners] = useState<TmdbTrendingItem[]>(
    () => getHomeSection<TmdbTrendingItem[]>('banner') || []
  )
  const [bannerIdx, setBannerIdx] = useState(0)
  const [loadingBanner, setLoadingBanner] = useState(
    () => getHomeSection<TmdbTrendingItem[]>('banner') == null
  )

  // 三个豆瓣分类:独立管理分页与无限加载
  const movies = useCategorySection('movie', '热门', '全部')
  const tv = useCategorySection('tv', 'tv', 'tv')
  const show = useCategorySection('tv', 'show', 'show')
  // 短剧:页码分页,可无限加载
  const duanju = useDuanjuSection()
  // 新番放送:服务器采集源番剧
  const anime = useAnimeSection()

  useEffect(() => {
    let cancelled = false

    getTmdbTrending()
      .then((list) => {
        if (cancelled) return
        if (list.length > 0) {
          setBanners(list)
          setHomeSection('banner', list.slice(0, 10))
        }
      })
      .catch(() => {
        // 失败时保留缓存(初始化时已水合)
      })
      .finally(() => { if (!cancelled) setLoadingBanner(false) })

    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (banners.length <= 1) return
    const timer = setInterval(() => setBannerIdx((prev) => (prev + 1) % banners.length), BANNER_INTERVAL)
    return () => clearInterval(timer)
  }, [banners.length])

  const handleDoubanClick = (item: DoubanCategoryItem) => {
    // 统一链路:用标题聚合搜索匹配影片(结果带完整播放地址)→ 详情 → 播放
    navigate(`/search?q=${encodeURIComponent(item.title)}`)
  }

  const handleDuanjuClick = (item: DuanjuItem) => {
    // 统一链路:用标题聚合搜索匹配短剧
    navigate(`/search?q=${encodeURIComponent(item.title)}`)
  }

  const handleAnimeClick = (item: AnimeItem) => {
    // 统一链路(服务器/自定义源一致):标题聚合搜索匹配可播源 → 详情 → 播放
    navigate(`/search?q=${encodeURIComponent(item.title)}`)
  }

  const handleBannerClick = (item: TmdbTrendingItem) => {
    // 统一链路:用标题聚合搜索匹配影片
    navigate(`/search?q=${encodeURIComponent(item.title)}`)
  }

  return (
    <div ref={containerRef} className="p-5 space-y-7">
      {/* TMDB 趋势 Banner */}
      {loadingBanner ? (
        <div className="h-[340px] shimmer" />
      ) : banners.length > 0 ? (
        <div className="relative h-[340px] overflow-hidden group border-b border-[var(--color-border-subtle)]">
          {banners.map((banner, i) => (
            <div
              key={banner.id}
              className={`absolute inset-0 transition-opacity duration-700 ${i === bannerIdx ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
              onClick={() => handleBannerClick(banner)}
            >
              {banner.backdrop_path && (
                <SmartImage src={banner.backdrop_path} alt={banner.title} eager className="w-full h-full" />
              )}
              {/* 底部渐变遮罩 */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/45 to-transparent" />
              {/* 左侧渐变遮罩(增强文字区域可读性) */}
              <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />
              {/* 文字内容 */}
              <div className="absolute bottom-0 left-0 right-0 p-5">
                {/* 趋势标签 */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary text-white text-[10px] font-bold tracking-wide rounded" style={{ boxShadow: '0 0 12px var(--color-glow-primary)' }}>
                    <Icon name="flame" size={10} />
                    趋势推荐
                  </span>
                </div>
                {/* 标题 */}
                <h2 className="text-3xl font-bold mb-2 bg-gradient-to-r from-white via-white to-red-200/90 bg-clip-text text-transparent" style={{ textShadow: '0 2px 20px rgba(0,0,0,0.8)' }}>{banner.title}</h2>
                {/* 元信息 */}
                <div className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)] mb-3">
                  {banner.vote_average > 0 && (
                    <span className="badge badge-gold">★ {banner.vote_average}</span>
                  )}
                  {banner.release_date && <span>{banner.release_date}</span>}
                  {banner.genres && banner.genres.length > 0 && (
                    <>
                      <span className="text-[var(--color-text-quaternary)]">·</span>
                      <span>{banner.genres.join(' / ')}</span>
                    </>
                  )}
                </div>
                {/* 简介 */}
                {banner.overview && (
                  <p className="text-sm text-[var(--color-text-tertiary)] line-clamp-2 max-w-2xl mb-3">{banner.overview}</p>
                )}
                {/* 立即观看按钮 */}
                <button
                  onClick={(e) => { e.stopPropagation(); handleBannerClick(banner) }}
                  className="btn-primary inline-flex items-center gap-2 text-sm"
                >
                  <Icon name="play" size={16} />
                  立即观看
                </button>
              </div>
            </div>
          ))}
          {/* 轮播指示器 */}
          {banners.length > 1 && (
            <div className="absolute bottom-3 right-5 flex gap-1.5 z-10">
              {banners.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => { e.stopPropagation(); setBannerIdx(i) }}
                  className={`h-0.5 transition-all duration-300 ${i === bannerIdx ? 'w-6 bg-primary' : 'w-2 bg-white/40'}`}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* 热门电影 */}
      <CategorySectionView title="热门电影" sec={movies} maxItems={maxItems} onItemClick={handleDoubanClick}
        renderBadge={(item) => <DoubanRateBadge item={item} />} />

      {/* 热门电视剧 */}
      <CategorySectionView title="热门电视剧" sec={tv} maxItems={maxItems} onItemClick={handleDoubanClick}
        renderBadge={(item) => <DoubanRateBadge item={item} />} />

      {/* 热门综艺 */}
      <CategorySectionView title="热门综艺" sec={show} maxItems={maxItems} onItemClick={handleDoubanClick}
        renderBadge={(item) => <DoubanRateBadge item={item} />} />

      {/* 新番放送(服务器采集源番剧,封面走采集站直连图床) */}
      {!anime.loading && anime.items.length > 0 && (
        <CategorySectionView title="新番放送" sec={anime} maxItems={maxItems} onItemClick={handleAnimeClick}
          renderBadge={(item) => <AnimeRemarkBadge item={item} />} />
      )}

      {/* 短剧推荐(页码分页,无限加载) */}
      <CategorySectionView title="短剧推荐" sec={duanju} maxItems={maxItems} onItemClick={handleDuanjuClick}
        renderBadge={(item) => <DuanjuEpBadge item={item} />} />
    </div>
  )
}
