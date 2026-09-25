/**
 * 自定义源配置(脱离 moontvplus 服务器使用)
 * - 视频点播源: 聚合 CMS 源列表 URL(如 https://pz.v88.qzz.io?format=0&source=full)
 * - 直播源: 标准 M3U 播放列表 URL
 * - 音乐源: lxserver URL + 持久 Token(留空则匿名访问)
 *
 * 配置存于 localStorage,填写则启用对应自定义源;留空则回退到 moontvplus 服务器
 */

const K_VIDEO = 'custom_video_source'
const K_LIVE = 'custom_live_source'
const K_MUSIC_URL = 'custom_music_source_url'
const K_MUSIC_TOKEN = 'custom_music_source_token'
const K_MUSIC_USERNAME = 'custom_music_source_username'

export interface CustomMusicSource {
  url: string
  token: string
  username: string
}

export function getCustomVideoSource(): string {
  return (localStorage.getItem(K_VIDEO) || '').trim()
}
export function setCustomVideoSource(url: string) {
  const v = url.trim()
  if (v) localStorage.setItem(K_VIDEO, v)
  else localStorage.removeItem(K_VIDEO)
}

export function getCustomLiveSource(): string {
  return (localStorage.getItem(K_LIVE) || '').trim()
}
export function setCustomLiveSource(url: string) {
  const v = url.trim()
  if (v) localStorage.setItem(K_LIVE, v)
  else localStorage.removeItem(K_LIVE)
}

export function getCustomMusicSource(): CustomMusicSource {
  return {
    url: (localStorage.getItem(K_MUSIC_URL) || '').trim(),
    token: (localStorage.getItem(K_MUSIC_TOKEN) || '').trim(),
    username: (localStorage.getItem(K_MUSIC_USERNAME) || '').trim(),
  }
}
export function setCustomMusicSource(url: string, token: string, username = '') {
  const u = url.trim()
  const t = token.trim()
  const n = username.trim()
  if (u) localStorage.setItem(K_MUSIC_URL, u)
  else localStorage.removeItem(K_MUSIC_URL)
  if (t) localStorage.setItem(K_MUSIC_TOKEN, t)
  else localStorage.removeItem(K_MUSIC_TOKEN)
  if (n) localStorage.setItem(K_MUSIC_USERNAME, n)
  else localStorage.removeItem(K_MUSIC_USERNAME)
}

export function hasCustomVideo(): boolean {
  return !!getCustomVideoSource()
}
export function hasCustomLive(): boolean {
  return !!getCustomLiveSource()
}
export function hasCustomMusic(): boolean {
  return !!getCustomMusicSource().url
}
