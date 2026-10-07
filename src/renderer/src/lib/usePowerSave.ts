/**
 * 播放防休眠 hook
 *
 * mode 非 null 期间向主进程申请阻止系统休眠,置 null / 卸载时自动释放:
 *   - 'video':视频播放 → 屏幕保持常亮(prevent-display-sleep)
 *   - 'audio':音乐播放 → 仅阻止系统睡眠,允许熄屏(prevent-app-suspension)
 * 同一时刻多次 acquire 由主进程按持有者集合去重,取最强需求生效。
 */
import { useEffect, useRef } from 'react'

export function usePowerSave(mode: 'video' | 'audio' | null): void {
  const tokenRef = useRef<string | null>(null)

  useEffect(() => {
    const power = window.app?.power
    if (!power || !mode) return
    let disposed = false
    power.acquire(mode).then((token) => {
      if (disposed) {
        // acquire 返回前组件已卸载/依赖已变:立即释放,防令牌泄漏
        power.release(token)
        return
      }
      tokenRef.current = token
    })
    return () => {
      disposed = true
      if (tokenRef.current !== null) {
        power.release(tokenRef.current)
        tokenRef.current = null
      }
    }
  }, [mode])
}
