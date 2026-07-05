/**
 * 首页 — 对齐服务端首页 API
 * - TMDB 趋势 Banner(轮播)
 * - 热门电影(/api/douban/categories?kind=movie)
 * - 热门电视剧(/api/douban/categories?kind=tv&category=tv)
 * - 热门综艺(/api/douban/categories?kind=tv&category=show)
 * - 短剧推荐(/api/duanju/recommends)
 *
 * 网格使用 CSS auto-fill + minmax 自适应列数,
 * 通过 ResizeObserver 动态计算 maxItems(列数×2行)限制条目数。
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  getTmdbTrending,
  getDoubanCategories,
  getDuanjuRecommends
} from '../lib/api'
import { cacheSearchResult } from '../lib/searchCache'
import { useGridColumns } from '../lib/useGridColumns'
import SmartImage from '../components/SmartImage'
import type {
  DoubanCategoryItem,
  TmdbTrendingItem,
  DuanjuItem,
  SearchResult
} from '../types'

/** 轮播 Banner 自动切换间隔(ms) */
const BANNER_INTERVAL = 6000

/** 自适应网格样式 */
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  gap: '20px'
}

/** 通用分区标题(组件外部定义,避免重渲染时重挂载) */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-lg font-semibold text-white mb-4">
      <span className="w-1 h-5 rounded-full bg-gradient-to-b from-primary to-purple-500" />
      {children}
    </h2>
  )
}

