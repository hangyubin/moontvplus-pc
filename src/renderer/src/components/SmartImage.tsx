/**
 * 智能图片组件
 * 功能:懒加载、加载骨架、错误占位、渐入动画
 * 替代原生 <img> 标签,统一图片加载体验
 *
 * 关键:根容器始终 w-full h-full 填充父级,
 * 父级需有明确尺寸(如 aspect-ratio 或固定高宽)。
 */
import { useState, useRef, useEffect } from 'react'
import { processImageUrl } from '../lib/image'

interface SmartImageProps {
  src: string | undefined | null
  alt: string
  /** 额外类名(应用到根容器) */
  className?: string
  /** 是否强制立即加载(跳过懒加载,用于首屏 Banner) */
  eager?: boolean
}

export default function SmartImage({
  src,
  alt,
  className = '',
  eager = false
}: SmartImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const processedSrc = processImageUrl(src)

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
    if (!processedSrc) {
      setStatus('error')
    } else {
      setStatus('loading')
    }
  }, [processedSrc])

  return (
    // 根容器始终填充父级,确保骨架/错误占位有正确尺寸
    <div ref={containerRef} className={`relative w-full h-full overflow-hidden ${className}`}>
      {/* 加载中骨架 */}
      {status === 'loading' && (
        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.04] to-white/[0.08] animate-pulse" />
      )}

      {/* 错误占位 */}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/[0.03]">
          <div className="flex flex-col items-center gap-1 text-gray-700">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
            </svg>
            {alt && <span className="text-xs truncate max-w-[80%]">{alt}</span>}
          </div>
        </div>
      )}

      {/* 图片 */}
      {inView && processedSrc && status !== 'error' && (
        <img
          src={processedSrc}
          alt={alt}
          loading={eager ? 'eager' : 'lazy'}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            status === 'loaded' ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  )
}
