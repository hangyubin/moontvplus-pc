/** 全局 window.app 类型声明(preload 注入) */
export interface WindowApi {
  store: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    getAll: () => Promise<Record<string, unknown>>
  }
  platform: string
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void
  }
  media: {
    setVideoHeaders: (payload: { url: string; referer?: string; ua?: string }) => Promise<boolean>
  }
  live: {
    startRecording: (payload: { recordId: string; url: string; channelName: string }) => Promise<{ ok: boolean; filePath?: string; error?: string }>
    stopRecording: (recordId: string) => Promise<{ ok: boolean; filePath?: string; error?: string }>
    getRecordingStatus: (recordId: string) => Promise<{ recording: boolean; filePath?: string; startTime?: number; channelName?: string }>
    listRecordings: () => Promise<{ name: string; path: string; size: number; mtime: number }[]>
    openRecordingFolder: () => Promise<string>
    onRecordingProgress: (callback: (data: { recordId: string; bytes: number; filePath: string }) => void) => () => void
    onRecordingComplete: (callback: (data: { recordId: string; filePath: string; bytes: number }) => void) => () => void
    onRecordingStopped: (callback: (data: { recordId: string; filePath: string }) => void) => () => void
    onRecordingError: (callback: (data: { recordId: string; error: string; filePath: string }) => void) => () => void
  }
}

declare global {
  interface Window {
    app: WindowApi
  }
}
