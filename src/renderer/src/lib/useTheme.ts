/**
 * 主题管理:深色/浅色切换,持久化到 localStorage
 *
 * 通过在 <html> 元素上设置 data-theme 属性,
 * globals.css 中的 CSS 变量和覆盖规则根据属性值切换颜色。
 */
import { useEffect, useState, useCallback } from 'react'

type Theme = 'dark' | 'light'

const STORAGE_KEY = 'app-theme'

/** 获取当前主题 */
function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark') return v
  } catch {
    /* localStorage 不可用 */
  }
  return 'dark' // 默认深色
}

/** 应用主题到 DOM */
function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.setAttribute('data-theme', theme)
  root.classList.toggle('dark', theme === 'dark')
}

/** React Hook:主题状态管理 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme)

  // 初始化时应用主题
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  /** 切换主题 */
  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* ignore */
      }
      applyTheme(next)
      return next
    })
  }, [])

  /** 直接设置主题 */
  const setTheme = useCallback((t: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* ignore */
    }
    applyTheme(t)
    setThemeState(t)
  }, [])

  return { theme, toggleTheme, setTheme }
}

/** 启动前同步应用主题(防止闪烁) */
export function initTheme() {
  applyTheme(getStoredTheme())
}
