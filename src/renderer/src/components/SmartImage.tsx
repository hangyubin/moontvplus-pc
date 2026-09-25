/**
 * 智能图片组件
 * 功能:懒加载、加载骨架、错误占位、渐入动画
 * 替代原生 <img> 标签,统一图片加载体验
 *
 * 关键:根容器始终 w-full h-full 填充父级,
 * 父级需有明确尺寸(如 aspect-ratio 或固定高宽)。
 */
import { useState, useRef, useEffect } from 'react'
import { processImageUrl, resolveImageUrl } from '../lib/image'

interface SmartImageProps {
  src: string | undefined | null
  alt: string
  /** 额外类名(应用到根容器) */
  className?: string
  /** 是否强制立即加载(跳过懒加载,用于首屏 Banner) */
  eager?: boolean
  /** 图片填充方式:cover 裁切填充,contain 完整显示(适合 logo) */
  objectFit?: 'cover' | 'contain'
}

export default function SmartImage({
  src,
  alt,
  className = '',
  eager = false,
  objectFit = 'cover'
}: SmartImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const processedSrc = processImageUrl(src)

  // 实际渲染地址:先用原始 URL 即时显示,磁盘缓存(blob:)就绪后无缝替换
  const [resolvedSrc, setResolvedSrc] = useState(processedSrc)

  useEffect(() => {
    if (!processedSrc) {
      setResolvedSrc('')
      return
    }
    let alive = true
    let blobUrl: string | null = null
    // 同步设置原始 URL,避免缓存解析期间出现空白
    setResolvedSrc(processedSrc)
    resolveImageUrl(processedSrc)
      .then((url) => {
        if (!alive) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url)
          return
        }
        if (url && url !== processedSrc) {
          blobUrl = url
          setResolvedSrc(url)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
      if (blobUrl) URL.revokeObjectURL(blobUrl)
    }
  }, [processedSrc])

  // IntersectionObserver 懒加载
  const [inView, setInView] = useState(eager)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (eager || inView) return
    const el = containerRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [eager, inView])

  // 无 URL 直接显示错误状态
  useEffect(() => {
    if (!resolvedSrc) {
      setStatus('error')
    } else {
      setStatus('loading')
    }
  }, [resolvedSrc])

  return (
    // 根容器始终填充父级,确保骨架/错误占位有正确尺寸
    <div ref={containerRef} className={`relative w-full h-full overflow-hidden ${className}`}>
      {/* 加载中骨架 */}
      {status === 'loading' && (
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-white/[0.08] animate-pulse" />
      )}

      {/* 错误占位 */}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-hover-overlay-subtle)]">
          <div className="flex flex-col items-center gap-1 text-gray-700">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
            </svg>
            {alt && <span className="text-xs truncate max-w-[80%]">{alt}</span>}
          </div>
        </div>
      )}

      {/* 图片 */}
      {inView && resolvedSrc && status !== 'error' && (
        <img
          src={resolvedSrc}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          style={{ objectFit }}
          className={`absolute inset-0 w-full h-full transition-opacity duration-300 ${
            status === 'loaded' ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  )
}
