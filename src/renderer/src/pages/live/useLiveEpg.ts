/**
 * 直播 EPG hook — 当前频道完整节目单加载 + 每 30s 刷新的当前/下一节目
 */
import { useEffect, useState, useMemo } from 'react'
import { getLiveEpgFull } from '../../lib/live'
import { findCurrentNextFull, type EpgProgramFull, type CurrentNextProgram } from '../../lib/m3u'
import type { ChannelItem } from './types'

export function useLiveEpg(currentChannel: ChannelItem | null, currentSourceKey: string) {
  /** 当前频道完整 EPG(带毫秒时间戳) */
  const [currentEpg, setCurrentEpg] = useState<EpgProgramFull[]>([])
  /** EPG 加载中 */
  const [epgLoading, setEpgLoading] = useState(false)

  useEffect(() => {
    if (!currentChannel || !currentSourceKey) {
      setCurrentEpg([])
      return
    }
    const tvgId = currentChannel.tvgId || currentChannel.name
    setEpgLoading(true)
    let cancelled = false
    getLiveEpgFull(currentSourceKey, tvgId)
      .then((full) => {
        if (!cancelled) setCurrentEpg(full)
      })
      .catch(() => {
        if (!cancelled) setCurrentEpg([])
      })
      .finally(() => {
        if (!cancelled) setEpgLoading(false)
      })
    return () => { cancelled = true }
  }, [currentChannel, currentSourceKey])

  // 每 30 秒刷新一次当前/下一节目(跨节目时段自动更新)
  const [epgTick, setEpgTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setEpgTick((t) => t + 1), 30000)
    return () => clearInterval(timer)
  }, [])

  const currentNextProgram: CurrentNextProgram = useMemo(() => {
    if (!currentEpg.length) return { current: null, next: null }
    return findCurrentNextFull(currentEpg, Date.now())
  }, [currentEpg, epgTick])

  return { epgLoading, currentNextProgram }
}
