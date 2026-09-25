/**
 * 共享工具函数
 * 从各页面提取的通用纯函数,消除跨文件重复
 */

/** 规范化标题(去空格、转小写)用于模糊匹配 */
export function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, '')
}

/**
 * 将时间戳格式化为相对时间字符串
 * 规则:刚刚 / X分钟前 / X小时前 / X天前 / YYYY-MM-DD
 */
export function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return ''
  const now = Date.now()
  const diff = now - timestamp
  const oneMinute = 60 * 1000
  const oneHour = 60 * oneMinute
  const oneDay = 24 * oneHour

  if (diff < oneMinute) return '刚刚'
  if (diff < oneHour) return `${Math.floor(diff / oneMinute)}分钟前`
  if (diff < oneDay) return `${Math.floor(diff / oneHour)}小时前`
  if (diff < 7 * oneDay) return `${Math.floor(diff / oneDay)}天前`

  const date = new Date(timestamp)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 格式化秒为 mm:ss */
export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '00:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 计算播放进度百分比(0-100) */
export function calcProgress(playTime: number, totalTime: number): number {
  if (!totalTime || totalTime <= 0) return 0
  return Math.min(100, (playTime / totalTime) * 100)
}

/** 构建详情页 URL */
export function buildDetailUrl(source: string, id: string, title: string): string {
  return `/detail?source=${encodeURIComponent(source)}&id=${encodeURIComponent(id)}&title=${encodeURIComponent(title)}`
}

/** 构建播放页 URL */
export function buildPlayUrl(source: string, id: string, title: string, episode?: number): string {
  const params = new URLSearchParams({
    source,
    id,
    title,
  })
  if (episode !== undefined) params.set('index', String(episode))
  return `/play?${params.toString()}`
}
