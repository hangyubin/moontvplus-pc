/**
 * 自适应网格列数 Hook
 *
 * 使用 ResizeObserver 监听容器宽度变化,
 * 根据卡片最小宽度动态计算列数。
 *
 * 关键:使用 contentRect 或手动减去 padding,
 * 确保 JS 计算的列数与 CSS auto-fill 完全一致。
 */
import { useState, useRef, useEffect } from 'react'

interface UseGridColumnsOptions {
  /** 卡片最小宽度(px),默认 160 */
  minWidth?: number
  /** 网格间距(px),默认 20 */
  gap?: number
  /** 显示行数,默认 2 */
  rows?: number
}

interface GridResult<T> {
  ref: React.RefObject<T>
  columns: number
  maxItems: number
}

export function useGridColumns<T extends HTMLElement = HTMLDivElement>(
  options: UseGridColumnsOptions = {}
): GridResult<T> {
  const { minWidth = 160, gap = 20, rows = 2 } = options
  const ref = useRef<T>(null)
  const [columns, setColumns] = useState(6)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let rafId = 0

    const calc = () => {
      let width = el.clientWidth
      // 减去 padding,得到内容区宽度(CSS grid 的可用宽度)
      const style = getComputedStyle(el)
      const paddingLeft = parseFloat(style.paddingLeft) || 0
      const paddingRight = parseFloat(style.paddingRight) || 0
      width = width - paddingLeft - paddingRight

      if (width <= 0) return

      const cols = Math.max(2, Math.floor((width + gap) / (minWidth + gap)))
      setColumns(cols)
    }

    rafId = requestAnimationFrame(calc)
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(calc)
    })
    observer.observe(el)
    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [minWidth, gap])

  const maxItems = columns * rows

  return { ref, columns, maxItems }
}
