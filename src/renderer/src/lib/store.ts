/**
 * 全局状态管理(zustand)
 * 管理:认证状态、播放记录、收藏、站点配置
 *
 * 写操作采用乐观更新,API 失败时回滚到原状态,保证本地与服务端一致。
 */
import { create } from 'zustand'
import type {
  PlayRecordMap,
  PlayRecord,
  FavoriteMap,
  ServerConfig,
  AuthInfo
} from '../types'
import * as api from '../lib/api'
import {
  login as doLogin,
  logout as doLogout,
  restoreAuth,
  getAuth,
  getBaseUrl
} from '../lib/auth'
import { clearHomeCache } from '../lib/homeCache'
import { clearImageCache } from '../lib/image'
import { clearSearchCache } from '../lib/searchCache'

interface AppState {
  /* 认证 */
  isAuthed: boolean
  auth: AuthInfo | null
  serverConfig: ServerConfig | null
  baseUrl: string

  /* 数据 */
  playRecords: PlayRecordMap
  favorites: FavoriteMap

  /* 初始化 */
  init: () => Promise<void>

  /* 认证动作 */
  login: (baseUrl: string, username: string, password: string) => Promise<void>
  logout: () => Promise<void>

  /* 数据加载 */
  loadPlayRecords: () => Promise<void>
  loadFavorites: () => Promise<void>
  loadServerConfig: () => Promise<void>

  /* 数据操作 */
  upsertPlayRecord: (source: string, id: string, record: PlayRecord) => Promise<void>
  removePlayRecord: (key: string) => Promise<void>
  upsertFavorite: (key: string, favorite: FavoriteMap[string]) => Promise<void>
  removeFavorite: (key: string) => Promise<void>
}

/** 初始化守卫,防止 StrictMode 双调用 */
let _initializing = false

export const useStore = create<AppState>((set, get) => ({
  isAuthed: false,
  auth: null,
  serverConfig: null,
  baseUrl: '',
  playRecords: {},
  favorites: {},

  init: async () => {
    if (_initializing) return
    _initializing = true
    try {
      const ok = await restoreAuth()
      if (ok) {
        set({ isAuthed: true, auth: getAuth(), baseUrl: getBaseUrl() })
        await get().loadServerConfig()
        await Promise.all([get().loadPlayRecords(), get().loadFavorites()])
      }
    } finally {
      _initializing = false
    }
  },

  login: async (baseUrl, username, password) => {
    const res = await doLogin(baseUrl, username, password)
    if (!res.ok) throw new Error(res.message || '登录失败')
    // 连接服务器属于模式切换:清空首页/图片/搜索缓存,避免与之前的自定义源数据串用
    clearHomeCache()
    void clearImageCache()
    clearSearchCache()
    set({ isAuthed: true, auth: res.auth, baseUrl: getBaseUrl() })
    await get().loadServerConfig()
    await Promise.all([get().loadPlayRecords(), get().loadFavorites()])
  },

  logout: async () => {
    await doLogout()
    // 断开服务器(可能回退到自定义源):同样清空缓存强制重新加载
    clearHomeCache()
    void clearImageCache()
    clearSearchCache()
    set({
      isAuthed: false,
      auth: null,
      serverConfig: null,
      playRecords: {},
      favorites: {}
    })
  },

  loadServerConfig: async () => {
    try {
      const cfg = await api.getServerConfig()
      set({ serverConfig: cfg })
    } catch {
      /* 静默失败,不影响主流程 */
    }
  },

  loadPlayRecords: async () => {
    try {
      const records = await api.getPlayRecords()
      set({ playRecords: records })
    } catch (e) {
      console.error('loadPlayRecords', e)
    }
  },

  loadFavorites: async () => {
    try {
      const favs = await api.getFavorites()
      set({ favorites: favs })
    } catch (e) {
      console.error('loadFavorites', e)
    }
  },

  upsertPlayRecord: async (source, id, record) => {
    const key = `${source}+${id}`
    const prev = get().playRecords[key]
    // 乐观更新
    set((s) => ({ playRecords: { ...s.playRecords, [key]: record } }))
    try {
      await api.savePlayRecord(source, id, record)
    } catch (e) {
      console.error('upsertPlayRecord', e)
      // 回滚到原状态
      set((s) => {
        const next = { ...s.playRecords }
        if (prev) {
          next[key] = prev
        } else {
          delete next[key]
        }
        return { playRecords: next }
      })
    }
  },

  removePlayRecord: async (key) => {
    const prev = get().playRecords[key]
    set((s) => {
      const next = { ...s.playRecords }
      delete next[key]
      return { playRecords: next }
    })
    try {
      await api.deletePlayRecord(key)
    } catch (e) {
      console.error('removePlayRecord', e)
      // 回滚
      if (prev) {
        set((s) => ({ playRecords: { ...s.playRecords, [key]: prev } }))
      }
    }
  },

  upsertFavorite: async (key, favorite) => {
    const prev = get().favorites[key]
    set((s) => ({ favorites: { ...s.favorites, [key]: favorite } }))
    try {
      await api.saveFavorite(key, favorite)
    } catch (e) {
      console.error('upsertFavorite', e)
      // 回滚
      set((s) => {
        const next = { ...s.favorites }
        if (prev) {
          next[key] = prev
        } else {
          delete next[key]
        }
        return { favorites: next }
      })
    }
  },

  removeFavorite: async (key) => {
    const prev = get().favorites[key]
    set((s) => {
      const next = { ...s.favorites }
      delete next[key]
      return { favorites: next }
    })
    try {
      await api.deleteFavorite(key)
    } catch (e) {
      console.error('removeFavorite', e)
      // 回滚
      if (prev) {
        set((s) => ({ favorites: { ...s.favorites, [key]: prev } }))
      }
    }
  }
}))

/** 获取排序后的播放记录数组(按 save_time DESC) */
export function sortedPlayRecords(map: PlayRecordMap): Array<[string, PlayRecord]> {
  return Object.entries(map).sort((a, b) => b[1].save_time - a[1].save_time)
}

/** 获取排序后的收藏数组 */
export function sortedFavorites(map: FavoriteMap): Array<[string, FavoriteMap[string]]> {
  return Object.entries(map).sort((a, b) => b[1].save_time - a[1].save_time)
}