export default function Home() {
  const navigate = useNavigate()

  /* ============ 自适应网格(2 行,卡片最小 160px) ============ */
  // ref 绑定到页面根 div,确保始终有正确宽度
  const { ref: containerRef, maxItems } = useGridColumns<HTMLDivElement>({
    minWidth: 160,
    gap: 20,
    rows: 2
  })

  /* ============ TMDB 趋势 Banner ============ */
  const [banners, setBanners] = useState<TmdbTrendingItem[]>([])
  const [bannerIdx, setBannerIdx] = useState(0)

  /* ============ 豆瓣分类 ============ */
  const [hotMovies, setHotMovies] = useState<DoubanCategoryItem[]>([])
  const [hotTv, setHotTv] = useState<DoubanCategoryItem[]>([])
  const [hotShow, setHotShow] = useState<DoubanCategoryItem[]>([])

  /* ============ 短剧推荐 ============ */
  const [duanjuList, setDuanjuList] = useState<DuanjuItem[]>([])

  /* ============ 加载状态 ============ */
  const [loadingBanner, setLoadingBanner] = useState(true)
  const [loadingCategories, setLoadingCategories] = useState(true)

  // 并行加载所有首页数据
  useEffect(() => {
    let cancelled = false

    // Banner
    getTmdbTrending()
      .then((list) => {
        if (!cancelled && list.length > 0) setBanners(list)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingBanner(false)
      })

    // 豆瓣分类 + 短剧(并行),请求 30 条确保超宽屏也够填两行
    Promise.allSettled([
      getDoubanCategories('movie', '热门', '全部'),
      getDoubanCategories('tv', 'tv', 'tv'),
      getDoubanCategories('tv', 'show', 'show'),
      getDuanjuRecommends()
    ])
      .then((results) => {
        if (cancelled) return
        if (results[0].status === 'fulfilled') setHotMovies(results[0].value)
        if (results[1].status === 'fulfilled') setHotTv(results[1].value)
        if (results[2].status === 'fulfilled') setHotShow(results[2].value)
        if (results[3].status === 'fulfilled') setDuanjuList(results[3].value)
      })
      .finally(() => {
        if (!cancelled) setLoadingCategories(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Banner 自动轮播
  useEffect(() => {
    if (banners.length <= 1) return
    const timer = setInterval(() => {
      setBannerIdx((prev) => (prev + 1) % banners.length)
    }, BANNER_INTERVAL)
    return () => clearInterval(timer)
  }, [banners.length])

  /* ============ 点击处理 ============ */

  const handleDoubanClick = (item: DoubanCategoryItem) => {
    navigate(`/search?q=${encodeURIComponent(item.title)}`)
  }

  const handleDuanjuClick = (item: DuanjuItem) => {
    const searchResult: SearchResult = {
      id: item.id,
      title: item.title,
      poster: item.poster,
      episodes: item.episodes,
      episodes_titles: item.episodes_titles,
      source: item.source,
      source_name: item.source_name,
      year: item.year,
      desc: item.desc,
      type_name: item.type_name,
      class: item.class,
      douban_id: String(item.douban_id || ''),
      vod_remarks: '已完结',
      vod_total: item.episodes.length,
      proxyMode: false
    }
    cacheSearchResult(searchResult)
    navigate(
      `/detail?source=${encodeURIComponent(item.source)}&id=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title)}`
    )
  }

  const handleBannerClick = (item: TmdbTrendingItem) => {
    navigate(`/search?q=${encodeURIComponent(item.title)}`)
  }

  /* ============ 渲染辅助 ============ */

  /** 豆瓣卡片网格 */
  const renderDoubanGrid = (items: DoubanCategoryItem[], onClick: (item: DoubanCategoryItem) => void) => {
    const display = items.slice(0, maxItems)
    return (
      <div style={gridStyle}>
        {display.map((item) => (
          <div
            key={item.id}
            onClick={() => onClick(item)}
            className="card-hover cursor-pointer bg-card rounded-xl overflow-hidden group"
          >
            <div className="relative aspect-[2/3] bg-white/[0.03]">
              <SmartImage
                src={item.poster}
                alt={item.title}
                className="w-full h-full transition-transform duration-300 group-hover:scale-105"
              />
              {item.rate && item.rate !== '0' && (
                <span className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-yellow-400 text-xs px-2 py-0.5 rounded-md z-10">
                  ★ {item.rate}
                </span>
              )}
            </div>
            <div className="p-3">
              <p className="text-sm text-white truncate group-hover:text-primary transition-colors">{item.title}</p>
              <p className="text-xs text-gray-500 mt-1">{item.year}</p>
            </div>
          </div>
        ))}
      </div>
    )
  }

  /** 骨架屏 */
  const renderSkeleton = () => (
    <div style={gridStyle}>
      {Array.from({ length: maxItems }).map((_, i) => (
        <div key={i} className="aspect-[2/3] bg-white/5 rounded-xl animate-pulse" />
      ))}
    </div>
  )

  return (
    // containerRef 绑定到根 div,ResizeObserver 监听它的宽度变化
    <div ref={containerRef} className="p-6 space-y-8">
      {/* ============ TMDB 趋势 Banner ============ */}
      {loadingBanner ? (
        <div className="h-[280px] rounded-xl bg-white/5 animate-pulse" />
      ) : banners.length > 0 ? (
        <div className="relative h-[280px] rounded-xl overflow-hidden group">
          {banners.map((banner, i) => (
            <div
              key={banner.id}
              className={`absolute inset-0 transition-opacity duration-700 ${
                i === bannerIdx ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
              onClick={() => handleBannerClick(banner)}
            >
              {banner.backdrop_path && (
                <SmartImage
                  src={banner.backdrop_path}
                  alt={banner.title}
                  eager
                  className="w-full h-full"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-6">
                <h2 className="text-2xl font-bold text-white mb-2">{banner.title}</h2>
                <div className="flex items-center gap-3 text-sm text-gray-300 mb-2">
                  {banner.vote_average > 0 && (
                    <span className="text-yellow-400">★ {banner.vote_average}</span>
                  )}
                  {banner.release_date && <span>{banner.release_date}</span>}
                  {banner.genres && banner.genres.length > 0 && (
                    <span>{banner.genres.join(' / ')}</span>
                  )}
                </div>
                {banner.overview && (
                  <p className="text-sm text-gray-400 line-clamp-2 max-w-2xl">
                    {banner.overview}
                  </p>
                )}
              </div>
            </div>
          ))}
          {banners.length > 1 && (
            <div className="absolute bottom-3 right-6 flex gap-1.5">
              {banners.map((_, i) => (
                <button
                  key={i}
                  onClick={(e) => {
                    e.stopPropagation()
                    setBannerIdx(i)
                  }}
                  className={`h-1.5 rounded-full transition-all ${
                    i === bannerIdx ? 'w-6 bg-primary' : 'w-1.5 bg-white/40'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* ============ 热门电影 ============ */}
      <section>
        <SectionTitle>热门电影</SectionTitle>
        {loadingCategories ? (
          renderSkeleton()
        ) : hotMovies.length === 0 ? (
          <p className="text-center py-8 text-gray-500">暂无数据</p>
        ) : (
          renderDoubanGrid(hotMovies, handleDoubanClick)
        )}
      </section>

      {/* ============ 热门电视剧 ============ */}
      <section>
        <SectionTitle>热门电视剧</SectionTitle>
        {loadingCategories ? (
          renderSkeleton()
        ) : hotTv.length === 0 ? (
          <p className="text-center py-8 text-gray-500">暂无数据</p>
        ) : (
          renderDoubanGrid(hotTv, handleDoubanClick)
        )}
      </section>

      {/* ============ 热门综艺 ============ */}
      <section>
        <SectionTitle>热门综艺</SectionTitle>
        {loadingCategories ? (
          renderSkeleton()
        ) : hotShow.length === 0 ? (
          <p className="text-center py-8 text-gray-500">暂无数据</p>
        ) : (
          renderDoubanGrid(hotShow, handleDoubanClick)
        )}
      </section>

      {/* ============ 短剧推荐 ============ */}
      {duanjuList.length > 0 && (
        <section>
          <SectionTitle>短剧推荐</SectionTitle>
          <div style={gridStyle}>
            {duanjuList.slice(0, maxItems).map((item) => (
              <div
                key={`${item.source}-${item.id}`}
                onClick={() => handleDuanjuClick(item)}
                className="card-hover cursor-pointer bg-card rounded-xl overflow-hidden group"
              >
                <div className="relative aspect-[2/3] bg-white/[0.03]">
                  <SmartImage
                    src={item.poster}
                    alt={item.title}
                    className="w-full h-full transition-transform duration-300 group-hover:scale-105"
                  />
                  <span className="absolute top-2 right-2 bg-black/70 backdrop-blur-sm text-white text-xs px-2 py-0.5 rounded-md z-10">
                    {item.episodes.length}集
                  </span>
                </div>
                <div className="p-3">
                  <p className="text-sm text-white truncate group-hover:text-primary transition-colors">{item.title}</p>
                  <p className="text-xs text-gray-500 mt-1">{item.year}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
