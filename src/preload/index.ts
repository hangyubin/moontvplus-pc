import { contextBridge, ipcRenderer } from 'electron'

const api = {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
    getAll: () => ipcRenderer.invoke('store:getAll')
  },
  platform: process.platform,
  media: {
    /** 注册自定义视频流(m3u8 域名)的防盗链 Referer/UA,主进程播放时注入 */
    setVideoHeaders: (payload: { url: string; referer?: string; ua?: string }) =>
      ipcRenderer.invoke('media:setVideoHeaders', payload)
  },
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChange: (callback: (isMaximized: boolean) => void) => {
      const handler = (_event: unknown, isMaximized: boolean) => callback(isMaximized)
      ipcRenderer.on('window:maximizeChanged', handler)
      return () => ipcRenderer.removeListener('window:maximizeChanged', handler)
    }
  },
  live: {
    startRecording: (payload: { recordId: string; url: string; channelName: string }) =>
      ipcRenderer.invoke('live:startRecording', payload),
    stopRecording: (recordId: string) => ipcRenderer.invoke('live:stopRecording', recordId),
    getRecordingStatus: (recordId: string) => ipcRenderer.invoke('live:getRecordingStatus', recordId),
    listRecordings: () => ipcRenderer.invoke('live:listRecordings'),
    openRecordingFolder: () => ipcRenderer.invoke('live:openRecordingFolder'),
    onRecordingProgress: (callback: (data: { recordId: string; bytes: number; filePath: string }) => void) => {
      const handler = (_event: unknown, data: { recordId: string; bytes: number; filePath: string }) => callback(data)
      ipcRenderer.on('live:recordingProgress', handler)
      return () => ipcRenderer.removeListener('live:recordingProgress', handler)
    },
    onRecordingComplete: (callback: (data: { recordId: string; filePath: string; bytes: number }) => void) => {
      const handler = (_event: unknown, data: { recordId: string; filePath: string; bytes: number }) => callback(data)
      ipcRenderer.on('live:recordingComplete', handler)
      return () => ipcRenderer.removeListener('live:recordingComplete', handler)
    },
    onRecordingStopped: (callback: (data: { recordId: string; filePath: string }) => void) => {
      const handler = (_event: unknown, data: { recordId: string; filePath: string }) => callback(data)
      ipcRenderer.on('live:recordingStopped', handler)
      return () => ipcRenderer.removeListener('live:recordingStopped', handler)
    },
    onRecordingError: (callback: (data: { recordId: string; error: string; filePath: string }) => void) => {
      const handler = (_event: unknown, data: { recordId: string; error: string; filePath: string }) => callback(data)
      ipcRenderer.on('live:recordingError', handler)
      return () => ipcRenderer.removeListener('live:recordingError', handler)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('app', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.app = api
}

export type AppApi = typeof api
