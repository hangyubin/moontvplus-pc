import { contextBridge, ipcRenderer } from 'electron'

const api = {
  store: {
    get: (key: string) => ipcRenderer.invoke('store:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('store:set', key, value),
    getAll: () => ipcRenderer.invoke('store:getAll')
  },
  platform: process.platform
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
