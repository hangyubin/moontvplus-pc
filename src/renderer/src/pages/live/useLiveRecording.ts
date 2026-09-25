/**
 * 直播录制 hook — 开始/停止录制 + 主进程录制事件监听
 */
import { useEffect, useState, useCallback } from 'react'
import { toast } from '../../components/Toast'
import type { ChannelItem } from './types'

export function useLiveRecording(currentChannel: ChannelItem | null, currentUrlIndex: number) {
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [recordingFilePath, setRecordingFilePath] = useState('')
  const [recordingBytes, setRecordingBytes] = useState(0)
  const [recordingStartTime, setRecordingStartTime] = useState(0)

  const startRecording = useCallback(async () => {
    if (!currentChannel || !window.app?.live) return
    const url = currentChannel.urls[currentUrlIndex]
    if (!url) {
      toast.error('当前频道无播放地址')
      return
    }
    const recordId = `rec_${Date.now()}`
    try {
      const result = await window.app.live.startRecording({ recordId, url, channelName: currentChannel.name })
      if (result?.ok) {
        setRecordingId(recordId)
        setRecordingFilePath(result.filePath || '')
        setRecordingBytes(0)
        setRecordingStartTime(Date.now())
        toast.success('开始录制')
      } else {
        toast.error(result?.error || '启动录制失败')
      }
    } catch (e: any) {
      toast.error(e?.message || '启动录制失败')
    }
  }, [currentChannel, currentUrlIndex])

  const stopRecording = useCallback(async () => {
    if (!recordingId || !window.app?.live) return
    try {
      await window.app.live.stopRecording(recordingId)
      setRecordingId(null)
      setRecordingStartTime(0)
    } catch {}
  }, [recordingId])

  // 录制进度/完成/错误事件监听
  useEffect(() => {
    if (!window.app?.live) return
    const unProgress = window.app.live.onRecordingProgress((data) => {
      if (data.recordId === recordingId) setRecordingBytes(data.bytes)
    })
    const unComplete = window.app.live.onRecordingComplete((data) => {
      if (data.recordId === recordingId) {
        toast.success(`录制完成: ${(data.bytes / 1024 / 1024).toFixed(1)} MB`)
        setRecordingId(null)
        setRecordingStartTime(0)
      }
    })
    const unStopped = window.app.live.onRecordingStopped((data) => {
      if (data.recordId === recordingId) {
        toast.info('录制已停止')
        setRecordingId(null)
        setRecordingStartTime(0)
      }
    })
    const unError = window.app.live.onRecordingError((data) => {
      if (data.recordId === recordingId) {
        toast.error(`录制失败: ${data.error}`)
        setRecordingId(null)
        setRecordingStartTime(0)
      }
    })
    return () => { unProgress(); unComplete(); unStopped(); unError() }
  }, [recordingId])

  // recordingFilePath / recordingStartTime 保留与原实现一致(状态记录,当前 UI 未直接展示)
  void recordingFilePath
  void recordingStartTime

  return { recordingId, recordingBytes, startRecording, stopRecording }
}
