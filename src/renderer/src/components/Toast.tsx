/**
 * 全局轻量 Toast 提示
 *
 * 用法(任意位置,无需包裹 Provider):
 *   toast.success('已保存')
 *   toast.error('保存失败')
 *   toast.info('正在刷新...')
 *
 * 在 App 根部挂载一次 <Toaster /> 即可。
 */
import { useEffect, useState } from 'react'

type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  type: ToastType
  message: string
}

type Listener = (items: ToastItem[]) => void

let items: ToastItem[] = []
const listeners = new Set<Listener>()
let seq = 0

function emit() {
  for (const l of listeners) l(items)
}

function push(type: ToastType, message: string, duration = 2200) {
  const id = ++seq
  items = [...items, { id, type, message }]
  emit()
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id)
    emit()
  }, duration)
}

export const toast = {
  success: (msg: string) => push('success', msg),
  error: (msg: string) => push('error', msg, 3000),
  info: (msg: string) => push('info', msg)
}

const STYLE_MAP: Record<ToastType, { bar: string; icon: string; iconPath: string }> = {
  success: {
    bar: 'var(--color-primary)',
    icon: 'text-green-400',
    iconPath: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
  },
  error: {
    bar: '#ef4444',
    icon: 'text-red-400',
    iconPath: 'M12 9v3.75m0 3.75h.008v.008H12v-.008zM21 12a9 9 0 11-18 0 9 9 0 0118 0z'
  },
  info: {
    bar: '#3b82f6',
    icon: 'text-blue-400',
    iconPath: 'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z'
  }
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>([])

  useEffect(() => {
    listeners.add(setList)
    setList(items)
    return () => {
      listeners.delete(setList)
    }
  }, [])

  if (list.length === 0) return null

  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none">
      {list.map((t) => {
        const s = STYLE_MAP[t.type]
        return (
          <div
            key={t.id}
            className="flex items-center gap-2.5 pl-3 pr-4 py-2.5 rounded-lg shadow-2xl min-w-[200px] max-w-[420px] animate-toast-in"
            style={{
              background: 'var(--color-card-bg)',
              border: '1px solid var(--color-border-subtle)',
              borderLeft: `3px solid ${s.bar}`
            }}
          >
            <svg
              className={`w-4.5 h-4.5 w-[18px] h-[18px] flex-shrink-0 ${s.icon}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={s.iconPath} />
            </svg>
            <span className="text-xs font-medium text-[var(--color-text-primary)] break-all">
              {t.message}
            </span>
          </div>
        )
      })}
    </div>
  )
}
